# @konomi/core

Desktop과 Web backend에서 공통으로 사용되는 순수 Node.js 라이브러리.

## 디렉토리 구조

```
src/core/
├── package.json
├── tsconfig.json
├── index.ts              # barrel export (public API)
├── types/
│   ├── image-meta.ts     # ImageMeta 타입
│   ├── repository.ts     # DB 계약 (FolderRepository, ImageRepository, CategoryRepository)
│   └── event-sender.ts   # 통신 계약 (EventSender, KonomiEventMap)
├── lib/
│   ├── logger.ts         # 로거
│   ├── token.ts          # 프롬프트 토큰 파서
│   ├── scanner.ts        # 파일 스캐너 + withConcurrency
│   ├── png-meta.ts       # PNG 청크 파서
│   ├── image-meta.ts     # 메타데이터 디스패처
│   ├── nai.ts            # NAI 파서 (순수 JS LSB fallback)
│   ├── webui.ts          # WebUI 파서
│   ├── midjourney.ts     # Midjourney 파서
│   └── comfyui.ts        # ComfyUI 파서
├── services/
│   ├── scan-service.ts   # 폴더 스캔 오케스트레이션 (delta 감지, 배치 upsert, stale 정리)
│   ├── folder-service.ts # 폴더 CRUD + 경로 정규화/중복 검사
│   ├── category-service.ts # 카테고리 CRUD + builtin 시딩
│   └── watch-service.ts  # 실시간 파일 감시 (debounce, scan 중 큐잉)
└── native/
    ├── konomi-image/     # pHash, NAI LSB 고속 추출, 유사도 계산, 이미지 리사이즈
    └── webp-alpha/       # WebP 알파/RGB 디코드, 리사이즈
```

## Native Addon

`native/` 디렉토리에는 C++ 소스와 `binding.gyp` 빌드 설정만 포함.
빌드 산출물(`.node`, `build/`)은 포함하지 않으며, 소비하는 쪽에서 `node-gyp rebuild`로 빌드해야 한다.

### konomi-image

| 기능 | 함수 |
|---|---|
| pHash 계산 | `computePHash(buf)` |
| NAI LSB 고속 추출 | `extractNaiLsb(buf)` |
| 유사도 쌍 계산 | `computeAllPairs(input)` |
| PNG 리사이즈 | `resizePng(buf, maxWidth)` |

### webp-alpha

| 기능 | 함수 |
|---|---|
| WebP 알파 채널 디코드 | `decodeAlpha(buf)` |
| WebP RGB 디코드 | `decodeRgb(buf)` |
| WebP 리사이즈 | `resizeWebp(buf, maxWidth)` |

### core에서의 native addon 정책

- core 라이브러리 자체는 native addon **없이** 동작한다.
- `nai.ts`의 PNG LSB 추출은 순수 JS fallback으로 동작. WebP 스테가노그래피는 native 없이 불가 (stub 반환).
- 소비하는 쪽이 고속 처리나 WebP 지원이 필요하면 native addon을 빌드한 뒤 직접 연결한다.

## Interface 계약

소비하는 쪽(Desktop, Web)이 반드시 구현해야 하는 인터페이스.

### Repository (DB 레이어)

`types/repository.ts`에 정의. DB 기술에 무관한 추상 계약.

```typescript
FolderRepository    // findAll, findById, create, delete, rename
ImageRepository     // findById, findByPath, findSyncRowsByFolderId, upsertBatch, upsertByPath,
                    // deleteByIds, deleteByPath, countByFolderId, existsByPath, updateFolderScanMeta
CategoryRepository  // findAll, findById, create, delete, rename, updateColor,
                    // addImage, removeImage, addImages, removeImages, getImageIds,
                    // getCategoriesForImage, seedBuiltins
```

- `ImageUpsertData` — 이미지 저장 시 flat DB row shape (메타데이터 + 파일 정보)
- `ImageSyncRow` — 스캔 시 delta 비교용 경량 프로젝션 (id, path, mtime, source)
- Entity 타입(`FolderEntity`, `ImageEntity`, `CategoryEntity`) — DB row의 공통 shape

### EventSender (통신 레이어)

`types/event-sender.ts`에 정의. 실시간 이벤트 푸시 추상 계약.

```typescript
EventSender {
  send(channel: string, data: unknown): void;
}
```

| 구현 환경 | 매핑 |
|---|---|
| Desktop (Electron) | `webContents.send(channel, data)` |
| Web (Fastify + WS) | WebSocket broadcast |

`KonomiEventMap` — 채널별 페이로드 타입:

| 채널 | 페이로드 | 설명 |
|---|---|---|
| `image:batch` | `ImageBatchEvent` | 스캔/워치 이미지 업데이트 |
| `image:removed` | `ImageRemovedEvent` | 이미지 삭제 |
| `image:scanProgress` | `ScanProgressEvent` | 스캔 진행률 |
| `image:scanFolder` | `ScanFolderEvent` | 폴더별 스캔 상태 |

## 서비스 레이어

`services/` 디렉토리의 서비스들은 **DI(의존성 주입)** 패턴으로 설계.
Repository(DB)와 EventSender(통신)를 주입받아 동일한 비즈니스 로직을 Desktop/Web 양쪽에서 재사용.

### ScanService (`scan-service.ts`)

폴더 스캔 오케스트레이션. Desktop의 `syncAllFolders`에 해당.

- delta 감지: 기존 이미지의 mtime 비교로 변경분만 처리
- 배치 upsert: `BATCH_SIZE`(50)개 단위로 DB 일괄 저장
- stale 정리: 디스크에서 삭제된 파일의 DB row 자동 제거
- `readMeta` 주입 가능: native addon 사용 시 고속 메타데이터 리더 교체 가능

