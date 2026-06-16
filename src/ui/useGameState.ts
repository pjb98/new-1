import { useEffect, useState } from 'react';
import { bus } from '../game/EventBus';
import type { UiState, ClockState } from '../game/types';
import { EMPTY_SKILLS } from '../game/skills';

const initialState: UiState = {
  coins: 0,
  selected: 'hoe',
  selectedSeed: null,
  seeds: {},
  harvest: {},
  shop: [],
  animalCounts: {},
  progress: {
    level: 1,
    xpInto: 0,
    xpNeed: 1,
    upgrades: {},
    earned: 0,
    harvested: 0,
    mutationsFound: 0,
    discoveredPlants: [],
    discoveredMutations: [],
    achievements: [],
  },
  skills: { ...EMPTY_SKILLS },
  perks: {},
};

const initialClock: ClockState = { day: 1, clock: '06:00', phase: 'day', restockIn: 0 };

// Cache the latest snapshots so components that mount *after* an emit (e.g. a
// panel opened later) still get current data instead of the empty defaults.
let latestState = initialState;
let latestClock = initialClock;
bus.on('state', (s) => (latestState = s));
bus.on('clock', (c) => (latestClock = c));

// Subscribes a component to the latest game state pushed over the EventBus.
export function useGameState(): UiState {
  const [state, setState] = useState<UiState>(latestState);
  useEffect(() => {
    setState(latestState);
    return bus.on('state', setState);
  }, []);
  return state;
}

// Subscribes to the ~1Hz clock/restock state.
export function useClock(): ClockState {
  const [clock, setClock] = useState<ClockState>(latestClock);
  useEffect(() => {
    setClock(latestClock);
    return bus.on('clock', setClock);
  }, []);
  return clock;
}
