// Preserve the exact court opened from history when cached clusters are refreshed.
export function focusCourtInCluster<T extends { courts: { id: string }[] }>(
    cluster: T,
    courtId?: string,
): T {
    const index = cluster.courts.findIndex((court) => court.id === courtId);
    if (index <= 0) return cluster;
    return { ...cluster, courts: [cluster.courts[index], ...cluster.courts.filter((_, i) => i !== index)] };
}
