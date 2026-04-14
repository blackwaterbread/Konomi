# @konomi/core

AI 이미지 갤러리 앱 [Konomi](https://github.com/dayrain/Konomi)의 공유 코어 라이브러리.

PNG/WebP 이미지에서 AI 생성 메타데이터(NovelAI, Stable Diffusion WebUI, ComfyUI, Midjourney)를 추출하고,
폴더 스캔 · 실시간 감시 · 카테고리 관리 등의 비즈니스 로직을 제공한다.

Prisma(SQLite/MySQL)를 DB 레이어로 직접 사용하며, 통신 레이어(EventSender)만 환경별로 주입한다.

---

## Features

- **메타데이터 파싱** — NovelAI (tEXt + LSB 스테가노그래피), WebUI, ComfyUI, Midjourney PNG 메타데이터 자동 감지 및 추출
- **프롬프트 토큰 파서** — `{강조}`, `[약화]`, `weight::text::` 등의 가중치 구문 해석
- **파일 스캐너** — 재귀 디렉토리 탐색, 동시성 제어(`withConcurrency`), 취소 토큰 지원
- **서비스 레이어** — 폴더 스캔, 실시간 감시, 폴더/카테고리 CRUD, 유사 이미지 분석, NAI 생성
- **Prisma Repo** — concrete Prisma repository (`ImageRepo`, `FolderRepo` 등) 서비스에 직접 주입
- **Native Addon(선택)** — C++ 기반 고속 pHash 계산, LSB 추출, 유사도 분석, 이미지 리사이즈

---

## Quick Start

### 메타데이터 읽기

```typescript
import { readImageMeta } from "@konomi/core";

const meta = readImageMeta("/path/to/image.png");

if (meta) {
  console.log(meta.source);          // "nai" | "webui" | "comfyui" | "midjourney"
  console.log(meta.prompt);          // "1girl, masterpiece, ..."
  console.log(meta.negativePrompt);  // "lowres, bad anatomy, ..."
  console.log(meta.model);           // "nai-diffusion-4-5-full"
  console.log(meta.seed);            // 1234567890
  console.log(meta.width, meta.height);
}
```

Buffer에서도 직접 파싱할 수 있다:

```typescript
import { readImageMetaFromBuffer } from "@konomi/core";
import fs from "fs";

const buf = fs.readFileSync("/path/to/image.png");
const meta = readImageMetaFromBuffer(buf);
```

### 프롬프트 토큰 파싱

```typescript
import { parsePromptTokens } from "@konomi/core";

parsePromptTokens("{masterpiece}, best quality, 1girl");
// [
//   { text: "masterpiece", weight: 1.05 },
//   { text: "best quality", weight: 1.0 },
//   { text: "1girl", weight: 1.0 },
// ]
```

### 폴더 스캔

```typescript
import { scanImageFiles, walkImageFiles, withConcurrency, readImageMeta } from "@konomi/core";

// 한번에 모든 경로 수집
const files = await scanImageFiles("/images");

// 스트리밍 + 동시 처리
await withConcurrency(walkImageFiles("/images"), 4, async (filePath) => {
  const meta = readImageMeta(filePath);
  // ...
});

// 취소 가능
const signal = { cancelled: false };
const files2 = await scanImageFiles("/images", signal);
signal.cancelled = true; // 중단
```

---

## Architecture

```
+-----------------------------------------------------+
|                    @konomi/core                       |
|                                                       |
|  +---------+  +----------+  +--------------------+   |
|  |  lib/   |  | services/|  |     types/         |   |
|  | parsers |  | scan     |  | Entity types       |   |
|  | scanner |  | watch    |  | EventSender (통신) |   |
|  | repos   |  | folder   |  | Data shapes        |   |
|  | infra   |  | category |  |                    |   |
|  +---------+  +-----+----+  +--------+-----------+   |
|                      |  DI 주입       |               |
+----------------------+---------------+---------------+
                       |               |
          +------------+---+    +------+----------+
          | Desktop        |    | Web Server       |
          | (Electron)     |    | (Fastify)        |
          |                |    |                   |
          | SQLite         |    | MySQL              |
          | IPC sender     |    | WebSocket sender  |
          +----------------+    +------------------+
```

서비스는 Prisma repo를 직접 주입받는다. DB 종류(SQLite/MySQL)는 Prisma의 `datasource`로 전환.
통신 레이어만 환경별 `EventSender` 구현을 주입한다.

---

## Services

서비스는 팩토리 함수로 생성하며, Prisma repo + EventSender를 의존성으로 받는다.

```typescript
import { createPrismaFolderRepo } from "@core/lib/repositories/prisma-folder-repo";
import { createPrismaImageRepo } from "@core/lib/repositories/prisma-image-repo";
import { createScanService, createFolderService } from "@konomi/core";

const folderRepo = createPrismaFolderRepo(getDB);
const imageRepo = createPrismaImageRepo(getDB);

const scanService = createScanService({ imageRepo, folderRepo, sender });
const folderService = createFolderService({ folderRepo, imageRepo });
```

### ScanService

등록된 폴더를 순회하며 이미지 파일을 스캔하고 DB에 저장한다.

- **Delta 감지**: 기존 이미지의 `fileModifiedAt` 비교로 변경분만 메타데이터 파싱
- **배치 처리**: 50개 단위로 DB에 일괄 upsert
- **Stale 정리**: 디스크에서 삭제된 파일의 DB row를 자동 제거
- **커스텀 메타 리더**: `readMeta` 옵션으로 WorkerPool 기반 고속 리더 주입 가능

### WatchService

`fs.watch`로 폴더를 실시간 감시하여 파일 변경을 즉시 반영한다.
`setScanActive(true/false)`로 스캔 중 변경 이벤트를 큐잉/플러시.

### EventSender (통신 계약)

```typescript
interface EventSender {
  send(channel: string, data: unknown): void;
}
```

Desktop에서는 Electron IPC, Web에서는 WebSocket으로 구현한다.

---

## Supported Image Formats

| Source | 포맷 | 감지 방식 |
|---|---|---|
| NovelAI | PNG | tEXt 청크 -> Comment JSON 파싱 |
| NovelAI | PNG | LSB 스테가노그래피 (순수 JS / native addon) |
| NovelAI | WebP | 알파 채널 LSB (native addon 필요) |
| Stable Diffusion WebUI | PNG | tEXt 청크 `parameters` 키 |
| ComfyUI | PNG | tEXt 청크 `prompt` (JSON 그래프) + `workflow` fallback |
| Midjourney | PNG | tEXt `Description` + XMP 시그널 기반 분류 |

`readImageMeta()`는 위 순서대로 시도하여 첫 번째 성공한 결과를 반환한다.

---

## Native Addons (선택)

core는 native addon 없이 동작하지만, 성능이 중요한 경우 C++ addon을 빌드하여 사용할 수 있다.

| Addon | 기능 |
|---|---|
| `konomi-image` | pHash 계산, NAI LSB 고속 추출, 유사도 쌍 계산, PNG 리사이즈 |
| `webp-alpha` | WebP 알파/RGB 디코드, WebP 리사이즈 |

소스는 `src/native/` 디렉토리. 빌드된 `.node`는 `prebuilds/{platform}-{arch}/`에 배치.

---

## Project Structure

전체 디렉토리 구조와 각 파일의 상세 역할은 [STRUCTURE.md](./STRUCTURE.md)를 참조.
