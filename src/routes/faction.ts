import { Router } from "express";
import { Character } from "../models/Character.js";
import { authenticate, type AuthRequest } from "../middleware/auth.js";
import { players } from "../sockets/state.js";

const router = Router();

// Helper: Sync online player socket state
async function syncOnlineFactionState(characterId: string, faction: string, rank: number, isKicked = false) {
    const onlinePlayer = Array.from(players.values()).find(p => p.characterId === characterId);
    if (onlinePlayer) {
        onlinePlayer.faction = faction;
        onlinePlayer.factionRank = rank;

        const { io } = await import("../index.js");
        
        if (isKicked) {
            io.to(onlinePlayer.socketId).emit("notification", {
                type: "danger",
                message: "You have been kicked from your faction.",
            });
        } else {
            io.to(onlinePlayer.socketId).emit("notification", {
                type: "info",
                message: `Your faction status updated: ${faction.toUpperCase()} (Rank ${rank})`,
            });
        }

        // Emit vitalsUpdate to push updated cash / wanted / etc
        io.to(onlinePlayer.socketId).emit("vitalsUpdate", {
            health: onlinePlayer.health,
            hunger: onlinePlayer.hunger,
            thirst: onlinePlayer.thirst,
            energy: onlinePlayer.energy,
            cash: 0 // Will fetch actual cash in frontend
        });

        // Update room players list
        const roomPlayers = Array.from(players.values())
            .filter(p => p.location === onlinePlayer.location)
            .map(p => ({
                characterId: p.characterId,
                name: p.name,
                faction: p.faction,
                isDead: p.isDead,
            }));
        io.to(onlinePlayer.location).emit("roomPlayers", roomPlayers);
    }
}

// ═══════════════════════════════════════════════════════════════
//  GET /api/factions/:factionName/members — Fetch roster
// ═══════════════════════════════════════════════════════════════
router.get("/:factionName/members", authenticate, async (req: AuthRequest, res) => {
    try {
        const { factionName } = req.params;
        if (!["police", "medic", "mechanic", "none"].includes(factionName || "")) {
            return res.status(400).json({ error: "Invalid faction name" });
        }

        const members = await Character.find({ faction: factionName as any })
            .select("characterId name level factionRank avatar lastPlayed phoneNumber isDead")
            .lean();

        res.json({ members });
    } catch (err) {
        console.error("Failed to fetch faction roster:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/factions/:factionName/apply — Join/apply to faction
// ═══════════════════════════════════════════════════════════════
router.post("/:factionName/apply", authenticate, async (req: AuthRequest, res) => {
    try {
        const { factionName } = req.params;
        const { characterId } = req.body;

        if (!characterId) {
            return res.status(400).json({ error: "Character ID is required" });
        }

        if (!["police", "medic", "mechanic"].includes(factionName || "")) {
            return res.status(400).json({ error: "Invalid faction name" });
        }

        const character = await Character.findOne({ characterId, userId: req.user?.userId as any }) as any;
        if (!character) {
            return res.status(404).json({ error: "Character not found or access denied" });
        }

        // Join as rank 1 recruit
        character.faction = factionName;
        character.factionRank = 1;
        await character.save();

        // Sync active socket
        await syncOnlineFactionState(characterId, factionName as string, 1);

        res.json({ message: `Successfully joined ${factionName}`, character });
    } catch (err) {
        console.error("Failed to join faction:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ═══════════════════════════════════════════════════════════════
//  PATCH /api/factions/:factionName/members/:characterId — Promote/Demote
// ═══════════════════════════════════════════════════════════════
router.patch("/:factionName/members/:characterId", authenticate, async (req: AuthRequest, res) => {
    try {
        const { factionName, characterId } = req.params;
        const { action, leaderCharacterId } = req.body;

        if (!leaderCharacterId || !action || !["promote", "demote"].includes(action)) {
            return res.status(400).json({ error: "Invalid promote/demote parameters" });
        }

        if (!characterId) {
            return res.status(400).json({ error: "Character ID is required" });
        }

        // Validate leader
        const leader = await Character.findOne({ characterId: leaderCharacterId, userId: req.user?.userId as any }) as any;
        if (!leader || leader.faction !== factionName || leader.factionRank !== 5) {
            return res.status(403).json({ error: "Access denied. Only faction leaders (Rank 5) can promote/demote." });
        }

        // Validate target member
        const member = await Character.findOne({ characterId: characterId as string, faction: factionName as any }) as any;
        if (!member) {
            return res.status(404).json({ error: "Faction member not found" });
        }

        if (member.characterId === leader.characterId) {
            return res.status(400).json({ error: "You cannot promote or demote yourself." });
        }

        let newRank = member.factionRank;
        if (action === "promote") {
            newRank = Math.min(5, newRank + 1);
        } else {
            newRank = Math.max(1, newRank - 1);
        }

        member.factionRank = newRank;
        await member.save();

        // Sync L1 state
        await syncOnlineFactionState(characterId as string, factionName as string, newRank);

        res.json({ message: `Successfully updated rank for ${member.name} to ${newRank}`, member });
    } catch (err) {
        console.error("Failed to update member rank:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// ═══════════════════════════════════════════════════════════════
//  DELETE /api/factions/:factionName/members/:characterId — Kick
// ═══════════════════════════════════════════════════════════════
router.delete("/:factionName/members/:characterId", authenticate, async (req: AuthRequest, res) => {
    try {
        const { factionName, characterId } = req.params;
        const { leaderCharacterId } = req.body;

        if (!leaderCharacterId) {
            return res.status(400).json({ error: "Leader Character ID is required" });
        }

        if (!characterId) {
            return res.status(400).json({ error: "Character ID is required" });
        }

        // Validate leader
        const leader = await Character.findOne({ characterId: leaderCharacterId, userId: req.user?.userId as any }) as any;
        if (!leader || leader.faction !== factionName || leader.factionRank !== 5) {
            return res.status(403).json({ error: "Access denied. Only faction leaders (Rank 5) can kick." });
        }

        // Validate target
        const member = await Character.findOne({ characterId: characterId as string, faction: factionName as any }) as any;
        if (!member) {
            return res.status(404).json({ error: "Faction member not found" });
        }

        if (member.characterId === leader.characterId) {
            return res.status(400).json({ error: "You cannot kick yourself." });
        }

        member.faction = "none";
        member.factionRank = 0;
        await member.save();

        // Sync online socket
        await syncOnlineFactionState(characterId as string, "none", 0, true);

        res.json({ message: `Successfully kicked ${member.name} from the faction.` });
    } catch (err) {
        console.error("Failed to kick faction member:", err);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

export default router;
