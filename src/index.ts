import mongoose from "mongoose";
import express from 'express';
import http from 'http';
import dotenv from 'dotenv';
import cors from 'cors';
import cookieParser from "cookie-parser";
import authRoutes from '@/routes/auth.js';
import userRoutes from '@/routes/user.js';
import characterRoutes from '@/routes/character.js';
import { Server } from "socket.io";
import { initSockets } from "@/sockets/index.js";


dotenv.config();

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL,
        credentials: true
    }
});

//  Trust proxy 
app.set("trust proxy", 1);

// middlewares
app.use(cors({
    origin: process.env.CLIENT_URL || "http://localhost:3001",
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json());
app.use(cookieParser())

// connect db
mongoose.connect(process.env.MONGO_URI!)
    .then(() => console.log("Connected to MongoDB"))
    .catch((err) => console.error("MongoDB Connection Error:", err));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/me', userRoutes)
app.use('/api/characters', characterRoutes)

export { io };

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

initSockets(io);