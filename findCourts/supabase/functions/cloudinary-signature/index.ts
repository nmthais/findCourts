import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyFirebaseIdentity } from '../_shared/firebase.ts';
const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers });
}

function safeSegment(value: string) {
    return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

async function sha1(value: string) {
    const bytes = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-1', bytes);

    return [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
}

export async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    const project = Deno.env.get('FIREBASE_PROJECT_ID');
    const url = Deno.env.get('SUPABASE_URL');
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME');
    const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');
    const uploadPreset = Deno.env.get('CLOUDINARY_UPLOAD_PRESET');
    if (!project || !url || !secret || !cloudName || !apiKey || !apiSecret || !uploadPreset) {
        return json({ error: 'Court images signature service is not configured.' }, 503);
    }

    const bearer = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    if (!bearer) return json({ error: 'Please log in again.' }, 401);
    let uid: string;
    try {
        uid = await verifyFirebaseIdentity(bearer, project);
    } catch {
        return json({ error: 'Unable to verify your session. Please log in again.' }, 401);
    }

    const body = await req.json().catch(() => null);
    const courtId = typeof body?.court_id === 'string'
        ? body.court_id.trim()
        : '';

    if (!courtId || courtId.length > 255) {
        return json({ error: 'A valid court_id is required.' }, 400);
    }

    try {
        const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
        const [courtResult, profileResult, imageCountResult] = await Promise.all([
            db.from('courts')
                .select('id')
                .eq('id', courtId)
                .maybeSingle(),
            db.from('profiles')
                .select('firebase_uid')
                .eq('firebase_uid', uid)
                .maybeSingle(),
            db.from('court_images')
                .select('id', { count: 'exact', head: true })
                .eq('court_id', courtId)
                .eq('uploaded_by_firebase_uid', uid),
        ]);
        if (courtResult.error || profileResult.error || imageCountResult.error) {
            return json({ error: 'Unable to validate this upload.' }, 503);
        }

        if (!courtResult.data) {
            return json({ error: 'Court not found.' }, 404);
        }

        if (!profileResult.data) {
            return json({ error: 'Complete your profile before uploading photos.' }, 409);
        }

        if ((imageCountResult.count ?? 0) >= 5) {
            return json({ error: 'You can upload up to 5 photos for each court.' }, 409);
        }
        
        const publicId = [
            'court-images',
            safeSegment(courtId),
            safeSegment(uid),
            crypto.randomUUID(),
        ].join('/');

        const timestamp = Math.floor(Date.now() / 1000);

        const parametersToSign = [
            `public_id=${publicId}`,
            `timestamp=${timestamp}`,
            `upload_preset=${uploadPreset}`,
        ].join('&');

        const signature = await sha1(parametersToSign + apiSecret);

        return json({
            cloud_name: cloudName,
            api_key: apiKey,
            upload_preset: uploadPreset,
            public_id: publicId,
            timestamp,
            signature,
            upload_url: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        });
    } catch {
        return json({ error: 'Court images signature service is unavailable. Please try again.' }, 503);
    }
}

if (import.meta.main) Deno.serve(handler);
