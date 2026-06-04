import { registerCommand } from "./index.js";
import type { CommandContext } from "./index.js";
import { mapNodes } from "../../data/map.js";
import { players } from "../state.js";
import { Character } from "../../models/Character.js";

// ═══════════════════════════════════════════════════════════════
//  /goto [location_id]  or  /move [location_id]
//  Travel between connected locations with delay based on distance
// ═══════════════════════════════════════════════════════════════

function handleMove(ctx: CommandContext, args: string[]): void {
    const targetLocationId = args[0]?.toLowerCase();

    if (!targetLocationId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /goto [location_id]" });
        return;
    }

    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You can't move while downed." });
        return;
    }

    const targetNode = mapNodes[targetLocationId];
    if (!targetNode) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Unknown destination: "${targetLocationId}". Use /look to see available exits.` });
        return;
    }

    const currentNode = mapNodes[ctx.player.location];
    if (!currentNode) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Your current location is unknown." });
        return;
    }

    if (targetLocationId === ctx.player.location) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are already here." });
        return;
    }

    // ── Adjacency Check ────────────────────────────────────
    if (!currentNode.connections.includes(targetLocationId)) {
        const availableExits = currentNode.connections
            .map(id => {
                const n = mapNodes[id];
                return n ? `${n.name} (${id})` : id;
            })
            .join(", ");

        ctx.socket.emit("chat", {
            channel: "error",
            name: "SYSTEM",
            message: `You cannot reach ${targetNode.name} from here. Available exits: ${availableExits}`,
        });
        return;
    }

    // ── Travel Delay ───────────────────────────────────────
    const dx = targetNode.x - currentNode.x;
    const dy = targetNode.y - currentNode.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // Base delay: 10ms per unit of distance, clamped 1–5 seconds
    let delayMs = Math.max(1000, Math.min(5000, distance * 10));

    // Hunger penalty: +50% travel time if starving
    if (ctx.player.hunger < 20) {
        delayMs *= 1.5;
        ctx.socket.emit("chat", {
            channel: "system",
            name: "SYSTEM",
            message: "You are starving — movement is sluggish.",
        });
    }

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `Traveling to ${targetNode.name}... This will take ${(delayMs / 1000).toFixed(1)} seconds.`,
    });

    const broadcastRoomData = (locationId: string) => {
        const roomPlayers = Array.from(players.values())
            .filter(p => p.location === locationId)
            .map(p => ({ characterId: p.characterId, name: p.name, faction: p.faction, isDead: p.isDead }));
        ctx.io.to(locationId).emit("roomPlayers", roomPlayers);
    };

    setTimeout(() => {
        // Update in-memory state
        ctx.player.location = targetLocationId;

        // Update socket rooms
        ctx.socket.leave(currentNode.id);
        ctx.socket.join(targetLocationId);

        // Update DB (fire and forget)
        Character.updateOne(
            { characterId: ctx.player.characterId },
            { location: targetLocationId }
        ).exec().catch(err => console.error("[Move] DB update failed:", err));

        // Notify
        ctx.socket.emit("chat", {
            channel: "system",
            name: "SYSTEM",
            message: `You have arrived at ${targetNode.name}.`,
        });
        ctx.socket.emit("enteredCity", { location: targetLocationId });

        // Announce to new room
        ctx.socket.broadcast.to(targetLocationId).emit("chat", {
            channel: "system",
            name: "SYSTEM",
            message: `${ctx.player.name} has arrived.`,
        });

        // Announce departure to old room
        ctx.io.to(currentNode.id).emit("chat", {
            channel: "system",
            name: "SYSTEM",
            message: `${ctx.player.name} has left towards ${targetNode.name}.`,
        });

        // Sync player lists for both rooms
        broadcastRoomData(currentNode.id);
        broadcastRoomData(targetLocationId);
    }, delayMs);
}

registerCommand("goto", handleMove, "Travel to a connected location", "/goto [location_id]");
registerCommand("move", handleMove, "Travel to a connected location (alias)", "/move [location_id]");
