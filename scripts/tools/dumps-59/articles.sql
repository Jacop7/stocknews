CREATE OR REPLACE FUNCTION public.m1_public_articles(p_sector uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_cursor timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_PAGE_SIZE';end if;
  return coalesce((select jsonb_agg(row_to_json(t)) from(
    select n.issue_id,n.version_id,n.title,n.summary,n.first_published_at,n.material_change_at,n.sample_kind,v.public_body->>'article_kind' article_kind,s.name sector_name
    from public.news_public n join private.issues i on i.id=n.issue_id join private.article_versions v on v.id=n.version_id
    left join private.sectors s on s.id=i.primary_sector_id and s.active
    where n.publication_state='PUBLISHED' and private.m1_current_evidence(n.issue_id)
      and (p_sector is null or exists(select 1 from private.impacts z where z.version_id=v.id and z.sector_id=p_sector))
      and (p_cursor is null or n.first_published_at<p_cursor)
    order by n.first_published_at desc,n.issue_id limit p_limit
  )t),'[]');
end$function$

