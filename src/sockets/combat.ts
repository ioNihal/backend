import type { Server } from "socket.io";
import { players } from "./state.js";
import { Character } from "../models/Character.js";
import { getItem } from "../data/items.js";
import redis from "../lib/redis.js";
import { COMBAT, VITALS } from "../lib/redisKeys.js";

/**
 * Resolves a dice roll to hit and compute damage for a weapon.
 */
export function resolveFire(weaponId: string) {
    const weapon = getItem(weaponId);
    if (!weapon || !weapon.weaponStats) {
        return { hit: false, damage: 0, roll: 0 };
    }

    const accuracy = weapon.weaponStats.accuracy; // 0-100
    const roll = Math.floor(Math.random() * 100) + 1;
    const hit = roll <= accuracy;

    const damage = hit
        ? Math.floor(Math.random() * (weapon.weaponStats.maxDamage - weapon.weaponStats.minDamage + 1)) + weapon.weaponStats.minDamage
        : 0;

    return { hit, damage, roll };
}

/**
 * Down a player when they hit 0 HP, handling death cooldown and stats.
 */
export async function applyDeath(io: Server, targetSocketId: string, attackerName: string) {
    const target = players.get(targetSocketId);
    if (!target) return;

    target.health = 0;
    target.isDead = true;

    // Remove combat state
    await redis.del(COMBAT(targetSocketId));

    // Update Redis vitals HASH
    await redis.hSet(VITALS(target.characterId), {
        health: "0",
        lastTick: String(Date.now()),
    });

    // Start 5-minute hospital respawn cooldown (300 seconds)
    const respawnKey = `respawn:${target.characterId}`;
    await redis.set(respawnKey, "active", { EX: 300 });

    // Update target character document
    await Character.updateOne(
        { characterId: target.characterId },
        { 
            health: 0, 
            isDead: true,
            $inc: { deathCount: 1 }
        }
    ).catch(err => console.error("Failed to update target death:", err));

    // Increment attacker kill count if applicable
    if (attackerName !== "SYSTEM") {
        await Character.updateOne(
            { name: attackerName },
            { $inc: { killCount: 1 } }
        ).catch(err => console.error("Failed to update attacker kills:", err));
    }

    // Broadcast death to the room
    io.to(target.location).emit("chat", {
        channel: "action",
        name: "SYSTEM",
        message: `** ${target.name} has been downed by ${attackerName}. **`,
    });

    // Update room player list to show DOWNED state
    const roomPlayers = Array.from(players.values())
        .filter(p => p.location === target.location)
        .map(p => ({
            characterId: p.characterId,
            name: p.name,
            faction: p.faction,
            isDead: p.isDead,
        }));
    io.to(target.location).emit("roomPlayers", roomPlayers);

    // Emit vitals and combat updates to target
    io.to(targetSocketId).emit("vitalsUpdate", {
        health: 0,
        hunger: target.hunger,
        thirst: target.thirst,
        energy: target.energy,
        cash: 0 // Will fetch actual cash in frontend
    });

    io.to(targetSocketId).emit("combatState", { mode: "idle", targetName: null });
}
