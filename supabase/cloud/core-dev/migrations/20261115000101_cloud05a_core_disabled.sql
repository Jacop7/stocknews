-- CLOUD05A prepared disabled core. No remote apply/cron/role/API activation.
begin;
set local statement_timeout='15s';
set local lock_timeout='4s';
do $cloud05a_guard$
declare t text;role_name text;
begin
 if current_user<>'postgres' or session_user<>'postgres' or current_database()<>'postgres' or not exists(select 1 from pg_roles where rolname=current_user and rolbypassrls and not rolsuper) then raise exception 'CLOUD_OWNER_REQUIRED';end if;
 perform pg_advisory_xact_lock(70501,1);
 foreach t in array array['judoju_control.environment_identity','judoju_control.schema_artifacts','private.adapters','private.article_versions','private.audits','private.catalog_versions','private.checkpoints','private.claims','private.companies','private.decisions','private.deletion_ledger','private.effect_receipts','private.endpoints','private.evidence_edges','private.holds','private.impacts','private.installation_settings','private.installations','private.issue_aliases','private.issues','private.job_attempts','private.jobs','private.keyword_changes','private.keyword_definitions','private.notification_deliveries','private.outbox','private.permission_profiles','private.policies','private.purge_tasks','private.ranking_entries','private.ranking_snapshots','private.runtime_identity','private.schedules','private.sector_companies','private.sectors','private.source_documents','private.source_endpoint_links','private.source_revisions','private.sources','private.stories','private.subgroups','private.view_aggregates','private.view_events','public.news_public'] loop execute 'lock table '||t||' in share mode';end loop;
 if not exists(select 1 from judoju_control.environment_identity where singleton and product_id='judoju-news' and environment='dev' and organization_ref='qfzgicohgpuogehdyzfx' and project_ref='nxfpfvsdwbziowkxsxnh') or not exists(select 1 from private.runtime_identity where singleton and product_id='judoju-news' and environment='preview' and bootstrap_id is null and schema_version=1) then raise exception 'CLOUD_IDENTITY';end if;
 if not exists(select 1 from judoju_control.schema_artifacts where version='20261114000001' and state='STAGED_DISABLED' and source_sha256='5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa' and project_ref='nxfpfvsdwbziowkxsxnh' and runtime_environment='preview') then raise exception 'CLOUD_ARTIFACT';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in ('private','judoju_control') or n.nspname='public' and c.relname in ('news_public','news_list')) and c.relkind in ('r','p','v'))<>45 or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname in ('private','judoju_control') or n.nspname='public' and c.relname in ('news_public','news_list')) and c.relkind in ('r','p') and (pg_get_userbyid(c.relowner)<>'postgres' or not c.relrowsecurity or not c.relforcerowsecurity)) then raise exception 'CLOUD_BASE_RELATIONS';end if;
 foreach role_name in array array['anon','authenticated','service_role'] loop
  if has_schema_privilege(role_name,'private','USAGE') or has_schema_privilege(role_name,'judoju_control','USAGE') then raise exception 'BASE_SCHEMA_EXPOSED';end if;
  foreach t in array array['judoju_control.environment_identity','judoju_control.schema_artifacts','private.adapters','private.article_versions','private.audits','private.catalog_versions','private.checkpoints','private.claims','private.companies','private.decisions','private.deletion_ledger','private.effect_receipts','private.endpoints','private.evidence_edges','private.holds','private.impacts','private.installation_settings','private.installations','private.issue_aliases','private.issues','private.job_attempts','private.jobs','private.keyword_changes','private.keyword_definitions','private.notification_deliveries','private.outbox','private.permission_profiles','private.policies','private.purge_tasks','private.ranking_entries','private.ranking_snapshots','private.runtime_identity','private.schedules','private.sector_companies','private.sectors','private.source_documents','private.source_endpoint_links','private.source_revisions','private.sources','private.stories','private.subgroups','private.view_aggregates','private.view_events','public.news_public','public.news_list'] loop
   if has_table_privilege(role_name,t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') or has_any_column_privilege(role_name,t,'SELECT,INSERT,UPDATE,REFERENCES') then raise exception 'BASE_TABLE_EXPOSED';end if;
  end loop;
 end loop;
 if not exists(select 1 from private.policies where version=1 and active and api_contract_version=1 and min_android_version='0.1.0' and min_ios_version='0.1.0') or not exists(select 1 from private.catalog_versions where version=1 and active) then raise exception 'BASE_POLICY_CATALOG';end if;
 if (select jsonb_agg(jsonb_build_array(n.nspname,c.relname,a.attnum,a.attname,format_type(a.atttypid,a.atttypmod),a.attnotnull,a.attidentity,a.attgenerated,a.attacl::text,a.attcollation::regcollation::text,pg_get_expr(d.adbin,d.adrelid)) order by n.nspname,c.relname,a.attnum) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum where (n.nspname in ('private','judoju_control') or n.nspname='public' and c.relname in ('news_public','news_list')) and a.attnum>0 and not a.attisdropped and c.relkind in ('r','p','v','m','f')) is distinct from '[["judoju_control", "environment_identity", 1, "singleton", "boolean", true, "", "", null, "-", "true"], ["judoju_control", "environment_identity", 2, "product_id", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "environment_identity", 3, "environment", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "environment_identity", 4, "organization_ref", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "environment_identity", 5, "project_ref", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "environment_identity", 6, "baseline_commit", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "environment_identity", 7, "stage", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "environment_identity", 8, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["judoju_control", "schema_artifacts", 1, "version", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "schema_artifacts", 2, "source_path", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "schema_artifacts", 3, "source_sha256", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "schema_artifacts", 4, "source_bytes", "integer", true, "", "", null, "-", null], ["judoju_control", "schema_artifacts", 5, "project_ref", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "schema_artifacts", 6, "state", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "schema_artifacts", 7, "runtime_environment", "text", true, "", "", null, "\"default\"", null], ["judoju_control", "schema_artifacts", 8, "recorded_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "adapters", 1, "id", "text", true, "", "", null, "\"default\"", null], ["private", "adapters", 2, "version", "text", true, "", "", null, "\"default\"", null], ["private", "adapters", 3, "verification_state", "text", true, "", "", null, "\"default\"", "''UNVERIFIED''::text"], ["private", "article_versions", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "article_versions", 2, "issue_id", "uuid", true, "", "", null, "-", null], ["private", "article_versions", 3, "title", "text", true, "", "", null, "\"default\"", null], ["private", "article_versions", 4, "summary", "text", true, "", "", null, "\"default\"", null], ["private", "article_versions", 5, "public_body", "jsonb", true, "", "", null, "-", null], ["private", "article_versions", 6, "source_market", "text", true, "", "", null, "\"default\"", null], ["private", "article_versions", 7, "selection_market_basis", "text", true, "", "", null, "\"default\"", null], ["private", "article_versions", 8, "analysis_perspective", "text", true, "", "", null, "\"default\"", null], ["private", "article_versions", 9, "impact_profile", "text", true, "", "", null, "\"default\"", null], ["private", "article_versions", 10, "visibility_policy_version", "bigint", true, "", "", null, "-", null], ["private", "article_versions", 11, "catalog_version", "bigint", true, "", "", null, "-", null], ["private", "article_versions", 12, "evidence_as_of", "timestamp with time zone", true, "", "", null, "-", null], ["private", "article_versions", 13, "visible_sections", "text[]", true, "", "", null, "\"default\"", null], ["private", "article_versions", 14, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "audits", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "audits", 2, "actor_id", "text", true, "", "", null, "\"default\"", null], ["private", "audits", 3, "action", "text", true, "", "", null, "\"default\"", null], ["private", "audits", 4, "entity_id", "text", true, "", "", null, "\"default\"", null], ["private", "audits", 5, "details", "jsonb", true, "", "", null, "-", "''{}''::jsonb"], ["private", "audits", 6, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "catalog_versions", 1, "version", "bigint", true, "", "", null, "-", null], ["private", "catalog_versions", 2, "active", "boolean", true, "", "", null, "-", "false"], ["private", "catalog_versions", 3, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "checkpoints", 1, "endpoint_id", "text", true, "", "", null, "\"default\"", null], ["private", "checkpoints", 2, "config_version", "text", true, "", "", null, "\"default\"", null], ["private", "checkpoints", 3, "successful_boundary", "jsonb", false, "", "", null, "-", null], ["private", "checkpoints", 4, "status", "text", true, "", "", null, "\"default\"", "''UNFETCHED''::text"], ["private", "checkpoints", 5, "missing_range", "jsonb", false, "", "", null, "-", null], ["private", "checkpoints", 6, "observed_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "claims", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "claims", 2, "issue_id", "uuid", true, "", "", null, "-", null], ["private", "claims", 3, "claim_type", "text", true, "", "", null, "\"default\"", null], ["private", "claims", 4, "korea_path_verified", "boolean", true, "", "", null, "-", "false"], ["private", "claims", 5, "fact_current", "boolean", true, "", "", null, "-", "false"], ["private", "claims", 6, "official_original", "boolean", true, "", "", null, "-", "false"], ["private", "claims", 7, "verified", "boolean", true, "", "", null, "-", "false"], ["private", "claims", 8, "valid_until", "timestamp with time zone", false, "", "", null, "-", null], ["private", "claims", 9, "sample_kind", "private.sample_kind", true, "", "", null, "-", null], ["private", "companies", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "companies", 2, "name", "text", true, "", "", null, "\"default\"", null], ["private", "companies", 3, "stock_code", "text", false, "", "", null, "\"default\"", null], ["private", "companies", 4, "market", "text", true, "", "", null, "\"default\"", null], ["private", "companies", 5, "search_description", "text", true, "", "", null, "\"default\"", "''''::text"], ["private", "companies", 6, "internal_role", "text", true, "", "", null, "\"default\"", "''''::text"], ["private", "companies", 7, "active", "boolean", true, "", "", null, "-", "true"], ["private", "companies", 8, "sample_kind", "private.sample_kind", true, "", "", null, "-", null], ["private", "decisions", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "decisions", 2, "issue_id", "uuid", false, "", "", null, "-", null], ["private", "decisions", 3, "document_id", "uuid", false, "", "", null, "-", null], ["private", "decisions", 4, "decision", "text", true, "", "", null, "\"default\"", null], ["private", "decisions", 5, "reason_code", "text", true, "", "", null, "\"default\"", null], ["private", "decisions", 6, "policy_version", "bigint", true, "", "", null, "-", null], ["private", "decisions", 7, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "deletion_ledger", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "deletion_ledger", 2, "entity_type", "text", true, "", "", null, "\"default\"", null], ["private", "deletion_ledger", 3, "entity_id", "text", true, "", "", null, "\"default\"", null], ["private", "deletion_ledger", 4, "requested_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "deletion_ledger", 5, "reason", "text", true, "", "", null, "\"default\"", null], ["private", "effect_receipts", 1, "effect_key", "text", true, "", "", null, "\"default\"", null], ["private", "effect_receipts", 2, "external_receipt", "text", true, "", "", null, "\"default\"", null], ["private", "effect_receipts", 3, "confirmed_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "endpoints", 1, "id", "text", true, "", "", null, "\"default\"", null], ["private", "endpoints", 2, "source_id", "text", true, "", "", null, "\"default\"", null], ["private", "endpoints", 3, "url", "text", true, "", "", null, "\"default\"", null], ["private", "endpoints", 4, "permission_profile_id", "text", true, "", "", null, "\"default\"", null], ["private", "endpoints", 5, "permission_version", "text", true, "", "", null, "\"default\"", null], ["private", "endpoints", 6, "adapter_id", "text", false, "", "", null, "\"default\"", null], ["private", "endpoints", 7, "adapter_version", "text", false, "", "", null, "\"default\"", null], ["private", "endpoints", 8, "status", "text", true, "", "", null, "\"default\"", "''RIGHTS_HOLD''::text"], ["private", "endpoints", 9, "schedule_class", "text", true, "", "", null, "\"default\"", null], ["private", "endpoints", 10, "tab_recipe", "jsonb", false, "", "", null, "-", null], ["private", "endpoints", 11, "enabled_scopes", "text[]", true, "", "", null, "\"default\"", "''{}''::text[]"], ["private", "endpoints", 12, "origin_resolution_rule", "text", true, "", "", null, "\"default\"", null], ["private", "endpoints", 13, "checkpoint", "jsonb", false, "", "", null, "-", null], ["private", "endpoints", 14, "overlap_window_minutes", "integer", true, "", "", null, "-", "30"], ["private", "endpoints", 15, "correction_watch", "jsonb", true, "", "", null, "-", "''{}''::jsonb"], ["private", "endpoints", 16, "max_rps", "numeric", false, "", "", null, "-", null], ["private", "endpoints", 17, "timeout_ms", "integer", false, "", "", null, "-", null], ["private", "endpoints", 18, "concurrency", "integer", false, "", "", null, "-", null], ["private", "endpoints", 19, "health_state", "text", true, "", "", null, "\"default\"", "''NOT_TESTED''::text"], ["private", "endpoints", 20, "resume_state", "text", false, "", "", null, "\"default\"", null], ["private", "endpoints", 21, "quality_version", "text", false, "", "", null, "\"default\"", null], ["private", "endpoints", 22, "fast_retry_count", "integer", true, "", "", null, "-", "0"], ["private", "endpoints", 23, "reprobe_count", "integer", true, "", "", null, "-", "0"], ["private", "endpoints", 24, "low_frequency_since", "timestamp with time zone", false, "", "", null, "-", null], ["private", "endpoints", 25, "episode_id", "uuid", false, "", "", null, "-", null], ["private", "evidence_edges", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "evidence_edges", 2, "claim_id", "uuid", true, "", "", null, "-", null], ["private", "evidence_edges", 3, "source_revision_id", "uuid", false, "", "", null, "-", null], ["private", "evidence_edges", 4, "origin_group_id", "text", false, "", "", null, "\"default\"", null], ["private", "evidence_edges", 5, "newsroom_id", "text", false, "", "", null, "\"default\"", null], ["private", "evidence_edges", 6, "owner_group_id", "text", false, "", "", null, "\"default\"", null], ["private", "evidence_edges", 7, "origin_verified", "boolean", true, "", "", null, "-", "false"], ["private", "evidence_edges", 8, "newsroom_verified", "boolean", true, "", "", null, "-", "false"], ["private", "evidence_edges", 9, "owner_group_verified", "boolean", true, "", "", null, "-", "false"], ["private", "evidence_edges", 10, "independent_fact_verified", "boolean", true, "", "", null, "-", "false"], ["private", "holds", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "holds", 2, "issue_id", "uuid", false, "", "", null, "-", null], ["private", "holds", 3, "reason_code", "text", true, "", "", null, "\"default\"", null], ["private", "holds", 4, "deadline", "timestamp with time zone", true, "", "", null, "-", null], ["private", "holds", 5, "next_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "holds", 6, "wake_condition", "jsonb", true, "", "", null, "-", null], ["private", "holds", 7, "attempts", "integer", true, "", "", null, "-", "0"], ["private", "impacts", 1, "version_id", "uuid", true, "", "", null, "-", null], ["private", "impacts", 2, "sector_id", "uuid", true, "", "", null, "-", null], ["private", "impacts", 3, "direction", "text", true, "", "", null, "\"default\"", null], ["private", "impacts", 4, "path_id", "text", true, "", "", null, "\"default\"", null], ["private", "impacts", 5, "conditions", "jsonb", true, "", "", null, "-", "''[]''::jsonb"], ["private", "impacts", 6, "evidence_ids", "uuid[]", true, "", "", null, "-", "''{}''::uuid[]"], ["private", "installation_settings", 1, "installation_id", "uuid", true, "", "", null, "-", null], ["private", "installation_settings", 2, "morning_issue", "boolean", true, "", "", null, "-", "false"], ["private", "installation_settings", 3, "closing_issue", "boolean", true, "", "", null, "-", "false"], ["private", "installation_settings", 4, "favorite_sector_issue", "boolean", true, "", "", null, "-", "false"], ["private", "installation_settings", 5, "sector_ids", "uuid[]", true, "", "", null, "-", "''{}''::uuid[]"], ["private", "installation_settings", 6, "updated_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "installations", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "installations", 2, "secret_hash", "bytea", true, "", "", null, "-", null], ["private", "installations", 3, "secret_version", "integer", true, "", "", null, "-", "1"], ["private", "installations", 4, "expires_at", "timestamp with time zone", true, "", "", null, "-", null], ["private", "installations", 5, "revoked_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "installations", 6, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "issue_aliases", 1, "alias_id", "uuid", true, "", "", null, "-", null], ["private", "issue_aliases", 2, "canonical_issue_id", "uuid", true, "", "", null, "-", null], ["private", "issue_aliases", 3, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "issues", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "issues", 2, "story_id", "uuid", true, "", "", null, "-", null], ["private", "issues", 3, "angle_key", "text", true, "", "", null, "\"default\"", null], ["private", "issues", 4, "publication_state", "private.publication_state", true, "", "", null, "-", "''DRAFT''::private.publication_state"], ["private", "issues", 5, "scheduled_publish_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "issues", 6, "first_published_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "issues", 7, "material_change_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "issues", 8, "current_version_id", "uuid", false, "", "", null, "-", null], ["private", "issues", 9, "revision", "bigint", true, "", "", null, "-", "0"], ["private", "issues", 10, "manual_protected", "boolean", true, "", "", null, "-", "false"], ["private", "issues", 11, "primary_sector_id", "uuid", false, "", "", null, "-", null], ["private", "issues", 12, "sample_kind", "private.sample_kind", true, "", "", null, "-", null], ["private", "job_attempts", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "job_attempts", 2, "job_id", "uuid", true, "", "", null, "-", null], ["private", "job_attempts", 3, "lease_token", "uuid", true, "", "", null, "-", null], ["private", "job_attempts", 4, "attempt", "integer", true, "", "", null, "-", null], ["private", "job_attempts", 5, "effect_state", "text", true, "", "", null, "\"default\"", "''NOT_STARTED''::text"], ["private", "job_attempts", 6, "started_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "job_attempts", 7, "ended_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "job_attempts", 8, "result", "text", false, "", "", null, "\"default\"", null], ["private", "jobs", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "jobs", 2, "environment", "text", true, "", "", null, "\"default\"", null], ["private", "jobs", 3, "job_schema_version", "integer", true, "", "", null, "-", null], ["private", "jobs", 4, "kind", "text", true, "", "", null, "\"default\"", null], ["private", "jobs", 5, "effect_key", "text", true, "", "", null, "\"default\"", null], ["private", "jobs", 6, "payload", "jsonb", true, "", "", null, "-", "''{}''::jsonb"], ["private", "jobs", 7, "state", "private.job_state", true, "", "", null, "-", "''QUEUED''::private.job_state"], ["private", "jobs", 8, "available_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "jobs", 9, "lease_token", "uuid", false, "", "", null, "-", null], ["private", "jobs", 10, "lease_owner", "text", false, "", "", null, "\"default\"", null], ["private", "jobs", 11, "lease_until", "timestamp with time zone", false, "", "", null, "-", null], ["private", "jobs", 12, "attempts", "integer", true, "", "", null, "-", "0"], ["private", "jobs", 13, "max_attempts", "integer", true, "", "", null, "-", "3"], ["private", "jobs", 14, "last_error_code", "text", false, "", "", null, "\"default\"", null], ["private", "jobs", 15, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "jobs", 16, "completed_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "keyword_changes", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "keyword_changes", 2, "keyword_id", "uuid", false, "", "", null, "-", null], ["private", "keyword_changes", 3, "proposed", "jsonb", true, "", "", null, "-", null], ["private", "keyword_changes", 4, "status", "text", true, "", "", null, "\"default\"", "''PENDING''::text"], ["private", "keyword_changes", 5, "applied_version", "bigint", false, "", "", null, "-", null], ["private", "keyword_changes", 6, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "keyword_definitions", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "keyword_definitions", 2, "sector_id", "uuid", false, "", "", null, "-", null], ["private", "keyword_definitions", 3, "company_id", "uuid", false, "", "", null, "-", null], ["private", "keyword_definitions", 4, "kind", "text", true, "", "", null, "\"default\"", null], ["private", "keyword_definitions", 5, "term", "text", true, "", "", null, "\"default\"", null], ["private", "keyword_definitions", 6, "active", "boolean", true, "", "", null, "-", "true"], ["private", "keyword_definitions", 7, "version", "bigint", true, "", "", null, "-", "1"], ["private", "notification_deliveries", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "notification_deliveries", 2, "installation_id", "uuid", true, "", "", null, "-", null], ["private", "notification_deliveries", 3, "issue_id", "uuid", false, "", "", null, "-", null], ["private", "notification_deliveries", 4, "notification_type", "text", true, "", "", null, "\"default\"", null], ["private", "notification_deliveries", 5, "delivery_key", "text", true, "", "", null, "\"default\"", null], ["private", "notification_deliveries", 6, "status", "text", true, "", "", null, "\"default\"", "''NOT_SENT''::text"], ["private", "notification_deliveries", 7, "cutoff", "timestamp with time zone", true, "", "", null, "-", null], ["private", "notification_deliveries", 8, "provider_reference", "text", false, "", "", null, "\"default\"", null], ["private", "outbox", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "outbox", 2, "issue_id", "uuid", false, "", "", null, "-", null], ["private", "outbox", 3, "version_id", "uuid", false, "", "", null, "-", null], ["private", "outbox", 4, "event_type", "text", true, "", "", null, "\"default\"", null], ["private", "outbox", 5, "effect_key", "text", true, "", "", null, "\"default\"", null], ["private", "outbox", 6, "payload", "jsonb", true, "", "", null, "-", null], ["private", "outbox", 7, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "permission_profiles", 1, "id", "text", true, "", "", null, "\"default\"", null], ["private", "permission_profiles", 2, "version", "text", true, "", "", null, "\"default\"", null], ["private", "permission_profiles", 3, "status", "text", true, "", "", null, "\"default\"", null], ["private", "permission_profiles", 4, "purposes", "jsonb", true, "", "", null, "-", "''{}''::jsonb"], ["private", "permission_profiles", 5, "evidence", "jsonb", true, "", "", null, "-", "''[]''::jsonb"], ["private", "permission_profiles", 6, "verified_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "permission_profiles", 7, "expires_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "permission_profiles", 8, "revoked_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "permission_profiles", 9, "retention_days", "integer", false, "", "", null, "-", null], ["private", "permission_profiles", 10, "sample_kind", "private.sample_kind", true, "", "", null, "-", null], ["private", "policies", 1, "version", "bigint", true, "", "", null, "-", null], ["private", "policies", 2, "active", "boolean", true, "", "", null, "-", "false"], ["private", "policies", 3, "api_contract_version", "integer", true, "", "", null, "-", "1"], ["private", "policies", 4, "min_android_version", "text", true, "", "", null, "\"default\"", "''0.1.0''::text"], ["private", "policies", 5, "min_ios_version", "text", true, "", "", null, "\"default\"", "''0.1.0''::text"], ["private", "policies", 6, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "purge_tasks", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "purge_tasks", 2, "ledger_id", "uuid", true, "", "", null, "-", null], ["private", "purge_tasks", 3, "target_kind", "text", true, "", "", null, "\"default\"", null], ["private", "purge_tasks", 4, "state", "text", true, "", "", null, "\"default\"", "''PENDING''::text"], ["private", "purge_tasks", 5, "expires_at", "timestamp with time zone", true, "", "", null, "-", null], ["private", "ranking_entries", 1, "snapshot_id", "uuid", true, "", "", null, "-", null], ["private", "ranking_entries", 2, "issue_id", "uuid", true, "", "", null, "-", null], ["private", "ranking_entries", 3, "story_id", "uuid", true, "", "", null, "-", null], ["private", "ranking_entries", 4, "position", "integer", true, "", "", null, "-", null], ["private", "ranking_snapshots", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "ranking_snapshots", 2, "snapshot_context_id", "text", true, "", "", null, "\"default\"", null], ["private", "ranking_snapshots", 3, "market_basis", "text", true, "", "", null, "\"default\"", null], ["private", "ranking_snapshots", 4, "target_d", "date", true, "", "", null, "-", null], ["private", "ranking_snapshots", 5, "candidate_window_start", "timestamp with time zone", true, "", "", null, "-", null], ["private", "ranking_snapshots", 6, "cutoff", "timestamp with time zone", true, "", "", null, "-", null], ["private", "ranking_snapshots", 7, "effective_sort", "text", true, "", "", null, "\"default\"", null], ["private", "ranking_snapshots", 8, "rank_epoch", "text", true, "", "", null, "\"default\"", null], ["private", "ranking_snapshots", 9, "policy_version", "bigint", true, "", "", null, "-", null], ["private", "ranking_snapshots", 10, "catalog_version", "bigint", true, "", "", null, "-", null], ["private", "ranking_snapshots", 11, "benchmark_version", "text", true, "", "", null, "\"default\"", null], ["private", "ranking_snapshots", 12, "price_session_id", "text", true, "", "", null, "\"default\"", null], ["private", "ranking_snapshots", 13, "as_of", "timestamp with time zone", true, "", "", null, "-", null], ["private", "ranking_snapshots", 14, "sample_kind", "private.sample_kind", true, "", "", null, "-", null], ["private", "runtime_identity", 1, "singleton", "boolean", true, "", "", null, "-", "true"], ["private", "runtime_identity", 2, "product_id", "text", true, "", "", null, "\"default\"", null], ["private", "runtime_identity", 3, "environment", "text", true, "", "", null, "\"default\"", null], ["private", "runtime_identity", 4, "bootstrap_id", "uuid", false, "", "", null, "-", null], ["private", "runtime_identity", 5, "schema_version", "integer", true, "", "", null, "-", "1"], ["private", "runtime_identity", 6, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "schedules", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "schedules", 2, "schedule_key", "text", true, "", "", null, "\"default\"", null], ["private", "schedules", 3, "due_at", "timestamp with time zone", true, "", "", null, "-", null], ["private", "schedules", 4, "effect_key", "text", true, "", "", null, "\"default\"", null], ["private", "schedules", 5, "enabled", "boolean", true, "", "", null, "-", "true"], ["private", "schedules", 6, "fixture_run_id", "uuid", true, "", "", null, "-", null], ["private", "schedules", 7, "enqueued_job_id", "uuid", false, "", "", null, "-", null], ["private", "sector_companies", 1, "sector_id", "uuid", true, "", "", null, "-", null], ["private", "sector_companies", 2, "company_id", "uuid", true, "", "", null, "-", null], ["private", "sector_companies", 3, "subgroup_id", "uuid", false, "", "", null, "-", null], ["private", "sector_companies", 4, "display_order", "integer", true, "", "", null, "-", "0"], ["private", "sector_companies", 5, "active", "boolean", true, "", "", null, "-", "true"], ["private", "sectors", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "sectors", 2, "name", "text", true, "", "", null, "\"default\"", null], ["private", "sectors", 3, "description", "text", true, "", "", null, "\"default\"", "''''::text"], ["private", "sectors", 4, "parent_id", "uuid", false, "", "", null, "-", null], ["private", "sectors", 5, "display_order", "integer", true, "", "", null, "-", "0"], ["private", "sectors", 6, "active", "boolean", true, "", "", null, "-", "true"], ["private", "sectors", 7, "catalog_version", "bigint", true, "", "", null, "-", null], ["private", "sectors", 8, "sample_kind", "private.sample_kind", true, "", "", null, "-", null], ["private", "source_documents", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "source_documents", 2, "endpoint_id", "text", true, "", "", null, "\"default\"", null], ["private", "source_documents", 3, "canonical_url", "text", true, "", "", null, "\"default\"", null], ["private", "source_documents", 4, "external_id", "text", false, "", "", null, "\"default\"", null], ["private", "source_documents", 5, "discovered_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "source_documents", 6, "fetch_state", "text", true, "", "", null, "\"default\"", "''UNFETCHED''::text"], ["private", "source_documents", 7, "sample_kind", "private.sample_kind", true, "", "", null, "-", null], ["private", "source_endpoint_links", 1, "source_id", "text", true, "", "", null, "\"default\"", null], ["private", "source_endpoint_links", 2, "endpoint_id", "text", true, "", "", null, "\"default\"", null], ["private", "source_revisions", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "source_revisions", 2, "document_id", "uuid", true, "", "", null, "-", null], ["private", "source_revisions", 3, "content_hash", "text", true, "", "", null, "\"default\"", null], ["private", "source_revisions", 4, "permitted_excerpt", "jsonb", false, "", "", null, "-", null], ["private", "source_revisions", 5, "published_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "source_revisions", 6, "expires_at", "timestamp with time zone", false, "", "", null, "-", null], ["private", "source_revisions", 7, "permission_profile_id", "text", true, "", "", null, "\"default\"", null], ["private", "source_revisions", 8, "permission_profile_version", "text", true, "", "", null, "\"default\"", null], ["private", "sources", 1, "id", "text", true, "", "", null, "\"default\"", null], ["private", "sources", 2, "name", "text", true, "", "", null, "\"default\"", null], ["private", "sources", 3, "source_type", "text", true, "", "", null, "\"default\"", null], ["private", "sources", 4, "market", "text", true, "", "", null, "\"default\"", null], ["private", "sources", 5, "publisher_id", "text", false, "", "", null, "\"default\"", null], ["private", "sources", 6, "owner_group_id", "text", false, "", "", null, "\"default\"", null], ["private", "sources", 7, "origin_group_id", "text", false, "", "", null, "\"default\"", null], ["private", "sources", 8, "original_row", "integer", false, "", "", null, "-", null], ["private", "sources", 9, "sample_kind", "private.sample_kind", true, "", "", null, "-", null], ["private", "stories", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "stories", 2, "event_key", "text", true, "", "", null, "\"default\"", null], ["private", "stories", 3, "created_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["private", "subgroups", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "subgroups", 2, "sector_id", "uuid", true, "", "", null, "-", null], ["private", "subgroups", 3, "name", "text", true, "", "", null, "\"default\"", null], ["private", "subgroups", 4, "description", "text", true, "", "", null, "\"default\"", "''''::text"], ["private", "subgroups", 5, "display_order", "integer", true, "", "", null, "-", "0"], ["private", "subgroups", 6, "active", "boolean", true, "", "", null, "-", "true"], ["private", "view_aggregates", 1, "issue_id", "uuid", true, "", "", null, "-", null], ["private", "view_aggregates", 2, "day", "date", true, "", "", null, "-", null], ["private", "view_aggregates", 3, "count", "bigint", true, "", "", null, "-", "0"], ["private", "view_aggregates", 4, "uv_window_version", "text", true, "", "", null, "\"default\"", null], ["private", "view_events", 1, "id", "uuid", true, "", "", null, "-", "gen_random_uuid()"], ["private", "view_events", 2, "installation_id", "uuid", true, "", "", null, "-", null], ["private", "view_events", 3, "issue_id", "uuid", true, "", "", null, "-", null], ["private", "view_events", 4, "event_key", "text", true, "", "", null, "\"default\"", null], ["private", "view_events", 5, "occurred_at", "timestamp with time zone", true, "", "", null, "-", "now()"], ["public", "news_list", 1, "issue_id", "uuid", false, "", "", null, "-", null], ["public", "news_list", 2, "version_id", "uuid", false, "", "", null, "-", null], ["public", "news_list", 3, "publication_state", "private.publication_state", false, "", "", null, "-", null], ["public", "news_list", 4, "title", "text", false, "", "", null, "\"default\"", null], ["public", "news_list", 5, "summary", "text", false, "", "", null, "\"default\"", null], ["public", "news_list", 6, "first_published_at", "timestamp with time zone", false, "", "", null, "-", null], ["public", "news_list", 7, "material_change_at", "timestamp with time zone", false, "", "", null, "-", null], ["public", "news_list", 8, "sample_kind", "private.sample_kind", false, "", "", null, "-", null], ["public", "news_public", 1, "issue_id", "uuid", true, "", "", null, "-", null], ["public", "news_public", 2, "version_id", "uuid", false, "", "", null, "-", null], ["public", "news_public", 3, "publication_state", "private.publication_state", true, "", "", null, "-", null], ["public", "news_public", 4, "title", "text", false, "", "", null, "\"default\"", null], ["public", "news_public", 5, "summary", "text", false, "", "", null, "\"default\"", null], ["public", "news_public", 6, "body", "jsonb", false, "", "", null, "-", null], ["public", "news_public", 7, "first_published_at", "timestamp with time zone", false, "", "", null, "-", null], ["public", "news_public", 8, "material_change_at", "timestamp with time zone", false, "", "", null, "-", null], ["public", "news_public", 9, "sample_kind", "private.sample_kind", true, "", "", null, "-", null]]'::jsonb then raise exception 'CLOUD_BASE_COLUMNS';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' or n.nspname='public' and p.proname<>'rls_auto_enable' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')) or exists(select 1 from pg_trigger where tgrelid='private.issues'::regclass and not tgisinternal) or to_regclass('private.jobs_confirmation_due') is not null then raise exception 'CORE_ALREADY_OR_PARTIALLY_APPLIED';end if;
 if not exists(select 1 from pg_constraint where conrelid='private.jobs'::regclass and conname='jobs_environment_check' and pg_get_expr(conbin,conrelid)=$oldcheck$(environment = 'local'::text)$oldcheck$) then raise exception 'JOBS_CONSTRAINT';end if;
 if (select count(*) from judoju_control.environment_identity)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from judoju_control.schema_artifacts)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.adapters)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.article_versions)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.audits)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.catalog_versions)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.checkpoints)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.claims)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.companies)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.decisions)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.deletion_ledger)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.effect_receipts)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.endpoints)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.evidence_edges)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.holds)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.impacts)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.installation_settings)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.installations)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.issue_aliases)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.issues)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.job_attempts)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.jobs)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.keyword_changes)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.keyword_definitions)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.notification_deliveries)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.outbox)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.permission_profiles)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.policies)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.purge_tasks)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.ranking_entries)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.ranking_snapshots)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.runtime_identity)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.schedules)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.sector_companies)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.sectors)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.source_documents)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.source_endpoint_links)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.source_revisions)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.sources)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.stories)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.subgroups)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.view_aggregates)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.view_events)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from public.news_public)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
