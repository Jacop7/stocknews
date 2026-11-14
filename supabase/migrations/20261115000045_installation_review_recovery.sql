begin;
-- Applied SQL41-44 are unchanged. Serialize all settings writes with
-- rotation/revocation: catalog -> installation (recheck) -> settings.
alter function public.installation_settings_save(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]) rename to installation_settings_save_v2;
alter function public.installation_settings_save_v2(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]) set schema private;
create function public.installation_settings_save(p_install uuid,p_secret text,p_version integer,p_catalog bigint,p_revision bigint,
 p_morning boolean,p_closing boolean,p_favorite boolean,p_sectors uuid[]) returns jsonb
 language plpgsql security definer set search_path='' as $$
begin
 perform private.assert_server();perform private.assert_initialized();
 perform 1 from private.catalog_head where singleton for share;
 perform 1 from private.installations where id=p_install for update;
 perform private.assert_installation(p_install,p_secret,p_version);
 return private.installation_settings_save_v2(p_install,p_secret,p_version,p_catalog,p_revision,p_morning,p_closing,p_favorite,p_sectors);
end$$;
-- Coverage is the synchronously committed accepted-event ledger, not all app
-- visits or client delivery. No-event intervals are not ingestion gaps.
-- Known loss must be marked explicitly; this service-only marker is reserved
-- for the reconciler. It cannot clear/advance a gap or rewrite event times.
create function public.installation_qa_mark_gap(p_since timestamptz) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare c private.installation_qa_coverage;
begin
 perform private.assert_server();perform private.assert_initialized();
 select * into strict c from private.installation_qa_coverage where singleton for update;
 if p_since is null or p_since<c.started_at or p_since>statement_timestamp() then raise exception 'INVALID_COVERAGE_GAP';end if;
 update private.installation_qa_coverage set gap_since=least(coalesce(gap_since,p_since),p_since) where singleton;
 return jsonb_build_object('mode','LOCAL_QA','state','GAP_RECORDED','gap_since',least(coalesce(c.gap_since,p_since),p_since));
end$$;
create or replace function public.installation_admin_stats(p_start timestamptz,p_end timestamptz,p_issue uuid default null,p_sector uuid default null) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare as_of timestamptz:=statement_timestamp();c private.installation_qa_coverage;quality text;rows jsonb;
begin
 perform private.m1_assert_editor();perform private.assert_initialized();
 if p_start is null or p_end is null or p_start>=p_end or p_end>as_of then raise exception 'INVALID_STATS_PERIOD';end if;
 select * into strict c from private.installation_qa_coverage where singleton;
 quality:=case when p_start<as_of-interval '30 days'+interval '1 hour' then 'UNSUPPORTED'
  when p_start<c.started_at or c.gap_since is not null and c.gap_since<p_end then 'PARTIAL' else 'COMPLETE' end;
 if quality='UNSUPPORTED' then
  -- Daily UV is historical per original issue/day, never a period UV or sum of UVs.
  select coalesce(jsonb_agg(jsonb_build_object('issue_id',d.issue_id,'day',d.day,'pv',d.pv,
   'daily_uv',case when private.installation_canonical(d.issue_id)=d.issue_id and not exists(select 1 from private.issue_aliases a where a.canonical_issue_id=d.issue_id) then d.uv else null end,
   'uv_quality',case when private.installation_canonical(d.issue_id)<>d.issue_id or exists(select 1 from private.issue_aliases a where a.canonical_issue_id=d.issue_id) then 'UNAVAILABLE_MERGED_UV' else 'HISTORICAL_ORIGINAL_ISSUE_DAY' end,
   'provenance',d.provenance) order by d.day,d.issue_id),'[]') into rows
  from private.installation_qa_daily d join private.issues i on i.id=d.issue_id
  where d.day>=((greatest(p_start,as_of-interval '1 year')) at time zone 'Asia/Seoul')::date and d.day<=(p_end at time zone 'Asia/Seoul')::date
   and (p_issue is null or private.installation_canonical(d.issue_id)=private.installation_canonical(p_issue))
   and (p_sector is null or i.primary_sector_id=p_sector);
  return jsonb_build_object('mode','LOCAL_QA','as_of',as_of,'window_start',p_start,'window_end',p_end,'coverage_semantics','ACCEPTED_SERVER_EVENTS_SNAPSHOT','quality',quality,'period_uv',null,'daily_history',rows,'operational_pv',0,'operational_uv',0,'ranking_use',false,
   'inflow','UNSUPPORTED','original_source_clicks','UNSUPPORTED','collection_started_at',c.started_at,'collected_through',case when c.gap_since is null then as_of else least(c.gap_since,as_of) end,'last_accepted_at',(select max(accepted_at) from private.installation_qa_views));
 end if;
 select coalesce(jsonb_agg(x order by x.pv desc,x.issue_id),'[]') into rows from
 (select private.installation_canonical(e.issue_id) issue_id,count(*) pv,case when quality='COMPLETE' then count(distinct e.installation_id) else null end uv
  from private.installation_qa_views e join private.issues i on i.id=private.installation_canonical(e.issue_id)
  where e.accepted_at>=greatest(p_start,as_of-interval '30 days') and e.accepted_at<p_end
   and (p_issue is null or private.installation_canonical(e.issue_id)=private.installation_canonical(p_issue)) and (p_sector is null or i.primary_sector_id=p_sector)
  group by private.installation_canonical(e.issue_id)) x;
 return jsonb_build_object('mode','LOCAL_QA','as_of',as_of,'window_start',p_start,'window_end',p_end,'coverage_semantics','ACCEPTED_SERVER_EVENTS_SNAPSHOT','quality',quality,'items',rows,'period_uv',case when quality='COMPLETE' then (select count(distinct e.installation_id)
  from private.installation_qa_views e join private.issues i on i.id=private.installation_canonical(e.issue_id)
  where e.accepted_at>=p_start and e.accepted_at<p_end and (p_issue is null or i.id=private.installation_canonical(p_issue)) and (p_sector is null or i.primary_sector_id=p_sector)) else null end,
  'operational_pv',0,'operational_uv',0,'ranking_use',false,'inflow','UNSUPPORTED','original_source_clicks','UNSUPPORTED','collection_started_at',c.started_at,'collected_through',case when c.gap_since is null then as_of else least(c.gap_since,as_of) end,'last_accepted_at',(select max(accepted_at) from private.installation_qa_views));
end$$;
revoke execute on function public.installation_settings_save(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]),public.installation_qa_mark_gap(timestamptz) from public,anon,authenticated;
grant execute on function public.installation_settings_save(uuid,text,integer,bigint,bigint,boolean,boolean,boolean,uuid[]),public.installation_qa_mark_gap(timestamptz) to service_role;
notify pgrst,'reload schema';
commit;
