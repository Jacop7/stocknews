begin;
-- Conditional (related) sectors are not shown (2026-11-27): the sector area lists clear benefit and damage sectors
-- only; the analysis and scenarios carry the conditions. Related impacts stay stored for the sector feed filter,
-- the company page and publication checks. Company articles still show no sector blocks at all.
create or replace function private.visible_sections(p_profile text,p_body jsonb,p_as_of timestamptz,p_now timestamptz) returns text[] language plpgsql stable set search_path='' as $$
declare r text[]:=private.visible_sections_v2(p_profile,p_body,p_as_of,p_now);
begin
 if p_body->>'_contract' is distinct from 'M1' then return r;end if;
 if p_body->>'article_kind'='COMPANY' then
  return array(select x from unnest(r) with ordinality u(x,n) where x not in ('BENEFIT_SECTORS','DAMAGE_SECTORS','RELATED_SECTORS') order by n);
 end if;
 return array(select x from unnest(r) with ordinality u(x,n) where x<>'RELATED_SECTORS' order by n);
end$$;
notify pgrst,'reload schema';
commit;