end $cloud05a_guard$;
alter table private.jobs drop constraint jobs_environment_check;
alter table private.jobs add constraint jobs_environment_check check(environment='preview');
alter table private.jobs add column confirmation_next_at timestamptz not null default clock_timestamp();
alter table private.jobs add column confirmation_checks integer not null default 0 check(confirmation_checks>=0);
create index jobs_confirmation_due on private.jobs(confirmation_next_at,created_at) where state='WAIT_CONFIRMATION';
create function private.caller_role() returns text language sql stable set search_path='' as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role',nullif(current_setting('role',true),'none'),session_user)
$$;
create function private.is_admin() returns boolean language sql stable set search_path='' as $$
  select private.caller_role()='authenticated' and coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->'app_metadata'->>'app_role','')='admin'
$$;
create function private.assert_server() returns void language plpgsql set search_path='' as $$
begin
  if private.caller_role() not in ('postgres','supabase_admin','service_role') then raise exception 'SERVER_ONLY' using errcode='42501'; end if;
end$$;
create function private.assert_editor() returns void language plpgsql set search_path='' as $$
begin
  if not private.is_admin() and private.caller_role() not in ('postgres','supabase_admin','service_role') then raise exception 'EDITOR_ONLY' using errcode='42501'; end if;
end$$;
create function private.assert_initialized() returns void language plpgsql set search_path='' as $$
begin
 if (select count(*) from private.runtime_identity)<>1 or not exists(select 1 from private.runtime_identity where singleton and product_id='judoju-news' and environment='preview' and bootstrap_id is null and schema_version=1)
 or (select count(*) from judoju_control.environment_identity)<>1 or not exists(select 1 from judoju_control.environment_identity where singleton and product_id='judoju-news' and environment='dev' and organization_ref='qfzgicohgpuogehdyzfx' and project_ref='nxfpfvsdwbziowkxsxnh')
 or not exists(select 1 from judoju_control.schema_artifacts where version='20261114000001' and project_ref='nxfpfvsdwbziowkxsxnh' and runtime_environment='preview' and source_sha256='5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa' and state='STAGED_DISABLED') then raise exception 'CLOUD_PRODUCT_NOT_INITIALIZED';end if;
