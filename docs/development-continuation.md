# 개발 작업 재개

프로젝트 Git 작업 트리에서 Python 3.11 이상과 `.node-version`에 지정된 Node.js로 실행한다.

```powershell
python -B scripts/development-continuation.py resume
python -B scripts/development-continuation.py status
```

`resume`은 수집기, AI 처리, 홈 순위, 로컬 어드민의 기존 검증을 병렬로 실행한다. 각 작업이 끝날 때마다 커밋별 상태와 로그를 공통 체크아웃의 `.local-data/development-continuation/`에 저장한다. 실행기 종료 후에도 살아 있는 검사는 각 실행 ID를 잠그고 결과 파일을 남긴다. 다음 `resume`에서 기존 결과를 회수하거나 중단된 작업을 이어간다. 같은 커밋의 통과 결과는 로그 해시가 일치할 때 재사용한다. 검사 시간 초과나 실행 파일 오류는 한 번 재시도하고, 테스트가 실패하면 다른 검사를 끝낸 뒤 실패를 기록한다. 같은 커밋에서 환경을 복구한 뒤 실패한 검사를 다시 실행하려면 `resume --retry-failed`를 사용한다.

`developmentDb`는 공통 체크아웃의 개발 DB 적용 기록을 관찰한다. 승인 입력 대기, 준비 만료, 적용 시도 후 원격 결과 확인을 따로 표시한다. 이 상태를 확인하는 동안 로컬 검사는 계속 실행할 수 있다. 승인 또는 예약 기록이 있으면 기존 개발 DB 검증기로 실제 결과를 확인한다. `admin-local`은 작업 트리에서 실행 가능한 SQL 계약 검사이며, Windows 네이티브 검사와 실제 Supabase 연결은 원래 관리자 검증 경로에서 확인한다. 나머지 작업의 실운영 검증도 각 절차에서 확인한다.

PC나 터미널을 다시 열면 같은 작업 트리에서 `resume`을 실행한다. 검사 자식 프로세스에도 잠금을 넘기므로, 실행기 또는 워커가 먼저 종료되면 살아 있는 검사가 잠금을 놓은 뒤 이어서 처리한다. DB 쓰기와 검수 제출은 각각 기존 실행기로 처리한다.
