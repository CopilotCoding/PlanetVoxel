export const PLANET_RADIUS = 180;
export const ATMOSPHERE_RADIUS = 210;
export const CHUNK_SIZE = 16;
export const ISO_LEVEL = 0.5;
export const MINE_RADIUS = 3.5;
export const MINE_RANGE = 18;
export const TERRAIN_TOOL_RADIUS = 3.0;

// Hotbar tool definitions — selected with 1-9/0 or scroll wheel
export const TOOLS = [
  { id: 'mine',    name: 'Mine',     icon: '⛏' },
  { id: 'lower',   name: 'Lower',    icon: '▼' },
  { id: 'raise',   name: 'Raise',    icon: '▲' },
  { id: 'flatten', name: 'Flatten',  icon: '▬' },
];
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_SPEED = 8;
export const JUMP_FORCE = 10;
export const GRAVITY = 20;
export const JETPACK_FORCE = 25;
export const JETPACK_MAX_FUEL = 3.0;
export const JETPACK_REGEN_RATE = 0.4;
export const JETPACK_CONSUME_RATE = 1.0;

export const DEFAULT_SEED = 42;

export const MATERIALS = {
  REGOLITH:  { id: 0, name: 'Regolith',  color: 0xB8A070, basePrice: 0.1,  minDepth: 0.0,  maxDepth: 0.15 },
  ROCK:      { id: 1, name: 'Rock',      color: 0x888888, basePrice: 0.1,  minDepth: 0.0,  maxDepth: 0.30 },
  IRON:      { id: 2, name: 'Iron Ore',  color: 0xC04020, basePrice: 2,    minDepth: 0.10, maxDepth: 0.50 },
  COPPER:    { id: 3, name: 'Copper Ore',color: 0xE07020, basePrice: 3,    minDepth: 0.10, maxDepth: 0.50 },
  COAL:      { id: 4, name: 'Coal',      color: 0x222222, basePrice: 1,    minDepth: 0.01, maxDepth: 0.35 },
  TITANIUM:  { id: 5, name: 'Titanium',  color: 0x8090C0, basePrice: 8,    minDepth: 0.40, maxDepth: 0.80 },
  QUARTZ:    { id: 6, name: 'Quartz',    color: 0xF0E0FF, basePrice: 12,   minDepth: 0.45, maxDepth: 0.85 },
  GEM:       { id: 7, name: 'Gem',       color: 0x00FFAA, basePrice: 30,   minDepth: 0.70, maxDepth: 1.00 },
  XENONITE:  { id: 8, name: 'Xenonite', color: 0xFF00FF, basePrice: 70,   minDepth: 0.80, maxDepth: 1.00 },
};

export const MATERIAL_LIST = Object.values(MATERIALS);

export const PROCESSED_ITEMS = {
  IRON_CHUNK:      { id: 10, name: 'Iron Chunk',      color: 0xC04020, basePrice: 40   },
  COPPER_CHUNK:    { id: 11, name: 'Copper Chunk',    color: 0xE07020, basePrice: 50   },
  TITANIUM_CHUNK:  { id: 12, name: 'Titanium Chunk',  color: 0x8090C0, basePrice: 180  },
  IRON_INGOT:      { id: 20, name: 'Iron Ingot',      color: 0xFF6040, basePrice: 220  },
  COPPER_INGOT:    { id: 21, name: 'Copper Ingot',    color: 0xFF9040, basePrice: 280  },
  TITANIUM_INGOT:  { id: 22, name: 'Titanium Ingot',  color: 0xA0B0FF, basePrice: 1200 },
  CIRCUIT_BOARD:   { id: 30, name: 'Circuit Board',   color: 0x00CC44, basePrice: 1600 },
  PROCESSOR:       { id: 31, name: 'Processor',       color: 0x44FFAA, basePrice: 7500 },
  POWER_CELL:      { id: 32, name: 'Power Cell',      color: 0xFFEE00, basePrice: 2600 },
  ALLOY_PLATE:     { id: 33, name: 'Alloy Plate',     color: 0xCCDDFF, basePrice: 4000 },
  QUANTUM_CHIP:    { id: 34, name: 'Quantum Chip',    color: 0xFF44FF, basePrice: 28000 },
};

export const ALL_ITEMS = { ...MATERIALS, ...PROCESSED_ITEMS };

export const BIOME_COLORS = [
  { name: 'Rust Flats',    surface: 0xC05030, rock: 0x804030 },
  { name: 'Emerald Peaks', surface: 0x306050, rock: 0x204040 },
  { name: 'Pale Desert',   surface: 0xD0C090, rock: 0xA09060 },
  { name: 'Azure Tundra',  surface: 0x4060A0, rock: 0x304070 },
  { name: 'Violet Marsh',  surface: 0x604080, rock: 0x402060 },
];

