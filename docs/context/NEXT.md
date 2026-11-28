# 다음 할 일 (NEXT)

세션이 끝날 때 갱신한다. 위에서부터 순서대로 진행하고, 사용자 입력이 필요한 항목은 따로 모은다.

## 게시 경로 2A 완료 (2026-11-28)

- 클라우드 CLOUD13·접수 역할·채택 권한·실데이터 모드·Cron 적용, 처리기 푸시 ON, 첫 12건 접수. 상세는 STATUS.
- 다음: (1) 사용자가 온라인 어드민(`https://admin.52-79-247-25.sslip.io`)에 로그인해 실데이터 초안 목록·근거 패널·채택 버튼 확인, (2) 내일 04:00 KST 이후 `cron.job_run_details`로 정리 작업 성공 확인, (3) 2B 계획(클라우드 검토용 공개 읽기, 접근 제한 먼저).

## 재부팅 후 재개 (2026-11-28, 완료)

- 마지막 커밋 `26e8061`(2A S5 처리기 클라우드 전달 대기열, 푸시 OFF·미배포), 원격 브랜치와 같음, 작업 트리 깨끗함.
- 재부팅 뒤: Docker Desktop 실행 → 로컬 Supabase(`judoju-news` 소유 checkout에서 `supabase start`) 확인. 로컬 실데이터 공개 스위치는 OFF 상태 유지.
- 다음: 2A 클라우드 4가지 승인 대기(클라우드 dev DB에 실데이터 초안 30일 보관·`judoju_ai_intake` 역할·Supabase Cron 켜기·`m1_adopt_ai_version` 편집자 권한). 승인 전에는 S1~S4·S6~S8·배포를 하지 않는다. 계획 `docs/publish-stage2-plan.md` rev 6.

## 사용자 입력이 필요한 것

1. **OpenDART API 키 저장** — 키는 채팅에 붙이지 말고 worktree의 `.local-data/dart/opendart.key`(git 제외)에 직접 저장한다.
2. **AI 모델 결정됨(Sol 중심안)**, **API 키 저장됨**(2026-11-26, worktree `.local-data/ai/openai.key`, git 제외). 모델 목록 조회로 키 유효와 `gpt-6-luna`·`gpt-6.1-sol`·`gpt-6.2-sol` 사용 가능을 확인. 키 내용은 출력·커밋하지 않는다. 플랫폼 월 사용 한도(권장 $200)는 사용자가 설정. 채팅에 한 번 노출된 이전 키는 사용자가 2026-11-26 삭제함(저장된 키와 다름을 해시로 확인).
4. 프로젝트 루트 `AGENTS.md`가 2026-11-26 세션 중 사라졌다. 의도한 삭제인지 확인.

