CREATE OR REPLACE FUNCTION public.is_news_visible(p_issue uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=p_issue and i.publication_state='PUBLISHED'
   and i.sample_kind='SYNTHETIC'
   and (v.public_body->>'_contract' is distinct from 'M1' or private.m1_current_evidence(i.id)))
$function$

