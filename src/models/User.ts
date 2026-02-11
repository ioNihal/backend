import { Schema, model } from 'mongoose';

const UserSchema = new Schema({
    discordId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    username: {
        type: String,
        required: true
    },

    avatar: {
        type: String,
        default: null
    },

    email: {
        type: String,
        default: null
    }

}, { timestamps: true });


export const User = model('User', UserSchema);