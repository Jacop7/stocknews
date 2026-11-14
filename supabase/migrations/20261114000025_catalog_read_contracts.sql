begin;
create or replace function private.catalog_sector_selectable(p_sector uuid,p_catalog bigint,p_article_mode text) returns boolean language sql stable set search_path='' as $$
 select p_article_mode='SYNTHETIC'
 and exists(select 1 from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null)
 and exists(select 1 from private.catalog_head h join private.catalog_versions v on v.version=h.version and v.active
 join private.catalog_approvals a on a.version=h.version and a.state='APPROVED'
 join private.catalog_snapshots c on c.version=h.version
 join private.catalog_version_sectors m on m.version=h.version and m.sector_id=p_sector and m.active and m.catalog_kind='LEAF'
 join private.sectors s on s.id=m.sector_id and s.active and s.catalog_kind='LEAF' and s.catalog_version=h.version
 left join private.sectors parent on parent.id=s.parent_id
 where h.version=p_catalog and
 ((c.usage_scope='LOCAL_REFERENCE' and m.metadata_kind='USER_REFERENCE_UNVERIFIED' and s.metadata_kind='USER_REFERENCE_UNVERIFIED' and s.sample_kind is null
 and parent.active and parent.catalog_kind='PARENT' and parent.metadata_kind='USER_REFERENCE_UNVERIFIED' and parent.catalog_version=h.version)
 or (c.usage_scope='LEGACY_FIXTURE' and m.metadata_kind='SYNTHETIC_FIXTURE' and s.metadata_kind='SYNTHETIC_FIXTURE' and s.sample_kind='SYNTHETIC')))
$$;
create or replace function private.catalog_version_sector_allowed(p_catalog bigint,p_sector uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from private.catalog_approvals a
 join private.catalog_version_sectors m on m.version=a.version and m.sector_id=p_sector and m.active and m.catalog_kind='LEAF'
 join private.sectors s on s.id=m.sector_id and s.active and s.catalog_kind='LEAF' and s.metadata_kind=m.metadata_kind
 left join private.sectors parent on parent.id=s.parent_id
 where a.version=p_catalog and a.state='APPROVED'
 and (s.metadata_kind='SYNTHETIC_FIXTURE' or parent.active and parent.catalog_kind='PARENT' and parent.metadata_kind='USER_REFERENCE_UNVERIFIED'))
$$;
create function private.catalog_require_reference_head(p_expected bigint) returns bigint language plpgsql stable set search_path='' as $$
declare head bigint;
begin
 perform private.assert_initialized();
 select h.version into head from private.catalog_head h join private.catalog_versions v on v.version=h.version and v.active
 join private.catalog_approvals a on a.version=h.version and a.state='APPROVED'
 join private.catalog_snapshots s on s.version=h.version and s.usage_scope='LOCAL_REFERENCE';
 if head is null then raise exception 'CATALOG_NOT_READY';end if;
 if p_expected is not null and p_expected<>head then raise exception 'STALE_CATALOG';end if;
 return head;
end$$;
create function private.catalog_tree(p_head bigint) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('catalog_version',p_head::text,'metadata_kind','USER_REFERENCE_UNVERIFIED','parents',coalesce(jsonb_agg(
 jsonb_build_object('id',parent.id,'name',parent.name,'order',parent.display_order,'sectors',
 (select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'parent_id',s.parent_id,'order',s.display_order) order by s.display_order,s.id),'[]')
 from private.sectors s where s.parent_id=parent.id and private.catalog_sector_selectable(s.id,p_head,'SYNTHETIC')))
 order by parent.display_order,parent.id),'[]'))
 from private.sectors parent where parent.metadata_kind='USER_REFERENCE_UNVERIFIED' and parent.catalog_kind='PARENT' and parent.active and parent.catalog_version=p_head
$$;
create function private.catalog_public_members(p_sector uuid,p_group uuid) returns jsonb language sql stable set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('membership_id',m.id,'source_company_ref',c.id,'name',c.name,'description',coalesce(m.role,''),
 'stock_identity_state',c.stock_identity_state,'stock_code',null,'price',null,'change_percent',null,'stock_url',null)
 order by m.display_order,m.id),'[]')
 from private.catalog_memberships m join private.catalog_source_companies c on c.id=m.source_company_ref and c.active
 where m.sector_id=p_sector and m.subgroup_id is not distinct from p_group and m.active
$$;
create function public.catalog_public_tree(p_expected bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;
begin head:=private.catalog_require_reference_head(p_expected);return private.catalog_tree(head);end$$;
create function public.catalog_public_sector(p_sector uuid,p_expected bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;sector private.sectors;groups jsonb;
begin
 head:=private.catalog_require_reference_head(p_expected);
 if not private.catalog_sector_selectable(p_sector,head,'SYNTHETIC') then return jsonb_build_object('state','NOT_FOUND','catalog_version',head::text);end if;
 select * into sector from private.sectors where id=p_sector;
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'order',g.display_order,'members',private.catalog_public_members(p_sector,g.id)) order by g.display_order,g.id),'[]') into groups
 from private.subgroups g where g.sector_id=p_sector and g.active and g.metadata_kind='USER_REFERENCE_UNVERIFIED';
 return jsonb_build_object('state','AVAILABLE','catalog_version',head::text,'id',sector.id,'name',sector.name,'description',sector.description,
 'parent_id',sector.parent_id,'metadata_kind',sector.metadata_kind,'groups',groups,'ungrouped_members',private.catalog_public_members(p_sector,null));
end$$;
create function public.catalog_editor_tree(p_expected bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;
begin perform private.m1_assert_editor();head:=private.catalog_require_reference_head(p_expected);return private.catalog_tree(head)||jsonb_build_object('actor_id',auth.uid());end$$;
create function public.catalog_editor_sectors() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(null);
 return jsonb_build_object('catalog_version',head::text,'sectors',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description',s.description) order by s.display_order,s.id),'[]') from private.sectors s where private.catalog_sector_selectable(s.id,head,'SYNTHETIC')));
end$$;
grant execute on function public.catalog_public_tree(bigint),public.catalog_public_sector(uuid,bigint) to anon,authenticated;
grant execute on function public.catalog_editor_tree(bigint),public.catalog_editor_sectors() to authenticated;
notify pgrst,'reload schema';
commit;
