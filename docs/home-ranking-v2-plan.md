# 홈 순위 v2 설계안 (2026-11-28, rev 5 — 검수 대기 제안)

사용자 지시: "홈 순위는 로직을 새로 짜야 할 것 같고"(2026-11-28), 수집 출처 확정(Finlight·GNews·기업 보도자료/IR·DART·텔레그램) 뒤 진행.

**지위:** `docs/reference/planning/홈순위-운영개정안-v1.0-20261115.md`(v1.0)의 개정 제안이다. **승인 후에는 아래 "대체 조항"에 적은 부분만 v1.0 §4·§6의 해당 내용을 대체하고, v1.0의 나머지 조항은 모두 그대로 권위를 가진다**(5분 cutoff, 08:10/20:00 시장 전환, A/B/C, 안정화, Story당 1카드, 정정·숨김 즉시 제거, ACTIVE/CHECK_PENDING 상태 등). 사용자 최신 지시는 둘 모두에 우선한다.

**대체 조항 (실데이터 모드 한정, 검수 후):**
- v1.0 §4 파급력 등급의 **산출 주체**: 작성 단계 모델이 이슈 전체 근거로 등급을 매기고 독립 검증 모델이 항목별 근거를 확인한다(§3.1).
- v1.0 §6 보조 점수: T·M·P(모두 off) 대신 공식 근거 E와 최신성 F를 쓴다. 뉴스 확산 N은 R1에서 **진단값만** 기록하고 점수에 넣지 않는다(§3.2, §8).

## 1. 왜 바꾸나

- v1.0 엔진(`workers/home-ranking`, `packages/domain/src/home-ranking.ts`)은 합성 데이터 전용이다. 근거 claim에 묶인 파급력 등급(I)이 필요하지만 실제 AI 초안에는 없다. 그래서 실데이터 홈에는 순위가 없고 기간별 목록만 있다.
- T(검색)·M(주가)·P(조회수)는 공급·표본이 없어 off다. 쓸 수 있는 보조 입력은 F뿐이었다.
- 새 입력: 공식 근거 문서(DART·기업 사이트), 뉴스 신호(Finlight·GNews 헤드라인·종목코드, 텔레그램 뉴스 링크의 언론사·시각).

## 2. 원칙 (v1.0 유지)

1. 순위 중심은 한국 시장 파급력. 뉴스량·조회수·주가는 파급력 구간을 넘지 못한다.
2. 근거 없는 높은 등급 금지. 확인할 수 없는 항목은 보수적으로 낮춘다.
3. 공개 화면에 점수·건수를 보이지 않는다.
4. 종목 이슈(COMPANY)는 홈 후보가 아니다(2026-11-27). 후보는 SECTOR·MACRO.
5. 뉴스 본문은 읽지 않는다(결정 B).

## 3. 입력

### 3.1 파급력 I — 이슈 단위 평가

- **산출 시점:** 작성(draft) 단계. 작성 모델은 같은 Story의 전체 문서·사실(최대 8개 선별)을 받으므로 처리 순서와 무관하게 이슈 버전마다 하나의 평가가 나온다. 선별 단계에는 등급을 두지 않는다.
- **출력:** 초안 응답에 `impact_grades: { transmission, scope, magnitude, durability }`, 각 `{ grade: 0~5 정수, factIds: [정식 사실 ID] }`. 사실 ID는 작성 단계가 이미 쓰는 정식 ID(검증된 facts의 id)라 지역 ID 변환이 없다.
- **코드 검증(`validateImpactGrades`):**
  - grade는 0~5 정수, factIds는 중복 없이 해당 이슈 facts에 있어야 하고, grade ≥1이면 1개 이상.
  - magnitude·durability ≥3: 근거 사실 중 하나가 1차 출처(문서 출처 kind OFFICIAL: DART·기업 사이트·정부) 문서에서 나와야 한다. 아니면 2로 낮춘다.
  - scope는 구조 상한을 넘지 못한다(아래 모든 상한은 **낮추기만** 한다: 최종 = min(모델 등급, 구조 상한, 검증 상한)). 영향 집합 = impacts 중 BENEFIT·DAMAGE 항목, 회사 집합 = 그 항목들의 companyIds 합집합.
    - 영향 집합이 비면 상한 0. 회사가 1개 이하면 상한 1(개별 기업).
    - 섹터 1개에 회사 2개 이상이면 상한 3(한 섹터의 복수 기업). 그 밖의 회사 2개 이상은 상한 2.
    - 상한 4(독립 복수 섹터): 서로 회사 집합이 겹치지 않는 섹터가 2개 이상이고 각 섹터에 회사가 1개 이상. 겹치는 섹터만 여럿이면 3.
    - 상한 5(시장 전반): article_kind MACRO이고, 시장 전반 영향을 밝힌 1차 출처(정부·규제기관·거래소) 사실이 근거 factIds에 있고, 검증 모델이 scope를 지지할 때만. 아니면 MACRO는 상한 3.
  - transmission ≥3: 검증 모델 지지 필요. 아니면 min(등급, 2)(→ effective_I 상한 44, 상위 자격 없음).
  - 낮춘 항목과 사유(`caps`)를 기록한다. 초안 자체는 막지 않는다.