6. **게시 경로 1A 완료**(2026-11-27, 모든 단계 Codex READY): 마이그레이션 56~58 로컬 적용, AI 처리기 내보내기·재처리 서버 배포(4da659e, 실행 모드 유지), 변환 모듈·가져오기 스크립트(`scripts/ops/ai-drafts-pull.ps1 export|ingest|requeue`), 어드민 AI 초안 배지·근거 패널·종목 범위 검토·실데이터 게시/예약 숨김. 로컬 실데이터 스위치 ON(로컬 한정). 실측: 기존 준비 초안 10건 재처리 → 6건 스냅샷 → 로컬 접수 6건 RECEIVED, 6건 모두 실데이터 검증·미리보기 통과(종목 5, 섹터 1). 4건은 AI 자체 검증에서 보류(독립 검증 실패 3, 원문성 입력 1). 남은 것: 어드민 화면 실제 확인(로컬 어드민 실행), 보류 4건 재시도 여부, 2단계(클라우드 접수 역할).
7. **게시 경로 1B 구현**(2026-11-27, 계획 `docs/publish-stage1b-plan.md` rev 3.1): 마이그레이션 59(공개 종류 스위치 `real_mode.public_read_enabled`, 공개 읽기 생성기 `scripts/tools/gen-migration-59.mjs`+`dumps-59/MANIFEST.json`, 실데이터 게시기, 게시본 철회·30일 만료, 어드민 `real_publish_allowed`·`state_reason`)·60(Codex 1차 HOLD 수정: 철회 기준을 근거 버전으로)·61(Codex 2차: 내려간 사유를 이슈에 고정 `issues.removal_cause`) 로컬 적용(`real-public-read-intent.json`, `real-withdraw-evidence-intent.json`, `real-removal-cause-intent.json`). 실측(2026-11-27): 어드민 API로 실제 AI 초안 2건 게시(섹터 "하나금융지주 사채 발행 한도…", 종목 "DL이앤씨 평택고덕 수주…"), 검토 모드 앱 웹에서 홈(섹터 기사만)·상세(공시 기반 배지, DART 출처)·종목 상세(종목 기사) 확인, 캡처 `outputs/publish-1b-20261127/`. 확인 뒤 스위치는 다시 껐다(게시본 2건은 DB에 남고, 켜면 다시 보인다). 응답 검사기 기대 종류 필수 인자, 로컬 조회 서버 `LOCAL_REVIEW_REAL`(포트 62332, `node scripts/public-read-gateway.mjs --review-real`), 앱 `EXPO_PUBLIC_READ_MODE=LOCAL_REVIEW_REAL`·`EXPO_PUBLIC_READ_API_URL=http://127.0.0.1:62332`·`EXPO_PUBLIC_APP_ENV=local`에서 상단 "내부 검토용 실데이터" 띠와 "공시 기반" 배지. 스위치 켜기/끄기(로컬 postgres): `update private.real_mode set public_read_enabled=true|false;` — 켜면 합성 조회 서버(62330)는 시작을 거부하므로 확인 뒤 끈다. 1B 커밋 `9926952`(Codex READY).
8. **게시 경로 1C 구현**(2026-11-27, 계획 `docs/publish-stage1c-plan.md` 4차): 마이그레이션 62 로컬 적용(`ai-version-adoption-intent.json`). 근거 기록에 AI 초안 보관(`ai_draft_origin.draft`, 62 이전 행은 채택 불가), 접수 적용 블록을 공통 함수 `ai_apply_version`으로 분리(생성기 `scripts/tools/gen-migration-62.mjs`+`dumps-62/MANIFEST.json`, 비DRAFT 이슈는 접수가 덮어쓰지 않고 HOLD), 편집자 채택 `m1_adopt_ai_version`(가장 새 보류 버전만, 원래 보관 기한·카탈로그 유지, 게시 중이면 먼저 CORRECTION_PENDING, 정정 기한은 연장 안 함), 재게시 시 최근 채택에 `published_at`, 닫힌 실데이터 이슈 정리(근거·ACTIVE 링크, 게시 안 된 채택 초안 삭제). 어드민 근거 패널에 "이 버전 채택" 버튼(서버 `adoptable`일 때만). 다음 후보: 2단계(클라우드 접수 역할) 계획, 보류 4건 AI 재시도, CLOUD11 남은 실측(사용자 필요).
5. **CLOUD11 남은 실측**(2026-11-27 로그인·TOTP 완료): 사용자가 어드민에서 합성 초안 저장·미리보기 후 로그아웃 → 같은 쿠키 재사용 거부와 `admin_online_status` openSessions 0 확인. 비상 시 `scripts/ops/admin-online.ps1 revoke`.

## 사용자 결정이 필요한 것 (최우선)

- **OpenAI API 크레딧 충전 필요**(2026-11-26): 첫 실호출이 `429 insufficient_quota`. ChatGPT 구독은 API에 쓸 수 없다(약관·결제 체계 별개). platform.openai.com → Billing에서 선불 충전(권장 시작 $20~50). 429는 15분 뒤 자동 재시도(`7663426`)라 충전하면 바로 분석이 시작된다.
- 현재 서버: DART 공시는 OpenDART API로 수집·원문 확인 동작(첫 목록 38건, 원문 8건). 선별 3건 완료, 검증 규칙으로 보류 3건(FACT_NUMBER_MISMATCH 2, KOREAN_ENTITY_REQUIRED 1). 증권사 사이트 허가는 모두 OFF(텔레그램 링크는 신호).

- ~~원문 허가~~ 2026-11-26 사용자 승인("진행해줘 함께"): DART·증권사 리포트 12개 호스트 ENABLED, AI 호출 ON(하루 150). 첫 8분 결과 **원문 성공 0건, 모델 호출 0건**: DART·NH는 robots 거절, 교보는 PDF(추출기 없음), 제이조AI·한화·미래에셋은 뷰어/목록 페이지라 본문 미인식.
- **OpenDART API 키 저장됨**(2026-11-26, `.local-data/dart/opendart.key`, git 제외). 기업개황 API로 정상 응답(status 000) 확인. DART 웹은 robots 금지라 공식 API로만 접근한다.

## 자동으로 진행할 것 (순서대로)

