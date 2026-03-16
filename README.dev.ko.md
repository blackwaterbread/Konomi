# Konomi Developer README

Konomi의 메인 [README.md](./README.md)는 일반 사용자를 위한 소개 문서입니다. 이 문서는 개발자와 기여자를 위한 실행 가이드, 구조 설명, 개발 시 주의사항을 정리합니다.

## 개발 환경

- Node.js 22+
- Bun 1.x

설치:

```bash
bun install
```

개발 실행:

```bash
bun run dev
```

기본 빌드:

```bash
bun run build
```

플랫폼별 패키징:

```bash
bun run build:win
bun run build:mac
bun run build:linux
```

## 자주 쓰는 스크립트

```bash
bun run dev
bun run build
bun run lint
bun run typecheck
bun run format
```

Prisma 관련 스크립트:

```bash
bun run db:generate
bun run db:migrate
```

현재 저장소에는 생성된 Prisma client가 포함되어 있고, 앱 런타임에서도 마이그레이션을 적용합니다. 그래서 UI나 Electron 레이어 개발만 할 때는 Prisma 스크립트가 항상 필요한 것은 아닙니다. 다만 내부 스크립트에 `npm run` 체인이 일부 남아 있으므로, 개발 환경에는 Bun과 함께 Node.js 22+도 갖춰 두는 편이 안전합니다. 일상적인 실행은 `bun run ...` 기준으로 보면 됩니다.

## 프로젝트 구조

```text
src/
  main/       Electron main process, IPC, bridge, utility launcher
  preload/    contextBridge API definition
  renderer/   React UI
prisma/
  schema.prisma
```

## 런타임 구조

Konomi는 단일 프로세스 앱처럼 보이지만 내부적으로 역할을 분리해 둔 구조입니다.

- `renderer`
  - React UI
  - 검색, 갤러리, 생성, 설정 화면 관리
  - `localStorage` 기반 UI 상태 저장
- `preload`
  - `window.*` 형태의 타입 있는 bridge API 제공
- `main`
  - Electron 생명주기 관리
  - `konomi://` 로컬 이미지 프로토콜 처리
  - privileged 파일 접근
  - utility process와의 브리지
- `utility`
  - DB 접근
  - 폴더 스캔
  - watcher
  - 중복 처리
  - 유사도 분석
  - NovelAI generation
- `worker threads`
  - PNG 메타데이터 파싱
  - perceptual hash 계산

## 요청과 이벤트 흐름

### 요청 흐름

1. Renderer가 `window.image.listPage(...)` 같은 preload API를 호출합니다.
2. Preload가 `ipcRenderer.invoke(...)`로 main에 요청을 넘깁니다.
3. Main은 직접 처리하거나 `bridge.request(...)`로 utility process에 위임합니다.
4. Utility process가 `handleRequest(...)`에서 실제 도메인 로직을 실행합니다.
5. 결과가 다시 main을 거쳐 renderer로 반환됩니다.

### push 이벤트 흐름

1. Utility process가 `process.parentPort.postMessage(...)`로 이벤트를 보냅니다.
2. Main bridge가 이를 renderer `webContents`로 전달합니다.
3. Preload가 `window.image.onBatch(...)` 같은 구독 API를 노출합니다.
4. Renderer가 진행률, 갤러리 갱신, 중복 다이얼로그, 생성 프리뷰 같은 UI 반응으로 연결합니다.

주요 이벤트:

- `image:batch`
- `image:removed`
- `image:scanProgress`
- `image:scanFolder`
- `image:hashProgress`
- `image:similarityProgress`
- `image:searchStatsProgress`
- `image:watchDuplicate`
- `nai:generatePreview`

## 핵심 개발 포인트

### 1. 갤러리와 스캔

- 관리 대상은 PNG 중심입니다.
- 앱 시작 시 초기 스캔이 돌고, 이후 watcher가 증분 반영합니다.
- 메타데이터는 WebUI/A1111과 NovelAI stealth metadata를 우선적으로 읽습니다.
- 검색 성능을 위해 태그, 모델, 해상도 통계를 별도 캐시합니다.

### 2. PromptInput

- `PromptInput`은 Konomi의 핵심 UX 중 하나입니다.
- 프롬프트를 그대로 두지 않고 `TokenChip` 단위로 다뤄서 편집성과 재사용성을 높입니다.
- 관련 UI는 주로 [prompt-input.tsx](./src/renderer/src/components/prompt-input.tsx)와 [token-chip.tsx](./src/renderer/src/components/token-chip.tsx)에 있습니다.

