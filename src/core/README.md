# @konomi/core

AI 이미지 갤러리 앱 [Konomi](https://github.com/dayrain/Konomi)의 공유 코어 라이브러리.

PNG/WebP 이미지에서 AI 생성 메타데이터(NovelAI, Stable Diffusion WebUI, ComfyUI, Midjourney)를 추출하고,
폴더 스캔 · 실시간 감시 · 카테고리 관리 등의 비즈니스 로직을 제공한다.

DB와 통신 레이어에 대한 의존성이 없으며, 인터페이스를 통해 주입받는 구조이기 때문에
**Desktop(Electron)과 Web(Fastify 등) 양쪽에서 동일한 비즈니스 로직을 재사용**할 수 있다.

---

## Features

- **메타데이터 파싱** — NovelAI (tEXt + LSB 스테가노그래피), WebUI, ComfyUI, Midjourney PNG 메타데이터 자동 감지 및 추출
- **프롬프트 토큰 파서** — `{강조}`, `[약화]`, `weight::text::` 등의 가중치 구문 해석
- **파일 스캐너** — 재귀 디렉토리 탐색, 동시성 제어(`withConcurrency`), 취소 토큰 지원
- **서비스 레이어** — 폴더 스캔, 실시간 감시, 폴더/카테고리 CRUD를 DI 기반으로 제공
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
|  | parsers |  | scan     |  | Repository (DB)    |   |
|  | scanner |  | watch    |  | EventSender (통신) |   |
|  | token   |  | folder   |  | Entity shapes      |   |
|  | logger  |  | category |  |                    |   |
|  +---------+  +-----+----+  +--------+-----------+   |
|                      |  DI 주입       |               |
+----------------------+---------------+---------------+
                       |               |
          +------------+---+    +------+----------+
          | Desktop        |    | Web Server       |
          | (Electron)     |    | (Fastify)        |
          |                |    |                   |
          | Prisma+SQLite  |    | Prisma+MySQL      |
          | IPC sender     |    | WebSocket sender  |
          +----------------+    +------------------+
```

core는 DB와 통신에 대해 아무것도 모른다. 소비하는 쪽이 **Repository**와 **EventSender** 인터페이스를 구현하여 주입하면, core의 서비스가 동일한 비즈니스 로직으로 동작한다.

---

## Services

서비스는 팩토리 함수로 생성하며, 의존성을 인자로 받는다.

```typescript
import {
  createScanService,
  createFolderService,
  createCategoryService,
  createWatchService,
} from "@konomi/core";

// Repository / EventSender 구현체를 준비한 뒤 주입
const scanService     = createScanService({ imageRepo, folderRepo, sender });
const folderService   = createFolderService({ folderRepo });
const categoryService = createCategoryService({ categoryRepo });
const watchService    = createWatchService({ imageRepo, folderRepo, sender });
```

### ScanService

등록된 폴더를 순회하며 이미지 파일을 스캔하고 DB에 저장한다.

| 메서드 | 설명 |
|---|---|
| `scanAll(options?)` | 전체 폴더 스캔. `signal`로 취소, `folderIds`로 대상 제한 |
| `scanOne(folderId, signal?)` | 단일 폴더 스캔 |

- **Delta 감지**: 기존 이미지의 `fileModifiedAt` 비교로 변경분만 메타데이터 파싱
- **배치 처리**: 50개 단위로 DB에 일괄 upsert
- **Stale 정리**: 디스크에서 삭제된 파일의 DB row를 자동 제거
- **커스텀 메타 리더**: `readMeta` 옵션으로 native addon 기반 고속 리더 주입 가능

### WatchService

`fs.watch`로 폴더를 실시간 감시하여 파일 변경을 즉시 반영한다.

| 메서드 | 설명 |
|---|---|
| `startAll()` | DB에 등록된 전체 폴더 감시 시작 |
| `watchFolder(id, path)` | 특정 폴더 감시 등록 |
| `stopFolder(id)` | 특정 폴더 감시 해제 |
| `stopAll()` | 전체 감시 중지 |
| `setScanActive(active)` | `true`: 변경 이벤트 큐잉, `false`: 큐 플러시 |

스캔과 감시를 조합하는 패턴:

```typescript
watchService.setScanActive(true);   // 스캔 중 변경 큐잉
await scanService.scanAll();
watchService.setScanActive(false);  // 큐잉된 변경 일괄 처리
```

### FolderService / CategoryService

폴더 및 카테고리 CRUD. Repository를 그대로 위임하되, 경로 정규화/중복 검사 같은 비즈니스 규칙을 포함한다.

---

## Interfaces

소비하는 쪽이 반드시 구현해야 하는 계약.

### Repository (DB 계약)

```typescript
interface FolderRepository {
  findAll(): Promise<FolderEntity[]>;
  findById(id: number): Promise<FolderEntity | null>;
  create(name: string, path: string): Promise<FolderEntity>;
  delete(id: number): Promise<void>;
  rename(id: number, name: string): Promise<FolderEntity>;
}

interface ImageRepository {
  findById(id: number): Promise<ImageEntity | null>;
  findByPath(path: string): Promise<ImageEntity | null>;
  findSyncRowsByFolderId(folderId: number): Promise<ImageSyncRow[]>;
  upsertBatch(rows: ImageUpsertData[]): Promise<ImageEntity[]>;
  upsertByPath(data: ImageUpsertData): Promise<ImageEntity>;
  deleteByIds(ids: number[]): Promise<void>;
  deleteByPath(path: string): Promise<void>;
  countByFolderId(folderId: number): Promise<number>;
  existsByPath(path: string): Promise<boolean>;
  updateFolderScanMeta(folderId: number, fileCount: number, finishedAt: Date): Promise<void>;
}

interface CategoryRepository {
  findAll(): Promise<CategoryEntity[]>;
  create(name: string): Promise<CategoryEntity>;
  delete(id: number): Promise<void>;
  rename(id: number, name: string): Promise<CategoryEntity>;
  addImage(imageId: number, categoryId: number): Promise<void>;
  removeImage(imageId: number, categoryId: number): Promise<void>;
  addImages(imageIds: number[], categoryId: number): Promise<void>;
  removeImages(imageIds: number[], categoryId: number): Promise<void>;
  getImageIds(categoryId: number): Promise<number[]>;
  getCategoriesForImage(imageId: number): Promise<number[]>;
  seedBuiltins(): Promise<void>;
  // ... 전체 목록은 types/repository.ts 참조
}
```

Prisma, TypeORM, Drizzle, raw SQL 등 어떤 DB 기술이든 위 인터페이스만 구현하면 된다.

### EventSender (통신 계약)

```typescript
interface EventSender {
  send(channel: string, data: unknown): void;
}
```

Desktop에서는 Electron IPC, Web에서는 WebSocket으로 구현한다.

**Electron IPC:**

```typescript
const sender: EventSender = {
  send(channel, data) {
    if (!webContents.isDestroyed()) webContents.send(channel, data);
  },
};
```

**WebSocket:**

```typescript
const sender: EventSender = {
  send(channel, data) {
    const msg = JSON.stringify({ channel, data });
    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  },
};
```

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

소스는 `native/` 디렉토리에 포함. 빌드:

```bash
cd native/konomi-image && node-gyp rebuild
cd native/webp-alpha && node-gyp rebuild
```

ScanService에 고속 메타데이터 리더를 주입하는 예시:

```typescript
const scanService = createScanService({
  imageRepo,
  folderRepo,
  sender,
  readMeta: myNativeMetaReader, // native addon 기반 리더
});
```

---

## Project Structure

전체 디렉토리 구조와 각 파일의 상세 역할은 [STRUCTURE.md](./STRUCTURE.md)를 참조.
