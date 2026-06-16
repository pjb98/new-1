export const GAME_W = 1280;
export const GAME_H = 720;

// Game time: 1 real second = 1 game minute. 1440 real seconds = 1 game day
export const REAL_MS_PER_GAME_MIN = 1000;
export const GAME_MINS_PER_DAY = 1440;

export const WATER_DECAY_PER_MIN = 0.05;   // % per game minute
export const NUTRIENT_DECAY_PER_MIN = 0.02;

export const QUALITY_BOOST_WATER = 0.01;   // per minute well-watered
export const QUALITY_PENALTY_DRY = 0.03;   // per minute under-watered
export const QUALITY_BOOST_FED = 0.008;

export const HEAT_DECAY_PER_MIN = 0.05;    // heat cools over time

export const WEED_TOKEN_MINT = "WEEDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"; // placeholder devnet
export const WEED_TOKEN_REQUIRED = 1000;

export const COLORS = {
  bg: 0x0d0d0d,
  room: 0x1a1a2e,
  floor: 0x16213e,
  wall: 0x0f3460,
  pot: 0x4a3728,
  soil: 0x2d1b0e,
  water: 0x4fc3f7,
  panel: 0x1e1e2e,
  panelBorder: 0x313244,
  green: 0x4caf50,
  gold: 0xffd700,
  red: 0xf44336,
  purple: 0x9c27b0,
  text: 0xffffff,
  dim: 0x888888,
  weedToken: 0x00e676,
};