-1. **(진행 중) 실데이터 프롬프트·검증 조정** — 2026-11-28(자동 루프): 형식 오탐 수정 3차례 배포(`d591f92`, 2A S5 제외) 후 초안 6건 추가 통과(빛과전자 포함). 고친 것: 공시 회차 번호(제10회·14회 사채·회차 5)는 인용 공시에 그 회차가 있을 때만 허용, 회차 사실(14, 회차), 영향 경로의 공시 계약·제품명(공시 30자 기준, 뉴스 20자 유지), 단위까지 같은 사실값의 초안 숫자(1,343.90원), 계산 뒤 단위 중복(24.92%%), USD 값의 $ 표기, 큰 공시의 원문성 검사 입력 24개 제한(본문에 포함된 인용은 중복 전송하지 않음). 프롬프트 V13: 자기주식·채무보증·임원 변경은 event.family OTHER, 직함·거래 방식(각자대표/공동대표, 신탁/장내) 원문 의미 유지, 계약 취소·변경 조건을 사실·위험으로, % 열 머리글 그대로 인용, 사실에 없는 전제 금지, 목표가 단어 금지. 남은 보류는 대부분 정상: 모델이 카탈로그 UUID를 한 글자 틀림(UNKNOWN_ENTITY — 카탈로그 ID를 짧은 별칭으로 주는 방안 검토), 단위 없는 인용, 표 머리글 재배열(GKL), 검증기 내용 거절(테스 "체결" vs "체결 결정", 파두 취소 조건 누락, 유니테스트 원문 자체 72원 차이). 저장된 선별 결과가 틀린 건(삼성SDI·OCI 사건 유형, 현대모비스 각자대표)은 `triages` 행을 지워야 재선별된다(미실행). 이전 기록 — 2026-11-27: 거래소 공시(HTML 양식) 읽기 수정과 섹터 영향 없는 종목 이슈 허용 후 **검증 통과 초안 9건**(심텍·하나금융·솔브레인, 테스·나무가 주식소각, 동성화인텍 자사주 신탁, 에이치브이엠·DL이앤씨 공급계약, 미래에셋생명 수익증권 만기 연장; 모두 내부 초안·미게시, 캡처 `outputs/ai-drafts-20261127/`). 표 형식 공시 조정(`552e5e4`·`198d6ea`): 숫자·사실값 가림 후 복사 판정(공시 30자), 행 이름 단위("계약금액(원)"), $·USD·KRW·₩() 표기, 환율·세대·개월 단위, 띄어 쓴 제품명. 남은 보류는 대부분 모델이 인용문을 바꾼 정상 거절(FABRICATED_EVIDENCE: 연도 표기·분기 표기 변경)과 독립 검증 거절. 2026-11-27 형식 사유 보류 5건 재처리 중(FORMAT_RETRY). 삼성SDI 주식소각·현대모비스 대표 변경은 독립 검증 거절(사유 확인 필요). 카탈로그 밖 기업(한진칼·덕산네오룩스 등)은 정상 보류.
  이전 기록(2026-11-26) — 2026-11-26 `ac99802`·`473cbf2`·`5a236cf` 배포 후 **검증 통과 초안 3건**(심텍 2, 하나금융지주 1). 해결: 작성기가 본문에 붙인 `[factIds: …]`(DRAFT_NUMBER_MISMATCH의 원인), 날짜 표기(2026년 11월 26일·2026.11.24), 회계식 음수 `(1,849,423,316)`, 띄어 쓴 단위(백만 원), BENEFIT+POSITIVE 중복 방향, 시각 없는 일정, 괄호·백분율 계산, 계산 ID 밑줄, 조건문 "매도해야 … 이어진다" 오탐. 정확도 규칙(사실 외 숫자·변환·합친 값·출처 미명시·단정 표현)은 그대로 실패한다(`tests/backlog-live-formats.test.mjs`). 남은 보류는 대부분 정상 판정: 독립 검증 거절(같은 날 엘앤에프 제11회·제12회 전환사채가 한 사건으로 묶인 초안, 신한지주 제목의 근거 없는 주가 인과, 심텍 중복), 원문과 다른 인용(FABRICATED_EVIDENCE), 원문 문장 복사, 카탈로그 밖 기업. 다음: (a) 엘앤에프 두 건은 기존 선별 결과(`triages`)가 회차 없이 저장돼 있어 재선별하려면 해당 문서의 선별 행 삭제가 필요(V5부터 새 공시는 회차를 officialId로 구분), (b) DART 공시는 접수번호를 officialId로 자동 지정하는 방안 검토, (c) 초안 본문의 `[사실]`·`[분석]` 꼬리표를 앱 표시에서 어떻게 다룰지 결정. 진단 방법: 서버 DB의 runs.response를 컨테이너 안에서 `validateDraft`/`validateTriage`로 다시 검증(stdin으로 스크립트 전달, 컨테이너 rootfs는 읽기 전용).

0. PDF 텍스트 추출기(`extractPdf` 포트에 연결, 오픈소스 라이브러리) → 증권사 리포트 PDF 처리. 리포트 뷰어 페이지에서 PDF 링크 찾기. OpenDART 키가 오면 공시 API 어댑터.

