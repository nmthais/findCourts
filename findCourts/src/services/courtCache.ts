import Storage from 'expo-sqlite/kv-store';
import type { Court } from "@/type/Court";

// One fallback batch across all areas, with no expiry; this is not a cache keyed by map bounds.
const LAST_COURTS_KEY = 'courts:last-successful-batch';

type CachedCourtBatch = {
    courts: Court[];
    savedAt: string;
};

export async function loadCachedCourts() {
    try {
        const storedValue = await Storage.getItem(LAST_COURTS_KEY);
        if (!storedValue) return null;

        const cached = JSON.parse(storedValue) as CachedCourtBatch;
        return Array.isArray(cached.courts) ? cached : null;
    } catch (error) {
        console.warn('Unable to read the saved court batch.', error);
        return null;
    }
}

export async function saveCachedCourts(courts: Court[]) {
    // Keep the last useful batch rather than replacing it with an empty area.
    if (courts.length === 0) return;

    const cached: CachedCourtBatch = {
        courts,
        savedAt: new Date().toISOString(),
    };

    try {
        await Storage.setItem(LAST_COURTS_KEY, JSON.stringify(cached));
    } catch (error) {
        // Persistence is a fallback; it must not turn a successful network load into a failure.
        console.warn('Unable to save the court batch.', error);
    }
}