### 3. 이미지 생성

- NovelAI API Key는 DB에 저장됩니다.
- 생성 파라미터 대부분은 renderer의 `localStorage`에 저장됩니다.
- 기존 이미지 메타데이터 import, reference image, vibe transfer, precise reference를 지원합니다.
- 생성 preview는 push event로 renderer에 스트리밍됩니다.

### 4. 유사도 분석

- 단순 pHash만 쓰지 않고 pHash + 프롬프트 토큰 유사도를 합친 하이브리드 방식입니다.
- 분석은 스캔이 idle 상태일 때 deferred 실행됩니다.
- threshold 변경 시 재계산이 필요할 수 있습니다.

## 핵심 워크플로

### 1. 앱 시작

- `app.whenReady()`에서 IPC와 utility bridge를 초기화합니다.
- Main이 `konomi://local/...` 프로토콜을 등록합니다.
- Utility는 기본 카테고리를 seed하고, 지연된 prompt token backfill 작업을 예약합니다.
- Renderer는 카테고리와 검색 preset 통계를 불러옵니다.
- 초기 전체 스캔과 watcher 시작 이후, idle 상태에서 유사도 분석이 이어집니다.

### 2. 폴더 추가와 중복 해결

- 폴더 등록은 바로 DB에 넣지 않고 먼저 중복 후보를 검사합니다.
- Renderer는 `window.folder.findDuplicates(path)`로 사전 검사 후, 필요한 경우 중복 해결 다이얼로그를 엽니다.
- 사용자가 기존 파일 유지, 새 파일 유지, 무시 중 하나를 결정한 뒤에 실제 `Folder` row 생성과 스캔이 진행됩니다.
- watcher가 발견한 중복도 같은 다이얼로그 흐름을 재사용합니다.

### 3. 스캔과 메타데이터 반영

- 스캔 대상은 PNG만입니다.
- `readImageMeta(...)`는 WebUI/A1111 메타데이터를 먼저 보고, 그 다음 NovelAI stealth metadata를 확인합니다.
- 변경되지 않은 파일은 `fileModifiedAt` 기준으로 건너뜁니다.
- 새 파일은 worker thread에서 메타데이터를 읽은 뒤 배치 upsert 됩니다.
- 검색용 통계와 유사도 캐시는 가능한 범위에서 증분 갱신됩니다.
- 스캔 취소는 shared cancel token으로 처리됩니다.

### 4. watcher 동작

- 폴더별 `fs.watch(..., { recursive: true })`를 사용합니다.
- 파일 이벤트는 500ms 디바운스 후 처리합니다.
- 파일명이 비어 있거나 경로 casing이 어긋나는 경우 전체 폴더 재조정을 fallback으로 사용합니다.
- watcher는 exact duplicate를 먼저 감지한 뒤 바로 import하지 않고 사용자 결정을 기다립니다.

### 5. 이미지 생성

- 생성 요청은 renderer에서 utility로 전달됩니다.
- Utility는 NovelAI SDK 요청을 patch해서 seed, negative prompt, V4 character 관련 payload를 보정합니다.
- 중간 preview는 `nai:generatePreview` 이벤트로 renderer에 전달됩니다.
- 최종 결과 이미지는 output folder에 저장되고, main이 transient path로 등록한 뒤 `konomi://local/...`로 미리보기합니다.

## 데이터 저장 위치

- SQLite DB: `{userData}/konomi.db`
- 창 크기 정보: `{userData}/window-bounds.json`
- renderer 상태: `localStorage`

Prisma schema는 [schema.prisma](./prisma/schema.prisma)에 있습니다.

주요 모델:

- `Folder`
- `Image`
- `Category`
- `ImageCategory`
- `PromptCategory`
- `PromptGroup`
- `PromptToken`
- `NaiConfig`
- `IgnoredDuplicatePath`
- `ImageSearchStat`
- `ImageSimilarityCache`

중요한 파생/캐시 데이터:

- `Image.promptTokens`, `negativePromptTokens`, `characterPromptTokens`는 JSON 문자열로 저장됩니다.
- `fileSize`는 exact duplicate 검사 비용을 줄이기 위해 저장됩니다.
- `ImageSearchStat`은 검색 시 매번 풀스캔하지 않도록 증분 유지됩니다.
- `ImageSimilarityCache`는 변경된 이미지 위주로 부분 갱신됩니다.

