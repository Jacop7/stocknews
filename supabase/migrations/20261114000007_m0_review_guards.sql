-- S4I-C01/C02/C03 and S4I-01: preserve migrations 1-6; correct explicit null/alias and confirmation fairness.
begin;
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
  if not exists(select 1 from private.runtime_identity where environment='local') then raise exception 'SYNTHETIC_PUBLICATION_FORBIDDEN';end if;
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
create or replace function public.m0_update_settings(p_install uuid,p_secret text,p_version integer,p_morning boolean,p_closing boolean,p_favorite boolean,p_sector_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.assert_server();perform private.assert_initialized();perform private.assert_installation(p_install,p_secret,p_version);
  if p_morning is null or p_closing is null or p_favorite is null or p_sector_ids is null then raise exception 'SETTINGS_REQUIRED';end if;
  if cardinality(p_sector_ids)<>(select count(distinct u.sector_id) from unnest(p_sector_ids) as u(sector_id)) then raise exception 'DUPLICATE_OR_NULL_SECTOR';end if;
  if exists(select 1 from unnest(p_sector_ids) as u(sector_id) where not exists(select 1 from private.sectors as s where s.id=u.sector_id and s.active)) then raise exception 'INACTIVE_SECTOR';end if;
  update private.installation_settings set morning_issue=p_morning,closing_issue=p_closing,favorite_sector_issue=p_favorite,sector_ids=p_sector_ids,updated_at=clock_timestamp() where installation_id=p_install;
  return public.m0_get_settings(p_install,p_secret,p_version);
end$$;

alter table private.jobs add column confirmation_next_at timestamptz not null default clock_timestamp();
alter table private.jobs add column confirmation_checks integer not null default 0 check(confirmation_checks>=0);
create index jobs_confirmation_due on private.jobs(confirmation_next_at,created_at) where state='WAIT_CONFIRMATION';
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
alter function private.visible_sections(text,jsonb,timestamptz,timestamptz) stable;
alter function private.public_body(jsonb,text[],timestamptz) stable;

commit;
