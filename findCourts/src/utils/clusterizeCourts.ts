import type { Court } from "@/type/Court";
import type { CourtCluster } from "@/type/CourtCluster";

const CLUSTER_DISTANCE_METRES = 80;
const EARTH_APPROX_RADIUS_METRES = 6371000;
// Haversine distance keeps the clustering threshold in metres rather than map degrees.
export function distanceInMetres(a: Court, b: Court) {
    const radians = (degrees: number) => degrees * Math.PI / 180;
    const latitudeDelta = radians(b.latitude - a.latitude);
    const longitudeDelta = radians(b.longitude - a.longitude);
    const latitude1 = radians(a.latitude);
    const latitude2 = radians(b.latitude);
    const haversine = Math.sin(latitudeDelta / 2) ** 2
        + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;

    return EARTH_APPROX_RADIUS_METRES * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

// Group connected courts: each neighbour is within 80 metres of another member,
// but a chain of neighbours can make the overall cluster wider than 80 metres.
export function clusterCourts(courts: Court[]): CourtCluster[] {
    // Removing a court when discovered assigns each ID to exactly one cluster.
    const unvisited = new Set(courts.map((court) => court.id));
    const byId = new Map(courts.map((court) => [court.id, court]));
    const clusters: CourtCluster[] = [];

    for (const court of courts) {
        if (!unvisited.delete(court.id)) continue;

        const members = [court];
        // Newly appended members are visited too, extending the search through neighbours.
        for (let index = 0; index < members.length; index += 1) {
            const current = members[index];
            for (const candidateId of Array.from(unvisited)) {
                const candidate = byId.get(candidateId)!;
                if (distanceInMetres(current, candidate) <= CLUSTER_DISTANCE_METRES) {
                    unvisited.delete(candidateId);
                    members.push(candidate);
                }
            }
        }

        clusters.push({
            // Sorting makes the marker ID independent of the input order for these members.
            id: members.map((member) => member.id).sort().join(','),
            courts: members,
            // Place the marker at the average coordinate of its members.
            latitude: members.reduce((sum, member) => sum + member.latitude, 0) / members.length,
            longitude: members.reduce((sum, member) => sum + member.longitude, 0) / members.length,
        });
    }

    return clusters;
}
