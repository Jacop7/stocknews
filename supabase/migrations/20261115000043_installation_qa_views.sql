begin;
create table private.installation_view_tickets (
 id uuid primary key default gen_random_uuid(),installation_id uuid not null references private.installations(id),
 visit_id uuid not null,issue_id uuid not null references private.issues(id),version_id uuid not null references private.article_versions(id),
 issued_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '30 minutes',
 unique(installation_id,visit_id)
);
create table private.installation_qa_views (
 id uuid primary key default gen_random_uuid(),installation_id uuid not null references private.installations(id),
 event_key uuid not null,ticket_id uuid not null unique references private.installation_view_tickets(id),
 issue_id uuid not null references private.issues(id),version_id uuid not null references private.article_versions(id),
 accepted_at timestamptz not null default clock_timestamp(),unique(installation_id,event_key)
);
create index installation_qa_views_time on private.installation_qa_views(accepted_at);
create index installation_qa_views_cooldown on private.installation_qa_views(installation_id,issue_id,accepted_at desc);
create table private.installation_view_outcomes (
 installation_id uuid not null references private.installations(id),event_key uuid not null,
 ticket_id uuid not null references private.installation_view_tickets(id),result jsonb not null,
 created_at timestamptz not null default clock_timestamp(),primary key(installation_id,event_key)
);
create table private.installation_qa_daily (
 issue_id uuid not null references private.issues(id),day date not null,pv bigint not null check(pv>=0),uv bigint not null check(uv>=0),
 mode text not null default 'LOCAL_QA' check(mode='LOCAL_QA'),provenance text not null default 'ACCEPTED_CANONICAL_AT_KST_DAY',
 updated_at timestamptz not null default clock_timestamp(),primary key(issue_id,day)
);
create table private.installation_qa_coverage (
 singleton boolean primary key default true check(singleton),started_at timestamptz not null default clock_timestamp(),
 collected_through timestamptz not null default clock_timestamp(),gap_since timestamptz,
 mode text not null default 'LOCAL_QA' check(mode='LOCAL_QA')
);
create table private.installation_retention_ledger (
 id uuid primary key default gen_random_uuid(),action text not null default 'RETENTION_TTL' check(action='RETENTION_TTL'),
 raw_deleted integer not null,daily_deleted integer not null,tickets_deleted integer not null,history_deleted integer not null,
 occurred_at timestamptz not null default clock_timestamp()
);
insert into private.installation_qa_coverage(singleton) values(true);
alter table private.installation_view_tickets enable row level security;
alter table private.installation_qa_views enable row level security;
alter table private.installation_view_outcomes enable row level security;
alter table private.installation_qa_daily enable row level security;
alter table private.installation_qa_coverage enable row level security;
alter table private.installation_retention_ledger enable row level security;
create function private.installation_canonical(p_issue uuid) returns uuid language plpgsql stable set search_path='' as $$
declare current_id uuid:=p_issue;next_id uuid;seen uuid[]:='{}';n integer;
begin
 for n in 1..16 loop
  if current_id=any(seen) then raise exception 'ALIAS_CYCLE';end if;seen:=array_append(seen,current_id);
  select canonical_issue_id into next_id from private.issue_aliases where alias_id=current_id;
  if not found then return current_id;end if;current_id:=next_id;
 end loop;
 raise exception 'ALIAS_CHAIN_LIMIT';
end$$;
create function public.installation_view(p_action text,p_install uuid,p_secret text,p_version integer,p_request jsonb) returns jsonb
 language plpgsql security definer set search_path='' as $$
declare canonical uuid;v uuid;t private.installation_view_tickets;v_event private.installation_view_outcomes;visit uuid;outcome jsonb;
 at_time timestamptz:=clock_timestamp();day_key date;
