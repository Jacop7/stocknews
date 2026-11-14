-- New Judoju News local schema. No remote target, original article body or real user seed.
begin;
create schema if not exists private;
create extension if not exists pgcrypto with schema extensions;
revoke all on schema private from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

create type private.publication_state as enum ('DRAFT','PUBLISHED','CORRECTION_PENDING','WITHDRAWN','HIDDEN');
create type private.sample_kind as enum ('SYNTHETIC','PERMITTED_REAL');
create type private.job_state as enum ('QUEUED','LEASED','SUCCEEDED','WAIT_CONFIRMATION','DLQ','CANCELLED');
create table private.runtime_identity (
  singleton boolean primary key default true check(singleton),
  product_id text not null check(product_id='judoju-news'),
  environment text not null check(environment in ('local','preview','production')),
  bootstrap_id uuid,
  schema_version integer not null default 1,
  created_at timestamptz not null default now()
);
insert into private.runtime_identity(singleton,product_id,environment) values(true,'judoju-news','local');
create table private.policies (
  version bigint primary key check(version>0), active boolean not null default false,
  api_contract_version integer not null default 1,
  min_android_version text not null default '0.1.0', min_ios_version text not null default '0.1.0',
  created_at timestamptz not null default now()
);
create unique index policy_active on private.policies(active) where active;
create table private.catalog_versions (version bigint primary key check(version>0), active boolean not null default false, created_at timestamptz not null default now());
create unique index catalog_active on private.catalog_versions(active) where active;
insert into private.policies(version,active) values(1,true);
insert into private.catalog_versions(version,active) values(1,true);

create table private.sectors (
  id uuid primary key default gen_random_uuid(), name text not null, description text not null default '',
  parent_id uuid references private.sectors(id), display_order integer not null default 0,
  active boolean not null default true, catalog_version bigint not null references private.catalog_versions(version),
  sample_kind private.sample_kind not null
);
create table private.subgroups (
  id uuid primary key default gen_random_uuid(), sector_id uuid not null references private.sectors(id),
  name text not null, description text not null default '', display_order integer not null default 0, active boolean not null default true
);
create table private.companies (
  id uuid primary key default gen_random_uuid(), name text not null, stock_code text unique,
  market text not null check(market in ('KRX','NYSE','NASDAQ','OTHER')), search_description text not null default '',
  internal_role text not null default '', active boolean not null default true, sample_kind private.sample_kind not null
);
create table private.sector_companies (
  sector_id uuid not null references private.sectors(id), company_id uuid not null references private.companies(id),
  subgroup_id uuid references private.subgroups(id), display_order integer not null default 0, active boolean not null default true,
  primary key(sector_id,company_id)
);
create table private.keyword_definitions (
  id uuid primary key default gen_random_uuid(), sector_id uuid references private.sectors(id), company_id uuid references private.companies(id),
  kind text not null check(kind in ('INDUSTRY','CORE','ADDITIONAL','COMPANY_SEARCH')),
  term text not null check(length(term) between 1 and 100), active boolean not null default true, version bigint not null default 1
);
create table private.keyword_changes (
  id uuid primary key default gen_random_uuid(), keyword_id uuid references private.keyword_definitions(id),
  proposed jsonb not null, status text not null default 'PENDING', applied_version bigint, created_at timestamptz not null default now()
);

