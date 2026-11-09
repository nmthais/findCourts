import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

async function rejects(action: () => Promise<unknown>) {
    try { await action(); } catch { return; }
    throw new Error('Expected rejection.');
}

Deno.test('Reviews and court images enforce ownership relationships and valid content', async () => {
    const db = new PGlite();
    try {
        await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
        await db.exec('create table courts (id text primary key);');
        await db.exec('create table profiles (firebase_uid text primary key);');
        await db.exec(await Deno.readTextFile(new URL(
            '../migrations/20261106010000_create_reviews_and_court_images.sql',
            import.meta.url,
        )));
        await db.exec(await Deno.readTextFile(new URL(
            '../migrations/20261108000000_add_review_summary.sql',
            import.meta.url,
        )));
        await db.exec(await Deno.readTextFile(new URL(
            '../migrations/20261108010000_limit_court_images_per_user.sql',
            import.meta.url,
        )));
        await db.exec("insert into courts(id) values ('court-1');");
        await db.exec("insert into profiles(firebase_uid) values ('user-1'), ('user-2'), ('user-3');");

        await db.exec("insert into reviews(court_id, firebase_uid, rating) values ('court-1', 'user-1', 5);");
        await db.exec("insert into reviews(court_id, firebase_uid, rating) values ('court-1', 'user-2', 3);");
        const summary = await db.query<{ review_count: bigint; average_rating: number }>(
            "select * from get_court_review_summary('court-1');",
        );
        if (Number(summary.rows[0].review_count) !== 2 || Number(summary.rows[0].average_rating) !== 4) {
            throw new Error('Incorrect review summary.');
        }
        await rejects(() => db.exec(
            "insert into reviews(court_id, firebase_uid, rating) values ('court-1', 'user-1', 4);",
        ));
        await rejects(() => db.exec(
            "insert into reviews(court_id, firebase_uid, rating) values ('court-1', 'user-3', 0);",
        ));
        await rejects(() => db.exec(
            "insert into reviews(court_id, firebase_uid, rating, comment) values ('court-1', 'user-3', 4, '');",
        ));
        await rejects(() => db.exec(
            "insert into reviews(court_id, firebase_uid, rating) values ('missing', 'user-2', 4);",
        ));

        await db.exec(`insert into court_images(
            court_id, uploaded_by_firebase_uid, cloudinary_public_id, cloudinary_secure_url
        ) values ('court-1', 'user-1', 'courts/photo-1', 'https://res.cloudinary.com/demo/photo.jpg');`);
        await rejects(() => db.exec(`insert into court_images(
            court_id, uploaded_by_firebase_uid, cloudinary_public_id, cloudinary_secure_url
        ) values ('court-1', 'user-2', 'courts/photo-1', 'https://res.cloudinary.com/demo/other.jpg');`));
        await rejects(() => db.exec(`insert into court_images(
            court_id, uploaded_by_firebase_uid, cloudinary_public_id, cloudinary_secure_url
        ) values ('court-1', 'user-2', 'courts/photo-2', 'http://example.com/photo.jpg');`));
        for (let image = 2; image <= 5; image += 1) {
            await db.exec(`insert into court_images(
                court_id, uploaded_by_firebase_uid, cloudinary_public_id, cloudinary_secure_url
            ) values ('court-1', 'user-1', 'courts/photo-${image}', 'https://example.com/${image}.jpg');`);
        }
        await rejects(() => db.exec(`insert into court_images(
            court_id, uploaded_by_firebase_uid, cloudinary_public_id, cloudinary_secure_url
        ) values ('court-1', 'user-1', 'courts/photo-6', 'https://example.com/6.jpg');`));
    } finally {
        await db.close();
    }
});

Deno.test('App database roles cannot directly access reviews or court images', async () => {
    const db = new PGlite();
    try {
        await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
        await db.exec('create table courts (id text primary key);');
        await db.exec('create table profiles (firebase_uid text primary key);');
        await db.exec(await Deno.readTextFile(new URL(
            '../migrations/20261106010000_create_reviews_and_court_images.sql',
            import.meta.url,
        )));
        for (const role of ['anon', 'authenticated']) {
            await db.exec(`set role ${role};`);
            await rejects(() => db.query('select * from reviews'));
            await rejects(() => db.query('select * from court_images'));
            await db.exec('reset role;');
        }
    } finally {
        await db.close();
    }
});
