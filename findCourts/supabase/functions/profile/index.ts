import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyFirebaseIdentity } from '../_shared/firebase.ts';
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
};
function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers });
}

export async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'POST'].includes(req.method)) return json({ error: 'Method not allowed.' }, 405);
    const project = Deno.env.get('FIREBASE_PROJECT_ID');
    const url = Deno.env.get('SUPABASE_URL');
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!project || !url || !secret) return json({ error: 'Profile service is not configured.' }, 503);

    const bearer = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) return json({ error: 'Please log in again.' }, 401);
    let uid: string;
    try {
        uid = await verifyFirebaseIdentity(bearer, project);
    } catch {
        return json({ error: 'Unable to verify your session. Please log in again.' }, 401);
    }

    try {
        const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
        if (req.method === 'GET') {
            const { data, error } = await db.from('profiles').select('firebase_uid, username, created_at')
                .eq('firebase_uid', uid).maybeSingle();
            if (error) return json({ error: 'Unable to load your profile.' }, 503);
            return json({ profile: data });
        }

        const body = await req.json().catch(() => null);
        const username = typeof body?.username === 'string' ? body.username.trim() : '';
        if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
            return json({ error: 'Use 3–24 letters, numbers, or underscores for your username.' }, 400);
        }
        // Ignore any UID or email supplied by the caller. Identity comes only from the token.
        const { data, error } = await db.from('profiles')
            .upsert({ firebase_uid: uid, username }, { onConflict: 'firebase_uid' })
            .select('firebase_uid, username, created_at').single();
        if (error) return json({ error: 'Unable to save your username. Please try again.' }, 503);
        return json({ profile: data });
    } catch {
        return json({ error: 'Profile service is unavailable. Please try again.' }, 503);
    }
}

if (import.meta.main) Deno.serve(handler);
