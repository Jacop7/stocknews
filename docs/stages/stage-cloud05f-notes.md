# CLOUD05F — 개발 M1 적용 기록

현재 기록은 docs/development-status.json#cloudM1 및 supabase/cloud/m1-dev/adoption.json이다. supersedes selectors는 현재 source4행·snapshot·pending21–50 범위만 갱신한다. 기존 cloudCore와 cloud:core:inspect는 실제 적용이 더 이른 core3행의 역사자료이며 그대로 유지한다. liveVerified=false이고 네트워크·SQL 실행0이다. 두 fingerprint는 데이터44table범위와47table범위로 구분한다. 새 source는 실제 적용된443028bytes/857eef2a… 그대로이고 config·실행기를 포함하지 않는다. 원본local50이나 기존cloud source를 재적용하지 않는다.

E의 원래 실행기·wire·intent와 이후 읽기 전용 복구 revision은 서로 다른 증거다. 관리 AuthUID/테이블·열/정책/trigger는 전후 비교됐지만 Auth namespace의 owner/ACL은 적용 전 기록이 없어 역사적 불변이 NOT_ESTABLISHED다. 현재 owner supabase_admin·effectiveACL10 관측SHA만 보관한다. 원래 전체Auth 비교는 commit뒤였다는 시간차 한계도 남긴다. namespace현재값이나 합성fixture를 과거증거로 바꾸지 않는다. 다음 원격 단계는 현재namespace파일 존재와SHA를 필수로 검사하고 fullAuth+namespace를 자기 before/transaction/after 계약에 고정한다(CLOUD05E-IMPL-P3-002). 이 단계는 원격 호출0이다.

새 foundation validator는 기준Git380blob 중378동결,2정확한추가,6신규 총386을 검사한다. 이전 validator를 새집합에 실행한 것처럼 표시하지 않는다. 기존23verify그룹과 package/lock/root50/앱/admin/worker/이전계약은 모두 동결이며, foundation 분기에 새 검사가 추가된다. 원본ref17개와 fullclone의 대응mirror집합은 별도로 검증하고 clone-only ref를 원본에 만들지 않는다. 기존ref를 지우거나 재작성하지 않는다.

CL05FP-01: 부정검사는 별도 owned checkout에서 수행하며 outputs/development-stages/reviews/cloud05f-implementation/negative-tests.json에 각 사례·기대실패·기대거부사유·복구결과를 고정한다. 이는 제품내 지속 회귀시험이 아니라 이번 검수 증거다. 다음 validator변경 단계는 이 고정 사례를 회귀시험으로 계승해야 한다. 정상 후보와 독립 full clone에서 frozen lockfile install 및 전체23그룹 verify 후 결과DUAL을 받는다. 그 뒤 일반 commit/featurepush/mainFFpush하고 결과를 외부outputs에 기록한다. 검수bytes를 결과기록 때문에 바꾸지 않는다.

M2false/112RIGHTSHOLD/iPhoneUSER_DEFERRED, 실제뉴스·AI·시세·푸시 미연결이다. 이 기록은 운영 서비스 완료를 의미하지 않는다. 다음은21–50disabled source 준비 및 별도 least-privilege gateway와 worker 연결 계획이다.
