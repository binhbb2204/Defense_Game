import { create } from 'zustand';

export interface GameHudSnapshot {
  /** False while players are in the ready-up lobby. */
  matchStarted: boolean;
  playerCount: number;
  readyCount: number;
  requiredReady: number;
  localReady: boolean;
  skipVotes: number;
  localSkipVoted: boolean;
  mapName: string;
  wave: number;
  totalWaves: number;
  waveName: string;
  waveActive: boolean;
  /** Remaining countdown seconds before next wave auto-spawns (0 when wave is active). */
  nextWaveCountdownSec: number;
  /** Full duration of current intermission countdown for progress bar calculation. */
  nextWaveDurationSec: number;
  aliveZombies: number;
  baseHp: number;
  maxBaseHp: number;
  cash: number;
  paused: boolean;
  timeScale: number;
  showDebugPath: boolean;
  gameOver: boolean;
  victory: boolean;
}

interface GameStoreState extends GameHudSnapshot {
  fps: number;
  tps: number;
  frameTimeMs: number;
  selectedTowerId: string | null;
  selectedTowerType: string | null;
  setSelectedTowerType: (id: string | null) => void;

  syncSnapshot: (snapshot: GameHudSnapshot) => void;
  setWaveStatus: (payload: {
    wave: number;
    waveName: string;
    waveActive: boolean;
    nextWaveCountdownSec: number;
    nextWaveDurationSec: number;
  }) => void;
  setCountdown: (nextWaveCountdownSec: number) => void;
  setCombatState: (payload: {
    baseHp: number;
    cash: number;
    aliveZombies: number;
    gameOver: boolean;
    victory: boolean;
  }) => void;
  setTelemetry: (payload: {
    fps: number;
    tps: number;
    frameTimeMs: number;
    aliveZombies: number;
  }) => void;
  setPlayback: (paused: boolean, timeScale: number) => void;
  setDebugPathVisible: (visible: boolean) => void;
  setSelectedTowerId: (id: string | null) => void;
}

export const useGameStore = create<GameStoreState>((set) => ({
  matchStarted: false,
  playerCount: 1,
  readyCount: 0,
  requiredReady: 1,
  localReady: false,
  skipVotes: 0,
  localSkipVoted: false,
  mapName: 'Collapsed Highway 01',
  wave: 0,
  totalWaves: 5,
  waveName: 'Prep Phase',
  waveActive: false,
  nextWaveCountdownSec: 10,
  nextWaveDurationSec: 10,
  aliveZombies: 0,
  baseHp: 100,
  maxBaseHp: 100,
  cash: 450,
  paused: false,
  timeScale: 1,
  showDebugPath: true,
  gameOver: false,
  victory: false,
  fps: 0,
  tps: 0,
  frameTimeMs: 0,
  selectedTowerId: null,
  selectedTowerType: null,
  setSelectedTowerType: (selectedTowerType) => set({ selectedTowerType }),

  syncSnapshot: (snapshot) => set(snapshot),
  setWaveStatus: (payload) => set(payload),
  setCountdown: (nextWaveCountdownSec) => set({ nextWaveCountdownSec }),
  setCombatState: (payload) => set(payload),
  setTelemetry: (payload) => set(payload),
  setPlayback: (paused, timeScale) => set({ paused, timeScale }),
  setDebugPathVisible: (showDebugPath) => set({ showDebugPath }),
  setSelectedTowerId: (selectedTowerId) => set({ selectedTowerId }),
}));
