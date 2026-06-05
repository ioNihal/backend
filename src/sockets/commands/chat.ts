import { registerCommand, getAllCommands } from "./index.js";
import type { CommandContext } from "./index.js";
import { mapNodes } from "../../data/map.js";
import { players } from "../state.js";

// ═══════════════════════════════════════════════════════════════
//  /help — list all available commands
// ═══════════════════════════════════════════════════════════════

registerCommand("help", (ctx: CommandContext) => {
    const cmds = getAllCommands();
    const lines = cmds.map(c => `  /${c.name.padEnd(12)} — ${c.description}`);
    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: "━━ AVAILABLE COMMANDS ━━\n" + lines.join("\n"),
    });
}, "Show all available commands", "/help");

registerCommand("commands", (ctx: CommandContext) => {
    const cmds = getAllCommands();
    const lines = cmds.map(c => `  /${c.name.padEnd(12)} — ${c.description}`);
    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: "━━ AVAILABLE COMMANDS ━━\n" + lines.join("\n"),
    });
}, "Alias for /help", "/commands");

// ═══════════════════════════════════════════════════════════════
//  /look — describe current room
// ═══════════════════════════════════════════════════════════════

registerCommand("look", (ctx: CommandContext) => {
    const node = mapNodes[ctx.player.location];
    if (!node) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Your current location is unknown." });
        return;
    }

    // List players in room
    const roomPlayers = Array.from(players.values())
        .filter(p => p.location === ctx.player.location && p.characterId !== ctx.player.characterId)
        .map(p => p.isDead ? `${p.name} [DOWNED]` : p.name);

    // List exits
    const exits = node.connections
        .map(id => {
            const target = mapNodes[id];
            return target ? `${target.name} (${id})` : id;
        })
        .join(", ");

    const playersText = roomPlayers.length > 0
        ? `\nPlayers here: ${roomPlayers.join(", ")}`
        : "\nNo other players nearby.";

    const zoneTag = node.safeZone ? " [SAFE ZONE]" : "";

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `━━ ${node.name}${zoneTag} ━━\n${node.description}${playersText}\nExits: ${exits}`,
    });
}, "Look around your current location", "/look");

// ═══════════════════════════════════════════════════════════════
//  /who — list all online players
// ═══════════════════════════════════════════════════════════════

registerCommand("who", (ctx: CommandContext) => {
    const allPlayers = Array.from(players.values());
    if (allPlayers.length === 0) {
        ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: "No citizens online." });
        return;
    }

    const lines = allPlayers.map(p => {
        const loc = mapNodes[p.location]?.name ?? p.location;
        const status = p.isDead ? " [DOWNED]" : "";
        const factionTag = p.faction !== "none" ? ` [${p.faction.toUpperCase()}]` : "";
        return `  ${p.name}${factionTag}${status} — ${loc}`;
    });

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `━━ ONLINE CITIZENS (${allPlayers.length}) ━━\n${lines.join("\n")}`,
    });
}, "List all online players", "/who");

// ═══════════════════════════════════════════════════════════════
//  /players — list players in current room
// ═══════════════════════════════════════════════════════════════

registerCommand("players", (ctx: CommandContext) => {
    const roomPlayers = Array.from(players.values())
        .filter(p => p.location === ctx.player.location);

    if (roomPlayers.length === 0) {
        ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: "No signals detected." });
        return;
    }

    const lines = roomPlayers.map(p => {
        const status = p.isDead ? " [DOWNED]" : "";
        return `  ${p.name}${status}`;
    });

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `━━ PLAYERS NEARBY (${roomPlayers.length}) ━━\n${lines.join("\n")}`,
    });
}, "List players in your current room", "/players");

// ═══════════════════════════════════════════════════════════════
//  /ooc [message] — Global OOC chat
// ═══════════════════════════════════════════════════════════════

registerCommand("ooc", (ctx: CommandContext, args: string[]) => {
    const message = args.join(" ").trim();
    if (!message) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /ooc [message]" });
        return;
    }

    ctx.io.emit("chat", {
        channel: "ooc",
        name: ctx.player.name,
        message,
    });
}, "Send a global out-of-character message", "/ooc [message]");