### FolderService (`folder-service.ts`)

폴더 CRUD + 경로 정규화. 중복 경로 등록 방지.

### CategoryService (`category-service.ts`)

카테고리 CRUD. builtin 카테고리 시딩 포함.

### WatchService (`watch-service.ts`)

실시간 파일 감시. Desktop의 `FolderWatcher`에 해당.

- `fs.watch({ recursive: true })` + 500ms debounce
- `setScanActive(true/false)`: 스캔 중 변경 감지를 큐잉, 스캔 종료 후 일괄 처리
- 파일 추가/수정 → upsert + `image:batch` 이벤트
- 파일 삭제 → DB 삭제 + `image:removed` 이벤트

## 사용 예제

### 서비스 생성 (공통 패턴)

```typescript
import {
  createScanService,
  createFolderService,
  createCategoryService,
  createWatchService,
} from "@konomi/core";

// 1. Repository 구현체 준비 (DB별로 다름)
const folderRepo = createPrismaFolderRepo(prisma);
const imageRepo = createPrismaImageRepo(prisma);
const categoryRepo = createPrismaCategoryRepo(prisma);

// 2. EventSender 구현체 준비 (환경별로 다름)
const sender = createWsSender(wsClients); // Web
// const sender = createIpcSender(webContents); // Desktop

// 3. 서비스 생성 — 동일한 비즈니스 로직
const scanService = createScanService({ imageRepo, folderRepo, sender });
const folderService = createFolderService({ folderRepo });
const categoryService = createCategoryService({ categoryRepo });
const watchService = createWatchService({ imageRepo, folderRepo, sender });
```

### 메타데이터 파싱

```typescript
import { readImageMeta, readImageMetaFromBuffer } from "@konomi/core";
import fs from "fs";

// 파일 경로로 직접 읽기
const meta = readImageMeta("/path/to/image.png");
if (meta) {
  console.log(meta.source);  // "nai" | "webui" | "midjourney" | "comfyui" | "unknown"
  console.log(meta.prompt);
  console.log(meta.model);
  console.log(meta.seed);
}

// 버퍼로 읽기 (업로드된 파일 등)
const buf = fs.readFileSync("/path/to/image.png");
const meta2 = readImageMetaFromBuffer(buf);
```

### 프롬프트 토큰 파싱

```typescript
import { parsePromptTokens } from "@konomi/core";

const tokens = parsePromptTokens("{masterpiece}, best quality, 1girl");
// [
//   { text: "masterpiece", weight: 1.05 },
//   { text: "best quality", weight: 1.0 },
//   { text: "1girl", weight: 1.0 },
// ]
```

### 파일 스캐너

```typescript
import { scanImageFiles, walkImageFiles, withConcurrency } from "@konomi/core";
import type { CancelToken } from "@konomi/core";

// 전체 스캔
const files = await scanImageFiles("/path/to/folder");

// 취소 가능한 스캔
const cancel: CancelToken = { cancelled: false };
setTimeout(() => { cancel.cancelled = true; }, 5000);
const files2 = await scanImageFiles("/path/to/folder", cancel);

// 스트리밍 + 동시성 제어
await withConcurrency(
  walkImageFiles("/path/to/folder"),
  4, // 동시 처리 수
  async (filePath) => {
    const meta = readImageMeta(filePath);
    // ... DB 저장 등
  },
);
```

### Repository 구현 (Prisma + MySQL 예시)

```typescript
import type { FolderRepository, FolderEntity } from "@konomi/core";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const folderRepo: FolderRepository = {
  async findAll() {
    return prisma.folder.findMany({ orderBy: { createdAt: "asc" } });
  },
  async findById(id) {
    return prisma.folder.findUnique({ where: { id } });
  },
  async create(name, path) {
    return prisma.folder.create({ data: { name, path } });
  },
  async delete(id) {
    await prisma.folder.delete({ where: { id } });
  },
  async rename(id, name) {
    return prisma.folder.update({ where: { id }, data: { name } });
  },
};
```

### EventSender 구현 (Fastify + WebSocket 예시)

```typescript
import type { EventSender } from "@konomi/core";
import type { WebSocket } from "ws";

function createWsSender(clients: Set<WebSocket>): EventSender {
  return {
    send(channel, data) {
      const message = JSON.stringify({ channel, data });
      for (const ws of clients) {
        if (ws.readyState === ws.OPEN) {
          ws.send(message);
        }
      }
    },
  };
}
```

### EventSender 구현 (Electron IPC 예시)

```typescript
import type { EventSender } from "@konomi/core";
import type { WebContents } from "electron";

function createIpcSender(webContents: WebContents): EventSender {
  return {
    send(channel, data) {
      if (!webContents.isDestroyed()) {
        webContents.send(channel, data);
      }
    },
  };
}
```

### 스캔 실행

```typescript
// 전체 폴더 스캔
await scanService.scanAll();

// 특정 폴더만 스캔
await scanService.scanOne(folderId);

// 취소 가능한 스캔
const signal: CancelToken = { cancelled: false };
await scanService.scanAll({ signal });
// signal.cancelled = true; 로 취소
```

### 실시간 파일 감시

```typescript
// 전체 폴더 감시 시작
await watchService.startAll();

// 스캔 중 변경 이벤트 큐잉
watchService.setScanActive(true);
await scanService.scanAll();
watchService.setScanActive(false); // 큐잉된 변경 일괄 처리

// 새 폴더 추가 시 감시 등록
const folder = await folderService.create("My Images", "/path/to/images");
watchService.watchFolder(folder.id, folder.path);

// 폴더 삭제 시 감시 해제
watchService.stopFolder(folderId);

// 전체 감시 중지
watchService.stopAll();
```
