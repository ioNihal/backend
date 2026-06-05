import { registerCommand } from "./index.js";
import type { CommandContext } from "./index.js";
import { Character } from "../../models/Character.js";
import { players } from "../state.js";
import { getJob, getJobsByLocation } from "../../data/jobs.js";
import { startJob, stopJob, getJobStatus } from "../jobs.js";

// ═══════════════════════════════════════════════════════════════
//  /work [job_id] — start job
// ═══════════════════════════════════════════════════════════════

registerCommand("work", async (ctx: CommandContext, args: string[]) => {
    const jobId = args[0]?.toLowerCase();

    if (!jobId) {
        // List available jobs at current location
        const locationJobs = getJobsByLocation(ctx.player.location);
        if (locationJobs.length === 0) {
            ctx.socket.emit("chat", {
                channel: "error",
                name: "SYSTEM",
                message: "No jobs available at this location. Go to City Hall (sweeper), Ocean Docks (trucker), Warehouse District (loader), or Airport (smuggler) to find work.",
            });
            return;
        }

        const lines = locationJobs.map(j => `  • ${j.name} (ID: ${j.id}) — Payout: $${j.payout} | Duration: ${j.duration}s`);
        ctx.socket.emit("chat", {
            channel: "system",
            name: "SYSTEM",
            message: `━━ JOBS AVAILABLE HERE ━━\n${lines.join("\n")}\nUsage: /work [job_id]`,
        });
        return;
    }

    const job = getJob(jobId);
    if (!job) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Invalid job ID "${jobId}".` });
        return;
    }

    const res = await startJob(ctx.socket.id, jobId);
    if (!res.success) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: res.message });
        return;
    }

    // Broadcast to room
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} starts working as a ${job.name}. **`,
    });

    // Notify client of job state
    ctx.socket.emit("jobUpdate", {
        status: "working",
        jobName: job.name,
        timeLeft: job.duration,
        payout: job.payout,
    });
}, "Start a job at your current location", "/work [job_id]");

// ═══════════════════════════════════════════════════════════════
//  /stopwork — cancel active job
// ═══════════════════════════════════════════════════════════════

registerCommand("stopwork", async (ctx: CommandContext) => {
    const cancelled = await stopJob(ctx.socket.id);
    if (!cancelled) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You are not currently working." });
        return;
    }

    // Broadcast to room
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} stops working. **`,
    });

    // Notify client of job reset
    ctx.socket.emit("jobUpdate", {
        status: "idle",
        jobName: null,
        timeLeft: 0,
        payout: 0,
    });

    ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: "Job cancelled." });
}, "Cancel your active job", "/stopwork");

// ═══════════════════════════════════════════════════════════════
//  /job — check job status
// ═══════════════════════════════════════════════════════════════

registerCommand("job", async (ctx: CommandContext) => {
    const status = await getJobStatus(ctx.socket.id);
    if (!status) {
        ctx.socket.emit("chat", { channel: "system", name: "SYSTEM", message: "You are not currently working." });
        return;
    }

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `💼 Current Job: ${status.jobName} | Time Remaining: ${status.timeLeft}s | Expected Payout: $${status.payout}`,
    });

    // Sync frontend timer
    ctx.socket.emit("jobUpdate", {
        status: "working",
        jobName: status.jobName,
        timeLeft: status.timeLeft,
        payout: status.payout,
    });
}, "Check status of your active job", "/job");

// ═══════════════════════════════════════════════════════════════
//  /pay [name] [amount] — hand cash to player
// ═══════════════════════════════════════════════════════════════

registerCommand("pay", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.isDead) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot transfer cash while downed." });
        return;
    }

    const targetName = args[0];
    const amountStr = args[1];

    if (!targetName || !amountStr) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /pay [player_name] [amount]" });
        return;
    }

    const amount = parseInt(amountStr, 10);
    if (isNaN(amount) || amount <= 0) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Invalid payment amount." });
        return;
    }

    // Find target in current location
    const target = Array.from(players.values()).find(
        p => p.name.toLowerCase() === targetName.toLowerCase() && p.location === ctx.player.location
    );

    if (!target) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Player "${targetName}" not found in this location.` });
        return;
    }

    if (target.characterId === ctx.player.characterId) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You cannot pay yourself." });
        return;
    }

    const senderChar = await Character.findOne({ characterId: ctx.player.characterId });
    const targetChar = await Character.findOne({ characterId: target.characterId });

    if (!senderChar || !targetChar) return;

    if (senderChar.cash < amount) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Insufficient cash. You only have $${senderChar.cash}.` });
        return;
    }

    // Transfer cash
    senderChar.cash -= amount;
    targetChar.cash = (targetChar.cash ?? 0) + amount;

    await senderChar.save();
    await targetChar.save();

    // Broadcast actions
    ctx.io.to(ctx.player.location).emit("chat", {
        channel: "action",
        name: ctx.player.name,
        message: `** ${ctx.player.name} reaches out and hands some cash to ${target.name}. **`,
    });

    // Notify updates
    ctx.socket.emit("vitalsUpdate", {
        health: ctx.player.health,
        hunger: ctx.player.hunger,
        thirst: ctx.player.thirst,
        energy: ctx.player.energy,
        cash: senderChar.cash,
    });

    ctx.io.to(target.socketId).emit("vitalsUpdate", {
        health: target.health,
        hunger: target.hunger,
        thirst: target.thirst,
        energy: target.energy,
        cash: targetChar.cash,
    });

    ctx.io.to(target.socketId).emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `💵 Handed: ${ctx.player.name} has given you $${amount}!`,
    });

    ctx.io.to(target.socketId).emit("notification", {
        type: "success",
        message: `Received $${amount} from ${ctx.player.name}`,
    });
}, "Hand cash to a player next to you", "/pay [player_name] [amount]");

// ═══════════════════════════════════════════════════════════════
//  /balance — show balance sheet
// ═══════════════════════════════════════════════════════════════

registerCommand("balance", async (ctx: CommandContext) => {
    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `━━ BALANCE SHEET ━━\n  💵 Cash on Person: $${(character.cash ?? 0).toLocaleString()}\n  🏦 Bank Account:   $${(character.bankBalance ?? 0).toLocaleString()}`,
    });
}, "Display your current cash and bank balances", "/balance");

// ═══════════════════════════════════════════════════════════════
//  /deposit [amount] — deposit cash into bank account
// ═══════════════════════════════════════════════════════════════

registerCommand("deposit", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.location !== "downtown") {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You must be at Downtown Los Santos (Maze Bank Branch) to access bank transactions." });
        return;
    }

    const amountStr = args[0];
    if (!amountStr) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /deposit [amount]" });
        return;
    }

    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    let amount = 0;
    if (amountStr.toLowerCase() === "all") {
        amount = character.cash ?? 0;
    } else {
        amount = parseInt(amountStr, 10);
    }

    if (isNaN(amount) || amount <= 0) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Invalid deposit amount." });
        return;
    }

    if (character.cash < amount) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Insufficient cash holdings. You only have $${character.cash}.` });
        return;
    }

    // Process
    character.cash -= amount;
    character.bankBalance = (character.bankBalance ?? 0) + amount;
    await character.save();

    // Notify updates
    ctx.socket.emit("vitalsUpdate", {
        health: ctx.player.health,
        hunger: ctx.player.hunger,
        thirst: ctx.player.thirst,
        energy: ctx.player.energy,
        cash: character.cash,
    });

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `🏦 Bank: Successfully deposited $${amount.toLocaleString()} into your account. New Bank Balance: $${character.bankBalance.toLocaleString()}`,
    });
}, "Deposit cash into your bank account (Only at Downtown)", "/deposit [amount]");

