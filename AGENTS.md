- Do not pause to ask for confirmation during multi-step tasks.
- Proceed autonomously until implementation, debugging, and verification are fully complete.

# 주도주뉴스 제품 작업 지침

- 이 저장소는 완전 신규 제품이다. 식자재 관리앱 코드/설정/데이터/DB/인증/키/worker/Docker/배포를 읽어 가져오거나 연결하지 않는다.
- 기획 권위는 docs/reference/planning/공통-운영계약-v1.0.md, 제작 순서는 제작 실행계획 v1.3이다. 사용자 최신 지시가 우선이다.
- 단계 계획을 Claude 브라우저와 독립 Codex Ultra 검수한 뒤 해당 범위 구현, 자체 시험 후 구현 재검수한다. 결과는 실제 범위와 한계를 명시한다.
- 기본 개발 root는 현재 저장소다. 다른 제품 경로 mutation 금지. 고유 Supabase 프로젝트/로컬 포트·Docker 자원·Expo 앱/EAS·키·배포를 새로 만든다.
- PENDING/null 자원은 연결 승인이나 실제 생성 증거가 아니다. 미확인 endpoint에는 migration/seed/쓰기/발송을 하지 않는다.
- 비밀키·실제 .env·인증서·원시 대화는 커밋/로그에 넣지 않는다. 미등록 외부 통신·계정 권한 확대·비용/약관 수락은 필요한 사용자 확인을 거친다.
- 현재 필수 검사: pnpm verify. 0단계 계약 분기는 verify-foundation.mjs에 보존하며 현재 단계의 추가 검사를 함께 실행한다. 이후 단계에서 실제 코드에 맞는 시험을 추가한다. 검사 약화로 통과시키지 않는다.
- 검수 원문·검사 출력·커밋 연결은 ../outputs/development-stages/reviews/에 둔다. 검수된 제품 바이트를 결과 기록 때문에 바꾸지 않는다.
