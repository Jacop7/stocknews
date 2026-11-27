CREATE OR REPLACE FUNCTION private.m1_current_evidence_v3(p_issue uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from private.issues i join private.article_versions v on v.id=i.current_version_id
 where i.id=p_issue and i.publication_state='PUBLISHED' and i.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1'
 and exists(select 1 from private.policies p where p.version=v.visibility_policy_version and p.active)
 and exists(select 1 from private.catalog_approvals a where a.version=v.catalog_version and a.state='APPROVED')
 and exists(select 1 from private.impacts z where z.version_id=v.id)
 and not exists(select 1 from private.claims c where c.issue_id=i.id and (not c.verified or not c.fact_current or not c.korea_path_verified or c.claim_type='SENSITIVE_UNCONFIRMED' or c.valid_until<=now()))
 and (i.primary_sector_id is null or private.catalog_version_sector_allowed(v.catalog_version,i.primary_sector_id))
 and not exists(select 1 from private.impacts z where z.version_id=v.id and not private.catalog_version_sector_allowed(v.catalog_version,z.sector_id))
 and not exists(select 1 from private.impacts z where z.version_id=v.id and cardinality(z.evidence_ids)=0)
 and not exists(select 1 from private.impacts z cross join lateral unnest(z.evidence_ids) e(id)
 left join private.claims c on c.id=e.id and c.issue_id=i.id
 where z.version_id=v.id and (c.id is null or not c.verified or not c.fact_current or not c.korea_path_verified or c.valid_until<=now()))
 and private.m1_core_evidence(i.id,v.public_body->>'article_kind'))
$function$