- **독립 검증:** 검증 응답에 `gradeSupport: { transmission, scope, magnitude, durability }`(각 SUPPORTED|UNSUPPORTED)를 추가한다. UNSUPPORTED 항목은 min(등급, 2). 검증 실패 조건(기존 approved 등)은 바뀌지 않는다.
- magnitude·durability의 1차 출처 상한도 min(등급, 2)이다. 어떤 상한도 등급을 올리지 않는다.
- **계산:** raw_I = 8·T + 4·S + 5·M + 3·D (0~100, 낮춘 뒤 등급 기준). transmission<3이면 effective_I = min(raw_I, 44). **I = effective_I / 100 (0~1).**
- **구간:** HIGH(effective_I ≥75), MEDIUM(45~74), STANDARD(<45).
- **기록:** 새 열 `issues.ranking`(JSON, 초안 payload와 분리)의 `assessment = { grades, caps, gradeSupport, rawI, effectiveI, band, promptVersion: 'V14', configHash, docIds, factIds, assessedAt }`.
- **프롬프트·캐시:** 작성·검증 프롬프트 V14, 모델 실행 키의 `BACKLOG_PROMPTS_V13` → `V14`(`pipeline.mjs`). V13 캐시 응답은 새 키라 재사용되지 않는다. 기존 이슈는 다시 돌리지 않는다(평가 없음 → §4.3).
- **비용:** 호출 수는 그대로. 작성 출력이 항목당 약 30~40토큰, 총 약 150토큰 늘고 검증 출력은 약 30토큰 늘어난다(작성 상한 6,000토큰 안). 3일 동안 작성 출력 토큰, HOLD 비율(형식 실패 포함), 하루 호출 수를 기록해 STATUS에 남긴다. 형식 실패가 늘면 V14를 되돌린다.

### 3.2 뉴스 확산 N — R1은 진단만

`issue_matches`(분석 순서 앞당김용)는 같은 회사의 모든 대기 문서에 연결되므로 뉴스↔이슈 근거로 쓰지 않는다. 별도 보수적 연결을 만든다.

- **`signal_issue_links`**(새 표, 기본키 `(issue_id, issue_version, signal_url)`): 이슈 버전이 만들어진 뒤에만 연결한다. 연결 패스마다 한 트랜잭션에서 현재 후보의 현재 버전이 아닌 행(이전 버전·후보에서 빠진 이슈)을 지우고 다시 연결한다. 진단은 `(issue_id, 현재 version)`으로만 읽는다. 같은 angle의 새 버전에서 회사가 바뀌어도 이전 버전 연결은 남지 않는다. **활성 이슈 집합 = §4.5 후보 집합**(연결 시점에 계산: 내보내기 READY, 만료·취소 아님, DRAFT_READY 작업 있음, SECTOR). 연결 규칙(R1):
  - `COMPANY_UNIQUE`: Finlight·GNews 신호가 종목코드(DART 학습 종목코드) 또는 헤드라인 회사명으로 이슈의 회사(impacts의 companyIds)를 가리키고, 보도 시각이 이슈 첫 근거 시각 −1일~+2일이며, **그 회사를 가진 활성 이슈가 Story 기준 정확히 1개**일 때만. 2개 이상이면 `AMBIGUOUS`로 기록하고 연결하지 않는다. MACRO는 연결하지 않는다.
  - 텔레그램 뉴스 링크는 제목이 없으므로 이름 매칭을 하지 않고 R1 진단에도 넣지 않는다. 현재 `news_signals`는 출처별 관측 시각이 없어 채널별 24시간 전달 수를 정확히 셀 수 없다. 채널별 `(url, source_id, observed_at)` 관계와 텔레그램 전달 지표는 R2 계획에서 다룬다.
