begin;
alter table private.catalog_memberships alter constraint catalog_memberships_subgroup_id_sector_id_fkey deferrable initially immediate;

create function private.catalog_edit_group(p_kind text,p_entity uuid,p_payload jsonb) returns uuid language plpgsql set search_path='' as $$
declare target private.subgroups;entity uuid:=p_entity;leaf uuid;label text;new_order integer;
begin
 if p_kind='GROUP_CREATE' then
  perform private.catalog_assert_payload(p_payload,array['sector_id','name','display_order'],array['sector_id','name']);
  if p_entity is not null then raise exception 'SERVER_ENTITY_ID_REQUIRED';end if;
  leaf:=(p_payload->>'sector_id')::uuid;perform private.catalog_active_leaf(leaf);
  label:=private.catalog_label(private.catalog_string(p_payload,'name'));
  if (select count(*) from private.subgroups where sector_id=leaf and metadata_kind='USER_REFERENCE_UNVERIFIED')>=100 then raise exception 'CATALOG_ENTITY_LIMIT';end if;
  if exists(select 1 from private.subgroups where sector_id=leaf and metadata_kind='USER_REFERENCE_UNVERIFIED' and normalize(name,NFC)=label) then raise exception 'CATALOG_NAME_COLLISION';end if;
  entity:=gen_random_uuid();
  insert into private.subgroups(id,sector_id,name,display_order,metadata_kind) values(entity,leaf,label,private.catalog_order(p_payload->'display_order',0),'USER_REFERENCE_UNVERIFIED');
  return entity;
 end if;
 select * into target from private.subgroups where id=p_entity and metadata_kind='USER_REFERENCE_UNVERIFIED' for update;
 if not found then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 if p_kind='GROUP_UPDATE' then
  perform private.catalog_assert_payload(p_payload,array['name','sector_id','display_order']);
  if not target.active then raise exception 'CATALOG_ENTITY_INACTIVE';end if;
  if p_payload='{}' then raise exception 'INVALID_CATALOG_PAYLOAD';end if;
  leaf:=case when p_payload ? 'sector_id' then (p_payload->>'sector_id')::uuid else target.sector_id end;
  perform private.catalog_active_leaf(leaf);
  label:=private.catalog_label(private.catalog_string(p_payload,'name',target.name));
  if exists(select 1 from private.subgroups where sector_id=leaf and metadata_kind='USER_REFERENCE_UNVERIFIED' and id<>p_entity and normalize(name,NFC)=label) then raise exception 'CATALOG_NAME_COLLISION';end if;
  if leaf<>target.sector_id and (select count(*) from private.subgroups where sector_id=leaf and metadata_kind='USER_REFERENCE_UNVERIFIED')>=100 then raise exception 'CATALOG_ENTITY_LIMIT';end if;
  set constraints private.catalog_memberships_subgroup_id_sector_id_fkey deferred;
  update private.subgroups set sector_id=leaf,name=label,display_order=private.catalog_order(p_payload->'display_order',target.display_order) where id=p_entity;
  update private.catalog_memberships set sector_id=leaf where subgroup_id=p_entity;
  set constraints private.catalog_memberships_subgroup_id_sector_id_fkey immediate;
 elsif p_kind='GROUP_DEACTIVATE' then
  perform private.catalog_assert_payload(p_payload,'{}');
  if not target.active then raise exception 'CATALOG_ENTITY_INACTIVE';end if;
  update private.catalog_memberships set active=false where subgroup_id=p_entity and active;
  update private.subgroups set active=false where id=p_entity;
 elsif p_kind='GROUP_RESTORE' then
  perform private.catalog_assert_payload(p_payload,'{}');
  if target.active then raise exception 'INVALID_CATALOG_STATE';end if;
  perform private.catalog_active_leaf(target.sector_id);
  update private.subgroups set active=true where id=p_entity;
 else raise exception 'CATALOG_OPERATION_NOT_ALLOWED';end if;
 return entity;
