import getCourts from '../functions/get-courts/index.ts';
import worker from '../functions/enrich-court-addresses/index.ts';
import { reverseGeocodeStreet } from '../functions/_shared/providers.ts';

function assert(condition: unknown, message = 'Assertion failed'): asserts condition {
    if (!condition) throw new Error(message);
}

const bounds = { south: -32.96, north: -32.94, west: 151.74, east: 151.76 };
const tile = { id: '-330:1517', south: -33, north: -32.9, west: 151.7, east: 151.8 };
const env = {
    SUPABASE_URL: 'https://fake-project.supabase.co',
    SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_fake' }),
    SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_fake' }),
    SUPABASE_ANON_KEY: 'sb_publishable_fake',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fake',
    OVERPASS_ENABLED: 'true',
    OVERPASS_API_KEY: 'fake-overpass-credential',
    ADDRESS_ENRICHMENT_ENABLED: 'true',
    GEOAPIFY_API_KEY: 'fake-geoapify-credential',
};

async function isolated(run: () => Promise<void>, mock: typeof fetch) {
    const previous = new Map(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    const original = globalThis.fetch;
    globalThis.fetch = mock;
    try {
        await run();
    } finally {
        globalThis.fetch = original;
        for (const [key, value] of previous) {
            if (value === undefined) Deno.env.delete(key);
            else Deno.env.set(key, value);
        }
    }
}

function post(secret = false, body: unknown = bounds) {
    return new Request('https://example.test', {
        method: 'POST',
        headers: {
            apikey: secret ? 'sb_secret_fake' : 'sb_publishable_fake',
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}

type Options = {
    cached?: boolean;
    busy?: boolean;
    overpassStatus?: number;
    remark?: boolean;
    geoStatus?: number;
    job?: boolean;
    noBudget?: boolean;
};
function mockNetwork(options: Options = {}) {
    const calls: { path: string; body: Record<string, unknown> }[] = [];
    const mock: typeof fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        const requestBody = await new Request(input, init).text();
        const body = requestBody.startsWith('{') ? JSON.parse(requestBody) : {};
        calls.push({ path: url.pathname, body });
        if (url.hostname === 'api.overpass.ch') {
            return Response.json(
                options.remark ? { elements: [], remark: 'runtime error with fake-overpass-credential' } : {
                    elements: [{
                        type: 'node',
                        id: 1,
                        lat: -32.95,
                        lon: 151.75,
                        tags: { sport: 'tennis', 'addr:state': 'NSW' },
                    }],
                },
                { status: options.overpassStatus ?? 200 },
            );
        }
        if (url.hostname === 'api.geoapify.com') {
            return Response.json({
                features: [{
                    properties: {
                        street: 'Test Road',
                        formatted: 'Test Road, Newcastle',
                        distance: 15,
                    },
                }],
            }, { status: options.geoStatus ?? 200 });
        }
        const name = url.pathname.split('/').at(-1);
        const data: Record<string, unknown> = {
            court_cache_tiles: options.cached ? [{ tile_id: tile.id, data_version: 2 }] : [],
            courts: [{ id: 'osm-node-1', address: null, address_status: 'pending' }],
            claim_court_discovery_tiles: options.busy ? [] : [tile],
            reserve_court_provider_request: !options.noBudget,
            store_discovered_courts: 1,
            release_court_provider: null,
            acquire_court_provider: !options.busy,
            claim_court_address_job: options.job
                ? [{ id: 'osm-node-1', latitude: -32.95, longitude: 151.75 }]
                : [],
            finish_court_address_job: true,
            release_court_address_jobs: null,
        };
        assert(name && name in data, `Unexpected request ${url.pathname}`);
        if (name === 'finish_court_address_job') options.job = false;
        return Response.json(data[name]);
    };
    return { calls, mock };
}

Deno.test('new tile saves partial addresses as pending without calling Geoapify', async () => {
    const { calls, mock } = mockNetwork();
    await isolated(async () => {
        const response = await getCourts.fetch(post());
        const body = await response.json();
        assert(response.status === 200 && body.cache.fetchedTiles === 1);
        assert(!calls.some((c) => c.path.includes('geocode')));
        const rows = calls.find((c) => c.path.endsWith('store_discovered_courts'))?.body
            .discovered_courts as { address_status: string }[];
        assert(rows?.[0].address_status === 'pending');
    }, mock);
});

Deno.test('cached, disabled, busy and budget-limited discovery spend no provider requests', async () => {
    for (const mode of ['cached', 'disabled', 'busy', 'budget']) {
        const { calls, mock } = mockNetwork({
            cached: mode === 'cached',
            busy: mode === 'busy',
            noBudget: mode === 'budget',
        });
        await isolated(async () => {
            if (mode === 'disabled') Deno.env.set('OVERPASS_ENABLED', 'false');
            const result = await (await getCourts.fetch(post())).json();
            assert(result.cache.fetchedTiles === 0);
            assert(!calls.some((c) => c.path.includes('/interpreter')));
        }, mock);
    }
});

Deno.test('provider HTTP errors and partial HTTP 200 results never mark coverage or expose keys', async () => {
    for (const options of [{ overpassStatus: 503 }, { remark: true }]) {
        const { calls, mock } = mockNetwork(options);
        await isolated(async () => {
            const response = await getCourts.fetch(post());
            const result = await response.text();
            assert(response.status === 200 && !result.includes(env.OVERPASS_API_KEY));
            assert(!calls.some((c) => c.path.endsWith('store_discovered_courts')));
            assert(
                calls.some((c) =>
                    c.path.endsWith('release_court_provider') && c.body.cooldown_seconds === 900
                ),
            );
        }, mock);
    }
});

Deno.test('worker rejects mobile keys and leaves jobs pending when disabled or missing a key', async () => {
    const { calls, mock } = mockNetwork();
    await isolated(async () => {
        assert((await worker.fetch(post())).status === 401);
        Deno.env.set('ADDRESS_ENRICHMENT_ENABLED', 'false');
        assert((await (await worker.fetch(post(true))).json()).status === 'disabled');
        Deno.env.set('ADDRESS_ENRICHMENT_ENABLED', 'true');
        Deno.env.delete('GEOAPIFY_API_KEY');
        assert((await (await worker.fetch(post(true))).json()).status === 'unconfigured');
        assert(calls.length === 0);
    }, mock);
});

Deno.test('Geoapify 429 records retry, stops the batch, and releases the shared lease', async () => {
    const { calls, mock } = mockNetwork({ job: true, geoStatus: 429 });
    await isolated(async () => {
        const response = await worker.fetch(post(true));
        const body = await response.json();
        assert(response.status === 200 && body.processed === 1 && body.status === 'provider-paused');
        assert(
            calls.some((c) =>
                c.path.endsWith('finish_court_address_job') && c.body.result_status === 'retry'
            ),
        );
        assert(
            calls.some((c) => c.path.endsWith('release_court_provider') && c.body.cooldown_seconds === 86400),
        );
    }, mock);
});

Deno.test('worker saves a successful approximate address and stops when the queue is empty', async () => {
    const { calls, mock } = mockNetwork({ job: true });
    await isolated(async () => {
        const body = await (await worker.fetch(post(true))).json();
        assert(body.processed === 1 && body.completed === 1);
        assert(calls.some((c) =>
            c.path.endsWith('finish_court_address_job') &&
            c.body.result_status === 'complete' && c.body.result_address === 'Near Test Road, Newcastle'
        ));
        assert(calls.filter((c) => c.path.includes('geocode')).length === 1);
    }, mock);
});

Deno.test('reverse geocoding requires a nearby street and sanitizes network exceptions', async () => {
    for (const distance of [10, 500]) {
        await isolated(async () => {
            const result = await reverseGeocodeStreet(-32.95, 151.75, env.GEOAPIFY_API_KEY);
            assert(distance === 10 ? result === 'Near Test Road' : result === null);
        }, () =>
            Promise.resolve(Response.json({
                features: [{
                    properties: {
                        street: 'Test Road',
                        formatted: 'Test Road',
                        distance,
                    },
                }],
            })));
    }
    await isolated(async () => {
        try {
            await reverseGeocodeStreet(0, 0, env.GEOAPIFY_API_KEY);
            throw new Error('Expected failure');
        } catch (error) {
            assert(error instanceof Error && !error.message.includes(env.GEOAPIFY_API_KEY));
        }
    }, () => {
        throw new Error(`Fetch failed: ${env.GEOAPIFY_API_KEY}`);
    });
});