- **책임 분리:** 연결(`signal_issue_links` 쓰기)은 처리기 서비스가 10분마다 한다. CLI `home-preview`는 DB를 읽기 전용으로 열고 아무것도 쓰지 않는다.
- **상태:** 이슈별 N 상태 `LINKED`(연결 1건 이상), `ZERO`(연결 가능한 이슈인데 신호 없음), `UNLINKABLE`(MACRO, 회사 없는 SECTOR, 회사가 AMBIGUOUS).
- **값(진단):** 출판사 ID = 호스트에서 앞 `www.`·`m.`을 뗀 값 + 큐레이션 별칭 표(같은 회사의 다른 호스트, 초기 비어 있음). outlets24 = 24시간 서로 다른 출판사 수. 속도 n2는 최근 3시간 출판사 3곳 이상일 때만 계산(아니면 null). 해외 여부는 큐레이션 국가 표(`news-report.mjs`의 한국 매체 목록 확장 + .kr)로 판정.
- **점수 반영:** R1에서는 S에 넣지 않는다. 연결 범위(LINKED/ZERO/UNLINKABLE 비율)와 오연결을 3일 실측한 뒤 R2 계획에서 비중을 정한다.

### 3.3 공식 근거 E (0~1)

- **대상 문서:** 평가(assessment)의 네 항목 factIds 합집합 → 그 사실들이 인용한 문서(refs.docId)만. 같은 Story의 다른 문서는 세지 않는다.
- **기관은 출처(원 링크) 단위**로 정한다. 한 문서(본문 해시)가 출처 여러 개를 가지면 출처마다 기관을 정한다.
- **커밋 시 고정:** 원문 제목은 본문 삭제 때 지워지므로, 기관은 `commitDraft` 시점(문서 제목·출처가 아직 있을 때)에 계산해 `issues.ranking.evidence = [{ docId, url, institution }]`와 `institutionBasis = { catalogVersion, configHash }`로 저장한다. 이후 미리보기는 저장된 값만 쓰고 다시 계산하지 않는다.
  - DART 출처(`dart.fss.or.kr`): 문서 제목 앞에 오는 카탈로그 회사명(이름 + 공백) 중 가장 긴 이름을 고르고, 그 이름을 가진 카탈로그 회사가 **정확히 하나**일 때만 `company:<카탈로그 회사 ID>`. 같은 이름의 회사가 둘 이상이거나 일치가 없으면 기관 없음.
  - 기업 사이트 출처: 출처 설정이 OFFICIAL·ENABLED이고 그 `name`이 카탈로그 회사명과 정확히 같으면 `company:<카탈로그 회사 ID>`. 이름이 없거나 다르거나 여러 회사 이름이면 기관 없음. 한 회사의 여러 호스트·DART는 모두 같은 기관이다.
  - 정부·규제기관·거래소: 코드의 고정 허용 목록(`GOV_HOSTS`, 초기 비어 있음 — 지금 정부 출처는 모두 꺼져 있음)에 있는 호스트만 `gov:<호스트>`. 다른 OFFICIAL 출처는 정부로 보지 않는다.
  - 그 밖: 기관 없음(E에 세지 않음).
- E = 서로 다른 기관 수 k로: 0→0, 1→0.5, 2 이상→1. 같은 기관의 여러 문서·출처는 1로 센다.
- scope 5의 "정부·규제기관·거래소 사실"도 같은 `GOV_HOSTS` 기준이다(R1에서는 사실상 MACRO scope 상한 3).
- 증권사 리포트 신호는 E에 넣지 않는다(접속 안 함). 진단으로 리포트 링크 수만 기록.

### 3.4 최신성 F와 material_change_at