end$$;

create function private.catalog_edit_company(p_kind text,p_entity uuid,p_payload jsonb) returns uuid language plpgsql set search_path='' as $$
declare target private.catalog_source_companies;entity uuid:=p_entity;label text;new_description text;direct jsonb;industry jsonb;
begin
 if p_kind='COMPANY_CREATE' then
  perform private.catalog_assert_payload(p_payload,array['name','search_description','direct_terms','industry_terms'],array['name']);
  if p_entity is not null then raise exception 'SERVER_ENTITY_ID_REQUIRED';end if;
  if (select count(*) from private.catalog_source_companies)>=3000 then raise exception 'CATALOG_ENTITY_LIMIT';end if;
  label:=private.catalog_label(private.catalog_string(p_payload,'name'));
  if exists(select 1 from private.catalog_source_companies where normalize(name,NFC)=label) then raise exception 'CATALOG_NAME_COLLISION';end if;
  entity:=gen_random_uuid();
  insert into private.catalog_source_companies(id,name,search_description,direct_keywords,industry_keywords) values(entity,label,
   private.catalog_description(private.catalog_string(p_payload,'search_description','')),
   private.catalog_terms(coalesce(p_payload->'direct_terms','[]')),private.catalog_terms(coalesce(p_payload->'industry_terms','[]')));
  return entity;
 end if;
 select * into target from private.catalog_source_companies where id=p_entity for update;
 if not found then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 if p_kind='COMPANY_UPDATE' then
  perform private.catalog_assert_payload(p_payload,array['name','search_description','direct_terms','industry_terms']);
  if p_payload='{}' then raise exception 'INVALID_CATALOG_PAYLOAD';end if;
  if not target.active then raise exception 'CATALOG_ENTITY_INACTIVE';end if;
  label:=private.catalog_label(private.catalog_string(p_payload,'name',target.name));
  if exists(select 1 from private.catalog_source_companies where id<>p_entity and normalize(name,NFC)=label) then raise exception 'CATALOG_NAME_COLLISION';end if;
  new_description:=private.catalog_description(private.catalog_string(p_payload,'search_description',target.search_description));
  direct:=case when p_payload ? 'direct_terms' then private.catalog_terms(p_payload->'direct_terms') else target.direct_keywords end;
  industry:=case when p_payload ? 'industry_terms' then private.catalog_terms(p_payload->'industry_terms') else target.industry_keywords end;
  update private.catalog_source_companies set name=label,search_description=new_description,direct_keywords=direct,industry_keywords=industry where id=p_entity;
 elsif p_kind='COMPANY_DEACTIVATE' then
  perform private.catalog_assert_payload(p_payload,'{}');
  if not target.active then raise exception 'CATALOG_ENTITY_INACTIVE';end if;
  update private.catalog_memberships set active=false where source_company_ref=p_entity and active;
  update private.catalog_source_companies set active=false where id=p_entity;
 elsif p_kind='COMPANY_RESTORE' then
  perform private.catalog_assert_payload(p_payload,'{}');
  if target.active then raise exception 'INVALID_CATALOG_STATE';end if;
  update private.catalog_source_companies set active=true where id=p_entity;
 else raise exception 'CATALOG_OPERATION_NOT_ALLOWED';end if;
 return entity;
end$$;

create function private.catalog_membership_context(p_leaf uuid,p_group uuid,p_company uuid) returns void language plpgsql set search_path='' as $$
begin
 perform private.catalog_active_leaf(p_leaf);
 if not exists(select 1 from private.catalog_source_companies where id=p_company and active) then raise exception 'CATALOG_COMPANY_INACTIVE';end if;
 if p_group is not null and not exists(select 1 from private.subgroups where id=p_group and sector_id=p_leaf and active and metadata_kind='USER_REFERENCE_UNVERIFIED') then raise exception 'INVALID_CATALOG_GROUP';end if;
