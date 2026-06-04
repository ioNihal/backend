import { registerCommand } from "./index.js";
import type { CommandContext } from "./index.js";
import { Character } from "../../models/Character.js";
import { getItem } from "../../data/items.js";
import { applyVitalEffect } from "../vitals.js";

// ═══════════════════════════════════════════════════════════════
//  /inv or /inventory — show inventory items
// ═══════════════════════════════════════════════════════════════

registerCommand("inv", async (ctx: CommandContext) => {
    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Character not found." });
        return;
    }

    const itemsList = character.inventory;
    if (!itemsList || itemsList.length === 0) {
        ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: "Your inventory is empty." });
        return;
    }

    const lines = itemsList.map(invItem => {
        const itemInfo = getItem(invItem.itemId);
        const name = itemInfo ? itemInfo.name : invItem.itemId;
        const desc = itemInfo ? itemInfo.description : "Unknown item";
        return `  • ${name} (ID: ${invItem.itemId}, x${invItem.quantity}) — ${desc}`;
    });

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `━━ YOUR INVENTORY ━━\n${lines.join("\n")}`,
    });
}, "Show your inventory items", "/inv");

registerCommand("inventory", async (ctx: CommandContext) => {
    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;
    const itemsList = character.inventory;
    if (!itemsList || itemsList.length === 0) {
        ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: "Your inventory is empty." });
        return;
    }
    const lines = itemsList.map(invItem => {
        const itemInfo = getItem(invItem.itemId);
        return `  • ${itemInfo ? itemInfo.name : invItem.itemId} (ID: ${invItem.itemId}, x${invItem.quantity})`;
    });
    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `━━ YOUR INVENTORY ━━\n${lines.join("\n")}`,
    });
}, "Alias for /inv", "/inventory");

// ═══════════════════════════════════════════════════════════════
//  /eat [item_id] — eat food
// ═══════════════════════════════════════════════════════════════

registerCommand("eat", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot eat while downed." });
        return;
    }

    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    const itemId = args[0]?.toLowerCase();
    if (!itemId) {
        const foods = character.inventory.filter(invItem => {
            const item = getItem(invItem.itemId);
            return item && item.category === "food";
        });
        if (foods.length === 0) {
            ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You don't have any food in your inventory." });
            return;
        }
        const foodList = foods.map(f => {
            const item = getItem(f.itemId);
            return `${item?.name || f.itemId} (ID: ${f.itemId}, x${f.quantity})`;
        }).join(", ");
        ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: `Usage: /eat [item_id]\nYour foods: ${foodList}` });
        return;
    }

    const invItemIndex = character.inventory.findIndex(i => i.itemId.toLowerCase() === itemId);
    if (invItemIndex === -1) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `You do not have "${itemId}" in your inventory.` });
        return;
    }

    const invItem = character.inventory[invItemIndex]!;
    const item = getItem(invItem.itemId);
    if (!item || item.category !== "food") {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `"${item?.name || itemId}" is not a food item.` });
        return;
    }

    // Decrement inventory
    invItem.quantity -= 1;
    if (invItem.quantity <= 0) {
        character.inventory.splice(invItemIndex, 1);
    } else {
        character.markModified("inventory");
    }
    await character.save();

    // Apply effect
    await applyVitalEffect(ctx.socket.id, item.effects, ctx.io);

    // Announce to the room
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} eats a ${item.name}. **`,
    });

    // Notify client of updated inventory
    ctx.socket.emit("inventoryUpdate", { inventory: character.inventory });
}, "Consume a food item to restore hunger", "/eat [item_id]");

// ═══════════════════════════════════════════════════════════════
//  /drink [item_id] — drink beverages
// ═══════════════════════════════════════════════════════════════

registerCommand("drink", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot drink while downed." });
        return;
    }

    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    const itemId = args[0]?.toLowerCase();
    if (!itemId) {
        const drinks = character.inventory.filter(invItem => {
            const item = getItem(invItem.itemId);
            return item && item.category === "drink";
        });
        if (drinks.length === 0) {
            ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You don't have any drinks in your inventory." });
            return;
        }
        const drinkList = drinks.map(f => {
            const item = getItem(f.itemId);
            return `${item?.name || f.itemId} (ID: ${f.itemId}, x${f.quantity})`;
        }).join(", ");
        ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: `Usage: /drink [item_id]\nYour drinks: ${drinkList}` });
        return;
    }

    const invItemIndex = character.inventory.findIndex(i => i.itemId.toLowerCase() === itemId);
    if (invItemIndex === -1) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `You do not have "${itemId}" in your inventory.` });
        return;
    }

    const invItem = character.inventory[invItemIndex]!;
    const item = getItem(invItem.itemId);
    if (!item || item.category !== "drink") {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `"${item?.name || itemId}" is not a drink item.` });
        return;
    }

    // Decrement inventory
    invItem.quantity -= 1;
    if (invItem.quantity <= 0) {
        character.inventory.splice(invItemIndex, 1);
    } else {
        character.markModified("inventory");
    }
    await character.save();

    // Apply effect
    await applyVitalEffect(ctx.socket.id, item.effects, ctx.io);

    // Announce to the room
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} drinks a ${item.name}. **`,
    });

    // Notify client of updated inventory
    ctx.socket.emit("inventoryUpdate", { inventory: character.inventory });
}, "Consume a drink to restore thirst and energy", "/drink [item_id]");

