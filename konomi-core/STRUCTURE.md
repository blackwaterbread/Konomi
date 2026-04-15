# @konomi/core

Desktop과 Web backend에서 공통으로 사용되는 Node.js 코어 라이브러리.

## 디렉토리 구조

```
konomi-core/
├── package.json
├── tsconfig.json
├── index.ts              # barrel export (public API)
├── types/
│   ├── image-meta.ts     # ImageMeta 타입
│   ├── image-query.ts    # ImageListQuery, ImageListResult 등
│   ├── repository.ts     # Entity 타입 (FolderEntity, ImageEntity 등) + 데이터 shape
│   └── event-sender.ts   # 통신 계약 (EventSender, KonomiEventMap)
├── lib/
│   ├── logger.ts         # 로거
│   ├── token.ts          # 프롬프트 토큰 파서
│   ├── scanner.ts        # 파일 스캐너 + withConcurrency
│   ├── png-meta.ts       # PNG 청크 파서
│   ├── image-meta.ts     # 메타데이터 디스패처
│   ├── nai.ts            # NAI 파서 (tEXt + native LSB + WebP alpha)
│   ├── webui.ts          # WebUI 파서
│   ├── midjourney.ts     # Midjourney 파서
│   ├── comfyui.ts        # ComfyUI 파서
│   ├── similarity.ts     # 순수 유사도 알고리즘 (hamming, Jaccard, hybrid)
│   ├── search-stats.ts   # 검색 통계 순수 로직
│   ├── worker-pool.ts    # 제네릭 WorkerPool<T> (lazy/eager, idle timeout)
│   ├── konomi-image.ts   # Native addon wrapper (pHash, LSB, resize)
│   ├── webp-alpha.ts     # Native addon wrapper (WebP decode, resize)
│   ├── db.ts             # Prisma client singleton + custom migration runner
│   ├── prompts-db.ts     # 번들 prompt-tag suggestion DB 접근
│   ├── image-infra.ts    # WorkerPool 기반 메타 리더, 파일 해싱, ignored duplicate 관리
│   ├── search-stats-store.ts  # ImageSearchStat 테이블 CRUD (raw SQL)
│   ├── phash.ts          # pHash 계산 오케스트레이션, similarity cache DDL/CRUD
│   ├── nai.worker.ts     # Worker Thread: readImageMeta
│   ├── phash.worker.ts   # Worker Thread: computePHash
│   └── repositories/
│       ├── prisma-folder-repo.ts    # FolderRepo
│       ├── prisma-image-repo.ts     # ImageRepo (830줄 — 쿼리 빌더 포함)
│       ├── prisma-category-repo.ts  # CategoryRepo
│       ├── prisma-prompt-repo.ts    # PromptRepo
│       └── prisma-nai-config-repo.ts # NaiConfigRepo
└── services/
    ├── scan-service.ts       # 폴더 스캔 오케스트레이션
    ├── folder-service.ts     # 폴더 CRUD + 경로 정규화
    ├── category-service.ts   # 카테고리 CRUD + builtin 시딩
    ├── watch-service.ts      # 실시간 파일 감시
    ├── image-service.ts      # 이미지 목록/리스캔
    ├── duplicate-service.ts  # SHA-1 중복 감지
    ├── similarity-service.ts # union-find 클러스터링, 유사 이미지 그룹
    ├── prompt-builder-service.ts  # 프롬프트 그룹/토큰 CRUD
    ├── prompt-tag-service.ts      # 프롬프트 태그 자동완성
    └── nai-gen-service.ts         # NAI API 생성
```

## DB 레이어

Prisma를 직접 사용. Repository 인터페이스 없이 concrete 타입으로 서비스에 주입.

```typescript
// repo 생성
const folderRepo = createPrismaFolderRepo(getDB);
const imageRepo = createPrismaImageRepo(getDB);

// 서비스에 주입 — 타입은 ReturnType<typeof createPrismaXxxRepo>
const folderService = createFolderService({ folderRepo, imageRepo });
```

타입 export:
- `FolderRepo` — `ReturnType<typeof createPrismaFolderRepo>`
- `ImageRepo` — `ReturnType<typeof createPrismaImageRepo>`
- `CategoryRepo` — `ReturnType<typeof createPrismaCategoryRepo>`
- `NaiConfigRepo` — `ReturnType<typeof createPrismaNaiConfigRepo>`
- `PromptRepo` — `ReturnType<typeof createPrismaPromptRepo>`

Entity 타입(`FolderEntity`, `ImageEntity` 등)과 데이터 shape(`ImageUpsertData`, `SearchStatSource` 등)은 `types/repository.ts`에 정의.

## EventSender (통신 계약)

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

## Native Addon

C++ 소스는 `src/native/` 디렉토리에 위치. 빌드 산출물은 `prebuilds/{platform}-{arch}/`에 배치.
JS wrapper(`konomi-image.ts`, `webp-alpha.ts`)는 `prebuilds/`에서 `.node` 파일을 로드.

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
| WebP 알파 채널 디코드 | `decodeWebpAlpha(buf)` |
| WebP RGB 디코드 | `decodeWebpRgb(buf)` |
| WebP 리사이즈 | `resizeWebp(buf, maxWidth)` |

core 라이브러리는 native addon **없이** 동작한다. `nai.ts`의 PNG LSB 추출은 순수 JS fallback 있음. WebP 스테가노그래피는 native 없이 불가 (null 반환).
