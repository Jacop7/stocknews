begin;
-- Related companies block removed by decision (2026-11-27): company articles show neither sector blocks nor a
-- related-companies block. Linked companies stay in company_refs for the company page. This restores the
-- functions that migration 52 wrapped for related companies; the sector-block rule of 52 stays.
drop function private.m1_prepare(uuid,jsonb,bigint,bigint);
alter function private.m1_prepare_v6(uuid,jsonb,bigint,bigint) rename to m1_prepare;
drop function private.public_body(jsonb,text[],timestamptz);
alter function private.public_body_v2(jsonb,text[],timestamptz) rename to public_body;
create or replace function private.visible_sections(p_profile text,p_body jsonb,p_as_of timestamptz,p_now timestamptz) returns text[] language plpgsql stable set search_path='' as $$
declare r text[]:=private.visible_sections_v2(p_profile,p_body,p_as_of,p_now);
begin
 if p_body->>'_contract'='M1' and p_body->>'article_kind'='COMPANY' then
  r:=array(select x from unnest(r) with ordinality u(x,n) where x not in ('BENEFIT_SECTORS','DAMAGE_SECTORS','RELATED_SECTORS') order by n);
 end if;
 return r;
end$$;
notify pgrst,'reload schema';
commit;
