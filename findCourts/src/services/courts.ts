import {
    FunctionsFetchError,
    FunctionsHttpError,
    FunctionsRelayError,
} from '@supabase/supabase-js';

import type { Court } from '@/type/Court';
import type { CourtBounds } from '@/type/CourtBounds';
import { supabase } from '@/lib/supabase';

type GetCourtsResponse = {
    courts: Court[];
    cache: {
        fetchedTiles: number;
        reusedTiles: number;
        addressEnrichmentStarted: number;
        pendingTiles: number;
        pendingAddresses: number;
        discoveryStatus: 'cached' | 'disabled' | 'unconfigured' | 'deferred' | 'failed' | 'fetched';
    };
};

type SearchCourtsResponse = {
    courts: Court[];
};

async function throwFunctionError(error: unknown): Promise<never> {
    if (error instanceof FunctionsHttpError) {
        const responseBody = await error.context.clone().json().catch(() => null) as {
            error?: string;
            message?: string;
        } | null;
        throw new Error(responseBody?.error ?? responseBody?.message ?? error.message);
    }

    if (error instanceof FunctionsRelayError) {
        throw new Error(`Supabase function relay error: ${error.message}`);
    }

    if (error instanceof FunctionsFetchError) {
        throw new Error(`Unable to reach Supabase: ${error.message}`);
    }

    throw error;
}

export async function getCourts(bounds: CourtBounds) {
    if (!supabase) {
        throw new Error('Supabase environment variables are not configured.');
    }

    const { data, error } = await supabase.functions.invoke<GetCourtsResponse>('get-courts', {
        body: bounds,
    });

    if (error) {
        await throwFunctionError(error);
    }

    if (!data) {
        throw new Error('The court service returned no data.');
    }

    return data;
}

export async function searchCourts(query: string) {
    if (!supabase) return [];

    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) return [];

    const { data, error } = await supabase.functions.invoke<SearchCourtsResponse>('search-courts', {
        body: { query: normalizedQuery },
    });

    if (error) {
        await throwFunctionError(error);
    }

    return data?.courts ?? [];
}