create table private.permission_profiles (
  id text not null, version text not null, status text not null check(status in ('UNVERIFIED','VERIFIED','DENIED')),
  purposes jsonb not null default '{}'::jsonb, evidence jsonb not null default '[]'::jsonb,
  verified_at timestamptz, expires_at timestamptz, revoked_at timestamptz, retention_days integer check(retention_days>=0),
  sample_kind private.sample_kind not null, primary key(id,version)
);
create table private.sources (
  id text primary key, name text not null, source_type text not null, market text not null,
  publisher_id text, owner_group_id text, origin_group_id text, original_row integer,
  sample_kind private.sample_kind not null
);
create table private.adapters (id text not null, version text not null, verification_state text not null default 'UNVERIFIED', primary key(id,version));
create table private.endpoints (
  id text primary key, source_id text not null references private.sources(id), url text not null,
  permission_profile_id text not null, permission_version text not null,
  adapter_id text, adapter_version text,
  status text not null default 'RIGHTS_HOLD' check(status in ('CANDIDATE','RIGHTS_HOLD','TECH_TEST','SHADOW','ACTIVE','PAUSED_RATE_LIMIT','PAUSED_ACCESS','PAUSED_ERROR','DISABLED')),
  schedule_class text not null, tab_recipe jsonb, enabled_scopes text[] not null default '{}',
  origin_resolution_rule text not null, checkpoint jsonb, overlap_window_minutes integer not null default 30,
  correction_watch jsonb not null default '{}'::jsonb, max_rps numeric, timeout_ms integer, concurrency integer,
  health_state text not null default 'NOT_TESTED', resume_state text, quality_version text,
  fast_retry_count integer not null default 0 check(fast_retry_count>=0), reprobe_count integer not null default 0 check(reprobe_count>=0),
  low_frequency_since timestamptz, episode_id uuid,
  foreign key(permission_profile_id,permission_version) references private.permission_profiles(id,version),
  foreign key(adapter_id,adapter_version) references private.adapters(id,version),
  check((adapter_id is null)=(adapter_version is null))
);
create table private.checkpoints (
  endpoint_id text primary key references private.endpoints(id), config_version text not null,
  successful_boundary jsonb, status text not null default 'UNFETCHED', missing_range jsonb, observed_at timestamptz
);
create table private.source_endpoint_links (
  source_id text not null references private.sources(id), endpoint_id text not null references private.endpoints(id), primary key(source_id,endpoint_id)
);
create table private.source_documents (
  id uuid primary key default gen_random_uuid(), endpoint_id text not null references private.endpoints(id),
  canonical_url text not null unique, external_id text, discovered_at timestamptz not null default now(),
  fetch_state text not null default 'UNFETCHED', sample_kind private.sample_kind not null,
  unique(endpoint_id,external_id)
);
create table private.source_revisions (
  id uuid primary key default gen_random_uuid(), document_id uuid not null references private.source_documents(id),
  content_hash text not null, permitted_excerpt jsonb, published_at timestamptz, expires_at timestamptz,
  permission_profile_id text not null, permission_profile_version text not null,
  foreign key(permission_profile_id,permission_profile_version) references private.permission_profiles(id,version), unique(document_id,content_hash)
);
create table private.stories (
  id uuid primary key default gen_random_uuid(), event_key text not null unique, created_at timestamptz not null default now()
);
create table private.issues (
  id uuid primary key default gen_random_uuid(), story_id uuid not null references private.stories(id),
  angle_key text not null, publication_state private.publication_state not null default 'DRAFT',
  scheduled_publish_at timestamptz, first_published_at timestamptz, material_change_at timestamptz,
  current_version_id uuid, revision bigint not null default 0, manual_protected boolean not null default false,
  primary_sector_id uuid references private.sectors(id), sample_kind private.sample_kind not null,
  unique(story_id,angle_key)
);
create table private.claims (
  id uuid primary key default gen_random_uuid(), issue_id uuid not null references private.issues(id),
  claim_type text not null check(claim_type in ('ORDINARY_FACT','SYSTEMIC_MACRO','SENSITIVE_UNCONFIRMED')),
  korea_path_verified boolean not null default false, fact_current boolean not null default false, official_original boolean not null default false,
  verified boolean not null default false, valid_until timestamptz, sample_kind private.sample_kind not null
);
create table private.evidence_edges (
  id uuid primary key default gen_random_uuid(), claim_id uuid not null references private.claims(id),
  source_revision_id uuid references private.source_revisions(id), origin_group_id text, newsroom_id text, owner_group_id text,
  origin_verified boolean not null default false, newsroom_verified boolean not null default false, owner_group_verified boolean not null default false,
  independent_fact_verified boolean not null default false,
  unique(claim_id,source_revision_id)
);
create table private.article_versions (
  id uuid primary key default gen_random_uuid(), issue_id uuid not null references private.issues(id),
  title text not null check(length(title)>0), summary text not null, public_body jsonb not null,
  source_market text not null, selection_market_basis text not null check(selection_market_basis in ('KR','FOREIGN_US')),
  analysis_perspective text not null check(analysis_perspective='KR_EQUITY'),
  impact_profile text not null check(impact_profile in ('POSITIVE_ONLY','POSITIVE_NEGATIVE','DAMAGE_ONLY','RELATED_CONDITIONAL')),
  visibility_policy_version bigint not null references private.policies(version),
  catalog_version bigint not null references private.catalog_versions(version), evidence_as_of timestamptz not null,
  visible_sections text[] not null, created_at timestamptz not null default now(), unique(id,issue_id)
);
alter table private.issues add constraint current_version_same_issue foreign key(current_version_id,id) references private.article_versions(id,issue_id) deferrable initially deferred;
create table private.impacts (
  version_id uuid not null references private.article_versions(id), sector_id uuid not null references private.sectors(id),
  direction text not null check(direction in ('BENEFIT','DAMAGE','RELATED')), path_id text not null, conditions jsonb not null default '[]'::jsonb,
  evidence_ids uuid[] not null default '{}', primary key(version_id,sector_id,direction)
);
create table private.issue_aliases (
  alias_id uuid primary key, canonical_issue_id uuid not null references private.issues(id),
  created_at timestamptz not null default now(), check(alias_id<>canonical_issue_id)
);
create table private.decisions (
  id uuid primary key default gen_random_uuid(), issue_id uuid references private.issues(id), document_id uuid references private.source_documents(id),
  decision text not null, reason_code text not null, policy_version bigint not null references private.policies(version), created_at timestamptz not null default now()
);
create table private.holds (
  id uuid primary key default gen_random_uuid(), issue_id uuid references private.issues(id), reason_code text not null,
  deadline timestamptz not null, next_at timestamptz, wake_condition jsonb not null, attempts integer not null default 0 check(attempts>=0)
);
create table private.ranking_snapshots (
  id uuid primary key default gen_random_uuid(), snapshot_context_id text not null unique, market_basis text not null,
  target_d date not null, candidate_window_start timestamptz not null, cutoff timestamptz not null, effective_sort text not null,
  rank_epoch text not null, policy_version bigint not null references private.policies(version), catalog_version bigint not null references private.catalog_versions(version),
  benchmark_version text not null, price_session_id text not null, as_of timestamptz not null, sample_kind private.sample_kind not null
);
create table private.ranking_entries (
  snapshot_id uuid not null references private.ranking_snapshots(id), issue_id uuid not null references private.issues(id),
  story_id uuid not null references private.stories(id), position integer not null check(position>0),
  primary key(snapshot_id,issue_id), unique(snapshot_id,story_id), unique(snapshot_id,position)
);
create table private.installations (
  id uuid primary key default gen_random_uuid(), secret_hash bytea not null, secret_version integer not null default 1,
  expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now()
);
create table private.installation_settings (
  installation_id uuid primary key references private.installations(id), morning_issue boolean not null default false,
  closing_issue boolean not null default false, favorite_sector_issue boolean not null default false,
  sector_ids uuid[] not null default '{}', updated_at timestamptz not null default now()
);
create table private.view_events (
  id uuid primary key default gen_random_uuid(), installation_id uuid not null references private.installations(id),
  issue_id uuid not null references private.issues(id), event_key text not null, occurred_at timestamptz not null default now(), unique(installation_id,event_key)
);
create table private.view_aggregates (
  issue_id uuid not null references private.issues(id), day date not null, count bigint not null default 0 check(count>=0),
  uv_window_version text not null, primary key(issue_id,day)
);
create table private.outbox (
  id uuid primary key default gen_random_uuid(), issue_id uuid references private.issues(id), version_id uuid references private.article_versions(id),
  event_type text not null, effect_key text not null unique, payload jsonb not null, created_at timestamptz not null default now()
);
create table private.jobs (
  id uuid primary key default gen_random_uuid(), environment text not null check(environment='local'),
  job_schema_version integer not null check(job_schema_version=1), kind text not null check(kind='MOCK_EFFECT'),
  effect_key text not null unique, payload jsonb not null default '{}'::jsonb, state private.job_state not null default 'QUEUED',
  available_at timestamptz not null default now(), lease_token uuid, lease_owner text, lease_until timestamptz,
  attempts integer not null default 0 check(attempts>=0), max_attempts integer not null default 3 check(max_attempts between 1 and 10),
  last_error_code text, created_at timestamptz not null default now(), completed_at timestamptz,
  check(state<>'LEASED' or lease_token is not null and lease_owner is not null and lease_until is not null)
);
create index jobs_ready on private.jobs(available_at,created_at) where state in ('QUEUED','LEASED');
create table private.job_attempts (
  id uuid primary key default gen_random_uuid(), job_id uuid not null references private.jobs(id), lease_token uuid not null,
  attempt integer not null, effect_state text not null default 'NOT_STARTED' check(effect_state in ('NOT_STARTED','DISPATCH_INTENT','UNCERTAIN','NOT_SENT_CONFIRMED','ACCEPTED')),
  started_at timestamptz not null default now(), ended_at timestamptz, result text, unique(job_id,attempt)
);
create table private.effect_receipts (
  effect_key text primary key references private.jobs(effect_key), external_receipt text not null unique,
  confirmed_at timestamptz not null default now()
);
create table private.schedules (
  id uuid primary key default gen_random_uuid(), schedule_key text not null unique, due_at timestamptz not null,
  effect_key text not null unique, enabled boolean not null default true, fixture_run_id uuid not null,
  enqueued_job_id uuid references private.jobs(id)
);
create table private.notification_deliveries (
  id uuid primary key default gen_random_uuid(), installation_id uuid not null references private.installations(id),
  issue_id uuid references private.issues(id), notification_type text not null check(notification_type in ('MORNING','CLOSING','FAVORITE_SECTOR')),
  delivery_key text not null unique, status text not null default 'NOT_SENT', cutoff timestamptz not null, provider_reference text
);
create table private.audits (
  id uuid primary key default gen_random_uuid(), actor_id text not null, action text not null,
  entity_id text not null, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table private.deletion_ledger (
  id uuid primary key default gen_random_uuid(), entity_type text not null, entity_id text not null,
  requested_at timestamptz not null default now(), reason text not null, unique(entity_type,entity_id)
);
create table private.purge_tasks (
  id uuid primary key default gen_random_uuid(), ledger_id uuid not null references private.deletion_ledger(id),
  target_kind text not null, state text not null default 'PENDING', expires_at timestamptz not null, unique(ledger_id,target_kind)
);

create table public.news_public (
  issue_id uuid primary key references private.issues(id), version_id uuid references private.article_versions(id),
  publication_state private.publication_state not null, title text, summary text, body jsonb,
  first_published_at timestamptz, material_change_at timestamptz, sample_kind private.sample_kind not null
);
alter table public.news_public enable row level security;
create policy published_news_read on public.news_public for select to anon,authenticated using(publication_state='PUBLISHED');
grant select(issue_id,version_id,publication_state,title,summary,first_published_at,material_change_at,sample_kind) on public.news_public to anon,authenticated;
create view public.news_list with(security_invoker=true) as
  select issue_id,version_id,publication_state,title,summary,first_published_at,material_change_at,sample_kind from public.news_public;
grant select on public.news_list to anon,authenticated;
revoke all on all tables in schema private from public,anon,authenticated;
revoke all on all sequences in schema private from public,anon,authenticated;
do $$declare t record;begin
  for t in select tablename from pg_tables where schemaname='private' loop
    execute format('alter table private.%I enable row level security',t.tablename);
  end loop;
end$$;
commit;
