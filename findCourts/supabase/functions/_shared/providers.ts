// Never include URLs, response bodies, or fetch exception messages in provider errors.
export class ProviderError extends Error {
    constructor(message: string, public retrySeconds: number, public stopWorker = false) {
        super(message);
    }
}

type GeoapifyResponse = {
    features?: { properties?: { street?: string; formatted?: string; distance?: number } }[];
};

export async function reverseGeocodeStreet(latitude: number, longitude: number, apiKey: string) {
    const url = new URL('https://api.geoapify.com/v1/geocode/reverse');
    url.searchParams.set('lat', String(latitude));
    url.searchParams.set('lon', String(longitude));
    url.searchParams.set('type', 'street');
    url.searchParams.set('format', 'geojson');
    url.searchParams.set('apiKey', apiKey);
    let response: Response;
    try {
        response = await fetch(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
        });
    } catch {
        throw new ProviderError('Geoapify request timed out or failed.', 86400);
    }
    if (!response.ok) {
        const status = response.status;
        await response.body?.cancel();
        throw new ProviderError(`Geoapify returned HTTP ${status}.`, 86400, true);
    }
    try {
        const result = await response.json() as GeoapifyResponse;
        if (!Array.isArray(result.features)) throw new Error();
        const location = result.features[0]?.properties;
        if (
            !location?.street?.trim() || !location.formatted?.trim() ||
            typeof location.distance !== 'number' || !Number.isFinite(location.distance) ||
            location.distance > 200 || location.distance < 0
        ) return null;
        return `Near ${location.formatted.trim()}`;
    } catch {
        throw new ProviderError('Geoapify returned an invalid result.', 86400);
    }
}
