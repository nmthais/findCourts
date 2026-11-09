import { createSupabaseContext } from 'npm:@supabase/server@1';
import { ProviderError } from '../_shared/providers.ts';

type Bounds = { south: number; west: number; north: number; east: number };
type Tile = Bounds & { id: string };
type OverpassElement = {
    type: 'node' | 'way' | 'relation';
    id: number;
    lat?: number;
    lon?: number;
    center?: { lat: number; lon: number };
    tags?: Record<string, string>;
};

const TILE_SIZE_DEGREES = 0.1;
const MAX_TILES_PER_REQUEST = 25;
const COURT_DATA_VERSION = 2;
const OVERPASS_REQUEST_TIMEOUT_MS = 25_000;
const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers: corsHeaders });
}

function isValidBounds(value: unknown): value is Bounds {
    if (!value || typeof value !== 'object') return false;
    const b = value as Record<string, unknown>;
    return [b.south, b.west, b.north, b.east].every(
        (n) => typeof n === 'number' && Number.isFinite(n),
    ) && (b.south as number) >= -90 && (b.north as number) <= 90 &&
        (b.west as number) >= -180 && (b.east as number) <= 180 &&
        (b.south as number) < (b.north as number) &&
        (b.west as number) < (b.east as number);
}

function tilesForBounds(bounds: Bounds): Tile[] {
    // Exclude the next tile when the north/east edge falls exactly on a tile boundary.
    const south = Math.floor(bounds.south / TILE_SIZE_DEGREES);
    const north = Math.ceil(bounds.north / TILE_SIZE_DEGREES) - 1;
    const west = Math.floor(bounds.west / TILE_SIZE_DEGREES);
    const east = Math.ceil(bounds.east / TILE_SIZE_DEGREES) - 1;
    // Reject large requests before constructing the array.
    if ((north - south + 1) * (east - west + 1) > MAX_TILES_PER_REQUEST) return [];
    const tiles: Tile[] = [];
    for (let y = south; y <= north; y += 1) {
        for (let x = west; x <= east; x += 1) {
            tiles.push({
                id: `${y}:${x}`,
                south: y * TILE_SIZE_DEGREES,
                west: x * TILE_SIZE_DEGREES,
                north: (y + 1) * TILE_SIZE_DEGREES,
                east: (x + 1) * TILE_SIZE_DEGREES,
            });
        }
    }
    return tiles;
}

function courtOverpassQuery(tiles: Tile[]) {
    const clauses = tiles.flatMap((tile) => {
        const box = `${tile.south},${tile.west},${tile.north},${tile.east}`;
        return ['tennis', 'badminton', 'pickleball'].map(
            (sport) => `nwr["sport"="${sport}"](${box});`,
        );
    });
    return `[out:json][timeout:20]; (${clauses.join('\n')}); out center tags;`;
}

function courtsFromOverpass(elements: OverpassElement[]) {
    const supported = new Set(['tennis', 'badminton', 'pickleball']);
    const courts = elements.flatMap((element) => {
        const tags = element.tags ?? {};
        const point = element.type === 'node' ? element : element.center;
        if (
            !point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon) ||
            !supported.has(tags.sport ?? '')
        ) return [];
        const hasStreet = Boolean(tags['addr:street']?.trim());
        const address = [
            [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
            tags['addr:suburb'],
            tags['addr:city'],
            tags['addr:state'],
            tags['addr:postcode'],
        ].filter(Boolean).join(', ') || null;
        return [{
            id: `osm-${element.type}-${element.id}`,
            osm_type: element.type,
            osm_id: element.id,
            name: tags.name || 'Unnamed court',
            sport: tags.sport,
            latitude: point.lat,
            longitude: point.lon,
            address,
            address_source: address ? 'osm' : null,
            address_status: hasStreet ? 'complete' : 'pending',
            website: tags.website || null,
            source: 'osm',
            verified: false,
            last_seen_at: new Date().toISOString(),
        }];
    });
    return [...new Map(courts.map((court) => [court.id, court])).values()];
}

async function fetchOverpass(tiles: Tile[], apiKey: string) {
    let response: Response;
    try {
        response = await fetch(`https://api.overpass.ch/v1/${encodeURIComponent(apiKey)}/interpreter`, {
            method: 'POST',
            headers: {
                Accept: 'application/json',
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
                'User-Agent': 'FindCourts/1.0 (student project)',
            },
            body: new URLSearchParams({ data: courtOverpassQuery(tiles) }),
            signal: AbortSignal.timeout(OVERPASS_REQUEST_TIMEOUT_MS),
        });
    } catch {
        // Fetch exceptions can include the credential-bearing URL.
        throw new ProviderError('Overpass request timed out or failed.', 900);
    }
    if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderError(
            `Overpass returned HTTP ${response.status}.`,
            response.status === 429 ? 3600 : 900,
        );
    }
    try {
        const body = await response.json() as { elements?: OverpassElement[]; remark?: string };
        // Overpass can return partial results and a runtime error with HTTP 200.
        if (body.remark || !Array.isArray(body.elements)) throw new Error();
        return courtsFromOverpass(body.elements);
    } catch {
        throw new ProviderError('Overpass returned an incomplete or invalid result.', 900);
    }
}

