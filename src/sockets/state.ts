export type PlayerState = {
    userId: string;
    characterId: string;
    name: string;
    location: string;
    x: number;
    y: number;
};

export const players = new Map<string, PlayerState>();
