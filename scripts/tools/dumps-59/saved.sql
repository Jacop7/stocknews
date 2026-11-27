CREATE OR REPLACE FUNCTION public.catalog_public_saved(p_expected bigint, p_issues uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare head bigint;requested uuid;r jsonb;card jsonb;canonical uuid;items jsonb:='[]';
begin
 head:=private.catalog_require_reference_head(p_expected);
 if p_issues is null or cardinality(p_issues)>20 or array_position(p_issues,null) is not null or cardinality(p_issues)<>(select count(distinct id)from unnest(p_issues)id) then raise exception 'INVALID_SAVED_IDS';end if;
 foreach requested in array p_issues loop
  begin
   r:=public.resolve_issue(requested);canonical:=(r->>'canonical_issue_id')::uuid;card:=null;
   if r->>'state'='PUBLISHED' then
    if not exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=canonical and i.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1') then
     r:=jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
    elsif not private.m1_current_evidence(canonical) then
     r:=jsonb_build_object('state','CORRECTION_PENDING','message','내용 확인 중 · 기존 내용 제공 중지','canonical_issue_id',canonical);
    else
     select jsonb_build_object('issue_id',n.issue_id,'version_id',n.version_id,'title',n.title,'summary',n.summary,'first_published_at',n.first_published_at,'material_change_at',n.material_change_at,'sample_kind',n.sample_kind,
      'article_kind',v.public_body->>'article_kind','sector_id',s.id,'sector_name',s.name,'legacy_sector',coalesce(s.metadata_kind='SYNTHETIC_FIXTURE',false)) into card
     from public.news_public n join private.issues i on i.id=n.issue_id and i.current_version_id=n.version_id join private.article_versions v on v.id=n.version_id
     left join private.sectors s on s.id=i.primary_sector_id and s.active where n.issue_id=canonical and n.publication_state='PUBLISHED' and n.sample_kind='SYNTHETIC';
     if card is null then r:=jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');else r:=jsonb_build_object('state','PUBLISHED','canonical_issue_id',canonical,'card',card);end if;
    end if;
   end if;
  exception when raise_exception then
   if sqlerrm not in ('ALIAS_CYCLE','ALIAS_CHAIN_LIMIT') then raise;end if;
   r:=jsonb_build_object('state','NOT_FOUND','message','현재 제공하지 않는 글');
  end;
  items:=items||jsonb_build_array(r||jsonb_build_object('requested_issue_id',requested));
 end loop;
 return jsonb_build_object('catalog_version',head::text,'items',items);
end$function$