end$$;
create function public.m0_runtime_identity() returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.runtime_identity;
begin perform private.assert_server();select * into r from private.runtime_identity where singleton;
  return jsonb_build_object('productId',r.product_id,'environment',r.environment,'bootstrapId',r.bootstrap_id,'schemaVersion',r.schema_version);
end$$;
create function private.visible_sections(p_profile text,p_body jsonb,p_as_of timestamptz,p_now timestamptz) returns text[] language plpgsql immutable set search_path='' as $$
declare result text[]:=array['KEY_ISSUES','ISSUE_ANALYSIS']; positive_count integer;negative_count integer;
begin
  if p_profile not in ('POSITIVE_ONLY','POSITIVE_NEGATIVE','DAMAGE_ONLY','RELATED_CONDITIONAL') then raise exception 'UNKNOWN_IMPACT_PROFILE'; end if;
  if jsonb_typeof(p_body)<>'object' then raise exception 'BODY_OBJECT_REQUIRED'; end if;
  select count(*) filter(where x->>'direction'='POSITIVE'),count(*) filter(where x->>'direction'='NEGATIVE') into positive_count,negative_count from jsonb_array_elements(coalesce(p_body->'scenarios','[]')) x;
  if p_profile='DAMAGE_ONLY' then
    if jsonb_array_length(coalesce(p_body->'risks','[]'))=0 then raise exception 'DAMAGE_REQUIRES_RISKS'; end if;
    if positive_count+negative_count>0 then raise exception 'DAMAGE_ONLY_NO_SCENARIO'; end if;
  else
    if positive_count<1 or p_profile='POSITIVE_ONLY' and negative_count>0 or p_profile='POSITIVE_NEGATIVE' and negative_count<1 then raise exception 'SCENARIO_PROFILE_MISMATCH'; end if;
    result:=array_append(result,'SCENARIOS');
  end if;
  if jsonb_array_length(coalesce(p_body->'benefit_sector_ids','[]'))>0 then
    if p_profile in ('DAMAGE_ONLY','RELATED_CONDITIONAL') then raise exception 'BENEFIT_NOT_ESTABLISHED'; end if;
    result:=array_append(result,'BENEFIT_SECTORS');
  end if;
  if jsonb_array_length(coalesce(p_body->'damage_sector_ids','[]'))>0 then
    if p_profile in ('POSITIVE_ONLY','RELATED_CONDITIONAL') then raise exception 'DAMAGE_NOT_ESTABLISHED'; end if;
    result:=array_append(result,'DAMAGE_SECTORS');
  end if;
  if jsonb_array_length(coalesce(p_body->'related_sector_ids','[]'))>0 then result:=array_append(result,'RELATED_SECTORS'); end if;
  if p_profile='DAMAGE_ONLY' and not 'DAMAGE_SECTORS'=any(result) then raise exception 'DAMAGE_SECTOR_REQUIRED'; end if;
  if p_profile='RELATED_CONDITIONAL' and not 'RELATED_SECTORS'=any(result) then raise exception 'RELATED_SECTOR_REQUIRED'; end if;
  if jsonb_array_length(coalesce(p_body->'risks','[]'))>0 then result:=array_append(result,'RISKS'); end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_body->'schedule','[]')) x where (x->>'event_at')::timestamptz>greatest(p_as_of,p_now)) then result:=array_append(result,'SCHEDULE'); end if;
  return array_append(result,'SOURCES');
