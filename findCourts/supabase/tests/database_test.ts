import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

function assert(condition: unknown, message: string): asserts condition {
    if (!condition) throw new Error(message);
}

const first = '00000000-0000-0000-0000-000000000001';
const second = '00000000-0000-0000-0000-000000000002';
const tiles = [{ id: '-330:1517', south: -33, north: -32.9, west: 151.7, east: 151.8 }];
const court = {
    id: 'osm-node-1',
    osm_type: 'node',
    osm_id: 1,
    name: 'Test court',
    sport: 'tennis',
    latitude: -32.95,
    longitude: 151.75,
    address: 'NSW',
    address_source: 'osm',
    address_status: 'pending',
};

Deno.test('PostgreSQL migration: exclusive leases, atomic saves, retries, budgets, and stale workers', async () => {
    const db = new PGlite();
    try {
        await db.exec('create role anon; create role authenticated; create role service_role;');
        await db.exec(
            await Deno.readTextFile(
                new URL('../migrations/20261019000000_create_court_cache.sql', import.meta.url),
            ),
        );
        await db.exec(
            'alter table public.court_cache_tiles add column data_version integer not null default 1;',
        );
        await db.exec(
            "insert into public.courts(id, osm_type, osm_id, sport, latitude, longitude, address) values ('legacy', 'node', 100, 'tennis', 0, 0, 'Old address');",
        );
        await db.exec(
            await Deno.readTextFile(
                new URL('../migrations/20261104000000_queue_court_address_enrichment.sql', import.meta.url),
            ),
        );
        const scalar = async (query: string, params: unknown[] = []) => {
            const result = await db.query<Record<string, unknown>>(query, params);
            return Object.values(result.rows[0])[0];
        };
        const claim = (token: string) =>
            scalar('select public.claim_court_discovery_tiles($1::jsonb, 2, $2::uuid)', [
                JSON.stringify(tiles),
                token,
            ]);
        assert(
            await scalar(
                "select address = 'Old address' and address_source = 'legacy' and address_status = 'pending' from public.courts where id = 'legacy'",
            ) === true,
            'Migration preserves and queues legacy addresses',
        );
        await db.exec("update public.courts set address_status = 'complete' where id = 'legacy';");
        assert((await claim(first) as unknown[]).length === 1, 'First discovery must claim tile');
        assert((await claim(second) as unknown[]).length === 0, 'Overlapping discovery must be excluded');
        assert(
            await scalar("select public.reserve_court_provider_request('overpass', $1::uuid)", [first]) ===
                true,
            'Reserve budget',
        );
        assert(
            await scalar('select public.store_discovered_courts($1::jsonb, $2::jsonb, 2, $3::uuid)', [
                JSON.stringify([court]),
                JSON.stringify(tiles),
                first,
            ]) === 1,
            'Commit coverage with court',
        );
        assert(
            await scalar("select address_status from public.courts where id = 'osm-node-1'") === 'pending',
            'Partial address stays queued',
        );
        await scalar("select public.release_court_provider('overpass', $1::uuid, 0)", [first]);
        assert((await claim(second) as unknown[]).length === 0, 'Cached tile must never be claimed again');

        assert(
            await scalar("select public.acquire_court_provider('geoapify', $1::uuid)", [first]) === true,
            'Acquire worker',
        );
        const jobs = await db.query('select * from public.claim_court_address_job($1::uuid)', [first]);
        assert(jobs.rows.length === 1, 'Claim pending court');
        assert(
            (await db.query('select * from public.claim_court_address_job($1::uuid)', [first])).rows
                .length === 0,
            'Do not double claim',
        );
        assert(
            await scalar(
                "select public.finish_court_address_job('osm-node-1', $1::uuid, 'complete', 'Near Test Road')",
                [second],
            ) === false,
            'Wrong owner cannot finish',
        );
        assert(
            await scalar("select public.finish_court_address_job('osm-node-1', $1::uuid, 'retry')", [
                first,
            ]) === true,
            'Record failure',
        );
        assert(
            (await db.query('select * from public.claim_court_address_job($1::uuid)', [first])).rows
                .length === 0,
            'Retry cooldown enforced',
        );
        assert(
            await scalar("select address from public.courts where id = 'osm-node-1'") === 'NSW',
            'Failure preserves display address',
        );

        await db.exec("update public.courts set address_retry_after = now() - interval '1 second';");
        await db.query('select * from public.claim_court_address_job($1::uuid)', [first]);
        await scalar("select public.finish_court_address_job('osm-node-1', $1::uuid, 'unavailable')", [
            first,
        ]);
        assert(
            await scalar(
                "select address_retry_after > now() + interval '29 days' from public.courts where id = 'osm-node-1'",
            ) === true,
            'No result retries after 30 days',
        );
        await db.exec("update public.courts set address_retry_after = now() - interval '1 second';");
        await db.query('select * from public.claim_court_address_job($1::uuid)', [first]);
        await scalar(
            "select public.finish_court_address_job('osm-node-1', $1::uuid, 'complete', 'Near Test Road')",
            [first],
        );
        assert(
            (await db.query('select * from public.claim_court_address_job($1::uuid)', [first])).rows
                .length === 0,
            'Complete jobs do not requeue',
        );

        // Rediscovery of a neighbouring tile can include an already enriched court.
        await scalar("select public.acquire_court_provider('overpass', $1::uuid)", [first]);
        await scalar('select public.store_discovered_courts($1::jsonb, $2::jsonb, 2, $3::uuid)', [
            JSON.stringify([court]),
            JSON.stringify(tiles),
            first,
        ]);
        assert(
            await scalar("select address from public.courts where id = 'osm-node-1'") === 'Near Test Road',
            'Partial rediscovery must preserve Geoapify address',
        );

        // A failed transactional write must not create a coverage row.
        const invalid = { ...court, id: 'osm-node-2', osm_id: 2, latitude: 100 };
        const newTile = [{ ...tiles[0], id: 'new-tile' }];
        let failed = false;
        try {
            await scalar('select public.store_discovered_courts($1::jsonb, $2::jsonb, 2, $3::uuid)', [
                JSON.stringify([invalid]),
                JSON.stringify(newTile),
                first,
            ]);
        } catch {
            failed = true;
        }
        assert(failed, 'Invalid court must fail');
        assert(
            await scalar(
                "select count(*)::integer from public.court_cache_tiles where tile_id = 'new-tile'",
            ) === 0,
            'Failed court write must not cache tile',
        );

        // Expired owner cannot release or write after a replacement has acquired.
        await db.exec(
            "update public.court_provider_state set lease_until = now() - interval '1 second' where provider = 'geoapify';",
        );
        assert(
            await scalar("select public.acquire_court_provider('geoapify', $1::uuid)", [second]) === true,
            'Expired worker is reclaimable',
        );
        await scalar("select public.release_court_provider('geoapify', $1::uuid, 0)", [first]);
        assert(
            await scalar(
                "select lease_token::text from public.court_provider_state where provider = 'geoapify'",
            ) === second,
            'Old token cannot release new lease',
        );
        assert(
            await scalar("select public.reserve_court_provider_request('geoapify', $1::uuid)", [first]) ===
                false,
            'Old token cannot spend quota',
        );
        await db.exec(
            "update public.court_provider_state set requests_today = daily_limit where provider = 'geoapify';",
        );
        assert(
            await scalar("select public.reserve_court_provider_request('geoapify', $1::uuid)", [second]) ===
                false,
            'Daily cap must hold',
        );
        await db.exec(
            "update public.court_provider_state set usage_day = current_date - 1 where provider = 'geoapify';",
        );
        assert(
            await scalar("select public.reserve_court_provider_request('geoapify', $1::uuid)", [second]) ===
                true,
            'New UTC day resets cap',
        );
        assert(
            await scalar("select public.reserve_court_provider_request('geoapify', $1::uuid)", [second]) ===
                false,
            'Shared request spacing holds',
        );
        assert(
            await scalar(
                "select has_function_privilege('anon', 'public.acquire_court_provider(text,uuid)', 'execute')",
            ) === false,
            'Public role must not execute jobs',
        );

        // Court claims also expire after a crashed worker, not only provider locks.
        await db.exec(
            "update public.courts set address_status = 'pending', address_retry_after = now(), address_claim_token = '00000000-0000-0000-0000-000000000001', address_claim_until = now() - interval '1 second' where id = 'osm-node-1';",
        );
        assert(
            (await db.query('select * from public.claim_court_address_job($1::uuid)', [second])).rows
                .length === 1,
            'Expired job claim is recoverable',
        );
        assert(
            await scalar(
                "select public.finish_court_address_job('osm-node-1', $1::uuid, 'complete', 'Stale address')",
                [first],
            ) === false,
            'Stale court worker cannot overwrite a new claim',
        );
    } finally {
        await db.close();
    }
});

