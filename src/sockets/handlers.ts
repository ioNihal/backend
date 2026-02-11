import { Server, Socket } from "socket.io";
import { players } from "./state.js";
import { Character } from "../models/Character.js";


export function registerHandlers(io: Server, socket: Socket) {

    socket.on("enterCity", async ({ characterId }) => {

        try {
            const user = socket.data.user;

            const character = await Character.findOne({
                characterId,
                userId: user.userId
            });

            if (!character) {
                return socket.emit("error", "Character not found");
            }

            socket.join(character.location);

            players.set(socket.id, {
                userId: user.userId,
                characterId: character.characterId,
                name: character.name,
                location: character.location,
                x: 0,
                y: 0
            });

            socket.emit("enteredCity", {
                location: character.location
            });

            console.log(`${character.name} entered ${character.location}`);

        } catch {
            socket.emit("error", "Server error");
        }
    });


    socket.on("chat", ({ message }) => {

        const player = players.get(socket.id);
        if (!player) return;

        if (!message || typeof message !== "string") return;
        if (message.length > 500) return;

        io.to(player.location).emit("chat", {
            name: player.name,
            message
        });

    });
}
