/**
 * Static item registry for the MUD.
 * Items are referenced by their `id` throughout the game.
 * 
 * Effect values are the amount restored/applied when used.
 * Weapons have their own stats for the combat system.
 */

export type ItemCategory = "food" | "drink" | "weapon" | "medical" | "misc";

export type ItemEffect = {
    hunger?: number;
    thirst?: number;
    health?: number;
    energy?: number;
};

export type WeaponStats = {
    accuracy: number;      // base hit chance (0-100)
    minDamage: number;
    maxDamage: number;
    ammoPerMag: number;
};

export type Item = {
    id: string;
    name: string;
    description: string;
    category: ItemCategory;
    weight: number;           // kg — for future carry limit
    effects: ItemEffect;
    weaponStats?: WeaponStats;
    price: number;            // buy price from stores
};

export const items: Record<string, Item> = {

    // ── Food ────────────────────────────────────────────────
    burger: {
        id: "burger",
        name: "Cluckin' Bell Burger",
        description: "A greasy double-stack from the only franchise still standing. Restores hunger.",
        category: "food",
        weight: 0.3,
        effects: { hunger: 30 },
        price: 50,
    },

    hotdog: {
        id: "hotdog",
        name: "Street Hotdog",
        description: "A questionable street vendor special. You don't ask what's in it.",
        category: "food",
        weight: 0.2,
        effects: { hunger: 15 },
        price: 20,
    },

    pizza_slice: {
        id: "pizza_slice",
        name: "Pizza Slice",
        description: "A thick slice of pepperoni pizza from the Italian place downtown.",
        category: "food",
        weight: 0.3,
        effects: { hunger: 25, energy: 5 },
        price: 40,
    },

    taco: {
        id: "taco",
        name: "El Burro Taco",
        description: "An authentic taco from the El Burro Heights stand. Spicy and satisfying.",
        category: "food",
        weight: 0.2,
        effects: { hunger: 20 },
        price: 30,
    },

    steak_dinner: {
        id: "steak_dinner",
        name: "Steak Dinner",
        description: "A proper sit-down meal. Takes time to eat but fully satisfies.",
        category: "food",
        weight: 0.5,
        effects: { hunger: 60, energy: 15 },
        price: 150,
    },

    // ── Drinks ──────────────────────────────────────────────
    water_bottle: {
        id: "water_bottle",
        name: "Water Bottle",
        description: "A sealed plastic bottle of purified water.",
        category: "drink",
        weight: 0.5,
        effects: { thirst: 30 },
        price: 15,
    },

    soda: {
        id: "soda",
        name: "Sprunk Soda",
        description: "A can of Sprunk — 'The Essence of Life'. Carbonated sugar water.",
        category: "drink",
        weight: 0.35,
        effects: { thirst: 20, energy: 5 },
        price: 20,
    },

    energy_drink: {
        id: "energy_drink",
        name: "Junk Energy Drink",
        description: "A can of Junk Energy. 'Drink Junk, Feel Junk.' Restores thirst and energy.",
        category: "drink",
        weight: 0.3,
        effects: { thirst: 15, energy: 25 },
        price: 50,
    },

    coffee: {
        id: "coffee",
        name: "Black Coffee",
        description: "A cup of strong black coffee. Bitter but effective.",
        category: "drink",
        weight: 0.3,
        effects: { thirst: 10, energy: 20 },
        price: 25,
    },

    // ── Medical ─────────────────────────────────────────────
    bandage: {
        id: "bandage",
        name: "Bandage",
        description: "A basic first-aid bandage. Stops light bleeding.",
        category: "medical",
        weight: 0.1,
        effects: { health: 10 },
        price: 30,
    },

    first_aid_kit: {
        id: "first_aid_kit",
        name: "First Aid Kit",
        description: "A full medical kit with antiseptic, gauze, and painkillers.",
        category: "medical",
        weight: 0.8,
        effects: { health: 35 },
        price: 150,
    },

    painkiller: {
        id: "painkiller",
        name: "Painkillers",
        description: "A bottle of prescription painkillers. Use responsibly.",
        category: "medical",
        weight: 0.1,
        effects: { health: 15, energy: 10 },
        price: 75,
    },

    // ── Weapons ─────────────────────────────────────────────
    pistol: {
        id: "pistol",
        name: "9mm Pistol",
        description: "A standard-issue semi-automatic handgun. Reliable and concealable.",
        category: "weapon",
        weight: 1.0,
        effects: {},
        price: 500,
        weaponStats: {
            accuracy: 70,
            minDamage: 15,
            maxDamage: 25,
            ammoPerMag: 12,
        },
    },

    shotgun: {
        id: "shotgun",
        name: "Pump Shotgun",
        description: "A 12-gauge pump-action shotgun. Devastating at close range.",
        category: "weapon",
        weight: 3.5,
        effects: {},
        price: 1500,
        weaponStats: {
            accuracy: 85,
            minDamage: 35,
            maxDamage: 55,
            ammoPerMag: 6,
        },
    },

    bat: {
        id: "bat",
        name: "Baseball Bat",
        description: "An aluminum baseball bat. Louisville Slugger. Multi-purpose.",
        category: "weapon",
        weight: 1.2,
        effects: {},
        price: 100,
        weaponStats: {
            accuracy: 80,
            minDamage: 10,
            maxDamage: 20,
            ammoPerMag: Infinity,
        },
    },

    knife: {
        id: "knife",
        name: "Switchblade",
        description: "A spring-loaded switchblade. Quick, quiet, dangerous.",
        category: "weapon",
        weight: 0.3,
        effects: {},
        price: 200,
        weaponStats: {
            accuracy: 75,
            minDamage: 12,
            maxDamage: 22,
            ammoPerMag: Infinity,
        },
    },

    // ── Misc ────────────────────────────────────────────────
    phone: {
        id: "phone",
        name: "iFruit Phone",
        description: "A standard smartphone. Required for /call and /sms functionality.",
        category: "misc",
        weight: 0.2,
        effects: {},
        price: 200,
    },

    lockpick: {
        id: "lockpick",
        name: "Lockpick Set",
        description: "A set of thin metal tools. Definitely not for legal use.",
        category: "misc",
        weight: 0.1,
        effects: {},
        price: 350,
    },

    radio_device: {
        id: "radio_device",
        name: "Handheld Radio",
        description: "A walkie-talkie that can tune into radio frequencies. Required for /radio.",
        category: "misc",
        weight: 0.4,
        effects: {},
        price: 300,
    },
};

/** Lookup helper — returns undefined if not found */
export function getItem(itemId: string): Item | undefined {
    return items[itemId];
}

/** Get all items in a category */
export function getItemsByCategory(category: ItemCategory): Item[] {
    return Object.values(items).filter(i => i.category === category);
}