// ═══════════════════════════════════════════════════════════════
//  /use [item_id] — generic item usage
// ═══════════════════════════════════════════════════════════════

registerCommand("use", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot use items while downed." });
        return;
    }

    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    const itemId = args[0]?.toLowerCase();
    if (!itemId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /use [item_id]" });
        return;
    }

    const invItemIndex = character.inventory.findIndex(i => i.itemId.toLowerCase() === itemId);
    if (invItemIndex === -1) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `You do not have "${itemId}" in your inventory.` });
        return;
    }

    const invItem = character.inventory[invItemIndex]!;
    const item = getItem(invItem.itemId);
    if (!item) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Invalid item." });
        return;
    }


    // Direct implementation for all categories is cleaner and less hacky
    if (item.category === "food") {
        invItem.quantity -= 1;
        if (invItem.quantity <= 0) character.inventory.splice(invItemIndex, 1);
        else character.markModified("inventory");
        await character.save();
        await applyVitalEffect(ctx.socket.id, item.effects, ctx.io);
        ctx.io.to(ctx.player.location).emit("chat", {
            channel: "action",
            name: ctx.player.name,
            message: `** ${ctx.player.name} eats a ${item.name}. **`,
        });
    } else if (item.category === "drink") {
        invItem.quantity -= 1;
        if (invItem.quantity <= 0) character.inventory.splice(invItemIndex, 1);
        else character.markModified("inventory");
        await character.save();
        await applyVitalEffect(ctx.socket.id, item.effects, ctx.io);
        ctx.io.to(ctx.player.location).emit("chat", {
            channel: "action",
            name: ctx.player.name,
            message: `** ${ctx.player.name} drinks a ${item.name}. **`,
        });
    } else if (item.category === "medical") {
        invItem.quantity -= 1;
        if (invItem.quantity <= 0) character.inventory.splice(invItemIndex, 1);
        else character.markModified("inventory");
        await character.save();
        await applyVitalEffect(ctx.socket.id, item.effects, ctx.io);
        ctx.io.to(ctx.player.location).emit("chat", {
            channel: "action",
            name: ctx.player.name,
            message: `** ${ctx.player.name} uses a ${item.name}. **`,
        });
    } else {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `You cannot use "${item.name}" this way. For weapons, use /draw.` });
        return;
    }

    ctx.socket.emit("inventoryUpdate", { inventory: character.inventory });
}, "Use an item from your inventory", "/use [item_id]");

// ═══════════════════════════════════════════════════════════════
//  /drop [item_id] [qty?] — drop item
// ═══════════════════════════════════════════════════════════════

registerCommand("drop", async (ctx: CommandContext, args: string[]) => {
    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    const itemId = args[0]?.toLowerCase();
    if (!itemId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /drop [item_id] [quantity?]" });
        return;
    }

    const qtyStr = args[1];
    let qtyToDrop = 1;
    if (qtyStr) {
        qtyToDrop = parseInt(qtyStr, 10);
        if (isNaN(qtyToDrop) || qtyToDrop <= 0) {
            ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Invalid quantity." });
            return;
        }
    }

    const invItemIndex = character.inventory.findIndex(i => i.itemId.toLowerCase() === itemId);
    if (invItemIndex === -1) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `You do not have "${itemId}" in your inventory.` });
        return;
    }

    const invItem = character.inventory[invItemIndex]!;
    if (invItem.quantity < qtyToDrop) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `You only have ${invItem.quantity} of "${itemId}".` });
        return;
    }

    const item = getItem(invItem.itemId);
    const itemName = item ? item.name : invItem.itemId;

    // Deduct
    invItem.quantity -= qtyToDrop;
    if (invItem.quantity <= 0) {
        character.inventory.splice(invItemIndex, 1);
    } else {
        character.markModified("inventory");
    }
    await character.save();

    // Announce drop to the room
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} dropped ${qtyToDrop}x ${itemName} on the ground. **`,
    });

    // Send inventory update
    ctx.socket.emit("inventoryUpdate", { inventory: character.inventory });
}, "Drop an item from your inventory", "/drop [item_id] [quantity?]");

// ═══════════════════════════════════════════════════════════════
//  /stats — show character profile
// ═══════════════════════════════════════════════════════════════

registerCommand("stats", async (ctx: CommandContext) => {
    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Character not found." });
        return;
    }

    const factionName = character.faction === "none" ? "None" : character.faction.toUpperCase();
    const freq = character.radioFrequency ? `${character.radioFrequency} MHz` : "None";

    const lines = [
        `━━ CHARACTER PROFILE: ${character.name.toUpperCase()} ━━`,
        `  Level: ${character.level} (XP: ${character.experience})`,
        `  Faction: ${factionName} (Rank: ${character.factionRank})`,
        `  Phone: ${character.phoneNumber ?? "None"} | Frequency: ${freq}`,
        `  Wanted Level: ${"★".repeat(character.wantedLevel)}${"☆".repeat(5 - character.wantedLevel)}`,
        `  Kills: ${character.killCount ?? 0} | Deaths: ${character.deathCount ?? 0}`,
        `  Cash: $${character.cash} | Bank: $${character.bankBalance}`,
        `━━ VITALS ━━`,
        `  Health: ${ctx.player.health}%`,
        `  Hunger: ${ctx.player.hunger}%`,
        `  Thirst: ${ctx.player.thirst}%`,
        `  Energy: ${ctx.player.energy}%`,
    ];

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: lines.join("\n"),
    });
}, "Show your character statistics", "/stats");