- `material_change_at`(이슈 행 = story_key + angle_key 단위): 영향 섹터·방향·범주가 바뀌면 angle_key가 달라져 **새 이슈 행(NEW_ANGLE)**이 되므로 그 행의 첫 버전 생성 시각이 시작값이다. 같은 행의 새 버전은 사실 ID가 추가된 경우에만 생기므로(같은 사실은 DUPLICATE) 그 시각으로 갱신한다. 운영자 재내보내기(exportRequeue, 사실 집합 불변)는 이전 값을 유지한다. 출처 추가·재확인은 버전을 만들지 않으므로 바꾸지 않는다. `issues.ranking.materialChangeAt`에 저장.
- F = 0.5^(경과 시간/6), 0~1.
- V14 이전 이슈(`materialChangeAt` 없음)는 그 이슈 행의 `created_at`을 대신 쓰고 `legacyTime: true`로 표시한다. 이 값은 저장하지 않으며(새 실질 변화로 보이지 않게), 다음 실제 새 버전이 생길 때만 `materialChangeAt`이 기록된다.

## 4. 점수와 정렬 (R1 미리보기)

### 4.1 혼합 점수 (모두 0~1 입력, 결과 0~100)

- MEDIUM·STANDARD: S = 100 × (0.70·I + 0.15·E + 0.15·F)
- HIGH: S_HIGH = 100 × (0.80·I + 0.10·E + 0.10·F)
- 모든 입력이 [0,1]인지, S가 [0,100]인지 검사한다(벗어나면 그 이슈는 `RANK_INPUT_INVALID`로 제외하고 기록).

### 4.2 정렬

구간 → S → material_change_at(최근 우선) → 이슈 ID. 구간은 I로만 정해진다.

**Story 대표:** 같은 story_key의 후보 행(각 angle_key 행)을 위 순서로 정렬해 첫 행을 대표로 쓰고, 나머지 행은 미리보기에서 `sameStory`로만 표시한다. 버전 번호는 angle별이라 비교에 쓰지 않는다. 모두 같으면 이슈 ID 순.

### 4.3 I 없음

평가 없는 이슈(V14 이전 또는 평가 실패)는 STANDARD 맨 뒤에 두고 S를 계산하지 않는다. 그들끼리는 시각(§3.4: materialChangeAt, 없으면 created_at) 최근 우선 → 이슈 ID.

### 4.4 R1은 상태 없는 진단

R1 미리보기는 매번 현재 상태로 새로 정렬한다. v1.0의 안정화(5점·2회), carry_order, A/B/C 자격(ACTIVE·evidence_valid_until)은 R2에서 클라우드 스냅샷과 함께 구현한다. R1 출력에는 "진단용, 공개 순위 아님"을 표시한다.

### 4.5 후보 (R1)

처리기 DB의 이슈 행 중 현재 버전의 내보내기가 READY이고(취소·만료 제외), 그 버전의 DRAFT_READY 작업이 있으며, article_kind가 SECTOR·MACRO인 것. Story당 하나는 §4.2의 대표 규칙으로 고른다.

## 5. 단계

| 단계 | 범위 | 외부 영향 |
| --- | --- | --- |
| R1 | 처리기: V14 작성·검증 등급, `validateImpactGrades`, material_change_at, E, `signal_issue_links`와 N 진단, 내보내기 스냅샷 최상위 `ranking`(클라우드 매퍼는 의도적으로 제외), 읽기 전용 CLI `home-preview` | 처리기만. 클라우드 요청 바이트 불변 |
| R2 | 클라우드: `AI_DRAFT_V1` 다음 버전 또는 별도 접수로 ranking 전달, 5분 스냅샷·안정화·A/B/C, 실데이터 `/v2/home` | dev DB 함수·표 추가, 별도 계획·검수 |
| R3 | 어드민 순위 진단 | 어드민 |

## 6. R1 상세

