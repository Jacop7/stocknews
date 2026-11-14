begin;
-- Avoid a PL/pgSQL variable shadowing the description column on UPDATE.
create or replace function private.catalog_edit_sector(p_kind text,p_entity uuid,p_payload jsonb,p_head bigint) returns uuid language plpgsql set search_path='' as $$
declare entity uuid:=p_entity;target private.sectors;label text;new_description text;parent uuid;kind text;ordering integer;affected uuid[];issue_ids uuid[];impact jsonb;
begin
 perform 1 from private.catalog_head where singleton for update;
 perform private.catalog_require_reference_head(p_head);
 if p_kind='SECTOR_CREATE' then
  perform private.catalog_assert_payload(p_payload,array['name','description','parent_id','catalog_kind','display_order'],array['name','catalog_kind']);
  if p_entity is not null then raise exception 'SERVER_ENTITY_ID_REQUIRED';end if;
  kind:=private.catalog_string(p_payload,'catalog_kind');
  if kind not in ('PARENT','LEAF') then raise exception 'INVALID_CATALOG_KIND';end if;
  if (select count(*) from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED' and catalog_kind=kind and active)>=(case when kind='PARENT' then 50 else 200 end) then raise exception 'CATALOG_ENTITY_LIMIT';end if;
  label:=private.catalog_label(private.catalog_string(p_payload,'name'));
  new_description:=private.catalog_description(private.catalog_string(p_payload,'description',''));
  parent:=(p_payload->>'parent_id')::uuid;
  if kind='LEAF' then perform private.catalog_active_parent(parent);elsif parent is not null then raise exception 'INVALID_CATALOG_PARENT';end if;
  if exists(select 1 from private.sectors s where s.metadata_kind='USER_REFERENCE_UNVERIFIED' and s.catalog_kind=kind and normalize(s.name,NFC)=label) then raise exception 'CATALOG_NAME_COLLISION';end if;
  ordering:=private.catalog_order(p_payload->'display_order',0);entity:=gen_random_uuid();
  insert into private.sectors(id,name,description,parent_id,display_order,catalog_version,sample_kind,metadata_kind,catalog_kind)
  values(entity,label,new_description,parent,ordering,p_head,null,'USER_REFERENCE_UNVERIFIED',kind);
  if kind='LEAF' then insert into private.catalog_sector_data(sector_id) values(entity);end if;
  return entity;
 end if;
 select * into target from private.sectors s where s.id=p_entity and s.metadata_kind='USER_REFERENCE_UNVERIFIED' for update;
 if not found then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 if p_kind='SECTOR_UPDATE' then
  perform private.catalog_assert_payload(p_payload,array['name','description','parent_id','display_order']);
  if p_payload='{}' then raise exception 'INVALID_CATALOG_PAYLOAD';end if;
  if not target.active then raise exception 'CATALOG_ENTITY_INACTIVE';end if;
  label:=private.catalog_label(private.catalog_string(p_payload,'name',target.name));
  new_description:=private.catalog_description(private.catalog_string(p_payload,'description',target.description));
  parent:=case when p_payload ? 'parent_id' then (p_payload->>'parent_id')::uuid else target.parent_id end;
  if target.catalog_kind='LEAF' then perform private.catalog_active_parent(parent);elsif parent is not null then raise exception 'INVALID_CATALOG_PARENT';end if;
  if exists(select 1 from private.sectors s where s.metadata_kind='USER_REFERENCE_UNVERIFIED' and s.catalog_kind=target.catalog_kind and s.id<>p_entity and normalize(s.name,NFC)=label) then raise exception 'CATALOG_NAME_COLLISION';end if;
  update private.sectors set name=label,description=new_description,parent_id=parent,display_order=private.catalog_order(p_payload->'display_order',target.display_order) where id=p_entity;
 elsif p_kind='SECTOR_DEACTIVATE' then
  perform private.catalog_assert_payload(p_payload,array['impact_sha256'],array['impact_sha256']);
  if not target.active then raise exception 'CATALOG_ENTITY_INACTIVE';end if;
  select array_agg(id order by id) into affected from private.sectors s where s.metadata_kind='USER_REFERENCE_UNVERIFIED' and (s.id=p_entity or s.parent_id=p_entity);
  issue_ids:=private.catalog_affected_issues(affected);
  perform 1 from private.issues i where i.id=any(issue_ids) order by i.id for update;
  impact:=private.catalog_impact(p_entity);
  if p_payload->>'impact_sha256' is distinct from impact->>'impact_sha256' then raise exception 'CATALOG_IMPACT_CHANGED';end if;
  update private.catalog_memberships set active=false where sector_id=any(affected) and active;
  update private.subgroups set active=false where sector_id=any(affected) and metadata_kind='USER_REFERENCE_UNVERIFIED';
  update private.sectors set active=false where id=any(affected);
  update private.issues set publication_state='CORRECTION_PENDING',revision=revision+1 where id=any(issue_ids) and publication_state='PUBLISHED';
 elsif p_kind='SECTOR_RESTORE' then
  perform private.catalog_assert_payload(p_payload,array['display_order']);
  if target.active then raise exception 'INVALID_CATALOG_STATE';end if;
  if target.catalog_kind='LEAF' then perform private.catalog_active_parent(target.parent_id);end if;
  update private.sectors set active=true,display_order=private.catalog_order(p_payload->'display_order',target.display_order) where id=p_entity;
  -- Restoring metadata never republishes a correction-pending article or silently
  -- reactivates descendant groups/memberships. Each restoration is explicit.
 else raise exception 'CATALOG_OPERATION_NOT_ALLOWED';end if;
 return entity;
end$$;
commit;
