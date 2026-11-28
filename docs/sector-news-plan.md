# 섹터별 뉴스 수집·시세 캡처·매크로 필터 설계안 (2026-11-28, rev 8 — 검수 대기)

사용자 지시(2026-11-28):
- "앱 보면 섹터별 필터 있잖아. 그리고 필터에 매크로가 추가되어야 하고. 실제 섹터 관련된 게 1순위, 매크로는 주가에 영향을 미치는 젠슨황 스캔들·중국 메모리 같은 것. 뉴스도 결국 섹터별로 정리되지?"
- "시간대별로는 주가 추적해서 뉴스 수집하는 로직 있는데"(기획: 뉴스운영 상세로직 v1.1 §4·한국 주식 관점, 서비스 기획안 v1.6 목표 2)
- 시세: "네이버 관심종목 리스트 페이지를 캡처해서 이미지를 받아 OCR", "자동 저장해야지". 한투 Open API는 아직 없음. 시세는 앱에 노출하지 않고 뉴스 추적에만 쓴다.
- 웹 뉴스 직접 수집은 GNews·Finlight로 대체(확정).

## 0. 범위·경계·순서

| 부분 | 내용 | 실행 위치 | 순서 |
| --- | --- | --- | --- |
| P3 매크로 필터 | 앱 섹터 필터에 "매크로", 피드 조회에 별도 `macro` 조건 | 앱·게이트웨이·DB(로컬 먼저) | 1 |
| P2 섹터 뉴스 수집 | 카탈로그 섹터·매크로 검색어로 GNews 검색, 시간대·섹터 등락으로 순서 | AI 처리기 | 2 |
| P1 시세 캡처·OCR | 사용자 PC 네이버 관심종목 화면 자동 캡처 → OCR → 섹터별 등락만 서버로 | 사용자 PC | 3 (업로드 전용 키는 사용자 승인 후) |

하지 않는 것: 시세·등락률·섹터 평균을 앱·공개 응답·관리자 공개 화면에 노출, 시세로 기사 순위(M) 켜기, 네이버 페이지 새로고침·로그인 자동화·무작위 간격·차단 회피, 캡처 이미지 보관, 회사별 시세를 PC 밖으로 보내거나 기록(예외: §3.4의 직전 회차 기준 파일 하나), 서버나 Claude 브라우저가 네이버에 접속, OCR로 종목 정체를 확정(정체는 검증된 마스터만). 네이버 약관 위험은 사용자가 감수(사용자 계정·본인 관심종목·내부용).

## 1. P3 매크로 필터

- **계약:** 섹터 인자(`p_sectors uuid[]`, 게이트웨이 `sectors=`)는 그대로 둔다. 새 인자 `p_macro boolean`(**기본값 없음**; false 동작은 7인자 함수가 `p_macro=false`로 부를 때만), 게이트웨이 쿼리 `macro=1`(그 외 값 거절). 커서 `filter_hash`에 `macro` 포함(기존 커서는 macro=false 맥락과 같은 해시가 되도록 `macro`가 false면 해시 입력에서 생략 → 옛 커서·옛 앱 호환).
- **조건 (COMPANY는 항상 제외, 현재 규칙 유지):**
  - 둘 다 없음: 지금과 같음(SECTOR·MACRO 전체).
  - 섹터만: 지금과 같음(그 섹터에 영향 경로가 있는 SECTOR·MACRO — impacts가 있는 매크로는 섹터 필터에도 나옴 = "결국 섹터별로 정리").
  - 매크로만: article_kind MACRO 전체(영향 섹터 없어도).
  - 매크로 + 섹터: MACRO 전체 ∪ 그 섹터에 영향 있는 기사.
