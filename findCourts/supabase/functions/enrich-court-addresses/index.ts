import { createSupabaseContext } from 'npm:@supabase/server@1';
import { ProviderError, reverseGeocodeStreet } from '../_shared/providers.ts';

const MAX_JOBS = 10;
const RUN_BUDGET_MS = 45_000;
const REQUEST_SPACING_MS = 1100;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export default {
    async fetch(request: Request) {
        if (request.method !== 'POST') {
            return Response.json({ error: 'Method not allowed.' }, { status: 405 });
        }
        try {
            // Only the scheduler/server secret may run paid work; the app key is rejected.
            const { data: context, error: authError } = await createSupabaseContext(request, {
                auth: 'secret',
            });
            if (authError || !context) return Response.json({ error: 'Unauthorized.' }, { status: 401 });
            if (Deno.env.get('ADDRESS_ENRICHMENT_ENABLED') !== 'true') {
                return Response.json({ status: 'disabled', processed: 0 });
            }
            const apiKey = Deno.env.get('GEOAPIFY_API_KEY');
            if (!apiKey) {
                console.warn('GEOAPIFY_API_KEY is missing; address jobs remain pending.');
                return Response.json({ status: 'unconfigured', processed: 0 });
            }

            const db = context.supabaseAdmin;
            const token = crypto.randomUUID();
            const { data: acquired, error } = await db.rpc('acquire_court_provider', {
                provider_name: 'geoapify',
                worker_token: token,
            });
            if (error) throw error;
            if (!acquired) return Response.json({ status: 'deferred', processed: 0 });

            const deadline = Date.now() + RUN_BUDGET_MS;
            let processed = 0;
            let completed = 0;
            let cooldown = 3;
            let status = 'complete';
            try {
                // Reserve enough time for the next 8s HTTP call and database writes.
                while (processed < MAX_JOBS && Date.now() + 12_000 < deadline) {
                    const { data: jobs, error: claimError } = await db.rpc('claim_court_address_job', {
                        worker_token: token,
                    });
                    if (claimError) throw claimError;
                    const job = jobs?.[0] as { id: string; latitude: number; longitude: number } | undefined;
                    if (!job) break;
                    const { data: allowed, error: reserveError } = await db.rpc(
                        'reserve_court_provider_request',
                        {
                            provider_name: 'geoapify',
                            worker_token: token,
                        },
                    );
                    if (reserveError) throw reserveError;
                    if (!allowed) {
                        status = 'deferred';
                        break;
                    }

                    let address: string | null = null;
                    let resultStatus = 'unavailable';
                    let stop = false;
                    try {
                        address = await reverseGeocodeStreet(job.latitude, job.longitude, apiKey);
                        resultStatus = address ? 'complete' : 'unavailable';
                    } catch (error) {
                        resultStatus = 'retry';
                        cooldown = error instanceof ProviderError && error.stopWorker
                            ? error.retrySeconds
                            : 3;
                        stop = error instanceof ProviderError && error.stopWorker;
                        console.warn(
                            error instanceof ProviderError ? error.message : 'Address lookup failed.',
                        );
                    }
                    const { data: saved, error: saveError } = await db.rpc('finish_court_address_job', {
                        court_id: job.id,
                        worker_token: token,
                        result_status: resultStatus,
                        result_address: address,
                    });
                    if (saveError) throw saveError;
                    if (!saved) {
                        status = 'lease-expired';
                        break;
                    }
                    processed += 1;
                    if (address) completed += 1;
                    if (stop) {
                        status = 'provider-paused';
                        break;
                    }
                    await sleep(REQUEST_SPACING_MS);
                }
            } finally {
                const { error: jobError } = await db.rpc('release_court_address_jobs', {
                    worker_token: token,
                });
                const { error: releaseError } = await db.rpc('release_court_provider', {
                    provider_name: 'geoapify',
                    worker_token: token,
                    cooldown_seconds: cooldown,
                });
                if (jobError || releaseError) {
                    console.warn('Address lease cleanup failed; leases will expire.');
                }
            }
            console.log('Court address batch finished.', { processed, completed, status });
            return Response.json({ status, processed, completed });
        } catch {
            console.error('Address worker database operation failed; unfinished claims will expire.');
            return Response.json({ error: 'Unable to process address jobs.' }, { status: 500 });
        }
    },
};