export default {
    async fetch(request: Request) {
        if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
        if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
        try {
            const { data: context, error: authError } = await createSupabaseContext(request, {
                auth: 'publishable',
            });
            if (authError || !context) return json({ error: 'Unauthorized.' }, authError?.status ?? 401);
            const bounds: unknown = await request.json().catch(() => null);
            if (!isValidBounds(bounds)) return json({ error: 'A valid bounding box is required.' }, 400);
            const tiles = tilesForBounds(bounds);
            if (tiles.length === 0) {
                return json(
                    { error: `Requested area is too large; maximum ${MAX_TILES_PER_REQUEST} tiles.` },
                    400,
                );
            }

            const db = context.supabaseAdmin;
            const { data: cached, error: cacheError } = await db.from('court_cache_tiles')
                .select('tile_id, data_version').in('tile_id', tiles.map((tile) => tile.id));
            if (cacheError) throw cacheError;
            const stored = new Set(
                (cached ?? []).filter((row) => row.data_version >= COURT_DATA_VERSION)
                    .map((row) => row.tile_id),
            );
            const missing = tiles.filter((tile) => !stored.has(tile.id));
            const enabled = Deno.env.get('OVERPASS_ENABLED') === 'true';
            const apiKey = Deno.env.get('OVERPASS_API_KEY');
            let fetchedTiles = 0;
            let discoveryStatus = missing.length === 0 ? 'cached' : 'disabled';

            if (enabled && apiKey && missing.length > 0) {
                const token = crypto.randomUUID();
                let cooldown = 3;
                try {
                    const { data: claimed, error } = await db.rpc('claim_court_discovery_tiles', {
                        requested_tiles: missing,
                        required_data_version: COURT_DATA_VERSION,
                        worker_token: token,
                    });
                    if (error) throw error;
                    const claimedTiles = (claimed ?? []) as Tile[];
                    discoveryStatus = 'deferred';
                    if (claimedTiles.length > 0) {
                        const { data: allowed, error: budgetError } = await db.rpc(
                            'reserve_court_provider_request',
                            {
                                provider_name: 'overpass',
                                worker_token: token,
                            },
                        );
                        if (budgetError) throw budgetError;
                        if (allowed) {
                            const courts = await fetchOverpass(claimedTiles, apiKey);
                            const { data: count, error: writeError } = await db.rpc(
                                'store_discovered_courts',
                                {
                                    discovered_courts: courts,
                                    claimed_tiles: claimedTiles,
                                    required_data_version: COURT_DATA_VERSION,
                                    worker_token: token,
                                },
                            );
                            if (writeError) throw writeError;
                            fetchedTiles = count ?? 0;
                            discoveryStatus = 'fetched';
                        }
                    }
                } catch (error) {
                    cooldown = error instanceof ProviderError ? error.retrySeconds : 60;
                    discoveryStatus = 'failed';
                    console.warn(
                        error instanceof ProviderError
                            ? error.message
                            : 'Court discovery database operation failed.',
                    );
                } finally {
                    const { error } = await db.rpc('release_court_provider', {
                        provider_name: 'overpass',
                        worker_token: token,
                        cooldown_seconds: cooldown,
                    });
                    if (error) console.warn('Could not release discovery lease; it will expire.');
                }
            } else if (enabled && !apiKey && missing.length > 0) {
                discoveryStatus = 'unconfigured';
                console.warn('OVERPASS_API_KEY is missing; returning stored courts.');
            }

            // Discovery failure still allows stored courts to be returned. Query the original
            // bounds because fetched tiles may extend beyond the requested area.
            const { data: courts, error } = await db.from('courts')
                .select('id, name, sport, latitude, longitude, address, address_status')
                .gte('latitude', bounds.south).lte('latitude', bounds.north)
                .gte('longitude', bounds.west).lte('longitude', bounds.east).order('name');
            if (error) throw error;
            return json({
                courts: courts ?? [],
                cache: {
                    fetchedTiles,
                    reusedTiles: stored.size,
                    pendingTiles: Math.max(0, missing.length - fetchedTiles),
                    discoveryStatus,
                    pendingAddresses: (courts ?? []).filter((court) =>
                        court.address_status !== 'complete'
                    ).length,
                    addressEnrichmentStarted: 0,
                },
            });
        } catch {
            console.error('get-courts failed to read court data.');
            return json({ error: 'Unable to load courts.' }, 500);
        }
    },
};