1. ~~원문 접근 허가 후보~~ 완료(2026-11-26): `docs/context/SOURCE-CANDIDATES.md`(요약), `.local-data/backlog/source-candidates.json`(전체, DISABLED). 생성: `node scripts/backlog-source-candidates.mjs --hosts … --companies … --out … --summary …`. **사용자 검토 필요**: 링크가 많은 뉴스·리포트 상위 사이트부터 약관·robots 확인 후 ENABLED 여부 결정.
1-1. ~~단축 주소 해석·라우팅~~ 완료(2026-11-26, 결정 B): `routing.mjs`·`resolver.mjs`, 뉴스는 `news_signals`. 다음: 같은 사건 매칭(뉴스 신호 ↔ 공식·리포트 원문), 홈 순위 관심도 입력 연결.
2. (진행 중) AI 처리기: `runtime/service.mjs`(10분마다 수집 DB 읽기 전용 import, 실행은 설정 flag + `JUDOJU_AI_EXECUTE=1` 이중 스위치)와 `scripts/backlog-server-config.mjs`(카탈로그 + 공식·리포트 후보 393개 DISABLED, 모두 OFF) 완료. 남은 것: 서버 컨테이너 배포(파생 이미지, 수집 볼륨 마운트, 설정·키 파일 읽기 전용 마운트) 후 import 확인. 기존 메모:  서버 배포 형태(별도 컨테이너, 수집기와 분리, 수집 DB는 읽기 전용 스냅샷), 설정 파일 위치, 키 파일 전달(내용 출력 없이), 실행 flag OFF 상태로 배포 스크립트까지 준비. 허가 후보 검토 후 하루 상한 150으로 켠다.
3. **DB 게시 경로** — 설계 `docs/publish-path.md`(2026-11-27): 푸시 접수 RPC → 편집 초안 → 사람 검토 후 게시, 실데이터 모드·claims 매핑·COMPANY 영향 0개 허용. 사용자 결정 4가지 대기. 출처 구분(`role`)과 고지는 앱 화면 준비됨. AI 초안의 `article_kind`(COMPANY 포함)·`primary_company_ref`·`company_refs`도 같이 넘긴다(DB 게시 검증 `private.m1_prepare`가 이미 받음).
3-1. **종목 상세 후속**(2026-11-27 1차 완료): (a) ~~로컬 DB 적용~~ 완료(2026-11-27, 소유 checkout `judoju-news`의 `.local-data/runtime/company-scope-intent.json`에 적용 기록, Supabase CLI 이력은 그대로). 앱 웹(로컬 게이트웨이 + Expo web 8084)에서 종목 상세·섹터 관련 종목 링크 확인, 캡처 `outputs/company-page-20261127/`. 재확인 `node scripts/test-company-page-sql.mjs`(트랜잭션 후 되돌림). 남은 것: 클라우드 preview의 `READ_RPCS`에 `catalog_public_company` 추가와 preview DB 적용, (b) 종목코드: `data/dart-corp-codes.tsv`와 OpenDART 기업코드 파일의 stock_code로 검증 후 채우기, (c) 종목 상세에 DART 공시 목록(원문 링크) 탭, (d) ~~글 상세의 관련 기업 → 종목 상세 링크~~ 완료(섹터 박스의 기업 배지), (e) 홈 순위 입력에서 COMPANY 제외 확인, (f) 어드민 편집기에서 COMPANY 범위 선택. (g) 마이그레이션 52(종목 기사 섹터 블록 숨김)·53(연관 기업 블록 제거)·54(섹터 영향별 기업 배지)·55(조건부 섹터 비노출)는 로컬 DB 적용 완료(`company-sections-intent.json`, `company-related-drop-intent.json`, `impact-companies-intent.json`, `hide-related-sectors-intent.json`), 클라우드 preview는 51~55를 함께 적용 필요. AI 초안→DB 게시 연결 시 impacts의 companyRoles를 `companies:[{company_ref,role}]`로 넘긴다. 기사 레이아웃 예시는 `outputs/company-page-20261127/`(종목 기사·섹터 기사, 가상 예시 포함).
4. 수집기 운영 확인: 47개 채널 한 바퀴 결과, 웹 후보 수 변화, 오류. `scripts/ops/collector.ps1 status`.

## 주의

- 배포 스크립트는 현재 실행 중인 이미지를 기준으로 바뀐 수집기 파일만 덮어쓴 파생 이미지를 만든다. 서버 등록부(routes·permission-profiles)는 이미지 안의 운영본을 유지한다. 등록부를 바꿀 때는 별도 확인을 거친다.
- 되돌리기는 직전 compose override로 돌아간다. 텔레그램 저장 형식은 이전 버전과 호환된다(새 표는 무시됨).
