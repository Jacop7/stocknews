CREATE OR REPLACE FUNCTION private.m1_current_evidence(p_issue uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select exists(select 1 from private.issues where id=p_issue and sample_kind='SYNTHETIC') and private.m1_current_evidence_v3(p_issue)
$function$

