# AI 초안 → 앱 DB 게시 경로 설계 (2026-11-27)

## 목표

AWS AI 처리기가 만든 검증 통과 초안(`DRAFT_READY`)을 앱 DB(Supabase)의 **편집 초안**으로 넣고, 사람이 어드민에서 검토한 뒤 게시한다. AI는 게시하지 않는다(`publicationAuthorized: false` 유지).

```
수집기 ─▶ AI 처리기(AWS)                 앱 DB(Supabase)                       앱
          선별·추출·작성·독립검증 ─(1)─▶ AI 초안 접수 RPC ─▶ 편집 초안(DRAFT)
          DRAFT_READY                    사실→claims, 출처→sources            │
                                                                              ▼
                                         어드민 검토 ─(2)─▶ m1_publish_draft ─▶ 공개 읽기 ─▶ 앱
          출처 철회·보관 만료 ─(3)─▶ 철회 요청 ─▶ 숨김/정정 대기
```

## 지금 막혀 있는 것 (DB 쪽)

| 막힘 | 위치 | 필요한 변경 |
|---|---|---|
| 합성 데이터만 허용 | `sample_kind='SYNTHETIC'` 조건(이슈·사실·공개 읽기), 출처 URL은 `https://*.invalid`만 | **실데이터 모드**: `PERMITTED_REAL` 허용. 출처 URL은 허가된 호스트(예: `dart.fss.or.kr`)만. 환경별 스위치 |
| 사실(claims) 연결 없음 | 게시 검증이 영향 경로마다 `verified`·`korea_path_verified`·`fact_current` 사실을 요구 | AI 사실 → `private.claims` + `evidence_edges` 매핑 |
| 섹터 영향 없는 종목 이슈 | 게시 검증이 영향 1개 이상과 대표 섹터를 요구 | COMPANY는 영향 0개 허용(대표 기업·company_refs 필수) |
| AI 초안 접수 경로 없음 | 편집 초안은 어드민 로그인 사용자만 저장 | 전용 접수 RPC + 최소 권한 DB 역할 |

기존 설계 자산: `workers/ai-processing/sql/proposal-outbox-v1.sql`, `proposal-draft-apply-v1.sql`(AI 제안 → 편집 초안 적용, 합성 시험용). 이번 경로는 이 구조를 실데이터용으로 이어받는다.

## 구성

### (1) 접수: AI 처리기 → DB

- **방식(권장): 푸시.** AI 처리기가 `DRAFT_READY`가 되면 DB의 `ai_submit_draft_v1(effect_key, payload)` RPC를 호출한다.
  - 전용 DB 역할 하나에 이 RPC 실행 권한만 준다. 서비스 키는 쓰지 않는다.
  - 접속 정보는 AWS의 비밀 파일(읽기 전용 마운트)에 두고, 로그·채팅에 출력하지 않는다.
- **같은 초안 재전송 방지**: `effect_key = 이슈 ID + 초안 버전 해시`로 한 번만 반영한다. 재전송은 같은 결과를 돌려준다.
- **대안: 풀.** 운영 스크립트가 SSH로 서버 초안을 가져와 넣는다. 키가 늘지 않지만 사람이 실행해야 한다. 1단계 로컬 시험에 쓴다.

### 매핑 (AI 초안 → 편집 초안)

| AI 초안 | 편집 초안 / DB |
|---|---|
| `title`, `summary`, `key_issues[].text`, `issue_analysis.text`, `risks[].text` | 같은 이름 필드(문자열) |
| `article_kind` (SECTOR / COMPANY / MACRO) | `article_kind`. COMPANY는 피드 제외(마이그레이션 51) |
| `primary_company_ref`, `company_refs` | 같은 이름(마이그레이션 51) |
| `impacts[]`: 섹터·방향·설명·조건 | `impacts[]`: `sector_id`, `path_id`(카테고리+순번), `direction`, `description`, `conditions`, `evidence_ids`(claims) |
| `impacts[].companyRoles` | `impacts[].companies:[{company_ref, role}]`(마이그레이션 54) |
| 대표 섹터 | SECTOR: 첫 수혜→피해 섹터. COMPANY: 영향 섹터가 있으면 그 섹터, 없으면 없음 |
| `scenarios[]` | `scenarios[]` + `path_ids`(해당 방향 영향 경로) |
| `source_refs[]`: 이름·URL·역할 | `sources[]`: `name`, `url`, `role`(PRIMARY/REPORTED) |
| `facts[]` + 독립 검증 결과 | `private.claims`: `verified`(독립 검증 통과), `korea_path_verified`, `fact_current`, `official_original`(PRIMARY), `valid_until`(사실 기록 만료 = 30일) |
| `fact_provenance` | `evidence_edges`(출처별 연결) |
| `disclaimer` | 공개 본문 고지(앱은 이미 표시) |

### (2) 검토와 게시

- 어드민 초안 목록에 **"AI 초안"** 표시를 붙인다. 근거 사실, 출처 구분(1차·보도), 독립 검증 결과를 함께 보여준다.
- 편집자는 문장을 고치거나 그대로 게시한다. 게시는 기존 `m1_publish_draft`를 쓰고, 게시 검증(근거·섹터·시나리오 규칙)을 그대로 통과해야 한다.
- 처음에는 **사람 승인 필수**로 운영한다. 자동 게시는 품질 데이터가 쌓인 뒤 따로 결정한다.

### (3) 철회와 보관

- AI 쪽에서 출처가 철회되면(`HOLD_SOURCE_REVOKED`) 철회 요청을 보낸다.
  - 미게시 초안이면 삭제한다.
  - 게시된 기사면 `CORRECTION_PENDING`(숨김)으로 바꾸고 편집자에게 알린다.
- DB에는 원문 본문을 넣지 않는다. 사실 문장, 짧은 인용, 출처 링크만 넣는다(기존 보관 규칙과 같다).
- 미게시 AI 초안은 30일 뒤 정리한다.

## 단계

| 단계 | 범위 | 새 키·계정 | 결과 |
|---|---|---|---|
| **1. 로컬** | 매핑 모듈과 테스트. 로컬 DB에 실데이터 모드·COMPANY 영향 0개·접수 RPC 마이그레이션. 서버 초안 9건을 풀 방식으로 넣고, 어드민에서 검토하고, 앱 웹에서 확인 | 없음 | 실제 초안이 로컬 앱에 뜨는 것 확인 |
| **2. 클라우드 미리보기** | 마이그레이션 51~55와 신규를 미리보기 DB에 적용. 접수 전용 DB 역할 생성. AI 처리기 푸시 연결 | **DB 역할 1개(사용자 승인)** | 내부 미리보기 앱에서 매일 실제 초안 검토 |
| **3. 운영** | 운영 DB 적용, 게시 운영 규칙 확정 | 운영용 역할(사용자 승인) | 공개 서비스 |

## 사용자가 정할 것

1. **첫 적용 환경**: 로컬에서 시작해 클라우드 미리보기까지(권장) / 로컬만 먼저.
2. **게시 승인**: 사람이 승인해야 게시(권장) / 검증 통과 시 자동 게시.
3. **접수 방식**: AWS에서 DB로 푸시(권장, 2단계에서 전용 DB 역할 생성 필요) / 운영 스크립트로 가져오기.
4. **섹터 영향 없는 종목 기사**: DB에서 허용(권장) / 회사의 카탈로그 소속 섹터를 대표 섹터로 붙임.
