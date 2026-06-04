import { registerCommand } from "./index.js";
import type { CommandContext } from "./index.js";
import { Character } from "../../models/Character.js";
import { getItem } from "../../data/items.js";
import { mapNodes } from "../../data/map.js";
import { players } from "../state.js";
import redis from "../../lib/redis.js";
import { COMBAT, VITALS } from "../../lib/redisKeys.js";
import { resolveFire, applyDeath } from "../combat.js";

// Helper: Check if location is a safe zone
function checkSafeZone(ctx: CommandContext): boolean {
    const node = mapNodes[ctx.player.location];
    return !!(node && node.safeZone);
}

// ═══════════════════════════════════════════════════════════════
//  /draw [weapon_id] — Draw a weapon
// ═══════════════════════════════════════════════════════════════

registerCommand("draw", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot draw a weapon while downed." });
        return;
    }

    if (checkSafeZone(ctx)) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "This is a safe zone. Weapons are prohibited here." });
        return;
    }

    const weaponId = args[0]?.toLowerCase();
    if (!weaponId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /draw [weapon_id]" });
        return;
    }

    const weapon = getItem(weaponId);
    if (!weapon || weapon.category !== "weapon") {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `"${weaponId}" is not a valid weapon.` });
        return;
    }

    // Check if player has the weapon in weapons or inventory
    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    const hasWeapon = character.weapons.some(w => w.itemId === weaponId) ||
                      character.inventory.some(i => i.itemId === weaponId);

    if (!hasWeapon) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `You do not have a ${weapon.name} in your possession.` });
        return;
    }

    // Set combat state in Redis
    const combatKey = COMBAT(ctx.socket.id);
    await redis.hSet(combatKey, {
        weaponId: weaponId,
        status: "armed",
        drawTime: String(Date.now()),
        targetSocketId: "",
        targetName: "",
    });
    await redis.expire(combatKey, 300); // 5 min timeout

    // Announce
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} reaches for and draws a ${weapon.name}. **`,
    });

    // Notify client combat HUD
    ctx.socket.emit("combatState", { mode: "armed", weaponName: weapon.name });
}, "Draw a weapon from your inventory", "/draw [weapon_id]");

// ═══════════════════════════════════════════════════════════════
//  /aim [name] — Aim at a target player
// ═══════════════════════════════════════════════════════════════

registerCommand("aim", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot aim while downed." });
        return;
    }

    if (checkSafeZone(ctx)) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "This is a safe zone. Combat actions are prohibited here." });
        return;
    }

    const combatKey = COMBAT(ctx.socket.id);
    const session = await redis.hGetAll(combatKey);
    if (!session || Object.keys(session).length === 0) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You must draw a weapon first using /draw." });
        return;
    }

    const targetName = args[0];
    if (!targetName) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /aim [player_name]" });
        return;
    }

    // Find target in current location
    const target = Array.from(players.values()).find(
        p => p.name.toLowerCase() === targetName.toLowerCase() && p.location === ctx.player.location
    );

    if (!target) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Player "${targetName}" is not here.` });
        return;
    }

    if (target.characterId === ctx.player.characterId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot aim at yourself." });
        return;
    }

    if (target.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Target is already downed." });
        return;
    }

    // Check target immunity
    const isImmune = await redis.get(`immunity:${target.characterId}`);
    if (isImmune) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "That player is currently immune (surrendered)." });
        return;
    }

    const weapon = getItem(session.weaponId || "");
    const weaponName = weapon ? weapon.name : "weapon";

    // Set aiming in Redis
    await redis.hSet(combatKey, {
        status: "aiming",
        targetSocketId: target.socketId,
        targetName: target.name,
    });

    // Alert target
    ctx.io.to(target.socketId).emit("chat", {
        channel: "error",
        name: "SYSTEM",
        message: `🚨 Warning: ${ctx.player.name} is aiming a ${weaponName} at you!`,
    });
    ctx.io.to(target.socketId).emit("notification", {
        type: "danger",
        message: `⚠ ${ctx.player.name} is aiming at you!`,
    });

    // Announce to the room
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} raises their ${weaponName} and aims it directly at ${target.name}. **`,
    });

    // Notify client combat HUD
    ctx.socket.emit("combatState", { mode: "aiming", weaponName: weaponName, targetName: target.name });
}, "Aim your drawn weapon at a target player", "/aim [player_name]");

// ═══════════════════════════════════════════════════════════════
//  /fire — Fire weapon at aiming target
// ═══════════════════════════════════════════════════════════════

registerCommand("fire", async (ctx: CommandContext) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot shoot while downed." });
        return;
    }

    if (checkSafeZone(ctx)) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "This is a safe zone. Combat actions are prohibited here." });
        return;
    }

    const combatKey = COMBAT(ctx.socket.id);
    const session = await redis.hGetAll(combatKey);
    if (!session || session.status !== "aiming" || !session.targetSocketId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You must aim at a target first using /aim." });
        return;
    }

    const targetSocketId = session.targetSocketId;
    const target = players.get(targetSocketId);
    if (!target || target.location !== ctx.player.location) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Target is no longer here." });
        // Reset aiming state
        await redis.hSet(combatKey, { status: "armed", targetSocketId: "", targetName: "" });
        ctx.socket.emit("combatState", { mode: "armed", weaponName: getItem(session.weaponId || "")?.name });
        return;
    }

    if (target.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Target is already downed." });
        await redis.hSet(combatKey, { status: "armed", targetSocketId: "", targetName: "" });
        ctx.socket.emit("combatState", { mode: "armed", weaponName: getItem(session.weaponId || "")?.name });
        return;
    }

    const weaponId = session.weaponId || "";
    const weapon = getItem(weaponId);
    if (!weapon || !weapon.weaponStats) return;

    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    // Deduct ammo if restricted
    if (weapon.weaponStats.ammoPerMag !== Infinity) {
        const charWeapon = character.weapons.find(w => w.itemId === weaponId);
        if (!charWeapon || charWeapon.ammo <= 0) {
            ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Your weapon is out of ammo! Buy ammo or reload." });
            return;
        }
        charWeapon.ammo -= 1;
        character.markModified("weapons");
        await character.save();
    }

    // Resolve hit
    const { hit, damage, roll } = resolveFire(weaponId);

    if (hit) {
        // Load target vitals from Redis
        const targetVitalsData = await redis.hGetAll(VITALS(target.characterId));
        let targetHp = Object.keys(targetVitalsData).length ? parseFloat(targetVitalsData.health || "100") : target.health;

        targetHp = Math.max(0, targetHp - damage);
        target.health = Math.round(targetHp * 10) / 10;

        // Save vitals back to Redis
        await redis.hSet(VITALS(target.characterId), {
            health: String(target.health),
            lastTick: String(Date.now()),
        });

        // Broadcast hit
        ctx.io.to(ctx.player.location).emit("chat", {
            channel: "action",
            name: ctx.player.name,
            message: `💥 ** ${ctx.player.name} fires their ${weapon.name} and hits ${target.name} for ${damage} HP! (Roll: ${roll}/${weapon.weaponStats.accuracy}) **`,
        });

        // Push vitals update to target
        const targetChar = await Character.findOne({ characterId: target.characterId });
        ctx.io.to(target.socketId).emit("vitalsUpdate", {
            health: target.health,
            hunger: target.hunger,
            thirst: target.thirst,
            energy: target.energy,
            cash: targetChar?.cash ?? 0,
        });

        // If target downed, apply death
        if (target.health <= 0) {
            await applyDeath(ctx.io, target.socketId, ctx.player.name);
        }
    } else {
        // Broadcast miss
        ctx.io.to(ctx.player.location).emit("chat", {
            channel: "action",
            name: ctx.player.name,
            message: `💨 ** ${ctx.player.name} fires their ${weapon.name} at ${target.name} but misses! (Roll: ${roll}/${weapon.weaponStats.accuracy}) **`,
        });
    }

    // Revert state back to "armed" (turn-based flow)
    await redis.hSet(combatKey, {
        status: "armed",
        targetSocketId: "",
        targetName: "",
    });

    ctx.socket.emit("combatState", { mode: "armed", weaponName: weapon.name });
}, "Fire your weapon at your current aiming target", "/fire");

// ═══════════════════════════════════════════════════════════════
//  /holster — Holster your weapon
// ═══════════════════════════════════════════════════════════════

registerCommand("holster", async (ctx: CommandContext) => {
    const combatKey = COMBAT(ctx.socket.id);
    const session = await redis.hGetAll(combatKey);
    if (!session || Object.keys(session).length === 0) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You do not have a weapon drawn." });
        return;
    }

    const weapon = getItem(session.weaponId || "");
    const weaponName = weapon ? weapon.name : "weapon";

    // Delete combat session
    await redis.del(combatKey);

    // Announce
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} holsters their ${weaponName}. **`,
    });

    // Notify client combat HUD
    ctx.socket.emit("combatState", { mode: "idle", weaponName: null });
}, "Holster your currently drawn weapon", "/holster");

