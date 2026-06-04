import { registerCommand } from "./index.js";
import type { CommandContext } from "./index.js";
import { players } from "../state.js";
import redis from "../../lib/redis.js";
import { CALL, SMS_INBOX } from "../../lib/redisKeys.js";

// ═══════════════════════════════════════════════════════════════
//  /call [name] — Initiate a phone call
// ═══════════════════════════════════════════════════════════════

registerCommand("call", async (ctx: CommandContext, args: string[]) => {
    const targetName = args[0];
    if (!targetName) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /call [character_name]" });
        return;
    }

    // Check if player has a phone in inventory
    // For now, we trust the phone exists — Phase 3 will add proper inventory checks

    // Check if already in a call
    const existingCall = await redis.get(CALL(ctx.player.characterId));
    if (existingCall) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are already in a call. Use /hangup first." });
        return;
    }

    // Find target
    const target = Array.from(players.values()).find(
        p => p.name.toLowerCase() === targetName.toLowerCase()
    );

    if (!target) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Player "${targetName}" not found or offline.` });
        return;
    }

    if (target.characterId === ctx.player.characterId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You can't call yourself." });
        return;
    }

    // Check if target is already in a call
    const targetCall = await redis.get(CALL(target.characterId));
    if (targetCall) {
        ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: `${target.name}'s line is busy.` });
        return;
    }

    // Store pending call state in Redis (120s TTL — auto-hangup)
    // Format: "pending:{callerCharacterId}" on target's key
    await redis.set(CALL(ctx.player.characterId), `pending:${target.characterId}`, { EX: 120 });
    await redis.set(CALL(target.characterId), `ringing:${ctx.player.characterId}`, { EX: 120 });

    // Update in-memory state
    ctx.player.inCall = target.characterId;

    // Notify caller
    ctx.socket.emit("chat", {
        channel: "phone",
        name: "PHONE",
        message: `📱 Calling ${target.name}... Waiting for them to /answer.`,
    });

    // Notify target
    ctx.io.to(target.socketId).emit("chat", {
        channel: "phone",
        name: "PHONE",
        message: `📱 Incoming call from ${ctx.player.name}. Type /answer to pick up or /hangup to decline.`,
    });

    ctx.io.to(target.socketId).emit("callRing", {
        callerName: ctx.player.name,
        callerNumber: ctx.player.phoneNumber,
    });
}, "Call another player (requires phone)", "/call [name]");

// ═══════════════════════════════════════════════════════════════
//  /answer — Accept an incoming call
// ═══════════════════════════════════════════════════════════════

registerCommand("answer", async (ctx: CommandContext) => {
    const callState = await redis.get(CALL(ctx.player.characterId));
    if (!callState || !callState.startsWith("ringing:")) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "No incoming call to answer." });
        return;
    }

    const callerCharacterId = callState.split(":")[1]!;

    // Find caller
    const caller = Array.from(players.values()).find(p => p.characterId === callerCharacterId);
    if (!caller) {
        await redis.del(CALL(ctx.player.characterId));
        ctx.socket.emit("chat", { channel: "system", name: "PHONE", message: "The caller has disconnected." });
        return;
    }

    // Update Redis: both keys now hold "active:{otherCharacterId}" with 120s TTL
    await redis.set(CALL(ctx.player.characterId), `active:${callerCharacterId}`, { EX: 120 });
    await redis.set(CALL(callerCharacterId), `active:${ctx.player.characterId}`, { EX: 120 });

    // Update in-memory
    ctx.player.inCall = callerCharacterId;
    caller.inCall = ctx.player.characterId;

    // Notify both parties
    ctx.socket.emit("chat", { channel: "phone", name: "PHONE", message: `📱 Call connected with ${caller.name}.` });
    ctx.socket.emit("callConnected", { with: caller.name });

    ctx.io.to(caller.socketId).emit("chat", { channel: "phone", name: "PHONE", message: `📱 ${ctx.player.name} answered. Call connected.` });
    ctx.io.to(caller.socketId).emit("callConnected", { with: ctx.player.name });
}, "Answer an incoming phone call", "/answer");

// ═══════════════════════════════════════════════════════════════
//  /hangup — End or decline a call
// ═══════════════════════════════════════════════════════════════

registerCommand("hangup", async (ctx: CommandContext) => {
    const callState = await redis.get(CALL(ctx.player.characterId));
    if (!callState) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are not in a call." });
        return;
    }

    const otherCharacterId = callState.split(":")[1]!;

    // Clear both Redis keys
    await redis.del(CALL(ctx.player.characterId));
    await redis.del(CALL(otherCharacterId));

    // Clear in-memory
    ctx.player.inCall = null;
    const other = Array.from(players.values()).find(p => p.characterId === otherCharacterId);
    if (other) {
        other.inCall = null;
        ctx.io.to(other.socketId).emit("chat", { channel: "phone", name: "PHONE", message: "📱 Call ended." });
        ctx.io.to(other.socketId).emit("callEnded", {});
    }

    ctx.socket.emit("chat", { channel: "phone", name: "PHONE", message: "📱 Call ended." });
    ctx.socket.emit("callEnded", {});
}, "End or decline a phone call", "/hangup");

