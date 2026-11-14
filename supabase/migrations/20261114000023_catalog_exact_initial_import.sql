begin;
-- Private local bootstrap only. This never turns 6A's preview into an importable artifact.
create function private.catalog_seed_reference(p_source_text text,p_registry_text text,p_preview_text text) returns jsonb language plpgsql set search_path='' as $$
declare src text;reg text;pre text;s jsonb;r jsonb;p jsonb;x jsonb;g jsonb;m jsonb;c jsonb;v bigint;position integer;old private.catalog_raw_imports;
begin
 perform private.assert_initialized();
 if current_user<>'postgres' or not exists(select 1 from private.runtime_identity where product_id='judoju-news' and environment='local' and bootstrap_id is not null) then raise exception 'LOCAL_POSTGRES_BOOTSTRAP_ONLY';end if;
 src:=encode(extensions.digest(convert_to(p_source_text,'UTF8'),'sha256'),'hex');
 reg:=encode(extensions.digest(convert_to(p_registry_text,'UTF8'),'sha256'),'hex');
 pre:=encode(extensions.digest(convert_to(p_preview_text,'UTF8'),'sha256'),'hex');
 if src<>'5c86278ab12d16979a1f5fd7a100e15368db2450f1ebcf47e70aced66d84a5d2'
 or reg<>'160a969756bfd291c81dda390a3490f46ac60bc12eed262e1818e5ba40a03dc6'
 or pre<>'10151662655abf5fd5ba1c09c30e8b91b07ab1549afbb4257c978544d92edb0d' then raise exception 'UNREVIEWED_CATALOG_INPUT';end if;
 select version into v from private.catalog_head where singleton for update;
 select * into old from private.catalog_raw_imports where source_sha256=src;
 if found then
  if old.registry_sha256<>reg or old.preview_sha256<>pre then raise exception 'CATALOG_IMPORT_CONFLICT';end if;
  return jsonb_build_object('status','ALREADY_APPLIED','initial_version',old.initial_version,'current_version',v);
 end if;
 if not exists(select 1 from private.catalog_snapshots where version=v and usage_scope='LEGACY_FIXTURE') then raise exception 'INITIAL_IMPORT_ALREADY_COMPLETED';end if;
 s:=p_source_text::jsonb;r:=p_registry_text::jsonb;p:=p_preview_text::jsonb;
 if p->>'mode' is distinct from 'OFFLINE_PREVIEW_ONLY' or p->'importable' is distinct from 'false'::jsonb
 or p->>'sourceSha256' is distinct from src or p->'rawSource' is distinct from s
 or jsonb_array_length(p->'categories')<>56 or jsonb_array_length(p->'companies')<>339
 or jsonb_array_length(r->'parents')<>11 or jsonb_array_length(r->'subgroups')<>81
 or jsonb_array_length(p->'unresolved')<>341 or jsonb_array_length(p->'differences')<>0
 or (p->'summary'->>'structuralHoldCount')::integer<>2 then raise exception 'CATALOG_PREVIEW_REQUIRES_REVIEW';end if;
 if exists(select 1 from jsonb_array_elements(p->'categories') x cross join lateral jsonb_array_elements(x->'subgroups') g
 where g->>'state' is distinct from 'PARSED_SOURCE' or g->>'id' is null)
 or exists(select 1 from jsonb_array_elements(p->'categories') x cross join lateral jsonb_array_elements(x->'memberships') m
 where m->>'state' is distinct from 'PARSED_SOURCE' or m->'exactMembershipDuplicate' is distinct from 'false'::jsonb)
 or exists(select 1 from jsonb_array_elements(p->'companies') c where c->'stockIdentity'->>'state' is distinct from 'UNRESOLVED'
 or c->'stockIdentity'->'code' is distinct from 'null'::jsonb or c->'price' is distinct from 'null'::jsonb or c->'stockUrl' is distinct from 'null'::jsonb)
 then raise exception 'CATALOG_PREVIEW_REQUIRES_REVIEW';end if;
 if exists(select 1 from jsonb_array_elements((r->'parents')||(r->'categories')) x join private.sectors z on z.id=(x->>'id')::uuid)
 or exists(select 1 from jsonb_array_elements(r->'subgroups') x join private.subgroups z on z.id=(x->>'id')::uuid)
 or exists(select 1 from jsonb_array_elements(r->'companies') x join private.catalog_source_companies z on z.id=(x->>'id')::uuid)
 then raise exception 'DO_NOT_ADOPT_EXISTING_CATALOG_ID';end if;
 select coalesce(max(version),0)+1 into v from private.catalog_versions;
 update private.catalog_versions set active=false where active;
 insert into private.catalog_versions(version,active) values(v,true);
 position:=0;
 for x in select value from jsonb_array_elements(r->'parents') loop
  insert into private.sectors(id,name,description,parent_id,display_order,catalog_version,sample_kind,metadata_kind,catalog_kind)
  values((x->>'id')::uuid,x->>'name','',null,position,v,null,'USER_REFERENCE_UNVERIFIED','PARENT');position:=position+1;
 end loop;
 position:=0;
 for x in select value from jsonb_array_elements(p->'categories') loop
  insert into private.sectors(id,name,description,parent_id,display_order,catalog_version,sample_kind,metadata_kind,catalog_kind)
  values((x->>'id')::uuid,x->>'name',coalesce(x->>'detailDescription',''),(x->>'parentId')::uuid,(x->>'sourceRow')::integer-2,v,null,'USER_REFERENCE_UNVERIFIED','LEAF');
  insert into private.catalog_sector_data(sector_id,search_mapping,search_suffix_instruction,keywords,foreign_companies,source_cell,source_row)
  values((x->>'id')::uuid,x->>'categorySearchMapping',x->>'categorySearchSuffixInstruction',x->'keywords',x->'foreignCompanies',x->>'sourceCell',x->'rawRow');
  position:=0;
  for g in select value from jsonb_array_elements(x->'subgroups') loop
   insert into private.subgroups(id,sector_id,name,display_order,metadata_kind)
   values((g->>'id')::uuid,(x->>'id')::uuid,g->>'title',position,'USER_REFERENCE_UNVERIFIED');position:=position+1;
  end loop;
 end loop;
 for c in select value from jsonb_array_elements(p->'companies') loop
  insert into private.catalog_source_companies(id,name,search_description,direct_keywords,industry_keywords,source_cell,source_row)
  values((c->>'sourceCompanyRef')::uuid,c->>'name',coalesce(c->>'searchDescription',''),c->'directSearchKeywords'->'entries',c->'industrySearchKeywords'->'entries',c->>'sourceCell',c->'rawRow');
 end loop;
 for x in select value from jsonb_array_elements(p->'categories') loop
  position:=0;
  for m in select value from jsonb_array_elements(x->'memberships') loop
   insert into private.catalog_memberships(sector_id,subgroup_id,source_company_ref,role,display_order)
   values((x->>'id')::uuid,(m->>'subgroupId')::uuid,(m->>'sourceCompanyRef')::uuid,m->>'role',position);position:=position+1;
  end loop;
 end loop;
 insert into private.catalog_raw_imports(source_sha256,registry_sha256,preview_sha256,source_text,registry_text,preview_text,initial_version)
 values(src,reg,pre,p_source_text,p_registry_text,p_preview_text,v);
 for x in select value from jsonb_array_elements(p->'unresolved') loop
  insert into private.catalog_holds(source_sha256,code,source_cell,details) values(src,x->>'code',x->>'cell',x);
 end loop;
 update private.catalog_head set version=v where singleton;
 perform private.catalog_save_snapshot(v);
 insert into private.audits(actor_id,action,entity_id,details) values('local-reviewed-bootstrap','CATALOG_REFERENCE_SEED',v::text,jsonb_build_object('source_sha256',src,'company_records',339,'structural_holds',2,'stock_identity_holds',339));
 insert into private.outbox(event_type,effect_key,payload) values('CATALOG_CHANGED','catalog:seed:'||src,jsonb_build_object('catalog_version',v,'metadata_kind','USER_REFERENCE_UNVERIFIED','catalog_request_hash',pre));
 return jsonb_build_object('status','APPLIED','version',v,'categories',56,'company_records',339,'subgroups',81,'memberships',364,'holds',341,'real_publication_enabled',false);
end$$;
commit;
