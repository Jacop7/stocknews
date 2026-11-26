# Current state (Claude session handoff)

Last updated: 2026-11-26. Update this file at the end of every work unit.

## Branches
- Integration base: `feat/collector-ai-integration` @ 1862249b (admin 169bc52, AI outbox, durable queue, page observation included).
- Working branch: `feat/app-vertical-slice` (app screens, synthetic dev API, Claude harness). Not merged.
- `main` @ 99a83e6f is stale; do not develop on it.
- Handoff package from Codex (2026-11-26, ZIP sha256 1e607cff…) was verified: source byte-identical to 1862249b.

## Real vs synthetic
| Area | Implemented | Actually connected |
|---|---|---|
| Collector (web + public Telegram links) | yes | **paused by user 2026-11-21**; AWS not rechecked |
| AI pipeline (FETCH→TRIAGE→DRAFT→VERIFY) | internal SQLite drafts | no paid model, no Supabase write |
| Admin (Next) | UI + local/synthetic | hosted login/write not working (C2 control:null) |
| Home ranking | synthetic + DB tests | no live prices/interest/views |
| Mobile app | screens at prototype level (this branch) | synthetic dev API only; not checked on a device |
| News source API (Finlight, GNews …) | none | proposal under review; no licence/payment/keys |

## Decisions in force
- App shows no current price, change rate, sector average, view count or internal score. Stock tap → Naver Finance (needs resolved stock code).
- Sector ranking tab: catalog order until a verified market-data supply exists.
- Icons are View-drawn (no react-native-svg) to keep native runtime 0006 builds valid.
- Bottom tabs: 홈 / 이슈체크 / 섹터랭킹 / 저장. Notifications: 오전 장 / 장 마감 / 관심 섹터.

## Known issues
- `pnpm verify` already fails at 1862249b: its stage guard (`verify-admin-c2-foundation.mjs`) only accepts C2-branch history.
  On this branch line use `pnpm verify:integration`: **full PASS (100/100 + builds) after `bash scripts/dev/docker-up.sh`** (2026-11-26).
  Foundation guards also need full git history and remote URL `https://github.com/Jacop7/stocknews.git`.
- `scripts/verify-native-release.mjs` already fails at 1862249b: collector commits changed `pnpm-lock.yaml` after the native record. Fix together with the next native build (runtime 0007).
- `tests/telegram-config.test.mjs` skips unless `JUDOJU_LIVE_SOURCE_PREPARER` points at the PC-only preparer; that script should be committed.
- Card `impacts` are sector-level only (`companies: []`): applying news to individual companies needs company-level path
  evidence that the schema does not hold yet. The synthetic dev API still shows example companies (target design).
- Migration `20261126000051_public_card_impacts.sql` is local only: not in the hosted dev archive (cloud records stay at 50
  migrations; `scripts/test-preview-admin-db.mjs` projects only that 50-migration prefix).

- Local Supabase stack (`scripts/start-local.mjs`): first attempt in the cloud failed before creating any container
  (CLI images were pre-pulled from Docker Hub and re-tagged; cause is in `.local-data/runtime/supabase-start-*.stderr`,
  which Claude may not read). `.local-data/runtime/identity.json` is now `START_INTENT`; the script forbids replay.
  Needs a user decision (inspect the log / reset local runtime state) before any retry.

## Open user decisions (needed for one real article end-to-end)
1. AI model, monthly budget and API key.
2. Access to dev Supabase `judoju-news-dev` (approval + key).
3. Source of one original article (existing stored link vs. temporary collection restart).
4. Admin login path usable from the cloud (C2 flow is Windows-PC only).

## Local SQL testing without Docker
`pnpm test:sql-local` (or `node scripts/dev/local-postgres.mjs reset` + `JUDOJU_TEST_PG_URL=postgresql://postgres@127.0.0.1:55432/judoju`)
starts a throwaway PostgreSQL 16 + pg_cron, applies Supabase stubs and every migration, then runs the SQL tests.

## Next safe step
Wait for the open decisions above. Without them: company-level impact design (schema for per-company path evidence), or admin UI
for the new card fields. Do not deploy migration 051 to hosted dev without the user's approval.
