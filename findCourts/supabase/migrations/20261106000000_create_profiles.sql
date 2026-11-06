create table public.profiles (
    firebase_uid text primary key check (length(firebase_uid) between 1 and 128),
    username text not null check (username ~ '^[A-Za-z0-9_]{3,24}$'),
    created_at timestamptz not null default now()
);

-- Usernames are display labels, NOT unique login identifiers.
-- Firebase owns email/password identities. Only the verified profile function
-- accesses this table; clients cannot supply a UID to read/write another user.
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert, update on public.profiles to service_role;
