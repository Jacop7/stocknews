begin;
create function private.catalog_request_hash(p_expected bigint,p_kind text,p_entity uuid,p_payload jsonb) returns text language sql immutable set search_path='' as $$
 select encode(extensions.digest(convert_to(jsonb_build_object('expected_version',p_expected,'kind',p_kind,'entity_id',p_entity,'payload',p_payload)::text,'UTF8'),'sha256'),'hex')
$$;
create function public.catalog_apply(p_expected bigint,p_operation_key text,p_kind text,p_entity uuid,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid;head bigint;request_hash text;existing private.catalog_operations;before_doc jsonb;delta jsonb;entity uuid;next_version bigint;result jsonb;error_code text;
begin
 perform private.m1_assert_editor();actor:=auth.uid();
 -- Malformed framing/auth failures are not a durable not-applied receipt.
 if p_operation_key is null or p_operation_key!~'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' or p_expected is null or p_expected<1 or p_kind is null or length(p_kind)>60 or p_payload is null or pg_column_size(p_payload)>131072 then raise exception 'INVALID_CATALOG_REQUEST';end if;
 request_hash:=private.catalog_request_hash(p_expected,p_kind,p_entity,p_payload);
 select version into head from private.catalog_head where singleton for update;
 perform private.m1_assert_editor();
 select * into existing from private.catalog_operations where operation_key=p_operation_key;
 if found then
  if existing.actor_id<>actor or existing.payload_sha256<>request_hash then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
  return existing.result;
 end if;
 begin
  perform private.catalog_require_reference_head(p_expected);
  before_doc:=private.catalog_document();
  if p_kind=any(array['SECTOR_CREATE','SECTOR_UPDATE','SECTOR_DEACTIVATE','SECTOR_RESTORE']) then entity:=private.catalog_edit_sector(p_kind,p_entity,p_payload,head);
  elsif p_kind=any(array['GROUP_CREATE','GROUP_UPDATE','GROUP_DEACTIVATE','GROUP_RESTORE']) then entity:=private.catalog_edit_group(p_kind,p_entity,p_payload);
  elsif p_kind=any(array['COMPANY_CREATE','COMPANY_UPDATE','COMPANY_DEACTIVATE','COMPANY_RESTORE']) then entity:=private.catalog_edit_company(p_kind,p_entity,p_payload);
  elsif p_kind=any(array['MEMBERSHIP_CREATE','MEMBERSHIP_UPDATE','MEMBERSHIP_DEACTIVATE','MEMBERSHIP_RESTORE']) then entity:=private.catalog_edit_membership(p_kind,p_entity,p_payload);
  elsif p_kind='SECTOR_KEYWORDS' then entity:=private.catalog_edit_keywords(p_entity,p_payload);
  elsif p_kind='REORDER' then
   if p_entity is not null then raise exception 'SERVER_ENTITY_ID_REQUIRED';end if;
   perform private.catalog_reorder(p_payload);
  else raise exception 'CATALOG_OPERATION_NOT_ALLOWED';end if;
  delta:=private.catalog_diff(before_doc,private.catalog_document());
  if delta='{}' then raise exception 'CATALOG_NO_CHANGE';end if;
  next_version:=private.catalog_finish_version(head);
  result:=jsonb_build_object('status','APPLIED','operation_key',p_operation_key,'request_sha256',request_hash,'actor_id',actor,'entity_id',entity,'catalog_version',next_version::text);
  insert into private.audits(actor_id,action,entity_id,details) values(actor::text,'CATALOG_'||p_kind,coalesce(entity::text,next_version::text),jsonb_build_object('operation_key',p_operation_key,'request_sha256',request_hash,'previous_version',head::text,'catalog_version',next_version::text,'diff',delta));
  insert into private.outbox(event_type,effect_key,payload) values('CATALOG_CHANGED','catalog:operation:'||p_operation_key,jsonb_build_object('catalog_version',next_version::text,'operation_key',p_operation_key,'metadata_kind','USER_REFERENCE_UNVERIFIED','catalog_request_hash',request_hash));
 exception
  when raise_exception then
   error_code:=sqlerrm;
   if not error_code=any(array['STALE_CATALOG','CATALOG_ENTITY_LIMIT','INVALID_CATALOG_PAYLOAD','CATALOG_FIELD_NOT_ALLOWED','CATALOG_FIELD_REQUIRED','SERVER_ENTITY_ID_REQUIRED','INVALID_CATALOG_KIND','INVALID_CATALOG_PARENT','CATALOG_NAME_COLLISION','CATALOG_ENTITY_NOT_FOUND','CATALOG_ENTITY_INACTIVE','CATALOG_IMPACT_CHANGED','INVALID_CATALOG_STATE','CATALOG_OPERATION_NOT_ALLOWED','INACTIVE_CATALOG_PARENT','INACTIVE_CATALOG_SECTOR','INVALID_CATALOG_TEXT','INVALID_CATALOG_ORDER','INVALID_CATALOG_KEYWORDS','CATALOG_COMPANY_INACTIVE','INVALID_CATALOG_GROUP','CATALOG_MEMBERSHIP_EXISTS','INVALID_CATALOG_KEYWORD_KIND','INCOMPLETE_CATALOG_ORDER','CATALOG_NO_CHANGE']) then raise;end if;
   result:=jsonb_build_object('status','REJECTED','operation_key',p_operation_key,'request_sha256',request_hash,'actor_id',actor,'catalog_version',head::text,'error',error_code,'not_applied',true);
  when invalid_text_representation or numeric_value_out_of_range or not_null_violation or check_violation or unique_violation or foreign_key_violation then
   result:=jsonb_build_object('status','REJECTED','operation_key',p_operation_key,'request_sha256',request_hash,'actor_id',actor,'catalog_version',head::text,'error','CATALOG_VALUE_REJECTED','not_applied',true);
 end;
 -- A REJECTED journal is committed outside the mutation subtransaction. A
 -- delayed retry can never apply an intent that was definitively rejected.
 insert into private.catalog_operations(operation_key,actor_id,payload_sha256,version,result) values(p_operation_key,actor,request_hash,case when result->>'status'='APPLIED' then next_version else head end,result);
 return result;
end$$;
create function public.catalog_operation_status(p_expected bigint,p_operation_key text,p_kind text,p_entity uuid,p_payload jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare existing private.catalog_operations;request_hash text;
begin
 perform private.m1_assert_editor();
 if p_operation_key is null or length(p_operation_key)>200 or p_payload is null or pg_column_size(p_payload)>131072 then raise exception 'INVALID_CATALOG_REQUEST';end if;
 request_hash:=private.catalog_request_hash(p_expected,p_kind,p_entity,p_payload);
 select * into existing from private.catalog_operations where operation_key=p_operation_key;
 if not found then return jsonb_build_object('status','UNKNOWN','operation_key',p_operation_key,'request_sha256',request_hash,'actor_id',auth.uid());end if;
 if existing.actor_id<>auth.uid() or existing.payload_sha256<>request_hash then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;
 return existing.result;
end$$;
grant execute on function public.catalog_apply(bigint,text,text,uuid,jsonb),public.catalog_operation_status(bigint,text,text,uuid,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
