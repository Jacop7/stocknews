begin;
-- Publish stage 1C (docs/publish-stage1c-plan.md): an editor adopts the newest held AI version of a real issue, then
-- republishes it through the 1B publisher. Local only (real mode). C1 keeps the AI draft with each evidence record,
-- C2 moves the intake apply block into one owner-only function shared by intake and adoption, C3 the adoption function,
-- C4 retention of adopted drafts that were never republished.

-- C1. The AI draft of each received version (null for rows received before 62: not adoptable).
alter table private.ai_draft_origin add column draft jsonb;

-- C3. Adoption receipts: exact replays return the stored result; a different request under the same key conflicts.
create table private.ai_adoptions (
  effect_key text primary key check (length(effect_key) between 1 and 200),
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  issue_id uuid not null references private.issues(id),
  ai_version integer not null check (ai_version > 0),
  result jsonb not null,
  adopted_draft_revision bigint not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  published_version_id uuid
);
create index ai_adoptions_issue on private.ai_adoptions(issue_id, created_at desc);
alter table private.ai_adoptions enable row level security;
revoke all on private.ai_adoptions from public, anon, authenticated, service_role;
