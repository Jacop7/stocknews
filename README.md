# 주도주뉴스

Android·iOS 주식 뉴스 앱, 어드민, 신규 Supabase, 독립 Docker worker를 만드는 **신규 프로젝트**입니다.
식자재 관리앱 코드·설정·저장소·DB·인증·키·컨테이너·배포를 사용하지 않습니다.

0단계 저장소 기반 검수와 최초 커밋을 완료했고, 현재1단계 도구/workspace를 구현 중입니다. 앱·어드민·Supabase·worker·클라우드는 아직 만들지 않았습니다.
실제 자원 상태는 [자원 목록](docs/project-resource-manifest.json), 외부 준비는 [준비표](docs/external-preparation.json)를 봅니다.
검수 전 고정 상태는 [개발 상태](docs/development-status.json)에 있습니다. 최종 검수/커밋 영수증은 제품 밖 `../outputs/development-stages/reviews/stage01-implementation/`에 보존합니다.

## 단계 흐름

계획 작성 → Claude·Codex 검수 → 구현·자체 시험 → Claude·Codex 재검수 → 같은 파일로 커밋 → 다음 단계.
권위 자료는 [기획 스냅샷](docs/reference/planning/)과 [0단계 계획](docs/stages/stage-00-plan.md)입니다.

## 검사

```sh
corepack pnpm verify
```

검사기는 Node 내장 모듈과 Git 및 제품 내부 도구의 버전 명령을 사용합니다. DB/Docker 자원에 연결하지 않습니다. 의존성 설치는 공식 npm registry에서 수행합니다.
기획 검사는 사본과 저장소 안 provenance의 해시를 비교해 다른 위치로 clone해도 원본 폴더가 필요 없습니다.
최초 원본/사본 비교 결과는 저장소 밖 영수증으로 보존합니다.

사용자가 지정한 origin은 https://github.com/Jacop7/stocknews.git 입니다. 아직 push하지 않았습니다. 커밋은 검수 후 `Judoju News Automation <automation@judoju.invalid>`라는 자동화 작성자로 만들며 사용자 신원이나 전역 Git 설정을 바꾸지 않습니다.
도구는 Node24.15.0·pnpm11.25.0·TypeScript6.0.3·SupabaseCLI3.1.0으로 고정합니다. pnpm-workspace.yaml은 JSON 형식(YAML1.2 부분집합)입니다. 다음2단계는 새 Expo/어드민/공통 계약 골격입니다. 앱 실행 명령·실제 원격 CI는 아직 없습니다.

현재 Windows 호스트의 pnpm.cmd는 별도 Node를 사용하므로 시스템 Node24.15.0의 Corepack을 사용합니다. PowerShell에서 `$env:COREPACK_HOME = "$PWD/.local-tools/corepack"` 설정 후 위 명령을 실행합니다.
