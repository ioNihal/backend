import { Router } from "express";
import axios from "axios";
import jwt from 'jsonwebtoken';
import { User } from "@/models/User.js";


const router = Router();

router.get("/discord", (_, res) => {
    const params = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID as string,
        redirect_uri: process.env.DISCORD_REDIRECT_URI!,
        response_type: "code",
        scope: "identify email",
    });

    res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

router.get('/discord/callback', async (req, res) => {
    const code = req.query.code as string;
    if (!code) return res.status(400).send('No code provided!');

    try {
        const params = new URLSearchParams({
            client_id: process.env.DISCORD_CLIENT_ID as string,
            client_secret: process.env.DISCORD_CLIENT_SECRET as string,
            grant_type: 'authorization_code',
            code,
            redirect_uri: process.env.DISCORD_REDIRECT_URI!
        });

        const tokenRes = await axios.post('https://discord.com/api/oauth2/token', params, {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });

        const userRes = await axios.get('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
        });

        const { id, username, avatar } = userRes.data;

        let user = await User.findOneAndUpdate(
            { discordId: id },
            { username, avatar, accessToken: tokenRes.data.access_token, refreshToken: tokenRes.data.refresh_token },
            { upsert: true, new: true }
        );

        const token = jwt.sign(
            {
                userId: user._id,
                discordId: id,
            },
            process.env.JWT_SECRET!,
            { expiresIn: '7d' }
        );

        const isProd = process.env.NODE_ENV === "production";

        res.cookie("session", token, {
            httpOnly: true,
            secure: isProd,
            sameSite: isProd ? "none" : "lax",
            maxAge: 7 * 24 * 60 * 60 * 1000,
            path: "/",
        });

        res.redirect(process.env.CLIENT_URL!)

    } catch (err) {
        console.error(err);
        res.status(500).send('Discord Auth Failed');
    }
});


router.post("/logout", (_, res) => {
    res.clearCookie("session", {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
    });

    res.status(200).json({ ok: true, message: "Log out successs" });
});



export default router;