- **DB:** 새 마이그레이션이 8인자 `catalog_public_articles(…, p_macro boolean)`을 만든다. `p_macro`에는 **기본값을 두지 않아** 7인자 호출과 겹치지 않는다(PostgREST 후보가 하나로 정해짐). 기존 7인자 함수는 새 함수를 `p_macro=false`로 부르는 얇은 함수로 유지. 두 함수 모두 public 권한 회수 후 anon/authenticated execute, PostgREST 스키마 다시 읽기. 게이트웨이는 `macro=1`일 때만 8인자로 부르고 그 외에는 7인자 그대로(클라우드에 마이그레이션이 아직 없어도 기존 요청은 동작). 로컬 적용·시험. 클라우드는 클라우드 배포 묶음 때.
- **게이트웨이:** `scripts/catalog/public-route.mjs`가 `macro`를 허용·검증, RPC 인자 전달, 해시. 합성·실데이터 읽기 모드 모두.
- **앱:** `SectorFilter.tsx` 시트 맨 앞에 "매크로" 탭(탭 역할)과 그 그룹의 체크박스 하나("매크로 이슈", checkbox 역할). 선택 칩 "매크로 ×"로 해제, "초기화"는 매크로도 해제. 상태는 지금처럼 앱 실행 중 메모리(`CatalogContext`에 `macro` 추가, 영구 저장 없음). `NewsFeed.tsx`가 `&macro=1`을 붙이고 커서 맥락에 포함. 섹터 상세 화면(`/sector/[id]`)은 매크로 선택과 무관.
- **공개 응답에 새 필드 없음**(시세·점수 노출 없음).

## 2. P2 섹터 뉴스 수집 (AI 처리기)

### 2.1 검색어 파일
- 원천: 처리기 카탈로그와 같은 검토된 산출물 — `tests/fixtures/catalog/source-20261114.json`(시트 원본, sha 고정) + `registry-v1.json`(ID, sha 고정)을 `parse-catalog.mjs`로 변환. 변환 결과의 hold 집합이 **이미 검토된 기준 hold 집합**(`scripts/test-catalog-import.mjs`가 고정한 341건: 종목 정체 미확인 339 + 알려진 멤버십 2)과 정확히 같아야 하고, 하나라도 다르면 생성 실패.
- `scripts/tools/sector-queries.mjs` → `data/sector-queries.json`(커밋, 사람이 검토):
  - 섹터마다 `ko`: 핵심키워드 + 추가키워드 앞쪽에서 최대 4개. 공유 일반어(같은 단어가 섹터 5개 이상에 나오면) 제외, 단 남는 단어가 2개 미만이면 섹터명 포함. 2자 미만·따옴표·괄호·`OR` 포함 단어 제외.
  - 섹터마다 `en`: 연관 미국기업 이름(시트 표기 `이름 [티커] — 설명`에서 이름만) 최대 3개. 시트가 UNVERIFIED_SOURCE로 표시한 값이므로 **발견용 검색어로만** 쓰고 사실·연결 근거로 쓰지 않는다.
  - 매크로 고정 목록(`ko` 4개, `en` 4개, 사용자 예시 반영: 금리·환율·연준 / 관세·수출규제 / 중국 반도체·중국 메모리·중국 경기 / 엔비디아·젠슨 황).
  - 검증: 쿼리 길이 ≤ 200자, 단어마다 따옴표로 감싸 `"a" OR "b"` 형태, 빈 단어·중복 없음, 따옴표 짝.
  - `queryId = <topic>:<locale>` (topic = 섹터 ID 또는 `MACRO-n`), 파일에 `version`, 원천 sha 3개(source·registry·parser). **생성 시각은 넣지 않는다** — 같은 원천이면 같은 바이트(재생성 바이트 비교 시험).
- 배포: `ai-processor.ps1`의 깨끗한 트리 검사와 `git archive` 목록에 `data/sector-queries.json` 추가. **신뢰 기준:** 처리기 코드(`gnews.mjs`)에 쿼리 파일 정규화 바이트의 sha256 상수(`SECTOR_QUERIES_SHA256`)를 박아 두고, 시작 때 배포된 파일 sha가 이 상수와 같을 때만 쓴다(원천 sha 3개는 생성 근거 기록용). 다르거나 형식이 틀리면 섹터 검색만 끈다(기존 헤드라인·주제 검색은 계속). 같은 방식으로 `market.mjs`에 `SECTOR_MEMBERS_SHA256`·`STOCK_MASTER_SHA256` 상수를 두고 배포 파일과 업로드의 `membershipSha256`·`masterSha256`을 이 상수와 비교한다. 상수는 생성기 실행 뒤 같은 커밋에서 갱신하고, 시험이 상수 = 파일 sha를 확인한다.

