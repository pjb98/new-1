import EventEmitter from "eventemitter3";

export const EventBus = new EventEmitter();

// Events from game → UI
export const EV = {
  GAME_READY: "game-ready",
  STATE_UPDATE: "state-update",
  SCENE_CHANGE: "scene-change",
  POT_CLICKED: "pot-clicked",
  NOTIFICATION: "notification",
} as const;
