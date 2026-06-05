export type Job = {
    id: string;
    name: string;
    description: string;
    locationId: string;
    duration: number; // in seconds
    payout: number;
    requiredFaction?: string;
    wantedIncrease?: number;
};

export const jobs: Record<string, Job> = {
    sweeper: {
        id: "sweeper",
        name: "Street Sweeper",
        description: "Clean up the streets of Los Santos. Safe, honest, and simple work.",
        locationId: "city_hall",
        duration: 30, // 30 seconds
        payout: 150,
    },
    trucker: {
        id: "trucker",
        name: "Ocean Docks Trucker",
        description: "Haul industrial shipments from the cargo docks. Strenuous but rewarding.",
        locationId: "harbor",
        duration: 60, // 60 seconds
        payout: 350,
    },
    loader: {
        id: "loader",
        name: "Warehouse Cargo Loader",
        description: "Load contraband cargo into unmarked trucks. Risky business.",
        locationId: "warehouse_district",
        duration: 45, // 45 seconds
        payout: 500,
        wantedIncrease: 1, // increases wanted level by 1 star
    },
    smuggler: {
        id: "smuggler",
        name: "Airport Contraband Runner",
        description: "Smuggle unregistered packages past airport security guards.",
        locationId: "airport",
        duration: 90, // 90 seconds
        payout: 1000,
        wantedIncrease: 2,
    }
};

export function getJob(jobId: string): Job | undefined {
    return jobs[jobId];
}

export function getJobsByLocation(locationId: string): Job[] {
    return Object.values(jobs).filter(j => j.locationId === locationId);
}