end$$;
create function private.public_body(p_body jsonb,p_sections text[],p_now timestamptz) returns jsonb language plpgsql immutable set search_path='' as $$
declare result jsonb;
begin
  result:=jsonb_build_object('key_issues',coalesce(p_body->'key_issues','[]'),'issue_analysis',coalesce(p_body->'issue_analysis','""'),'sources',coalesce(p_body->'sources','[]'),'visible_sections',p_sections);
  if 'SCENARIOS'=any(p_sections) then result:=result||jsonb_build_object('scenarios',p_body->'scenarios');end if;
  if 'BENEFIT_SECTORS'=any(p_sections) then result:=result||jsonb_build_object('benefit_sector_ids',p_body->'benefit_sector_ids');end if;
  if 'DAMAGE_SECTORS'=any(p_sections) then result:=result||jsonb_build_object('damage_sector_ids',p_body->'damage_sector_ids');end if;
  if 'RELATED_SECTORS'=any(p_sections) then result:=result||jsonb_build_object('related_sector_ids',p_body->'related_sector_ids');end if;
  if 'RISKS'=any(p_sections) then result:=result||jsonb_build_object('risks',p_body->'risks');end if;
  if 'SCHEDULE'=any(p_sections) then result:=result||jsonb_build_object('schedule',(select jsonb_agg(x) from jsonb_array_elements(p_body->'schedule') x where (x->>'event_at')::timestamptz>p_now));end if;
  return result;