// ═══════════════════════════════════════════════════════════════
//  /sms [name] [message] — Send an async text message
// ═══════════════════════════════════════════════════════════════

registerCommand("sms", async (ctx: CommandContext, args: string[]) => {
    const targetName = args[0];
    const message = args.slice(1).join(" ").trim();

    if (!targetName || !message) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /sms [name] [message]" });
        return;
    }

    // Find target (can be offline — we store in Redis inbox)
    const target = Array.from(players.values()).find(
        p => p.name.toLowerCase() === targetName.toLowerCase()
    );

    // Even if offline, we'd normally check MongoDB. For now, require online.
    if (!target) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Player "${targetName}" not found or offline.` });
        return;
    }

    // Store in target's SMS inbox (Redis LIST, cap at 20)
    const smsData = JSON.stringify({
        from: ctx.player.name,
        fromCharacterId: ctx.player.characterId,
        message,
        timestamp: new Date().toISOString(),
    });

    await redis.rPush(SMS_INBOX(target.characterId), smsData);
    await redis.lTrim(SMS_INBOX(target.characterId), -20, -1);  // Keep last 20

    // Notify sender
    ctx.socket.emit("chat", {
        channel: "phone",
        name: "PHONE",
        message: `📱 SMS sent to ${target.name}: "${message}"`,
    });

    // Notify target if online
    ctx.io.to(target.socketId).emit("chat", {
        channel: "phone",
        name: "PHONE",
        message: `📱 New SMS from ${ctx.player.name}: "${message}"`,
    });

    ctx.io.to(target.socketId).emit("notification", {
        type: "info",
        message: `New SMS from ${ctx.player.name}`,
    });
}, "Send a text message to a player", "/sms [name] [message]");

// ═══════════════════════════════════════════════════════════════
//  /inbox — Read your SMS inbox
// ═══════════════════════════════════════════════════════════════

registerCommand("inbox", async (ctx: CommandContext) => {
    const rawMessages = await redis.lRange(SMS_INBOX(ctx.player.characterId), 0, -1);

    if (rawMessages.length === 0) {
        ctx.socket.emit("chat", { channel: "system", name: "PHONE", message: "📱 Your inbox is empty." });
        return;
    }

    const lines = rawMessages.map(raw => {
        const msg = JSON.parse(raw) as { from: string; message: string; timestamp: string };
        const time = new Date(msg.timestamp).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
        return `  [${time}] ${msg.from}: ${msg.message}`;
    });

    ctx.socket.emit("chat", {
        channel: "phone",
        name: "PHONE",
        message: `📱 ━━ INBOX (${rawMessages.length} messages) ━━\n${lines.join("\n")}`,
    });
}, "View your SMS inbox", "/inbox");

// ═══════════════════════════════════════════════════════════════
//  /reply [message] — Reply to the last SMS sender
// ═══════════════════════════════════════════════════════════════

registerCommand("reply", async (ctx: CommandContext, args: string[]) => {
    const message = args.join(" ").trim();
    if (!message) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /reply [message]" });
        return;
    }

    // Get last SMS in inbox
    const lastRaw = await redis.lIndex(SMS_INBOX(ctx.player.characterId), -1);
    if (!lastRaw) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "No messages to reply to." });
        return;
    }

    const lastMsg = JSON.parse(lastRaw) as { from: string; fromCharacterId: string; message: string };

    // Find sender online
    const target = Array.from(players.values()).find(p => p.characterId === lastMsg.fromCharacterId);
    if (!target) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `${lastMsg.from} is offline.` });
        return;
    }

    // Store in their inbox
    const smsData = JSON.stringify({
        from: ctx.player.name,
        fromCharacterId: ctx.player.characterId,
        message,
        timestamp: new Date().toISOString(),
    });
    await redis.rPush(SMS_INBOX(target.characterId), smsData);
    await redis.lTrim(SMS_INBOX(target.characterId), -20, -1);

    // Notify both
    ctx.socket.emit("chat", { channel: "phone", name: "PHONE", message: `📱 Reply to ${target.name}: "${message}"` });
    ctx.io.to(target.socketId).emit("chat", { channel: "phone", name: "PHONE", message: `📱 SMS from ${ctx.player.name}: "${message}"` });
}, "Reply to the last SMS you received", "/reply [message]");
