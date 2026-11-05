-- This job makes no HTTP request until both Vault secrets have been configured.
-- Keep ADDRESS_ENRICHMENT_ENABLED=false until the worker is deployed and ready.
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
    'enrich-court-addresses',
    '*/10 * * * *',
    $job$
    select net.http_post(
        url := rtrim(project.decrypted_secret, '/') || '/functions/v1/enrich-court-addresses',
        headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', worker.decrypted_secret),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
    )
    from vault.decrypted_secrets project
    cross join vault.decrypted_secrets worker
    where project.name = 'court_project_url' and worker.name = 'court_worker_secret_key'
      and nullif(project.decrypted_secret, '') is not null
      and nullif(worker.decrypted_secret, '') is not null;
    $job$
);
