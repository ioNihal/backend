import { Server } from "socket.io";
import cookie from "cookie"
import jwt, { type JwtPayload } from "jsonwebtoken";
import { registerHandlers } from "./handlers.js";
import { players } from "./state.js";
import { startGlobalVitalTick } from "./vitals.js";
import { initJobsSystem } from "./jobs.js";
import { ONLINE_PLAYERS } from "../lib/redisKeys.js";
import redis from "../lib/redis.js";

export function initSockets(io: Server) {
    // Clear any stale online players on startup/restart
    redis.del(ONLINE_PLAYERS).catch(err => {
        console.error("[Sockets] Failed to clear ONLINE_PLAYERS on startup:", err);
    });

    // Start global vitals tick
    startGlobalVitalTick(io);

    // Initialize jobs timer subscription
    initJobsSystem(io);

    // middleware for auth
    io.use((socket, next) => {
        try {
            const rawCookie = socket.handshake.headers.cookie;

            if (!rawCookie) return next(new Error("No Cookies"));

            const parsed = cookie.parse(rawCookie);
            const token = parsed.session;

            if (!token) return next(new Error("No session token"));

            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET!
            ) as JwtPayload;

            // Attach user to socket
            socket.data.user = {
                userId: decoded.userId,
                discordId: decoded.discordId
            };

            next();
        } catch {
            next(new Error("Authentication failed"));
        }
    })


    io.on("connection", (socket) => {
        console.log("Authenticated socket:", socket.data.user.userId);

        registerHandlers(io, socket);

        socket.on("disconnect", () => {
            const player = players.get(socket.id);
            players.delete(socket.id);
            console.log("User disconnected:", socket.id);

            if (player) {
                io.to(player.location).emit("chat", { name: "SYSTEM", message: `${player.name} has disconnected.` });
                
                // Broadcast updated room players
                const roomPlayers = Array.from(players.values())
                    .filter(p => p.location === player.location)
                    .map(p => ({ characterId: p.characterId, name: p.name }));
                io.to(player.location).emit("roomPlayers", roomPlayers);
            }
        });
    });
}