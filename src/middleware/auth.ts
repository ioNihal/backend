import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
    user?: {
        userId: string;
        discordId: string;
    };
}

interface JwtPayload {
    userId: string;
    discordId: string;
}

export const authenticate = (req: AuthRequest, res: Response, next: NextFunction) => {
    const token = req.cookies.session;

    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload;
        req.user = Object.freeze({
            userId: decoded.userId,
            discordId: decoded.discordId,
        });
        next();
    } catch (err) {
        if (err instanceof jwt.TokenExpiredError) {
            return res.status(401).json({ error: "Session expired" });
        }
        return res.status(401).json({ error: "Invalid token" });
    }
}