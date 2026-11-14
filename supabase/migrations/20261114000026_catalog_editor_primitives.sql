begin;
-- Save/publish both take the catalog lock before the issue lock. Catalog writes take
-- the exclusive head lock, then affected issues in UUID order.
create or replace function public.m1_save_draft(p_issue uuid,p_expected_revision bigint,p_content jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();perform 1 from private.catalog_head where singleton for share;
perform 1 from private.issues where id=p_issue for update;
return private.m1_save_draft_v1(p_issue,p_expected_revision,p_content);end$$;

create function private.catalog_label(p_text text,p_max integer default 200) returns text language plpgsql immutable set search_path='' as $$
declare value text;spaces text:=' '||chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
 value:=normalize(btrim(p_text,spaces),NFC);
 if value is null or length(value) not between 1 and p_max then raise exception 'INVALID_CATALOG_TEXT';end if;
 return value;
end$$;
create function private.catalog_assert_payload(p_payload jsonb,p_allowed text[],p_required text[] default '{}') returns void language plpgsql immutable set search_path='' as $$
begin
 if jsonb_typeof(p_payload) is distinct from 'object' or pg_column_size(p_payload)>131072 then raise exception 'INVALID_CATALOG_PAYLOAD';end if;
 if exists(select 1 from jsonb_object_keys(p_payload) field_name where not field_name=any(p_allowed)) then raise exception 'CATALOG_FIELD_NOT_ALLOWED';end if;
 if exists(select 1 from unnest(p_required) field_name where not p_payload ? field_name) then raise exception 'CATALOG_FIELD_REQUIRED';end if;
end$$;
create function private.catalog_order(p_value jsonb,p_default integer default 0) returns integer language plpgsql immutable set search_path='' as $$
begin
 if p_value is null then return p_default;end if;
 if jsonb_typeof(p_value)<>'number' or (p_value#>>'{}')!~'^[0-9]{1,7}$' or (p_value#>>'{}')::integer>1000000 then raise exception 'INVALID_CATALOG_ORDER';end if;
 return (p_value#>>'{}')::integer;
end$$;
create function private.catalog_terms(p_terms jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
declare term jsonb;result jsonb:='[]';label text;
begin
 if jsonb_typeof(p_terms) is distinct from 'array' or jsonb_array_length(p_terms)>200 then raise exception 'INVALID_CATALOG_KEYWORDS';end if;
 for term in select value from jsonb_array_elements(p_terms) loop
  if jsonb_typeof(term)<>'string' then raise exception 'INVALID_CATALOG_KEYWORDS';end if;
  label:=private.catalog_label(term#>>'{}',100);
  if label~E'[\n\r]' then raise exception 'INVALID_CATALOG_KEYWORDS';end if;
  result:=result||jsonb_build_array(jsonb_build_object('raw',term#>>'{}','value',btrim(term#>>'{}'),'comparisonKey',label,'origin','ADMIN'));
 end loop;
 return result;
end$$;
create function private.catalog_keyword_kind(p_entry jsonb) returns text language sql immutable set search_path='' as $$
 select coalesce(p_entry->>'kind',case left(p_entry->>'cell',1) when 'F' then 'INDUSTRY' when 'G' then 'CORE' else 'ADDITIONAL' end)
$$;

create function private.catalog_affected_issues(p_sector_ids uuid[]) returns uuid[] language sql volatile set search_path='' as $$
 select coalesce(array_agg(i.id order by i.id),'{}') from private.issues i
 where i.primary_sector_id=any(p_sector_ids)
 or exists(select 1 from private.impacts z where z.version_id=i.current_version_id and z.sector_id=any(p_sector_ids))
 or exists(select 1 from private.editor_drafts d where d.issue_id=i.id and (
 d.content->>'primary_sector_id'=any(array(select id::text from unnest(p_sector_ids) id))
 or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(d.content->'impacts')='array' then d.content->'impacts' else '[]' end) path_entry
 where path_entry->>'sector_id'=any(array(select id::text from unnest(p_sector_ids) id)))))
$$;
create function private.catalog_impact(p_sector uuid) returns jsonb language plpgsql set search_path='' as $$
declare sector_ids uuid[];issue_ids uuid[];doc jsonb;head bigint;
begin
 head:=private.catalog_require_reference_head(null);
 if not exists(select 1 from private.sectors where id=p_sector and metadata_kind='USER_REFERENCE_UNVERIFIED') then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 select array_agg(id order by id) into sector_ids from private.sectors where metadata_kind='USER_REFERENCE_UNVERIFIED' and (id=p_sector or parent_id=p_sector);
 issue_ids:=private.catalog_affected_issues(sector_ids);
 doc:=jsonb_build_object('catalog_version',head::text,'sector_id',p_sector,
 'sectors',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'active',active) order by id),'[]') from private.sectors where id=any(sector_ids)),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'active',active) order by id),'[]') from private.subgroups where sector_id=any(sector_ids) and metadata_kind='USER_REFERENCE_UNVERIFIED'),
 'memberships',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'active',active) order by id),'[]') from private.catalog_memberships where sector_id=any(sector_ids)),
 'issues',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'revision',i.revision,'state',i.publication_state,'version_id',i.current_version_id,'draft_revision',d.revision,'scheduled_publish_at',i.scheduled_publish_at) order by i.id),'[]') from private.issues i left join private.editor_drafts d on d.issue_id=i.id where i.id=any(issue_ids)));
 return jsonb_build_object('catalog_version',head::text,'impact_sha256',encode(extensions.digest(convert_to(doc::text,'UTF8'),'sha256'),'hex'),
 'sector_count',cardinality(sector_ids),'active_group_count',(select count(*) from private.subgroups where sector_id=any(sector_ids) and active),
 'active_membership_count',(select count(*) from private.catalog_memberships where sector_id=any(sector_ids) and active),
 'issue_count',cardinality(issue_ids),'published_count',(select count(*) from private.issues where id=any(issue_ids) and publication_state='PUBLISHED'),
 'draft_count',(select count(*) from private.editor_drafts where issue_id=any(issue_ids)),
 'scheduled_count',(select count(*) from private.issues where id=any(issue_ids) and scheduled_publish_at is not null),
 'examples',(select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'state',e.publication_state,'title',e.title) order by e.id),'[]') from (select i.id,i.publication_state,coalesce(d.content->>'title',v.title,'') title from private.issues i left join private.editor_drafts d on d.issue_id=i.id left join private.article_versions v on v.id=i.current_version_id where i.id=any(issue_ids) order by i.id limit 20)e));
