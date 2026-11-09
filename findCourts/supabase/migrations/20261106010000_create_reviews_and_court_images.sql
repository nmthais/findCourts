create table public.reviews (
    id uuid primary key default gen_random_uuid(),
    court_id text not null references public.courts(id) on delete cascade,
    firebase_uid text not null references public.profiles(firebase_uid) on delete cascade,
    rating smallint not null check (rating between 1 and 5),
    comment text check (comment is null or length(comment) between 1 and 2000),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (court_id, firebase_uid)
);

create index reviews_court_created_idx
    on public.reviews (court_id, created_at desc);

create index reviews_user_idx
    on public.reviews (firebase_uid);

create table public.court_images (
    id uuid primary key default gen_random_uuid(),
    court_id text not null references public.courts(id) on delete cascade,
    uploaded_by_firebase_uid text not null references public.profiles(firebase_uid) on delete cascade,
    cloudinary_public_id text not null unique check (length(cloudinary_public_id) between 1 and 255),
    cloudinary_secure_url text not null check (
        length(cloudinary_secure_url) <= 2048
        and cloudinary_secure_url like 'https://%'
    ),
    created_at timestamptz not null default now()
);

create index court_images_court_created_idx
    on public.court_images (court_id, created_at desc);

create index court_images_uploader_idx
    on public.court_images (uploaded_by_firebase_uid);

-- Firebase identities are verified by Edge Functions. App clients cannot
-- bypass those functions to impersonate another reviewer or image uploader.
alter table public.reviews enable row level security;
alter table public.court_images enable row level security;

revoke all on public.reviews from anon, authenticated;
revoke all on public.court_images from anon, authenticated;

grant select, insert, update, delete on public.reviews to service_role;
grant select, insert, update, delete on public.court_images to service_role;