end$$;
create function private.sync_public_issue() returns trigger language plpgsql security definer set search_path='' as $$
declare v private.article_versions;
begin
  if new.publication_state='PUBLISHED' and new.current_version_id is not null then
    select * into strict v from private.article_versions where id=new.current_version_id and issue_id=new.id;
    insert into public.news_public(issue_id,version_id,publication_state,title,summary,body,first_published_at,material_change_at,sample_kind)
    values(new.id,v.id,new.publication_state,v.title,v.summary,private.public_body(v.public_body,v.visible_sections,now()),new.first_published_at,new.material_change_at,new.sample_kind)
    on conflict(issue_id) do update set version_id=excluded.version_id,publication_state=excluded.publication_state,title=excluded.title,summary=excluded.summary,body=excluded.body,first_published_at=excluded.first_published_at,material_change_at=excluded.material_change_at;
  else
    update public.news_public set publication_state=new.publication_state,title=null,summary=null,body=null where issue_id=new.id;
  end if;
  return new;
end$$;
create or replace function public.m0_publish(p_issue uuid,p_expected_revision bigint,p_title text,p_summary text,p_body jsonb,p_profile text,p_policy bigint,p_catalog bigint,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.issues;v_id uuid:=gen_random_uuid();sections text[];claim private.claims;independent_three boolean;sector uuid;request_hash text;
begin
  perform private.assert_editor();perform private.assert_initialized();
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  request_hash:=encode(extensions.digest(convert_to(jsonb_build_object('issue',p_issue,'expected_revision',p_expected_revision,'title',p_title,'summary',p_summary,'body',p_body,'profile',p_profile,'policy',p_policy,'catalog',p_catalog)::text,'UTF8'),'sha256'),'hex');
  select * into strict i from private.issues where id=p_issue for update;
  if exists(select 1 from private.outbox where effect_key=p_effect_key and issue_id=p_issue) then
    if not exists(select 1 from private.outbox where effect_key=p_effect_key and payload->>'request_hash'=request_hash) then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
    return jsonb_build_object('status','ALREADY_APPLIED','issue_id',i.id,'revision',i.revision,'version_id',i.current_version_id);
  end if;
  if exists(select 1 from private.outbox where effect_key=p_effect_key) then raise exception 'EFFECT_KEY_CONFLICT';end if;
  if i.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  if i.publication_state in ('HIDDEN','WITHDRAWN') then raise exception 'NO_AUTOMATIC_REPUBLISH';end if;
  if i.scheduled_publish_at is not null and i.scheduled_publish_at>now() then raise exception 'SCHEDULE_NOT_DUE';end if;
  if not exists(select 1 from private.policies where version=p_policy and active) or not exists(select 1 from private.catalog_versions where version=p_catalog and active) then raise exception 'STALE_POLICY_OR_CATALOG';end if;
  if i.sample_kind<>'SYNTHETIC' then raise exception 'REAL_PUBLICATION_NOT_ENABLED_STAGE_4';end if;
  if not exists(select 1 from private.runtime_identity where environment='preview') then raise exception 'SYNTHETIC_PUBLICATION_FORBIDDEN';end if;
  if i.primary_sector_id is not null and not exists(select 1 from private.sectors where id=i.primary_sector_id and active and catalog_version=p_catalog) then raise exception 'PRIMARY_SECTOR_INACTIVE';end if;
  if not exists(select 1 from private.claims where issue_id=i.id) then raise exception 'CLAIM_REQUIRED';end if;
  for claim in select * from private.claims where issue_id=i.id loop
    if not claim.verified or not claim.korea_path_verified or not claim.fact_current or claim.valid_until is not null and claim.valid_until<=now() or claim.claim_type='SENSITIVE_UNCONFIRMED' then raise exception 'CLAIM_NOT_VERIFIED';end if;
    if claim.claim_type='SYSTEMIC_MACRO' and not claim.official_original then
      select exists(select 1 from private.evidence_edges a join private.evidence_edges b on a.claim_id=b.claim_id and a.id<b.id join private.evidence_edges c on b.claim_id=c.claim_id and b.id<c.id
        where a.claim_id=claim.id
        and a.origin_verified and a.newsroom_verified and a.owner_group_verified and a.independent_fact_verified
        and b.origin_verified and b.newsroom_verified and b.owner_group_verified and b.independent_fact_verified
        and c.origin_verified and c.newsroom_verified and c.owner_group_verified and c.independent_fact_verified
        and a.origin_group_id<>b.origin_group_id and b.origin_group_id<>c.origin_group_id and a.origin_group_id<>c.origin_group_id
        and a.newsroom_id<>b.newsroom_id and b.newsroom_id<>c.newsroom_id and a.newsroom_id<>c.newsroom_id
        and a.owner_group_id<>b.owner_group_id and b.owner_group_id<>c.owner_group_id and a.owner_group_id<>c.owner_group_id
      ) into independent_three;
      if not independent_three then raise exception 'MACRO_INDEPENDENT_THREE_REQUIRED';end if;
    end if;
  end loop;
  sections:=private.visible_sections(p_profile,p_body,now(),now());
  for sector in select value::text::uuid from jsonb_array_elements_text(coalesce(p_body->'benefit_sector_ids','[]')||coalesce(p_body->'damage_sector_ids','[]')||coalesce(p_body->'related_sector_ids','[]')) loop
    if not exists(select 1 from private.sectors where id=sector and active and catalog_version=p_catalog) then raise exception 'IMPACT_SECTOR_INACTIVE';end if;
  end loop;
  insert into private.article_versions(id,issue_id,title,summary,public_body,source_market,selection_market_basis,analysis_perspective,impact_profile,visibility_policy_version,catalog_version,evidence_as_of,visible_sections)
  values(v_id,i.id,p_title,p_summary,p_body,coalesce(p_body->>'source_market','SYNTHETIC'),coalesce(p_body->>'selection_market_basis','KR'),'KR_EQUITY',p_profile,p_policy,p_catalog,now(),sections);
  insert into private.impacts(version_id,sector_id,direction,path_id,conditions)
    select v_id,x::uuid,'BENEFIT','SYNTHETIC', '[]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'benefit_sector_ids','[]')) x
    union all select v_id,x::uuid,'DAMAGE','SYNTHETIC','[]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'damage_sector_ids','[]')) x
    union all select v_id,x::uuid,'RELATED','SYNTHETIC','["조건부"]'::jsonb from jsonb_array_elements_text(coalesce(p_body->'related_sector_ids','[]')) x;
  update private.issues set current_version_id=v_id,publication_state='PUBLISHED',first_published_at=coalesce(first_published_at,now()),material_change_at=now(),revision=revision+1 where id=i.id;
  insert into private.outbox(issue_id,version_id,event_type,effect_key,payload) values(i.id,v_id,'ISSUE_PUBLISHED',p_effect_key,jsonb_build_object('issue_id',i.id,'version_id',v_id,'sample_kind','SYNTHETIC','request_hash',request_hash));
  return jsonb_build_object('status','APPLIED','issue_id',i.id,'revision',i.revision+1,'version_id',v_id,'visible_sections',sections);
end$$;
create or replace function public.m0_set_publication_state(p_issue uuid,p_expected_revision bigint,p_state text) returns jsonb language plpgsql security definer set search_path='' as $$
declare i private.issues;
begin
  perform private.assert_editor();perform private.assert_initialized();
  if p_state not in ('CORRECTION_PENDING','WITHDRAWN','HIDDEN') then raise exception 'INVALID_TRANSITION';end if;
  select * into strict i from private.issues where id=p_issue for update;
  if i.revision is distinct from p_expected_revision then raise exception 'REVISION_CONFLICT' using errcode='40001';end if;
  update private.issues set publication_state=p_state::private.publication_state,revision=revision+1 where id=i.id;
  return jsonb_build_object('issue_id',i.id,'state',p_state,'revision',i.revision+1);
end$$;
create or replace function public.resolve_issue(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare canonical uuid:=p_issue;i private.issues;visited uuid[]:='{}';k integer;
begin
  for k in 1..16 loop
    if canonical=any(visited) then raise exception 'ALIAS_CYCLE';end if;visited:=array_append(visited,canonical);
    if not exists(select 1 from private.issue_aliases where alias_id=canonical) then exit;end if;
    select canonical_issue_id into canonical from private.issue_aliases where alias_id=canonical;
  end loop;
  if exists(select 1 from private.issue_aliases where alias_id=canonical) then raise exception 'ALIAS_CHAIN_LIMIT';end if;
  select * into i from private.issues where id=canonical;
  if not found or i.publication_state='DRAFT' then return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');end if;
  return jsonb_build_object('canonical_issue_id',i.id,'state',i.publication_state,'message',case i.publication_state when 'PUBLISHED' then '공개된 글' when 'CORRECTION_PENDING' then '내용 확인 중 · 기존 내용 제공 중지' when 'WITHDRAWN' then '근거 확인 불가로 게시 중단' else '현재 제공하지 않는 글' end);
end$$;
create function public.get_public_article(p_issue uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;p public.news_public;v private.article_versions;sections text[];
begin
  r:=public.resolve_issue(p_issue);
  if r->>'state'<>'PUBLISHED' then return r;end if;
  select * into p from public.news_public where issue_id=(r->>'canonical_issue_id')::uuid and publication_state='PUBLISHED';
  if not found then return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');end if;
  select * into strict v from private.article_versions where id=p.version_id and issue_id=p.issue_id;
  sections:=private.visible_sections(v.impact_profile,v.public_body,v.evidence_as_of,now());
  return jsonb_build_object('issue_id',p.issue_id,'version_id',p.version_id,'state',p.publication_state,'title',p.title,'summary',p.summary,'body',private.public_body(v.public_body,sections,now()),'first_published_at',p.first_published_at,'material_change_at',p.material_change_at,'sample_kind',p.sample_kind);
end$$;
create function public.m0_enqueue(p_effect_key text,p_payload jsonb default '{}'::jsonb,p_environment text default 'preview',p_schema_version integer default 1,p_kind text default 'MOCK_EFFECT') returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_environment<>'preview' or p_schema_version<>1 or p_kind<>'MOCK_EFFECT' then raise exception 'UNSUPPORTED_JOB_CONTRACT';end if;
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 or jsonb_typeof(p_payload)<>'object' then raise exception 'INVALID_JOB';end if;
  if exists(select 1 from jsonb_object_keys(p_payload) k where k not in ('fixture_run_id','mode','work_ms','heartbeat')) then raise exception 'UNSUPPORTED_JOB_PAYLOAD';end if;
  insert into private.jobs(environment,job_schema_version,kind,effect_key,payload) values(p_environment,p_schema_version,p_kind,p_effect_key,p_payload) on conflict(effect_key) do nothing;
  select * into strict j from private.jobs where effect_key=p_effect_key;
  if j.payload<>p_payload or j.environment<>p_environment or j.kind<>p_kind or j.job_schema_version<>p_schema_version then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
  return jsonb_build_object('id',j.id,'effect_key',j.effect_key,'state',j.state);
end$$;
create function public.m0_claim(p_owner text,p_lease_seconds integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;token uuid:=gen_random_uuid();
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_owner is null or length(p_owner) not between 1 and 80 or p_lease_seconds not between 1 and 120 then raise exception 'INVALID_LEASE';end if;
  select * into j from private.jobs where available_at<=clock_timestamp() and (state='QUEUED' or state='LEASED' and lease_until<=clock_timestamp()) order by available_at,created_at for update skip locked limit 1;
  if not found then return null;end if;
  if j.state='LEASED' then update private.job_attempts set ended_at=clock_timestamp(),result='LEASE_EXPIRED' where job_id=j.id and lease_token=j.lease_token and ended_at is null;end if;
  if j.state='LEASED' and exists(select 1 from private.job_attempts where job_id=j.id and lease_token=j.lease_token and effect_state in ('DISPATCH_INTENT','UNCERTAIN')) then
    update private.jobs set state='WAIT_CONFIRMATION',lease_token=null,lease_until=null,last_error_code='LEASE_EXPIRED_UNCERTAIN' where id=j.id;return null;
  end if;
  if j.attempts>=j.max_attempts then update private.jobs set state='DLQ',lease_token=null,lease_until=null,last_error_code='MAX_ATTEMPTS' where id=j.id;return null;end if;
  update private.jobs set state='LEASED',lease_token=token,lease_owner=p_owner,lease_until=clock_timestamp()+p_lease_seconds*interval '1 second',attempts=attempts+1 where id=j.id returning * into j;
  insert into private.job_attempts(job_id,lease_token,attempt) values(j.id,token,j.attempts);
  return jsonb_build_object('id',j.id,'environment',j.environment,'job_schema_version',j.job_schema_version,'kind',j.kind,'effect_key',j.effect_key,'payload',j.payload,'lease_token',token,'lease_until',j.lease_until,'attempt',j.attempts);
end$$;
create function public.m0_mark_effect_intent(p_job uuid,p_token uuid) returns boolean language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_server();perform private.assert_initialized();
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'LEASED' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then return false;end if;
  update private.job_attempts set effect_state='DISPATCH_INTENT' where job_id=j.id and lease_token=p_token and effect_state='NOT_STARTED';
  return found;
end$$;
create or replace function public.m0_pending_confirmation() returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_server();perform private.assert_initialized();
  select * into j from private.jobs where state='WAIT_CONFIRMATION' and confirmation_next_at<=clock_timestamp() order by confirmation_next_at,created_at for update skip locked limit 1;
  if not found then return null;end if;
  -- Reserve a bounded confirmation slot before I/O. UNKNOWN stays on hold but
  -- cannot monopolize every consumer's next lookup. This never authorizes POST.
  update private.jobs set confirmation_next_at=clock_timestamp()+interval '30 seconds',confirmation_checks=confirmation_checks+1 where id=j.id;
  return jsonb_build_object('id',j.id,'effect_key',j.effect_key,'payload',j.payload);
end$$;
create function public.m0_heartbeat(p_job uuid,p_token uuid,p_lease_seconds integer default 10) returns boolean language plpgsql security definer set search_path='' as $$
declare updated integer;
begin
  perform private.assert_server();perform private.assert_initialized();if p_lease_seconds not between 1 and 120 then raise exception 'INVALID_LEASE';end if;
  update private.jobs set lease_until=clock_timestamp()+p_lease_seconds*interval '1 second' where id=p_job and state='LEASED' and lease_token=p_token and lease_until>clock_timestamp();get diagnostics updated=row_count;return updated=1;
end$$;
create or replace function public.m0_ack(p_job uuid,p_token uuid,p_receipt text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;previous text;
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_receipt is null or length(p_receipt) not between 1 and 300 then raise exception 'RECEIPT_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state='SUCCEEDED' and j.lease_token=p_token and exists(select 1 from private.effect_receipts where effect_key=j.effect_key and external_receipt=p_receipt) then return jsonb_build_object('status','ALREADY_APPLIED');end if;
  if j.state<>'LEASED' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then raise exception 'STALE_LEASE' using errcode='40001';end if;
  if not exists(select 1 from private.job_attempts where job_id=j.id and lease_token=p_token and effect_state='DISPATCH_INTENT') then raise exception 'EFFECT_INTENT_REQUIRED';end if;
  select external_receipt into previous from private.effect_receipts where effect_key=j.effect_key;
  if previous is not null and previous<>p_receipt then raise exception 'RECEIPT_CONFLICT';end if;
  insert into private.effect_receipts(effect_key,external_receipt) values(j.effect_key,p_receipt) on conflict(effect_key) do nothing;
  update private.jobs set state='SUCCEEDED',completed_at=clock_timestamp(),lease_until=null where id=j.id;
  update private.job_attempts set ended_at=clock_timestamp(),result='SUCCEEDED',effect_state='ACCEPTED' where job_id=j.id and lease_token=p_token;
  return jsonb_build_object('status','APPLIED');
end$$;
create or replace function public.m0_fail(p_job uuid,p_token uuid,p_uncertain boolean,p_error_code text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;next_state private.job_state;
begin
  perform private.assert_server();perform private.assert_initialized();
  if p_uncertain is null then raise exception 'UNCERTAINTY_REQUIRED';end if;
  if p_error_code is null or length(p_error_code) not between 1 and 100 then raise exception 'ERROR_CODE_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'LEASED' or j.lease_token is distinct from p_token or j.lease_until<=clock_timestamp() then raise exception 'STALE_LEASE' using errcode='40001';end if;
  next_state:=case when p_uncertain then 'WAIT_CONFIRMATION'::private.job_state when j.attempts>=j.max_attempts then 'DLQ'::private.job_state else 'QUEUED'::private.job_state end;
  update private.jobs set state=next_state,available_at=clock_timestamp()+least(60,power(2,j.attempts)) * interval '1 second',lease_token=null,lease_until=null,last_error_code=p_error_code where id=j.id;
  update private.job_attempts set ended_at=clock_timestamp(),result=next_state::text,effect_state=case when p_uncertain then 'UNCERTAIN' else 'NOT_SENT_CONFIRMED' end where job_id=j.id and lease_token=p_token;
  return jsonb_build_object('state',next_state,'effect_key',j.effect_key);
end$$;
create or replace function public.m0_reconcile(p_job uuid,p_outcome text,p_proof text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_editor();perform private.assert_initialized();
  if p_outcome is null or p_outcome not in ('ACCEPTED','CONFIRMED_NOT_SENT') or p_proof is null or length(p_proof) not between 1 and 300 then raise exception 'TERMINAL_PROVIDER_PROOF_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'WAIT_CONFIRMATION' then raise exception 'NOT_AWAITING_CONFIRMATION';end if;
  if p_outcome='ACCEPTED' then
    insert into private.effect_receipts(effect_key,external_receipt) values(j.effect_key,p_proof) on conflict(effect_key) do nothing;
    update private.jobs set state='SUCCEEDED',completed_at=clock_timestamp() where id=j.id;
    update private.job_attempts set effect_state='ACCEPTED' where job_id=j.id and effect_state in ('DISPATCH_INTENT','UNCERTAIN');
  else
    if exists(select 1 from private.effect_receipts where effect_key=j.effect_key) then raise exception 'EFFECT_ALREADY_ACCEPTED';end if;
    update private.job_attempts set effect_state='NOT_SENT_CONFIRMED' where job_id=j.id and effect_state in ('DISPATCH_INTENT','UNCERTAIN');
    update private.jobs set state=case when attempts>=max_attempts then 'DLQ'::private.job_state else 'QUEUED'::private.job_state end,available_at=clock_timestamp() where id=j.id;
  end if;
  insert into private.audits(actor_id,action,entity_id,details) values(private.caller_role(),'RECONCILE',j.id::text,jsonb_build_object('outcome',p_outcome,'proof',p_proof,'original_effect_key',j.effect_key));
  return jsonb_build_object('effect_key',j.effect_key,'outcome',p_outcome);
end$$;
create function public.m0_requeue_dlq(p_job uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin
  perform private.assert_editor();perform private.assert_initialized();if p_reason is null or length(p_reason) not between 3 and 200 then raise exception 'REPLAY_REASON_REQUIRED';end if;
  select * into strict j from private.jobs where id=p_job for update;
  if j.state<>'DLQ' or j.attempts>=10 or exists(select 1 from private.effect_receipts where effect_key=j.effect_key) or exists(select 1 from private.job_attempts where job_id=j.id and effect_state in ('DISPATCH_INTENT','UNCERTAIN')) then raise exception 'REPLAY_NOT_ALLOWED';end if;
  update private.jobs set state='QUEUED',available_at=clock_timestamp(),max_attempts=attempts+1 where id=j.id;
  insert into private.audits(actor_id,action,entity_id,details) values(private.caller_role(),'DLQ_REPLAY',j.id::text,jsonb_build_object('reason',p_reason,'original_effect_key',j.effect_key));
  return jsonb_build_object('effect_key',j.effect_key,'max_attempts',j.attempts+1);
end$$;
create function public.m0_job_status(p_job uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j private.jobs;
begin perform private.assert_server();select * into strict j from private.jobs where id=p_job;
  return jsonb_build_object('id',j.id,'effect_key',j.effect_key,'state',j.state,'attempts',j.attempts,'max_attempts',j.max_attempts,'lease_until',j.lease_until,'last_error_code',j.last_error_code,'receipt',(select external_receipt from private.effect_receipts where effect_key=j.effect_key));
end$$;
create function public.m0_enqueue_due() returns integer language plpgsql security definer set search_path='' as $$
declare s private.schedules;j jsonb;n integer:=0;
begin
  perform private.assert_server();perform private.assert_initialized();
  for s in select * from private.schedules where enabled and due_at<=clock_timestamp() and enqueued_job_id is null for update skip locked loop
    j:=public.m0_enqueue(s.effect_key,jsonb_build_object('fixture_run_id',s.fixture_run_id,'mode','NORMAL'));
    update private.schedules set enqueued_job_id=(j->>'id')::uuid where id=s.id;n:=n+1;
  end loop;return n;
end$$;
create function private.assert_installation(p_install uuid,p_secret text,p_version integer) returns void language plpgsql set search_path='' as $$
begin
  if p_secret is null or length(p_secret)<>64 or not exists(select 1 from private.installations where id=p_install and secret_version=p_version and revoked_at is null and expires_at>clock_timestamp() and secret_hash=extensions.digest(convert_to(p_secret,'UTF8'),'sha256')) then raise exception 'INSTALLATION_UNAUTHORIZED' using errcode='42501';end if;
end$$;
create function public.m0_create_installation() returns jsonb language plpgsql security definer set search_path='' as $$
declare i uuid:=gen_random_uuid();secret text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  perform private.assert_server();perform private.assert_initialized();
  insert into private.installations(id,secret_hash,expires_at) values(i,extensions.digest(convert_to(secret,'UTF8'),'sha256'),clock_timestamp()+interval '1 day');
  insert into private.installation_settings(installation_id) values(i);
  return jsonb_build_object('installation_id',i,'secret',secret,'secret_version',1,'sample_kind','SYNTHETIC','notice','Server-only local capability fixture; never log this response');
end$$;
create function public.m0_get_settings(p_install uuid,p_secret text,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.installation_settings;
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  select * into strict s from private.installation_settings where installation_id=p_install;
  return jsonb_build_object('morning_issue',s.morning_issue,'closing_issue',s.closing_issue,'favorite_sector_issue',s.favorite_sector_issue,'sector_ids',s.sector_ids);
end$$;
create or replace function public.m0_update_settings(p_install uuid,p_secret text,p_version integer,p_morning boolean,p_closing boolean,p_favorite boolean,p_sector_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  if p_morning is null or p_closing is null or p_favorite is null or p_sector_ids is null then raise exception 'SETTINGS_REQUIRED';end if;
  if cardinality(p_sector_ids)<>(select count(distinct u.sector_id) from unnest(p_sector_ids) as u(sector_id)) then raise exception 'DUPLICATE_OR_NULL_SECTOR';end if;
  if exists(select 1 from unnest(p_sector_ids) as u(sector_id) where not exists(select 1 from private.sectors as s where s.id=u.sector_id and s.active)) then raise exception 'INACTIVE_SECTOR';end if;
  update private.installation_settings set morning_issue=p_morning,closing_issue=p_closing,favorite_sector_issue=p_favorite,sector_ids=p_sector_ids,updated_at=clock_timestamp() where installation_id=p_install;
  return public.m0_get_settings(p_install,p_secret,p_version);
end$$;
create function public.m0_rotate_installation(p_install uuid,p_secret text,p_version integer) returns jsonb language plpgsql security definer set search_path='' as $$
declare secret text:=encode(extensions.gen_random_bytes(32),'hex');
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  update private.installations set secret_hash=extensions.digest(convert_to(secret,'UTF8'),'sha256'),secret_version=secret_version+1,expires_at=clock_timestamp()+interval '1 day' where id=p_install and secret_version=p_version;
  if not found then raise exception 'INSTALLATION_UNAUTHORIZED' using errcode='42501';end if;
  return jsonb_build_object('installation_id',p_install,'secret',secret,'secret_version',p_version+1);
end$$;
create function public.m0_record_view(p_install uuid,p_secret text,p_version integer,p_issue uuid,p_event_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;event_id uuid;
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  if p_event_key is null or length(p_event_key) not between 1 and 100 then raise exception 'EVENT_KEY_REQUIRED';end if;
  r:=public.resolve_issue(p_issue);if r->>'state'<>'PUBLISHED' then raise exception 'ARTICLE_NOT_PUBLIC';end if;
  insert into private.view_events(installation_id,issue_id,event_key) values(p_install,(r->>'canonical_issue_id')::uuid,p_event_key) on conflict(installation_id,event_key) do nothing returning id into event_id;
  return jsonb_build_object('recorded',event_id is not null);
end$$;
create function public.m0_admin_view_count(p_issue uuid) returns bigint language plpgsql security definer set search_path='' as $$
begin perform private.assert_editor();perform private.assert_initialized();return(select count(*) from private.view_events where issue_id=p_issue);end$$;
create or replace function public.m0_source_technical_result(p_endpoint text,p_permission_version text,p_adapter_version text,p_checks jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare e private.endpoints;source private.sources;permission private.permission_profiles;k text;
begin
  perform private.assert_server();perform private.assert_initialized();
  select * into strict e from private.endpoints where id=p_endpoint for update;
  select * into strict source from private.sources where id=e.source_id;
  if source.sample_kind<>'SYNTHETIC' then raise exception 'REAL_SOURCE_TRANSITIONS_NOT_ENABLED_STAGE_4';end if;
  if e.status<>'TECH_TEST' or e.permission_version is distinct from p_permission_version or p_adapter_version is null or e.adapter_id is null or e.adapter_version is distinct from p_adapter_version or not exists(select 1 from private.adapters where id=e.adapter_id and version=e.adapter_version and verification_state='PASSED') then raise exception 'TECH_TEST_VERSION_CONFLICT';end if;
  select * into strict permission from private.permission_profiles where id=e.permission_profile_id and version=e.permission_version;
  if permission.status<>'VERIFIED' or permission.verified_at is null or permission.verified_at>clock_timestamp() or jsonb_array_length(permission.evidence)=0 or permission.expires_at is null or permission.expires_at<=clock_timestamp() or permission.revoked_at is not null or permission.purposes->>'MACHINE_ACCESS' is distinct from 'ALLOW' or permission.purposes->>'DISCOVERY' is distinct from 'ALLOW' then raise exception 'PERMISSION_NOT_VERIFIED';end if;
  foreach k in array array['listing','detail','id','time','pagination','failure_handling'] loop
    if p_checks->k is distinct from 'true'::jsonb then raise exception 'TECH_CHECK_INCOMPLETE';end if;
  end loop;
  update private.endpoints set status='SHADOW',health_state='SHADOW_TESTING',episode_id=gen_random_uuid(),fast_retry_count=0,reprobe_count=0,low_frequency_since=null where id=e.id;
  return jsonb_build_object('state','SHADOW','action','TECH_TEST_VERIFIED_ENTER_SHADOW','live_enabled',false);
end$$;
create trigger issue_projection_sync after insert or update on private.issues for each row execute function private.sync_public_issue();
alter function private.visible_sections(text,jsonb,timestamptz,timestamptz) stable;
alter function private.public_body(jsonb,text[],timestamptz) stable;
do $cloud05a_seal$
declare r record;role_name text;
begin
 for r in select p.oid,p.oid::regprocedure::text as signature,n.nspname||'.'||p.proname as fullname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' or n.nspname='public' and n.nspname||'.'||p.proname in ('private.assert_editor','private.assert_initialized','private.assert_installation','private.assert_server','private.caller_role','private.is_admin','private.public_body','private.sync_public_issue','private.visible_sections','public.get_public_article','public.m0_ack','public.m0_admin_view_count','public.m0_claim','public.m0_create_installation','public.m0_enqueue','public.m0_enqueue_due','public.m0_fail','public.m0_get_settings','public.m0_heartbeat','public.m0_job_status','public.m0_mark_effect_intent','public.m0_pending_confirmation','public.m0_publish','public.m0_reconcile','public.m0_record_view','public.m0_requeue_dlq','public.m0_rotate_installation','public.m0_runtime_identity','public.m0_set_publication_state','public.m0_source_technical_result','public.m0_update_settings','public.resolve_issue') loop
  if pg_get_userbyid((select proowner from pg_proc where oid=r.oid))<>'postgres' then raise exception 'CORE_OWNER';end if;
  execute 'revoke all on function '||r.signature||' from public,anon,authenticated,service_role';
 end loop;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname in ('private.assert_editor','private.assert_initialized','private.assert_installation','private.assert_server','private.caller_role','private.is_admin','private.public_body','private.sync_public_issue','private.visible_sections','public.get_public_article','public.m0_ack','public.m0_admin_view_count','public.m0_claim','public.m0_create_installation','public.m0_enqueue','public.m0_enqueue_due','public.m0_fail','public.m0_get_settings','public.m0_heartbeat','public.m0_job_status','public.m0_mark_effect_intent','public.m0_pending_confirmation','public.m0_publish','public.m0_reconcile','public.m0_record_view','public.m0_requeue_dlq','public.m0_rotate_installation','public.m0_runtime_identity','public.m0_set_publication_state','public.m0_source_technical_result','public.m0_update_settings','public.resolve_issue'))<>32 then raise exception 'CORE_FUNCTION_COUNT';end if;
 for r in select p.oid,p.proconfig,p.provolatile,n.nspname||'.'||p.proname as fullname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname in ('private.assert_editor','private.assert_initialized','private.assert_installation','private.assert_server','private.caller_role','private.is_admin','private.public_body','private.sync_public_issue','private.visible_sections','public.get_public_article','public.m0_ack','public.m0_admin_view_count','public.m0_claim','public.m0_create_installation','public.m0_enqueue','public.m0_enqueue_due','public.m0_fail','public.m0_get_settings','public.m0_heartbeat','public.m0_job_status','public.m0_mark_effect_intent','public.m0_pending_confirmation','public.m0_publish','public.m0_reconcile','public.m0_record_view','public.m0_requeue_dlq','public.m0_rotate_installation','public.m0_runtime_identity','public.m0_set_publication_state','public.m0_source_technical_result','public.m0_update_settings','public.resolve_issue') loop
  if r.proconfig is distinct from array['search_path=""'] then raise exception 'CORE_SEARCH_PATH';end if;
  foreach role_name in array array['anon','authenticated','service_role'] loop if has_function_privilege(role_name,r.oid,'EXECUTE') then raise exception 'CORE_EXECUTE_EXPOSED';end if;end loop;
  if exists(select 1 from aclexplode(coalesce((select proacl from pg_proc where oid=r.oid),acldefault('f','postgres'::regrole))) where grantee=0 and privilege_type='EXECUTE') then raise exception 'CORE_PUBLIC_EXECUTE';end if;
  if r.fullname in ('private.visible_sections','private.public_body') and r.provolatile<>'s' then raise exception 'CORE_VOLATILITY';end if;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='private.issues'::regclass and tgname='issue_projection_sync' and tgfoid='private.sync_public_issue()'::regprocedure and tgenabled='O') then raise exception 'CORE_TRIGGER';end if;
 if not exists(select 1 from pg_constraint where conrelid='private.jobs'::regclass and conname='jobs_environment_check' and pg_get_expr(conbin,conrelid)=$newcheck$(environment = 'preview'::text)$newcheck$) or to_regclass('private.jobs_confirmation_due') is null then raise exception 'CORE_JOB_SHAPE';end if;
 if (select count(*) from judoju_control.environment_identity)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from judoju_control.schema_artifacts)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.adapters)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.article_versions)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.audits)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.catalog_versions)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.checkpoints)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.claims)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.companies)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.decisions)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.deletion_ledger)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.effect_receipts)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.endpoints)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.evidence_edges)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.holds)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.impacts)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.installation_settings)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.installations)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.issue_aliases)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.issues)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.job_attempts)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.jobs)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.keyword_changes)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.keyword_definitions)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.notification_deliveries)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.outbox)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.permission_profiles)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.policies)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.purge_tasks)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.ranking_entries)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.ranking_snapshots)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.runtime_identity)<>1 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.schedules)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.sector_companies)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.sectors)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.source_documents)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.source_endpoint_links)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.source_revisions)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.sources)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.stories)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.subgroups)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.view_aggregates)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from private.view_events)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
if (select count(*) from public.news_public)<>0 then raise exception 'BASELINE_ROW_COUNT';end if;
end $cloud05a_seal$;
commit;
