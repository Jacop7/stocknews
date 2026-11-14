# 6A 카탈로그 이관 준비

이 도구는 승인된 시트 동결본을 파일로만 분석한다. 원본 Google 시트·앱·DB와 연결하지 않는다.

```text
pnpm catalog:preview --input tests/fixtures/catalog/source-20261114.json --registry tests/fixtures/catalog/registry-v1.json --output catalog-20261114.json
```

결과는 `.local-data/catalog-previews/`에 새 파일로만 생성한다. 기존 결과 덮어쓰기, `--apply`, DB 연결 옵션은 없다. 결과 파일은 Git에서 제외된다. 같은 이름의 결과가 있으면 새 파일명을 명시한다.

동결 원문과 모든 셀·서식은 `rawSource`, 각 행은 `rawRow`에 보존한다. 검색 설명은 하단 E열, 묶음 내 종목 역할은 상단 B열이다. 두 문맥을 합치지 않는다. 미국·중국 기업은 원문 전체를 별도 보존한다. 초기 11개 상위 분류와 섹터·묶음 ID는 검수된 레지스트리에 고정되며 실행할 때 다시 만들지 않는다. 이름 변경은 같은 원본 좌표의 ID를 보존한 변경 제안으로 출력하며 자동 적용하지 않는다.

두 괄호 보정(B5·B36)은 정확한 원본 셀 SHA와 before 문자열을 확인한 미리보기에만 적용한다. 보정 전후와 비교키의 NFC·앞뒤 공백 변환은 각각 ledger에 남는다. B10/B37의 서식 없는 묶음은 정확한 레지스트리에 한해 인식한다. 알 수 없는 제목·회사·분류·충돌은 `unresolved`에 남는다.

339건은 원본 기업 행 수이며 상장 검증 완료 수가 아니다. 모든 기업의 주식 식별자는 `UNRESOLVED`, 종목코드·가격·등락률·증권 URL은 null이다. 상·하단의 기업 연결을 양방향 대조한다. 현재 동결본의 현대건설–원자력 SMR(B333), HB테크놀러지–반도체 유리기판(B360)은 하단에만 있으므로 별도 보류로 남기고 상단 역할을 만들지 않는다. 보류가 없는 구조 해석도 운영 이관 승인이 아니므로 `importable`은 항상 false다. 실제 DB 적용과 필터·검색·종목 연결은 후속 단계의 별도 계획과 검수를 따른다.

시험: `pnpm test:catalog`, 전체 회귀: `pnpm verify`. iPhone 실기기 게이트와 6단계 전체 완료는 별도로 남는다.

하위 묶음의 이름·위치가 바뀌면 고정 레지스트리와 대조해 `SUBGROUP_RENAME_PROPOSAL` 또는 `SUBGROUP_MOVE_PROPOSAL`에 기존 ID와 전후 이름·좌표를 남긴다. 유일하게 대응되는 경우에도 실제 `id`는 null, `proposedId`만 제시하고 소속 종목과 함께 HOLD로 유지한다. 여러 후보는 `beforeCandidates`로 표시하며 이름·위치가 동시에 바뀌어 대응 근거가 없으면 추가·비활성 후보를 별도로 남긴다. 자동 병합·ID 생성·삭제는 하지 않는다. 미등록 상위 분류 연결도 보류하며, 키워드 비교키만 NFC로 비교하고 표시 원문은 보존한다.

검수된 바이트를 기능 브랜치에 커밋하고 local main을 fast-forward한 뒤에는 main으로 전환해 전체 `pnpm verify`를 실행한다. 이 단계 검사는 main이 검수 전 기준 커밋이거나 현재 main/HEAD와 같은 검수 후 커밋인 경우만 허용한다. 별도 checkout은 검수 전 기준인 dd2f97dcbd589760311277f65d72d44f581d7222의 local main 참조를 명시적으로 복원해 검증하며 원격 push는 하지 않는다.
