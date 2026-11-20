# PARALLEL4 G0A — 공통 계약 구현 준비

승인 근거: 4개 병렬 개발 계획 r3 DUAL READY (manifest f2639973c41691d3b91cea12220d11a509db178e866f3cce598077b0a6ae7077), 이후 사용자 진행 요청. 이번 범위는 MAIN의 독립적인 합성 데이터 계약 준비다. 전체 G0/K1 완료나 네 작업 가동 결과가 아니다.

## 변경 범위

SourceRevision → ProcessingDecision → Draft → RankingSnapshotDraft DTO와 유한 크기의 JSON 검증, 정책/카탈로그 버전, effect 멱등성, checkpoint CAS, 초안 버전 충돌, snapshot 저장과 latest CAS 분리. 모든 결과는 SYNTHETIC / MEMORY_FIXTURE_ONLY이며 실사이트·AI·DB·게시를 호출할 구현이 없다. 공식 증거 여부·독립 출처 판정은 입력 합성자료의 모형이며 실제 사실 확인 결과가 아니다. payloadHash/completionDigest는 형식 및 동일성 비교에 사용하며 실제 콘텐츠 해시 계산·완료 서명 인증은 MAIN의 후속 어댑터 책임이다.

읽기/쓰기 포트: appendSourceRevision, readCheckpoint, compareAndSwapCheckpoint, proposeDecision, saveDraftExpectedVersion/readDraft, saveSnapshotDraft, compareAndSwapLatest/readLatest, resolveEffect. SourceDocument ID와 source/native 쌍은 1:1, source revision 재처리와 metadata 변경은 구분한다. HOLD는 기한·재판정 조건을 가져야 한다. 직접 실제 모드로 바꾸는 옵션은 제공하지 않는다.

현재 visibleSections는 필드 값만 검증한다. 긍정/혼합/피해 전용 노출 의미, 저작권·유사성·수집권한, 자동 근거검증, 실자료 검색, 시간대 기반 점수 계산은 후속 AI/순위 작업과 MAIN 통합 검증 책임이다. 완성되었다고 간주하지 않는다. HIGH carry는 과거 완료 스냅샷을 별도 필드로 전달하되 점수척도·서명·정책 일치와 M=null을 구조 검사한다. 실제 완료 이력·완료 해시 인증은 구현되지 않았다.

## 기존 검사 보존

553a14e의 441개 Git blob을 원문 해시로 보존한다. 선언한 6개 파일만 변경하고 10개 파일을 추가한다. 기존 CLOUD11A 및 이전 검증기는 수정하지 않는다. 새 단계 검증기를 명시 분기하며 기존 26개 실행 그룹에 계약/준비상태 2개 그룹을 추가한다. 기존 package 명령·의존성과 lockfile은 유지한다. 현재 main 및 이전 refs는 고정한다. 새 feature 한 child만 허용하며 이번 단계는 worktree/새 포크 허가가 아니다.

## 미활성 경계 및 다음 인수

실제 자식별 읽기·환경·MCP/브라우저 제어 격리가 확인되지 않았다. CLI sandbox만으로 전체 채팅 격리라고 판단하지 않는다. parallel4Readiness는 항상 HOLD_NOT_ACTIVATED이며 경로 allowlist 검사는 변경 범위 진단에 불과하다. 코드로 비밀정보를 차단했다고 주장하지 않는다. K1 전체 golden, task별 검수 위임, 네 작성자 모델계획·exact routing Decision, worktree/ref 전환 검증 후 실제 병렬 착수 여부를 판단한다. 기존 관리자 CL11AI01 로그인 실패 잔여 세션 정리·전용 호스트·활성화 실행기는 계속 미완료다. 관리자 계정·DB 연결·운영 worker·M2 완료도 주장하지 않는다.

공통 계약 모듈은 현재 앱 barrel에 연결하지 않는다. Node 합성 worker 계약 준비 모듈이며 앱 소비·게시 경로는 후속 MAIN 인수 때 별도 검증한다.

## r2 검수 보완

모든 연결 식별자는 공통 pipelineId(ASCII 영숫자 및 `_ . : -`, 1~160자)를 쓰며 저장·조회·CAS·효과 확인에서 같은 규칙을 적용한다. canonicalUrl은 URL 변환 전에 길이 2,048 이하 문자열인지 검사한다. latest cutoff는 문자열 순서가 아닌 epoch로 비교해 같은 순간의 `Z`/`.000Z` 표기나 과거 회차가 현재 latest를 덮지 못한다.

proposeDecision의 evidence origin/group은 해당 저장 판본의 origin/independenceGroup과 같아야 한다. null을 AI가 임의 값으로 바꾸지 못한다. official/verified는 여전히 합성 입력 플래그이며 실제 검증 권한을 부여하지 않는다. draft evidenceVersion도 선택된 COLLECT 판단의 버전과 같아야 한다.

source revision 번호는 도착 순번일 뿐 최신성 순위가 아니다. readSourceRevision은 판본의 원 시각을 그대로 반환한다. 늦게 온 구판본도 손실 없이 보관하며 source 최신 판정은 후속 K1 소비자가 updatedAt 우선, 그 값이 없으면 publishedAt, 둘 다 없으면 PENDING_TIME으로 처리하고 동일 시각 충돌은 보류해야 한다. 이 소비자 최신 선택·정정 역행 방지의 전체 golden은 아직 G0 잔여 항목이다. 이번 시험은 구판본 보존과 원 시각·조회 불변성까지 확인한다.

r3: decision과 draft를 연결하는 evidenceVersion도 두 DTO 모두 pipelineId 규칙을 적용한다. slash·공백·한글·길이 초과는 판단 저장 전에 거부하고, 허용된 버전은 판단→초안 저장까지 같은 값으로 전달한다.
