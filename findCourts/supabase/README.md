# Supabase court data

For Firebase signup and username storage, see [User profiles](PROFILES.md).

## Deploy

Run these commands from `findCourts` after linking your Supabase project:

```powershell
npx supabase db push
npx supabase functions deploy get-courts --use-api
npx supabase functions deploy enrich-court-addresses --use-api
npx supabase functions deploy search-courts --use-api
```

Apply the migrations **before** deploying the updated functions. The migrations
keep existing courts, addresses, search RPCs, and tile coverage. They add the
address queue, provider leases, and a Cron job. The old tile-address RPC is
retained for migration compatibility but is no longer called.

In Dashboard > Edge Functions > Secrets, configure:

| Name | Value |
| --- | --- |
| `OVERPASS_API_KEY` | Your overpass.ch key |
| `OVERPASS_ENABLED` | `true` to enable missing-tile discovery |
| `GEOAPIFY_API_KEY` | Your Geoapify key |
| `ADDRESS_ENRICHMENT_ENABLED` | `true` to enable the address worker |

Both features default to disabled. Missing keys leave cached reads available
and address jobs pending. Expo's root `.env` does not configure hosted secrets.
Keep provider keys out of `EXPO_PUBLIC_` variables.

For local functions, copy `supabase/functions/.env.example` to
`supabase/functions/.env.local`, fill in the values, and run:

```powershell
npx supabase functions serve --env-file supabase/functions/.env.local
```

## Configure the scheduled worker

Enable Supabase Cron and pg_net if not already enabled (the scheduling migration
creates their extensions). In Dashboard > Vault, add these two secrets:

- `court_project_url`: `https://YOUR_PROJECT_REF.supabase.co`
- `court_worker_secret_key`: the project's **default server secret key**,
  from Settings > API Keys. This is NOT a publishable key or a Geoapify key.

The Cron job `enrich-court-addresses` runs every ten minutes. It only sends a
request after both Vault secrets exist. The worker checks `auth: 'secret'`;
a mobile publishable key cannot run it. Keep the default server secret out of
the Expo app. Supabase's pg_net request queue briefly contains the outgoing
header, so only trusted database roles should have access to it.

For a manual run, use a trusted HTTP client to POST an empty JSON body to
`/functions/v1/enrich-court-addresses` with the default server secret in the
`apikey` header. Do not invoke the worker from the app.

To pause geocoding, set `ADDRESS_ENRICHMENT_ENABLED=false`. To remove the schedule:

```sql
select cron.unschedule('enrich-court-addresses');
```

## Request flow

`get-courts` reads coverage for 0.1-degree tiles. If enabled, discovery claims
a shared Overpass lease, rechecks coverage, fetches only missing tiles, and
commits courts and coverage in one transaction. There is no address API call
on the map request. A complete direct OSM street is immediately usable; a
suburb/state-only address stays eligible for geocoding.

Only one discovery run and one address worker can hold their respective leases.
Leases expire after 75 seconds, and every write checks its owner token.
Provider failures leave tiles incomplete, return existing database courts, and
apply a shared cooldown (15 minutes for Overpass errors, one hour for HTTP 429).
Busy, cooling-down, or budget-limited discovery is reported as `deferred`.
The map must load the area again later to retry; no automatic polling was added.

The address worker claims one court at a time, up to ten per run and a 45-second
work budget. Calls are sequential, spaced by at least 1.1 seconds, and individually
time out after 8 seconds. A shared request counter enforces budgets even if
someone repeatedly triggers the worker. Rate/auth/server HTTP errors stop the
batch and pause Geoapify for 24 hours.

Default daily request budgets (UTC) are 250 for Overpass and 2,000 for Geoapify.
They are conservative app limits, not promises about any provider plan. Adjust
them and `request_spacing_ms` in the private `court_provider_state` table to
match your account. Requests that fail or time out still consume this budget.
Overpass calls are at least three seconds apart. The configured database
spacing is also enforced when requests are reserved.

Court address fields:

- `address_status`: `pending`, `complete`, `retry`, or `unavailable`.
- `address_source`: `osm`, `geoapify`, or `legacy`.
- `address_attempted_at` and `address_retry_after`: persistent attempt/cooldown.
- `address_claim_token` and `address_claim_until`: expiring job ownership.

Failures retry after 24 hours. No nearby street retries after 30 days.
A successful street within 200 metres is stored as `Near <street address>`;
it is an approximate location, not a verified entrance. Failed lookups preserve
the old display address. Existing legacy rows are queued once, including those
with strings, because their original street quality cannot be inferred reliably.
New complete OSM addresses and successful Geoapify addresses are not requeued.
Court rediscovery cannot replace a complete saved address with partial data.

The app receives new addresses on its next court fetch; there is no live update
subscription. `search-courts` continues searching database names and addresses.

## Inspect progress

```sql
select address_status, count(*) from public.courts group by address_status;
select provider, requests_today, daily_limit, lease_until, available_after
from public.court_provider_state;
select jobname, schedule, active from cron.job
where jobname = 'enrich-court-addresses';
select * from cron.job_run_details order by start_time desc limit 10;
select id, status_code, timed_out from net._http_response order by id desc limit 10;
```

The worker logs one batch summary with processed/completed counts. A Cron
success only confirms the HTTP request was queued; inspect HTTP responses and
Edge Function logs for the worker result. No provider URLs, API keys, or raw
response bodies are logged.

## Verification

```powershell
npx --yes deno check --config supabase/deno.json supabase/functions/get-courts/index.ts supabase/functions/enrich-court-addresses/index.ts
npx --yes deno test --config supabase/deno.json --allow-env --allow-read supabase/tests/
npx tsc --noEmit
npx expo lint
```

Tests use fake providers and an in-memory PostgreSQL instance; no hosted
database, Overpass, or Geoapify requests are made.

References: [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions),
[Supabase authentication](https://supabase.com/docs/guides/functions/auth),
[Geoapify reverse geocoding](https://apidocs.geoapify.com/docs/geocoding/reverse-geocoding/).
