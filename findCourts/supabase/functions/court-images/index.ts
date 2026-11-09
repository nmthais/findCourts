import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyFirebaseIdentity } from '../_shared/firebase.ts';

const DEFAULT_LIMIT = 20;
const MAX_PAGE_LIMIT = 20;
const MAX_VISIBLE_IMAGES = 50;

const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
    'Cache-Control': 'no-store',
};

function json(body: unknown, status = 200) {
    return Response.json(body, { status, headers });
}

function readCourtId(value: unknown) {
    const courtId = typeof value === 'string' ? value.trim() : '';
    return courtId.length >= 1 && courtId.length <= 255 ? courtId : null;
}

function safeSegment(value: string) {
    return value.replace(/[^A-Za-z0-9_-]/g, '_');
}

export async function handler(req: Request): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return json({ error: 'Method not allowed.' }, 405);
    const project = Deno.env.get('FIREBASE_PROJECT_ID');
    const url = Deno.env.get('SUPABASE_URL');
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME');
    const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');
    if (!project || !url || !secret || !cloudName || !apiKey || !apiSecret) {
        return json({ error: 'Court images service is not configured.' }, 503);
    }

    const bearer = req.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
    let uid: string | null = null;

    if (bearer) {
        try {
            uid = await verifyFirebaseIdentity(bearer, project);
        } catch {
            // GET remains public if the optional token isn't a Firebase token.
            if (req.method !== 'GET') {
                return json({
                    error: 'Unable to verify your session. Please log in again.',
                }, 401);
            }
        }
    }

    try {
        const db = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
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
            const limit = Math.max(0, Math.min(requestedPageSize, MAX_VISIBLE_IMAGES - offset));
            const imageQuery = db
                .from('court_images')
                .select(`
                    id,
                    court_id,
                    uploaded_by_firebase_uid,
                    cloudinary_public_id,
                    cloudinary_secure_url,
                    created_at
                `, { count: 'exact' })
                .eq('court_id', courtId)
                .order('created_at', { ascending: false });

            const { data, error, count } = limit > 0
                ? await imageQuery.range(offset, offset + limit - 1)
                : { data: [], error: null, count: 0 };

            if (error) {
                return json({ error: 'Unable to load court photos.' }, 503);
            }

            return json({
                images: (data ?? []).map((image) => ({
                    id: image.id,
                    court_id: image.court_id,
                    cloudinary_public_id: image.cloudinary_public_id,
                    cloudinary_secure_url: image.cloudinary_secure_url,
                    created_at: image.created_at,
                    is_mine:
                        uid !== null
                        && image.uploaded_by_firebase_uid === uid,
                })),
                count: count ?? 0,
                limit,
                offset,
            });
        }

        if (!uid) {
            return json({ error: 'Please log in to manage photos.' }, 401);
        }
        
        if (req.method === 'POST') {
            const body = await req.json().catch(() => null);
            const courtId = readCourtId(body?.court_id);
            const publicId = typeof body?.public_id === 'string'
                ? body.public_id.trim()
                : '';
            if (!courtId || !publicId || publicId.length > 255) {
                return json({
                    error: 'A valid court_id and public_id are required.',
                }, 400);
            }
            const expectedPrefix = [
                'court-images',
                safeSegment(courtId),
                safeSegment(uid),
                '',
            ].join('/');

            if (!publicId.startsWith(expectedPrefix)) {
                return json({
                    error: 'This image does not belong to this court and user.',
                }, 403);
            }
            const resourceUrl = [
                `https://api.cloudinary.com/v1_1/${cloudName}`,
                'resources/image/upload',
                encodeURIComponent(publicId),
            ].join('/');

            const cloudinaryResponse = await fetch(resourceUrl, {
                headers: {
                    Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
                }
            });

            if (cloudinaryResponse.status === 404) {
                return json({ error: 'The uploaded image was not found.' }, 404);
            }

            if (!cloudinaryResponse.ok) {
                return json({ error: 'Unable to verify the uploaded image.' }, 503);
            }

            const asset = await cloudinaryResponse.json();
            if (
                asset.public_id !== publicId
                || asset.resource_type !== 'image'
                || asset.type !== 'upload'
                || typeof asset.secure_url !== 'string'
                || !asset.secure_url.startsWith('https://')
            ) {
                return json({ error: 'Cloudinary returned an invalid image.' }, 400);
            }
            const { data, error } = await db
                .from('court_images')
                .insert({
                    court_id: courtId,
                    uploaded_by_firebase_uid: uid,
                    cloudinary_public_id: asset.public_id,
                    cloudinary_secure_url: asset.secure_url,
                })
                .select(`
                    id,
                    court_id,
                    cloudinary_public_id,
                    cloudinary_secure_url,
                    created_at
                `)
                .single();

            if (error?.code === '23505') {
                return json({ error: 'This image has already been saved.' }, 409);
            }

            if (error?.code === '23503') {
                return json({ error: 'The court or user profile was not found.' }, 409);
            }

            if (error?.code === 'P0001') {
                return json({ error: 'You can upload up to 5 photos for each court.' }, 409);
            }

            if (error) {
                return json({ error: 'Unable to save the court image.' }, 503);
            }

            return json({
                image: {
                    ...data,
                    is_mine: true,
                },
            }, 201);
        }

        if (req.method === 'DELETE') {
            const body = await req.json().catch(() => null);

            const imageId = typeof body?.image_id === 'string'
                ? body.image_id.trim()
                : '';

            if (!imageId) {
                return json({ error: 'A valid image_id is required.' }, 400);
            }

            // Ownership is checked using the Firebase UID from the verified token.
            const { data: image, error: imageError } = await db
                .from('court_images')
                .select('id, cloudinary_public_id')
                .eq('id', imageId)
                .eq('uploaded_by_firebase_uid', uid)
                .maybeSingle();

            if (imageError) {
                return json({ error: 'Unable to find the court image.' }, 503);
            }

            if (!image) {
                return json({ error: 'Court image not found.' }, 404);
            }

            const deleteUrl = `https://api.cloudinary.com/v1_1/${cloudName}/resources/image/upload`;

            const deleteBody = new URLSearchParams();
            deleteBody.append('public_ids[]', image.cloudinary_public_id);

            const cloudinaryResponse = await fetch(deleteUrl, {
                method: 'DELETE',
                headers: {
                    Authorization: `Basic ${btoa(`${apiKey}:${apiSecret}`)}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: deleteBody.toString(),
            });

            if (!cloudinaryResponse.ok) {
                return json({
                    error: 'Unable to delete the image from Cloudinary.',
                }, 503);
            }

            const deletion = await cloudinaryResponse.json();
            const cloudinaryStatus = deletion.deleted?.[image.cloudinary_public_id];

            if (
                cloudinaryStatus !== 'deleted'
                && cloudinaryStatus !== 'not_found'
            ) {
                return json({
                    error: 'Cloudinary did not delete the image.',
                }, 503);
            }
            const { data: deleted, error: deleteError } = await db
                .from('court_images')
                .delete()
                .eq('id', image.id)
                .eq('uploaded_by_firebase_uid', uid)
                .select('id')
                .maybeSingle();

            if (deleteError) {
                return json({
                    error: 'The image was removed from Cloudinary, but its database record could not be removed.',
                }, 503);
            }

            if (!deleted) {
                return json({ error: 'Court image not found.' }, 404);
            }

            return json({ deleted: true });
        }

        return json({ error: 'Method not allowed.' }, 405);

    } catch {
        return json({ error: 'Court images service is unavailable. Please try again.' }, 503);
    }
}

if (import.meta.main) Deno.serve(handler);
