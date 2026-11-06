import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'npm:jose@6';
import { verifyFirebaseIdentity } from '../functions/_shared/firebase.ts';

async function rejects(action: () => Promise<unknown>) {
    try { await action(); } catch { return; }
    throw new Error('Expected rejection.');
}

Deno.test('Firebase identity rejects wrong projects, expiry, forged signatures and invalid subjects', async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    const jwk = await exportJWK(publicKey);
    const keys = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] });
    const now = Math.floor(Date.now() / 1000);
    const claims = {
        iss: 'https://securetoken.google.com/test-project', aud: 'test-project',
        sub: 'firebase-user-1', iat: now, exp: now + 3600, auth_time: now,
    };
    const sign = (overrides = {}) => new SignJWT({ ...claims, ...overrides })
        .setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(privateKey);
    const uid = await verifyFirebaseIdentity(await sign(), 'test-project', keys);
    if (uid !== claims.sub) throw new Error('Incorrect user identity.');
    for (const overrides of [
        { aud: 'another-project' }, { iss: 'https://securetoken.google.com/another-project' },
        { exp: now - 1 }, { sub: '' }, { sub: 'x'.repeat(129) },
        { iat: now + 100 }, { auth_time: now + 100 }, { exp: undefined },
    ]) {
        await rejects(async () => verifyFirebaseIdentity(await sign(overrides), 'test-project', keys));
    }
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'test' }).sign(other.privateKey);
    await rejects(() => verifyFirebaseIdentity(forged, 'test-project', keys));
});

Deno.test('Profiles allow duplicate usernames, enforce shape and block direct client access', async () => {
    const db = new PGlite();
    try {
        await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
        await db.exec(await Deno.readTextFile(new URL('../migrations/20261106000000_create_profiles.sql', import.meta.url)));
        await db.exec("insert into profiles(firebase_uid, username) values ('one', 'same_name'), ('two', 'same_name');");
        await rejects(() => db.exec("insert into profiles(firebase_uid, username) values ('one', 'another');"));
        await rejects(() => db.exec("insert into profiles(firebase_uid, username) values ('three', 'ab');"));
        await rejects(() => db.exec("insert into profiles(firebase_uid, username) values ('three', 'bad name');"));
        for (const role of ['anon', 'authenticated']) {
            await db.exec(`set role ${role};`);
            await rejects(() => db.query('select * from profiles'));
            await rejects(() => db.exec("insert into profiles(firebase_uid, username) values ('victim', 'attacker');"));
            await rejects(() => db.exec("update profiles set username = 'attacker' where firebase_uid = 'one';"));
            await db.exec('reset role;');
        }
        await db.exec('set role service_role;');
        await db.exec("insert into profiles(firebase_uid, username) values ('one', 'updated') on conflict(firebase_uid) do update set username = excluded.username;");
        const { rows } = await db.query<{ username: string }>("select username from profiles where firebase_uid = 'one'");
        if (rows[0].username !== 'updated') throw new Error('Retry/upsert failed.');
    } finally {
        await db.close();
    }
});
