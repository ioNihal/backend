import type { Server, Socket } from "socket.io";
import { players } from "./state.js";
import { Character } from "../models/Character.js";
import redis from "../lib/redis.js";
import { CALL, ONLINE_PLAYERS, VITALS } from "../lib/redisKeys.js";
import { dispatchCommand } from "./commands/index.js";
import { cleanupRadio } from "./commands/radio.js";

// ── Register all command modules ────────────────────────────
// Side-effect imports: each file calls registerCommand() on import
import "./commands/chat.js";
import "./commands/navigation.js";
import "./commands/phone.js";
import "./commands/radio.js";
import "./commands/inventory.js";


export function registerHandlers(io: Server, socket: Socket) {

    const broadcastRoomData = (locationId: string) => {
        const roomPlayers = Array.from(players.values())
            .filter(p => p.location === locationId)
            .map(p => ({
                characterId: p.characterId,
                name: p.name,
                faction: p.faction,
                isDead: p.isDead,
            }));
        io.to(locationId).emit("roomPlayers", roomPlayers);
    };

    // ═══════════════════════════════════════════════════════════
    //  enterCity — Player enters the game world
    // ═══════════════════════════════════════════════════════════

    socket.on("enterCity", async ({ characterId }: { characterId: string }) => {
        try {
            const user = socket.data.user;

            const character = await Character.findOne({
                characterId,
                userId: user.userId,
            });

            if (!character) {
                return socket.emit("error", "Character not found");
            }

            // Join the socket room for the character's location
            socket.join(character.location);

            // Build player state from DB
            const playerState = {
                userId: user.userId as string,
                characterId: character.characterId,
                name: character.name,
                location: character.location,
                faction: character.faction ?? "none",
                factionRank: character.factionRank ?? 0,
                health: character.health ?? 100,
                hunger: character.hunger ?? 100,
                thirst: character.thirst ?? 100,
                energy: character.energy ?? 100,
                isDead: character.isDead ?? false,
                wantedLevel: character.wantedLevel ?? 0,
                radioFrequency: (character.radioFrequency ?? null) as number | null,
                inCall: null,
                phoneNumber: character.phoneNumber ?? "0000",
                socketId: socket.id,
                x: 0,
                y: 0,
            };

            players.set(socket.id, playerState);

            // Track online in Redis
            await redis.sAdd(ONLINE_PLAYERS, socket.id);

            // Cache vitals in Redis HASH
            await redis.hSet(VITALS(character.characterId), {
                health: String(playerState.health),
                hunger: String(playerState.hunger),
                thirst: String(playerState.thirst),
                energy: String(playerState.energy),
                lastTick: String(Date.now()),
            });

            // Update lastPlayed
            character.lastPlayed = new Date();
            await character.save();

            // Send entry confirmation
            socket.emit("enteredCity", {
                location: character.location,
            });

            // ── Boot Sequence ──────────────────────────────────
            // Send a batch of useful info on connect
            socket.emit("chat", {
                channel: "system",
                name: "SYSTEM",
                message: `Connected as ${character.name}. Location: ${character.location}. Type /look to see your surroundings, /help for commands.`,
            });

            // Send vitals snapshot
            socket.emit("vitalsUpdate", {
                health: playerState.health,
                hunger: playerState.hunger,
                thirst: playerState.thirst,
                energy: playerState.energy,
                cash: character.cash ?? 0,
            });

            // Send inventory snapshot
            socket.emit("inventoryUpdate", {
                inventory: character.inventory || [],
            });

            // Announce arrival to room
            socket.broadcast.to(character.location).emit("chat", {
                channel: "system",
                name: "SYSTEM",
                message: `${character.name} has appeared.`,
            });

            // Sync player list
            broadcastRoomData(character.location);

            console.log(`[MUD] ${character.name} entered ${character.location}`);
        } catch (err) {
            console.error("[enterCity] Error:", err);
            socket.emit("error", "Server error");
        }
    });

    // ═══════════════════════════════════════════════════════════
    //  chat — All chat messages and commands
    // ═══════════════════════════════════════════════════════════

    socket.on("chat", async ({ message }: { message: string }) => {
        const player = players.get(socket.id);
        if (!player) return;

        if (!message || typeof message !== "string") return;
        if (message.length > 500) return;

        // ── Phone Call Interception ────────────────────────────
        // If player is in an active call and message doesn't start with /,
        // route it as call dialogue
        if (!message.startsWith("/") && player.inCall) {
            const callState = await redis.get(CALL(player.characterId));
            if (callState && callState.startsWith("active:")) {
                const targetCharId = callState.split(":")[1]!;
                const target = Array.from(players.values()).find(p => p.characterId === targetCharId);
                if (target) {
                    // Send to both parties as call channel
                    socket.emit("chat", {
                        channel: "phone",
                        name: player.name,
                        message: `[CALL] ${message}`,
                    });
                    io.to(target.socketId).emit("chat", {
                        channel: "phone",
                        name: player.name,
                        message: `[CALL] ${message}`,
                    });
                    return;
                }
            }
        }

        // ── Command Dispatch ──────────────────────────────────
        const wasCommand = await dispatchCommand({ io, socket, player }, message);
        if (wasCommand) return;

        // ── Proximity Chat (Default) ──────────────────────────
        io.to(player.location).emit("chat", {
            channel: "proximity",
            name: player.name,
            message,
        });
    });

    // ═══════════════════════════════════════════════════════════
    //  disconnect — Cleanup
    // ═══════════════════════════════════════════════════════════

    socket.on("disconnect", async () => {
        const player = players.get(socket.id);
        players.delete(socket.id);
        console.log("[MUD] User disconnected:", socket.id);

        // Remove from Redis online set
        await redis.sRem(ONLINE_PLAYERS, socket.id).catch(() => {});

        // Cleanup radio subscriptions
        await cleanupRadio(socket.id);

        // Cleanup active calls
        if (player?.inCall) {
            const callState = await redis.get(CALL(player.characterId));
            if (callState) {
                const otherCharId = callState.split(":")[1]!;
                await redis.del(CALL(player.characterId));
                await redis.del(CALL(otherCharId));
                const other = Array.from(players.values()).find(p => p.characterId === otherCharId);
                if (other) {
                    other.inCall = null;
                    io.to(other.socketId).emit("chat", { channel: "phone", name: "PHONE", message: "📱 Call ended — other party disconnected." });
                    io.to(other.socketId).emit("callEnded", {});
                }
            }
        }

        if (player) {
            io.to(player.location).emit("chat", {
                channel: "system",
                name: "SYSTEM",
                message: `${player.name} has disconnected.`,
            });

            // Sync player list for the room
            broadcastRoomData(player.location);
        }
    });
}
