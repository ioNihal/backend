import type { Server } from "socket.io";
import { createClient } from "redis";
import redis from "../lib/redis.js";
import { players } from "./state.js";
import { Character } from "../models/Character.js";
import { getJob } from "../data/jobs.js";
import { mapNodes } from "../data/map.js";

let subClient: ReturnType<typeof createClient> | null = null;

/**
 * Initializes the Redis keyspace subscriber to listen for expired job timers.
 */
export async function initJobsSystem(io: Server) {
    try {
        // Programmatically enable keyspace expired notifications in Redis/Memurai
        await redis.configSet("notify-keyspace-events", "Ex");

        // Duplicate client for subscription channel
        subClient = redis.duplicate();
        await subClient.connect();

        // Subscribe to keyspace events
        await subClient.subscribe("__keyevent@0__:expired", async (key) => {
            if (key.startsWith("job:timer:")) {
                const socketId = key.replace("job:timer:", "");
                await handleJobComplete(io, socketId);
            }
        });

        console.log("[Jobs] Redis Keyspace Notification subscriber active.");
    } catch (err) {
        console.error("[Jobs] Failed to initialize jobs subscription:", err);
    }
}

/**
 * Cleanup subscription client on shutdown.
 */
export async function cleanupJobsSystem() {
    if (subClient) {
        await subClient.unsubscribe("__keyevent@0__:expired").catch(() => {});
        await subClient.quit().catch(() => {});
    }
}

/**
 * Payout the player and increase wanted level once job timer expires.
 */
export async function handleJobComplete(io: Server, socketId: string) {
    try {
        const metaKey = `job:meta:${socketId}`;
        const meta = await redis.hGetAll(metaKey);

        // Instantly delete metadata to avoid double payouts
        await redis.del(metaKey);

        if (!meta || Object.keys(meta).length === 0) return;

        const player = players.get(socketId);
        if (!player) return; // Disconnected before completion

        const { jobId, payout, wantedIncrease } = meta;
        const payoutCash = parseInt(payout || "0", 10);
        const wantedInc = parseInt(wantedIncrease || "0", 10);

        const character = await Character.findOne({ characterId: player.characterId });
        if (!character) return;

        // Apply payout & wanted changes
        character.cash = (character.cash ?? 0) + payoutCash;
        if (wantedInc > 0) {
            character.wantedLevel = Math.min(5, (character.wantedLevel ?? 0) + wantedInc);
        }
        await character.save();

        const job = getJob(jobId || "");
        const jobName = job ? job.name : "Job";

        // Log completion chat message
        io.to(socketId).emit("chat", {
            channel: "system",
            name: "SYSTEM",
            message: `💼 Job Complete: You finished working as a ${jobName} and earned $${payoutCash}!`,
        });

        if (wantedInc > 0) {
            io.to(socketId).emit("chat", {
                channel: "error",
                name: "SYSTEM",
                message: `🚨 Crime Alert: You drew local police attention! Wanted level +${wantedInc} star(s).`,
            });
            io.to(socketId).emit("notification", {
                type: "danger",
                message: "Wanted level increased!",
            });
        } else {
            io.to(socketId).emit("notification", {
                type: "success",
                message: `Earned $${payoutCash} as ${jobName}`,
            });
        }

        // Push vitals and cash updates
        io.to(socketId).emit("vitalsUpdate", {
            health: player.health,
            hunger: player.hunger,
            thirst: player.thirst,
            energy: player.energy,
            cash: character.cash,
            bank: character.bankBalance ?? 0,
            wantedLevel: character.wantedLevel ?? 0,
            radioFrequency: player.radioFrequency,
        });

        // Notify client job status is complete
        io.to(socketId).emit("jobUpdate", {
            status: "idle",
            jobName: null,
            timeLeft: 0,
            payout: 0,
        });

    } catch (err) {
        console.error(`[Jobs] handleJobComplete error for socket ${socketId}:`, err);
    }
}

/**
 * Start a job, creating Redis metadata hash and setting active TTL timer.
 */
export async function startJob(socketId: string, jobId: string): Promise<{ success: boolean; message: string }> {
    const player = players.get(socketId);
    if (!player) return { success: false, message: "Player not online." };

    if (player.isDead) return { success: false, message: "You cannot work while downed." };

    const job = getJob(jobId);
    if (!job) return { success: false, message: "Invalid job ID." };

    // Verify player location matches job location
    if (player.location !== job.locationId) {
        const node = mapNodes[job.locationId];
        return { success: false, message: `You must be at ${node?.name || job.locationId} to perform this job.` };
    }

    // Check if already busy
    const timerKey = `job:timer:${socketId}`;
    const active = await redis.get(timerKey);
    if (active) {
        return { success: false, message: "You are already working! Use /stopwork to cancel." };
    }

    const metaKey = `job:meta:${socketId}`;
    await redis.hSet(metaKey, {
        jobId: job.id,
        payout: String(job.payout),
        wantedIncrease: String(job.wantedIncrease || 0),
    });

    await redis.set(timerKey, "active", { EX: job.duration });

    return { success: true, message: `You started working as a ${job.name}. Duration: ${job.duration}s.` };
}

/**
 * Cancel the active job timer.
 */
export async function stopJob(socketId: string): Promise<boolean> {
    const timerKey = `job:timer:${socketId}`;
    const metaKey = `job:meta:${socketId}`;

    const active = await redis.get(timerKey);
    if (!active) return false;

    await redis.del(timerKey);
    await redis.del(metaKey);
    return true;
}

/**
 * Fetch current job status and time remaining.
 */
export async function getJobStatus(socketId: string) {
    const timerKey = `job:timer:${socketId}`;
    const metaKey = `job:meta:${socketId}`;

    const ttl = await redis.ttl(timerKey);
    if (ttl <= 0) return null;

    const meta = await redis.hGetAll(metaKey);
    if (!meta || Object.keys(meta).length === 0) return null;

    const job = getJob(meta.jobId || "");
    return {
        jobId: meta.jobId,
        jobName: job ? job.name : "Job",
        timeLeft: ttl,
        payout: job ? job.payout : 0,
    };
}
