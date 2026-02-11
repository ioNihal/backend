import { Schema, model } from "mongoose";

const CharacterSchema = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
        required: true,
        index: true
    },

    characterId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    name: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 24
    },

    age: {
        type: Number,
        required: true,
        min: 18,
        max: 120
    },

    backstory: {
        type: String,
        required: true,
        minlength: 100,
        maxlength: 5000,
        trim: true
    },

    level: {
        type: Number,
        default: 1,
        min: 1
    },

    faction: {
        type: String,
        enum: ["none", "police", "medic", "mechanic"],
        default: "none"
    },

    location: {
        type: String,
        enum: ["all_saints", "downtown", "airport", "harbor"],
        default: "all_saints"
    },

    jobStatus: {
        type: String,
        enum: ["unemployed", "working", "cooldown"],
        default: "unemployed"
    },

    cash: {
        type: Number,
        default: 5000,
        min: 0
    },

    bankBalance: {
        type: Number,
        default: 0,
        min: 0
    },

    health: {
        type: Number,
        default: 100,
        min: 0,
        max: 100
    },

    energy: {
        type: Number,
        default: 100,
        min: 0,
        max: 100
    },

    experience: {
        type: Number,
        default: 0,
        min: 0
    },

    inventory: [{
        itemId: String,
        quantity: Number
    }],

    avatar: {
        type: String,
        default: null
    },

    lastPlayed: {
        type: Date,
        default: Date.now
    }

}, { timestamps: true });

export const Character = model("Character", CharacterSchema);
