begin;
-- Drafts may be incomplete, but must stay renderable. Publication still performs
-- the stronger evidence, market, sector, scenario and schedule validation.
create function private.m1_draft_shape(p_content jsonb) returns void language plpgsql immutable set search_path='' as $$
declare k text;x jsonb;y jsonb;
begin
 if p_content is null or jsonb_typeof(p_content)<>'object' or pg_column_size(p_content)>131072 then raise exception 'DRAFT_SHAPE_INVALID';end if;
 foreach k in array array['title','summary','article_kind','source_market','selection_market_basis','analysis_perspective','issue_analysis'] loop
   if jsonb_typeof(p_content->k) is distinct from 'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;
 end loop;
 if not p_content ? 'primary_sector_id' or jsonb_typeof(p_content->'primary_sector_id') not in ('string','null') then raise exception 'DRAFT_SHAPE_INVALID';end if;
 foreach k in array array['key_issues','risks','sources','impacts','scenarios','schedule'] loop
   if jsonb_typeof(p_content->k) is distinct from 'array' then raise exception 'DRAFT_SHAPE_INVALID';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_content->'key_issues') union all select value from jsonb_array_elements(p_content->'risks') loop
   if jsonb_typeof(x)<>'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_content->'sources') loop
   if jsonb_typeof(x->'name') is distinct from 'string' or jsonb_typeof(x->'url') is distinct from 'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;
 end loop;
 for x in select value from jsonb_array_elements(p_content->'impacts') loop
   foreach k in array array['sector_id','path_id','direction','conditional_direction','description'] loop if jsonb_typeof(x->k) is distinct from 'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;end loop;
   foreach k in array array['conditions','evidence_ids'] loop
     if jsonb_typeof(x->k) is distinct from 'array' then raise exception 'DRAFT_SHAPE_INVALID';end if;
     for y in select value from jsonb_array_elements(x->k) loop if jsonb_typeof(y)<>'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;end loop;
   end loop;
 end loop;
 for x in select value from jsonb_array_elements(p_content->'scenarios') loop
   foreach k in array array['direction','title','expected_result'] loop if jsonb_typeof(x->k) is distinct from 'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;end loop;
   foreach k in array array['checks','path_ids'] loop
     if jsonb_typeof(x->k) is distinct from 'array' then raise exception 'DRAFT_SHAPE_INVALID';end if;
     for y in select value from jsonb_array_elements(x->k) loop if jsonb_typeof(y)<>'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;end loop;
   end loop;
 end loop;
 for x in select value from jsonb_array_elements(p_content->'schedule') loop
   foreach k in array array['kind','status','title','timezone','evidence_as_of'] loop if jsonb_typeof(x->k) is distinct from 'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;end loop;
   if x->>'kind'='EXACT' then
     if jsonb_typeof(x->'event_at') is distinct from 'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;
   elsif x->>'kind'='PERIOD' then
     foreach k in array array['period_label','period_start','period_end','precision'] loop if jsonb_typeof(x->k) is distinct from 'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;end loop;
   else raise exception 'DRAFT_SHAPE_INVALID';end if;
   if jsonb_typeof(x->'evidence_ids') is distinct from 'array' then raise exception 'DRAFT_SHAPE_INVALID';end if;
   for y in select value from jsonb_array_elements(x->'evidence_ids') loop if jsonb_typeof(y)<>'string' then raise exception 'DRAFT_SHAPE_INVALID';end if;end loop;
 end loop;
end$$;
create or replace function public.m1_save_draft(p_issue uuid,p_expected_revision bigint,p_content jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.m1_assert_editor();perform private.m1_draft_shape(p_content);
 perform 1 from private.issues where id=p_issue for update;
 return private.m1_save_draft_v1(p_issue,p_expected_revision,p_content);
end$$;
notify pgrst,'reload schema';
commit;