export const TECH_TREE = [
  { id: 'extractor',    name: 'Extractor',       tier: 1, cost: 600,    requires: [],             desc: 'Auto-mines resource deposits' },
  { id: 'crusher',      name: 'Crusher',          tier: 1, cost: 800,    requires: [],             desc: 'Breaks ore into refined chunks' },
  { id: 'storage',      name: 'Storage Chest',    tier: 1, cost: 400,    requires: [],             desc: 'Buffers up to 500 items on belts' },
  { id: 'belt_basic',   name: 'Basic Belt',       tier: 1, cost: 300,    requires: [],             desc: 'Moves items between buildings' },
  { id: 'smelter',      name: 'Smelter',          tier: 2, cost: 2500,   requires: ['crusher'],    desc: 'Smelts chunks into ingots (needs coal)' },
  { id: 'generator',    name: 'Power Generator',  tier: 2, cost: 2000,   requires: ['smelter'],    desc: 'Burns coal to generate power' },
  { id: 'pylon',        name: 'Power Pylon',      tier: 2, cost: 1000,   requires: ['generator'],  desc: 'Extends power grid range' },
  { id: 'fabricator',   name: 'Fabricator',       tier: 3, cost: 9000,   requires: ['smelter'],    desc: 'Combines ingots into components' },
  { id: 'belt_fast',    name: 'Fast Belt',         tier: 3, cost: 7000,   requires: ['belt_basic'], desc: '3x faster item transport' },
  { id: 'market_plus',  name: 'Market Upgrade',   tier: 3, cost: 14000,  requires: ['fabricator'], desc: 'Sell directly from factory output' },
  { id: 'assembler',    name: 'Assembler',         tier: 4, cost: 40000,  requires: ['fabricator'], desc: 'Makes high-value finished products' },
  { id: 'belt_ultra',   name: 'Ultra Belt',        tier: 4, cost: 30000,  requires: ['belt_fast'],  desc: '8x faster item transport' },
  { id: 'jetpack_fuel',   name: 'Jetpack Fuel Tank', tier: 2, cost: 1600,  requires: [],             desc: '2x jetpack fuel capacity & regen' },
  { id: 'jetpack_thrust', name: 'Jetpack Booster',  tier: 3, cost: 5600,  requires: ['jetpack_fuel'], desc: '1.6x jetpack thrust force' },
  { id: 'jetpack_wings',  name: 'Glide Wings',      tier: 4, cost: 22000, requires: ['jetpack_thrust'], desc: 'Mouse-aimed flight — thrust where you look, glide like a jet' },
  { id: 'lantern_1',      name: 'Lantern Lens I',   tier: 1, cost: 500,   requires: [],             desc: '+50% lantern range' },
  { id: 'lantern_2',      name: 'Lantern Lens II',  tier: 3, cost: 6000,  requires: ['lantern_1'],  desc: '+100% lantern range (total 3x)' },
  { id: 'mining_radius_1',name: 'Wide Drill Head',  tier: 2, cost: 2200,  requires: [],             desc: '+40% mining radius' },
  { id: 'mining_radius_2',name: 'Mega Drill Head',  tier: 4, cost: 18000, requires: ['mining_radius_1'], desc: '+80% mining radius (total 2.2x)' },
  { id: 'mining_speed_1', name: 'Rapid Drill Motor',tier: 2, cost: 2200,  requires: [],             desc: '40% faster mining' },
  { id: 'mining_speed_2', name: 'Turbo Drill Motor',tier: 4, cost: 18000, requires: ['mining_speed_1'], desc: '80% faster mining (total 2.2x)' },
];

export const BUILDING_DEFS = {
  extractor:   { name: 'Extractor',       icon: '⛏', techId: 'extractor',  placeCost: 60,   color: 0xFF6020, desc: 'Auto-mines below it' },
  crusher:     { name: 'Crusher',         icon: '🔨', techId: 'crusher',    placeCost: 100,  color: 0xCC8840, desc: 'Ore → Chunks' },
  smelter:     { name: 'Smelter',         icon: '🔥', techId: 'smelter',    placeCost: 250,  color: 0xFF4400, desc: 'Chunks+Coal → Ingots' },
  fabricator:  { name: 'Fabricator',      icon: '⚙', techId: 'fabricator', placeCost: 600,  color: 0x4488FF, desc: 'Ingots → Components' },
  assembler:   { name: 'Assembler',       icon: '🏭', techId: 'assembler',  placeCost: 1800, color: 0x8844FF, desc: 'Components → Products' },
  storage:     { name: 'Storage Chest',   icon: '📦', techId: 'storage',    placeCost: 50,   color: 0xAA8822, desc: '500-item buffer' },
  terminal:    { name: 'Market Terminal', icon: '💰', techId: null,         placeCost: 0,    color: 0xFFD700, desc: 'Sell items for money' },
  generator:   { name: 'Power Generator', icon: '⚡', techId: 'generator',  placeCost: 180,  color: 0xFFEE00, desc: 'Coal → Power' },
  pylon:       { name: 'Power Pylon',     icon: '📡', techId: 'pylon',      placeCost: 70,   color: 0x88AAFF, desc: 'Extends power range' },
};