begin
 perform private.assert_server();perform private.assert_initialized();
 perform 1 from private.catalog_head where singleton for share;
 perform private.assert_installation(p_install,p_secret,p_version);
 -- Serialize accepts per installation before the cooldown and unique-key checks.
 perform 1 from private.installations where id=p_install for update;
 perform private.assert_installation(p_install,p_secret,p_version);
 at_time:=clock_timestamp();
 if p_action='TICKET' then
  visit:=(p_request->>'visit_id')::uuid;v:=(p_request->>'version_id')::uuid;
  canonical:=private.installation_canonical((p_request->>'issue_id')::uuid);
  perform 1 from private.issues where id=canonical for share;
  if visit is null or v is null or not exists(select 1 from private.issues i join private.article_versions av on av.id=i.current_version_id
   where i.id=canonical and i.current_version_id=v and i.publication_state='PUBLISHED' and i.sample_kind='SYNTHETIC' and av.public_body->>'_contract'='M1' and private.m1_current_evidence(i.id)) then raise exception 'ARTICLE_NOT_CURRENT';end if;
  insert into private.installation_view_tickets(installation_id,visit_id,issue_id,version_id) values(p_install,visit,canonical,v) on conflict do nothing;
  select * into strict t from private.installation_view_tickets where installation_id=p_install and visit_id=visit;
  if t.issue_id<>canonical or t.version_id<>v then raise exception 'VISIT_PAYLOAD_CONFLICT';end if;
  return jsonb_build_object('ticket_id',t.id,'issue_id',t.issue_id,'version_id',t.version_id,'issued_at',t.issued_at,'expires_at',t.expires_at,'mode','LOCAL_QA');
 end if;
 if p_action<>'ACCEPT' or p_request->>'event_key' is null then raise exception 'INVALID_VIEW_ACTION';end if;
 select * into t from private.installation_view_tickets where id=(p_request->>'ticket_id')::uuid and installation_id=p_install for update;
 if not found then raise exception 'VIEW_TICKET_INVALID';end if;
 select * into v_event from private.installation_view_outcomes where installation_id=p_install and event_key=(p_request->>'event_key')::uuid;
 if found then
  if v_event.ticket_id<>t.id then raise exception 'VIEW_EVENT_PAYLOAD_CONFLICT';end if;
  return v_event.result||jsonb_build_object('duplicate',true);
 end if;
 if exists(select 1 from private.installation_qa_views where ticket_id=t.id) then raise exception 'VISIT_ALREADY_RECORDED';end if;
 if at_time<t.issued_at+interval '3 seconds' then raise exception 'VIEW_TOO_EARLY';end if;
 if at_time>=t.expires_at then raise exception 'VIEW_TICKET_EXPIRED';end if;
 canonical:=private.installation_canonical(t.issue_id);
 perform 1 from private.issues where id=canonical for share;
 if canonical<>t.issue_id or not exists(select 1 from private.issues i where i.id=t.issue_id and i.current_version_id=t.version_id
  and i.publication_state='PUBLISHED' and i.sample_kind='SYNTHETIC' and private.m1_current_evidence(i.id)) then raise exception 'ARTICLE_NOT_CURRENT';end if;
 if exists(select 1 from private.installation_qa_views e where e.installation_id=p_install
  and private.installation_canonical(e.issue_id)=canonical and e.accepted_at>at_time-interval '60 seconds') then
  outcome:=jsonb_build_object('state','EXCLUDED','reason','INSTALLATION_ISSUE_COOLDOWN','mode','LOCAL_QA');
  insert into private.installation_view_outcomes(installation_id,event_key,ticket_id,result) values(p_install,(p_request->>'event_key')::uuid,t.id,outcome);
  return outcome;
 end if;
 insert into private.installation_qa_views(installation_id,event_key,ticket_id,issue_id,version_id,accepted_at)
 values(p_install,(p_request->>'event_key')::uuid,t.id,t.issue_id,t.version_id,at_time);
 day_key:=(at_time at time zone 'Asia/Seoul')::date;
 insert into private.installation_qa_daily(issue_id,day,pv,uv) values(t.issue_id,day_key,0,0) on conflict do nothing;
 perform 1 from private.installation_qa_daily where issue_id=t.issue_id and day=day_key for update;
 insert into private.installation_qa_daily(issue_id,day,pv,uv)
 select t.issue_id,day_key,count(*),count(distinct installation_id) from private.installation_qa_views
 where issue_id=t.issue_id and accepted_at>=(day_key::timestamp at time zone 'Asia/Seoul') and accepted_at<((day_key+1)::timestamp at time zone 'Asia/Seoul')
 on conflict(issue_id,day) do update set pv=excluded.pv,uv=excluded.uv,updated_at=at_time;
 update private.installation_qa_coverage set collected_through=at_time where singleton;
 outcome:=jsonb_build_object('state','ACCEPTED','duplicate',false,'mode','LOCAL_QA');
 insert into private.installation_view_outcomes(installation_id,event_key,ticket_id,result) values(p_install,(p_request->>'event_key')::uuid,t.id,outcome);
 return outcome;