// ═══════════════════════════════════════════════════════════════
//  /surrender — Put hands up and clear combat
// ═══════════════════════════════════════════════════════════════

registerCommand("surrender", async (ctx: CommandContext) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are already downed." });
        return;
    }

    const combatKey = COMBAT(ctx.socket.id);
    await redis.del(combatKey);

    // Give 10s combat immunity flag in Redis
    await redis.set(`immunity:${ctx.player.characterId}`, "active", { EX: 10 });

    // Announce
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} raises their hands and surrenders. **`,
    });

    ctx.socket.emit("combatState", { mode: "idle", weaponName: null });
    ctx.socket.emit("notification", {
        type: "info",
        message: "You surrendered. Active combat immunity granted for 10 seconds.",
    });
}, "Raise hands to surrender and gain 10s combat immunity", "/surrender");

// ═══════════════════════════════════════════════════════════════
//  /rob [name] — Rob an idle player
// ═══════════════════════════════════════════════════════════════

registerCommand("rob", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot rob while downed." });
        return;
    }

    if (checkSafeZone(ctx)) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "This is a safe zone. Robberies are prohibited here." });
        return;
    }

    // Must have weapon drawn
    const combatKey = COMBAT(ctx.socket.id);
    const session = await redis.hGetAll(combatKey);
    if (!session || Object.keys(session).length === 0) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You must have a weapon drawn to rob someone!" });
        return;
    }

    const targetName = args[0];
    if (!targetName) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /rob [player_name]" });
        return;
    }

    const target = Array.from(players.values()).find(
        p => p.name.toLowerCase() === targetName.toLowerCase() && p.location === ctx.player.location
    );

    if (!target) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Player "${targetName}" is not here.` });
        return;
    }

    if (target.characterId === ctx.player.characterId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot rob yourself." });
        return;
    }

    if (target.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Target is downed. You cannot rob them." });
        return;
    }

    // Check immunity
    const isImmune = await redis.get(`immunity:${target.characterId}`);
    if (isImmune) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "That player is currently immune." });
        return;
    }

    // Check target cash
    const targetChar = await Character.findOne({ characterId: target.characterId });
    const attackerChar = await Character.findOne({ characterId: ctx.player.characterId });
    if (!targetChar || !attackerChar) return;

    const targetCash = targetChar.cash ?? 0;
    if (targetCash <= 0) {
        ctx.io.to(ctx.player.location).emit("chat", {
            channel: "action",
            name: ctx.player.name,
            message: `** ${ctx.player.name} searches ${target.name} but finds no cash. **`,
        });
        return;
    }

    // Transfer up to 50% or max $1000
    const robAmount = Math.min(1000, Math.floor(targetCash * 0.5));

    targetChar.cash = Math.max(0, targetCash - robAmount);
    attackerChar.cash = (attackerChar.cash ?? 0) + robAmount;

    await targetChar.save();
    await attackerChar.save();

    // Broadcast success
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `💰 ** ${ctx.player.name} successfully robs ${target.name} for $${robAmount}! **`,
    });

    // Notify updates
    ctx.socket.emit("vitalsUpdate", {
        health: ctx.player.health,
        hunger: ctx.player.hunger,
        thirst: ctx.player.thirst,
        energy: ctx.player.energy,
        cash: attackerChar.cash,
    });

    ctx.io.to(target.socketId).emit("vitalsUpdate", {
        health: target.health,
        hunger: target.hunger,
        thirst: target.thirst,
        energy: target.energy,
        cash: targetChar.cash,
    });

    ctx.io.to(target.socketId).emit("notification", {
        type: "danger",
        message: `You were robbed of $${robAmount} by ${ctx.player.name}!`,
    });
}, "Rob cash from an idle player at gunpoint", "/rob [player_name]");

