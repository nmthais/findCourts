import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyFirebaseIdentity } from '../_shared/firebase.ts';

const DEFAULT_LIMIT = 20;
const MAX_PAGE_LIMIT = 20;
const MAX_VISIBLE_REVIEWS = 50;
const MAX_COMMENT_LENGTH = 2000;

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
};

type ReviewInput = { courtId: string; rating: number; comment: string | null };
type ReviewRow = {
    id: string;
    court_id: string;
    firebase_uid: string;
    rating: number;
    comment: string | null;
    created_at: string;
    updated_at: string;
    profile: { username: string } | { username: string }[] | null;
};

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers });
}

function readCourtId(value: unknown) {
    const courtId = typeof value === 'string' ? value.trim() : '';
    return courtId.length >= 1 && courtId.length <= 255 ? courtId : null;
}

export function parseReviewInput(body: unknown): ReviewInput | null {
    if (!body || typeof body !== 'object') return null;
    const value = body as Record<string, unknown>;
    const courtId = readCourtId(value.court_id);
    const rating = value.rating;
    if (!courtId || !Number.isInteger(rating) || (rating as number) < 1 || (rating as number) > 5) {
        return null;
    }
    if (value.comment !== undefined && value.comment !== null && typeof value.comment !== 'string') {
        return null;
    }
    const comment = typeof value.comment === 'string' ? value.comment.trim() : '';
    if (comment.length > MAX_COMMENT_LENGTH) return null;
    return { courtId, rating: rating as number, comment: comment || null };
}

function publicReview(row: ReviewRow, uid: string | null) {
    const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
    return {
        id: row.id,
        court_id: row.court_id,
        rating: row.rating,
        comment: row.comment,
        username: profile?.username ?? 'Unknown user',
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_mine: uid !== null && row.firebase_uid === uid,
    };
}

async function verifiedUid(req: Request, project: string, required: boolean) {
    const token = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) {
        if (required) throw new Error('missing-token');
        return null;
    }
    try {
        return await verifyFirebaseIdentity(token, project);
    } catch {
        if (!required) return null;
        throw new Error('invalid-token');
    }
}

export async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
        return json({ error: 'Method not allowed.' }, 405);
    }

    const project = Deno.env.get('FIREBASE_PROJECT_ID');
    const url = Deno.env.get('SUPABASE_URL');
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!project || !url || !secret) return json({ error: 'Review service is not configured.' }, 503);

    let uid: string | null;
    try {
        uid = await verifiedUid(req, project, req.method !== 'GET');
    } catch (error) {
        const missing = error instanceof Error && error.message === 'missing-token';
        return json({
            error: missing ? 'Please log in to manage reviews.' : 'Your session is invalid. Please log in again.',
        }, 401);
    }

    const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });

    try {
        if (req.method === 'GET') {
            const requestUrl = new URL(req.url);
            const courtId = readCourtId(requestUrl.searchParams.get('court_id'));
            if (!courtId) return json({ error: 'A valid court_id is required.' }, 400);
            const requestedLimit = Number(requestUrl.searchParams.get('limit'));
            const requestedOffset = Number(requestUrl.searchParams.get('offset'));
            const requestedPageSize = Number.isInteger(requestedLimit) && requestedLimit > 0
                ? Math.min(requestedLimit, MAX_PAGE_LIMIT)
                : DEFAULT_LIMIT;
            const offset = Number.isInteger(requestedOffset) && requestedOffset >= 0 ? requestedOffset : 0;
            const limit = Math.max(0, Math.min(requestedPageSize, MAX_VISIBLE_REVIEWS - offset));
            const reviewSelect = `
                id, court_id, firebase_uid, rating, comment, created_at, updated_at,
                profile:profiles!reviews_firebase_uid_fkey(username)
            `;
            const reviewsQuery = db.from('reviews').select(reviewSelect)
                    .eq('court_id', courtId)
                    .order('created_at', { ascending: false });
            const [reviewsResult, summaryResult] = await Promise.all([
                limit > 0 ? reviewsQuery.range(offset, offset + limit - 1) : Promise.resolve({
                    data: [], error: null,
                }),
                db.rpc('get_court_review_summary', { target_court_id: courtId }).single(),
            ]);
            if (reviewsResult.error) throw reviewsResult.error;
            if (summaryResult.error) throw summaryResult.error;

            let myReview: ReviewRow | null = null;
            if (uid) {
                const ownResult = await db.from('reviews').select(reviewSelect)
                    .eq('court_id', courtId).eq('firebase_uid', uid).maybeSingle();
                if (ownResult.error) throw ownResult.error;
                myReview = ownResult.data as ReviewRow | null;
            }
            const summary = summaryResult.data as { review_count: number | string; average_rating: number | string | null };
            return json({
                reviews: ((reviewsResult.data ?? []) as ReviewRow[]).map((review) => publicReview(review, uid)),
                my_review: myReview ? publicReview(myReview, uid) : null,
                count: Number(summary.review_count),
                average_rating: summary.average_rating === null ? null : Number(summary.average_rating),
                limit,
                offset,
            });
        }

        const body = await req.json().catch(() => null);
        if (req.method === 'DELETE') {
            const courtId = readCourtId(body?.court_id);
            if (!courtId) return json({ error: 'A valid court_id is required.' }, 400);
            const { data, error } = await db.from('reviews').delete()
                .eq('court_id', courtId).eq('firebase_uid', uid!).select('id').maybeSingle();
            if (error) throw error;
            if (!data) return json({ error: 'Review not found.' }, 404);
            return json({ deleted: true });
        }

        const review = parseReviewInput(body);
        if (!review) {
            return json({
                error: `Provide a court_id, a rating from 1 to 5, and an optional comment up to ${MAX_COMMENT_LENGTH} characters.`,
            }, 400);
        }
        const { data, error } = await db.from('reviews').upsert({
            court_id: review.courtId,
            firebase_uid: uid!,
            rating: review.rating,
            comment: review.comment,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'court_id,firebase_uid' }).select(`
            id, court_id, firebase_uid, rating, comment, created_at, updated_at,
            profile:profiles!reviews_firebase_uid_fkey(username)
        `).single();
        if (error?.code === '23503') {
            return json({ error: 'The court or your user profile could not be found.' }, 409);
        }
        if (error) throw error;
        return json({ review: publicReview(data as ReviewRow, uid) });
    } catch (error) {
        console.error('reviews function failed', error);
        return json({ error: 'Unable to access reviews. Please try again.' }, 503);
    }
}

if (import.meta.main) Deno.serve(handler);
