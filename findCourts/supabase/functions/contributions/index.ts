import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyFirebaseIdentity } from '../_shared/firebase.ts';

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store',
};
const PAGE_SIZE = 20;
const courtFields = 'court:courts!inner(id,name,sport,latitude,longitude,address)';
type HistoryRow = {
    id: string;
    created_at: string;
    [key: string]: unknown;
};

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers });
}

export function createHandler(deps = { verifyIdentity: verifyFirebaseIdentity, createDatabase: createClient }) {
    return async (request: Request): Promise<Response> => {
        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
        if (request.method !== 'GET') return json({ error: 'Method not allowed.' }, 405);
        const project = Deno.env.get('FIREBASE_PROJECT_ID');
        const url = Deno.env.get('SUPABASE_URL');
        const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (!project || !url || !secret) return json({ error: 'Contributions service is not configured.' }, 503);
        const token = request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
        if (!token) return json({ error: 'Please log in to view your contributions.' }, 401);
        let uid: string;
        try {
            uid = await deps.verifyIdentity(token, project);
        } catch {
            return json({ error: 'Your session is invalid. Please log in again.' }, 401);
        }
        const params = new URL(request.url).searchParams;
        const tab = params.get('tab');
        if (tab !== 'reviews' && tab !== 'photos') return json({ error: 'Choose reviews or photos.' }, 400);
        let cursor: { created_at: string; id: string } | null = null;
        if (params.has('cursor')) {
            try {
                cursor = JSON.parse(params.get('cursor')!);
                if (!cursor || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.created_at)
                    || !Number.isFinite(Date.parse(cursor.created_at))
                    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor.id)) {
                    return json({ error: 'Invalid page cursor.' }, 400);
                }
            } catch {
                return json({ error: 'Invalid page cursor.' }, 400);
            }
        }
        try {
            const db = deps.createDatabase(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
            const reviews = tab === 'reviews';
            let query = db.from(reviews ? 'reviews' : 'court_images')
                .select(reviews
                    ? `id,court_id,rating,comment,created_at,updated_at,${courtFields}`
                    : `id,court_id,cloudinary_secure_url,created_at,${courtFields}`)
                .eq(reviews ? 'firebase_uid' : 'uploaded_by_firebase_uid', uid)
                .order('created_at', { ascending: false }).order('id', { ascending: false })
                .limit(PAGE_SIZE + 1);
            if (cursor) {
                query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
            }
            const { data, error } = await query.returns<HistoryRow[]>();
            if (error) throw error;
            const rows = data ?? [];
            const items = rows.slice(0, PAGE_SIZE);
            const last = items.at(-1);
            return json({ items, nextCursor: rows.length > PAGE_SIZE && last
                ? JSON.stringify({ created_at: last.created_at, id: last.id }) : null });
        } catch {
            return json({ error: 'Unable to load your contributions. Please try again.' }, 503);
        }
    };
}

if (import.meta.main) Deno.serve(createHandler());
