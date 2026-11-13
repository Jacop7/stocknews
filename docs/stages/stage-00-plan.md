# 주도주뉴스 0단계 — 독립 저장소와 실행 기준

2026.11.13 · 구현 전 계획 · 자동 진행의 첫 단계

## 목표와 권위

주도주뉴스를 완전히 새로운 제품으로 만든다. 제품 루트는 `C:/Users/jacop/주식/judoju-news`이며 현재 아직 없다. 식자재 관리앱의 코드·저장소·Git 이력·Supabase/DB/인증/키·Docker worker/큐/컨테이너/volume·배포 설정은 가져오거나 연결하지 않는다. 공용 설치 도구만 사용할 수 있다.

권위는 `../plan-unified-20261113/공통-운영계약-v1.0.md`의 project-isolation과 제작 실행계획 v1.3의 new-project·0~12단계다. 제품 기획/시트/시안은 요구 자료이며 식자재 앱은 입력 자료가 아니다. 계획 검수는 실제 코드 동작 검수와 구분한다.

## 단계마다 반복할 흐름

1. 해당 단계 계획에 범위·산출물·선행조건·검사·중단 조건을 적는다.
2. 실제 Claude 브라우저와 독립 Codex Ultra가 계획을 검수한다. 필수 지적을 반영해 현재 판본의 검수를 통과한 뒤 구현한다.
3. 검수된 범위만 구현하고 정적 검사·필요한 동작 시험을 실행한다.
4. 구현 결과를 Claude·Codex가 다시 검수한다. 수정하면 영향 시험과 재검수를 거친다.
5. 현재 판본의 검증·커밋·남은 제한을 기록하고 다음 단계 계획으로 진행한다. 초안·구조 PASS·리뷰 READY를 앱/DB 실운영 성공으로 대신하지 않는다.

사용자의 계속 진행 지시에 따라 단계 사이마다 다시 승인을 요구하지 않는다. 계정 로그인/인증·약관 수락·비용 지출·접근 권한 확대처럼 별도 사용자 조작이나 승인이 실제 필요한 작업만 구체적인 대상을 준비한 뒤 요청한다. 외부 의존성이 대기해도 허용된 로컬 작업은 계속한다. 이 절은 기존 검수 서비스의 역할·모델·회차 상한을 변경하지 않는다.

## 이번 단계 구현 범위

| 순서 | 산출물 | 구현 기준 |
| --- | --- | --- |
| 0-1 | 새 제품 폴더·Git main | 생성 전 상위 경로의 git rev-parse를 읽기 전용 검사해 작업트리 밖임을 확인한 뒤, 새 경로가 없음을 재확인하고 생성. 상위가 작업트리이거나 경로가 이미 있으면 자동 초기화/덮어쓰기 없이 중단. 새 Git 이력이며 remote는 PENDING |
| 0-2 | README·AGENTS.md | 제품 경계·경로·단계 흐름·현재 미구현 상태·다음 작업. 이번 제품만의 지침이며 기존 식자재 파일을 읽거나 복제하지 않음 |
| 0-3 | .gitignore·.gitattributes·.editorconfig | 실제 환경파일/키/인증자료/노드의존성/빌드/로컬 DB 상태 제외. .env.example은 허용. UTF-8/LF 기준 |
| 0-4 | docs/project-resource-manifest.json | root/Git 확인값과 신규 생성할 Expo/EAS·검증/운영 Supabase·로컬 Supabase·Docker worker/큐·배포·푸시/광고·로그/백업을 분리해 상태 기록. 미생성은 PENDING/null로 표시, 실제 연결값을 지어내지 않음 |
| 0-5 | docs/development-status.json·단계 계획·기획 복사본 | 구현 검수 전 고정된 상태(0단계 IMPLEMENTED_REVIEW_PENDING,1~12 미착수),원본 기획 경로/해시를 기록. MD7개(공통·서비스·어드민·제작·상세로직·매체부록·변경대응표)와 bundle-manifest.json만 docs/reference/planning/에 원본 바이트로 복사. 이 계획은 docs/stages/stage-00-plan.md로 복사. 대상 목록과 원본 경로/사본 상대경로/bytes/SHA-256을 docs/reference/provenance.json에 기록. HTML은 구현 입력으로 복사하지 않음 |
| 0-6 | scripts/verify-foundation.mjs | Node 내장 모듈만 사용하며 package.json/lock/외부 의존성 설치 없음. 저장소 root·branch·remote·외부 경로 연결 없음,필수파일·PENDING/null의 일치·민감파일 ignore·기획 해시·외부 준비표를 검증. endpoint 접속/DB mutation 기능은 없음 |
| 0-7 | docs/external-preparation.json | 스토어 계정 유형,Apple/Google 개발자 등록,시험 기기/테스터,시세/뉴스 공급 허가,호스팅 계정/리전,개인정보 초안의 담당 역할·관련 단계·필요 사용자 조작/비용·대기 사유·예상 시점·상태를 기록. 미확인은 PENDING/null이며 실제 신청/생성/외부 문의는 이번 단계에서 실행하지 않음 |

이 단계에는 패키지 설치·Expo/어드민/worker 실행·Supabase 프로젝트 생성·Docker 기동·실DB migration·클라우드 remote 생성·푸시·뉴스 수집·AI API 호출이 없다. 이후 단계에서 각각 새로 구축한다. 설치된 Git/Node/pnpm/Docker의 읽기 전용 버전 확인은 허용한다.

