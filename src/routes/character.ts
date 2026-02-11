import { Router } from "express";
import { Character } from "@/models/Character.js";
import { authenticate, type AuthRequest } from "@/middleware/auth.js";
import { nanoid } from "nanoid";
import mongoose from "mongoose";

const router = Router();

router.post("/", authenticate, async (req: AuthRequest, res) => {

    const session = await mongoose.startSession();

    try {
        session.startTransaction();

        const userId = req.user?.userId;
        if (!userId) {
            await session.abortTransaction();
            return res.status(401).json({ message: "Unauthorized" });
        }

        const { name, age, backstory } = req.body;

        if (!name || !name.includes("_")) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Invalid character name format" });
        }

        if (backstory.trim().split(/\s+/).length < 100) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Backstory must be at least 100 words" });
        }

        if (!age || typeof age !== "number" || age < 18 || age > 120) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Invalid age value" });
        }

        const existingCount = await Character.countDocuments(
            { userId },
            { session }
        );

        if (existingCount >= 2) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Maximum 2 characters allowed" });
        }

        const existingName = await Character.findOne(
            { userId, name }
        ).session(session);

        if (existingName) {
            await session.abortTransaction();
            return res.status(400).json({ message: "Character name already exists" });
        }

        const avatars = ["/avatar1.webp", "/avatar2.webp"];
        const avatar = avatars[Math.floor(Math.random() * avatars.length)] ?? null;

        const [newCharacter] = await Character.create([{
            userId,
            characterId: nanoid(12),
            name,
            age,
            backstory,
            avatar
        }], { session });

        await session.commitTransaction();

        return res.status(201).json(newCharacter);

    } catch (err) {
        await session.abortTransaction();
        console.error("Character creation failed:", err);
        return res.status(500).json({ message: "Internal Server Error" });
    } finally {
        session.endSession();
    }
});



router.get("/", authenticate, async (req: AuthRequest, res) => {

    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    try {
        const characters = await Character.find({ userId })
            .select("characterId name age level avatar faction jobStatus location lastPlayed")
            .lean();

        res.json(characters);
    } catch (err) {
        console.error("Failed to fetch characters:", err);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

export default router;