### 2.2 시간대
- **KR 모드:** 서버가 받은 `sector-moves.json`이 **15분 이내**이고 그 안의 `market: KR`, `session: OPEN`일 때만(§3에서 휴장·장 마감은 OPEN이 아니다). 시세가 실제로 움직이는 거래 시간이라는 증거로 KR을 정하므로 달력 파일이 필요 없고, 휴장일·PC 꺼짐·캡처 실패는 자동으로 US 모드다(기획 v1.1: 한국 휴일은 해외 기준).
- **US 모드:** 그 밖의 모든 시간.
- 경계 이름: 이것은 "뉴스 탐색 시장 모드"이며 홈 순위의 08:10/20:00 market_basis와 별개다(홈 R2에서 따로 다룬다).

### 2.3 한 회차(15분)의 호출 구성
- 기존: 헤드라인 2회(US·KR business) — 유지.
- 검색 4칸:
  - KR 모드: [섹터-ko, 섹터-ko, 섹터-ko, 매크로-ko(홀수 회차) / 섹터-ko(짝수 회차)]
  - US 모드: [섹터-en, 섹터-en, 기존 영어 주제 순환 1개, 매크로-en(홀수 회차) / 섹터-en(짝수 회차)]
- 섹터 고르기: (1) 마지막 시도 후 6시간 넘은 쿼리가 있으면 가장 오래된 것부터(굶김 방지), (2) 아니면 KR 모드는 |섹터 평균 등락률| 큰 순(상승·하락 모두, 신선한 값 있는 섹터만), US 모드는 가장 오래된 순. 동률은 queryId.
- 매크로 칸: 그 언어의 매크로 쿼리 중 **마지막 시도가 가장 오래된 것**(한 번도 안 한 것 먼저, 동률 queryId). 기존 영어 주제 칸은 지금처럼 원장 순번 순환.
- `last_attempted`는 호출 직전(예산 예약과 같은 트랜잭션)에, `last_succeeded`는 결과 저장과 같은 트랜잭션에 갱신.
- `gnews_queries(query_id PK, last_attempted INTEGER, last_succeeded INTEGER)`. **시도 시각**으로 순서(실패하는 쿼리가 계속 앞에 오지 않게). 회차 번호는 원장에 저장.
- **호출마다 바로 저장:** 각 호출이 끝나면 그 결과를 즉시 신호로 기록한다. 중간 호출 실패는 그 칸만 건너뛰고(사유 로그) 나머지 칸을 계속한다. 예산 부족이면 그 회차의 남은 칸을 멈춘다.
- 예산: 하루 상한 300 → **900**(플랜 1,000). 정상 96회차 × 6 = 576회. 재시작 직후 회차를 포함해도 상한 900에서 원장이 멈춘다(895~899에서는 남은 수만큼만 호출, 900에서 0).

### 2.4 기록
- `news_signals`는 그대로(URL 단위). 새 표 `news_signal_topics(url REFERENCES news_signals(url) ON DELETE CASCADE, query_id, topic, locale, first_seen, last_seen, PRIMARY KEY(url, query_id))` — 같은 URL이 여러 섹터·매크로·언어에 걸려도 모두 남는다. 신호와 topic은 **같은 SQLite 트랜잭션**에서 정규화된 URL(`urlKey`)로 쓰고, 신호가 만료돼 지워지면 topic도 함께 지워진다(외래키, `PRAGMA foreign_keys=ON`은 이미 켜져 있음).
- 출처 ID: `gnews:sector-ko`, `gnews:sector-en`, `gnews:macro-ko`, `gnews:macro-en`.
- 상태(`news-report.mjs` sources): 24시간 섹터별 신호 수 상위 10, 매크로 수, 모드(KR/US), sector-moves 수신 시각·커버리지. 회사별 값 없음.
- 뉴스는 계속 신호만(본문 안 읽음). topic은 "어디서 찾았나" 진단이고 섹터 분류는 AI가 공식 근거로 정한다.

## 3. P1 시세 캡처·OCR (사용자 PC)

