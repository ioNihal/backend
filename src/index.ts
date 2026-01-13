import mongoose from "mongoose";
import express from 'express';
import dotenv from 'dotenv';
import authRoutes from '@/routes/auth.js';
import userRoutes from '@/routes/user.js';
import cors from 'cors';
import cookieParser from "cookie-parser";


dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

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
app.use('/api/', userRoutes)


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});