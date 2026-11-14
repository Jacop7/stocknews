# 2단계 작업 상태

계획 DUAL READY 868f0ec018acd0bc8e374452bfc75859bdf074d5285422d67e25a6ebc2411c5d 이후 새 기능 브랜치에서 착수. S2P-03 HTML 번호 차이가 있으므로 완료 게이트는 MD 본문 항목명으로 식별한다. 계획 원본은 바꾸지 않는다.

공식 Expo58.0.34 template tarball SHA512 검증 후 완전 신규 mobile 경로로 추출, 기본 예제 화면은 새 shell로 교체했다. 앱 로고 텍스트와 색은 기존 주도주뉴스 HTML을 참고했다. 어드민/계약/domain은 새 코드다. 식자재 코드/설정/자원 사용 없음.

타입 검사와 Next production build, Android/iOS Hermes export가 통과했다. 최초 웹 실행에서 Expo58 Link asChild의 스타일 배열 오류를 발견해 flatten 처리하고 개발 서버를 재시작했다. 브라우저에서 실제 홈→저장→설정과 어드민 섹터 관리 경로를 확인했다. 저장 헤더에는 알림/설정 두 아이콘만 둔다. 이후 코드 변경에 맞춘 최종 검사와 native 빌드는 아직 남아 있다.

실제 기사/시세·인증·저장·알림·광고·DB/worker/클라우드는 연결되지 않았다. dev는 클라우드 preview를 뜻하고 로컬 개발은 local로 구분한다. Supabase는 신규 설정만 준비하며 start/link/migration은 하지 않는다. PC 상주에 운영 수집을 의존시키지 않는 클라우드 worker/짧은 함수 경계는 3단계 측정·4단계 계획에서 확정한다.

공개 경로는 이식 가능하도록 정규화하며 과거 관측/원본은 외부 로컬 검수 기록에서 보존한다. 기존 커밋을 재작성하지 않는다. 최초 push 전 기존 이력의 경로 노출·실제 원격 공개 범위와 비밀을 확인한다.

EAS CLI27.9.0의 @expo/require-utils55는 TypeScript5 peer를 요구했다. 앱/domain/root의 TypeScript6을 바꾸거나 peer 검사를 무시하지 않고 전용 packages/build-tools의 EAS CLI peer 환경만 TypeScript5.9.3으로 분리했다. 앱 컴파일은 계속6.0.3이고, build-tools는 앱/운영 번들에 import하지 않는다.

신규 EAS @jacop7223/judoju-news(projectId133b3e36-2bcc-4e98-86f5-3f029e37500c)를 공식 CLI로 생성했다. 생성 후 dynamic owner 저장 오류가 있었으나 두 번째 생성 없이 이미 연결된 ID를 확인하고 owner를 추가했다. project:info가 같은 fullName/ID를 반환해 연결 검증했다. Supabase/worker는 여전히 미생성이다.

EAS 실행 래퍼는 프로젝트 Node24.15.0과 pnpm11.25.0을 하위 프로세스까지 유지하도록 제품 내부 Corepack shim과 PATH를 사용한다. 중첩 pnpm exec node의 실제 버전까지 확인했다. 시스템의 다른 Node/pnpm과 전역 설정은 바꾸지 않는다. 사용자가 선택한 expo-updates 설치는 Node 버전 불일치로 실패했고 native 입력 변화는 없었다. 현재 expo-updates 미설치/OTA 미구성이며 선택적 설치를 거절한다.

Android native-0004 개발 APK는 실제 EAS 빌드 완료 후 공식 CLI로 내려받고 서명·앱 식별자를 검사했다. 새 전용 Android35 에뮬레이터(judoju-news-api35, ADB5038)에서 설치와 앱 홈 화면을 확인했다. 기존 AVD/기본 ADB5037/다른 앱 데이터는 사용하지 않았다. 최초 화면에서 발견한 상태표시줄 겹침을 safe-area-context로 수정했다. 개발 서버의 JS 화면 확인과 APK 네이티브 SDK 컴파일 증거를 각각 기록하며 운영 광고/푸시 요청을 실행하지 않는다.

iOS는 사용자가 최신 Apple 약관을 직접 수락한 뒤 새 bundleIdentifier 등록·새 배포 인증서·새 앱 전용 AdHoc 프로필을 생성했다. 기존 앱의 인증서는 재사용하거나 폐기하지 않았다. 설치 대상은 사용자가 확인한 기존 iPhone 한 대다. 비밀번호·코드·개인키·인증서 원문·기기 UDID는 제품 파일이나 검수 기록에 넣지 않는다. iOS 빌드 FINISHED를 확인했으며 iPhone의 실제 네이티브 화면은 별도로 확인한다.

공통 시간 계약은 시간대 창과 실제 거래일 판단을 구분한다. 한국 거래일 확인 후 09:10–20:00에만 KR을 선택하고, 검증된 한국 휴장은 미국 기준으로 전환하며 달력 미확보는 거래일을 추측하지 않는다. 미국 거래일은 뉴욕 현지 날짜로 조회하고 시나리오·수혜·피해 분석 관점은 계속 KR_EQUITY다. 외부 달력 공급 연동은 아직 없으며 고정 달력 fixture로 경계·휴장·미확보·서머타임 계약을 시험한다.

첫 구현 검수의 S2I-01/C01은 CI event before/base SHA와 HEAD를 명시 비교하고 기준 해석 실패를 차단하도록 수정했다. 첫 도입 예외는 fa928e9 한 커밋의 파일 부재만 허용하며 영구 bootstrap 표지를 제거했다. S2I-C02는 정확한 GitHub PR merge ref·SHA만 허용하도록 고쳤다. 두 우회 회귀를 포함해 시간/CI/빌드 프로필 시험 24건을 실행한다.

S2I-02는 Story/Issue/ArticleVersion과 공개 상태·예약·최초 게시·실질 변경 시각을 분리하고 RankingContext/Snapshot에만 순위 시각·동일성 키를 두도록 수정했다. 정적 타입 경계 시험도 추가했다. S2I-C03은 API 최소 지원 앱 버전/계약 판본/정책 판본/업데이트 요구 응답의 초안 타입을 추가하고 실제 차단은 4단계로 구분했다. S2I-03의 EAS 미연결 문구와 템플릿 npm 안내도 정리했다. production 운영 ID는 11단계 전까지 미준비이며 제품 EAS 래퍼에서 테스트 ID의 기본/production 빌드를 사전 차단한다. readiness AVAILABLE은 도구/개발 빌드 경로 가용성이고 기기 확인·운영 준비와 다름도 명시했다.

양쪽 EAS native-0004 빌드가 FINISHED다. iPhone 설치·홈/탭 보고 이후 native scheme QR로 앱 열기를 재확인했고 서버에서 iOS 1295모듈 번들 로딩을 관측했다. iOS는 사용자 기기 보고+서버 관측이고 Android는 작성자가 전용 에뮬레이터 화면을 직접 확인한 증거다. iPhone 스크린샷을 직접 관측했다고 표현하지 않는다. 최종 DUAL 검수 전에는 2단계 완료/커밋으로 처리하지 않는다.

최종 커밋 전 native 입력과 계획 사본은 Git 줄바꿈 변환도 제외해 리뷰/핑거프린트 바이트를 보존한다. 나머지 텍스트는 LF로 정규화하고 실제 Git 필터 전후 객체 해시가 같은지 검사했다. native digest와 SDK 입력은 변경되지 않았다.
