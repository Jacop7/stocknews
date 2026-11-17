-- HOME_DB_BOUND_V1: install only in MAIN's NEW independent test cluster. Not a root migration.
-- No existing Auth, collector, catalog or M1 objects are read or imported.
-- Historical qualificationCheckedAt is not physical COMMIT-time qualification.
CREATE ROLE home_v1_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE home_v1_fixture_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE home_v1_capture_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE home_v1_commit_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE home_v1_internal_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE SCHEMA home_bound_v1 AUTHORIZATION home_v1_owner;
REVOKE ALL ON SCHEMA home_bound_v1 FROM PUBLIC;

-- MAIN bootstrap, after hashing/installing this exact file:
-- INSERT resource_control(singleton,resource_id,run_id,identity) VALUES(true,...,...,<exact RESOURCE DTO>);
-- CREATE each h4_<runhex>_{fixture,capture,commit,read} LOGIN INHERIT NOSUPERUSER
--   NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
-- GRANT its ONE matching home_v1_* role WITH INHERIT TRUE, SET FALSE, ADMIN FALSE;
-- INSERT principals(principal_oid,principal_name,resource_id,run_id,component_role)
--   SELECT oid,rolname,<resource uuid>,<run uuid>,<matching component role> FROM pg_roles WHERE rolname=...;
-- Application roles receive no bootstrap INSERT, direct SELECT/DML, owner or role administration grant.
CREATE TABLE home_bound_v1.resource_control (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 resource_id uuid NOT NULL UNIQUE, run_id uuid NOT NULL UNIQUE, identity jsonb NOT NULL,
 CHECK(identity->>'schema'='HOME_DB_BOUND_V1_RESOURCE'),
 CHECK(identity->>'resourceId'=resource_id::text AND identity->>'runId'=run_id::text)
);
CREATE TABLE home_bound_v1.principals (
 principal_oid oid PRIMARY KEY, principal_name name NOT NULL UNIQUE,
 resource_id uuid NOT NULL REFERENCES home_bound_v1.resource_control(resource_id),run_id uuid NOT NULL,
 component_role name NOT NULL CHECK(component_role IN ('home_v1_fixture_writer','home_v1_capture_worker','home_v1_commit_worker','home_v1_internal_reader')),
 UNIQUE(resource_id,run_id,component_role)
);
CREATE TABLE home_bound_v1.namespaces (
 namespace_id uuid PRIMARY KEY, backend_generation uuid NOT NULL DEFAULT gen_random_uuid(),
 input_revision bigint NOT NULL DEFAULT 0 CHECK(input_revision>=0),gate_key bigint NOT NULL UNIQUE,
 coverage_start timestamptz NOT NULL DEFAULT clock_timestamp(),known_through timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE home_bound_v1.profiles (
 namespace_id uuid NOT NULL REFERENCES home_bound_v1.namespaces,profile_manifest_id uuid NOT NULL,
 manifest jsonb NOT NULL,manifest_digest text NOT NULL,signals_mode text NOT NULL DEFAULT 'OFF_ALL' CHECK(signals_mode='OFF_ALL'),
 PRIMARY KEY(namespace_id,profile_manifest_id)
);
CREATE TABLE home_bound_v1.observations (
 namespace_id uuid NOT NULL REFERENCES home_bound_v1.namespaces,kind text NOT NULL CHECK(kind IN ('ISSUE','CLAIM','SOURCE','CALENDAR','ASSESSMENT','GRANT')),
 entity_id text NOT NULL,revision bigint NOT NULL CHECK(revision>0),content_id text NOT NULL,
 known_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),content_digest text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(namespace_id,kind,entity_id,revision),UNIQUE(namespace_id,content_id)
);
CREATE INDEX observations_current ON home_bound_v1.observations(namespace_id,kind,entity_id,revision DESC);
CREATE TABLE home_bound_v1.issue_identities (
 namespace_id uuid NOT NULL REFERENCES home_bound_v1.namespaces,issue_id text NOT NULL,canonical_story_id text NOT NULL,first_published_at timestamptz,
 PRIMARY KEY(namespace_id,issue_id)
);
CREATE TABLE home_bound_v1.publication_bindings (
 namespace_id uuid NOT NULL REFERENCES home_bound_v1.namespaces,article_version_id uuid NOT NULL,publication_effect_key uuid NOT NULL,
 issue_id text NOT NULL,editor_draft_revision bigint NOT NULL CHECK(editor_draft_revision>=0),issue_revision_before bigint NOT NULL CHECK(issue_revision_before>=0),issue_revision_after bigint NOT NULL,
 request_digest text NOT NULL,content_digest text NOT NULL,evidence_version text NOT NULL,assessment_version text NOT NULL,
 first_published_at timestamptz NOT NULL,material_change_at timestamptz NOT NULL,graph jsonb NOT NULL,binding jsonb NOT NULL,claim_projection jsonb NOT NULL,
 PRIMARY KEY(namespace_id,article_version_id),UNIQUE(namespace_id,publication_effect_key),
 FOREIGN KEY(namespace_id,issue_id) REFERENCES home_bound_v1.issue_identities,
 CHECK(issue_revision_after=issue_revision_before+1 AND material_change_at>=first_published_at)
 -- Deliberately NO UNIQUE(issue_id,editor_draft_revision): M1 numeric drafts are not Article UUIDs.
);
CREATE TABLE home_bound_v1.rounds (
 namespace_id uuid NOT NULL REFERENCES home_bound_v1.namespaces,round_id uuid NOT NULL,stream_id text NOT NULL,ranking_cutoff timestamptz NOT NULL,
 slot_generation bigint NOT NULL CHECK(slot_generation>0),supersedes_round_id uuid,
 expected_head jsonb NOT NULL,profile_manifest_id uuid NOT NULL,segment_key text NOT NULL,producer_revision bigint NOT NULL,
 snapshot_canonical text NOT NULL,input_digest text NOT NULL,planned_global_revision bigint NOT NULL,planned_local_revision bigint NOT NULL,
 state text NOT NULL DEFAULT 'CAPTURED' CHECK(state IN ('CAPTURED','COMPLETED','SUPERSEDED')),
 result_canonical text,result_digest text,qualification_checked_at timestamptz,
 PRIMARY KEY(namespace_id,round_id),UNIQUE(namespace_id,stream_id,ranking_cutoff,slot_generation),
 FOREIGN KEY(namespace_id,profile_manifest_id) REFERENCES home_bound_v1.profiles,
 CHECK((state='COMPLETED')=(result_canonical IS NOT NULL AND result_digest IS NOT NULL AND qualification_checked_at IS NOT NULL))
);
CREATE UNIQUE INDEX rounds_active_slot ON home_bound_v1.rounds(namespace_id,stream_id,ranking_cutoff) WHERE state IN ('CAPTURED','COMPLETED');
CREATE TABLE home_bound_v1.entries (
 namespace_id uuid NOT NULL,round_id uuid NOT NULL,issue_id text NOT NULL,story_id text NOT NULL,lane text NOT NULL CHECK(lane IN ('A','B','C')),ordinal integer NOT NULL,
 article_version_id uuid NOT NULL,assessment_version text NOT NULL,evidence_version text NOT NULL,graph jsonb NOT NULL,score numeric NOT NULL CHECK(score>=0 AND score<=100),tier text NOT NULL CHECK(tier IN ('HIGH','MEDIUM','STANDARD')),
 PRIMARY KEY(namespace_id,round_id,issue_id),UNIQUE(namespace_id,round_id,story_id),UNIQUE(namespace_id,round_id,lane,ordinal),
 FOREIGN KEY(namespace_id,round_id) REFERENCES home_bound_v1.rounds,FOREIGN KEY(namespace_id,article_version_id) REFERENCES home_bound_v1.publication_bindings,
 CHECK(ordinal>=1 AND ordinal<=CASE lane WHEN 'A' THEN 2 WHEN 'B' THEN 3 ELSE 20 END)
);
CREATE TABLE home_bound_v1.heads (
 namespace_id uuid NOT NULL REFERENCES home_bound_v1.namespaces,stream_id text NOT NULL,active_profile_manifest_id uuid NOT NULL,
 global_revision bigint NOT NULL DEFAULT 0 CHECK(global_revision>=0),round_id uuid,digest text,ranking_cutoff timestamptz,
 PRIMARY KEY(namespace_id,stream_id),FOREIGN KEY(namespace_id,active_profile_manifest_id) REFERENCES home_bound_v1.profiles,
 CHECK((global_revision=0 AND round_id IS NULL AND digest IS NULL AND ranking_cutoff IS NULL) OR (global_revision>0 AND round_id IS NOT NULL AND digest IS NOT NULL AND ranking_cutoff IS NOT NULL))
);
CREATE TABLE home_bound_v1.segment_heads (
 namespace_id uuid NOT NULL,stream_id text NOT NULL,segment_key text NOT NULL,local_revision bigint NOT NULL CHECK(local_revision>0),round_id uuid NOT NULL,
 PRIMARY KEY(namespace_id,stream_id,segment_key),FOREIGN KEY(namespace_id,stream_id) REFERENCES home_bound_v1.heads
);
CREATE TABLE home_bound_v1.effects (
 namespace_id uuid NOT NULL REFERENCES home_bound_v1.namespaces,operation text NOT NULL,effect_key uuid NOT NULL,backend_generation uuid NOT NULL,
 request_digest text NOT NULL,receipt jsonb NOT NULL,checked_at timestamptz NOT NULL,qualification_checked_at timestamptz,
 principal_oid oid NOT NULL,principal_name name NOT NULL,
 PRIMARY KEY(namespace_id,operation,effect_key)
);