// ═══════════════════════════════════════════════════════════════
//  /withdraw [amount] — withdraw bank cash
// ═══════════════════════════════════════════════════════════════

registerCommand("withdraw", async (ctx: CommandContext, args: string[]) => {
    if (ctx.player.location !== "downtown") {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "You must be at Downtown Los Santos (Maze Bank Branch) to access bank transactions." });
        return;
    }

    const amountStr = args[0];
    if (!amountStr) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Usage: /withdraw [amount]" });
        return;
    }

    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    let amount = 0;
    if (amountStr.toLowerCase() === "all") {
        amount = character.bankBalance ?? 0;
    } else {
        amount = parseInt(amountStr, 10);
    }

    if (isNaN(amount) || amount <= 0) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: "Invalid withdrawal amount." });
        return;
    }

    if ((character.bankBalance ?? 0) < amount) {
        ctx.socket.emit("chat", { channel: "error", name: "SYSTEM", message: `Insufficient bank balance. You only have $${character.bankBalance}.` });
        return;
    }

    // Process
    character.bankBalance = (character.bankBalance ?? 0) - amount;
    character.cash = (character.cash ?? 0) + amount;
    await character.save();

    // Notify updates
    ctx.socket.emit("vitalsUpdate", {
        health: ctx.player.health,
        hunger: ctx.player.hunger,
        thirst: ctx.player.thirst,
        energy: ctx.player.energy,
        cash: character.cash,
    });

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `🏦 Bank: Successfully withdrew $${amount.toLocaleString()} from your account. New Bank Balance: $${character.bankBalance.toLocaleString()}`,
    });
}, "Withdraw cash from your bank account (Only at Downtown)", "/withdraw [amount]");

// ═══════════════════════════════════════════════════════════════
//  /crimes — criminal record details
// ═══════════════════════════════════════════════════════════════

registerCommand("crimes", async (ctx: CommandContext) => {
    const character = await Character.findOne({ characterId: ctx.player.characterId });
    if (!character) return;

    const wl = character.wantedLevel ?? 0;
    const stars = "★".repeat(wl) + "☆".repeat(5 - wl);

    let record = "";
    if (wl === 0) {
        record = "Clean Record. No outstanding warrants.";
    } else if (wl === 1) {
        record = "Outstanding Warrant: Street Disturbance / Petty Mischief.";
    } else if (wl === 2) {
        record = "Outstanding Warrant: Contraband Trafficking / Resisting Arrest.";
    } else if (wl === 3) {
        record = "Outstanding Warrant: Grand Larceny / Armed Robbery.";
    } else if (wl === 4) {
        record = "Outstanding Warrant: Grand Theft Auto / Faction Felony.";
    } else {
        record = "WANTED STATE LEVEL: Public Enemy Number One. Armed and Extremely Dangerous.";
    }

    ctx.socket.emit("chat", {
        channel: "system",
        name: "SYSTEM",
        message: `━━ CRIME RECORD: ${character.name.toUpperCase()} ━━\n  Wanted Status: [ ${stars} ]\n  Details: ${record}`,
    });
}, "Check your criminal record and wanted status", "/crimes");
