import { registerCommand } from "./index.js";
import type { CommandContext } from "./index.js";
import { createClient } from "redis";

/**
 * Radio system using Redis Pub/Sub.
 *
 * Each frequency number becomes a Redis Pub/Sub channel: "radio:{freq}"
 * Players subscribe/unsubscribe to these channels.
 * Messages published to a frequency are received by all subscribers.
 *
 * We need a SEPARATE Redis client for subscriptions (Redis requirement:
 * a client in subscribe mode can't run other commands).
 */

// Subscriber client — created once, used for all radio subscriptions
let subscriber: ReturnType<typeof createClient> | null = null;

// Track which frequencies each socket is subscribed to
// and map frequencies → set of socketIds for message routing
const socketFrequencies = new Map<string, number>(); // socketId → frequency
const frequencyListeners = new Map<number, Set<string>>(); // frequency → Set<socketId>

async function getSubscriber(): Promise<ReturnType<typeof createClient>> {
    if (!subscriber) {
        subscriber = createClient({ url: process.env.REDIS_URL || "redis://localhost:6379" });
        subscriber.on("error", err => console.error("[Radio Subscriber] Error:", err));
        await subscriber.connect();
    }
    return subscriber;
}

function radioChannelName(freq: number): string {
    return `radio:${freq}`;
}

// ═══════════════════════════════════════════════════════════════
//  /setfreq [number] — Tune into a radio frequency
// ═══════════════════════════════════════════════════════════════

registerCommand("setfreq", async (ctx: CommandContext, args: string[]) => {
    const freqStr = args[0];
    if (!freqStr) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /setfreq [frequency_number]" });
        return;
    }

    const freq = parseFloat(freqStr);
    if (isNaN(freq) || freq < 1 || freq > 999) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Frequency must be a number between 1 and 999." });
        return;
    }

    // Leave current frequency if any
    const currentFreq = socketFrequencies.get(ctx.socket.id);
    if (currentFreq !== undefined) {
        const listeners = frequencyListeners.get(currentFreq);
        if (listeners) {
            listeners.delete(ctx.socket.id);
            if (listeners.size === 0) {
                frequencyListeners.delete(currentFreq);
                // Unsubscribe from Redis channel if no more listeners
                const sub = await getSubscriber();
                await sub.unsubscribe(radioChannelName(currentFreq));
            }
        }
    }

    // Join new frequency
    socketFrequencies.set(ctx.socket.id, freq);

    if (!frequencyListeners.has(freq)) {
        frequencyListeners.set(freq, new Set());

        // Subscribe to Redis channel for this frequency
        const sub = await getSubscriber();
        await sub.subscribe(radioChannelName(freq), (message) => {
            // Relay to all sockets tuned to this frequency
            const data = JSON.parse(message) as { name: string; message: string };
            const listeners = frequencyListeners.get(freq);
            if (listeners) {
                for (const socketId of listeners) {
                    ctx.io.to(socketId).emit("chat", {
                        channel: "radio",
                        name: data.name,
                        message: `[RADIO ${freq}] ${data.message}`,
                    });
                }
            }
        });
    }

    frequencyListeners.get(freq)!.add(ctx.socket.id);

    // Update in-memory state
    ctx.player.radioFrequency = freq;

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `📻 Radio tuned to frequency ${freq}. Use /radio [message] to broadcast.`,
    });
}, "Tune your radio to a frequency", "/setfreq [number]");

// ═══════════════════════════════════════════════════════════════
//  /radio [message] — Broadcast on current frequency
// ═══════════════════════════════════════════════════════════════

registerCommand("radio", async (ctx: CommandContext, args: string[]) => {
    const message = args.join(" ").trim();
    if (!message) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /radio [message]" });
        return;
    }

    const freq = socketFrequencies.get(ctx.socket.id);
    if (freq === undefined) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are not tuned to any frequency. Use /setfreq [number] first." });
        return;
    }

    // Publish to Redis — all subscribers will receive it
    const { default: redis } = await import("../../lib/redis.js");
    await redis.publish(radioChannelName(freq), JSON.stringify({
        name: ctx.player.name,
        message,
    }));
}, "Broadcast a message on your radio frequency", "/radio [message]");

// ═══════════════════════════════════════════════════════════════
//  /radiooff — Leave current frequency
// ═══════════════════════════════════════════════════════════════

registerCommand("radiooff", async (ctx: CommandContext) => {
    const freq = socketFrequencies.get(ctx.socket.id);
    if (freq === undefined) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are not tuned to any frequency." });
        return;
    }

    // Remove from frequency
    socketFrequencies.delete(ctx.socket.id);
    const listeners = frequencyListeners.get(freq);
    if (listeners) {
        listeners.delete(ctx.socket.id);
        if (listeners.size === 0) {
            frequencyListeners.delete(freq);
            const sub = await getSubscriber();
            await sub.unsubscribe(radioChannelName(freq));
        }
    }

    ctx.player.radioFrequency = null;

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: "📻 Radio turned off.",
    });
}, "Turn off your radio", "/radiooff");

/**
 * Cleanup function — call when a socket disconnects
 * to remove them from radio frequency tracking.
 */
export async function cleanupRadio(socketId: string): Promise<void> {
    const freq = socketFrequencies.get(socketId);
    if (freq === undefined) return;

    socketFrequencies.delete(socketId);
    const listeners = frequencyListeners.get(freq);
    if (listeners) {
        listeners.delete(socketId);
        if (listeners.size === 0) {
            frequencyListeners.delete(freq);
            try {
                const sub = await getSubscriber();
                await sub.unsubscribe(radioChannelName(freq));
            } catch {
                // Best effort — subscriber may already be closed
            }
        }
    }
}
