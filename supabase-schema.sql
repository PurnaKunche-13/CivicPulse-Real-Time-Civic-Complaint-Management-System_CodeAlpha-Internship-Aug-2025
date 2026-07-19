create table if not exists public.users (
    id uuid primary key references auth.users(id) on delete cascade,
    username text not null,
    email text unique,
    avatar_url text,
    telegram_chat_id text,
    created_at timestamptz not null default now()
);

create table if not exists public.problems (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    description text not null,
    location text,
    image_path text,
    status text not null default 'pending' check (status in ('pending', 'processing', 'completed')),
    posted_by uuid not null references public.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    processing_at timestamptz,
    completed_at timestamptz
);

create table if not exists public.admins (
    id uuid primary key default gen_random_uuid(),
    username text unique not null,
    password text not null,
    created_at timestamptz not null default now()
);

insert into public.admins (username, password)
values ('admin', 'admin123')
on conflict (username) do nothing;
