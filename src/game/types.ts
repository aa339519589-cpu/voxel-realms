import type { BlockId } from "./blocks";

export type GameMode = "survival" | "creative";
export type Weather = "clear" | "rain";
export type GameScreen = "menu" | "loading" | "playing" | "paused" | "inventory" | "settings" | "dead";

export interface GameSettings {
  renderDistance: number;
  fov: number;
  sensitivity: number;
  masterVolume: number;
  quality: "low" | "medium" | "high";
  crosshair: "adaptive" | "light" | "dark";
}

export interface HotbarSlot {
  block: BlockId;
  count: number;
}

export interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  oxygen: number;
  selectedSlot: number;
  hotbar: HotbarSlot[];
  backpack: HotbarSlot[];
  survivalHotbar?: HotbarSlot[];
  survivalBackpack?: HotbarSlot[];
  mode: GameMode;
  flying: boolean;
}

export interface HudState {
  fps: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  hunger: number;
  oxygen: number;
  selectedSlot: number;
  hotbar: HotbarSlot[];
  targetName: string;
  breakProgress: number;
  timeLabel: string;
  weather: Weather;
  chunks: number;
  seed: string;
  mode: GameMode;
  flying: boolean;
  saving: boolean;
  message: string;
}

export interface WorldConfig {
  id: string;
  name: string;
  seed: string;
  mode: GameMode;
  generatorVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface EngineRuntimeSnapshot {
  player: PlayerState;
  patches: Record<string, number>;
  timeOfDay: number;
  weather: Weather;
}

export interface EngineEvents {
  onHud: (hud: HudState) => void;
  onScreen: (screen: GameScreen) => void;
  onLoading: (progress: number, stage: string) => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
  onSave: (snapshot: EngineRuntimeSnapshot) => void;
  onConfigChange: (config: WorldConfig) => void;
  onToggleDebug: () => void;
}

export const DEFAULT_SETTINGS: GameSettings = {
  renderDistance: 3,
  fov: 72,
  sensitivity: 0.72,
  masterVolume: 0.55,
  quality: "high",
  crosshair: "adaptive",
};