## 시작 전 확인한 환경

읽기 전용 확인: Git 2.54.0.windows.1, Node v24.15.0, npm11.12.1, pnpm11.25.0, Docker server29.8.0. Supabase/EAS 전역 명령은 발견하지 못했다. 이는 향후 SDK 호환 시험·클라우드 인증·Android/iOS 빌드 통과를 뜻하지 않는다. 필요한 도구/SDK는1단계에서 공식 자료와 registry를 확인해 제품 범위에 버전을 고정한다.

상위 폴더에는 문서용 봉인 모델 계획이 있으며 제품 구현을 포함하는 새 판본으로 보존 갱신한다. 역할은 작성 gpt-6.1-sol/high, 검수 gpt-6-astra/ultra와 지정 Claude Opus5.5/medium을 유지한다. 원시 대화·비밀정보를 프로젝트에 복사하지 않는다.

## 인수 기준

- `git rev-parse --show-toplevel`이 정확한 제품 루트이고 main에서 시작하며 remote가 비어 있다. 새 저장소에 다른 프로젝트 이력·submodule·symlink/junction이 없다.
- 상위 경로가 Git 작업트리 밖이라는 실행 증거가 있어야 한다. 경로 비교는 실경로를 확인한 뒤 구분자를 통일하고 Windows 드라이브/경로 대소문자를 정규화한다. Git 출력은 UTF-8로 읽고 core.quotepath=false를 명령 범위에 적용한다. 슬래시/역슬래시·대소문자·한글 경로의 같은 경로와 다른 경로 판별을 시험한다.
- README와 상태 파일은 앱·DB·worker 미구축을 정확히 표시한다. Supabase/Docker/EAS 자원은 새로 만들 대상으로 PENDING이며 연결 명령은 실행되지 않는다.
- 검사기는 정상 구조에 PASS하며, 시험용 메모리 데이터에 연결 대상을 넣고 상태를 PENDING으로 유지한 모순·다른 root·고정된 잘못된 제품 식별자를 거부한다. 사용자 파일을 시험 목적으로 변조하지 않는다.
- `.env`, `.env.local`, secret/certificate·로컬 DB/빌드 파일이 Git 추적 후보에 들어오지 않고 `.env.example`은 추적 가능하다. 기획 복사본의 원본/사본 SHA-256을 대조한다.
- 외부 준비표의 필수 항목과 상태·담당/관련 단계·사용자 조작/비용·예상 시점 필드가 모두 있어야 한다. 미확인을 완료로 표시하지 않는다. 준비표 PENDING은 로컬 구현을 막지 않으며 해당 외부 의존 단계에서는 별도 게이트로 확인한다.
- 계획 검수와 구현 검수 원문·manifest·실제 검사 출력·커밋의 완료 영수증은 상위 outputs/development-stages/reviews/에 보존하고 제품 파일은 검수 후 변경하지 않는다. 제품 status에는 이 정해진 외부 기록 위치와 구현 검수 전 상태만 적는다. 현재 바이트 검수 통과 후 그대로 최초 main 커밋을 만들고, 커밋 트리/검수 manifest 일치 증거도 바깥 영수증에 추가한다. 다음 단계가 정식으로 status를 변경할 때 그 변경도 새 검수 대상이다. 클라우드 자원 PENDING은 0단계 로컬 기반 완료를 막지 않지만 해당 연결/배포 단계에서는 미합격이다.

## 변경·복구 경계와 다음 단계

새 제품 루트 밖의 제품 코드/설정·기존 Docker/DB/앱은 변경하지 않는다. 검수·계획/기록은 상위 outputs와 .codex에 보존할 수 있다. 실패 시 새 제품의 feature 브랜치에서 수정하고 기존 앱을 중지/삭제하거나 포트를 빼앗지 않는다. 외부 remote는 사용 가능한 호스팅 계정과 비공개 저장소 대상이 확인되기 전 PENDING으로 둔다.

0단계 검수 후 최초 main 커밋을 만들고,1단계는 도구/패키지 매니저 버전·workspace/CI 기반 계획부터 시작한다.2단계는 Expo/어드민·공통 계약/clock 골격과 양 플랫폼 초기 빌드,3단계는 공급·권한 시험,4단계는 신규 DB·권한·worker/큐 기반이다. 순서와 게이트는 기존 제작계획을 유지한다.

공식 참고: [Expo 프로젝트 생성](https://docs.expo.dev/get-started/create-a-project/), [Supabase 로컬 개발](https://supabase.com/docs/guides/local-development/cli/getting-started), [pnpm workspace](https://pnpm.io/workspaces). 버전은 실제 설치 단계에서 재확인한다.

## 구현 전 검수 보완

- S0P-01/ST00-CODEX-02: 외부 준비표를0-7 산출물과 필수 검사에 추가. 미확인은 PENDING이며 신청을 실행했다는 뜻이 아님.
- S0P-02~04: 상위 Git 검사,검수 기록의 저장소 밖 보존,Node 내장 모듈·경로 정규화·결정적인 기획 복사 목록을 명시.
- ST00-CODEX-01: HTML 배지를0단계 계획 범위로 수정. 제품의 뉴스24시간 처리·홈10분 갱신 계약은 유지.
