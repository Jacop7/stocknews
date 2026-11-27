CREATE OR REPLACE FUNCTION public.m1_get_draft(p_issue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;labels jsonb;companies jsonb;head bigint;k private.sample_kind;origin jsonb;
begin
 perform private.m1_assert_editor();result:=private.m1_get_draft_legacy(p_issue);
 if result is null then return null;end if;
 select sample_kind into k from private.issues where id=p_issue;
 head:=(result->>'catalog_version')::bigint;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.id),'[]') into labels from(
  select s.id,s.name,s.metadata_kind,s.active,private.catalog_sector_selectable(s.id,head,k::text) selectable
  from private.sectors s where s.id::text=result->'content'->>'primary_sector_id'
  or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(result->'content'->'impacts')='array' then result->'content'->'impacts' else '[]' end) item where item->>'sector_id'=s.id::text)
  order by s.id limit 64
 )page;
 -- Names of the companies the draft refers to, for review of company scope.
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'active',c.active) order by c.name,c.id),'[]') into companies
  from private.catalog_source_companies c where c.id::text in (
   select result->'content'->>'primary_company_ref'
   union select value from jsonb_array_elements_text(case when jsonb_typeof(result->'content'->'company_refs')='array' then result->'content'->'company_refs' else '[]' end)
   union select x->>'company_ref' from jsonb_array_elements(case when jsonb_typeof(result->'content'->'impacts')='array' then result->'content'->'impacts' else '[]' end) i,
     jsonb_array_elements(case when jsonb_typeof(i->'companies')='array' then i->'companies' else '[]' end) x);
 -- The draft's own evidence (the version its claims came from) and, when the editor holds the draft, the newest
 -- evidence waiting beside it; versions are never mixed.
 if exists(select 1 from private.ai_issue_links l where l.issue_id=p_issue) then
  select jsonb_build_object(
   'link_state',(select l.state from private.ai_issue_links l where l.issue_id=p_issue),
   'draft',(select jsonb_build_object('ai_version',o.ai_version,'facts',o.facts,'sources',o.sources,'received_at',o.received_at,
      'claim_ids',(select coalesce(jsonb_object_agg(c.fact_id,c.claim_id),'{}') from private.ai_claim_links c where c.issue_id=p_issue and c.ai_version=o.ai_version))
     from private.ai_draft_origin o where o.issue_id=p_issue and o.ai_version=(select max(c.ai_version) from private.ai_claim_links c where c.issue_id=p_issue)),
   'pending',(select jsonb_build_object('ai_version',o.ai_version,'facts',o.facts,'sources',o.sources,'received_at',o.received_at)
     from private.ai_draft_origin o where o.issue_id=p_issue and o.ai_version>coalesce((select max(c.ai_version) from private.ai_claim_links c where c.issue_id=p_issue),0)
     order by o.ai_version desc limit 1)) into origin;
 end if;
 return result||jsonb_build_object('sector_labels',labels,'sample_kind',k,'ai_origin',origin,'company_labels',companies);
end$function$

