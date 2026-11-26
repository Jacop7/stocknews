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
  On this branch line use `pnpm verify:integration` (passes except the 3 Docker-only SQL tests when no Docker daemon).
  Foundation guards also need full git history and remote URL `https://github.com/Jacop7/stocknews.git`.
- `scripts/verify-native-release.mjs` already fails at 1862249b: collector commits changed `pnpm-lock.yaml` after the native record. Fix together with the next native build (runtime 0007).
- `tests/telegram-config.test.mjs` skips unless `JUDOJU_LIVE_SOURCE_PREPARER` points at the PC-only preparer; that script should be committed.
- Home DTO from the real gateway has no sector/impact fields; list-card `impacts` exist only in the synthetic dev API (contract fields are optional).

## Open user decisions (needed for one real article end-to-end)
1. AI model, monthly budget and API key.
2. Access to dev Supabase `judoju-news-dev` (approval + key).
3. Source of one original article (existing stored link vs. temporary collection restart).
4. Admin login path usable from the cloud (C2 flow is Windows-PC only).

## Next safe step
Extend the public read RPCs so list/home cards carry sector and impact summaries (local SQL + tests only), or wait for the decisions above.
