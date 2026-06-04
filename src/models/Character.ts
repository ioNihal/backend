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

    factionRank: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },

    location: {
        type: String,
        default: "all_saints"
    },

    jobStatus: {
        type: String,
        enum: ["unemployed", "working", "cooldown"],
        default: "unemployed"
    },

    // ── Economy ─────────────────────────────────────────

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

    // ── Vitals ──────────────────────────────────────────

    health: {
        type: Number,
        default: 100,
        min: 0,
        max: 100
    },

    hunger: {
        type: Number,
        default: 100,
        min: 0,
        max: 100
    },

    thirst: {
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

    // ── Combat / Death ──────────────────────────────────

    isDead: {
        type: Boolean,
        default: false
    },

    deathCooldown: {
        type: Date,
        default: null
    },

    killCount: {
        type: Number,
        default: 0,
        min: 0
    },

    deathCount: {
        type: Number,
        default: 0,
        min: 0
    },

    wantedLevel: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },

    wantedExpiry: {
        type: Date,
        default: null
    },

    // ── Communication ───────────────────────────────────

    phoneNumber: {
        type: String,
        unique: true,
        sparse: true
    },

    radioFrequency: {
        type: Number,
        default: null
    },

    // ── Experience ──────────────────────────────────────

    experience: {
        type: Number,
        default: 0,
        min: 0
    },

    // ── Inventory ───────────────────────────────────────

    inventory: [{
        itemId: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 }
    }],

    weapons: [{
        itemId: { type: String, required: true },
        ammo: { type: Number, default: 0, min: 0 }
    }],

    // ── Meta ────────────────────────────────────────────

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
