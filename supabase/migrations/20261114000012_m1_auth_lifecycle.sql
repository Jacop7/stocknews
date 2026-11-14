begin;
-- Auth logout/deletion must be able to remove its own sessions/users. Private grants stay denied.
alter table private.admin_memberships drop constraint admin_memberships_user_id_fkey;
alter table private.admin_memberships add foreign key(user_id) references auth.users(id) on delete cascade;
alter table private.admin_sessions drop constraint admin_sessions_user_id_fkey;
alter table private.admin_sessions add foreign key(user_id) references auth.users(id) on delete cascade;
alter table private.admin_sessions drop constraint admin_sessions_auth_session_id_fkey;
alter table private.admin_sessions add foreign key(auth_session_id) references auth.sessions(id) on delete cascade;
notify pgrst,'reload schema';
commit;
