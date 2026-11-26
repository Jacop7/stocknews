begin;
-- Company issues (2026-11-27): filings and company news differ widely in form, so the company article keeps the
-- common layout but does not show the benefit/damage/related sector blocks. Impacts stay stored: they carry the
-- sector link, company roles and evidence paths that publication checks and the company page rely on.
-- In their place a RELATED_COMPANIES block appears only when the source names other companies (counterparty,
-- acquisition target, partner); each entry is a linked company with a one-line role.
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v6;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare b jsonb;related jsonb:=coalesce(p_input->'related_companies','[]'::jsonb);x jsonb;items jsonb:='[]';company_name text;
begin
 b:=private.m1_prepare_v6(p_issue,p_input-'related_companies',p_policy,p_catalog);
 if jsonb_typeof(related)<>'array' or jsonb_array_length(related)>10 then raise exception 'RELATED_COMPANIES_INVALID';end if;
 if jsonb_array_length(related)>0 and b->>'article_kind' is distinct from 'COMPANY' then raise exception 'RELATED_COMPANIES_ONLY_FOR_COMPANY_SCOPE';end if;
 for x in select value from jsonb_array_elements(related) loop
  if jsonb_typeof(x)<>'object' or jsonb_typeof(x->'company_ref')<>'string' or jsonb_typeof(x->'role')<>'string' or length(btrim(x->>'role')) not between 2 and 80
   or not (b->'company_refs') ? (x->>'company_ref') or x->>'company_ref'=b->>'primary_company_ref' then raise exception 'RELATED_COMPANIES_INVALID';end if;
  if items @> jsonb_build_array(jsonb_build_object('company_ref',x->>'company_ref')) then raise exception 'RELATED_COMPANIES_INVALID';end if;
  select c.name into company_name from private.catalog_source_companies c where c.id=(x->>'company_ref')::uuid and c.active;
  if company_name is null or btrim(x->>'role')=company_name then raise exception 'RELATED_COMPANIES_INVALID';end if;
  items:=items||jsonb_build_array(jsonb_build_object('company_ref',x->>'company_ref','name',company_name,'role',btrim(x->>'role')));
 end loop;
 return b||jsonb_build_object('related_companies',items);
end$$;

alter function private.visible_sections(text,jsonb,timestamptz,timestamptz) rename to visible_sections_v2;
create function private.visible_sections(p_profile text,p_body jsonb,p_as_of timestamptz,p_now timestamptz) returns text[] language plpgsql stable set search_path='' as $$
declare r text[]:=private.visible_sections_v2(p_profile,p_body,p_as_of,p_now);
begin
 if p_body->>'_contract'='M1' and p_body->>'article_kind'='COMPANY' then
  r:=array(select x from unnest(r) with ordinality u(x,n) where x not in ('BENEFIT_SECTORS','DAMAGE_SECTORS','RELATED_SECTORS') order by n);
  -- Same place the sector blocks had: before RISKS, SCHEDULE and SOURCES.
  if jsonb_typeof(p_body->'related_companies')='array' and jsonb_array_length(p_body->'related_companies')>0 then
   r:=array(select x from unnest(r) with ordinality u(x,n) where x in ('KEY_ISSUES','ISSUE_ANALYSIS','SCENARIOS') order by n)||array['RELATED_COMPANIES']
    ||array(select x from unnest(r) with ordinality u(x,n) where x not in ('KEY_ISSUES','ISSUE_ANALYSIS','SCENARIOS') order by n);
  end if;
 end if;
 return r;
end$$;

alter function private.public_body(jsonb,text[],timestamptz) rename to public_body_v2;
create function private.public_body(p_body jsonb,p_sections text[],p_now timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb:=private.public_body_v2(p_body,p_sections,p_now);
begin
 if p_body->>'_contract'='M1' and 'RELATED_COMPANIES'=any(p_sections) then
  r:=r||jsonb_build_object('related_companies',(select coalesce(jsonb_agg(jsonb_build_object('source_company_ref',x->>'company_ref','name',c.name,'role',x->>'role') order by n),'[]')
   from jsonb_array_elements(p_body->'related_companies') with ordinality e(x,n) join private.catalog_source_companies c on c.id=(x->>'company_ref')::uuid and c.active));
 end if;
 return r;
end$$;
notify pgrst,'reload schema';
commit;
