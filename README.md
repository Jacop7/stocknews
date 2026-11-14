# 주도주뉴스

Android·iOS 주식 뉴스 앱, 어드민, 신규 Supabase, 독립 Docker worker를 만드는 **신규 프로젝트**입니다.
식자재 관리앱 코드·설정·저장소·DB·인증·키·컨테이너·배포를 사용하지 않습니다.

0~2단계 검수와 커밋을 마쳤고, 3단계 등록·정책 구현은 검수됐으나 실제 공급은 대기 중입니다. 현재 4단계 신규 로컬 Supabase·공통 작업 큐·Docker 모의 worker를 구현·검증하고 있습니다. 앱/어드민 화면은 개발 샘플이며 운영 데이터는 미연결입니다.
실제 자원 상태는 [자원 목록](docs/project-resource-manifest.json), 외부 준비는 [준비표](docs/external-preparation.json)를 봅니다.
실제·대기 상태는 [개발 상태](docs/development-status.json)에 있습니다. 검수/커밋 영수증은 제품 밖 `../outputs/development-stages/reviews/`에 보존합니다.

## 단계 흐름

계획 작성 → Claude·Codex 검수 → 구현·자체 시험 → Claude·Codex 재검수 → 같은 파일로 커밋 → 다음 단계.
권위 자료는 [기획 스냅샷](docs/reference/planning/)과 [0단계 계획](docs/stages/stage-00-plan.md)입니다.

## 검사

```sh
corepack pnpm verify
```

전체 검사는 저장소·의존성·native 입력 계약·domain 시험·타입·어드민 빌드·Expo Android/iOS Hermes export를 실행합니다. DB/Docker 자원에 연결하지 않습니다. native 빌드/기기 실행 및 실제 원격 CI 성공은 별도 게이트입니다. 의존성 설치는 공식 npm registry에서 수행합니다.
실제 로컬 DB/Docker 시험은 별도 `corepack pnpm test:m0-runtime`이며, [4단계 실행 범위와 한계](docs/stage04-local-runtime.md)를 먼저 확인합니다. 새 합성 fixture와 자기 worker만 사용하며 운영/실수집 성공을 뜻하지 않습니다.
기획 검사는 사본과 저장소 안 provenance의 해시를 비교해 다른 위치로 clone해도 원본 폴더가 필요 없습니다.
최초 원본/사본 비교 결과는 저장소 밖 영수증으로 보존합니다.

사용자가 지정한 origin은 https://github.com/Jacop7/stocknews.git 입니다. 아직 push하지 않았습니다. 커밋은 검수 후 `Judoju News Automation <automation@judoju.invalid>`라는 자동화 작성자로 만들며 사용자 신원이나 전역 Git 설정을 바꾸지 않습니다.
도구는 Node24.15.0·pnpm11.25.0·앱 TypeScript6.0.3·SupabaseCLI3.1.0으로 고정합니다. EAS CLI27.9.0의 TypeScript5 peer 환경은 packages/build-tools로 분리했고 앱 컴파일은6.0.3입니다. pnpm-workspace.yaml은 JSON 형식(YAML1.2 부분집합)입니다. CI 정의는 있지만 실제 원격 실행은 아직 없습니다.

현재 Windows 호스트의 pnpm.cmd는 별도 Node를 사용하므로 시스템 Node24.15.0의 Corepack을 사용합니다. PowerShell에서 `$env:COREPACK_HOME = "$PWD/.local-tools/corepack"` 설정 후 위 명령을 실행합니다.

개발 실행은 `corepack pnpm dev:admin`(127.0.0.1:3100), `corepack pnpm dev:mobile`입니다. 브라우저 개발 확인은 `corepack pnpm --filter @judoju/mobile exec expo start --web --host localhost --port 8084`로 실행합니다. Expo Go/웹 번들을 native SDK 호환 확인으로 대체하지 않습니다.

환경은 local/preview/production으로 분리합니다. 사용자 PC의 Docker는 개발·시험 전용이며 운영 수집은 클라우드에서 실행할 계획입니다. Supabase의 짧은 함수와 외부 worker 분담은 공급 시험 후 확정합니다. [호환 정책](docs/compatibility-policy.md)과 [구현 상태](docs/stage-02-implementation-notes.md)를 참고하세요.