end$$;
create function public.installation_admin_stats(p_start timestamptz,p_end timestamptz,p_issue uuid default null,p_sector uuid default null) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare as_of timestamptz:=statement_timestamp();c private.installation_qa_coverage;quality text;rows jsonb;
begin
 perform private.m1_assert_editor();perform private.assert_initialized();
 if p_start is null or p_end is null or p_start>=p_end or p_end>as_of then raise exception 'INVALID_STATS_PERIOD';end if;
 select * into strict c from private.installation_qa_coverage where singleton;
 quality:=case when p_start<as_of-interval '30 days'+interval '1 hour' then 'UNSUPPORTED'
  when p_start<c.started_at or p_end>c.collected_through or c.gap_since is not null and c.gap_since<p_end then 'PARTIAL' else 'COMPLETE' end;
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
  return jsonb_build_object('mode','LOCAL_QA','as_of',as_of,'quality',quality,'period_uv',null,'daily_history',rows,'operational_pv',0,'operational_uv',0,'ranking_use',false,
   'inflow','UNSUPPORTED','original_source_clicks','UNSUPPORTED','collection_started_at',c.started_at,'collected_through',c.collected_through);
 end if;
 select coalesce(jsonb_agg(x order by x.pv desc,x.issue_id),'[]') into rows from
 (select private.installation_canonical(e.issue_id) issue_id,count(*) pv,count(distinct e.installation_id) uv
  from private.installation_qa_views e join private.issues i on i.id=private.installation_canonical(e.issue_id)
  where e.accepted_at>=greatest(p_start,as_of-interval '30 days') and e.accepted_at<p_end
   and (p_issue is null or private.installation_canonical(e.issue_id)=private.installation_canonical(p_issue)) and (p_sector is null or i.primary_sector_id=p_sector)
  group by private.installation_canonical(e.issue_id)) x;
 return jsonb_build_object('mode','LOCAL_QA','as_of',as_of,'quality',quality,'items',rows,'period_uv',case when quality='COMPLETE' then (select count(distinct e.installation_id)
  from private.installation_qa_views e join private.issues i on i.id=private.installation_canonical(e.issue_id)
  where e.accepted_at>=p_start and e.accepted_at<p_end and (p_issue is null or i.id=private.installation_canonical(p_issue)) and (p_sector is null or i.primary_sector_id=p_sector)) else null end,
  'operational_pv',0,'operational_uv',0,'ranking_use',false,'inflow','UNSUPPORTED','original_source_clicks','UNSUPPORTED','collection_started_at',c.started_at,'collected_through',c.collected_through);
end$$;
create function public.installation_qa_purge() returns jsonb language plpgsql security definer set search_path='' as $$
declare raw_count integer;daily_count integer;ticket_count integer;history_count integer;
begin
 perform private.assert_server();perform private.assert_initialized();
 delete from private.installation_qa_views where accepted_at<=clock_timestamp()-interval '30 days';get diagnostics raw_count=row_count;
 delete from private.installation_view_outcomes where created_at<=clock_timestamp()-interval '30 days';
 delete from private.installation_view_tickets t where expires_at<=clock_timestamp() and not exists(select 1 from private.installation_qa_views e where e.ticket_id=t.id)
  and not exists(select 1 from private.installation_view_outcomes e where e.ticket_id=t.id);get diagnostics ticket_count=row_count;
 delete from private.installation_qa_daily where day<((clock_timestamp()-interval '1 year') at time zone 'Asia/Seoul')::date;get diagnostics daily_count=row_count;
 delete from private.installation_setting_changes where occurred_at<=clock_timestamp()-interval '30 days';get diagnostics history_count=row_count;
 update private.installation_operations set receipt_ciphertext=null where deadline<=clock_timestamp() and receipt_ciphertext is not null;
 if raw_count+daily_count+ticket_count+history_count>0 then
  insert into private.installation_retention_ledger(raw_deleted,daily_deleted,tickets_deleted,history_deleted) values(raw_count,daily_count,ticket_count,history_count);
 end if;
 delete from private.installation_retention_ledger where occurred_at<clock_timestamp()-interval '1 year';
 return jsonb_build_object('mode','LOCAL_QA','raw_deleted',raw_count,'daily_deleted',daily_count,'tickets_deleted',ticket_count,'settings_history_deleted',history_count,'privacy_full_purge',false);
end$$;
revoke all on private.installation_view_tickets,private.installation_qa_views,private.installation_view_outcomes,private.installation_qa_daily,private.installation_qa_coverage,private.installation_retention_ledger from public,anon,authenticated;
revoke execute on function public.installation_view(text,uuid,text,integer,jsonb),public.installation_qa_purge() from public,anon,authenticated;
grant execute on function public.installation_view(text,uuid,text,integer,jsonb),public.installation_qa_purge() to service_role;
revoke execute on function public.installation_admin_stats(timestamptz,timestamptz,uuid,uuid) from public,anon;
grant execute on function public.installation_admin_stats(timestamptz,timestamptz,uuid,uuid) to authenticated,service_role;
notify pgrst,'reload schema';
commit;
