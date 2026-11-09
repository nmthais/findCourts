import { createClient } from 'npm:@supabase/supabase-js@2';
import { createHandler } from '../functions/contributions/index.ts';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
import { focusCourtInCluster } from '../../src/utils/focusCourtInCluster.ts';

function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
}

Deno.test('Contributions requires identity, filters ownership, and paginates deterministically', async () => {
    const env = { FIREBASE_PROJECT_ID: 'test-project', SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-secret' };
    const previous = new Map(Object.keys(env).map((key) => [key, Deno.env.get(key)]));
    for (const [key, value] of Object.entries(env)) Deno.env.set(key, value);
    const requests: URL[] = [];
    let rows = Array.from({ length: 21 }, (_, index) => ({
        id: `00000000-0000-0000-0000-${String(100 - index).padStart(12, '0')}`,
        created_at: '2026-11-09T00:00:00+00:00',
    }));
    const handler = createHandler({
        verifyIdentity: async (token) => {
            if (token !== 'valid-token') throw new Error('invalid');
            return 'verified-owner';
        },
        createDatabase: (url, key, options) => createClient(url, key, {
            ...options,
            global: { fetch: async (input) => {
                requests.push(new URL(input instanceof Request ? input.url : String(input)));
                return Response.json(rows);
            } },
        }),
    });
    const request = (query: string, token?: string) => new Request(`https://example.test/contributions?${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    try {
        assert((await handler(request('tab=reviews'))).status === 401, 'Missing token must fail');
        assert((await handler(request('tab=photos', 'invalid'))).status === 401, 'Invalid token must fail');
        assert(requests.length === 0, 'Unauthorized callers must never query the database');
        assert((await handler(request('tab=other', 'valid-token'))).status === 400, 'Invalid tabs must fail');
        const malformed = new URLSearchParams({ tab: 'reviews', cursor: JSON.stringify({ created_at: 'injected,filter', id: 'invalid' }) });
        assert((await handler(request(String(malformed), 'valid-token'))).status === 400, 'Invalid cursors must fail');

        const response = await handler(request('tab=reviews&uid=someone-else', 'valid-token'));
        const page = await response.json();
        assert(response.status === 200 && page.items.length === 20, 'Return one page, excluding lookahead');
        assert(JSON.parse(page.nextCursor).id === rows[19].id, 'Cursor must point to last returned item');
        const query = requests.at(-1)!;
        assert(query.searchParams.get('firebase_uid') === 'eq.verified-owner', 'Ownership must use verified token');
        assert(query.searchParams.get('order') === 'created_at.desc,id.desc', 'Ties need stable ordering');
        assert(query.searchParams.get('limit') === '21', 'Fetch one extra row to detect another page');
        assert(query.searchParams.get('select')?.includes('court:courts!inner'), 'Return court details');

        rows = [];
        const next = new URLSearchParams({ tab: 'reviews', cursor: page.nextCursor });
        const lastPage = await (await handler(request(String(next), 'valid-token'))).json();
        assert(lastPage.items.length === 0 && lastPage.nextCursor === null, 'Empty final page must stop pagination');
        assert(requests.at(-1)!.searchParams.get('or')?.includes(`id.lt.${page.items[19].id}`), 'Cursor must include tie breaker');

        await handler(request('tab=photos&uid=someone-else', 'valid-token'));
        assert(requests.at(-1)!.pathname.endsWith('/court_images'), 'Photo tab must query images');
        assert(requests.at(-1)!.searchParams.get('uploaded_by_firebase_uid') === 'eq.verified-owner', 'Photos must filter by verified owner');
    } finally {
        for (const [key, value] of previous) {
            if (value === undefined) Deno.env.delete(key);
            else Deno.env.set(key, value);
        }
    }
});

Deno.test('History opens the selected court even when refreshed clusters have a different first court', () => {
    const cached = { id: 'cluster', courts: [{ id: 'court-a' }, { id: 'court-b' }] };
    const selected = focusCourtInCluster(cached, 'court-b');
    assert(selected.courts[0].id === 'court-b', 'History must select the reviewed court');
    assert(cached.courts[0].id === 'court-a', 'Cached clusters must not be mutated');
    const refreshed = { ...cached, courts: [{ id: 'court-c' }, ...cached.courts] };
    assert(focusCourtInCluster(refreshed, 'court-b').courts[0].id === 'court-b', 'Refresh must preserve selection');
    assert(focusCourtInCluster(cached) === cached, 'Normal marker selection must retain its existing order');
    assert(focusCourtInCluster(cached, 'missing') === cached, 'Missing courts must fall back safely');
});

Deno.test('History indexes apply and cursor pages contain current records after edits and deletions', async () => {
    const db = new PGlite();
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
            create table courts (id text primary key);
            create table profiles (firebase_uid text primary key);`);
        for (const migration of ['20261106010000_create_reviews_and_court_images.sql', '20261109000000_index_contribution_history.sql']) {
            await db.exec(await Deno.readTextFile(new URL(`../migrations/${migration}`, import.meta.url)));
        }
        await db.exec(`insert into profiles values ('owner'), ('other');
            insert into courts select 'court-' || n from generate_series(1, 25) n;
            insert into reviews (court_id, firebase_uid, rating, created_at)
            select id, 'owner', 3, '2026-11-09T00:00:00Z' from courts;
            insert into reviews (court_id, firebase_uid, rating) values ('court-1', 'other', 1);
            insert into court_images (court_id, uploaded_by_firebase_uid, cloudinary_public_id, cloudinary_secure_url)
            values ('court-1', 'owner', 'test-photo', 'https://example.test/photo.jpg');`);
        const indexes = await db.query<{ indexname: string }>("select indexname from pg_indexes where indexname in ('reviews_user_history_idx', 'court_images_user_history_idx')");
        assert(indexes.rows.length === 2, 'Both history indexes must exist');
        const first = await db.query<{ id: string }>("select id from reviews where firebase_uid = 'owner' order by created_at desc, id desc limit 20");
        await db.query('delete from reviews where id = $1', [first.rows[0].id]);
        await db.query("update reviews set rating = 5, comment = 'Updated' where id = $1", [first.rows[1].id]);
        const next = await db.query<{ id: string }>(`select id from reviews where firebase_uid = 'owner'
            and (created_at < '2026-11-09T00:00:00Z' or (created_at = '2026-11-09T00:00:00Z' and id < $1))
            order by created_at desc, id desc limit 20`, [first.rows[19].id]);
        assert(next.rows.length === 5, 'Deleting an earlier item must not skip remaining records');
        assert(next.rows.every((row) => !first.rows.some((previous) => previous.id === row.id)), 'Pages must not overlap');
        const updated = await db.query<{ rating: number; comment: string }>('select rating, comment from reviews where id = $1', [first.rows[1].id]);
        assert(updated.rows[0].rating === 5 && updated.rows[0].comment === 'Updated', 'History must read current review content');
        await db.exec("delete from court_images where uploaded_by_firebase_uid = 'owner'");
        assert((await db.query("select id from court_images where uploaded_by_firebase_uid = 'owner'")).rows.length === 0,
            'Deleted photos must not appear in history');
    } finally {
        await db.close();
    }
});
