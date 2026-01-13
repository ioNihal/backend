import { User } from "@/models/User.js";
import { Router, type Response } from "express";
import { authenticate, type AuthRequest } from "@/middleware/auth.js";


const router = Router();

router.get('/me', authenticate, async (req: AuthRequest, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        const user = await User.findById(req.user.userId)
            .select("username avatar discordId")
            .lean();

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        return res.status(200).json(user);
    } catch (err) {
        console.error("Error fetching user:", err);
        return res.status(500).json({ message: "Internal Server Error" });
    }
});

export default router