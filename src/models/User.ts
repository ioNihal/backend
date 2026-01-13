import { Schema, model } from 'mongoose';

const UserSchema = new Schema({
    discordId: { type: String, required: true, unique: true },
    username: { type: String, required: true },
    avatar: String,
    email: String,
    accessToken: String,
    refreshToken: String,
}, { timestamps: true });


export const User = model('User', UserSchema);