# 주도주뉴스 모바일

새 제품 전용 Expo58 앱이다. Android·iOS는 이 앱의 코드만 공유한다. 식자재 앱의 코드·환경·DB·인증서는 사용하지 않는다.

저장소 루트에서 Node24.15.0과 제품 내부 Corepack 캐시로 pnpm11.25.0을 사용한다. 고정 의존성 설치는 `corepack pnpm install --frozen-lockfile --ignore-scripts`, 개발 서버는 `corepack pnpm dev:mobile`, 전체 검사는 `corepack pnpm verify`다. 기존 Expo 템플릿의 reset-project 작업은 사용하지 않는다.

앱 식별자는 Android/iOS 모두 com.jacop.stocknews이고 EAS 프로젝트는 @jacop7223/judoju-news다. EAS 명령은 루트의 `node scripts/eas.mjs ...`로 실행해 하위 Node/pnpm 버전도 고정한다. 시스템 도구와 다른 제품 설정은 바꾸지 않는다.

현재 화면은 개발용 fixture shell이다. 기사/시세/저장/알림/광고/서버는 미연결이며 실제 서비스 기능 구현 완료를 뜻하지 않는다. development/preview/production 환경 경계와 native/API 호환 기준은 docs/compatibility-policy.md를 따른다. 운영 광고 ID와 production 배포는 준비되지 않았다.
