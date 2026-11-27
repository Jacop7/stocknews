CREATE OR REPLACE FUNCTION private.m0_get_public_article_legacy(p_issue uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;
begin
  r:=private.m0_get_public_article_legacy_v1(p_issue);
  if r ? 'issue_id' and not exists(select 1 from private.issues where id=(r->>'issue_id')::uuid and sample_kind='SYNTHETIC') then
    return jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
  end if;
  return r;
end$function$

