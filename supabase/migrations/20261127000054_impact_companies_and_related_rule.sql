begin;
-- Sector blocks (2026-11-27): each benefit/damage/related sector lists its companies as badges, each with a
-- one-line business role, and the app links them to the company page. Related sectors are shown only when the
-- article has no clear benefit or damage sector.
alter function private.m1_prepare(uuid,jsonb,bigint,bigint) rename to m1_prepare_v7;
create function private.m1_prepare(p_issue uuid,p_input jsonb,p_policy bigint,p_catalog bigint) returns jsonb language plpgsql stable set search_path='' as $$
declare b jsonb;input_impact jsonb;x jsonb;stored jsonb:='[]';item jsonb;companies jsonb;seen text[];company_name text;
begin
 b:=private.m1_prepare_v7(p_issue,p_input,p_policy,p_catalog);
 for item in select value from jsonb_array_elements(b->'impacts') loop
  select value into input_impact from jsonb_array_elements(p_input->'impacts') where value->>'sector_id'=item->>'sector_id' and value->>'path_id'=item->>'path_id' limit 1;
  companies:='[]';seen:='{}';
  if input_impact ? 'companies' then
   if jsonb_typeof(input_impact->'companies')<>'array' or jsonb_array_length(input_impact->'companies')>20 then raise exception 'IMPACT_COMPANIES_INVALID';end if;
   for x in select value from jsonb_array_elements(input_impact->'companies') loop
    if jsonb_typeof(x)<>'object' or jsonb_typeof(x->'company_ref')<>'string' or jsonb_typeof(x->'role')<>'string' or length(btrim(x->>'role')) not between 2 and 80
     or not (b->'company_refs') ? (x->>'company_ref') or x->>'company_ref'=any(seen) then raise exception 'IMPACT_COMPANIES_INVALID';end if;
    select c.name into company_name from private.catalog_source_companies c where c.id=(x->>'company_ref')::uuid and c.active;
    -- The role explains the link; repeating the company name is not a reason.
    if company_name is null or btrim(x->>'role')=company_name then raise exception 'IMPACT_COMPANIES_INVALID';end if;
    seen:=array_append(seen,x->>'company_ref');companies:=companies||jsonb_build_array(jsonb_build_object('company_ref',x->>'company_ref','role',btrim(x->>'role')));
   end loop;
  end if;
  stored:=stored||jsonb_build_array(item||jsonb_build_object('companies',companies));
 end loop;
 return b||jsonb_build_object('impacts',stored);
end$$;

alter function private.public_body(jsonb,text[],timestamptz) rename to public_body_v3;
create function private.public_body(p_body jsonb,p_sections text[],p_now timestamptz) returns jsonb language plpgsql stable set search_path='' as $$
declare r jsonb:=private.public_body_v3(p_body,p_sections,p_now);item jsonb;items jsonb:='[]';
begin
 if p_body->>'_contract' is distinct from 'M1' or jsonb_typeof(r->'impacts') is distinct from 'array' then return r;end if;
 for item in select value from jsonb_array_elements(r->'impacts') loop
  items:=items||jsonb_build_array(item||jsonb_build_object('companies',(select coalesce(jsonb_agg(jsonb_build_object('source_company_ref',c.id,'name',c.name,'role',x->>'role') order by n),'[]')
   from jsonb_array_elements(p_body->'impacts') s cross join lateral jsonb_array_elements(coalesce(s->'companies','[]')) with ordinality e(x,n)
   join private.catalog_source_companies c on c.id=(x->>'company_ref')::uuid and c.active
   where s->>'sector_id'=item->>'sector_id' and s->>'path_id'=item->>'path_id')));
 end loop;
 return r||jsonb_build_object('impacts',items);
end$$;

create or replace function private.visible_sections(p_profile text,p_body jsonb,p_as_of timestamptz,p_now timestamptz) returns text[] language plpgsql stable set search_path='' as $$
declare r text[]:=private.visible_sections_v2(p_profile,p_body,p_as_of,p_now);
begin
 if p_body->>'_contract'='M1' and p_body->>'article_kind'='COMPANY' then
  r:=array(select x from unnest(r) with ordinality u(x,n) where x not in ('BENEFIT_SECTORS','DAMAGE_SECTORS','RELATED_SECTORS') order by n);
 elsif p_body->>'_contract'='M1' and ('BENEFIT_SECTORS'=any(r) or 'DAMAGE_SECTORS'=any(r)) then
  r:=array(select x from unnest(r) with ordinality u(x,n) where x<>'RELATED_SECTORS' order by n);
 end if;
 return r;
end$$;
notify pgrst,'reload schema';
commit;