- `editorial.mjs`: draft·verify 스키마에 impact_grades·gradeSupport, `validateImpactGrades(draft, verification, facts, documents, articleKind, impacts)` → assessment.
- `model.mjs`: 프롬프트 V14(등급 기준표 = v1.0 §4 표, "주가·뉴스량으로 등급을 올리지 말 것, 정식 사실 ID를 붙일 것", 검증 모델은 항목별 지지 여부).
- `pipeline.mjs`: 모델 키 V14, 검증 통과 후 assessment를 commitDraft에 넘긴다.
- `store.mjs`: `issues.ranking` 열 추가. commitDraft가 §3.4 규칙으로 `materialChangeAt`을 정하고 §3.3 기관을 계산해 `{ assessment, materialChangeAt, evidence, institutionBasis }`를 저장하고, 내보내기 스냅샷(`draft_exports.payload`) **최상위**에 `ranking`을 같은 값으로 넣는다(`draft` 안에는 넣지 않음). `signal_issue_links` 표.
- `ranking.mjs`(신규, 순수 함수 위주): `evidenceScore(sources)`, `freshness(materialChangeAt, now)`, `rankPreview(candidates, now)`, `institutionOf(source, document, config)`, `linkSignals(db, candidates, now)`(서비스 전용, signal_issue_links 갱신), `attentionDiagnostics(db, issueId, version, now)`(읽기만).
- `publish-map.mjs`: 변경 없음. 시험으로 `ranking`이 클라우드 요청에 들어가지 않음을 확인하고, `AI_DRAFT_V1`에 섞이면 클라우드 검증기처럼 거절되는지(기존 엄격 필드 검사)를 확인.
- `cli.mjs home-preview --db DB --config FILE`: `DatabaseSync(readOnly)`로 열고 쓰지 않는다. 제목·구간·S·I 항목·E·N 상태만(URL·본문 없음).
- `service.mjs`: 10분마다 `linkSignals`.

## 7. 시험

- 점수: 입력·결과 범위, 구간 경계(74/75, 44/45), transmission<3 상한 44, HIGH/일반 산식, 5점 차이 경계값 계산.
- 등급 검증: 정수·범위·중복·없는 사실 ID, grade≥1인데 근거 없음, 1차 출처 없는 규모·지속성 3 → 2, 상한이 등급을 올리지 않음(등급 1 + UNSUPPORTED → 1).
- scope: 회사 1개인데 3 → 1, 한 섹터 복수 기업 4 → 3, 회사가 겹치는 두 섹터 4 → 3, 겹치지 않는 두 섹터 4 유지, MACRO 5인데 정부·거래소 사실 없음 → 3, 비MACRO 5 → 상한 이하.
- 결정성: 같은 Story 문서 처리 순서를 바꿔도 같은 입력이면 같은 assessment.
- 캐시: V13 키로 저장된 응답이 V14 실행에서 재사용되지 않음.
- material_change_at: 같은 행에 사실 추가 새 버전 → 갱신, 재내보내기(exportRequeue) → 유지, 방향 변경은 새 행(NEW_ANGLE)이 생기고 그 행의 생성 시각, 기존 행 값은 그대로.
- 후보: 취소·만료·COMPANY 제외, Story당 1개, 평가 없는 이슈는 STANDARD 맨 뒤.
- E: DART 제목의 회사명이 카탈로그에 둘 이상이면 기관 없음, 본문 삭제(제목 지워짐) 뒤 미리보기도 커밋 때 저장한 기관 사용, 같은 회사의 DART와 기업 사이트(호스트 2개 포함)는 기관 1, 회사 둘 → 1, 한 문서에 출처 2개(다른 회사)면 기관 2, 이름 없는/여러 회사 이름의 OFFICIAL 출처는 미포함, GOV_HOSTS 밖 OFFICIAL은 정부 아님, 평가가 인용하지 않은 Story 문서는 미포함, 리포트 미포함.
- 시각: V14 이전 이슈는 created_at 대체·legacyTime 표시·저장 안 함.
- Story 대표: 한 Story의 angle 행 둘 중 구간·S가 높은 행이 대표, 나머지는 sameStory, 동점은 이슈 ID.
- N 진단: 같은 angle 새 버전(회사 변경) 뒤 이전 버전 연결 삭제·진단은 현재 버전만, 활성 집합은 §4.5 후보와 같음, 같은 회사 활성 Story 2개면 AMBIGUOUS, 시간 창 밖 신호는 연결 안 됨, MACRO·회사 없는 SECTOR는 UNLINKABLE, 텔레그램 링크는 연결·집계 없음, 속도 표본 3곳 미만 null, 출판사 별칭.
- CLI 읽기 전용: `home-preview` 실행 전후 DB 파일 수정 시각 불변, 표 생성 없음(`news-report` 시험과 같은 방식).
- 클라우드 경계: 내보내기에 ranking이 있어도 `publish-map` 결과 바이트가 이전과 같음.

## 8. 하지 않는 것

- 주가·검색량·조회수, 공개 점수, 뉴스 본문, 증권사 사이트 접속, 기존 이슈 재평가(비용), R1의 클라우드·공개 홈 변경, N의 점수 반영(R2에서 실측 후 결정).