CREATE FUNCTION home_bound_v1._fail(p_code text,p_state text DEFAULT 'P0001') RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ BEGIN RAISE EXCEPTION USING ERRCODE=p_state,MESSAGE=p_code; END $$;
CREATE FUNCTION home_bound_v1._stamp(p_at timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT pg_catalog.to_char(p_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') $$;
CREATE FUNCTION home_bound_v1._ms(p_at timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT pg_catalog.to_char(p_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') $$;
CREATE FUNCTION home_bound_v1._hash(p_text text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_text,'UTF8')),'hex') $$;
CREATE FUNCTION home_bound_v1._time(p_text text) RETURNS timestamptz LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF p_text IS NULL OR p_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(\d{3})?Z$' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023'); END IF;
 RETURN p_text::timestamptz;
END $$;
CREATE FUNCTION home_bound_v1._uuid(p_text text) RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF p_text IS NULL OR p_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023'); END IF; RETURN p_text::uuid;
END $$;
CREATE FUNCTION home_bound_v1._decimal(p_text text) RETURNS bigint LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF p_text IS NULL OR p_text !~ '^(0|[1-9][0-9]{0,18})$' OR p_text::numeric>9223372036854775807 THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023'); END IF; RETURN p_text::bigint;
END $$;
CREATE FUNCTION home_bound_v1._id(p_text text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF p_text IS NULL OR p_text !~ '^[A-Za-z0-9_.:-]{1,160}$' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023'); END IF; RETURN p_text;
END $$;
CREATE FUNCTION home_bound_v1._exact(p_value jsonb,p_keys text[]) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'object' OR (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(p_value))<>pg_catalog.cardinality(p_keys) OR NOT p_value ?& p_keys THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023'); END IF;
END $$;
CREATE FUNCTION home_bound_v1._strings(p_value jsonb,p_keys text[],p_nullable text[] DEFAULT ARRAY[]::text[]) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE k text;BEGIN
 FOREACH k IN ARRAY p_keys LOOP IF NOT(k=ANY(p_nullable) AND p_value->k='null'::jsonb) AND pg_catalog.jsonb_typeof(p_value->k) IS DISTINCT FROM 'string' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;END LOOP;
END $$;
CREATE FUNCTION home_bound_v1._request_types(p_value jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE k text;BEGIN
 FOREACH k IN ARRAY ARRAY['resourceId','namespaceId','effectKey','roundId','streamId','rankingCutoff','backendGeneration','producerRevision','inputDigest','resultCanonical','operation','requestDigest','slotGeneration','reason','action','initialStreamId','expectedInputRevision','profileManifestId'] LOOP
  IF p_value ? k THEN PERFORM home_bound_v1._strings(p_value,ARRAY[k]);END IF;
 END LOOP;
 IF p_value ? 'supersedesRoundId' THEN PERFORM home_bound_v1._strings(p_value,ARRAY['supersedesRoundId'],ARRAY['supersedesRoundId']);END IF;
 IF p_value ? 'expectedHead' THEN PERFORM home_bound_v1._exact(p_value->'expectedHead',ARRAY['revision','roundId','digest']);PERFORM home_bound_v1._strings(p_value->'expectedHead',ARRAY['revision','roundId','digest'],ARRAY['roundId','digest']);END IF;
END $$;
CREATE FUNCTION home_bound_v1._ids(p_value jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE x jsonb; BEGIN
 IF pg_catalog.jsonb_typeof(p_value) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(p_value)>300 THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023'); END IF;
 IF (SELECT pg_catalog.count(*)<>pg_catalog.count(DISTINCT value) FROM pg_catalog.jsonb_array_elements(p_value)) THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023'); END IF;
 FOR x IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) LOOP IF pg_catalog.jsonb_typeof(x)<>'string' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023'); END IF;PERFORM home_bound_v1._id(x#>>'{}');END LOOP;
END $$;
CREATE FUNCTION home_bound_v1._utf16len(p_text text) RETURNS bigint LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT COALESCE(pg_catalog.sum(CASE WHEN pg_catalog.ascii(pg_catalog.substr(p_text,i,1))>65535 THEN 2 ELSE 1 END),0)::bigint FROM pg_catalog.generate_series(1,pg_catalog.char_length(p_text)) i
$$;
CREATE FUNCTION home_bound_v1._budget(p_value jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE bad boolean; BEGIN
 IF NOT(p_value ? 'schema') THEN PERFORM home_bound_v1._request_types(p_value);END IF;
 IF p_value IS NULL OR pg_catalog.octet_length(p_value::text)>262144 OR home_bound_v1._utf16len(p_value::text)>262144 THEN PERFORM home_bound_v1._fail('JSON_BUDGET','22023');END IF;
 WITH RECURSIVE w(v,d) AS (
  SELECT p_value,0 UNION ALL
  SELECT c.v,w.d+1 FROM w CROSS JOIN LATERAL (
   SELECT value v FROM pg_catalog.jsonb_each(CASE WHEN pg_catalog.jsonb_typeof(w.v)='object' THEN w.v ELSE '{}'::jsonb END)
   UNION ALL SELECT value FROM pg_catalog.jsonb_array_elements(CASE WHEN pg_catalog.jsonb_typeof(w.v)='array' THEN w.v ELSE '[]'::jsonb END)
  ) c WHERE w.d<=12
 ) SELECT pg_catalog.count(*)>10000 OR COALESCE(pg_catalog.bool_or(d>12 OR CASE pg_catalog.jsonb_typeof(v) WHEN 'array' THEN pg_catalog.jsonb_array_length(v)>1000 WHEN 'string' THEN home_bound_v1._utf16len(v#>>'{}')>65536 ELSE false END),false) INTO bad FROM w;
 IF bad THEN PERFORM home_bound_v1._fail('JSON_BUDGET','22023');END IF;
END $$;
-- Decoded-value request codec, NOT original HTTP/JSON bytes or duplicate-key detection.
CREATE FUNCTION home_bound_v1._canonical(p_value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE k text;v jsonb;s text:='';first boolean:=true;n numeric; BEGIN
 CASE pg_catalog.jsonb_typeof(p_value)
 WHEN 'object' THEN
  FOR k,v IN SELECT key,value FROM pg_catalog.jsonb_each(p_value) ORDER BY key COLLATE "C" LOOP
   IF k !~ '^[A-Za-z][A-Za-z0-9_]*$' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
   s:=s||CASE WHEN first THEN '' ELSE ',' END||pg_catalog.to_jsonb(k)::text||':'||home_bound_v1._canonical(v);first:=false;
  END LOOP;RETURN '{'||s||'}';
 WHEN 'array' THEN
  FOR v IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value) LOOP s:=s||CASE WHEN first THEN '' ELSE ',' END||home_bound_v1._canonical(v);first:=false;END LOOP;RETURN '['||s||']';
 WHEN 'number' THEN n:=(p_value#>>'{}')::numeric;IF n<>pg_catalog.trunc(n) OR pg_catalog.abs(n)>9007199254740991 THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;RETURN n::bigint::text;
 WHEN 'string' THEN RETURN pg_catalog.to_jsonb(p_value#>>'{}')::text;
 WHEN 'boolean' THEN RETURN p_value::text;
 WHEN 'null' THEN RETURN 'null';
 ELSE PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');RETURN NULL;
 END CASE;
END $$;
CREATE FUNCTION home_bound_v1._entry(p_operation text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a home_bound_v1.principals%ROWTYPE;r pg_catalog.pg_roles%ROWTYPE;c home_bound_v1.resource_control%ROWTYPE;m record;component_oid oid;allowed boolean;
BEGIN
 -- MUST precede catalog/principal/resource reads and any declaration initializer query.
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN PERFORM home_bound_v1._fail('ISOLATION_NOT_SUPPORTED');END IF;
 SELECT * INTO r FROM pg_catalog.pg_roles WHERE rolname=session_user;
 SELECT * INTO a FROM home_bound_v1.principals WHERE principal_oid=r.oid AND principal_name=session_user;
 SELECT * INTO c FROM home_bound_v1.resource_control WHERE singleton;
 IF a.principal_oid IS NULL OR c.resource_id IS NULL OR a.resource_id<>c.resource_id OR a.run_id<>c.run_id OR NOT r.rolcanlogin OR NOT r.rolinherit OR r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls THEN PERFORM home_bound_v1._fail('FORBIDDEN','42501');END IF;
 SELECT oid INTO component_oid FROM pg_catalog.pg_roles WHERE rolname=a.component_role AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls;
 SELECT * INTO m FROM pg_catalog.pg_auth_members WHERE member=r.oid AND roleid=component_oid;
 IF component_oid IS NULL OR m.member IS NULL OR NOT m.inherit_option OR m.set_option OR m.admin_option OR (SELECT pg_catalog.count(*) FROM pg_catalog.pg_auth_members WHERE member=r.oid)<>1 OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE member=component_oid) OR EXISTS(SELECT 1 FROM pg_catalog.pg_database WHERE datdba=r.oid) THEN PERFORM home_bound_v1._fail('FORBIDDEN','42501');END IF;
 IF r.rolname<>('h4_'||pg_catalog.replace(c.run_id::text,'-','')||'_'||CASE a.component_role WHEN 'home_v1_fixture_writer' THEN 'fixture' WHEN 'home_v1_capture_worker' THEN 'capture' WHEN 'home_v1_commit_worker' THEN 'commit' WHEN 'home_v1_internal_reader' THEN 'read' END) THEN PERFORM home_bound_v1._fail('FORBIDDEN','42501');END IF;
 allowed:=p_operation='resource_identity' OR CASE a.component_role
 WHEN 'home_v1_fixture_writer' THEN p_operation IN ('fixture_apply','lookup_effect')
 WHEN 'home_v1_capture_worker' THEN p_operation IN ('get_head','capture_round','lookup_effect','read_current_home')
 WHEN 'home_v1_commit_worker' THEN p_operation IN ('get_head','commit_round','discard_stale_round','lookup_effect')
 WHEN 'home_v1_internal_reader' THEN p_operation='read_current_home' ELSE false END;
 IF NOT allowed THEN PERFORM home_bound_v1._fail('FORBIDDEN','42501');END IF;
 RETURN pg_catalog.jsonb_build_object('sessionUser',r.rolname,'sessionUserOid',r.oid::text,'componentRole',a.component_role,'resourceId',c.resource_id,'runId',c.run_id);
END $$;
CREATE FUNCTION home_bound_v1._gate(p_namespace uuid,p_exclusive boolean) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE k bigint;BEGIN
 SELECT gate_key INTO k FROM home_bound_v1.namespaces WHERE namespace_id=p_namespace;
 IF k IS NULL THEN PERFORM home_bound_v1._fail('NAMESPACE_UNKNOWN');END IF;
 IF p_exclusive THEN PERFORM pg_catalog.pg_advisory_xact_lock(k);ELSE PERFORM pg_catalog.pg_advisory_xact_lock_shared(k);END IF;
 -- This lock statement must finish BEFORE the caller's next current SELECT.
END $$;
CREATE FUNCTION home_bound_v1._held(p_namespace uuid,p_exclusive boolean DEFAULT false) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE k bigint;BEGIN
 SELECT gate_key INTO k FROM home_bound_v1.namespaces WHERE namespace_id=p_namespace;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_locks WHERE locktype='advisory' AND pid=pg_catalog.pg_backend_pid() AND granted AND objsubid=1 AND classid=((k>>32)&4294967295)::oid AND objid=(k&4294967295)::oid AND (mode='ExclusiveLock' OR NOT p_exclusive AND mode='ShareLock')) THEN PERFORM home_bound_v1._fail('GATE_NOT_HELD');END IF;
END $$;
CREATE FUNCTION home_bound_v1._head(p_namespace uuid,p_stream text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE h home_bound_v1.heads%ROWTYPE;BEGIN
 SELECT * INTO h FROM home_bound_v1.heads WHERE namespace_id=p_namespace AND stream_id=p_stream;
 IF h.namespace_id IS NULL THEN PERFORM home_bound_v1._fail('STREAM_UNKNOWN');END IF;
 RETURN pg_catalog.jsonb_build_object('revision',h.global_revision::text,'roundId',h.round_id,'digest',h.digest);
END $$;
CREATE FUNCTION home_bound_v1._request_digest(p_operation text,p_request jsonb) RETURNS text LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE c home_bound_v1.resource_control%ROWTYPE;g uuid;BEGIN
 SELECT * INTO c FROM home_bound_v1.resource_control WHERE singleton;
 IF NOT(p_operation='fixture_apply' AND p_request->>'action'='CREATE_NAMESPACE') THEN SELECT backend_generation INTO g FROM home_bound_v1.namespaces WHERE namespace_id=home_bound_v1._uuid(p_request->>'namespaceId');END IF;
 RETURN home_bound_v1._hash(home_bound_v1._canonical(pg_catalog.jsonb_build_object('schema','HOME_DB_BOUND_V1_REQUEST','resourceId',c.resource_id,'namespaceId',p_request->'namespaceId','backendGeneration',g,'operation',p_operation,'request',p_request)));
END $$;
CREATE FUNCTION home_bound_v1._envelope(p_operation text,p_namespace uuid,p_result jsonb,p_principal jsonb,p_effect uuid DEFAULT NULL,p_digest text DEFAULT NULL,p_status text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE r jsonb;g uuid;c uuid;BEGIN
 SELECT resource_id INTO c FROM home_bound_v1.resource_control WHERE singleton;
 IF p_namespace IS NOT NULL THEN SELECT backend_generation INTO g FROM home_bound_v1.namespaces WHERE namespace_id=p_namespace;END IF;
 r:=pg_catalog.jsonb_build_object('schema','HOME_DB_BOUND_V1','mode','ISOLATED_SYNTHETIC_POSTGRES','sampleKind','SYNTHETIC','fixtureAssertionOnly',true,'executionEnabled',false,'persistence','POSTGRES_TEST_ONLY','databaseAlgorithmAuthenticity',false,'commitTimeQualificationProven',false,'crossworkerAtomicity',false,'resourceId',c,'namespaceId',p_namespace,'backendGeneration',g,'principal',p_principal,'serverCheckedAt',home_bound_v1._stamp(pg_catalog.clock_timestamp()),'operation',p_operation,'result',p_result);
 IF p_effect IS NOT NULL THEN r:=r||pg_catalog.jsonb_build_object('effectKey',p_effect,'requestDigest',p_digest,'status',p_status);END IF;
 PERFORM home_bound_v1._budget(r);RETURN r;
END $$;
CREATE FUNCTION home_bound_v1._replay(p_namespace uuid,p_operation text,p_effect uuid,p_digest text,p_principal jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE e home_bound_v1.effects%ROWTYPE;g uuid;BEGIN
 SELECT * INTO e FROM home_bound_v1.effects WHERE namespace_id=p_namespace AND operation=p_operation AND effect_key=p_effect;
 IF e.effect_key IS NULL THEN RETURN NULL;END IF;
 SELECT backend_generation INTO g FROM home_bound_v1.namespaces WHERE namespace_id=p_namespace;
 IF e.request_digest<>p_digest OR e.backend_generation<>g OR e.principal_oid::text<>p_principal->>'sessionUserOid' OR e.principal_name::text<>p_principal->>'sessionUser' THEN PERFORM home_bound_v1._fail('EFFECT_CONFLICT');END IF;
 RETURN pg_catalog.jsonb_set(e.receipt,'{status}','"REUSED"'::jsonb);
END $$;
CREATE FUNCTION home_bound_v1._save_effect(p_namespace uuid,p_operation text,p_request jsonb,p_digest text,p_principal jsonb,p_result jsonb,p_qualification timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE r jsonb;g uuid;BEGIN
 SELECT backend_generation INTO g FROM home_bound_v1.namespaces WHERE namespace_id=p_namespace;
 r:=home_bound_v1._envelope(p_operation,p_namespace,p_result,p_principal,home_bound_v1._uuid(p_request->>'effectKey'),p_digest,'APPLIED');
 INSERT INTO home_bound_v1.effects VALUES(p_namespace,p_operation,home_bound_v1._uuid(p_request->>'effectKey'),g,p_digest,r,pg_catalog.clock_timestamp(),p_qualification,(p_principal->>'sessionUserOid')::oid,(p_principal->>'sessionUser')::name);
 RETURN r;
END $$;

CREATE FUNCTION home_bound_v1._manifest(p_second boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT pg_catalog.jsonb_build_object(
 'manifestId',CASE WHEN p_second THEN '00000000-0000-4000-8000-000000000002' ELSE '00000000-0000-4000-8000-000000000001' END,
 'profileId',CASE WHEN p_second THEN 'SYNTHETIC_PROFILE_REISSUE' ELSE 'SYNTHETIC_PROFILE_V1' END,
 'nonpriceScaleVersion',CASE WHEN p_second THEN 'SYNTHETIC_SCALE_V2' ELSE 'SYNTHETIC_SCALE_V1' END,
 'catalogVersion','catalog-db-p4-v1','evaluationSetVersion','evaluation-db-p4-v1','comparisonSetVersion','comparison-db-p4-v1','sourcePolicyVersion','SYNTHETIC_SOURCE_V1',
 'engine',pg_catalog.jsonb_build_object('ranking','SYNTHETIC_HOME_RANKING_7B2B_V1','priority','SYNTHETIC_PRIORITY_7B1_V1','context','SYNTHETIC_HOME_SNAPSHOT_7B2A_V1')) $$;
CREATE FUNCTION home_bound_v1._segment(p_profile jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 'segment-'||home_bound_v1._hash(home_bound_v1._canonical(pg_catalog.jsonb_build_array(
 pg_catalog.jsonb_build_object('contractVersion','JUDOJU_PIPELINE_K1','sampleKind','SYNTHETIC','policyVersion','k1-policy-'||home_bound_v1._hash(home_bound_v1._canonical(pg_catalog.jsonb_build_array(p_profile->'profileId',p_profile->'engine'))),'catalogVersion',p_profile->'catalogVersion','sourcePolicyVersion',p_profile->'sourcePolicyVersion'),p_profile->'evaluationSetVersion',p_profile->'nonpriceScaleVersion'))) $$;
CREATE FUNCTION home_bound_v1._graph(p_graph jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ DECLARE v jsonb;BEGIN
 PERFORM home_bound_v1._exact(p_graph,ARRAY['gradeClaimIds','macroClaimIds','keyIssueEvidenceIds','analysisEvidenceIds','impactEvidenceIds','riskEvidenceIds','scheduleEvidenceIds','scenarioEvidenceIds','articleImpactEvidenceIds','decisionClaimIds','decisionInputRevisionIds']);
 FOR v IN SELECT value FROM pg_catalog.jsonb_each(p_graph) LOOP PERFORM home_bound_v1._ids(v);END LOOP;
END $$;
CREATE FUNCTION home_bound_v1._refs(p_graph jsonb) RETURNS SETOF text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT DISTINCT x.ref FROM pg_catalog.jsonb_each(p_graph) e CROSS JOIN LATERAL pg_catalog.jsonb_array_elements_text(e.value) x(ref) WHERE e.key<>'decisionInputRevisionIds' $$;
CREATE FUNCTION home_bound_v1._binding_shape(p_binding jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 PERFORM home_bound_v1._exact(p_binding,ARRAY['articleVersionId','publicationEffectKey','issueId','editorDraftRevision','issueRevisionBefore','issueRevisionAfter','requestDigest','contentDigest','evidenceVersion','assessmentVersion','firstPublishedAt','materialChangeAt','graph']);
 PERFORM home_bound_v1._strings(p_binding,ARRAY['articleVersionId','publicationEffectKey','issueId','editorDraftRevision','issueRevisionBefore','issueRevisionAfter','requestDigest','contentDigest','evidenceVersion','assessmentVersion','firstPublishedAt','materialChangeAt']);
 PERFORM home_bound_v1._uuid(p_binding->>'articleVersionId');PERFORM home_bound_v1._uuid(p_binding->>'publicationEffectKey');PERFORM home_bound_v1._id(p_binding->>'issueId');PERFORM home_bound_v1._id(p_binding->>'evidenceVersion');PERFORM home_bound_v1._id(p_binding->>'assessmentVersion');
 PERFORM home_bound_v1._decimal(p_binding->>'editorDraftRevision');
 IF home_bound_v1._decimal(p_binding->>'issueRevisionAfter')<>home_bound_v1._decimal(p_binding->>'issueRevisionBefore')+1 OR COALESCE(p_binding->>'requestDigest','') !~ '^[0-9a-f]{64}$' OR COALESCE(p_binding->>'contentDigest','') !~ '^[0-9a-f]{64}$' OR home_bound_v1._time(p_binding->>'materialChangeAt')<home_bound_v1._time(p_binding->>'firstPublishedAt') THEN PERFORM home_bound_v1._fail('BINDING_CONFLICT');END IF;
 PERFORM home_bound_v1._graph(p_binding->'graph');
END $$;
CREATE FUNCTION home_bound_v1._observation_shape(p_kind text,p_entity text,p_known timestamptz,p_value jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE c jsonb;g jsonb;k text;BEGIN
 IF p_kind='ISSUE' THEN
  PERFORM home_bound_v1._exact(p_value,ARRAY['priority','primarySectorId','articleVersionId','evidenceVersion','assessmentVersion','publicationState','dependencyGraph']);
  c:=p_value->'priority';PERFORM home_bound_v1._exact(c,ARRAY['issueId','storyId','version','assessmentVersion','sampleKind','inputKnownAt','publishedAt','materialChangeAt','lastVerifiedAt','evidenceValidUntil','scheduledEndAt','publicationState','contentClass','impactState','direction','scope','assessment','macroGate']);
  PERFORM home_bound_v1._strings(c,ARRAY['issueId','storyId','version','assessmentVersion','sampleKind','inputKnownAt','publishedAt','materialChangeAt','lastVerifiedAt','evidenceValidUntil','scheduledEndAt','publicationState','contentClass','impactState','direction','scope'],ARRAY['scheduledEndAt']);PERFORM home_bound_v1._strings(p_value,ARRAY['primarySectorId','articleVersionId','evidenceVersion','assessmentVersion','publicationState'],ARRAY['primarySectorId']);
  IF c->>'issueId' IS DISTINCT FROM p_entity OR c->>'sampleKind' IS DISTINCT FROM 'SYNTHETIC' OR c->>'version' IS DISTINCT FROM p_value->>'articleVersionId' OR c->>'assessmentVersion' IS DISTINCT FROM p_value->>'assessmentVersion' OR c->>'publicationState' IS DISTINCT FROM p_value->>'publicationState' OR COALESCE(c->>'publicationState','') NOT IN ('PUBLISHED','DRAFT','CORRECTION_PENDING','HIDDEN','WITHDRAWN','RETRACTED') OR COALESCE(c->>'contentClass','') NOT IN ('SECTOR_EVENT','SYSTEMIC_MACRO','AD_PROMOTION','IRRELEVANT','UNVERIFIED') OR COALESCE(c->>'impactState','') NOT IN ('ACTIVE','CHECK_PENDING','RESOLVED','INVALIDATED') OR COALESCE(c->>'direction','') NOT IN ('POSITIVE','NEGATIVE','MIXED','UNCERTAIN') OR COALESCE(c->>'scope','') NOT IN ('SECTOR','MACRO_ALL') THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  PERFORM home_bound_v1._uuid(p_value->>'articleVersionId');PERFORM home_bound_v1._id(c->>'storyId');PERFORM home_bound_v1._id(p_value->>'evidenceVersion');PERFORM home_bound_v1._id(p_value->>'assessmentVersion');
  IF c->>'scope'='SECTOR' THEN PERFORM home_bound_v1._id(p_value->>'primarySectorId');ELSIF p_value->'primarySectorId'<>'null'::jsonb THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  FOREACH k IN ARRAY ARRAY['inputKnownAt','publishedAt','materialChangeAt','lastVerifiedAt'] LOOP IF home_bound_v1._time(c->>k)>p_known THEN PERFORM home_bound_v1._fail('FUTURE_KNOWN_INPUT');END IF;END LOOP;
  IF home_bound_v1._time(c->>'publishedAt')>home_bound_v1._time(c->>'materialChangeAt') OR home_bound_v1._time(c->>'materialChangeAt')>home_bound_v1._time(c->>'lastVerifiedAt') OR home_bound_v1._time(c->>'evidenceValidUntil')<=home_bound_v1._time(c->>'lastVerifiedAt') OR home_bound_v1._time(c->>'evidenceValidUntil')-home_bound_v1._time(c->>'lastVerifiedAt')>interval '24 hours' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  IF c->'scheduledEndAt'<>'null'::jsonb THEN PERFORM home_bound_v1._time(c->>'scheduledEndAt');END IF;
  PERFORM home_bound_v1._exact(c->'assessment',ARRAY['transmission','breadth','magnitude','persistence']);
  FOR g IN SELECT value FROM pg_catalog.jsonb_each(c->'assessment') LOOP PERFORM home_bound_v1._exact(g,ARRAY['grade','claimIds']);IF pg_catalog.jsonb_typeof(g->'grade')<>'number' OR (g->>'grade')::numeric<>pg_catalog.trunc((g->>'grade')::numeric) OR (g->>'grade')::integer NOT BETWEEN 0 AND 5 THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;PERFORM home_bound_v1._ids(g->'claimIds');END LOOP;
  IF c->'macroGate'<>'null'::jsonb THEN PERFORM home_bound_v1._exact(c->'macroGate',ARRAY['decision','gateVersion','claimIds','independentOriginIds','officialCoreClaimId']);PERFORM home_bound_v1._ids(c#>'{macroGate,claimIds}');PERFORM home_bound_v1._ids(c#>'{macroGate,independentOriginIds}');END IF;
  PERFORM home_bound_v1._graph(p_value->'dependencyGraph');
 ELSIF p_kind='CLAIM' THEN
  PERFORM home_bound_v1._exact(p_value,ARRAY['claim','sourceRevisionId','evidenceVersion','status']);c:=p_value->'claim';PERFORM home_bound_v1._exact(c,ARRAY['sampleKind','version','claimId','originId','kind','knownAt','validUntil','verifiedAt','status']);
  PERFORM home_bound_v1._strings(p_value,ARRAY['sourceRevisionId','evidenceVersion','status']);PERFORM home_bound_v1._strings(c,ARRAY['sampleKind','version','claimId','originId','kind','knownAt','validUntil','verifiedAt','status']);
  IF c->>'claimId'<>p_entity OR c->>'sampleKind'<>'SYNTHETIC' OR COALESCE(c->>'kind','') NOT IN ('OFFICIAL_ANNOUNCEMENT','FILING','ENACTED_POLICY','INDUSTRY_DATA','OTHER') OR COALESCE(c->>'status','') NOT IN ('VERIFIED','UNVERIFIED','RETRACTED') OR COALESCE(p_value->>'status','') NOT IN ('VALID','BLOCKED') OR home_bound_v1._time(c->>'knownAt')>home_bound_v1._time(c->>'verifiedAt') OR home_bound_v1._time(c->>'verifiedAt')>p_known OR home_bound_v1._time(c->>'validUntil')<=home_bound_v1._time(c->>'verifiedAt') THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  FOREACH k IN ARRAY ARRAY['version','claimId','originId'] LOOP PERFORM home_bound_v1._id(c->>k);END LOOP;PERFORM home_bound_v1._id(p_value->>'sourceRevisionId');PERFORM home_bound_v1._id(p_value->>'evidenceVersion');
 ELSIF p_kind='SOURCE' THEN
  PERFORM home_bound_v1._exact(p_value,ARRAY['source','deliveryRef','bodyHash','sourceDigest','grantId','grantGeneration','status','expiresAt']);c:=p_value->'source';
  PERFORM home_bound_v1._exact(c,ARRAY['contractVersion','sampleKind','policyVersion','catalogVersion','sourcePolicyVersion','sourceDocumentId','revisionId','sourceId','endpointId','publisherId','originId','independenceGroupId','canonicalUrl','nativeId','collectedAt','publishedAt','updatedAt','timeQuality','contentHash','title','lead','bodyRef','permissionVersion']);
  PERFORM home_bound_v1._strings(c,ARRAY['contractVersion','sampleKind','policyVersion','catalogVersion','sourcePolicyVersion','sourceDocumentId','revisionId','sourceId','endpointId','publisherId','originId','independenceGroupId','canonicalUrl','nativeId','collectedAt','publishedAt','updatedAt','timeQuality','contentHash','title','lead','bodyRef','permissionVersion'],ARRAY['originId','independenceGroupId','publishedAt','updatedAt','bodyRef']);PERFORM home_bound_v1._strings(p_value,ARRAY['deliveryRef','bodyHash','sourceDigest','grantId','grantGeneration','status','expiresAt']);
  IF c->>'sourceDocumentId' IS DISTINCT FROM p_entity OR c->>'sampleKind' IS DISTINCT FROM 'SYNTHETIC' OR c->>'contractVersion' IS DISTINCT FROM 'JUDOJU_PIPELINE_K1' OR c->>'sourcePolicyVersion' IS DISTINCT FROM 'SYNTHETIC_SOURCE_V1' OR COALESCE(c->>'canonicalUrl','') !~ '^https://[A-Za-z0-9.-]+\.invalid(/[^[:space:]]*)?$' OR pg_catalog.strpos(c->>'canonicalUrl','#')>0 OR COALESCE(p_value->>'status','') NOT IN ('VALID','BLOCKED') OR home_bound_v1._time(c->>'collectedAt')>p_known OR pg_catalog.length(c->>'collectedAt')<>24 THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  FOREACH k IN ARRAY ARRAY['revisionId','sourceId','endpointId','publisherId','nativeId','permissionVersion','policyVersion','catalogVersion'] LOOP PERFORM home_bound_v1._id(c->>k);END LOOP;
  FOREACH k IN ARRAY ARRAY['originId','independenceGroupId'] LOOP IF c->k<>'null'::jsonb THEN PERFORM home_bound_v1._id(c->>k);END IF;END LOOP;
  IF c->>'timeQuality'='KNOWN' THEN PERFORM home_bound_v1._time(c->>'publishedAt');ELSIF c->>'timeQuality'<>'PENDING_TIME' OR c->'publishedAt'<>'null'::jsonb THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  FOREACH k IN ARRAY ARRAY['publishedAt','updatedAt'] LOOP IF c->k<>'null'::jsonb AND (home_bound_v1._time(c->>k)>home_bound_v1._time(c->>'collectedAt') OR pg_catalog.length(c->>k)<>24) THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;END LOOP;
  IF c->'bodyRef'<>'null'::jsonb AND (COALESCE(c->>'bodyRef','') !~ '^fixture:/[A-Za-z0-9_./-]+$' OR pg_catalog.strpos(c->>'bodyRef','..')>0) THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  FOREACH k IN ARRAY ARRAY['bodyHash','sourceDigest'] LOOP IF COALESCE(p_value->>k,'') !~ '^[0-9a-f]{64}$' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;END LOOP;
  IF COALESCE(c->>'contentHash','') !~ '^[0-9a-f]{64}$' OR p_value->>'bodyHash' IS DISTINCT FROM c->>'contentHash' OR p_value->>'sourceDigest' IS DISTINCT FROM home_bound_v1._hash(home_bound_v1._canonical(c)) THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  PERFORM home_bound_v1._id(p_value->>'deliveryRef');PERFORM home_bound_v1._id(p_value->>'grantId');PERFORM home_bound_v1._decimal(p_value->>'grantGeneration');PERFORM home_bound_v1._time(p_value->>'expiresAt');
 ELSIF p_kind='ASSESSMENT' THEN
  PERFORM home_bound_v1._exact(p_value,ARRAY['issueId','assessmentVersion','evidenceVersion','knownAt','verifiedAt','validUntil','status']);
  PERFORM home_bound_v1._strings(p_value,ARRAY['issueId','assessmentVersion','evidenceVersion','knownAt','verifiedAt','validUntil','status']);
  IF p_value->>'issueId'<>p_entity OR COALESCE(p_value->>'status','') NOT IN ('ACTIVE','CHECK_PENDING','INVALIDATED') OR home_bound_v1._time(p_value->>'knownAt')>p_known OR home_bound_v1._time(p_value->>'verifiedAt')>p_known OR home_bound_v1._time(p_value->>'validUntil')<=home_bound_v1._time(p_value->>'verifiedAt') THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;PERFORM home_bound_v1._id(p_value->>'assessmentVersion');PERFORM home_bound_v1._id(p_value->>'evidenceVersion');
 ELSIF p_kind='GRANT' THEN
  PERFORM home_bound_v1._exact(p_value,ARRAY['authority','issuer','evidenceRef','generation','purposes','artifactSourceIds','knownAt','expiresAt','revokedAt']);
  PERFORM home_bound_v1._strings(p_value,ARRAY['authority','issuer','evidenceRef','generation','knownAt','expiresAt','revokedAt'],ARRAY['revokedAt']);
  IF p_value->>'authority'<>'ISOLATED_FIXTURE' OR home_bound_v1._time(p_value->>'knownAt')>p_known THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  PERFORM home_bound_v1._id(p_value->>'issuer');PERFORM home_bound_v1._id(p_value->>'evidenceRef');PERFORM home_bound_v1._decimal(p_value->>'generation');PERFORM home_bound_v1._ids(p_value->'purposes');PERFORM home_bound_v1._ids(p_value->'artifactSourceIds');PERFORM home_bound_v1._time(p_value->>'expiresAt');IF p_value->'revokedAt'<>'null'::jsonb THEN PERFORM home_bound_v1._time(p_value->>'revokedAt');END IF;
 ELSIF p_kind='CALENDAR' THEN
  PERFORM home_bound_v1._exact(p_value,ARRAY['calendarVersion','evidenceId','knownAt','validUntil','coverageStart','coverageEnd','days']);PERFORM home_bound_v1._id(p_value->>'calendarVersion');PERFORM home_bound_v1._id(p_value->>'evidenceId');PERFORM home_bound_v1._time(p_value->>'validUntil');
  PERFORM home_bound_v1._strings(p_value,ARRAY['calendarVersion','evidenceId','knownAt','validUntil','coverageStart','coverageEnd']);
  IF home_bound_v1._time(p_value->>'knownAt')>p_known OR pg_catalog.jsonb_typeof(p_value->'days')<>'array' OR pg_catalog.jsonb_array_length(p_value->'days')>366 OR (p_value->>'coverageEnd')::date<(p_value->>'coverageStart')::date THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  IF (SELECT pg_catalog.count(*)<>(p_value->>'coverageEnd')::date-(p_value->>'coverageStart')::date+1 OR pg_catalog.count(DISTINCT value->>'date')<>pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements(p_value->'days')) THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
  FOR c IN SELECT value FROM pg_catalog.jsonb_array_elements(p_value->'days') LOOP PERFORM home_bound_v1._exact(c,ARRAY['date','state']);IF COALESCE(c->>'state','') NOT IN ('OPEN','CLOSED') OR (c->>'date')::date NOT BETWEEN (p_value->>'coverageStart')::date AND (p_value->>'coverageEnd')::date THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;END LOOP;
 ELSE PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
END $$;

CREATE FUNCTION home_bound_v1._latest(p_namespace uuid,p_kind text,p_entity text,p_at timestamptz) RETURNS jsonb LANGUAGE sql VOLATILE SET search_path='' AS $$
 SELECT payload FROM home_bound_v1.observations WHERE namespace_id=p_namespace AND kind=p_kind AND entity_id=p_entity AND known_at<=p_at ORDER BY revision DESC LIMIT 1
$$;
CREATE FUNCTION home_bound_v1._claim_projection(p_namespace uuid,p_graph jsonb,p_at timestamptz) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE ref text;c jsonb;answer jsonb:='[]';BEGIN
 FOR ref IN SELECT r.ref FROM home_bound_v1._refs(p_graph) r(ref) ORDER BY r.ref COLLATE "C" LOOP
  c:=home_bound_v1._latest(p_namespace,'CLAIM',ref,p_at);IF c IS NULL THEN RETURN NULL;END IF;
  answer:=answer||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('claimId',ref,'claimVersion',c#>'{claim,version}','kind',c#>'{claim,kind}','originId',c#>'{claim,originId}','sourceRevisionId',c->'sourceRevisionId','evidenceVersion',c->'evidenceVersion'));
 END LOOP;RETURN answer;
END $$;
-- SQL equivalent of pipeline-semantics.ts/selectPipelineSources: source clock, not arrival order.
CREATE FUNCTION home_bound_v1._source_current(p_namespace uuid,p_revision text,p_at timestamptz) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE doc text;latest timestamptz;answer jsonb;semantic_count bigint;BEGIN
 SELECT entity_id INTO doc FROM home_bound_v1.observations WHERE namespace_id=p_namespace AND kind='SOURCE' AND payload#>>'{source,revisionId}'=p_revision AND known_at<=p_at ORDER BY revision DESC LIMIT 1;
 IF doc IS NULL THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM home_bound_v1.observations WHERE namespace_id=p_namespace AND kind='SOURCE' AND entity_id=doc AND known_at<=p_at AND home_bound_v1._time(payload#>>'{source,collectedAt}')<=p_at AND payload#>'{source,publishedAt}'='null'::jsonb AND payload#>'{source,updatedAt}'='null'::jsonb) THEN RETURN NULL;END IF;
 SELECT pg_catalog.max(home_bound_v1._time(COALESCE(payload#>>'{source,updatedAt}',payload#>>'{source,publishedAt}'))) INTO latest FROM home_bound_v1.observations WHERE namespace_id=p_namespace AND kind='SOURCE' AND entity_id=doc AND known_at<=p_at AND home_bound_v1._time(payload#>>'{source,collectedAt}')<=p_at;
 SELECT pg_catalog.count(DISTINCT ((payload->'source')-'revisionId'-'collectedAt')) INTO semantic_count FROM home_bound_v1.observations WHERE namespace_id=p_namespace AND kind='SOURCE' AND entity_id=doc AND known_at<=p_at AND home_bound_v1._time(payload#>>'{source,collectedAt}')<=p_at AND home_bound_v1._time(COALESCE(payload#>>'{source,updatedAt}',payload#>>'{source,publishedAt}'))=latest;
 IF semantic_count<>1 THEN RETURN NULL;END IF;
 SELECT payload INTO answer FROM home_bound_v1.observations WHERE namespace_id=p_namespace AND kind='SOURCE' AND entity_id=doc AND known_at<=p_at AND home_bound_v1._time(payload#>>'{source,collectedAt}')<=p_at AND home_bound_v1._time(COALESCE(payload#>>'{source,updatedAt}',payload#>>'{source,publishedAt}'))=latest ORDER BY (payload#>>'{source,revisionId}') COLLATE "C",revision DESC LIMIT 1;
 IF answer#>>'{source,revisionId}'<>p_revision THEN RETURN NULL;END IF;RETURN answer;
END $$;
CREATE FUNCTION home_bound_v1._source_eligible(p_namespace uuid,p_revision text,p_at timestamptz) RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE s jsonb;g jsonb;BEGIN
 s:=home_bound_v1._source_current(p_namespace,p_revision,p_at);IF s IS NULL OR s->>'status'<>'VALID' OR home_bound_v1._time(s->>'expiresAt')<=p_at THEN RETURN false;END IF;
 g:=home_bound_v1._latest(p_namespace,'GRANT',s->>'grantId',p_at);
 RETURN COALESCE(g IS NOT NULL AND g->>'authority'='ISOLATED_FIXTURE' AND g->>'generation'=s->>'grantGeneration' AND home_bound_v1._time(g->>'knownAt')<=p_at AND home_bound_v1._time(g->>'expiresAt')>p_at AND (g->'revokedAt'='null'::jsonb OR home_bound_v1._time(g->>'revokedAt')>p_at) AND g->'purposes' ?& ARRAY['STORAGE','ANALYSIS','DISPLAY'] AND g->'artifactSourceIds' ? (s#>>'{source,sourceId}'),false);
END $$;
CREATE FUNCTION home_bound_v1._binding_current(p_namespace uuid,p_binding jsonb,p_at timestamptz) RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE i jsonb;c jsonb;s jsonb;a jsonb;ref text;saved_projection jsonb;BEGIN
 i:=home_bound_v1._latest(p_namespace,'ISSUE',p_binding->>'issueId',p_at);
 IF i IS NULL OR i->>'publicationState' IS DISTINCT FROM 'PUBLISHED' OR i->>'articleVersionId' IS DISTINCT FROM p_binding->>'articleVersionId' OR i->>'evidenceVersion' IS DISTINCT FROM p_binding->>'evidenceVersion' OR i->>'assessmentVersion' IS DISTINCT FROM p_binding->>'assessmentVersion' OR i->'dependencyGraph' IS DISTINCT FROM p_binding->'graph' OR i#>>'{priority,impactState}' IS DISTINCT FROM 'ACTIVE' OR COALESCE(i#>>'{priority,contentClass}','') NOT IN ('SECTOR_EVENT','SYSTEMIC_MACRO') OR home_bound_v1._time(i#>>'{priority,evidenceValidUntil}')<=p_at OR p_at-home_bound_v1._time(i#>>'{priority,lastVerifiedAt}')>=interval '24 hours' OR (i#>'{priority,scheduledEndAt}'<>'null'::jsonb AND home_bound_v1._time(i#>>'{priority,scheduledEndAt}')<=p_at) THEN RETURN false;END IF;
 a:=home_bound_v1._latest(p_namespace,'ASSESSMENT',p_binding->>'issueId',p_at);
 IF a IS NULL OR a->>'status' IS DISTINCT FROM 'ACTIVE' OR a->>'assessmentVersion' IS DISTINCT FROM p_binding->>'assessmentVersion' OR a->>'evidenceVersion' IS DISTINCT FROM p_binding->>'evidenceVersion' OR home_bound_v1._time(a->>'knownAt')>p_at OR home_bound_v1._time(a->>'verifiedAt')>p_at OR home_bound_v1._time(a->>'validUntil')<=p_at OR p_at-home_bound_v1._time(a->>'verifiedAt')>=interval '24 hours' THEN RETURN false;END IF;
 FOR ref IN SELECT * FROM home_bound_v1._refs(p_binding->'graph') LOOP
  c:=home_bound_v1._latest(p_namespace,'CLAIM',ref,p_at);
  IF c IS NULL OR c->>'status' IS DISTINCT FROM 'VALID' OR c->>'evidenceVersion' IS DISTINCT FROM p_binding->>'evidenceVersion' OR c#>>'{claim,status}' IS DISTINCT FROM 'VERIFIED' OR home_bound_v1._time(c#>>'{claim,knownAt}')>p_at OR home_bound_v1._time(c#>>'{claim,verifiedAt}')>p_at OR home_bound_v1._time(c#>>'{claim,validUntil}')<=p_at OR NOT home_bound_v1._source_eligible(p_namespace,c->>'sourceRevisionId',p_at) THEN RETURN false;END IF;
  s:=home_bound_v1._source_current(p_namespace,c->>'sourceRevisionId',p_at);
  IF c#>>'{claim,originId}' IS DISTINCT FROM s#>>'{source,originId}' OR NOT (p_binding#>'{graph,decisionInputRevisionIds}' ? (c->>'sourceRevisionId')) THEN RETURN false;END IF;
 END LOOP;
 -- Every decision input is current, including source refs with no displayed evidence.
 FOR ref IN SELECT pg_catalog.jsonb_array_elements_text(p_binding#>'{graph,decisionInputRevisionIds}') LOOP IF NOT home_bound_v1._source_eligible(p_namespace,ref,p_at) THEN RETURN false;END IF;END LOOP;
 SELECT claim_projection INTO saved_projection FROM home_bound_v1.publication_bindings WHERE namespace_id=p_namespace AND article_version_id=(p_binding->>'articleVersionId')::uuid;
 IF saved_projection IS DISTINCT FROM home_bound_v1._claim_projection(p_namespace,p_binding->'graph',p_at) THEN RETURN false;END IF;
 RETURN true;
END $$;

CREATE FUNCTION home_bound_v1._context(p_calendar jsonb,p_cutoff timestamptz,p_profile jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE day text;mins integer;state text;target text;basis text;segment text;comparison text;key text;BEGIN
 day:=pg_catalog.to_char(p_cutoff AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD');mins:=EXTRACT(hour FROM p_cutoff AT TIME ZONE 'Asia/Seoul')::integer*60+EXTRACT(minute FROM p_cutoff AT TIME ZONE 'Asia/Seoul')::integer;
 IF p_calendar IS NULL OR home_bound_v1._time(p_calendar->>'knownAt')>p_cutoff OR home_bound_v1._time(p_calendar->>'validUntil')<=p_cutoff OR day<(p_calendar->>'coverageStart') OR day>(p_calendar->>'coverageEnd') THEN PERFORM home_bound_v1._fail('CONTEXT_UNAVAILABLE');END IF;
 SELECT value->>'state' INTO state FROM pg_catalog.jsonb_array_elements(p_calendar->'days') WHERE value->>'date'=day;
 SELECT pg_catalog.min(value->>'date') INTO target FROM pg_catalog.jsonb_array_elements(p_calendar->'days') WHERE value->>'state'='OPEN' AND CASE WHEN mins>=1200 THEN value->>'date'>day ELSE value->>'date'>=day END;
 IF state IS NULL OR target IS NULL THEN PERFORM home_bound_v1._fail('CONTEXT_UNAVAILABLE');END IF;
 basis:=CASE WHEN state='OPEN' AND mins>=490 AND mins<1200 THEN 'KR_COMBINED' ELSE 'FOREIGN_US' END;
 segment:=CASE WHEN state='CLOSED' THEN 'FOREIGN_DAY' WHEN mins<490 THEN 'FOREIGN_PRE' WHEN mins<1200 THEN 'KR_DAY' ELSE 'FOREIGN_POST' END;
 comparison:='k1-compare-'||home_bound_v1._hash(home_bound_v1._canonical(pg_catalog.jsonb_build_array(p_profile->'comparisonSetVersion',p_profile->'profileId',p_profile->'nonpriceScaleVersion')));
 key:=home_bound_v1._canonical(pg_catalog.jsonb_build_array('SYNTHETIC_HOME_SNAPSHOT_7B2A_V1',p_profile->'catalogVersion',comparison,p_profile->'evaluationSetVersion',p_calendar->'calendarVersion',basis,target,false,false,false));
 RETURN pg_catalog.jsonb_build_object('cutoff',home_bound_v1._ms(p_cutoff),'koreaDate',day,'marketBasis',basis,'segment',segment,'targetKrTradingDay',target,'contextKey',key,'policyVersion','SYNTHETIC_HOME_SNAPSHOT_7B2A_V1','catalogVersion',p_profile->'catalogVersion','comparisonSetVersion',comparison,'evaluationSetVersion',p_profile->'evaluationSetVersion','calendarVersion',p_calendar->'calendarVersion','signals',pg_catalog.jsonb_build_object('T',false,'M',false,'P',false));
END $$;
CREATE FUNCTION home_bound_v1._calendar(p_namespace uuid,p_at timestamptz) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE a jsonb;n integer;BEGIN
 SELECT pg_catalog.count(*),pg_catalog.jsonb_agg(payload)->0 INTO n,a FROM (SELECT DISTINCT ON(entity_id) payload FROM home_bound_v1.observations WHERE namespace_id=p_namespace AND kind='CALENDAR' AND known_at<=p_at ORDER BY entity_id,revision DESC) x;
 IF n<>1 THEN PERFORM home_bound_v1._fail('CONTEXT_UNAVAILABLE');END IF;RETURN a;
END $$;
CREATE FUNCTION home_bound_v1._old_cards_present(p_namespace uuid,p_round uuid,p_at timestamptz) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$ DECLARE e record;i jsonb;BEGIN
 FOR e IN SELECT issue_id FROM home_bound_v1.entries WHERE namespace_id=p_namespace AND round_id=p_round LOOP
  i:=home_bound_v1._latest(p_namespace,'ISSUE',e.issue_id,p_at);
  IF i IS NULL THEN PERFORM home_bound_v1._fail('OLD_CARD_OBSERVATION_MISSING');END IF;
  -- Explicit exclusion permits a new safe snapshot; never infer absence means withdrawal.
  IF i->>'publicationState' IN ('HIDDEN','WITHDRAWN') THEN CONTINUE;END IF;
  IF i->>'publicationState' IS DISTINCT FROM 'PUBLISHED' THEN PERFORM home_bound_v1._fail('QUALIFICATION_HOLD');END IF;
 END LOOP;
END $$;
CREATE FUNCTION home_bound_v1._build_input(p_namespace uuid,p_stream text,p_cutoff timestamptz,p_profile jsonb,p_at timestamptz) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE h home_bound_v1.heads%ROWTYPE;old home_bound_v1.rounds%ROWTYPE;row record;i jsonb;b jsonb;claim jsonb;ref text;
 issues jsonb:='[]';claims jsonb:='[]';sectors jsonb:='[]';bindings jsonb:='[]';ids text[]:=ARRAY[]::text[];refs text[]:=ARRAY[]::text[];source_refs text[]:=ARRAY[]::text[];cal jsonb;context jsonb;previous jsonb:='null';answer jsonb;BEGIN
 PERFORM home_bound_v1._held(p_namespace);SELECT * INTO h FROM home_bound_v1.heads WHERE namespace_id=p_namespace AND stream_id=p_stream;
 IF h.namespace_id IS NULL THEN PERFORM home_bound_v1._fail('STREAM_UNKNOWN');END IF;
 PERFORM home_bound_v1._old_cards_present(p_namespace,h.round_id,p_at);
 FOR row IN SELECT * FROM (SELECT DISTINCT ON(entity_id) entity_id,payload FROM home_bound_v1.observations WHERE namespace_id=p_namespace AND kind='ISSUE' AND known_at<=p_cutoff ORDER BY entity_id,revision DESC) selected WHERE payload->>'publicationState'='PUBLISHED' ORDER BY entity_id COLLATE "C" LIMIT 301 LOOP
  IF pg_catalog.cardinality(ids)>=300 THEN PERFORM home_bound_v1._fail('INPUT_SET_TOO_LARGE');END IF;
  i:=row.payload;ids:=pg_catalog.array_append(ids,row.entity_id);
  SELECT binding INTO b FROM home_bound_v1.publication_bindings WHERE namespace_id=p_namespace AND article_version_id=home_bound_v1._uuid(i->>'articleVersionId');
  IF b IS NOT NULL THEN FOR ref IN SELECT pg_catalog.jsonb_array_elements_text(b#>'{graph,decisionInputRevisionIds}') LOOP IF NOT ref=ANY(source_refs) THEN source_refs:=pg_catalog.array_append(source_refs,ref);END IF;END LOOP;END IF;
  IF pg_catalog.cardinality(source_refs)>300 THEN PERFORM home_bound_v1._fail('INPUT_SET_TOO_LARGE');END IF;
  IF b IS NULL OR NOT home_bound_v1._binding_current(p_namespace,b,p_at) THEN PERFORM home_bound_v1._fail('QUALIFICATION_HOLD');END IF;
  issues:=issues||pg_catalog.jsonb_build_array(pg_catalog.jsonb_strip_nulls(i->'priority'));sectors:=sectors||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('issueId',row.entity_id,'primarySectorId',i->'primarySectorId'));bindings:=bindings||pg_catalog.jsonb_build_array(b);
  FOR ref IN SELECT * FROM home_bound_v1._refs(b->'graph') LOOP IF NOT ref=ANY(refs) THEN refs:=pg_catalog.array_append(refs,ref);END IF;END LOOP;
 END LOOP;
 IF (SELECT pg_catalog.count(DISTINCT id) FROM (SELECT pg_catalog.unnest(ids) id UNION SELECT issue_id FROM home_bound_v1.entries WHERE namespace_id=p_namespace AND round_id=h.round_id) u)>325 OR pg_catalog.cardinality(refs)>300 THEN PERFORM home_bound_v1._fail('INPUT_SET_TOO_LARGE');END IF;
 FOR ref IN SELECT x.ref FROM pg_catalog.unnest(refs) x(ref) ORDER BY x.ref COLLATE "C" LOOP
  claim:=home_bound_v1._latest(p_namespace,'CLAIM',ref,p_cutoff);IF claim IS NULL THEN PERFORM home_bound_v1._fail('CLAIM_MISSING');END IF;claims:=claims||pg_catalog.jsonb_build_array(claim->'claim');
 END LOOP;
 cal:=home_bound_v1._calendar(p_namespace,p_cutoff);PERFORM home_bound_v1._context(cal,p_cutoff,p_profile);
 IF home_bound_v1._time(cal->>'validUntil')<=p_at THEN PERFORM home_bound_v1._fail('CONTEXT_UNAVAILABLE');END IF;
 context:=pg_catalog.jsonb_build_object('mode','LOCAL_SYNTHETIC','sampleKind','SYNTHETIC','cutoff',home_bound_v1._ms(p_cutoff),'policyVersion','SYNTHETIC_HOME_SNAPSHOT_7B2A_V1','catalogVersion',p_profile->'catalogVersion','comparisonSetVersion',p_profile->'comparisonSetVersion','evaluationSetVersion',p_profile->'evaluationSetVersion','signals',pg_catalog.jsonb_build_object('T',false,'M',false,'P',false),'calendar',cal);
 IF h.global_revision>0 THEN
  SELECT * INTO old FROM home_bound_v1.rounds WHERE namespace_id=p_namespace AND round_id=h.round_id AND state='COMPLETED';
  IF old.round_id IS NULL OR old.result_digest<>h.digest OR old.planned_global_revision<>h.global_revision THEN PERFORM home_bound_v1._fail('PRIOR_STATE_MISSING');END IF;
  previous:=pg_catalog.jsonb_build_object('roundId',old.round_id,'digest',old.result_digest,'globalRevision',old.planned_global_revision::text,'localRevision',old.planned_local_revision::text,'segmentKey',old.segment_key,'rankingState',old.result_canonical::jsonb->'rankingState');
 END IF;
 answer:=pg_catalog.jsonb_build_object('inputBatch',pg_catalog.jsonb_build_object('profileManifestId',p_profile->'manifestId','profileId',p_profile->'profileId','nonpriceScaleVersion',p_profile->'nonpriceScaleVersion','catalogVersion',p_profile->'catalogVersion','evaluationSetVersion',p_profile->'evaluationSetVersion','rankingCutoff',home_bound_v1._ms(p_cutoff),'context',context,'claims',claims,'issues',issues,'sectors',sectors,'bindings',bindings),'previousCompleted',previous);
 PERFORM home_bound_v1._budget(answer);IF home_bound_v1._utf16len(answer::text)>65536 OR pg_catalog.octet_length(answer::text)>65536 THEN PERFORM home_bound_v1._fail('JSON_BUDGET');END IF;RETURN answer;
END $$;
CREATE FUNCTION home_bound_v1._qualify_round(p_namespace uuid,p_round uuid) RETURNS timestamptz LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE r home_bound_v1.rounds%ROWTYPE;h home_bound_v1.heads%ROWTYPE;at timestamptz;b jsonb;cal jsonb;BEGIN
 IF pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN PERFORM home_bound_v1._fail('ISOLATION_NOT_SUPPORTED');END IF;
 PERFORM home_bound_v1._held(p_namespace);
 -- Designated last-check sample. Caller time is never accepted. Not a COMMIT-clock sample.
 at:=pg_catalog.clock_timestamp();
 SELECT * INTO r FROM home_bound_v1.rounds WHERE namespace_id=p_namespace AND round_id=p_round;
 SELECT * INTO h FROM home_bound_v1.heads WHERE namespace_id=p_namespace AND stream_id=r.stream_id;
 IF r.producer_revision<>(SELECT input_revision FROM home_bound_v1.namespaces WHERE namespace_id=p_namespace) OR h.active_profile_manifest_id<>r.profile_manifest_id THEN PERFORM home_bound_v1._fail('INPUT_STALE','40001');END IF;
 cal:=home_bound_v1._calendar(p_namespace,at);IF home_bound_v1._time(cal->>'validUntil')<=at THEN PERFORM home_bound_v1._fail('QUALIFICATION_HOLD');END IF;
 FOR b IN SELECT value FROM pg_catalog.jsonb_array_elements(r.snapshot_canonical::jsonb#>'{inputBatch,bindings}') LOOP IF NOT home_bound_v1._binding_current(p_namespace,b,at) THEN PERFORM home_bound_v1._fail('QUALIFICATION_HOLD');END IF;END LOOP;
 PERFORM home_bound_v1._old_cards_present(p_namespace,(r.expected_head->>'roundId')::uuid,at);
 RETURN at;
END $$;
CREATE FUNCTION home_bound_v1._deferred_qualification() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 -- Defense only. SET CONSTRAINTS may fire this earlier than COMMIT; never overwrite last-check.
 IF NEW.state='COMPLETED' THEN PERFORM home_bound_v1._qualify_round(NEW.namespace_id,NEW.round_id);END IF;RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER home_v1_qualification_defense AFTER INSERT OR UPDATE ON home_bound_v1.rounds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION home_bound_v1._deferred_qualification();
CREATE FUNCTION home_bound_v1._observation_guard() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN PERFORM home_bound_v1._fail('IMMUTABLE_OBSERVATION');END IF;PERFORM home_bound_v1._held(NEW.namespace_id,true);RETURN NEW;
END $$;
CREATE TRIGGER home_v1_observation_immutable BEFORE INSERT OR UPDATE OR DELETE ON home_bound_v1.observations FOR EACH ROW EXECUTE FUNCTION home_bound_v1._observation_guard();

CREATE FUNCTION home_bound_v1.resource_identity(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE principal jsonb;c home_bound_v1.resource_control%ROWTYPE;sysid text;db_oid text;BEGIN
 principal:=home_bound_v1._entry('resource_identity');PERFORM home_bound_v1._budget(p_request);PERFORM home_bound_v1._exact(p_request,ARRAY['resourceId']);
 SELECT * INTO c FROM home_bound_v1.resource_control WHERE singleton;
 SELECT system_identifier::text INTO sysid FROM pg_catalog.pg_control_system();SELECT oid::text INTO db_oid FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database();
 IF home_bound_v1._uuid(p_request->>'resourceId')<>c.resource_id OR c.identity->>'clusterSystemIdentifier'<>sysid OR c.identity->>'databaseName'<>pg_catalog.current_database() OR c.identity->>'databaseOid'<>db_oid OR c.identity->>'imageId'<>'sha256:7c31363a3f7434ff14945f1b8a4880e6eca8b362e197e88b87c476c77aa3cf8c' OR c.identity->>'productId'<>'judoju-news' OR c.identity->>'stage'<>'MAIN_PARALLEL_P4' OR c.identity->>'component'<>'HOME_DB_BOUND_V1' THEN PERFORM home_bound_v1._fail('RESOURCE_MISMATCH');END IF;
 RETURN home_bound_v1._envelope('resource_identity',NULL,pg_catalog.jsonb_build_object('resourceIdentity',c.identity,'postmasterStartedAt',home_bound_v1._stamp(pg_catalog.pg_postmaster_start_time())),principal);
END $$;
CREATE FUNCTION home_bound_v1.fixture_apply(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE principal jsonb;n uuid;effect uuid;action text;digest text;replayed jsonb;k bigint;profile jsonb;o jsonb;b jsonb;old jsonb;i jsonb;v jsonb;ref text;obs_kind text;entity text;known timestamptz;rev bigint;maximum bigint;last_known timestamptz;ns home_bound_v1.namespaces%ROWTYPE;added integer:=0;bindings_added integer:=0;pid uuid;
BEGIN
 principal:=home_bound_v1._entry('fixture_apply');PERFORM home_bound_v1._budget(p_request);PERFORM home_bound_v1._canonical(p_request);
 action:=p_request->>'action';n:=home_bound_v1._uuid(p_request->>'namespaceId');effect:=home_bound_v1._uuid(p_request->>'effectKey');
 IF action='CREATE_NAMESPACE' THEN
  PERFORM home_bound_v1._exact(p_request,ARRAY['action','resourceId','namespaceId','effectKey','initialStreamId']);PERFORM home_bound_v1._id(p_request->>'initialStreamId');
  IF p_request->>'resourceId'<>principal->>'resourceId' THEN PERFORM home_bound_v1._fail('RESOURCE_MISMATCH');END IF;
  k:=('x'||pg_catalog.substr(home_bound_v1._hash(n::text),1,16))::bit(64)::bigint;PERFORM pg_catalog.pg_advisory_xact_lock(k);
  digest:=home_bound_v1._request_digest('fixture_apply',p_request);replayed:=home_bound_v1._replay(n,'fixture_apply',effect,digest,principal);IF replayed IS NOT NULL THEN RETURN replayed;END IF;
  IF EXISTS(SELECT 1 FROM home_bound_v1.namespaces WHERE namespace_id=n) THEN PERFORM home_bound_v1._fail('NAMESPACE_EXISTS');END IF;
  INSERT INTO home_bound_v1.namespaces(namespace_id,gate_key) VALUES(n,k);
  FOR profile IN SELECT home_bound_v1._manifest(false) UNION ALL SELECT home_bound_v1._manifest(true) LOOP INSERT INTO home_bound_v1.profiles VALUES(n,(profile->>'manifestId')::uuid,profile,home_bound_v1._hash(home_bound_v1._canonical(profile)),'OFF_ALL');END LOOP;
  pid:='00000000-0000-4000-8000-000000000001';INSERT INTO home_bound_v1.heads(namespace_id,stream_id,active_profile_manifest_id) VALUES(n,p_request->>'initialStreamId',pid);
 ELSIF action IN ('APPEND','ACTIVATE_PROFILE') THEN
  IF action='APPEND' THEN PERFORM home_bound_v1._exact(p_request,ARRAY['action','namespaceId','effectKey','expectedInputRevision','observations','publicationBindings']);ELSE PERFORM home_bound_v1._exact(p_request,ARRAY['action','namespaceId','effectKey','expectedInputRevision','streamId','profileManifestId']);END IF;
  PERFORM home_bound_v1._gate(n,true);
  -- Separate statement AFTER the potentially blocking exclusive lock, including exact replay.
  SELECT * INTO ns FROM home_bound_v1.namespaces WHERE namespace_id=n;
  digest:=home_bound_v1._request_digest('fixture_apply',p_request);replayed:=home_bound_v1._replay(n,'fixture_apply',effect,digest,principal);IF replayed IS NOT NULL THEN RETURN replayed;END IF;
  IF ns.input_revision<>home_bound_v1._decimal(p_request->>'expectedInputRevision') THEN PERFORM home_bound_v1._fail('INPUT_STALE','40001');END IF;
  IF action='APPEND' THEN
   IF pg_catalog.jsonb_typeof(p_request->'observations') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_typeof(p_request->'publicationBindings') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(p_request->'observations')>1000 OR pg_catalog.jsonb_array_length(p_request->'publicationBindings')>300 OR pg_catalog.jsonb_array_length(p_request->'observations')+pg_catalog.jsonb_array_length(p_request->'publicationBindings')=0 THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
   FOR o IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'observations') LOOP
    PERFORM home_bound_v1._exact(o,ARRAY['kind','entityId','revision','contentId','knownAt','payload']);PERFORM home_bound_v1._strings(o,ARRAY['kind','entityId','revision','contentId','knownAt']);obs_kind:=o->>'kind';entity:=home_bound_v1._id(o->>'entityId');rev:=home_bound_v1._decimal(o->>'revision');known:=home_bound_v1._time(o->>'knownAt');PERFORM home_bound_v1._id(o->>'contentId');v:=o->'payload';
    IF rev=0 OR known>pg_catalog.clock_timestamp() THEN PERFORM home_bound_v1._fail('FUTURE_KNOWN_INPUT');END IF;
    SELECT pg_catalog.max(revision),pg_catalog.max(known_at) INTO maximum,last_known FROM home_bound_v1.observations WHERE namespace_id=n AND observations.kind=obs_kind AND entity_id=entity;
    IF rev<=COALESCE(maximum,0) OR known<last_known THEN PERFORM home_bound_v1._fail('REVISION_CONFLICT');END IF;
    PERFORM home_bound_v1._observation_shape(obs_kind,entity,known,v);
    IF obs_kind='SOURCE' THEN
     IF EXISTS(SELECT 1 FROM home_bound_v1.observations s WHERE s.namespace_id=n AND s.kind='SOURCE' AND ((s.payload#>>'{source,revisionId}'=v#>>'{source,revisionId}' AND (s.payload-ARRAY['status','expiresAt'])<>(v-ARRAY['status','expiresAt'])) OR (s.entity_id=entity AND (s.payload#>>'{source,sourceId}'<>v#>>'{source,sourceId}' OR s.payload#>>'{source,nativeId}'<>v#>>'{source,nativeId}')) OR (s.entity_id<>entity AND s.payload#>>'{source,sourceId}'=v#>>'{source,sourceId}' AND s.payload#>>'{source,nativeId}'=v#>>'{source,nativeId}'))) THEN PERFORM home_bound_v1._fail('SOURCE_IDENTITY_CONFLICT');END IF;
    END IF;
    IF obs_kind='ISSUE' THEN
     i:=v->'priority';
     IF EXISTS(SELECT 1 FROM home_bound_v1.issue_identities x WHERE x.namespace_id=n AND x.issue_id=entity AND (x.canonical_story_id<>i->>'storyId' OR x.first_published_at<>home_bound_v1._time(i->>'publishedAt'))) THEN PERFORM home_bound_v1._fail('FIRST_PUBLICATION_CHANGED');END IF;
     INSERT INTO home_bound_v1.issue_identities VALUES(n,entity,i->>'storyId',home_bound_v1._time(i->>'publishedAt')) ON CONFLICT DO NOTHING;
     SELECT payload INTO old FROM home_bound_v1.observations WHERE namespace_id=n AND observations.kind='ISSUE' AND entity_id=entity AND payload->>'articleVersionId'=v->>'articleVersionId' ORDER BY revision DESC LIMIT 1;
     IF old IS NOT NULL AND (old->'dependencyGraph'<>v->'dependencyGraph' OR old->>'evidenceVersion'<>v->>'evidenceVersion' OR old->>'assessmentVersion'<>v->>'assessmentVersion' OR old->'primarySectorId'<>v->'primarySectorId' OR ((old->'priority')-ARRAY['publicationState','inputKnownAt','lastVerifiedAt','evidenceValidUntil','scheduledEndAt'])<>(i-ARRAY['publicationState','inputKnownAt','lastVerifiedAt','evidenceValidUntil','scheduledEndAt'])) THEN PERFORM home_bound_v1._fail('DEPENDENCY_GRAPH_CHANGED');END IF;
    END IF;
    INSERT INTO home_bound_v1.observations(namespace_id,kind,entity_id,revision,content_id,known_at,content_digest,payload) VALUES(n,obs_kind,entity,rev,o->>'contentId',known,home_bound_v1._hash(home_bound_v1._canonical(v)),v);added:=added+1;
   END LOOP;
   FOR b IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'publicationBindings') LOOP
    PERFORM home_bound_v1._binding_shape(b);
    SELECT binding INTO old FROM home_bound_v1.publication_bindings WHERE namespace_id=n AND article_version_id=(b->>'articleVersionId')::uuid;
    IF old IS NOT NULL THEN IF old<>b THEN PERFORM home_bound_v1._fail('DEPENDENCY_GRAPH_CHANGED');END IF;CONTINUE;END IF;
    i:=home_bound_v1._latest(n,'ISSUE',b->>'issueId',pg_catalog.clock_timestamp());
    IF i IS NULL OR i->>'articleVersionId'<>b->>'articleVersionId' OR i->>'evidenceVersion'<>b->>'evidenceVersion' OR i->>'assessmentVersion'<>b->>'assessmentVersion' OR i->'dependencyGraph'<>b->'graph' OR home_bound_v1._time(i#>>'{priority,publishedAt}')<>home_bound_v1._time(b->>'firstPublishedAt') OR home_bound_v1._time(i#>>'{priority,materialChangeAt}')<>home_bound_v1._time(b->>'materialChangeAt') THEN PERFORM home_bound_v1._fail('BINDING_CONFLICT');END IF;
    INSERT INTO home_bound_v1.publication_bindings VALUES(n,(b->>'articleVersionId')::uuid,(b->>'publicationEffectKey')::uuid,b->>'issueId',(b->>'editorDraftRevision')::bigint,(b->>'issueRevisionBefore')::bigint,(b->>'issueRevisionAfter')::bigint,b->>'requestDigest',b->>'contentDigest',b->>'evidenceVersion',b->>'assessmentVersion',home_bound_v1._time(b->>'firstPublishedAt'),home_bound_v1._time(b->>'materialChangeAt'),b->'graph',b,home_bound_v1._claim_projection(n,b->'graph',pg_catalog.clock_timestamp()));bindings_added:=bindings_added+1;
   END LOOP;
   FOR o IN SELECT value FROM pg_catalog.jsonb_array_elements(p_request->'observations') WHERE value->>'kind'='ISSUE' LOOP
    i:=o->'payload';SELECT binding INTO b FROM home_bound_v1.publication_bindings WHERE namespace_id=n AND article_version_id=(i->>'articleVersionId')::uuid;
    IF b IS NULL OR b->'graph'<>i->'dependencyGraph' OR b->>'issueId'<>o->>'entityId' THEN PERFORM home_bound_v1._fail('BINDING_MISSING');END IF;
    FOR ref IN SELECT * FROM home_bound_v1._refs(b->'graph') LOOP IF NOT(b#>'{graph,decisionClaimIds}' ? ref) THEN PERFORM home_bound_v1._fail('BINDING_MISSING');END IF;END LOOP;
    FOR ref IN SELECT pg_catalog.jsonb_array_elements_text(g.value->'claimIds') FROM pg_catalog.jsonb_each(i#>'{priority,assessment}') g LOOP IF NOT(b#>'{graph,gradeClaimIds}' ? ref) THEN PERFORM home_bound_v1._fail('BINDING_MISSING');END IF;END LOOP;
    IF i#>'{priority,macroGate}'<>'null'::jsonb THEN FOR ref IN SELECT pg_catalog.jsonb_array_elements_text(i#>'{priority,macroGate,claimIds}') LOOP IF NOT(b#>'{graph,macroClaimIds}' ? ref) THEN PERFORM home_bound_v1._fail('BINDING_MISSING');END IF;END LOOP;END IF;
   END LOOP;
   pid:='00000000-0000-4000-8000-000000000001';
  ELSE
   PERFORM home_bound_v1._id(p_request->>'streamId');pid:=home_bound_v1._uuid(p_request->>'profileManifestId');
   IF NOT EXISTS(SELECT 1 FROM home_bound_v1.profiles WHERE namespace_id=n AND profile_manifest_id=pid) THEN PERFORM home_bound_v1._fail('POLICY_STALE');END IF;
   UPDATE home_bound_v1.heads SET active_profile_manifest_id=pid WHERE namespace_id=n AND stream_id=p_request->>'streamId';IF NOT FOUND THEN PERFORM home_bound_v1._fail('STREAM_UNKNOWN');END IF;
  END IF;
  UPDATE home_bound_v1.namespaces SET input_revision=input_revision+1,known_through=pg_catalog.clock_timestamp() WHERE namespace_id=n;
 ELSE PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
 SELECT * INTO ns FROM home_bound_v1.namespaces WHERE namespace_id=n;
 RETURN home_bound_v1._save_effect(n,'fixture_apply',p_request,digest,principal,pg_catalog.jsonb_build_object('inputRevision',ns.input_revision::text,'observationsAdded',added,'publicationBindingsAdded',bindings_added,'profileManifestId',pid));
END $$;
CREATE FUNCTION home_bound_v1.get_head(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE principal jsonb;n uuid;h home_bound_v1.heads%ROWTYPE;rev bigint;BEGIN
 principal:=home_bound_v1._entry('get_head');PERFORM home_bound_v1._budget(p_request);PERFORM home_bound_v1._exact(p_request,ARRAY['namespaceId','streamId']);n:=home_bound_v1._uuid(p_request->>'namespaceId');PERFORM home_bound_v1._id(p_request->>'streamId');
 PERFORM home_bound_v1._gate(n,false);
 SELECT * INTO h FROM home_bound_v1.heads WHERE namespace_id=n AND stream_id=p_request->>'streamId';IF h.namespace_id IS NULL THEN PERFORM home_bound_v1._fail('STREAM_UNKNOWN');END IF;
 SELECT input_revision INTO rev FROM home_bound_v1.namespaces WHERE namespace_id=n;
 RETURN home_bound_v1._envelope('get_head',n,pg_catalog.jsonb_build_object('head',home_bound_v1._head(n,h.stream_id),'activeProfileManifestId',h.active_profile_manifest_id,'inputRevision',rev::text),principal);
END $$;
CREATE FUNCTION home_bound_v1.capture_round(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE principal jsonb;n uuid;effect uuid;rid uuid;cutoff timestamptz;at timestamptz;h home_bound_v1.heads%ROWTYPE;ns home_bound_v1.namespaces%ROWTYPE;prior home_bound_v1.rounds%ROWTYPE;p jsonb;snapshot jsonb;canonical text;segment text;local_rev bigint;slot bigint;digest text;replayed jsonb;answer jsonb;BEGIN
 principal:=home_bound_v1._entry('capture_round');PERFORM home_bound_v1._budget(p_request);PERFORM home_bound_v1._canonical(p_request);PERFORM home_bound_v1._exact(p_request,ARRAY['namespaceId','effectKey','roundId','streamId','rankingCutoff','expectedHead','supersedesRoundId']);
 n:=home_bound_v1._uuid(p_request->>'namespaceId');effect:=home_bound_v1._uuid(p_request->>'effectKey');rid:=home_bound_v1._uuid(p_request->>'roundId');PERFORM home_bound_v1._id(p_request->>'streamId');PERFORM home_bound_v1._exact(p_request->'expectedHead',ARRAY['revision','roundId','digest']);
 PERFORM home_bound_v1._gate(n,false);
 PERFORM 1 FROM home_bound_v1.heads WHERE namespace_id=n AND stream_id=p_request->>'streamId' FOR UPDATE;
 SELECT * INTO h FROM home_bound_v1.heads WHERE namespace_id=n AND stream_id=p_request->>'streamId';IF h.namespace_id IS NULL THEN PERFORM home_bound_v1._fail('STREAM_UNKNOWN');END IF;
 SELECT * INTO ns FROM home_bound_v1.namespaces WHERE namespace_id=n;
 digest:=home_bound_v1._request_digest('capture_round',p_request);replayed:=home_bound_v1._replay(n,'capture_round',effect,digest,principal);IF replayed IS NOT NULL THEN RETURN replayed;END IF;
 IF p_request->'expectedHead'<>home_bound_v1._head(n,h.stream_id) THEN PERFORM home_bound_v1._fail('HEAD_CONFLICT','40001');END IF;
 at:=pg_catalog.clock_timestamp();cutoff:=home_bound_v1._time(p_request->>'rankingCutoff');
 IF cutoff<>pg_catalog.date_bin(interval '5 minutes',at,'1970-01-01Z'::timestamptz) THEN PERFORM home_bound_v1._fail('CUTOFF_NOT_CURRENT');END IF;
 IF h.ranking_cutoff IS NOT NULL AND cutoff<=h.ranking_cutoff THEN PERFORM home_bound_v1._fail('STALE_CUTOFF');END IF;
 IF EXISTS(SELECT 1 FROM home_bound_v1.rounds WHERE namespace_id=n AND stream_id=h.stream_id AND ranking_cutoff=cutoff AND state IN ('CAPTURED','COMPLETED')) THEN PERFORM home_bound_v1._fail('SLOT_CONFLICT','40001');END IF;
 SELECT * INTO prior FROM home_bound_v1.rounds WHERE namespace_id=n AND stream_id=h.stream_id AND ranking_cutoff=cutoff ORDER BY slot_generation DESC LIMIT 1;
 IF prior.round_id IS NULL THEN IF p_request->'supersedesRoundId'<>'null'::jsonb THEN PERFORM home_bound_v1._fail('SLOT_CONFLICT','40001');END IF;slot:=1;
 ELSE IF prior.state<>'SUPERSEDED' OR home_bound_v1._uuid(p_request->>'supersedesRoundId')<>prior.round_id THEN PERFORM home_bound_v1._fail('SLOT_CONFLICT','40001');END IF;slot:=prior.slot_generation+1;END IF;
 SELECT manifest INTO p FROM home_bound_v1.profiles WHERE namespace_id=n AND profile_manifest_id=h.active_profile_manifest_id;
 IF p NOT IN (home_bound_v1._manifest(false),home_bound_v1._manifest(true)) THEN PERFORM home_bound_v1._fail('POLICY_STALE');END IF;
 segment:=home_bound_v1._segment(p);SELECT local_revision+1 INTO local_rev FROM home_bound_v1.segment_heads WHERE namespace_id=n AND stream_id=h.stream_id AND segment_key=segment;local_rev:=COALESCE(local_rev,1);
 snapshot:=home_bound_v1._build_input(n,h.stream_id,cutoff,p,at);canonical:=snapshot::text;
 INSERT INTO home_bound_v1.rounds(namespace_id,round_id,stream_id,ranking_cutoff,slot_generation,supersedes_round_id,expected_head,profile_manifest_id,segment_key,producer_revision,snapshot_canonical,input_digest,planned_global_revision,planned_local_revision) VALUES(n,rid,h.stream_id,cutoff,slot,prior.round_id,p_request->'expectedHead',h.active_profile_manifest_id,segment,ns.input_revision,canonical,home_bound_v1._hash(canonical),h.global_revision+1,local_rev);
 answer:=pg_catalog.jsonb_build_object('roundId',rid,'streamId',h.stream_id,'rankingCutoff',home_bound_v1._ms(cutoff),'expectedHead',p_request->'expectedHead','producerRevision',ns.input_revision::text,'inputDigest',home_bound_v1._hash(canonical),'slotGeneration',slot::text,'plannedGlobalRevision',(h.global_revision+1)::text,'plannedLocalRevision',local_rev::text,'segmentKey',segment,'snapshotCanonical',canonical);
 RETURN home_bound_v1._save_effect(n,'capture_round',p_request,digest,principal,answer);
END $$;

CREATE FUNCTION home_bound_v1._result_shape(p_namespace uuid,p_round home_bound_v1.rounds,p_result jsonb,p_profile jsonb) RETURNS void LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE input jsonb;state jsonb;record jsonb;card jsonb;b jsonb;i jsonb;sector jsonb;lane text;ref text;expected_context jsonb;expected_input jsonb;BEGIN
 PERFORM home_bound_v1._budget(p_result);PERFORM home_bound_v1._exact(p_result,ARRAY['schema','namespaceId','roundId','streamId','rankingCutoff','profileManifestId','profileId','nonpriceScaleVersion','plannedGlobalRevision','plannedLocalRevision','segmentKey','previousDigest','context','lanes','rankingState']);
 input:=p_round.snapshot_canonical::jsonb->'inputBatch';
 IF p_result->>'schema' IS DISTINCT FROM 'HOME_DB_BOUND_V1_RESULT' OR p_result->>'namespaceId' IS DISTINCT FROM p_namespace::text OR p_result->>'roundId' IS DISTINCT FROM p_round.round_id::text OR p_result->>'streamId' IS DISTINCT FROM p_round.stream_id OR p_result->>'rankingCutoff' IS DISTINCT FROM home_bound_v1._ms(p_round.ranking_cutoff) OR p_result->>'profileManifestId' IS DISTINCT FROM p_round.profile_manifest_id::text OR p_result->>'profileId' IS DISTINCT FROM p_profile->>'profileId' OR p_result->>'nonpriceScaleVersion' IS DISTINCT FROM p_profile->>'nonpriceScaleVersion' OR p_result->>'plannedGlobalRevision' IS DISTINCT FROM p_round.planned_global_revision::text OR p_result->>'plannedLocalRevision' IS DISTINCT FROM p_round.planned_local_revision::text OR p_result->>'segmentKey' IS DISTINCT FROM p_round.segment_key OR p_result->'previousDigest' IS DISTINCT FROM p_round.expected_head->'digest' THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
 expected_context:=home_bound_v1._context(input#>'{context,calendar}',p_round.ranking_cutoff,p_profile);
 IF p_result->'context' IS DISTINCT FROM expected_context THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
 state:=p_result->'rankingState';PERFORM home_bound_v1._exact(state,ARRAY['sampleKind','policyVersion','cutoff','contextInput','records','pools','seen','highComparisonVersion']);
 expected_input:=pg_catalog.jsonb_set(input->'context','{comparisonSetVersion}',expected_context->'comparisonSetVersion');
 IF state->>'sampleKind' IS DISTINCT FROM 'SYNTHETIC' OR state->>'policyVersion' IS DISTINCT FROM 'SYNTHETIC_HOME_RANKING_7B2B_V1' OR state->>'cutoff' IS DISTINCT FROM home_bound_v1._ms(p_round.ranking_cutoff) OR state->'contextInput' IS DISTINCT FROM expected_input OR state->>'highComparisonVersion' IS DISTINCT FROM 'k1-high-'||home_bound_v1._hash(home_bound_v1._canonical(pg_catalog.jsonb_build_array(p_profile->'profileId',p_profile->'nonpriceScaleVersion'))) OR pg_catalog.jsonb_typeof(state->'records') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(state->'records')>300 OR pg_catalog.jsonb_typeof(state->'seen') IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(state->'seen')>600 THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
 IF (SELECT pg_catalog.count(*)<>pg_catalog.count(DISTINCT value->>'issueId') OR pg_catalog.count(*)<>pg_catalog.count(DISTINCT value->>'storyId') FROM pg_catalog.jsonb_array_elements(state->'records')) OR (SELECT pg_catalog.count(DISTINCT value->>'storyId') FROM pg_catalog.jsonb_array_elements(input->'issues'))<>pg_catalog.jsonb_array_length(state->'records') THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
 FOR record IN SELECT value FROM pg_catalog.jsonb_array_elements(state->'records') LOOP
  PERFORM home_bound_v1._exact(record,ARRAY['issueId','storyId','role','tier','score','materialChangeAt','publishedAt','primarySectorId','I','T','M','P']);
  PERFORM home_bound_v1._strings(record,ARRAY['issueId','storyId','role','tier','materialChangeAt','publishedAt','primarySectorId'],ARRAY['primarySectorId']);
  SELECT value INTO i FROM pg_catalog.jsonb_array_elements(input->'issues') WHERE value->>'issueId'=record->>'issueId';SELECT value INTO sector FROM pg_catalog.jsonb_array_elements(input->'sectors') WHERE value->>'issueId'=record->>'issueId';
  IF i IS NULL OR record->>'storyId' IS DISTINCT FROM i->>'storyId' OR record->'publishedAt' IS DISTINCT FROM i->'publishedAt' OR record->'materialChangeAt' IS DISTINCT FROM i->'materialChangeAt' OR record->'primarySectorId' IS DISTINCT FROM sector->'primarySectorId' OR COALESCE(record->>'role','') NOT IN ('A','B','C') OR COALESCE(record->>'tier','') NOT IN ('HIGH','MEDIUM','STANDARD') OR pg_catalog.jsonb_typeof(record->'score') IS DISTINCT FROM 'number' OR (record->>'score')::numeric NOT BETWEEN 0 AND 100 OR pg_catalog.jsonb_typeof(record->'I') IS DISTINCT FROM 'number' OR (record->>'I')::numeric NOT BETWEEN 0 AND 1 OR record->'T' IS DISTINCT FROM 'null'::jsonb OR record->'M' IS DISTINCT FROM 'null'::jsonb OR record->'P' IS DISTINCT FROM 'null'::jsonb THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
 END LOOP;
 PERFORM home_bound_v1._exact(state->'pools',ARRAY['A','B','C']);PERFORM home_bound_v1._exact(p_result->'lanes',ARRAY['A','B','C']);
 FOREACH lane IN ARRAY ARRAY['A','B','C'] LOOP
  PERFORM home_bound_v1._ids(state#>ARRAY['pools',lane]);
  FOR ref IN SELECT pg_catalog.jsonb_array_elements_text(state#>ARRAY['pools',lane]) LOOP IF NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(state->'records') x WHERE x.value->>'issueId'=ref) THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;END LOOP;
  IF pg_catalog.jsonb_typeof(p_result#>ARRAY['lanes',lane]) IS DISTINCT FROM 'array' OR pg_catalog.jsonb_array_length(p_result#>ARRAY['lanes',lane])>(CASE lane WHEN 'A' THEN 2 WHEN 'B' THEN 3 ELSE 20 END) THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
  FOR card IN SELECT value FROM pg_catalog.jsonb_array_elements(p_result#>ARRAY['lanes',lane]) LOOP
   PERFORM home_bound_v1._exact(card,ARRAY['issueId','storyId','articleVersionId','score','tier','assessmentVersion','evidenceVersion']);
   PERFORM home_bound_v1._strings(card,ARRAY['issueId','storyId','articleVersionId','tier','assessmentVersion','evidenceVersion']);
   SELECT value INTO record FROM pg_catalog.jsonb_array_elements(state->'records') WHERE value->>'issueId'=card->>'issueId';SELECT value INTO b FROM pg_catalog.jsonb_array_elements(input->'bindings') WHERE value->>'issueId'=card->>'issueId';
   IF record IS NULL OR b IS NULL OR card->'storyId' IS DISTINCT FROM record->'storyId' OR card->'score' IS DISTINCT FROM record->'score' OR card->'tier' IS DISTINCT FROM record->'tier' OR card->'articleVersionId' IS DISTINCT FROM b->'articleVersionId' OR card->'assessmentVersion' IS DISTINCT FROM b->'assessmentVersion' OR card->'evidenceVersion' IS DISTINCT FROM b->'evidenceVersion' OR lane='A' AND (record->>'role'<>'A' OR record->>'tier'<>'HIGH') OR lane='B' AND record->>'tier'<>'HIGH' THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
  END LOOP;
 END LOOP;
 IF (SELECT pg_catalog.count(*)<>pg_catalog.count(DISTINCT x.value->>'issueId') OR pg_catalog.count(*)<>pg_catalog.count(DISTINCT x.value->>'storyId') FROM pg_catalog.jsonb_each(p_result->'lanes') l CROSS JOIN LATERAL pg_catalog.jsonb_array_elements(l.value) x(value)) THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
 IF (SELECT pg_catalog.count(*)<>pg_catalog.count(DISTINCT value->>'issueId') FROM pg_catalog.jsonb_array_elements(state->'seen')) THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
 FOR record IN SELECT value FROM pg_catalog.jsonb_array_elements(state->'seen') LOOP
  PERFORM home_bound_v1._exact(record,ARRAY['issueId','publishedAt']);PERFORM home_bound_v1._id(record->>'issueId');
  IF home_bound_v1._time(record->>'publishedAt')>p_round.ranking_cutoff OR home_bound_v1._time(record->>'publishedAt')+interval '1 hour'<=p_round.ranking_cutoff THEN PERFORM home_bound_v1._fail('RESULT_INVALID');END IF;
 END LOOP;
END $$;
CREATE FUNCTION home_bound_v1.commit_round(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE principal jsonb;n uuid;effect uuid;r home_bound_v1.rounds%ROWTYPE;h home_bound_v1.heads%ROWTYPE;ns home_bound_v1.namespaces%ROWTYPE;digest text;replayed jsonb;result jsonb;canonical text;p jsonb;lane text;card record;b jsonb;checked timestamptz;local_rev bigint;answer jsonb;
BEGIN
 principal:=home_bound_v1._entry('commit_round');PERFORM home_bound_v1._budget(p_request);PERFORM home_bound_v1._canonical(p_request);PERFORM home_bound_v1._exact(p_request,ARRAY['namespaceId','effectKey','roundId','expectedHead','backendGeneration','producerRevision','inputDigest','resultCanonical']);
 n:=home_bound_v1._uuid(p_request->>'namespaceId');effect:=home_bound_v1._uuid(p_request->>'effectKey');PERFORM home_bound_v1._uuid(p_request->>'roundId');PERFORM home_bound_v1._gate(n,false);
 SELECT * INTO r FROM home_bound_v1.rounds WHERE namespace_id=n AND round_id=(p_request->>'roundId')::uuid;IF r.round_id IS NULL THEN PERFORM home_bound_v1._fail('ROUND_UNKNOWN');END IF;
 PERFORM 1 FROM home_bound_v1.heads WHERE namespace_id=n AND stream_id=r.stream_id FOR UPDATE;
 -- Fresh statements after any head wait; never a lock/read CTE.
 SELECT * INTO h FROM home_bound_v1.heads WHERE namespace_id=n AND stream_id=r.stream_id;SELECT * INTO r FROM home_bound_v1.rounds WHERE namespace_id=n AND round_id=(p_request->>'roundId')::uuid;SELECT * INTO ns FROM home_bound_v1.namespaces WHERE namespace_id=n;
 digest:=home_bound_v1._request_digest('commit_round',p_request);replayed:=home_bound_v1._replay(n,'commit_round',effect,digest,principal);IF replayed IS NOT NULL THEN RETURN replayed;END IF;
 IF p_request->'expectedHead' IS DISTINCT FROM home_bound_v1._head(n,r.stream_id) OR r.expected_head IS DISTINCT FROM p_request->'expectedHead' THEN PERFORM home_bound_v1._fail('HEAD_CONFLICT','40001');END IF;
 IF r.state<>'CAPTURED' THEN PERFORM home_bound_v1._fail('ROUND_NOT_PENDING');END IF;
 IF home_bound_v1._uuid(p_request->>'backendGeneration')<>ns.backend_generation THEN PERFORM home_bound_v1._fail('GENERATION_CONFLICT');END IF;
 IF home_bound_v1._decimal(p_request->>'producerRevision')<>r.producer_revision OR ns.input_revision<>r.producer_revision OR p_request->>'inputDigest' IS DISTINCT FROM r.input_digest OR r.profile_manifest_id<>h.active_profile_manifest_id THEN PERFORM home_bound_v1._fail('INPUT_STALE','40001');END IF;
 IF r.planned_global_revision<>h.global_revision+1 OR h.ranking_cutoff IS NOT NULL AND r.ranking_cutoff<=h.ranking_cutoff THEN PERFORM home_bound_v1._fail('HEAD_CONFLICT','40001');END IF;
 SELECT COALESCE((SELECT local_revision FROM home_bound_v1.segment_heads WHERE namespace_id=n AND stream_id=r.stream_id AND segment_key=r.segment_key),0)+1 INTO local_rev;
 IF local_rev<>r.planned_local_revision THEN PERFORM home_bound_v1._fail('HEAD_CONFLICT','40001');END IF;
 canonical:=p_request->>'resultCanonical';IF pg_catalog.jsonb_typeof(p_request->'resultCanonical') IS DISTINCT FROM 'string' OR home_bound_v1._utf16len(canonical)>65536 OR pg_catalog.octet_length(canonical)>65536 THEN PERFORM home_bound_v1._fail('RESULT_BUDGET');END IF;result:=canonical::jsonb;
 SELECT manifest INTO p FROM home_bound_v1.profiles WHERE namespace_id=n AND profile_manifest_id=r.profile_manifest_id;
 PERFORM home_bound_v1._result_shape(n,r,result,p);
 -- Last-check records graph/clock qualification, NOT physical COMMIT-time eligibility.
 SELECT home_bound_v1._qualify_round(n,r.round_id) INTO checked;
 FOREACH lane IN ARRAY ARRAY['A','B','C'] LOOP
  FOR card IN SELECT value,ordinality FROM pg_catalog.jsonb_array_elements(result#>ARRAY['lanes',lane]) WITH ORDINALITY LOOP
   SELECT binding INTO b FROM home_bound_v1.publication_bindings WHERE namespace_id=n AND article_version_id=(card.value->>'articleVersionId')::uuid;
   INSERT INTO home_bound_v1.entries VALUES(n,r.round_id,card.value->>'issueId',card.value->>'storyId',lane,card.ordinality::integer,(card.value->>'articleVersionId')::uuid,card.value->>'assessmentVersion',card.value->>'evidenceVersion',b->'graph',(card.value->>'score')::numeric,card.value->>'tier');
  END LOOP;
 END LOOP;
 UPDATE home_bound_v1.rounds SET state='COMPLETED',result_canonical=canonical,result_digest=home_bound_v1._hash(canonical),qualification_checked_at=checked WHERE namespace_id=n AND round_id=r.round_id;
 UPDATE home_bound_v1.heads SET global_revision=r.planned_global_revision,round_id=r.round_id,digest=home_bound_v1._hash(canonical),ranking_cutoff=r.ranking_cutoff WHERE namespace_id=n AND stream_id=r.stream_id;
 INSERT INTO home_bound_v1.segment_heads VALUES(n,r.stream_id,r.segment_key,r.planned_local_revision,r.round_id) ON CONFLICT(namespace_id,stream_id,segment_key) DO UPDATE SET local_revision=EXCLUDED.local_revision,round_id=EXCLUDED.round_id;
 answer:=pg_catalog.jsonb_build_object('roundId',r.round_id,'roundState','COMPLETED','head',home_bound_v1._head(n,r.stream_id),'globalRevision',r.planned_global_revision::text,'localRevision',r.planned_local_revision::text,'slotGeneration',r.slot_generation::text,'inputDigest',r.input_digest,'resultDigest',home_bound_v1._hash(canonical),'qualificationCheckedAt',home_bound_v1._stamp(checked));
 RETURN home_bound_v1._save_effect(n,'commit_round',p_request,digest,principal,answer,checked);
END $$;
CREATE FUNCTION home_bound_v1.lookup_effect(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE principal jsonb;n uuid;op text;e home_bound_v1.effects%ROWTYPE;g uuid;answer jsonb;BEGIN
 principal:=home_bound_v1._entry('lookup_effect');PERFORM home_bound_v1._budget(p_request);PERFORM home_bound_v1._exact(p_request,ARRAY['namespaceId','operation','effectKey','requestDigest','backendGeneration']);n:=home_bound_v1._uuid(p_request->>'namespaceId');op:=p_request->>'operation';
 IF NOT (CASE principal->>'componentRole' WHEN 'home_v1_fixture_writer' THEN op='fixture_apply' WHEN 'home_v1_capture_worker' THEN op='capture_round' WHEN 'home_v1_commit_worker' THEN op IN ('commit_round','discard_stale_round') ELSE false END) THEN PERFORM home_bound_v1._fail('FORBIDDEN','42501');END IF;
 SELECT backend_generation INTO g FROM home_bound_v1.namespaces WHERE namespace_id=n;
 IF g IS NULL OR g<>home_bound_v1._uuid(p_request->>'backendGeneration') THEN PERFORM home_bound_v1._fail('GENERATION_CONFLICT');END IF;
 PERFORM home_bound_v1._uuid(p_request->>'effectKey');IF COALESCE(p_request->>'requestDigest','') !~ '^[0-9a-f]{64}$' THEN PERFORM home_bound_v1._fail('INVALID_REQUEST','22023');END IF;
 SELECT * INTO e FROM home_bound_v1.effects WHERE namespace_id=n AND operation=op AND effect_key=(p_request->>'effectKey')::uuid;
 IF e.effect_key IS NULL THEN answer:=pg_catalog.jsonb_build_object('state','UNKNOWN');
 ELSE IF e.request_digest<>p_request->>'requestDigest' OR e.backend_generation<>g OR e.principal_oid::text<>principal->>'sessionUserOid' OR e.principal_name::text<>principal->>'sessionUser' THEN PERFORM home_bound_v1._fail('EFFECT_CONFLICT');END IF;answer:=pg_catalog.jsonb_build_object('state','APPLIED','receipt',e.receipt);END IF;
 RETURN home_bound_v1._envelope('lookup_effect',n,answer,principal);
END $$;
CREATE FUNCTION home_bound_v1.discard_stale_round(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE principal jsonb;n uuid;r home_bound_v1.rounds%ROWTYPE;h home_bound_v1.heads%ROWTYPE;rev bigint;digest text;replayed jsonb;effect uuid;reason text;answer jsonb;BEGIN
 principal:=home_bound_v1._entry('discard_stale_round');PERFORM home_bound_v1._budget(p_request);PERFORM home_bound_v1._canonical(p_request);PERFORM home_bound_v1._exact(p_request,ARRAY['namespaceId','effectKey','roundId','expectedHead','inputDigest','slotGeneration','reason']);
 n:=home_bound_v1._uuid(p_request->>'namespaceId');effect:=home_bound_v1._uuid(p_request->>'effectKey');PERFORM home_bound_v1._uuid(p_request->>'roundId');PERFORM home_bound_v1._gate(n,false);
 SELECT * INTO r FROM home_bound_v1.rounds WHERE namespace_id=n AND round_id=(p_request->>'roundId')::uuid;IF r.round_id IS NULL THEN PERFORM home_bound_v1._fail('ROUND_UNKNOWN');END IF;
 PERFORM 1 FROM home_bound_v1.heads WHERE namespace_id=n AND stream_id=r.stream_id FOR UPDATE;
 SELECT * INTO h FROM home_bound_v1.heads WHERE namespace_id=n AND stream_id=r.stream_id;SELECT * INTO r FROM home_bound_v1.rounds WHERE namespace_id=n AND round_id=(p_request->>'roundId')::uuid;SELECT input_revision INTO rev FROM home_bound_v1.namespaces WHERE namespace_id=n;
 digest:=home_bound_v1._request_digest('discard_stale_round',p_request);replayed:=home_bound_v1._replay(n,'discard_stale_round',effect,digest,principal);IF replayed IS NOT NULL THEN RETURN replayed;END IF;
 IF p_request->'expectedHead' IS DISTINCT FROM home_bound_v1._head(n,r.stream_id) OR p_request->>'inputDigest' IS DISTINCT FROM r.input_digest OR home_bound_v1._decimal(p_request->>'slotGeneration')<>r.slot_generation OR r.state<>'CAPTURED' THEN PERFORM home_bound_v1._fail('HEAD_CONFLICT','40001');END IF;
 reason:=p_request->>'reason';IF NOT(reason='INPUT_STALE' AND rev<>r.producer_revision OR reason='HEAD_ADVANCED' AND h.global_revision>home_bound_v1._decimal(r.expected_head->>'revision')) THEN PERFORM home_bound_v1._fail('NOT_STALE');END IF;
 UPDATE home_bound_v1.rounds SET state='SUPERSEDED' WHERE namespace_id=n AND round_id=r.round_id;
 answer:=pg_catalog.jsonb_build_object('roundId',r.round_id,'roundState','SUPERSEDED','head',home_bound_v1._head(n,r.stream_id),'globalRevision',h.global_revision::text,'localRevision',COALESCE((SELECT local_revision FROM home_bound_v1.segment_heads WHERE namespace_id=n AND stream_id=r.stream_id AND segment_key=r.segment_key),0)::text,'slotGeneration',r.slot_generation::text,'inputDigest',r.input_digest,'resultDigest',NULL,'qualificationCheckedAt',NULL);
 RETURN home_bound_v1._save_effect(n,'discard_stale_round',p_request,digest,principal,answer);
END $$;
-- Private pure policy primitive. Fixed-time tests are NOT current-time RPC evidence.
CREATE FUNCTION home_bound_v1._fallback_age_eligible(p_cutoff timestamptz,p_checked_at timestamptz) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p_cutoff IS NOT NULL AND p_checked_at IS NOT NULL AND p_cutoff<=p_checked_at AND p_checked_at-p_cutoff<=interval '15 minutes'
$$;
CREATE FUNCTION home_bound_v1.read_current_home(p_request jsonb) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE principal jsonb;n uuid;h home_bound_v1.heads%ROWTYPE;r home_bound_v1.rounds%ROWTYPE;p jsonb;cal jsonb;ctx jsonb;at timestamptz;cutoff timestamptz;answer jsonb;lanes jsonb;b jsonb;e record;lane text;eligible boolean:=true;BEGIN
 principal:=home_bound_v1._entry('read_current_home');PERFORM home_bound_v1._budget(p_request);PERFORM home_bound_v1._exact(p_request,ARRAY['namespaceId','streamId']);n:=home_bound_v1._uuid(p_request->>'namespaceId');PERFORM home_bound_v1._id(p_request->>'streamId');
 PERFORM home_bound_v1._gate(n,false);
 SELECT * INTO h FROM home_bound_v1.heads WHERE namespace_id=n AND stream_id=p_request->>'streamId';IF h.namespace_id IS NULL THEN PERFORM home_bound_v1._fail('STREAM_UNKNOWN');END IF;
 at:=pg_catalog.clock_timestamp();cutoff:=pg_catalog.date_bin(interval '5 minutes',at,'1970-01-01Z'::timestamptz);
 answer:=pg_catalog.jsonb_build_object('state','CALCULATING','checkedAt',home_bound_v1._stamp(at),'rankingCutoff',home_bound_v1._ms(cutoff),'snapshotId',NULL,'sourceCutoff',NULL,'marketBasis',NULL,'targetKrTradingDay',NULL,'lanes',pg_catalog.jsonb_build_object('A','[]'::jsonb,'B','[]'::jsonb,'C','[]'::jsonb));
 BEGIN
  SELECT manifest INTO p FROM home_bound_v1.profiles WHERE namespace_id=n AND profile_manifest_id=h.active_profile_manifest_id;cal:=home_bound_v1._calendar(n,at);
  IF home_bound_v1._time(cal->>'validUntil')<=at THEN RETURN home_bound_v1._envelope('read_current_home',n,answer,principal);END IF;ctx:=home_bound_v1._context(cal,cutoff,p);
  SELECT * INTO r FROM home_bound_v1.rounds WHERE namespace_id=n AND stream_id=h.stream_id AND state='COMPLETED' AND profile_manifest_id=h.active_profile_manifest_id AND ranking_cutoff<=cutoff AND ranking_cutoff>=at-interval '15 minutes' AND home_bound_v1._fallback_age_eligible(ranking_cutoff,at) AND result_canonical::jsonb#>>'{context,contextKey}'=ctx->>'contextKey' ORDER BY ranking_cutoff DESC LIMIT 1;
  IF r.round_id IS NULL THEN RETURN home_bound_v1._envelope('read_current_home',n,answer,principal);END IF;
  lanes:=pg_catalog.jsonb_build_object('A','[]'::jsonb,'B','[]'::jsonb,'C','[]'::jsonb);
  FOR e IN SELECT ent.* FROM home_bound_v1.entries ent WHERE ent.namespace_id=n AND ent.round_id=r.round_id ORDER BY ent.lane,ent.ordinal LOOP
   SELECT binding INTO b FROM home_bound_v1.publication_bindings WHERE namespace_id=n AND article_version_id=e.article_version_id;
   IF b IS NULL OR b->'graph' IS DISTINCT FROM e.graph OR NOT home_bound_v1._binding_current(n,b,at) THEN eligible:=false;EXIT;END IF;
   lane:=e.lane;lanes:=pg_catalog.jsonb_set(lanes,ARRAY[lane],(lanes->lane)||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('issueId',e.issue_id,'articleVersionId',e.article_version_id)));
  END LOOP;
  IF eligible THEN answer:=pg_catalog.jsonb_build_object('state',CASE WHEN r.ranking_cutoff=cutoff THEN 'FRESH' ELSE 'DELAYED' END,'checkedAt',home_bound_v1._stamp(at),'rankingCutoff',home_bound_v1._ms(cutoff),'snapshotId',r.round_id,'sourceCutoff',home_bound_v1._ms(r.ranking_cutoff),'marketBasis',ctx->'marketBasis','targetKrTradingDay',ctx->'targetKrTradingDay','lanes',lanes);END IF;
 EXCEPTION WHEN SQLSTATE 'P0001' THEN
  IF SQLERRM NOT IN ('CONTEXT_UNAVAILABLE','QUALIFICATION_HOLD') THEN RAISE;END IF;
 END;
 RETURN home_bound_v1._envelope('read_current_home',n,answer,principal);
END $$;

-- Install ownership/ACL only after every function exists. These are NOT component SET ROLE grants.
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT c.relname FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='home_bound_v1' AND c.relkind='r' LOOP
  EXECUTE pg_catalog.format('ALTER TABLE home_bound_v1.%I OWNER TO home_v1_owner',r.relname);
  EXECUTE pg_catalog.format('ALTER TABLE home_bound_v1.%I ENABLE ROW LEVEL SECURITY',r.relname);
 END LOOP;
 FOR r IN SELECT p.oid::pg_catalog.regprocedure AS signature FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='home_bound_v1' LOOP EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO home_v1_owner',r.signature);END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA home_bound_v1 FROM PUBLIC,home_v1_fixture_writer,home_v1_capture_worker,home_v1_commit_worker,home_v1_internal_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA home_bound_v1 FROM PUBLIC,home_v1_fixture_writer,home_v1_capture_worker,home_v1_commit_worker,home_v1_internal_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE home_v1_owner IN SCHEMA home_bound_v1 REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA home_bound_v1 TO home_v1_fixture_writer,home_v1_capture_worker,home_v1_commit_worker,home_v1_internal_reader;
GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system() TO home_v1_owner;
GRANT EXECUTE ON FUNCTION home_bound_v1.resource_identity(jsonb) TO home_v1_fixture_writer,home_v1_capture_worker,home_v1_commit_worker,home_v1_internal_reader;
GRANT EXECUTE ON FUNCTION home_bound_v1.fixture_apply(jsonb) TO home_v1_fixture_writer;
GRANT EXECUTE ON FUNCTION home_bound_v1.get_head(jsonb) TO home_v1_capture_worker,home_v1_commit_worker;
GRANT EXECUTE ON FUNCTION home_bound_v1.capture_round(jsonb) TO home_v1_capture_worker;
GRANT EXECUTE ON FUNCTION home_bound_v1.commit_round(jsonb),home_bound_v1.discard_stale_round(jsonb) TO home_v1_commit_worker;
GRANT EXECUTE ON FUNCTION home_bound_v1.lookup_effect(jsonb) TO home_v1_fixture_writer,home_v1_capture_worker,home_v1_commit_worker;
GRANT EXECUTE ON FUNCTION home_bound_v1.read_current_home(jsonb) TO home_v1_internal_reader,home_v1_capture_worker;
