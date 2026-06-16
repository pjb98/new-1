import type { UiState, ClockState } from './types';
import type { SkillId } from './skills';

// Typed pub/sub bridge between the Phaser game (authoritative state) and the
// React UI overlay. The game emits `state`/`clock`/`toast`; the UI emits
// `ui:*` intents.
export interface GameEvents {
  state: UiState;
  clock: ClockState;
  toast: string;
  'ui:selectTool': string; // 'hoe' | 'can' | 'seed'
  'ui:selectSeed': string; // plant id -> also switches to the seed tool
  'ui:buySeed': string; // plant id
  'ui:sellStack': string; // harvest stack key
  'ui:sellAll': void;
  'ui:buyUpgrade': string; // upgrade id
  'ui:buyAnimal': string; // animal id
  'ui:choosePerk': { skill: SkillId; level: number; perk: string }; // pick a milestone perk
}

type Handler<T> = (payload: T) => void;

class EventBus {
  // Internally untyped so a single map can hold handlers for every event; the
  // public methods restore full type safety per event key.
  private handlers = new Map<keyof GameEvents, Set<Handler<unknown>>>();

  on<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<unknown>);
    return () => this.off(event, handler);
  }

  off<K extends keyof GameEvents>(event: K, handler: Handler<GameEvents[K]>): void {
    this.handlers.get(event)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof GameEvents>(event: K, payload: GameEvents[K]): void {
    this.handlers.get(event)?.forEach((h) => (h as Handler<GameEvents[K]>)(payload));
  }
}

export const bus = new EventBus();
