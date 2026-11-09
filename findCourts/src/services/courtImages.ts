import type { User } from 'firebase/auth';
import type { ImagePickerAsset } from 'expo-image-picker';
import { File } from 'expo-file-system';
import { fetch as expoFetch } from 'expo/fetch';
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type CourtImage = {
    id: string;
    court_id: string;
    cloudinary_public_id: string;
    cloudinary_secure_url: string;
    created_at: string;
    is_mine: boolean;
};

export type CourtImagesPage = {
    images: CourtImage[];
    count: number;
    limit: number;
    offset: number;
};

export type UploadSignature = {
    cloudName: string;
    apiKey: string;
    uploadPreset: string;
    publicId: string;
    timestamp: number;
    signature: string;
    uploadUrl: string;
};

export type CloudinaryUpload = {
    publicId: string;
    secureUrl: string;
};

export class ImageError extends Error {}

async function firebaseHeaders(user?: User | null) {
    return user ? { Authorization: `Bearer ${await user.getIdToken()}` } : undefined;
}

async function functionError(error: unknown) {
    if (error instanceof FunctionsHttpError) {
        const body = await error.context.json().catch(() => null);
        return new ImageError(body?.error || 'Unable to access photos. Please try again.');
    }
    return new ImageError('Unable to reach photos. Check your connection and try again.');
}

function requireImages() {
    if (!supabase) throw new ImageError('Images storage is unavailable. Please try again later.');
    return supabase;
}

export async function getCourtImages(courtId: string, user?: User | null, limit = 10, offset = 0): Promise<CourtImagesPage> {
    const client = requireImages()
    const headers = await firebaseHeaders(user);
    const request = [
        `court-images?court_id=${encodeURIComponent(courtId)}`,
        `limit=${limit}`,
        `offset=${offset}`,
    ].join('&');

    const { data, error } = await client.functions.invoke(request, {
        method: 'GET',
        headers: headers,
    });

    if (error) throw await functionError(error);

    return {
        images: Array.isArray(data?.images) ? data.images: [],
        count: typeof data?.count === 'number' ? data.count: 0,
        limit: typeof data?.limit === 'number' ? data.limit : 10,
        offset: typeof data?.offset === 'number' ? data.offset : 0,
    }
}

export async function requestUploadSignature(
    user: User,
    courtId: string,
): Promise<UploadSignature> {
    const client = requireImages();
    const { data, error } = await client.functions.invoke('cloudinary-signature', {
        method: 'POST',
        headers: await firebaseHeaders(user),
        body: { court_id: courtId },
    });
    if (error) throw await functionError(error);

    if (
        typeof data?.cloud_name !== 'string'
        || typeof data?.api_key !== 'string'
        || typeof data?.upload_preset !== 'string'
        || typeof data?.public_id !== 'string'
        || typeof data?.timestamp !== 'number'
        || typeof data?.signature !== 'string'
        || typeof data?.upload_url !== 'string'
    ) {
        throw new ImageError('Unable to prepare the photo upload. Please try again.');
    }

    return {
        cloudName: data.cloud_name,
        apiKey: data.api_key,
        uploadPreset: data.upload_preset,
        publicId: data.public_id,
        timestamp: data.timestamp,
        signature: data.signature,
        uploadUrl: data.upload_url,
    };
}

export async function uploadToCloudinary(
    asset: ImagePickerAsset,
    upload: UploadSignature,
): Promise<CloudinaryUpload> {
    const form = new FormData();
    const file = new File(asset.uri);
    form.append('file', file, asset.fileName || `court-photo-${upload.timestamp}.jpg`);
    form.append('api_key', upload.apiKey);
    form.append('timestamp', String(upload.timestamp));
    form.append('signature', upload.signature);
    form.append('upload_preset', upload.uploadPreset);
    form.append('public_id', upload.publicId);

    let response: Awaited<ReturnType<typeof expoFetch>>;
    try {
        response = await expoFetch(upload.uploadUrl, {
            method: 'POST',
            body: form,
        });
    } catch {
        throw new ImageError('Unable to upload the photo. Check your connection and try again.');
    }

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        throw new ImageError(
            typeof data?.error?.message === 'string'
                ? data.error.message
                : 'Cloudinary could not upload the photo.',
        );
    }

    if (
        data?.public_id !== upload.publicId
        || typeof data?.secure_url !== 'string'
        || !data.secure_url.startsWith('https://')
    ) {
        throw new ImageError('Cloudinary returned an invalid uploaded photo.');
    }

    return {
        publicId: data.public_id,
        secureUrl: data.secure_url,
    };
}

export async function saveCourtImage(
    user: User,
    courtId: string,
    publicId: string,
): Promise<CourtImage> {
    const client = requireImages();
    const { data, error } = await client.functions.invoke('court-images', {
        method: 'POST',
        headers: await firebaseHeaders(user),
        body: {
            court_id: courtId,
            public_id: publicId,
        },
    });
    if (error) throw await functionError(error);
    if (!data?.image) {
        throw new ImageError('The uploaded photo could not be saved.');
    }
    return data.image;
}

export async function deleteCourtImage(user: User, imageId: string) {
    const client = requireImages();
    const { data, error } = await client.functions.invoke('court-images', {
        method: 'DELETE',
        headers: await firebaseHeaders(user),
        body: { image_id: imageId },
    });
    if (error) throw await functionError(error);
    if (!data?.deleted) {
        throw new ImageError('The court photo could not be deleted.');
    }
}
