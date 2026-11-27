CREATE OR REPLACE FUNCTION private.ai_ingest_draft(p_effect_key text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare ai text:=p_payload->>'ai_issue_id';ver integer;h text;rcpt private.ai_draft_receipts;lnk private.ai_issue_links;d jsonb;x jsonb;
  iss uuid;st uuid;head bigint;result jsonb;map jsonb:='{}';cid uuid;v_content jsonb;items jsonb;drift jsonb;i private.issues;ed private.editor_drafts;
begin
  if current_user<>'postgres' then raise exception 'AI_INBOX_POSTGRES_ONLY';end if;
  -- Identity, lock and receipt first: an exact retry always gets its stored result, a different payload for the same
  -- AI issue and version always gets AI_DRAFT_CONFLICT, whatever the switch or the validation rules say now.
  if jsonb_typeof(p_payload)<>'object' or jsonb_typeof(p_payload->'ai_issue_id') is distinct from 'string' or coalesce(ai,'')!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    or jsonb_typeof(p_payload->'ai_version')<>'number' or (p_payload->>'ai_version')!~'^[1-9][0-9]{0,8}$' then raise exception 'AI_DRAFT_VERSION';end if;
  ver:=(p_payload->>'ai_version')::integer;
  if p_effect_key is distinct from 'ai:'||ai||':'||ver then raise exception 'AI_EFFECT_KEY_MISMATCH';end if;
  perform pg_advisory_xact_lock(hashtext('ai-issue:'||ai));
  h:=encode(sha256(convert_to(p_payload::text,'UTF8')),'hex');
  select * into rcpt from private.ai_draft_receipts where effect_key=p_effect_key;
  if found then
    if rcpt.payload_sha256<>h then raise exception 'AI_DRAFT_CONFLICT';end if;
    return rcpt.result;
  end if;
  if not private.real_mode_on() then raise exception 'REAL_MODE_OFF';end if;
  perform private.ai_payload_check(p_payload);
  d:=p_payload->'draft';
  perform 1 from private.catalog_head where singleton for share;
  select version into strict head from private.catalog_head where singleton;
  select * into lnk from private.ai_issue_links where ai_issue_id=ai for update;
  if lnk.issue_id is not null then
    select * into strict i from private.issues where id=lnk.issue_id for update;
    select * into ed from private.editor_drafts where issue_id=lnk.issue_id for update;
  end if;
  if lnk.ai_issue_id is not null and ver<=lnk.current_version then
    result:=jsonb_build_object('state',case when lnk.state='WITHDRAWN' then 'WITHDRAWN' else 'STALE_VERSION' end,'ai_version',ver,'current_version',lnk.current_version);
  else
    drift:=private.ai_catalog_drift(d,head);
    if jsonb_array_length(drift)>0 then
      result:=jsonb_build_object('state','CATALOG_DRIFT','ai_version',ver,'catalog_version',head,'refs',drift);
    elsif lnk.issue_id is not null and ed.issue_id is not null and (i.manual_protected or ed.updated_by is not null) then
      -- The editor owns this draft now: keep it, keep its claims, and show the new evidence beside it.
      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at)
        values(lnk.issue_id,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',now()+interval '30 days');
      update private.ai_issue_links set current_version=ver,state='HOLD_EDITOR',reason='EDITOR_OWNS_DRAFT',updated_at=now() where ai_issue_id=ai;
      result:=jsonb_build_object('state','HOLD_EDITOR','ai_version',ver,'issue_id',lnk.issue_id);
    else
      iss:=lnk.issue_id;
      if iss is null then
        insert into private.stories(event_key) values('ai:'||(p_payload->>'story_key')) on conflict(event_key) do nothing;
        select id into strict st from private.stories where event_key='ai:'||(p_payload->>'story_key');
        insert into private.issues(story_id,angle_key,sample_kind,manual_protected) values(st,'ai:'||(p_payload->>'angle_key'),'PERMITTED_REAL',false) returning id into iss;
      elsif i.publication_state<>'DRAFT' then raise exception 'AI_ISSUE_NOT_DRAFT';
      end if;
      -- Claims are replaced as a whole: the evidence rule checks every claim of the issue.
      delete from private.ai_claim_links where issue_id=iss;
      delete from private.evidence_edges where claim_id in (select id from private.claims where issue_id=iss);
      delete from private.claims where issue_id=iss;
      for x in select value from jsonb_array_elements(p_payload->'facts') loop
        insert into private.claims(issue_id,claim_type,korea_path_verified,fact_current,official_original,verified,valid_until,sample_kind)
          -- Trust is derived here: the claim type is the AI verification class, and a fact is an official original only
          -- when every source it cites is on an official-filing host (database classification, not the sender's label).
          values(iss,x->>'verification_class',
            (x->>'korea_path_verified')::boolean,(x->>'recorded_at')::timestamptz>now()-interval '30 days',
            not exists(select 1 from jsonb_array_elements_text(x->'source_urls') u where not private.real_source_host(u.value)=any(coalesce((select official_source_hosts from private.real_mode where id=1),'{}'::text[]))),
            (x->>'independently_verified')::boolean,(x->>'recorded_at')::timestamptz+interval '30 days','PERMITTED_REAL') returning id into cid;
        insert into private.ai_claim_links(issue_id,fact_id,claim_id,ai_version) values(iss,x->>'id',cid,ver);
        map:=map||jsonb_build_object(x->>'id',cid);
      end loop;
      -- AI fact IDs become claim UUIDs only here, after the claims exist.
      v_content:=d||jsonb_build_object('analysis_perspective','KR_EQUITY','primary_sector_id',coalesce(d->'primary_sector_id','null'::jsonb),
        'key_issues',coalesce(d->'key_issues','[]'),'risks',coalesce(d->'risks','[]'),'scenarios',coalesce(d->'scenarios','[]'),
        'company_refs',coalesce(d->'company_refs','[]'));
      select coalesce(jsonb_agg((it.value-'evidence_fact_ids')||jsonb_build_object('evidence_ids',(select coalesce(jsonb_agg(map->(f#>>'{}')),'[]') from jsonb_array_elements(it.value->'evidence_fact_ids') f))),'[]')
        into items from jsonb_array_elements(coalesce(d->'impacts','[]')) it;
      v_content:=v_content||jsonb_build_object('impacts',items);
      select coalesce(jsonb_agg((it.value-'evidence_fact_ids')||jsonb_build_object('evidence_ids',(select coalesce(jsonb_agg(map->(f#>>'{}')),'[]') from jsonb_array_elements(it.value->'evidence_fact_ids') f))),'[]')
        into items from jsonb_array_elements(coalesce(d->'schedule','[]')) it;
      v_content:=v_content||jsonb_build_object('schedule',items,'sources',(select jsonb_agg(s-'role') from jsonb_array_elements(d->'sources') s));
      perform private.m1_draft_shape(v_content);
      perform 1 from private.editor_drafts where issue_id=iss for update;
      if found then update private.editor_drafts set content=v_content,revision=revision+1,updated_at=now(),updated_by=null where issue_id=iss;
      else insert into private.editor_drafts(issue_id,content,updated_by) values(iss,v_content,null);end if;
      delete from private.ai_draft_origin where issue_id=iss;
      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at)
        values(iss,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',now()+interval '30 days');
      insert into private.ai_issue_links(ai_issue_id,issue_id,current_version,state) values(ai,iss,ver,'ACTIVE')
        on conflict(ai_issue_id) do update set issue_id=excluded.issue_id,current_version=excluded.current_version,state='ACTIVE',reason='',updated_at=now();
      result:=jsonb_build_object('state','RECEIVED','ai_version',ver,'issue_id',iss,'catalog_version',head,'claims',jsonb_array_length(p_payload->'facts'));
    end if;
  end if;
  insert into private.ai_draft_receipts(effect_key,ai_issue_id,ai_version,payload_sha256,result) values(p_effect_key,ai,ver,h,result);
  insert into private.audits(actor_id,action,entity_id,details) values('ai-inbox','AI_DRAFT_'||(result->>'state'),ai,jsonb_build_object('ai_version',ver,'issue_id',result->'issue_id'));
  return result;
end$function$

