CREATE OR REPLACE FUNCTION public.m1_set_state(p_issue uuid, p_expected_revision bigint, p_state text, p_effect_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r jsonb;h text;prior private.outbox;
begin perform private.m1_assert_editor();
  if p_effect_key is null or length(p_effect_key) not between 1 and 200 then raise exception 'EFFECT_KEY_REQUIRED';end if;
  perform 1 from private.issues where id=p_issue for update;
  h:=encode(extensions.digest(convert_to(jsonb_build_object('issue',p_issue,'revision',p_expected_revision,'state',p_state)::text,'UTF8'),'sha256'),'hex');
  select * into prior from private.outbox where effect_key=p_effect_key;
  if found then if prior.issue_id is distinct from p_issue or prior.payload->>'editor_request_hash' is distinct from h then raise exception 'EFFECT_PAYLOAD_CONFLICT';end if;return jsonb_build_object('status','ALREADY_APPLIED');end if;
  r:=public.m0_set_publication_state(p_issue,p_expected_revision,p_state);
  insert into private.outbox(issue_id,event_type,effect_key,payload) values(p_issue,'ISSUE_'||p_state,p_effect_key,jsonb_build_object('issue_id',p_issue,'sample_kind','SYNTHETIC','editor_request_hash',h));
  insert into private.audits(actor_id,action,entity_id) values(auth.uid()::text,'MANUAL_'||p_state,p_issue::text);return r;
end$function$