end$$;
create function private.catalog_edit_membership(p_kind text,p_entity uuid,p_payload jsonb) returns uuid language plpgsql set search_path='' as $$
declare target private.catalog_memberships;entity uuid:=p_entity;leaf uuid;grp uuid;company uuid;new_role text;
begin
 if p_kind='MEMBERSHIP_CREATE' then
  perform private.catalog_assert_payload(p_payload,array['sector_id','subgroup_id','source_company_ref','role','display_order'],array['sector_id','source_company_ref','role']);
  if p_entity is not null then raise exception 'SERVER_ENTITY_ID_REQUIRED';end if;
  leaf:=(p_payload->>'sector_id')::uuid;grp:=(p_payload->>'subgroup_id')::uuid;company:=(p_payload->>'source_company_ref')::uuid;
  perform private.catalog_membership_context(leaf,grp,company);
  if (select count(*) from private.catalog_memberships where sector_id=leaf)>=2000 then raise exception 'CATALOG_ENTITY_LIMIT';end if;
  if exists(select 1 from private.catalog_memberships where sector_id=leaf and subgroup_id is not distinct from grp and source_company_ref=company) then raise exception 'CATALOG_MEMBERSHIP_EXISTS';end if;
  entity:=gen_random_uuid();new_role:=private.catalog_description(private.catalog_string(p_payload,'role'),600,2000);
  insert into private.catalog_memberships(id,sector_id,subgroup_id,source_company_ref,role,display_order) values(entity,leaf,grp,company,new_role,private.catalog_order(p_payload->'display_order',0));
  return entity;
 end if;
 select * into target from private.catalog_memberships where id=p_entity for update;
 if not found then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 if p_kind='MEMBERSHIP_UPDATE' then
  perform private.catalog_assert_payload(p_payload,array['sector_id','subgroup_id','role','display_order']);
  if p_payload='{}' then raise exception 'INVALID_CATALOG_PAYLOAD';end if;
  if not target.active then raise exception 'CATALOG_ENTITY_INACTIVE';end if;
  leaf:=case when p_payload ? 'sector_id' then (p_payload->>'sector_id')::uuid else target.sector_id end;
  grp:=case when p_payload ? 'subgroup_id' then (p_payload->>'subgroup_id')::uuid else target.subgroup_id end;
  perform private.catalog_membership_context(leaf,grp,target.source_company_ref);
  if exists(select 1 from private.catalog_memberships where id<>p_entity and sector_id=leaf and subgroup_id is not distinct from grp and source_company_ref=target.source_company_ref) then raise exception 'CATALOG_MEMBERSHIP_EXISTS';end if;
  new_role:=private.catalog_description(private.catalog_string(p_payload,'role',coalesce(target.role,'')),600,2000);
  update private.catalog_memberships set sector_id=leaf,subgroup_id=grp,role=new_role,display_order=private.catalog_order(p_payload->'display_order',target.display_order) where id=p_entity;
 elsif p_kind='MEMBERSHIP_DEACTIVATE' then
  perform private.catalog_assert_payload(p_payload,'{}');
  if not target.active then raise exception 'CATALOG_ENTITY_INACTIVE';end if;
  update private.catalog_memberships set active=false where id=p_entity;
 elsif p_kind='MEMBERSHIP_RESTORE' then
  perform private.catalog_assert_payload(p_payload,'{}');
  if target.active then raise exception 'INVALID_CATALOG_STATE';end if;
  perform private.catalog_membership_context(target.sector_id,target.subgroup_id,target.source_company_ref);
  update private.catalog_memberships set active=true where id=p_entity;
 else raise exception 'CATALOG_OPERATION_NOT_ALLOWED';end if;
 return entity;
end$$;

