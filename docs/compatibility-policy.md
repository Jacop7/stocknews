# 초기 앱 호환 정책

환경은 local/preview/production이고 Expo development는 바이너리 프로필이다. 소비자 앱 로그인은 없다. 신규 EAS 프로젝트는 연결됐으며, Apple 서명도 새 앱 전용으로 구성했다. Supabase·worker·운영 배포 계정의 연결 완료를 뜻하지 않는다.

Android runtimeVersion=android-native-0004, iOS runtimeVersion=ios-native-0004. 앱 version 0.1.0과 Android versionCode=1/iOS buildNumber=1은 표시·스토어 제출 기준이며 runtime과 다르다. development/preview/production 채널은 배포 경로다. 현 단계에는 운영 API와 OTA 배포가 없다.

API 최소 지원 버전 초안은 contracts의 ApiCompatibilityPolicy/Response로 정의한다. policy_version은 호환 정책 판본, api_contract_version은 API 응답 계약 정수 판본, min_supported_app_version.android/ios는 플랫폼별 SemVer 문자열이다. 초기 예시는 1과 0.1.0이며 아직 서버가 강제하는 값이 아니다. 응답의 action=NONE/UPDATE_REQUIRED, platform, client_app_version, store_url을 별도 필드로 둔다. 이는 native runtime·스토어 versionCode/buildNumber와 독립이다. 실제 서버 판정과 앱 업데이트 화면은 4단계에서 구현·검증한다.

native 입력은 mobile package.json, root pnpm-lock.yaml, mobile app.json/app.config.ts/eas.json, plugin 설정, mobile native 소스/patches다. 전체 lock을 포함하는 보수적 digest이므로 순수 JS 의존성 변경도 새 native runtime을 요구할 수 있다. CI push는 이벤트 before SHA, PR은 이벤트 base SHA를 비교 기준으로 명시하고 현재 HEAD도 대조한다. 로컬 main은 HEAD와 그 부모, 기능 브랜치는 HEAD와 로컬 main(없으면 검증된 origin/main)을 대조한다. 기준 커밋을 해석하지 못하면 실패한다. 파일이 없는 최초 도입 예외는 검증된 1단계 fa928e9 한 커밋에만 한정한다. 영구 bootstrap 우회 표지는 없다. 공통 native 입력이 변하면 양쪽 runtime ID 변경과 새 native 바이너리 시험이 필요하다. JS 업데이트는 runtime/API 호환 확인 없이 배포하지 않는다.

광고/알림 패키지는 컴파일 호환 시험용으로만 포함한다. Google 공식 테스트 App ID만 설정하며 delayAppMeasurementInit=true다. 앱 코드에서 광고 초기화·광고 요청·푸시 등록·발송은 호출하지 않는다. production 프로필도 현재 시험 ID이므로 운영 배포 가능한 설정이 아니다. 제품 EAS 실행 래퍼는 기본/production 프로필의 테스트 ID를 계정 접근·업로드 전에 거부한다. 환경별 운영 ID 주입과 실제 광고·동의·알림 검증은 11단계이며 그 전 production 배포는 하지 않는다. 이 래퍼는 제품의 지원 실행 경로를 보호하며 임의 외부 CLI 실행을 막는 OS 보안 경계는 아니다. 번들 성공은 native SDK 빌드/기기 실행 성공이 아니다.

공식 출처: https://docs.expo.dev/eas-update/runtime-versions/ .

최초 native 빌드 전 EAS 실제 projectId/owner 연결로 입력이 바뀌어 양쪽 runtime을0002로 올렸다. 이전 입력 기록은 외부 로컬 증거에 보존했다. CNG 생성 android/ios는 직접 수정하지 않으며, 필요한 native 변경은 추적되는 config plugin/patch로 남겨 digest에 포함한다.

실제 최초 빌드 전 EAS Node/pnpm 버전도 고정해 runtime을0003으로 올렸다. 계정 무료 빌드 할당량과 Apple 개발자/iPhone 가용성은 확인했으며, 새 프로젝트에만 빌드를 제출한다. 서명 자원은 새 앱 전용으로 생성하고 기존 앱 인증서/프로파일을 재사용/폐기하지 않는다.

iOS 최초 빌드 설정에서 현재 표준 OS/HTTPS 외 자체 암호화가 없는 앱의 ITSAppUsesNonExemptEncryption=false를 명시했다(https://docs.expo.dev/tutorial/eas/ios-production-build/). CLI가 설정을 쓴 뒤 오류를 반환했으므로 입력을 다시 고정하고 runtime0004로 구분한다. 앞서 제출한 Android0003은 과거 SDK 컴파일 시험으로 별도 보존하며 최종0004 빌드를 대체하지 않는다. expo-updates/OTA는 설치·구성하지 않았고 channel/runtime은 현재 정책·설정 값이며 OTA 동작 인증이 아니다.