registerCommand("g", (ctx: CommandContext, args: string[]) => {
    const message = args.join(" ").trim();
    if (!message) return;
    ctx.io.emit("chat", { channel: "ooc", name: ctx.player.name, message });
}, "Alias for /ooc", "/g [message]");

// ═══════════════════════════════════════════════════════════════
//  /s [message] — Shout (current room + adjacent rooms)
// ═══════════════════════════════════════════════════════════════

registerCommand("s", (ctx: CommandContext, args: string[]) => {
    const message = args.join(" ").trim();
    if (!message) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /s [message]" });
        return;
    }

    const node = mapNodes[ctx.player.location];
    if (!node) return;

    // Emit to current room
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "shout",
        name: ctx.player.name,
        message,
    });

    // Emit to adjacent rooms only if they are physically close (distance <= 180)
    for (const connId of node.connections) {
        const targetNode = mapNodes[connId];
        if (!targetNode) continue;

        const dx = targetNode.x - node.x;
        const dy = targetNode.y - node.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= 180) {
            ctx.io.to(connId).emit("chat", {
                channel: "shout",
                name: ctx.player.name,
                message: `(shouting from ${node.name}) ${message}`,
            });
        }
    }
}, "Shout — reaches current and close adjacent locations", "/s [message]");

// ═══════════════════════════════════════════════════════════════
//  /me [action] — Third-person roleplay action
// ═══════════════════════════════════════════════════════════════

registerCommand("me", (ctx: CommandContext, args: string[]) => {
    const action = args.join(" ").trim();
    if (!action) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /me [action]" });
        return;
    }

    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} ${action} **`,
    });
}, "Roleplay action visible to your room", "/me [action]");

// ═══════════════════════════════════════════════════════════════
//  /do [state] — Describe environmental state
// ═══════════════════════════════════════════════════════════════

registerCommand("do", (ctx: CommandContext, args: string[]) => {
    const state = args.join(" ").trim();
    if (!state) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /do [description]" });
        return;
    }

    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "do",
        name: ctx.player.name,
        message: `(( ${state} ))`,
    });
}, "Describe an environmental state for RP", "/do [description]");

// ═══════════════════════════════════════════════════════════════
//  /w [name] [message] — Whisper to a player (private)
// ═══════════════════════════════════════════════════════════════

registerCommand("w", (ctx: CommandContext, args: string[]) => {
    const targetName = args[0];
    const message = args.slice(1).join(" ").trim();

    if (!targetName || !message) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /w [name] [message]" });
        return;
    }

    // Find target player
    const target = Array.from(players.values()).find(
        p => p.name.toLowerCase() === targetName.toLowerCase()
    );

    if (!target) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Player "${targetName}" not found or offline.` });
        return;
    }

    // Send to target
    ctx.io.to(target.socketId).emit("chat", {
        channel: "whisper",
        name: ctx.player.name,
        message: `[WHISPER from ${ctx.player.name}]: ${message}`,
    });

    // Confirm to sender
    ctx.socket.emit("chat", {
        channel: "whisper",
        name: ctx.player.name,
        message: `[WHISPER to ${target.name}]: ${message}`,
    });
}, "Send a private message to a player", "/w [name] [message]");

// ═══════════════════════════════════════════════════════════════
//  /f [message] — Faction chat
// ═══════════════════════════════════════════════════════════════

registerCommand("f", (ctx: CommandContext, args: string[]) => {
    if (ctx.player.faction === "none") {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are not in a faction." });
        return;
    }

    const message = args.join(" ").trim();
    if (!message) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /f [message]" });
        return;
    }

    // Find all players in the same faction
    for (const [, p] of players) {
        if (p.faction === ctx.player.faction) {
            ctx.io.to(p.socketId).emit("chat", {
                channel: "faction",
                name: ctx.player.name,
                message,
            });
        }
    }
}, "Send a message to your faction members", "/f [message]");

// ═══════════════════════════════════════════════════════════════
//  /time — Current server time (for RP)
// ═══════════════════════════════════════════════════════════════

registerCommand("time", (ctx: CommandContext) => {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
        timeZone: "Asia/Kolkata",
    });
    const dateStr = now.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
        timeZone: "Asia/Kolkata",
    });

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `Current time: ${timeStr} — ${dateStr}`,
    });
}, "Show the current server time", "/time");