create function private.catalog_edit_keywords(p_entity uuid,p_payload jsonb) returns uuid language plpgsql set search_path='' as $$
declare term_kind text;replacement jsonb;entry jsonb;retained jsonb;
begin
 perform private.catalog_assert_payload(p_payload,array['keyword_kind','terms'],array['keyword_kind','terms']);
 perform private.catalog_active_leaf(p_entity);
 term_kind:=private.catalog_string(p_payload,'keyword_kind');
 if term_kind not in ('INDUSTRY','CORE','ADDITIONAL') then raise exception 'INVALID_CATALOG_KEYWORD_KIND';end if;
 select coalesce(jsonb_agg(item.value order by item.n),'[]') into retained from private.catalog_sector_data d cross join lateral jsonb_array_elements(d.keywords) with ordinality item(value,n) where d.sector_id=p_entity and private.catalog_keyword_kind(item.value)<>term_kind;
 replacement:='[]';
 for entry in select value from jsonb_array_elements(private.catalog_terms(p_payload->'terms')) loop replacement:=replacement||jsonb_build_array(entry||jsonb_build_object('kind',term_kind));end loop;
 update private.catalog_sector_data set keywords=retained||replacement where sector_id=p_entity;
 return p_entity;
end$$;

create function private.catalog_reorder(p_payload jsonb) returns void language plpgsql set search_path='' as $$
declare scope text;parent uuid;grp uuid;ids uuid[];expected uuid[];
begin
 perform private.catalog_assert_payload(p_payload,array['scope','parent_id','subgroup_id','ids'],array['scope','ids']);
 scope:=private.catalog_string(p_payload,'scope');parent:=(p_payload->>'parent_id')::uuid;grp:=(p_payload->>'subgroup_id')::uuid;
 if jsonb_typeof(p_payload->'ids') is distinct from 'array' or jsonb_array_length(p_payload->'ids')>2000 or exists(select 1 from jsonb_array_elements(p_payload->'ids') v where jsonb_typeof(v)<>'string') then raise exception 'INVALID_CATALOG_ORDER';end if;
 select coalesce(array_agg(value::uuid order by n),'{}') into ids from jsonb_array_elements_text(p_payload->'ids') with ordinality v(value,n);
 if cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then raise exception 'INVALID_CATALOG_ORDER';end if;
 if scope='PARENTS' then
  if parent is not null or grp is not null then raise exception 'INVALID_CATALOG_PARENT';end if;
  select coalesce(array_agg(id),'{}') into expected from private.sectors where active and catalog_kind='PARENT' and metadata_kind='USER_REFERENCE_UNVERIFIED';
 elsif scope='SECTORS' then
  perform private.catalog_active_parent(parent);
  if grp is not null then raise exception 'INVALID_CATALOG_GROUP';end if;
  select coalesce(array_agg(id),'{}') into expected from private.sectors where active and parent_id=parent and metadata_kind='USER_REFERENCE_UNVERIFIED';
 elsif scope='GROUPS' then
  perform private.catalog_active_leaf(parent);
  if grp is not null then raise exception 'INVALID_CATALOG_GROUP';end if;
  select coalesce(array_agg(id),'{}') into expected from private.subgroups where active and sector_id=parent and metadata_kind='USER_REFERENCE_UNVERIFIED';
 elsif scope='MEMBERSHIPS' then
  perform private.catalog_active_leaf(parent);
  select coalesce(array_agg(id),'{}') into expected from private.catalog_memberships where active and sector_id=parent and subgroup_id is not distinct from grp;
 else raise exception 'INVALID_CATALOG_ORDER';end if;
 if cardinality(ids)<>cardinality(expected) or not ids@>expected then raise exception 'INCOMPLETE_CATALOG_ORDER';end if;
 if scope in ('PARENTS','SECTORS') then update private.sectors s set display_order=seq.n::integer from unnest(ids) with ordinality seq(id,n) where s.id=seq.id;
 elsif scope='GROUPS' then update private.subgroups s set display_order=seq.n::integer from unnest(ids) with ordinality seq(id,n) where s.id=seq.id;
 else update private.catalog_memberships s set display_order=seq.n::integer from unnest(ids) with ordinality seq(id,n) where s.id=seq.id;end if;
end$$;
commit;
