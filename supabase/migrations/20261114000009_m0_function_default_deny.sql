begin;
-- PostgreSQL's built-in PUBLIC EXECUTE is a global default. A schema-local
-- REVOKE cannot remove that global grant. Our actual DDL owner is postgres.
-- This changes future defaults, not existing auth/storage functions or grants.
alter default privileges for role postgres revoke execute on functions from public,anon,authenticated;
commit;