end$$;
create function public.catalog_editor_impact(p_sector uuid,p_expected bigint) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();perform private.catalog_require_reference_head(p_expected);return private.catalog_impact(p_sector);end$$;
create function public.catalog_editor_sector(p_sector uuid,p_expected bigint default null,p_offset integer default 0,p_limit integer default 50) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;sector_data jsonb;groups jsonb;members jsonb;count_members bigint;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(p_expected);
 if p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_PAGE_SIZE';end if;
 select to_jsonb(s)-'sample_kind'-'catalog_version' into sector_data from private.sectors s where s.id=p_sector and s.metadata_kind='USER_REFERENCE_UNVERIFIED';
 if sector_data is null then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'order',g.display_order,'active',g.active) order by g.display_order,g.id),'[]') into groups from private.subgroups g where g.sector_id=p_sector and g.metadata_kind='USER_REFERENCE_UNVERIFIED';
 select count(*) into count_members from private.catalog_memberships where sector_id=p_sector;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.display_order,page.id),'[]') into members from
 (select m.id,m.subgroup_id,m.source_company_ref,m.role,m.display_order,m.active,c.name,c.active company_active
 from private.catalog_memberships m join private.catalog_source_companies c on c.id=m.source_company_ref where m.sector_id=p_sector order by m.display_order,m.id limit p_limit offset p_offset)page;
 return jsonb_build_object('catalog_version',head::text,'sector',sector_data,'groups',groups,'memberships',members,'total_memberships',count_members,'offset',p_offset,'limit',p_limit,
 'keyword_settings',(select to_jsonb(d)-'source_row' from private.catalog_sector_data d where d.sector_id=p_sector));
end$$;
create function public.catalog_editor_companies(p_offset integer default 0,p_limit integer default 50,p_query text default '') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;items jsonb;total bigint;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(null);
 if p_offset is null or p_offset not between 0 and 100000 or p_limit is null or p_limit not between 1 and 100 or p_query is null or length(p_query)>200 then raise exception 'INVALID_PAGE_SIZE';end if;
 select count(*) into total from private.catalog_source_companies where p_query='' or position(p_query in name)>0;
 select coalesce(jsonb_agg(to_jsonb(page) order by page.name,page.id),'[]') into items from
 (select id,name,active,stock_identity_state from private.catalog_source_companies where p_query='' or position(p_query in name)>0 order by name,id limit p_limit offset p_offset)page;
 return jsonb_build_object('catalog_version',head::text,'items',items,'total',total,'offset',p_offset,'limit',p_limit);
end$$;
create function public.catalog_editor_company(p_company uuid,p_expected bigint default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare head bigint;item jsonb;
begin
 perform private.m1_assert_editor();head:=private.catalog_require_reference_head(p_expected);
 select to_jsonb(c)-'source_row' into item from private.catalog_source_companies c where id=p_company;
 if item is null then raise exception 'CATALOG_ENTITY_NOT_FOUND';end if;
 return jsonb_build_object('catalog_version',head::text,'company',item);
end$$;
grant execute on function public.catalog_editor_impact(uuid,bigint),public.catalog_editor_sector(uuid,bigint,integer,integer),public.catalog_editor_companies(integer,integer,text),public.catalog_editor_company(uuid,bigint) to authenticated;
notify pgrst,'reload schema';
commit;
