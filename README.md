# 주도주뉴스

Android·iOS 주식 뉴스 앱, 어드민, 신규 Supabase, 독립 Docker worker를 만드는 **신규 프로젝트**입니다.
식자재 관리앱 코드·설정·저장소·DB·인증·키·컨테이너·배포를 사용하지 않습니다.

현재 구현은 0단계 저장소 기반입니다. 앱·어드민·Supabase·worker·클라우드는 아직 만들지 않았습니다.
실제 자원 상태는 [자원 목록](docs/project-resource-manifest.json), 외부 준비는 [준비표](docs/external-preparation.json)를 봅니다.
검수 전 고정 상태는 [개발 상태](docs/development-status.json)에 있습니다. 최종 검수/커밋 영수증은 제품 밖 `../outputs/development-stages/reviews/stage00-implementation/`에 보존합니다.

## 단계 흐름

계획 작성 → Claude·Codex 검수 → 구현·자체 시험 → Claude·Codex 재검수 → 같은 파일로 커밋 → 다음 단계.
권위 자료는 [기획 스냅샷](docs/reference/planning/)과 [0단계 계획](docs/stages/stage-00-plan.md)입니다.

## 검사

```sh
node scripts/verify-foundation.mjs
```

Node 내장 모듈과 Git만 사용합니다. 네트워크·Docker·DB 연결을 실행하지 않습니다.
기획 검사는 사본과 저장소 안 provenance의 해시를 비교해 다른 위치로 clone해도 원본 폴더가 필요 없습니다.
최초 원본/사본 비교 결과는 저장소 밖 영수증으로 보존합니다.

remote는 아직 없습니다. 최초 커밋은 검수 후 `Judoju News Automation <automation@judoju.invalid>`라는 자동화 작성자로 만들며 사용자 신원이나 전역 Git 설정을 바꾸지 않습니다.
다음 1단계는 전용 workspace·도구 버전·CI 계획이며, 패키지 설치나 앱 실행 명령은 아직 없습니다.
