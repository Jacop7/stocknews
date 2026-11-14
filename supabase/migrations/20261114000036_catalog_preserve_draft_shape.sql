begin;
-- Catalog-first lock ordering supplements the reviewed19 shape guard. It must
-- not bypass that guard by jumping straight to the earlier private save body.
create or replace function public.m1_save_draft(p_issue uuid,p_expected_revision bigint,p_content jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform private.m1_assert_editor();perform private.m1_draft_shape(p_content);
 perform 1 from private.catalog_head where singleton for share;
 perform 1 from private.issues where id=p_issue for update;
 return private.m1_save_draft_v1(p_issue,p_expected_revision,p_content);
end$$;
notify pgrst,'reload schema';
commit;
