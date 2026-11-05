-- Address work is independent of tile coverage. Existing strings remain visible
-- while legacy rows receive one street lookup (their original quality is unknown).
alter table public.courts
    add column address_source text check (address_source in ('osm', 'geoapify', 'legacy')),
    add column address_status text not null default 'pending'
        check (address_status in ('pending', 'complete', 'retry', 'unavailable')),
    add column address_attempted_at timestamptz,
    add column address_retry_after timestamptz not null default now(),
    add column address_claim_token uuid,
    add column address_claim_until timestamptz;

update public.courts set address_source = 'legacy' where nullif(trim(address), '') is not null;

create index courts_address_queue_idx on public.courts (address_retry_after, id)
    where address_status <> 'complete';

-- Shared by all Edge workers. Token fencing prevents an expired worker from
-- releasing another worker's lease or writing its results.
create table public.court_provider_state (
    provider text primary key check (provider in ('overpass', 'geoapify')),
    lease_token uuid,
    lease_until timestamptz not null default '-infinity',
    available_after timestamptz not null default '-infinity',
    next_request_at timestamptz not null default '-infinity',
    usage_day date not null default (now() at time zone 'UTC')::date,
    requests_today integer not null default 0,
    daily_limit integer not null check (daily_limit > 0),
    request_spacing_ms integer not null check (request_spacing_ms >= 1000)
);
insert into public.court_provider_state (provider, daily_limit, request_spacing_ms)
values ('overpass', 250, 3000), ('geoapify', 2000, 1100);

alter table public.court_provider_state enable row level security;
revoke all on public.court_provider_state from public, anon, authenticated;
grant all on public.court_provider_state to service_role;

