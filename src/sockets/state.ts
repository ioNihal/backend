export type PlayerState = {
    userId: string;
    characterId: string;
    name: string;
    location: string;
    faction: string;
    factionRank: number;
    health: number;
    hunger: number;
    thirst: number;
    energy: number;
    isDead: boolean;
    wantedLevel: number;
    radioFrequency: number | null;
    inCall: string | null;    // target characterId if in active call
    phoneNumber: string;
    socketId: string;         // reverse lookup for whispers/calls
    x: number;
    y: number;
};

export const players = new Map<string, PlayerState>();
