# 1단계 구현 및 최신 지시

- 0단계와 1단계 승인 계획은 불변 사본으로 유지한다. 사용자 최신 지시로 신규 원격 저장소가 https://github.com/Jacop7/stocknews 로 확정되어 origin을 연결했다. 읽기 전용 ls-remote 결과 refs 없음, exit 0. push는 아직 하지 않았다.
- 기존 제품의 코드·자원·환경값을 사용하지 않는다. Supabase CLI 버전 확인만 수행하며 프로젝트 생성·연결·DB 시작·Docker 자원 생성은 후속 단계다.
- Node24.15.0, pnpm11.25.0, TypeScript6.0.3, SupabaseCLI3.1.0 설치 완료. 기존 pnpm wrapper의 bundled Node24.22.1은 engineStrict에서 거부되었다. 시스템 Node Corepack + 제품 전용 cache/store로 설치했으며 보안 검증은 해제하지 않았다.
- pnpm-workspace.yaml은 JSON(YAML1.2 부분집합). packageManagerStrict는 실제 pnpm11에서 지원되지 않아 제거하고 packageManager/engines/실제 버전 검사로 고정한다. ignoreScripts=true, 공식 registry, lock integrity를 사용한다.
- S1P-04 대응: docs/stages/** 전부 Git/EditorConfig 변환 제외. 기존 9개 사본은 최초 커밋과 바이트 비교, 신규 1단계 사본은 provenance 해시 비교한다.
- 검증은 현재 절대 productRoot에서 실행한다. 완전한 clone 경로 검증은 2단계 CI 도입 전 작업이며 현재는 snapshot 바이트의 이식성만 보장한다. 앱 빌드나 실 DB 동작을 통과했다고 주장하지 않는다.

## 구현 검수 보완

- S1I-CODEX-01: SUPABASE_CLI_BINARY_OVERRIDE는 빈 값도 포함해 거부한다. 도구 실행 전 모든 의존성 링크의 제품 내부 경계를 확인하며, Supabase JS shim 대신 같은 버전 플랫폼 패키지의 realpath 검증된 실제 바이너리로 --version만 실행한다. 외부 경로와 override 거부를 음성 시험한다.
- S1I-CODEX-02 / S1I-01: Docker/WSL/Android/iOS/Expo/CI/store별 읽기 전용 관측 명령·종료 코드·UTC 시각·관측값·상태·대기 이유·사용자 조작·영향 단계·외부 준비표 id를 기록한다. 실제 확인하지 않은 계정과 빌드는 PENDING으로 유지한다. 관측 필드 누락과 잘못된 준비표 id는 검증에서 실패한다.
- S1I-02: node_modules는 필수이며 아직 없는 선택 cache/store는 명시적으로 건너뛴다. JSON/YAML1.2 부분집합 계약은 현재 유지하고 pnpm의 설정 재작성 명령을 실행할 때 문법 변경 여부를 함께 검토한다. 완전한 CI/clone 이식성은 2단계 게이트다.
