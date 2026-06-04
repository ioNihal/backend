export type MapNode = {
    id: string;
    name: string;
    description: string;
    connections: string[];
    zone: "civilian" | "industrial" | "restricted" | "wilderness";
    safeZone: boolean;
    x: number;
    y: number;
};

export const mapNodes: Record<string, MapNode> = {

    // ═══════════════════════════════════════════
    //  CENTRAL / CIVILIAN
    // ═══════════════════════════════════════════

    downtown: {
        id: "downtown",
        name: "Downtown Los Santos",
        description:
            "The corporate heart of the city. Glass towers loom overhead, casting long shadows over crowded sidewalks. " +
            "Street vendors shout over the hum of traffic. The Maze Bank Tower dominates the skyline to the west. " +
            "There's a bank branch here for deposits and withdrawals.",
        connections: ["all_saints", "harbor", "grove_street", "vinewood", "city_hall"],
        zone: "civilian",
        safeZone: false,
        x: 500,
        y: 350,
    },

    city_hall: {
        id: "city_hall",
        name: "Los Santos City Hall",
        description:
            "A grand marble building with pillars and the city flag billowing above. Inside, government clerks process " +
            "paperwork while politicians argue behind closed doors. This is a designated safe zone — no violence tolerated.",
        connections: ["downtown", "vinewood"],
        zone: "civilian",
        safeZone: true,
        x: 450,
        y: 200,
    },

    vinewood: {
        id: "vinewood",
        name: "Vinewood Boulevard",
        description:
            "The glittering entertainment strip. Neon signs flicker above nightclubs and bars. Tourists pose by the " +
            "Vinewood sign while locals hustle on every corner. The air smells like perfume and desperation.",
        connections: ["downtown", "city_hall", "richman"],
        zone: "civilian",
        safeZone: false,
        x: 350,
        y: 150,
    },

    richman: {
        id: "richman",
        name: "Richman Hills",
        description:
            "Gated mansions line winding roads with manicured gardens. Private security patrols every block. " +
            "The view of the city below is breathtaking. Wealth and silence hang heavy in the air.",
        connections: ["vinewood", "sandy_shores"],
        zone: "civilian",
        safeZone: false,
        x: 200,
        y: 100,
    },

    // ═══════════════════════════════════════════
    //  MEDICAL / EMERGENCY
    // ═══════════════════════════════════════════

    all_saints: {
        id: "all_saints",
        name: "All Saints General Hospital",
        description:
            "The primary medical facility in Los Santos. The ER buzzes with activity — ambulance sirens, " +
            "the clatter of gurneys, and the low hum of fluorescent lights. A safe zone. Medics can revive " +
            "downed citizens here. Characters respawn at this location on death.",
        connections: ["downtown", "airport", "grove_street"],
        zone: "civilian",
        safeZone: true,
        x: 650,
        y: 300,
    },

    // ═══════════════════════════════════════════
    //  INDUSTRIAL / DANGEROUS
    // ═══════════════════════════════════════════

    harbor: {
        id: "harbor",
        name: "Ocean Docks",
        description:
            "The industrial port of Los Santos. Cargo containers stacked ten high form a labyrinth along the waterfront. " +
            "Forklifts beep, ships creak against the pier, and the smell of diesel hangs in the salt air. " +
            "Trucker jobs available here.",
        connections: ["downtown", "airport", "grove_street", "warehouse_district"],
        zone: "industrial",
        safeZone: false,
        x: 350,
        y: 550,
    },

    warehouse_district: {
        id: "warehouse_district",
        name: "Warehouse District",
        description:
            "Rows of abandoned and active warehouses line cracked asphalt roads. Graffiti covers every surface. " +
            "The area is poorly lit at night and known for illegal deals. Watch your back.",
        connections: ["harbor", "grove_street"],
        zone: "industrial",
        safeZone: false,
        x: 250,
        y: 450,
    },

    // ═══════════════════════════════════════════
    //  GANG TERRITORY
    // ═══════════════════════════════════════════

    grove_street: {
        id: "grove_street",
        name: "Grove Street",
        description:
            "A narrow cul-de-sac in the south side. Low-rise houses with chain-link fences, basketball courts, " +
            "and the distant thump of bass from a parked car. This is home turf for the local gangs. " +
            "Tensions run high — outsiders draw attention.",
        connections: ["downtown", "all_saints", "harbor", "warehouse_district", "el_burro"],
        zone: "civilian",
        safeZone: false,
        x: 500,
        y: 500,
    },

    el_burro: {
        id: "el_burro",
        name: "El Burro Heights",
        description:
            "A dusty hillside neighborhood overlooking the industrial zone. Stray dogs roam the streets. " +
            "A few taco stands serve the working-class residents. The atmosphere is tense but community-minded.",
        connections: ["grove_street", "airport"],
        zone: "civilian",
        safeZone: false,
        x: 700,
        y: 500,
    },

    // ═══════════════════════════════════════════
    //  TRANSPORTATION
    // ═══════════════════════════════════════════

    airport: {
        id: "airport",
        name: "LS International Airport",
        description:
            "Los Santos International Airport — LSIA. The roar of jet engines shakes the ground as planes " +
            "taxi along the runway. Inside the terminal, travellers rush between gates. Mechanic jobs available. " +
            "A gateway to the northern outskirts.",
        connections: ["all_saints", "harbor", "el_burro", "sandy_shores"],
        zone: "civilian",
        safeZone: false,
        x: 600,
        y: 650,
    },

    // ═══════════════════════════════════════════
    //  OUTSKIRTS / WILDERNESS
    // ═══════════════════════════════════════════

    sandy_shores: {
        id: "sandy_shores",
        name: "Sandy Shores",
        description:
            "A dried-out desert town north of the city. Trailer parks, a gas station, and the occasional " +
            "tumbleweed rolling across the road. Meth fumes waft from somewhere you'd rather not investigate. " +
            "Law enforcement is sparse out here.",
        connections: ["airport", "richman", "paleto_bay"],
        zone: "wilderness",
        safeZone: false,
        x: 350,
        y: 750,
    },

    paleto_bay: {
        id: "paleto_bay",
        name: "Paleto Bay",
        description:
            "A small coastal town on the northern shore. A lighthouse stands at the cliff's edge. " +
            "The Cluckin' Bell drive-through is the only franchise in town. Quiet, isolated, and perfect " +
            "for those who want to disappear.",
        connections: ["sandy_shores"],
        zone: "wilderness",
        safeZone: false,
        x: 150,
        y: 700,
    },

    // ═══════════════════════════════════════════
    //  RESTRICTED / LAW ENFORCEMENT
    // ═══════════════════════════════════════════

    police_hq: {
        id: "police_hq",
        name: "LSPD Headquarters",
        description:
            "The Los Santos Police Department's main station. Bulletproof glass, metal detectors, and the " +
            "constant crackle of police radios. Holding cells are visible through a reinforced door. " +
            "Safe zone — restricted to law enforcement faction for most operations.",
        connections: ["downtown"],
        zone: "restricted",
        safeZone: true,
        x: 600,
        y: 200,
    },
};
