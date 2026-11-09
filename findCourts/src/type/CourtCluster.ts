import type { Court } from "./Court";
export type CourtCluster = {
    id: string;
    selectedCourtId?: string;
    courts: Court[];
    latitude: number;
    longitude: number;
};