create function public.acquire_court_provider(provider_name text, worker_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
    update public.court_provider_state
    set lease_token = worker_token, lease_until = now() + interval '75 seconds'
    where provider = provider_name and worker_token is not null
      and lease_until <= now() and available_after <= now()
      and (usage_day < (now() at time zone 'UTC')::date or requests_today < daily_limit);
    return found;
end;
$$;

create function public.reserve_court_provider_request(provider_name text, worker_token uuid)
returns boolean language plpgsql security definer set search_path = public as $$
begin
    update public.court_provider_state
    set usage_day = (now() at time zone 'UTC')::date,
        requests_today = case when usage_day < (now() at time zone 'UTC')::date
            then 1 else requests_today + 1 end,
        next_request_at = now() + request_spacing_ms * interval '1 millisecond'
    where provider = provider_name and lease_token = worker_token and lease_until > now()
      and available_after <= now() and next_request_at <= now()
      and (usage_day < (now() at time zone 'UTC')::date or requests_today < daily_limit);
    return found;
end;
$$;

create function public.release_court_provider(
    provider_name text, worker_token uuid, cooldown_seconds integer default 3
)
returns void language sql security definer set search_path = public as $$
    update public.court_provider_state
    set lease_token = null, lease_until = '-infinity',
        available_after = greatest(available_after, now() + make_interval(secs =>
            least(greatest(cooldown_seconds, 0), 86400)))
    where provider = provider_name and lease_token = worker_token;
$$;

create function public.claim_court_discovery_tiles(
    requested_tiles jsonb, required_data_version integer, worker_token uuid
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare claimed jsonb;
begin
    if jsonb_typeof(requested_tiles) <> 'array' or jsonb_array_length(requested_tiles) > 25 then
        raise exception 'Invalid tile batch';
    end if;
    -- The shared provider lease serializes all discovery, including overlapping
    -- tile sets. Recheck cache only after acquiring it.
    if not public.acquire_court_provider('overpass', worker_token) then return '[]'::jsonb; end if;
    select coalesce(jsonb_agg(tile), '[]'::jsonb) into claimed
    from jsonb_array_elements(requested_tiles) tile
    where not exists (
        select 1 from public.court_cache_tiles c
        where c.tile_id = tile->>'id' and c.data_version >= required_data_version
    );
    if jsonb_array_length(claimed) = 0 then
        perform public.release_court_provider('overpass', worker_token, 0);
    end if;
    return claimed;
end;
$$;

create function public.store_discovered_courts(
    discovered_courts jsonb, claimed_tiles jsonb, required_data_version integer, worker_token uuid
)
returns integer language plpgsql security definer set search_path = public as $$
declare saved_tiles integer;
begin
    perform 1 from public.court_provider_state
    where provider = 'overpass' and lease_token = worker_token and lease_until > now()
    for update;
    if not found then raise exception 'Discovery lease expired'; end if;

    insert into public.courts as existing (
        id, osm_type, osm_id, name, sport, latitude, longitude, address, address_source,
        address_status, website, source, last_seen_at
    )
    select c.id, c.osm_type, c.osm_id, c.name, c.sport, c.latitude, c.longitude, c.address,
        c.address_source, c.address_status, c.website, 'osm', now()
    from jsonb_to_recordset(discovered_courts) as c(
        id text, osm_type text, osm_id bigint, name text, sport text,
        latitude double precision, longitude double precision, address text,
        address_source text, address_status text, website text
    )
    on conflict (id) do update set
        name = excluded.name, sport = excluded.sport, latitude = excluded.latitude,
        longitude = excluded.longitude, last_seen_at = now(),
        website = coalesce(excluded.website, existing.website),
        -- Never replace a saved complete address with partial OSM data.
        address = case when excluded.address_status = 'complete' then excluded.address
            else coalesce(existing.address, excluded.address) end,
        address_source = case when excluded.address_status = 'complete' then excluded.address_source
            else coalesce(existing.address_source, excluded.address_source) end,
        address_status = case when excluded.address_status = 'complete' then 'complete'
            else existing.address_status end,
        address_claim_token = case when excluded.address_status = 'complete' then null
            else existing.address_claim_token end,
        address_claim_until = case when excluded.address_status = 'complete' then null
            else existing.address_claim_until end;

    -- Court writes and coverage commit together, including legitimate empty tiles.
    insert into public.court_cache_tiles (tile_id, south, west, north, east, fetched_at, data_version)
    select t.id, t.south, t.west, t.north, t.east, now(), required_data_version
    from jsonb_to_recordset(claimed_tiles) as t(
        id text, south double precision, west double precision, north double precision, east double precision
    )
    on conflict (tile_id) do update set fetched_at = now(), data_version = excluded.data_version;
    get diagnostics saved_tiles = row_count;
    return saved_tiles;
end;
$$;

create function public.claim_court_address_job(worker_token uuid)
returns table(id text, latitude double precision, longitude double precision)
language sql security definer set search_path = public as $$
    with eligible as (
        select c.id from public.courts c
        where c.address_status <> 'complete' and c.address_retry_after <= now()
          and (c.address_claim_until is null or c.address_claim_until <= now())
          and exists (select 1 from public.court_provider_state p where p.provider = 'geoapify'
              and p.lease_token = worker_token and p.lease_until > now())
        order by (nullif(trim(c.address), '') is null) desc, c.address_retry_after, c.id
        for update of c skip locked limit 1
    )
    update public.courts c
    set address_claim_token = worker_token, address_claim_until = now() + interval '75 seconds',
        address_attempted_at = now()
    from eligible where c.id = eligible.id
    returning c.id, c.latitude, c.longitude;
$$;

create function public.finish_court_address_job(
    court_id text, worker_token uuid, result_status text, result_address text default null
)
returns boolean language plpgsql security definer set search_path = public as $$
begin
    if result_status not in ('complete', 'retry', 'unavailable') then
        raise exception 'Invalid address status';
    end if;
    if result_status = 'complete' and nullif(trim(result_address), '') is null then
        raise exception 'Address required';
    end if;
    update public.courts c set
        address = case when result_status = 'complete' then result_address else c.address end,
        address_source = case when result_status = 'complete' then 'geoapify' else c.address_source end,
        address_status = result_status,
        address_retry_after = now() + case when result_status = 'unavailable' then interval '30 days'
            else interval '24 hours' end,
        address_claim_token = null, address_claim_until = null
    where c.id = court_id and c.address_claim_token = worker_token and c.address_claim_until > now()
      and c.address_status <> 'complete'
      and exists (select 1 from public.court_provider_state p where p.provider = 'geoapify'
          and p.lease_token = worker_token and p.lease_until > now());
    return found;
end;
$$;

create function public.release_court_address_jobs(worker_token uuid)
returns void language sql security definer set search_path = public as $$
    update public.courts set address_claim_token = null, address_claim_until = null
    where address_claim_token = worker_token;
$$;

-- No public mobile key can claim jobs, change budgets, or write provider results.
revoke all on function public.acquire_court_provider(text, uuid) from public, anon, authenticated;
revoke all on function public.reserve_court_provider_request(text, uuid) from public, anon, authenticated;
revoke all on function public.release_court_provider(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.claim_court_discovery_tiles(jsonb, integer, uuid) from public, anon, authenticated;
revoke all on function public.store_discovered_courts(jsonb, jsonb, integer, uuid) from public, anon, authenticated;
revoke all on function public.claim_court_address_job(uuid) from public, anon, authenticated;
revoke all on function public.finish_court_address_job(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.release_court_address_jobs(uuid) from public, anon, authenticated;
grant execute on function public.acquire_court_provider(text, uuid) to service_role;
grant execute on function public.reserve_court_provider_request(text, uuid) to service_role;
grant execute on function public.release_court_provider(text, uuid, integer) to service_role;
grant execute on function public.claim_court_discovery_tiles(jsonb, integer, uuid) to service_role;
grant execute on function public.store_discovered_courts(jsonb, jsonb, integer, uuid) to service_role;
grant execute on function public.claim_court_address_job(uuid) to service_role;
grant execute on function public.finish_court_address_job(text, uuid, text, text) to service_role;
grant execute on function public.release_court_address_jobs(uuid) to service_role;
