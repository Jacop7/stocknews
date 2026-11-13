# 주도주뉴스 1단계 — 전용 도구·workspace 기반

2026.11.14 · 구현 전 계획 · 0단계 구현 검수/커밋 통과 후 착수

## 목표와 선행조건

새 제품 root는 `C:/Users/jacop/주식/judoju-news`다. 0단계의 계획·구현 검수 READY와 최초 main 커밋/검수 바이트 대조 영수증이 있어야 이 단계 구현을 시작한다. 전용 Git 저장소 안에 workspace와 도구 버전을 고정한다. 식자재 앱의 코드·환경·자원은 사용하지 않는다. Supabase·worker·클라우드는 이 단계에서도 연결/기동하지 않으며 이후 새로 구축한다.

각 단계는 계획 작성→Claude·Codex 검수→구현/자체 시험→동일 두 역할 재검수→같은 바이트 커밋 순서를 유지한다. 이 문서는 검수 전 초안이며 0단계 완료나 1단계 착수를 미리 승인한 기록이 아니다.

## 구현 범위

| 산출물 | 기준 |
| --- | --- |
| feat/01-workspace | 검수된 main에서 짧은 기능 브랜치를 생성. 새 remote/공유 저장소는 아직 PENDING. 기존 Git 이력 가져오지 않음 |
| package.json·pnpm-workspace.yaml·lock | 제품 전용 새 root package, private=true, pnpm11.25.0·Node24.15.0 조합 고정. apps/*,packages/*,workers/*만 workspace 범위. lock은 새로 생성 |
| 제품 범위 개발 도구 | TypeScript6.0.3 및 Supabase CLI3.1.0을 정확 버전으로 설치해 버전 동작 확인. 실제 앱 의존성은2단계 Expo58 공식 생성 템플릿에 맞춰 설치. 공급/AI API 의존성은 아직 없음 |
| 버전 설정·ignore | .node-version·엔진/저장 정책을 고정. 로컬 의존성/로그/키/DB 상태는 계속 Git 제외. 기존 공용 설치 도구의 전역 설정 변경 금지 |
| 검사 진입점 | pnpm verify→Node 내장 집계기→기반/도구/JSON/lock/workspace 검사. 실제 소스가 없는 앱·어드민·worker 빌드를 실행/통과했다고 표시하지 않음 |
| 개발 상태·Git 기반 검증 | 0단계 완료 영수증을 참조하고 현재1단계 구현검수대기를 기록. 첫 main 커밋 ID를 신규 이력 기준으로 기록하고 후속 커밋은 그 후손임을 확인. 기반 검사의0단계 전용 ‘package 없음/커밋1개’ 가정을 단계 계약으로 확장하며 분리/보안/사본 바이트 검사는 유지 |
| 원본 스냅샷 보호 보완 | S0I-05를 반영해 .editorconfig의 docs/reference/planning/**·불변0단계 계획에 charset/end_of_line/insert_final_newline을 unset. Git의 -text/-filter/-ident와 내부 해시 검사는 계속 유지 |
| CI·외부 준비 계획 | 새 제품 전용 CI/CD·secrets PENDING을 유지하고2단계 실제 앱 검사에 맞춘 CI 계약을 문서화. 원격 CI 실행은 아직 없음. 준비표는 확인된 사실만 갱신하며 계정·공급 허가·비용 미확인은 그대로 기록 |
| 환경 준비 기록 | docs/environment-readiness.json에 Docker/WSL2·Android SDK/JDK/에뮬레이터 또는 기기 경로·Expo/EAS/iOS 빌드 경로·계정 준비의 관측 상태와 남은 의존 단계를 기록. 읽기 전용 조회만 하며 기존 컨테이너/기기를 시작·변경하지 않음 |

정확 버전은 읽기 전용 registry로 확인했다. pnpm11.25.0 요구는Node>=22.13이고, Expo SDK58 공식 템플릿58.0.34는TypeScript~6.0.3을 사용한다. 이 조합은 실제 설치·검사를 통과해야 확정한다. 전역 도구가 아니라 제품의 package.json/lock에 설치한다. Supabase CLI 설치 시 공식 registry 패키지의 필요한 빌드 단계만 명시적으로 허용하며 다른 의존성의 실행 권한을 포괄 허용하지 않는다.

### 1단계 환경·실행·이력 계약

- S1P-01: 환경 기록에는 관측 명령·종료 상태·관측 시각·관측값/AVAILABLE 또는 PENDING·대기 이유·필요 사용자 조작·영향 단계(2단계 빌드/4단계 로컬DB)를 둔다. Docker 버전/엔진 응답과 WSL2 상태는 읽기 전용 조회로 확인하고 새 컨테이너·volume·network는 만들지 않는다. Android SDK/JDK/adb/emulator 명령 존재·버전과 사용 가능한 시험 경로를 확인하되 기기 일련번호는 기록하지 않는다. Windows에서 iOS 로컬 빌드는 불가하므로 EAS 계정/빌드 도구·기기 또는 승인된 원격 경로를 확인하고 미확인은 PENDING으로 둔다. Expo/EAS 계정·스토어 유형/등록·테스터는 기존 외부 준비표와 연결해 미확인 상태를 구분한다. 1단계는 준비 상태의 확인/기록으로 마치며, 실제 양쪽 첫 빌드와 로컬 컨테이너 실행은2단계/4단계의 별도 게이트다. PENDING을 빌드/DB 시험 통과로 표시하지 않는다.
- S1P-02: packageManager=pnpm@11.25.0, engines의Node24.15.0/pnpm11.25.0, .node-version, 지원되는 pnpm engineStrict 설정과 실제 버전 검사를 함께 사용해 불일치를 실패시킨다. 프로그램에서 .cmd를 shell 없이 spawn하지 않고 process.execPath와 제품 내부의 검증된 패키지 JS 진입점 또는 실제 exe를 명시 인수로 실행한다. 설치는 공식 npm registry·제품 전용 store로 한정하고 integrity/플랫폼 패키지/설치 스크립트 실행 여부를 영수증에 기록한다. Supabase3.1.0 registry는 dist/supabase.js와동일버전 플랫폼별 optional 패키지를 제공하며 postinstall 항목은 없음을 확인했다. 과거 버전의 다운로드 방식을 그대로 가정하지 않는다. ignoreScripts를 기본으로 쓰고 실제 필요한 경우에만 검증된 정확 패키지의 빌드 한정 허용을 별도 기록한다. 전역·포괄 허용은 하지 않는다.
- S1P-03: 승인된 이 계획의 바이트 사본을 docs/stages/stage-01-plan.md에 두고 provenance에10번째 항목으로 추가한다. 기존9개 사본은0단계 커밋과 같은 바이트를 유지한다. docs/stages/** 전체와 planning 스냅샷은 Git 변환/EditorConfig 변환에서 제외한다. 원본↔새 사본은 구현 시1회 외부 증거, 실행 검사는 내부 사본↔provenance로 분리한다.
- 0단계 검사 분기는 기존 no-package/main/처음1커밋 기준을 유지하고,1단계 분기에는 package/lock 존재·0단계 최초 커밋 조상·허용 refs를 검사한다. 1단계에서 허용하는 로컬 refs는 main과 feat/01-workspace뿐이며 태그/원격 refs는 없다. 작업 중 main은0단계 커밋, feature는그 커밋 또는 검수 후 새 커밋1개인 상태를 허용한다. 재검수 후 같은 제품 바이트로 feature 커밋을 만들고 main으로 --ff-only 병합, 병합된 feature를 정리한다. 최종 main은 최초0단계와1단계 커밋2개이며 외부 영수증에 검수 manifest/커밋 blob/허용 refs를 대조한다. 중간 판본 지적을 수정할 때도 검수 전 임의 커밋으로 이력 조건을 우회하지 않는다.

## 이번 단계에서 하지 않는 것

Expo/어드민 화면·DB schema·Supabase init/start/link·Docker worker/volume/network·새 cloud 프로젝트·스토어 등록·키 입력·외부 뉴스 수집·AI API 호출·푸시/광고 발송은 이후 단계 범위다. 공통 개발 도구를 이용하는 것은 기존 제품을 이용하는 뜻이 아니다. 유료 자원·약관·권한 확대는 구체적인 대상이 준비됐을 때 필요한 확인을 받는다.

## 검사와 인수

- 기능 브랜치는 검수된0단계 커밋의 후손이고 remote는 미연결이다. 제품 파일 이외의 기존 자원을 수정하지 않는다.
- 최초 기준은0단계 커밋 `f7dce3a9e05c39580f23a210c3ac9d2514c38b74`다. S0I-04는0단계 외부 커밋 영수증에서 커밋 후130 PASS와 refs/heads/main 단독 상태를 확인했다. 이후 Git 검사는 단계에 맞는 허용 refs와 최초 커밋 조상을 확인하며 임의 태그/원격 refs를 조용히 허용하지 않는다.
- 고정 Node/pnpm 범위를 확인하고 깨끗한 의존성 설치와 frozen-lockfile 설치를 실행한다. 패키지 버전/lock 일치를 확인한다. 전역 설정을 고치거나 기존 앱의 의존성/lock을 복사하지 않는다.
- 제품 내부 TypeScript/Supabase CLI의 버전 명령이 실행된다. 이는 앱 컴파일·DB 접속 성공 증거가 아니다. 설치 후 스크립트에 부작용이 없는지 확인한다.
- 환경 준비 기록의 Docker/WSL·Android/iOS/Expo·계정 항목과 관측/대기 상태·후속 게이트가 빠짐없이 있어야 한다. 미확인 값을 추측해 채우지 않는다.
- pnpm verify가 저장소 독립성·민감 ignore·기획 바이트 보존·단계 상태·workspace 경로/버전/lock을 확인한다. 실제 실행 결과를 바깥 영수증에 남긴다.
- 원본 보존 docs/reference/planning/**와0단계 계획에는 Git text/filter/ident 변환을 계속 적용하지 않는다. 해당 사본이 검수된0단계 커밋과 달라지면 실패한다.
- 검사 스크립트는 설치 경로를 제품 내부로 한정하고 외부 제품·DB에 접속하지 않는다. Windows 실행은 shell 문자열 조합 대신 명시 인수와 실행 파일을 사용한다.
- 완료/검수/커밋 연결은 `../outputs/development-stages/reviews/stage01-implementation/`에 보존한다. 제품의 검수 바이트를 결과 기록 때문에 바꾸지 않는다.

## 다음 단계

1단계 검수 후2단계 계획에서 Expo Android/iOS 앱·어드민·contracts/domain의 초기 코드와 CI를 다룬다. 실제Supabase·Docker worker는 승인된4단계에서 신규 구성한다. 공급·권한 준비는3단계 병행 트랙이며 M1의 표시된 수동/샘플 구현을 막지 않는다.

0단계 전체 검사기는 현재 bootstrap productRoot에 결속되어 있다.1단계는 로컬 workspace 범위이며 다른 경로 clone의 전체 실행을 지원했다고 주장하지 않는다.2단계 원격 CI를 작성하기 전에는 제품 실행 루트 식별과 최초 root 이력 기록을 구분하고 별도 checkout에서 전체 검사가 동작하는 기준을 계획·검수한다. 기획 사본 자체의 새 checkout 바이트 일치는0단계에서 검증했다.

참고: [Expo 생성 안내](https://docs.expo.dev/get-started/create-a-project/), [pnpm workspace](https://pnpm.io/workspaces), [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started). SDK/패키지 버전은 설치 시 registry와 공식 안내를 다시 확인한다.