Deno.test('scheduled SQL queues no HTTP request until both Vault credentials exist', async () => {
    const db = new PGlite();
    try {
        // Stub platform-only extensions; execute the exact scheduled SQL against PostgreSQL.
        await db.exec(`
            create schema cron; create schema net; create schema vault;
            create table cron.job (jobname text, schedule text, command text);
            create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
            create table net.requests (url text, headers jsonb, body jsonb, timeout_ms integer);
            create function cron.schedule(jobname text, schedule text, command text) returns bigint
            language sql as 'insert into cron.job values (jobname,schedule,command); select 1::bigint;';
            create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer)
            returns bigint language sql as 'insert into net.requests values (url,headers,body,timeout_milliseconds); select 1::bigint;';
        `);
        const migration = await Deno.readTextFile(
            new URL('../migrations/20261104010000_schedule_court_address_enrichment.sql', import.meta.url),
        );
        await db.exec(migration.replace(/^create extension.*;$/gm, ''));
        const schedule =
            (await db.query<{ command: string }>('select command from cron.job')).rows[0].command;
        await db.exec(schedule);
        assert(
            (await db.query('select * from net.requests')).rows.length === 0,
            'No secrets must mean no request',
        );
        await db.exec(
            "insert into vault.decrypted_secrets values ('court_project_url', 'https://test.supabase.co/');",
        );
        await db.exec(schedule);
        assert(
            (await db.query('select * from net.requests')).rows.length === 0,
            'One secret must mean no request',
        );
        await db.exec(
            "insert into vault.decrypted_secrets values ('court_worker_secret_key', 'sb_secret_fake');",
        );
        await db.exec(schedule);
        const rows = (await db.query<{ url: string; headers: { apikey: string }; timeout_ms: number }>(
            'select * from net.requests',
        )).rows;
        assert(
            rows.length === 1 &&
                rows[0].url === 'https://test.supabase.co/functions/v1/enrich-court-addresses' &&
                rows[0].headers.apikey === 'sb_secret_fake' && rows[0].timeout_ms === 60000,
            'Cron must invoke correct worker with server credentials',
        );
    } finally {
        await db.close();
    }
});
