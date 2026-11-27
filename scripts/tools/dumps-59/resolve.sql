CREATE OR REPLACE FUNCTION public.resolve_issue(p_issue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare canonical uuid:=p_issue;i private.issues;visited uuid[]:='{}';k integer;
begin
  for k in 1..16 loop
    if canonical=any(visited) then raise exception 'ALIAS_CYCLE';end if;visited:=array_append(visited,canonical);
    if not exists(select 1 from private.issue_aliases where alias_id=canonical) then exit;end if;
    select canonical_issue_id into canonical from private.issue_aliases where alias_id=canonical;
  end loop;
  if exists(select 1 from private.issue_aliases where alias_id=canonical) then raise exception 'ALIAS_CHAIN_LIMIT';end if;
  select * into i from private.issues where id=canonical;
  if not found or i.publication_state='DRAFT' or i.sample_kind<>'SYNTHETIC' then return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');end if;
  return jsonb_build_object('canonical_issue_id',i.id,'state',i.publication_state,'message',case i.publication_state when 'PUBLISHED' then '공개된 글' when 'CORRECTION_PENDING' then '내용 확인 중 · 기존 내용 제공 중지' when 'WITHDRAWN' then '근거 확인 불가로 게시 중단' else '현재 제공하지 않는 글' end);
end$function$