// ═══════════════════════════════════════════════════════════════
//  /revive [name] — Revive a downed player (Medic faction only)
// ═══════════════════════════════════════════════════════════════

registerCommand("revive", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.faction !== "medic") {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are not a paramedic." });
        return;
    }

    const targetName = args[0];
    if (!targetName) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /revive [player_name]" });
        return;
    }

    const target = Array.from(players.values()).find(
        p => p.name.toLowerCase() === targetName.toLowerCase() && p.location === ctx.player.location
    );

    if (!target) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Player "${targetName}" is not here.` });
        return;
    }

    if (!target.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "That player is not downed." });
        return;
    }

    // Revive target to 50% health
    target.health = 50;
    target.isDead = false;

    // Remove Redis respawn key
    await redis.del(`respawn:${target.characterId}`);

    // Update character DB
    const targetChar = await Character.findOneAndUpdate(
        { characterId: target.characterId },
        { health: 50, isDead: false },
        { new: true }
    );

    // Broadcast revive
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `🩺 ** Paramedic ${ctx.player.name} administers medical aid and revives ${target.name}! **`,
    });

    // Notify updates
    ctx.io.to(target.socketId).emit("vitalsUpdate", {
        health: 50,
        hunger: target.hunger,
        thirst: target.thirst,
        energy: target.energy,
        cash: targetChar?.cash ?? 0,
    });

    ctx.io.to(target.socketId).emit("notification", {
        type: "success",
        message: `You were revived by Paramedic ${ctx.player.name}!`,
    });

    // Sync player list for room
    const roomPlayers = Array.from(players.values())
        .filter(p => p.location === target.location)
        .map(p => ({
            characterId: p.characterId,
            name: p.name,
            faction: p.faction,
            isDead: p.isDead,
        }));
    ctx.io.to(target.location).emit("roomPlayers", roomPlayers);
}, "Revive a downed citizen (Medic only)", "/revive [player_name]");

// ═══════════════════════════════════════════════════════════════
//  /call911 — Request emergency service dispatch
// ═══════════════════════════════════════════════════════════════

registerCommand("call911", async (ctx: CommandContext) => {
    const caller = ctx.player;
    const roomNode = mapNodes[caller.location];
    const roomName = roomNode ? roomNode.name : caller.location;

    // Send 911 dispatch notification to online police and medics
    let servicesNotified = false;
    for (const [, p] of players) {
        if (p.faction === "police" || p.faction === "medic") {
            ctx.io.to(p.socketId).emit("chat", {
                channel: "faction",
                name: "911-DISPATCH",
                message: `🚨 Emergency dispatch: ${caller.name} reports an incident at ${roomName}. Immediate units required.`,
            });
            ctx.io.to(p.socketId).emit("notification", {
                type: "danger",
                message: `🚨 Incoming 911 dispatch from ${caller.name} at ${roomName}!`,
            });
            servicesNotified = true;
        }
    }

    if (servicesNotified) {
        ctx.socket.emit("chat", {
            channel: "system",
            name: "SYSTEM",
            message: "☎ 911: Emergency services have been notified of your location. Please stand by.",
        });
    } else {
        ctx.socket.emit("chat", {
            channel: "system",
            name: "SYSTEM",
            message: "☎ 911: Emergency dispatch recorded, but no active response units are currently online. Medics have been alerted.",
        });
    }
}, "Call 911 dispatcher to alert police & paramedics of your location", "/call911");