## 보안과 파일 접근

- privileged 파일 접근은 renderer가 아니라 main에서 처리하는 것을 기본으로 합니다.
- `konomi://`는 아무 로컬 파일이나 여는 프로토콜이 아니라, 관리 중인 루트 경로와 transient allowlist만 허용합니다.
- 관련 제약은 [path-guard.ts](./src/main/lib/path-guard.ts)에서 관리됩니다.
- `image:readFile`, `image:delete`, `image:revealInExplorer`, protocol serve 같은 경로 접근은 모두 검증 후 실행됩니다.
- generated file은 일시적으로만 허용 경로로 등록됩니다.

## 개발 시 참고 파일

- 앱 진입점: [index.ts](./src/main/index.ts)
- IPC 등록: [ipc.ts](./src/main/ipc.ts)
- utility 진입점: [utility.ts](./src/main/utility.ts)
- DB 초기화: [db.ts](./src/main/lib/db.ts)
- 이미지 스캔/검색: [image.ts](./src/main/lib/image.ts)
- watcher: [watcher.ts](./src/main/lib/watcher.ts)
- 유사도 분석: [phash.ts](./src/main/lib/phash.ts)
- NovelAI generation: [nai-gen.ts](./src/main/lib/nai-gen.ts)
- 메인 UI: [App.tsx](./src/renderer/src/App.tsx)

## 패키징 메모

- `electron-builder.yml`에서 패키징 설정을 관리합니다.
- `better-sqlite3`, Prisma 관련 패키지는 외부화되어 있습니다.
- build entry는 `electron.vite.config.ts`에서 관리합니다.
- utility process와 worker 파일도 번들 entry에 포함됩니다.
- utility startup은 `KONOMI_USER_DATA`와 `KONOMI_MIGRATIONS_PATH` 환경 변수에 의존합니다.

## 구현 메모와 함정

- `readImageMeta(...)`는 WebUI 메타데이터를 NovelAI보다 먼저 검사합니다. 비용이 더 낮기 때문입니다.
- utility process에서는 `electron.app`를 직접 사용할 수 없습니다. 필요한 값은 환경 변수로 전달해야 합니다.
- CSS 이미지 URL은 인코딩된 `)` 문자 이슈 때문에 `url('${src}')` 형태로 감싸는 편이 안전합니다.
- 창 크기와 resizable panel 크기는 close, mouseup, `beforeunload` 시점에 저장됩니다.

## 작업할 때 주의할 점

- privileged 파일 접근은 가능하면 renderer가 아니라 main에서 처리합니다.
- 새 기능이 IPC를 넘나들면 보통 다음 순서가 필요합니다.

```text
preload 타입/함수 추가
-> main IPC 등록
-> utility request routing
-> 실제 도메인 로직 구현
-> renderer 사용처 연결
```

- `konomi://` 프로토콜을 쓰는 로컬 이미지 접근은 path guard 제약을 따릅니다.
- utility process에서는 `electron.app`를 직접 쓰지 않고 환경 변수 기반으로 동작해야 합니다.

## 확장 가이드

새 IPC capability를 추가할 때는 보통 아래 순서를 따릅니다.

1. [index.ts](./src/preload/index.ts)에 preload surface를 추가합니다.
2. [index.d.ts](./src/preload/index.d.ts)에 타입을 추가합니다.
3. [ipc.ts](./src/main/ipc.ts)에 IPC handler를 등록합니다.
4. utility 소관이면 [utility.ts](./src/main/utility.ts)에 request routing을 추가합니다.
5. 적절한 `src/main/lib/*` 모듈에 실제 도메인 로직을 구현합니다.

검색/필터 차원을 추가할 때는 보통 아래가 같이 움직입니다.

1. preload와 utility 사이의 query type 확장
2. `image:listPage` 계열 routing 반영
3. [image.ts](./src/main/lib/image.ts) 쿼리 조건 추가
4. [App.tsx](./src/renderer/src/App.tsx), [header.tsx](./src/renderer/src/components/header.tsx), [advanced-search-modal.tsx](./src/renderer/src/components/advanced-search-modal.tsx) 같은 UI 반영
5. 필요하면 `ImageSearchStat` 증분 유지 로직도 확장

## 문서

- 사용자 문서: [README.md](./README.md)