### 3.1 종목 정체 — 검증된 마스터
- `scripts/tools/stock-master.mjs`: OpenDART 공식 API `corpCode.xml`(ZIP, API로만, 키는 로컬 파일)에서 카탈로그 회사의 DART 고유번호(`data/dart-corp-codes.tsv`) → 종목코드를 뽑아 `data/stock-master.json` = `{ version, sourceSha256, companies: [{ companyId, name, corpCode, stockCode }] }`(커밋). 같은 이름 중복·종목코드 없음·코드 중복은 목록에서 빼고 사유를 남긴다.
- 마스터 파일은 생성 시각 없이 결정적이다. 입력 해시를 모두 담는다: `corpCodeXmlSha256`, `dartCorpCodesSha256`, `registrySha256`, `generatorSha256`. 같은 입력이면 같은 바이트(작은 XML 픽스처로 재생성 바이트 비교 시험, 정확한 스키마 시험).
- **섹터 멤버십 파일** `data/sector-members.json`(같은 생성 방식, 결정적): 카탈로그 시트 멤버십에서 섹터 56개 → 마스터에 있는 회사 ID 목록(정렬). `membershipSha256` = 이 파일의 정규화 바이트 sha. PC와 서버가 같은 파일을 쓴다.
- 파서는 마스터만 정체 근거로 쓴다: 행의 6자리 코드가 마스터에 있으면 그 회사, 코드가 깨졌으면 이름이 마스터 이름과 **정확히·유일하게** 일치할 때만 그 회사(이름은 관측, 정체는 마스터). 코드와 이름이 서로 다른 회사를 가리키면 버린다. OCR로 새 코드를 "학습"하지 않는다.
- 관심목록 정합: 첫 설정 때 `-Check` 실행으로 네 목록의 회사 집합을 마스터와 대조해 빠진 회사·카탈로그 밖 종목·중복을 출력(목록 338 vs 카탈로그 339 차이 확인). 사용자가 목록을 고친다.

### 3.2 캡처
- 사용자가 브라우저(Chrome 또는 Edge)에서 네이버증권 MY → 관심 종목을 직접 로그인해 열어 둔다. 확대 100%, 라이트 테마.
- `scripts/ops/naver-watch/capture.ps1`(Windows PowerShell 5.1):
  - **단일 실행:** 이름 있는 mutex. 이미 실행 중이면 종료.
  - **고정 5분 간격**(작업 스케줄러), 평일 08:00~20:00 KST에만 시도(KR 여부의 최종 판단은 §3.4 시장 상태). 무작위 간격 없음.
  - **창 검증:** 프로세스 chrome/msedge, 창 제목에 설정 문자열("관심 종목")이 정확히 한 창. 최소화·잠금 화면·창이 화면 밖이면 그 회차 실패(사유 기록).
  - 목록마다: UI Automation으로 이름이 정확히 같은 목록 탭을 누르고, 탭이 선택 상태가 됐는지 확인(아니면 실패). 맨 위로 → 캡처 → Page Down 반복. **끝 판정:** 직전 장과 같은 회사 집합이 읽히면 끝(이미지 비교 아님). 목록별 최대 장 수 = ceil(기대 행 / 화면당 행) + 2. **최대 장 수에 도달할 때까지 끝 판정이 안 나면 그 목록은 불완전**이고 그 회차는 실패(업로드 안 함).
  - 장마다 캡처 시각 기록. 한 회차(네 목록) 최대 120초, 넘으면 실패.
  - 페이지 새로고침·주소 이동·로그인 동작 없음.
