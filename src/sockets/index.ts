import { Server } from "socket.io";
import cookie from "cookie"
import jwt, { type JwtPayload } from "jsonwebtoken";
import { registerHandlers } from "./handlers.js";
import { players } from "./state.js";

export function initSockets(io: Server) {

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
            players.delete(socket.id);
            console.log("User disconnected:", socket.id);
        })
    });
}