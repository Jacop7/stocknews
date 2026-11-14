begin;
update private.policies set active=false where active;
insert into private.policies(version,active,api_contract_version) values(2,true,2);
alter function public.m1_save_draft(uuid,bigint,jsonb) rename to m1_save_draft_v1;
alter function public.m1_save_draft_v1(uuid,bigint,jsonb) set schema private;
create function public.m1_save_draft(p_issue uuid,p_expected_revision bigint,p_content jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();perform 1 from private.issues where id=p_issue for update;
return private.m1_save_draft_v1(p_issue,p_expected_revision,p_content);end$$;
alter function public.m1_publish_draft(uuid,bigint,bigint,bigint,bigint,text) rename to m1_publish_draft_v1;
alter function public.m1_publish_draft_v1(uuid,bigint,bigint,bigint,bigint,text) set schema private;
create function public.m1_publish_draft(p_issue uuid,p_expected_revision bigint,p_issue_revision bigint,p_policy bigint,p_catalog bigint,p_effect_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare kind text;
begin perform private.m1_assert_editor();perform 1 from private.issues where id=p_issue for update;
  if not exists(select 1 from private.outbox where effect_key=p_effect_key) then
    select content->>'article_kind' into kind from private.editor_drafts where issue_id=p_issue;
    update private.claims set claim_type=case when kind='MACRO' then 'SYSTEMIC_MACRO' else 'ORDINARY_FACT' end where issue_id=p_issue;
  end if;
  return private.m1_publish_draft_v1(p_issue,p_expected_revision,p_issue_revision,p_policy,p_catalog,p_effect_key);
end$$;
grant execute on function public.m1_save_draft(uuid,bigint,jsonb),public.m1_publish_draft(uuid,bigint,bigint,bigint,bigint,text) to authenticated;
notify pgrst,'reload schema';
commit;