- 파일: `%LOCALAPPDATA%\judoju\naver-watch\work\<회차>\`(클라우드 동기화 폴더 아님, 현재 사용자만 접근하도록 ACL). 이미지·OCR JSON은 `finally`에서 삭제, 시작 때 남은 작업 폴더 삭제. 로그에는 사유·개수만(값·텍스트 없음).

### 3.3 OCR과 행 읽기
- `ocr.ps1`(Windows.Media.Ocr ko): 단어·좌표·잉크 색 JSON(표준 출력, 파일로 남기지 않음).
- `parse.mjs`(순수 함수):
  - 머리글 `종목명`·`현재가`·`전일대비`·`거래량` 네 개가 같은 줄에 있어야 한다(없으면 그 장 실패). 열 범위는 머리글 x로.
  - 행 기준점: 종목명 열의 6자리 코드 단어, 또는 코드가 안 읽힌 경우 마스터 이름과 정확히 일치하는 이름 단어(+19px).
  - 숫자: 현재가·전일대비 금액에서 숫자만. 부호: 전일대비 글자 잉크 색(빨강 상승, 파랑 하락, 무채색 보합; 판별 불가·혼합이면 버림).
  - 등락률 = 부호 × 금액 ÷ (현재가 − 부호×금액) × 100. **OCR 등락률을 읽을 수 있고 계산값과 0.2%p 이내일 때만 채택**(읽을 수 없으면 버림) — 잘못된 행을 내보내지 않는 것이 목표, 놓친 행은 허용.
  - 여러 장에 같은 회사가 나오면 값이 같을 때만 하나로, 다르면 버림.
- 회사별 값(`quotes`)은 메모리에서만 쓰고 파일로 남기지 않는다.

### 3.4 시장 상태와 섹터 등락
- **시장 상태:** PC에 직전 성공 회차의 `{ kstDate, prices: { companyId: 현재가 } }` 파일 **하나만** 허용되는 예외로 저장한다: 위치 `%LOCALAPPDATA%\judoju\naver-watch\state\last-round.json`(현재 사용자만 접근 ACL), 매 회차 원자적으로 덮어씀, 7일 넘게 갱신되지 않으면 삭제, 로그·업로드·다른 사본 없음, `install.ps1 -Remove`가 지움. **손상 처리:** 파일이 일반 파일이 아니면(폴더·재분석 지점/링크) 따라가지 않고 그 회차는 업로드 없이 실패(사유 기록, 사용자 확인 필요). 일반 파일인데 읽을 수 없거나·잘린 JSON·스키마 위반(kstDate 형식, prices의 회사 ID가 마스터에 없음, 가격이 양의 정수가 아님)이면 그 파일을 지우고 이번 회차를 새 `BASELINE`으로 원자적으로 저장, 업로드하지 않는다. 비교 분모 = 이번 회차와 직전 회차에 모두 읽힌 회사(공통 회사), 공통 회사가 마스터의 50% 미만이면 판단 불가 → 업로드 안 함.
  - 같은 KST 날짜의 직전 회차와 비교: 현재가가 바뀐 공통 회사가 **하나도 없으면** `CLOSED`.
  - 날짜가 바뀐 첫 회차(직전 회차가 이전 날짜): 공통 회사의 95% 이상이 현재가 그대로면 `CLOSED`(휴장일·장 시작 전 화면).
  - **직전 회차가 없으면(처음 실행·저장 파일 없음)** 기준만 저장하고 업로드하지 않는다(`BASELINE`).
  - 그 밖은 `OPEN`. `CLOSED`·`BASELINE`은 업로드하지 않는다.
- **섹터 등락:** `data/sector-members.json`(56개 섹터 → 회사)으로 동일가중 평균. 섹터 회사의 70% 이상 읽힘 + 최소 min(3, N)개일 때 `avgPct`는 유한한 숫자, **아니면 반드시 `null`**(0으로 채우지 않음). 전체 커버리지(읽힌 회사/마스터 회사) 80% 미만이면 업로드 안 함.
- 출력 `{ format: 'SECTOR_MOVES_V1', membershipSha256, masterSha256, at(회차 첫 캡처 시각, ISO UTC), finishedAt(마지막 캡처 시각), kstDate, market: 'KR', session: 'OPEN', coverage, sectors: [{ sectorId, avgPct, read, members }] }` — 회사별 값·가격 없음, 크기 ≤ 32KB.

### 3.5 업로드 (사용자 승인 필요)
- **새 업로드 전용 SSH 키**(ed25519, 위치 `%LOCALAPPDATA%\judoju\naver-watch\keys\upload-ed25519`, 저장소 밖, ACL 현재 사용자만). 서버 `authorized_keys`(0600, ubuntu 소유)에 `command="/home/ubuntu/.local/share/judoju-ai/market/receive.sh",no-pty,no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-user-rc`로 등록 — 이 키로는 그 스크립트만 실행된다. 키 생성·등록은 사용자 승인 후.
- **업로드 명령(예비 키로 새지 않게):** `ssh.exe -i <업로드 키> -o IdentitiesOnly=yes -o IdentityAgent=none -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=<고정 known_hosts> -o HostKeyAlgorithms=ssh-ed25519 -o PasswordAuthentication=no -o ConnectTimeout=10 ubuntu@<서버> < sector-moves.json` — 다른 키·에이전트로 대체 인증하지 않는다. 운영 키 경로는 업로드 설정에 둘 수 없다(설정 검사가 거부).
- **읽기 권한:** 처리기 컨테이너는 `node`(uid 1000, gid 1000)로 돈다. 설치·배포 사전 검사가 서버의 `ubuntu` uid/gid가 1000/1000인지 확인하고 아니면 중단한다. 폴더 `market/`은 ubuntu 소유 0750, 파일은 0640(그룹 1000 읽기) — 다른 사용자는 읽을 수 없다. 배포 후 컨테이너 안에서 파일 읽기 확인(파일이 있으면).
- `receive.sh`(저장소 `scripts/ops/naver-watch/receive.sh`, 설치 시 ubuntu 소유 0755): 표준 입력을 최대 32KB까지 읽어 같은 폴더의 임시 파일(0640)에 쓰고, 대상이 심볼릭 링크면 거부, `mv`로 `sector-moves.json` 교체. 인자·환경변수를 쓰지 않는다. 서버 호스트 키는 기존 고정 known_hosts.
- 처리기(읽기 전용 마운트 `/run/market/sector-moves.json`)는 사용 전 검사: 크기, JSON 형식, format, `membershipSha256`·`masterSha256`이 처리기에 배포된 두 파일과 같음, **섹터 집합이 멤버십 파일의 56개와 정확히 같고 각 한 번**(빠짐·추가·중복 거부), 섹터마다 `members` = 멤버십 파일의 회사 수, 0 ≤ read ≤ members, avgPct는 (read ≥ 0.7×members 이고 read ≥ min(3, members))일 때 유한·|값| ≤ 30, 아니면 null이어야 함, 시각 형식(ISO UTC), **at ≤ finishedAt ≤ 수신 시각(파일 mtime) ≤ 지금**, finishedAt − at ≤ 120초, 지금 − finishedAt ≤ 15분, kstDate = finishedAt의 KST 날짜. 오래된 파일을 다시 보내 mtime만 새로워져도 finishedAt 검사로 거부된다. 하나라도 실패하면 무시(US 모드처럼 동작)하고 사유 카운트만.

### 3.6 변경 파일 목록

- P3: `supabase/migrations/<새 번호>_catalog_macro_filter.sql`, `scripts/catalog/public-route.mjs`, `apps/mobile/src/components/SectorFilter.tsx`, `apps/mobile/src/components/NewsFeed.tsx`, `apps/mobile/src/data/catalog-filter.mjs`, `apps/mobile/src/data/CatalogContext.tsx`, 시험 `scripts/test-catalog-macro-sql.mjs`(로컬 DB 트랜잭션 후 되돌림 + 로컬 PostgREST로 옛·새 RPC 시그니처 호출), `tests/catalog-macro-route.test.mjs`.
- P2: `scripts/tools/sector-queries.mjs`, `data/sector-queries.json`, `workers/ai-processing/runtime/gnews.mjs`(칸별 호출·즉시 기록), `market.mjs`(신규: sector-moves 검사·모드), `service.mjs`, `store.mjs`(news_signal_topics, gnews_queries), `news-report.mjs`, `scripts/ops/ai-processor.ps1`(깨끗한 트리 검사와 `git archive` 목록 모두에 `data/sector-queries.json`·`data/stock-master.json`·`data/sector-members.json`, compose에 `market/` 읽기 전용 마운트), 시험 `tests/sector-queries.test.mjs`, `tests/gnews-sector.test.mjs`, `tests/market-moves.test.mjs`.
- P1: `scripts/tools/stock-master.mjs`, `data/stock-master.json`, `scripts/tools/sector-members.mjs`, `data/sector-members.json`, 시험 `tests/stock-master.test.mjs`(스키마·재생성 바이트 동일·입력 해시), 설치 스크립트의 uid/gid·권한 사전 검사, `scripts/ops/naver-watch/{ocr.ps1, parse.mjs, round.mjs(병합·시장 상태·섹터 등락·출력), capture.ps1, upload.ps1, receive.sh, install.ps1(작업 스케줄러 등록·상태·제거, 키 생성 안내), config.example.json}`, 시험 `tests/naver-watch.test.mjs`(파서·병합·시장 상태·섹터 등락·출력 형식), `tests/naver-watch-files.test.mjs`(설정 검사: 운영 키 거부·업로드 옵션 문자열, 작업 폴더 정리: 성공·예외·시작 시 남은 폴더).
- 모든 새 시험은 `scripts/verify-integration.mjs` 목록에 추가.

## 4. 시험 (모두 `verify-integration.mjs` 목록에 추가)

- P3: DB 함수(없음/섹터만/매크로만/매크로+섹터/COMPANY 제외/영향 없는 MACRO/옛 시그니처 동일 결과), 게이트웨이(`macro` 값 검증, 커서 해시 — macro 없으면 옛 해시와 동일, 옛 커서 유효), 공개 응답에 새 필드 없음, 앱 필터 라벨·해제·초기화.
- 신뢰 기준: 코드 상수 = 배포 파일 sha(세 파일), 쿼리 파일을 1바이트 바꾸면 섹터·매크로 검색만 꺼지고 헤드라인·주제 검색은 계속, 멤버십·마스터 파일이나 업로드 해시가 상수와 다르면 시세 입력을 거부하고 US 모드.
- 직전 회차 기준 파일: 위치 하나만(다른 파일 없음), 임시 파일 후 원자적 교체, 7일 넘은 파일 삭제, `install.ps1 -Remove`가 삭제, 손상(잘린 JSON·스키마 위반·마스터 밖 회사·0 이하 가격) → 삭제 후 BASELINE·업로드 없음, 폴더·링크 → 따라가지 않고 실패.
- P2: 쿼리 파일 생성(기준 hold 집합 일치·불일치 시 실패, 재생성 바이트 동일, 해시, 공유어 제외, 따옴표, 길이), 매크로 칸 순환(가장 오래된 시도), 신호·topic 같은 트랜잭션(중간 실패 시 둘 다 롤백, 신호 삭제 시 topic 삭제), 같은 URL이 두 쿼리에 걸림, 옛 DB 열기(새 표 생성·재열기 무변화), KR/US 모드(신선/오래됨/CLOSED/검사 실패/파일 없음), 회차 칸 구성(홀짝), 6시간 굶김 방지, 등락 순서, 호출 1~6 중 실패 시 나머지 계속·성공분 저장, 원장 895~900, UTC 날짜 넘김, 키가 URL에 없음.
- P1: 파서(보내준 캡처 OCR 픽스처: 마스터 기준 9행 모두 정확·틀린 행 0, `0/1050` 이름 보정, 마스터에 없는 코드 버림, 이름·코드 충돌 버림, 등락률 OCR 불일치·판독 불가 버림, 부호 색, 머리글 없음 실패), 병합(겹침 동일/불일치), 시장 상태(값 변화 없음 → CLOSED), 섹터 등락(70%·min(3,N)·null·회사 값 미포함·80% 미만 업로드 안 함), 서버 검사(avgPct null/숫자 규칙: 기준 미달 섹터 null 허용·기준 충족인데 null 거부·기준 미달인데 숫자 거부, 섹터 빠짐·추가·중복·members 불일치, 멤버십·마스터 해시 불일치, 크기 초과·미래·오래됨·오래된 내용을 새 mtime으로 재전송·at>finishedAt·120초 초과·kstDate 불일치·중복 섹터), 수신 스크립트(32KB 초과 거부·심볼릭 링크 거부·원자 교체; 리눅스 셸 시험은 서버 설치 때 실행), 업로드 설정(운영 키 거부, ssh 옵션에 IdentitiesOnly·IdentityAgent=none·BatchMode·StrictHostKeyChecking), 시장 상태(처음 실행 → BASELINE·업로드 안 함, 같은 날 변화 없음 → CLOSED, 날짜 바뀐 첫 회차 95% 동일 → CLOSED, 공통 50% 미만 → 판단 불가), 목록 최대 장 수 도달 → 실패, 공개 응답·상태에 회사별 값 없음.

## 5. 위험

- 네이버 화면 구조가 바뀌면 파싱 실패 → 업로드 안 함, 처리기는 US 모드 순서로 계속.
- 캡처가 PC 사용을 방해할 수 있음 → 사용자가 작업 스케줄러에서 끄거나 간격 조정.
- 네이버 약관(자동화) 위험은 사용자가 감수. 한투 Open API가 생기면 P1을 교체하고 캡처는 끈다.
