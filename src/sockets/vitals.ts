import type { Server } from "socket.io";
import { players } from "./state.js";
import { Character } from "../models/Character.js";
import redis from "../lib/redis.js";

let tickInterval: NodeJS.Timeout | null = null;
let syncInterval: NodeJS.Timeout | null = null;

/**
 * Sync active players' vitals from memory/Redis back to MongoDB.
 */
export async function syncVitalsToMongo() {
    try {
        const activePlayers = Array.from(players.values());
        if (activePlayers.length === 0) return;

        console.log(`[Vitals] Syncing vitals for ${activePlayers.length} active players to MongoDB...`);
        for (const player of activePlayers) {
            await Character.updateOne(
                { characterId: player.characterId },
                {
                    health: player.health,
                    hunger: player.hunger,
                    thirst: player.thirst,
                    energy: player.energy,
                    isDead: player.isDead,
                }
            );
        }
        console.log("[Vitals] Sync complete.");
    } catch (err) {
        console.error("[Vitals] Sync to MongoDB failed:", err);
    }
}

/**
 * Start the global vital draining tick (runs every 60s) and batch sync (runs every 5m).
 */
export function startGlobalVitalTick(io: Server) {
    if (tickInterval) clearInterval(tickInterval);
    if (syncInterval) clearInterval(syncInterval);

    // Run vital drain tick every 60 seconds
    tickInterval = setInterval(async () => {
        try {
            const onlineSockets = await redis.sMembers("online:players");
            for (const socketId of onlineSockets) {
                const player = players.get(socketId);
                if (!player) continue;

                // Retrieve current vitals cache from Redis HASH
                const vitalsData = await redis.hGetAll(`vitals:${player.characterId}`);
                let health = Object.keys(vitalsData).length ? parseFloat(vitalsData.health || "100") : player.health;
                let hunger = Object.keys(vitalsData).length ? parseFloat(vitalsData.hunger || "100") : player.hunger;
                let thirst = Object.keys(vitalsData).length ? parseFloat(vitalsData.thirst || "100") : player.thirst;
                let energy = Object.keys(vitalsData).length ? parseFloat(vitalsData.energy || "100") : player.energy;
                const lastTick = Object.keys(vitalsData).length ? parseInt(vitalsData.lastTick || String(Date.now()), 10) : Date.now();

                const now = Date.now();
                const secondsElapsed = Math.max(0, (now - lastTick) / 1000);

                // Drain calculations (1 unit per 60s for hunger/energy, 1.5 units per 60s for thirst)
                const hungerDrain = (1 * secondsElapsed) / 60;
                const thirstDrain = (1.5 * secondsElapsed) / 60;
                const energyDrain = (1 * secondsElapsed) / 60;

                hunger = Math.max(0, hunger - hungerDrain);
                thirst = Math.max(0, thirst - thirstDrain);
                energy = Math.max(0, energy - energyDrain);

                // Health penalty if starving/dehydrated
                let healthDamage = 0;
                if (hunger <= 0) healthDamage += (5 * secondsElapsed) / 60;
                if (thirst <= 0) healthDamage += (10 * secondsElapsed) / 60;

                if (healthDamage > 0 && !player.isDead) {
                    health = Math.max(0, health - healthDamage);
                }

                // If health hits zero, player is downed
                if (health <= 0 && !player.isDead) {
                    health = 0;
                    player.isDead = true;

                    // Broadcast collapse to the room
                    io.to(player.location).emit("chat", {
                        channel: "action",
                        name: "SYSTEM",
                        message: `** ${player.name} has collapsed from starvation/dehydration. **`,
                    });

                    // Update room player list immediately with the DOWNED status
                    const roomPlayers = Array.from(players.values())
                        .filter(p => p.location === player.location)
                        .map(p => ({
                            characterId: p.characterId,
                            name: p.name,
                            faction: p.faction,
                            isDead: p.characterId === player.characterId ? true : p.isDead,
                        }));
                    io.to(player.location).emit("roomPlayers", roomPlayers);

                    // Persist death immediately to DB
                    await Character.updateOne(
                        { characterId: player.characterId },
                        { isDead: true }
                    ).exec().catch(err => console.error("Failed to update death state in DB:", err));
                }

                // Update L1 Cache (in-memory RAM)
                player.health = Math.round(health * 10) / 10;
                player.hunger = Math.round(hunger * 10) / 10;
                player.thirst = Math.round(thirst * 10) / 10;
                player.energy = Math.round(energy * 10) / 10;

                // Save back to Redis HASH
                await redis.hSet(`vitals:${player.characterId}`, {
                    health: String(player.health),
                    hunger: String(player.hunger),
                    thirst: String(player.thirst),
                    energy: String(player.energy),
                    lastTick: String(now),
                });

                // Fetch cash count from DB
                const character = await Character.findOne({ characterId: player.characterId });
                const cash = character ? (character.cash ?? 0) : 0;

                // Push vitalsUpdate to the socket
                io.to(socketId).emit("vitalsUpdate", {
                    health: player.health,
                    hunger: player.hunger,
                    thirst: player.thirst,
                    energy: player.energy,
                    cash,
                });
            }
        } catch (err) {
            console.error("[Vitals] Global tick error:", err);
        }
    }, 60000);

    // Run vital DB sync every 5 minutes
    syncInterval = setInterval(async () => {
        await syncVitalsToMongo();
    }, 300000);
}

/**
 * Instantly restores/applies an effect (e.g. food/drink/meds) to a player's vitals.
 */
export async function applyVitalEffect(
    socketId: string,
    effect: { hunger?: number; thirst?: number; health?: number; energy?: number },
    io: Server
) {
    const player = players.get(socketId);
    if (!player) return;

    // Load from Redis to ensure we start from the latest values
    const vitalsData = await redis.hGetAll(`vitals:${player.characterId}`);
    let health = Object.keys(vitalsData).length ? parseFloat(vitalsData.health || "100") : player.health;
    let hunger = Object.keys(vitalsData).length ? parseFloat(vitalsData.hunger || "100") : player.hunger;
    let thirst = Object.keys(vitalsData).length ? parseFloat(vitalsData.thirst || "100") : player.thirst;
    let energy = Object.keys(vitalsData).length ? parseFloat(vitalsData.energy || "100") : player.energy;

    if (effect.hunger) hunger = Math.min(100, Math.max(0, hunger + effect.hunger));
    if (effect.thirst) thirst = Math.min(100, Math.max(0, thirst + effect.thirst));
    if (effect.health && !player.isDead) health = Math.min(100, Math.max(0, health + effect.health));
    if (effect.energy) energy = Math.min(100, Math.max(0, energy + effect.energy));

    // Update L1 cache
    player.health = Math.round(health * 10) / 10;
    player.hunger = Math.round(hunger * 10) / 10;
    player.thirst = Math.round(thirst * 10) / 10;
    player.energy = Math.round(energy * 10) / 10;

    // Update Redis
    await redis.hSet(`vitals:${player.characterId}`, {
        health: String(player.health),
        hunger: String(player.hunger),
        thirst: String(player.thirst),
        energy: String(player.energy),
        lastTick: String(Date.now()),
    });

    const character = await Character.findOne({ characterId: player.characterId });
    const cash = character ? (character.cash ?? 0) : 0;

    // Emit updated vitals
    io.to(socketId).emit("vitalsUpdate", {
        health: player.health,
        hunger: player.hunger,
        thirst: player.thirst,
        energy: player.energy,
        cash,
    });
}
