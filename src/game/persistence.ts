import {
  openDB,
  type DBSchema,
  type IDBPDatabase,
  type IDBPObjectStore,
  type StoreNames,
} from "idb";
import { BlockId, isBlockId } from "./blocks";
import { BACKPACK_SIZE, createDefaultHotbar, createEmptyBackpack } from "./inventory";
import {
  DEFAULT_SETTINGS,
  type GameSettings,
  type PlayerState as RuntimePlayerState,
  type Weather,
  type WorldConfig,
} from "./types";

export const WORLD_DATA_SCHEMA_VERSION = 3;

const DATABASE_NAME = "voxel-realms-worlds";
const DATABASE_VERSION = 3;
const DEFAULT_GENERATOR_VERSION = 1;
const MAX_PATCHES_PER_IMPORT = 250_000;
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_WORLD_COORDINATE = 1_000_000;
const MAX_PATCH_Y = 39;

export type Vector3Tuple = [number, number, number];
export type RotationTuple = [number, number];
export type GameMode = "survival" | "creative";

export interface InventorySlot {
  blockId: number;
  count: number;
}

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  createdAt: number;
  updatedAt: number;
  lastPlayedAt: number;
  elapsedSeconds: number;
  generatorVersion: number;
  spawn: Vector3Tuple;
}

export interface PlayerState {
  worldId: string;
  position: Vector3Tuple;
  rotation: RotationTuple;
  velocity: Vector3Tuple;
  health: number;
  maxHealth: number;
  hunger: number;
  selectedSlot: number;
  inventory: InventorySlot[];
  gameMode: GameMode;
  updatedAt: number;
}

export interface WorldSettings {
  worldId: string;
  renderDistance: number;
  fieldOfView: number;
  mouseSensitivity: number;
  masterVolume: number;
  effectsVolume: number;
  ambientVolume: number;
  showFps: boolean;
  invertY: boolean;
  reducedMotion: boolean;
  updatedAt: number;
}

export interface VoxelPatch {
  worldId: string;
  x: number;
  y: number;
  z: number;
  blockId: number;
  updatedAt: number;
}

export interface VoxelPatchInput {
  x: number;
  y: number;
  z: number;
  blockId: number;
  updatedAt?: number;
}

export interface PatchBounds {
  minX?: number;
  maxX?: number;
  minY?: number;
  maxY?: number;
  minZ?: number;
  maxZ?: number;
}

export interface WorldSnapshot {
  schemaVersion: number;
  exportedAt?: number;
  meta: WorldMeta;
  player: PlayerState;
  settings: WorldSettings;
  patches: VoxelPatch[];
}

/** Runtime-facing save shape used by the game engine. */
export interface WorldSave {
  schemaVersion?: number;
  config: WorldConfig;
  player: RuntimePlayerState;
  patches: Record<string, number>;
  timeOfDay: number;
  weather: Weather;
}

export interface CreateWorldOptions {
  id?: string;
  name: string;
  seed?: number;
  spawn?: Vector3Tuple;
  player?: Partial<Omit<PlayerState, "worldId">>;
  settings?: Partial<Omit<WorldSettings, "worldId">>;
}

export interface ImportWorldOptions {
  conflict?: "copy" | "replace" | "error";
  name?: string;
}

export interface DataIssue {
  level: "warning" | "error";
  path: string;
  message: string;
  repaired: boolean;
}

export interface WorldValidationResult {
  valid: boolean;
  snapshot: WorldSnapshot | null;
  issues: DataIssue[];
}

export class PersistenceError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PersistenceError";
    this.cause = cause;
  }
}

export class MalformedWorldDataError extends PersistenceError {
  readonly issues: DataIssue[];

  constructor(message: string, issues: DataIssue[]) {
    super(message);
    this.name = "MalformedWorldDataError";
    this.issues = issues;
  }
}

interface StoredWorld extends WorldMeta {
  schemaVersion: number;
  runtimeConfig?: WorldConfig;
  timeOfDay?: number;
  weather?: Weather;
}

interface StoredPlayer extends PlayerState {
  schemaVersion: number;
  runtimePlayer?: RuntimePlayerState;
}

interface StoredSettings extends WorldSettings {
  schemaVersion: number;
}

interface StoredPatch extends VoxelPatch {
  key: string;
  chunk: [string, number, number];
  schemaVersion: number;
}

interface GlobalSettingsRecord {
  key: "global";
  schemaVersion: number;
  settings: GameSettings;
}

interface WorldDatabase extends DBSchema {
  worlds: {
    key: string;
    value: StoredWorld;
    indexes: { "by-updated-at": number; "by-name": string };
  };
  players: {
    key: string;
    value: StoredPlayer;
  };
  settings: {
    key: string;
    value: StoredSettings;
  };
  patches: {
    key: string;
    value: StoredPatch;
    indexes: {
      "by-world": string;
      "by-world-chunk": [string, number, number];
    };
  };
  globalSettings: {
    key: "global";
    value: GlobalSettingsRecord;
  };
}

let databasePromise: Promise<IDBPDatabase<WorldDatabase>> | undefined;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, finiteNumber(value, fallback)));
}

function wrappedAngle(value: unknown, fallback: number): number {
  const angle = finiteNumber(value, fallback);
  const turn = Math.PI * 2;
  return ((angle + Math.PI) % turn + turn) % turn - Math.PI;
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(boundedNumber(value, fallback, min, max));
}

function timestamp(value: unknown, fallback: number): number {
  return integer(value, fallback, 0, Number.MAX_SAFE_INTEGER);
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function cleanName(value: unknown, fallback = "Recovered world"): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80);
  return cleaned || fallback;
}

function cleanId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(cleaned) ? cleaned : null;
}

function vector3(value: unknown, fallback: Vector3Tuple): Vector3Tuple {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return [
    finiteNumber(value[0], fallback[0]),
    finiteNumber(value[1], fallback[1]),
    finiteNumber(value[2], fallback[2]),
  ];
}

function rotation(value: unknown, fallback: RotationTuple): RotationTuple {
  if (!Array.isArray(value) || value.length < 2) return [...fallback];
  return [
    finiteNumber(value[0], fallback[0]),
    boundedNumber(value[1], fallback[1], -Math.PI / 2, Math.PI / 2),
  ];
}

function randomId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `world-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function randomSeed(): number {
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    return crypto.getRandomValues(new Uint32Array(1))[0] | 0;
  }
  return (Math.random() * 0xffffffff) | 0;
}

function seedToNumber(seed: string): number {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value | 0;
}

function patchKey(worldId: string, x: number, y: number, z: number): string {
  return `${worldId}|${x},${y},${z}`;
}

function chunkCoordinate(value: number): number {
  return Math.floor(value / 16);
}

function parseCoordinateKey(key: string): [number, number, number] | null {
  const parts = key.split(",");
  if (parts.length !== 3) return null;
  const coordinates = parts.map(Number);
  if (!coordinates.every(Number.isSafeInteger)) return null;
  return coordinates as [number, number, number];
}

function validPatchCoordinates(coordinates: readonly number[]): boolean {
  return coordinates.length === 3
    && coordinates.every(Number.isSafeInteger)
    && Math.abs(coordinates[0]) <= MAX_WORLD_COORDINATE
    && coordinates[1] >= 0
    && coordinates[1] <= MAX_PATCH_Y
    && Math.abs(coordinates[2]) <= MAX_WORLD_COORDINATE;
}

function defaultMeta(id: string, name: string, seed = randomSeed(), spawn: Vector3Tuple = [0, 32, 0]): WorldMeta {
  const now = Date.now();
  return {
    id,
    name: cleanName(name, "New world"),
    seed: integer(seed, randomSeed(), -0x80000000, 0x7fffffff),
    createdAt: now,
    updatedAt: now,
    lastPlayedAt: now,
    elapsedSeconds: 0,
    generatorVersion: DEFAULT_GENERATOR_VERSION,
    spawn: vector3(spawn, [0, 32, 0]),
  };
}

export function createDefaultPlayerState(worldId: string, spawn: Vector3Tuple = [0, 32, 0]): PlayerState {
  return {
    worldId,
    position: vector3(spawn, [0, 32, 0]),
    rotation: [0, 0],
    velocity: [0, 0, 0],
    health: 20,
    maxHealth: 20,
    hunger: 20,
    selectedSlot: 0,
    inventory: [],
    gameMode: "survival",
    updatedAt: Date.now(),
  };
}

export function createDefaultWorldSettings(worldId: string): WorldSettings {
  return {
    worldId,
    renderDistance: 5,
    fieldOfView: 75,
    mouseSensitivity: 0.55,
    masterVolume: 0.8,
    effectsVolume: 0.85,
    ambientVolume: 0.4,
    showFps: false,
    invertY: false,
    reducedMotion: false,
    updatedAt: Date.now(),
  };
}

function normalizeMeta(raw: unknown, expectedId?: string, issues?: DataIssue[]): WorldMeta | null {
  if (!isRecord(raw)) return null;
  const rawId = cleanId(raw.id);
  const id = expectedId ?? rawId;
  if (!id) return null;
  const fallback = defaultMeta(id, cleanName(raw.name), finiteNumber(raw.seed, randomSeed()));
  if (!rawId) issues?.push({ level: "warning", path: "meta.id", message: "Missing or invalid world id was replaced.", repaired: true });
  if (expectedId && rawId !== expectedId) issues?.push({ level: "warning", path: "meta.id", message: "World id did not match its storage key and was repaired.", repaired: true });
  if (typeof raw.name !== "string" || !raw.name.trim()) issues?.push({ level: "warning", path: "meta.name", message: "Empty world name was replaced.", repaired: true });
  return {
    id,
    name: cleanName(raw.name),
    seed: integer(raw.seed, fallback.seed, -0x80000000, 0x7fffffff),
    createdAt: timestamp(raw.createdAt, fallback.createdAt),
    updatedAt: timestamp(raw.updatedAt, fallback.updatedAt),
    lastPlayedAt: timestamp(raw.lastPlayedAt, fallback.lastPlayedAt),
    elapsedSeconds: boundedNumber(raw.elapsedSeconds, 0, 0, Number.MAX_SAFE_INTEGER),
    generatorVersion: integer(raw.generatorVersion, DEFAULT_GENERATOR_VERSION, 1, 9999),
    spawn: vector3(raw.spawn, fallback.spawn),
  };
}

function normalizeInventory(value: unknown, issues?: DataIssue[]): InventorySlot[] {
  if (!Array.isArray(value)) return [];
  const slots: InventorySlot[] = [];
  for (let index = 0; index < Math.min(value.length, 64); index += 1) {
    const entry = value[index];
    if (!isRecord(entry)) {
      issues?.push({ level: "warning", path: `player.inventory[${index}]`, message: "Invalid inventory slot was ignored.", repaired: true });
      continue;
    }
    const blockId = integer(entry.blockId, -1, 0, 65535);
    const count = integer(entry.count, 0, 0, 999);
    if (blockId < 0 || count === 0) continue;
    slots.push({ blockId, count });
  }
  return slots;
}

function normalizePlayer(raw: unknown, worldId: string, spawn: Vector3Tuple, issues?: DataIssue[]): PlayerState {
  const source = isRecord(raw) ? raw : {};
  const fallback = createDefaultPlayerState(worldId, spawn);
  const maxHealth = boundedNumber(source.maxHealth, fallback.maxHealth, 1, 1000);
  return {
    worldId,
    position: vector3(source.position, fallback.position),
    rotation: rotation(source.rotation, fallback.rotation),
    velocity: vector3(source.velocity, fallback.velocity),
    health: boundedNumber(source.health, fallback.health, 0, maxHealth),
    maxHealth,
    hunger: boundedNumber(source.hunger, fallback.hunger, 0, 20),
    selectedSlot: integer(source.selectedSlot, fallback.selectedSlot, 0, 8),
    inventory: normalizeInventory(source.inventory, issues),
    gameMode: source.gameMode === "creative" ? "creative" : "survival",
    updatedAt: timestamp(source.updatedAt, fallback.updatedAt),
  };
}

function normalizeSettings(raw: unknown, worldId: string): WorldSettings {
  const source = isRecord(raw) ? raw : {};
  const fallback = createDefaultWorldSettings(worldId);
  return {
    worldId,
    renderDistance: integer(source.renderDistance, fallback.renderDistance, 2, 16),
    fieldOfView: integer(source.fieldOfView, fallback.fieldOfView, 50, 110),
    mouseSensitivity: boundedNumber(source.mouseSensitivity, fallback.mouseSensitivity, 0.05, 2),
    masterVolume: boundedNumber(source.masterVolume, fallback.masterVolume, 0, 1),
    effectsVolume: boundedNumber(source.effectsVolume, fallback.effectsVolume, 0, 1),
    ambientVolume: boundedNumber(source.ambientVolume, fallback.ambientVolume, 0, 1),
    showFps: booleanValue(source.showFps, fallback.showFps),
    invertY: booleanValue(source.invertY, fallback.invertY),
    reducedMotion: booleanValue(source.reducedMotion, fallback.reducedMotion),
    updatedAt: timestamp(source.updatedAt, fallback.updatedAt),
  };
}

function normalizeGlobalSettings(raw: unknown): GameSettings {
  const source = isRecord(raw) ? raw : {};
  return {
    renderDistance: integer(source.renderDistance, DEFAULT_SETTINGS.renderDistance, 2, 8),
    fov: integer(source.fov, DEFAULT_SETTINGS.fov, 50, 110),
    sensitivity: boundedNumber(source.sensitivity, DEFAULT_SETTINGS.sensitivity, 0.05, 2),
    masterVolume: boundedNumber(source.masterVolume, DEFAULT_SETTINGS.masterVolume, 0, 1),
    quality: source.quality === "low" || source.quality === "medium" || source.quality === "high"
      ? source.quality
      : DEFAULT_SETTINGS.quality,
    crosshair: source.crosshair === "light" || source.crosshair === "dark" || source.crosshair === "adaptive"
      ? source.crosshair
      : DEFAULT_SETTINGS.crosshair,
  };
}

function defaultRuntimePlayer(mode: GameMode = "survival", spawn: Vector3Tuple = [0.5, 24, 0.5]): RuntimePlayerState {
  return {
    x: spawn[0],
    y: spawn[1],
    z: spawn[2],
    yaw: 0,
    pitch: 0,
    health: 20,
    hunger: 20,
    oxygen: 20,
    selectedSlot: 0,
    hotbar: createDefaultHotbar(mode),
    backpack: createEmptyBackpack(),
    mode,
    flying: mode === "creative",
  };
}

function normalizeRuntimeHotbar(raw: unknown, mode: GameMode, issues: DataIssue[] | undefined, path: string): RuntimePlayerState["hotbar"] {
  const fallback = createDefaultHotbar(mode);
  const input = Array.isArray(raw) ? raw : [];
  if (input.length !== 9) {
    issues?.push({ level: "warning", path, message: "Hotbar was repaired to nine slots.", repaired: true });
  }
  return fallback.map((fallbackSlot, index) => {
    const slot = input[index];
    if (!isRecord(slot) || typeof slot.block !== "number" || !isBlockId(slot.block) || slot.block === BlockId.Air) {
      if (slot !== undefined) issues?.push({ level: "warning", path: `${path}[${index}]`, message: "Invalid hotbar slot was replaced.", repaired: true });
      return { ...fallbackSlot };
    }
    return {
      block: slot.block,
      count: mode === "creative" ? -1 : integer(slot.count, fallbackSlot.count, 0, 999),
    };
  });
}

function normalizeRuntimeBackpack(raw: unknown, issues?: DataIssue[], path = "player.backpack"): RuntimePlayerState["backpack"] {
  const fallback = createEmptyBackpack();
  const input = Array.isArray(raw) ? raw : [];
  if (raw !== undefined && input.length !== BACKPACK_SIZE) {
    issues?.push({ level: "warning", path, message: `Backpack was repaired to ${BACKPACK_SIZE} slots.`, repaired: true });
  }
  return fallback.map((fallbackSlot, index) => {
    const slot = input[index];
    if (!isRecord(slot)) return { ...fallbackSlot };
    const count = integer(slot.count, 0, 0, 999);
    if (count === 0) return { ...fallbackSlot };
    if (typeof slot.block !== "number" || !isBlockId(slot.block) || slot.block === BlockId.Air) {
      issues?.push({ level: "warning", path: `${path}[${index}]`, message: "Invalid backpack slot was emptied.", repaired: true });
      return { ...fallbackSlot };
    }
    return { block: slot.block, count };
  });
}

function normalizeRuntimePlayer(raw: unknown, mode: GameMode, spawn: Vector3Tuple, issues?: DataIssue[]): RuntimePlayerState {
  const source = isRecord(raw) ? raw : {};
  const fallback = defaultRuntimePlayer(mode, spawn);
  const hotbar = normalizeRuntimeHotbar(source.hotbar, mode, issues, "player.hotbar");
  const backpack = normalizeRuntimeBackpack(source.backpack, issues);
  const survivalHotbar = mode === "creative" && Array.isArray(source.survivalHotbar)
    ? normalizeRuntimeHotbar(source.survivalHotbar, "survival", issues, "player.survivalHotbar")
    : undefined;
  const survivalBackpack = mode === "creative" && Array.isArray(source.survivalBackpack)
    ? normalizeRuntimeBackpack(source.survivalBackpack, issues, "player.survivalBackpack")
    : undefined;
  return {
    x: boundedNumber(source.x, fallback.x, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE),
    y: boundedNumber(source.y, fallback.y, -64, 512),
    z: boundedNumber(source.z, fallback.z, -MAX_WORLD_COORDINATE, MAX_WORLD_COORDINATE),
    yaw: wrappedAngle(source.yaw, fallback.yaw),
    pitch: boundedNumber(source.pitch, fallback.pitch, -Math.PI / 2, Math.PI / 2),
    health: boundedNumber(source.health, fallback.health, 0, 20),
    hunger: boundedNumber(source.hunger, fallback.hunger, 0, 20),
    oxygen: boundedNumber(source.oxygen, fallback.oxygen, 0, 20),
    selectedSlot: integer(source.selectedSlot, fallback.selectedSlot, 0, 8),
    hotbar,
    backpack,
    survivalHotbar,
    survivalBackpack,
    mode,
    flying: mode === "creative" ? booleanValue(source.flying, true) : false,
  };
}

function normalizeWorldConfig(raw: unknown, issues?: DataIssue[]): WorldConfig | null {
  if (!isRecord(raw)) return null;
  const id = cleanId(raw.id);
  if (!id) {
    issues?.push({ level: "error", path: "config.id", message: "World id is missing or invalid.", repaired: false });
    return null;
  }
  if (typeof raw.name !== "string" || !raw.name.trim()) {
    issues?.push({ level: "warning", path: "config.name", message: "Empty world name was replaced.", repaired: true });
  }
  const now = Date.now();
  return {
    id,
    name: cleanName(raw.name),
    seed: typeof raw.seed === "string" && raw.seed.trim()
      ? raw.seed.trim().slice(0, 128)
      : String(integer(raw.seed, randomSeed(), -0x80000000, 0x7fffffff)),
    mode: raw.mode === "creative" ? "creative" : "survival",
    generatorVersion: integer(raw.generatorVersion, DEFAULT_GENERATOR_VERSION, 1, 9999),
    createdAt: timestamp(raw.createdAt, now),
    updatedAt: timestamp(raw.updatedAt, now),
  };
}

function normalizePatchRecord(raw: unknown, issues?: DataIssue[]): Record<string, number> {
  if (!isRecord(raw)) return {};
  const patches: Record<string, number> = {};
  const entries = Object.entries(raw);
  if (entries.length > MAX_PATCHES_PER_IMPORT) {
    issues?.push({ level: "error", path: "patches", message: `World contains more than ${MAX_PATCHES_PER_IMPORT.toLocaleString()} patches.`, repaired: false });
  }
  for (let index = 0; index < Math.min(entries.length, MAX_PATCHES_PER_IMPORT); index += 1) {
    const [key, block] = entries[index];
    const coordinates = parseCoordinateKey(key);
    if (!coordinates || !validPatchCoordinates(coordinates) || typeof block !== "number" || !isBlockId(block)) {
      issues?.push({ level: "warning", path: `patches.${key}`, message: "Invalid voxel patch was ignored.", repaired: true });
      continue;
    }
    patches[key] = block;
  }
  return patches;
}

function normalizeWorldSave(raw: unknown, issues: DataIssue[] = []): WorldSave | null {
  if (!isRecord(raw)) return null;
  const schemaVersion = integer(raw.schemaVersion, 1, 1, Number.MAX_SAFE_INTEGER);
  if (schemaVersion > WORLD_DATA_SCHEMA_VERSION) {
    issues.push({ level: "error", path: "schemaVersion", message: "This world was created by a newer, unsupported version.", repaired: false });
  } else if (raw.schemaVersion !== WORLD_DATA_SCHEMA_VERSION) {
    issues.push({ level: "warning", path: "schemaVersion", message: "Legacy world data will be migrated on save.", repaired: true });
  }
  const config = normalizeWorldConfig(raw.config, issues);
  if (!config) return null;
  const spawn: Vector3Tuple = [0.5, 24, 0.5];
  return {
    schemaVersion: WORLD_DATA_SCHEMA_VERSION,
    config,
    player: normalizeRuntimePlayer(raw.player, config.mode, spawn, issues),
    patches: normalizePatchRecord(raw.patches, issues),
    timeOfDay: boundedNumber(raw.timeOfDay, 0.28, 0, 24_000),
    weather: raw.weather === "rain" ? "rain" : "clear",
  };
}

function runtimePatchesToArray(worldId: string, patches: Record<string, number>): VoxelPatch[] {
  const now = Date.now();
  return Object.entries(patches).flatMap(([key, blockId]) => {
    const coordinates = parseCoordinateKey(key);
    return coordinates ? [{ worldId, x: coordinates[0], y: coordinates[1], z: coordinates[2], blockId, updatedAt: now }] : [];
  });
}

function patchesToRecord(patches: VoxelPatch[]): Record<string, number> {
  const record: Record<string, number> = {};
  for (const patch of patches) record[`${patch.x},${patch.y},${patch.z}`] = patch.blockId;
  return record;
}

function normalizePatch(raw: unknown, worldId: string, issues?: DataIssue[], path = "patches"): VoxelPatch | null {
  if (!isRecord(raw)) {
    issues?.push({ level: "warning", path, message: "Invalid voxel patch was ignored.", repaired: true });
    return null;
  }
  const rawCoordinates = [raw.x, raw.y, raw.z];
  if (rawCoordinates.some((coordinate) => typeof coordinate !== "number") || !validPatchCoordinates(rawCoordinates as number[])) {
    issues?.push({ level: "warning", path, message: "Voxel patch has invalid coordinates and was ignored.", repaired: true });
    return null;
  }
  if (typeof raw.blockId !== "number" || !isBlockId(raw.blockId)) {
    issues?.push({ level: "warning", path, message: "Voxel patch has an invalid block id and was ignored.", repaired: true });
    return null;
  }
  return {
    worldId,
    x: raw.x as number,
    y: raw.y as number,
    z: raw.z as number,
    blockId: raw.blockId,
    updatedAt: timestamp(raw.updatedAt, Date.now()),
  };
}

function storedMeta(meta: WorldMeta): StoredWorld {
  return { ...meta, schemaVersion: WORLD_DATA_SCHEMA_VERSION };
}

function storedPlayer(player: PlayerState): StoredPlayer {
  return { ...player, schemaVersion: WORLD_DATA_SCHEMA_VERSION };
}

function storedSettings(settings: WorldSettings): StoredSettings {
  return { ...settings, schemaVersion: WORLD_DATA_SCHEMA_VERSION };
}

function storedPatch(patch: VoxelPatch): StoredPatch {
  return {
    ...patch,
    key: patchKey(patch.worldId, patch.x, patch.y, patch.z),
    chunk: [patch.worldId, chunkCoordinate(patch.x), chunkCoordinate(patch.z)],
    schemaVersion: WORLD_DATA_SCHEMA_VERSION,
  };
}

function wrapError(message: string, error: unknown): PersistenceError {
  return error instanceof PersistenceError ? error : new PersistenceError(message, error);
}

export function isPersistenceAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

async function getDatabase(): Promise<IDBPDatabase<WorldDatabase>> {
  if (!isPersistenceAvailable()) {
    throw new PersistenceError("IndexedDB is unavailable. World progress cannot be stored in this browser context.");
  }
  if (!databasePromise) {
    databasePromise = openDB<WorldDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        if (oldVersion < 1) {
          const worlds = database.createObjectStore("worlds", { keyPath: "id" });
          worlds.createIndex("by-updated-at", "updatedAt");
          worlds.createIndex("by-name", "name");
          database.createObjectStore("players", { keyPath: "worldId" });
          database.createObjectStore("settings", { keyPath: "worldId" });
          const patches = database.createObjectStore("patches", { keyPath: "key" });
          patches.createIndex("by-world", "worldId");
        }
        if (oldVersion < 2) {
          const patches = transaction.objectStore("patches");
          if (!patches.indexNames.contains("by-world-chunk")) {
            patches.createIndex("by-world-chunk", "chunk");
          }
        }
        if (oldVersion < 3 && !database.objectStoreNames.contains("globalSettings")) {
          database.createObjectStore("globalSettings", { keyPath: "key" });
        }
      },
      blocking() {
        void databasePromise?.then((database) => database.close());
        databasePromise = undefined;
      },
      terminated() {
        databasePromise = undefined;
      },
    });
  }
  try {
    return await databasePromise;
  } catch (error) {
    databasePromise = undefined;
    throw wrapError("Unable to open the world database.", error);
  }
}

export async function createWorld(options: CreateWorldOptions): Promise<WorldSnapshot> {
  const id = cleanId(options.id) ?? randomId();
  const meta = defaultMeta(id, options.name, options.seed, options.spawn);
  const player = normalizePlayer({ ...options.player, position: options.player?.position ?? meta.spawn }, id, meta.spawn);
  const settings = normalizeSettings(options.settings, id);
  const snapshot: WorldSnapshot = {
    schemaVersion: WORLD_DATA_SCHEMA_VERSION,
    meta,
    player,
    settings,
    patches: [],
  };
  try {
    const database = await getDatabase();
    if (await database.get("worlds", id)) {
      throw new PersistenceError(`A world with id "${id}" already exists.`);
    }
    await saveWorldSnapshot(snapshot);
    return snapshot;
  } catch (error) {
    throw wrapError("Unable to create the world.", error);
  }
}

export async function listWorldMetadata(): Promise<WorldMeta[]> {
  try {
    const database = await getDatabase();
    const records = await database.getAllFromIndex("worlds", "by-updated-at");
    return records
      .map((record) => normalizeMeta(record, cleanId(record.id) ?? undefined))
      .filter((meta): meta is WorldMeta => meta !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch (error) {
    throw wrapError("Unable to list saved worlds.", error);
  }
}

export async function loadWorldSnapshot(worldId: string): Promise<WorldSnapshot | null> {
  const id = cleanId(worldId);
  if (!id) return null;
  try {
    const database = await getDatabase();
    const transaction = database.transaction(["worlds", "players", "settings", "patches"], "readonly");
    const [metaRecord, playerRecord, settingsRecord, patchRecords] = await Promise.all([
      transaction.objectStore("worlds").get(id),
      transaction.objectStore("players").get(id),
      transaction.objectStore("settings").get(id),
      transaction.objectStore("patches").index("by-world").getAll(id),
    ]);
    await transaction.done;
    const meta = normalizeMeta(metaRecord, id);
    if (!meta) return null;
    const patches = patchRecords
      .map((record) => normalizePatch(record, id))
      .filter((patch): patch is VoxelPatch => patch !== null);
    return {
      schemaVersion: WORLD_DATA_SCHEMA_VERSION,
      meta,
      player: normalizePlayer(playerRecord, id, meta.spawn),
      settings: normalizeSettings(settingsRecord, id),
      patches,
    };
  } catch (error) {
    throw wrapError(`Unable to load world "${id}".`, error);
  }
}

async function deleteWorldPatches<TxStores extends ArrayLike<StoreNames<WorldDatabase>>>(
  patchStore: IDBPObjectStore<WorldDatabase, TxStores, "patches", "readwrite">,
  worldId: string,
): Promise<void> {
  let cursor = await patchStore.index("by-world").openCursor(worldId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
}

export async function saveWorldSnapshot(snapshot: WorldSnapshot): Promise<WorldSnapshot> {
  const result = validateWorldData(snapshot);
  if (!result.snapshot || !result.valid) {
    throw new MalformedWorldDataError("World data contains unrecoverable errors.", result.issues);
  }
  const clean = result.snapshot;
  try {
    const database = await getDatabase();
    const transaction = database.transaction(["worlds", "players", "settings", "patches"], "readwrite", { durability: "strict" });
    await deleteWorldPatches(transaction.objectStore("patches"), clean.meta.id);
    await Promise.all([
      transaction.objectStore("worlds").put(storedMeta(clean.meta)),
      transaction.objectStore("players").put(storedPlayer(clean.player)),
      transaction.objectStore("settings").put(storedSettings(clean.settings)),
      ...clean.patches.map((patch) => transaction.objectStore("patches").put(storedPatch(patch))),
    ]);
    await transaction.done;
    return clean;
  } catch (error) {
    throw wrapError("Unable to save world data.", error);
  }
}

function isRuntimeWorldSave(value: WorldSave | WorldSnapshot): value is WorldSave {
  return "config" in value;
}

async function saveRuntimeWorld(input: WorldSave): Promise<WorldSave> {
  const issues: DataIssue[] = [];
  let clean = normalizeWorldSave(input, issues);
  if (!clean || issues.some((issue) => issue.level === "error")) {
    throw new MalformedWorldDataError("World data contains unrecoverable errors.", issues);
  }
  clean = { ...clean, config: { ...clean.config, updatedAt: Date.now() } };
  const id = clean.config.id;
  const metaBase = defaultMeta(id, clean.config.name, seedToNumber(clean.config.seed), [0.5, 24, 0.5]);
  const meta: WorldMeta = {
    ...metaBase,
    createdAt: clean.config.createdAt,
    updatedAt: clean.config.updatedAt,
    lastPlayedAt: clean.config.updatedAt,
    generatorVersion: clean.config.generatorVersion,
  };
  const player = normalizePlayer({
    position: [clean.player.x, clean.player.y, clean.player.z],
    rotation: [clean.player.yaw, clean.player.pitch],
    health: clean.player.health,
    hunger: clean.player.hunger,
    selectedSlot: clean.player.selectedSlot,
    inventory: [...clean.player.hotbar, ...clean.player.backpack]
      .filter((slot) => slot.count > 0 && slot.block !== BlockId.Air)
      .map((slot) => ({ blockId: slot.block, count: slot.count })),
    gameMode: clean.player.mode,
  }, id, meta.spawn);
  const patches = runtimePatchesToArray(id, clean.patches);
  try {
    const database = await getDatabase();
    const transaction = database.transaction(["worlds", "players", "settings", "patches"], "readwrite", { durability: "strict" });
    const settingsStore = transaction.objectStore("settings");
    const settings = normalizeSettings(await settingsStore.get(id), id);
    await deleteWorldPatches(transaction.objectStore("patches"), id);
    await Promise.all([
      transaction.objectStore("worlds").put({
        ...storedMeta(meta),
        runtimeConfig: clean.config,
        timeOfDay: clean.timeOfDay,
        weather: clean.weather,
      }),
      transaction.objectStore("players").put({ ...storedPlayer(player), runtimePlayer: clean.player }),
      settingsStore.put(storedSettings(settings)),
      ...patches.map((patch) => transaction.objectStore("patches").put(storedPatch(patch))),
    ]);
    await transaction.done;
    return clean;
  } catch (error) {
    throw wrapError("Unable to save world data.", error);
  }
}

export function saveWorld(world: WorldSave): Promise<WorldSave>;
export function saveWorld(world: WorldSnapshot): Promise<WorldSnapshot>;
export function saveWorld(world: WorldSave | WorldSnapshot): Promise<WorldSave | WorldSnapshot> {
  return isRuntimeWorldSave(world) ? saveRuntimeWorld(world) : saveWorldSnapshot(world);
}

export async function loadWorld(worldId: string): Promise<WorldSave | null> {
  const id = cleanId(worldId);
  if (!id) return null;
  try {
    const database = await getDatabase();
    const transaction = database.transaction(["worlds", "players", "patches"], "readonly");
    const [metaRecord, playerRecord, patchRecords] = await Promise.all([
      transaction.objectStore("worlds").get(id),
      transaction.objectStore("players").get(id),
      transaction.objectStore("patches").index("by-world").getAll(id),
    ]);
    await transaction.done;
    const meta = normalizeMeta(metaRecord, id);
    if (!meta) return null;
    const config = normalizeWorldConfig(metaRecord?.runtimeConfig) ?? {
      id,
      name: meta.name,
      seed: String(meta.seed),
      mode: playerRecord?.runtimePlayer?.mode === "creative" ? "creative" : "survival",
      generatorVersion: meta.generatorVersion,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    };
    const persistedPlayer = normalizePlayer(playerRecord, id, meta.spawn);
    const fallbackPlayer: RuntimePlayerState = {
      x: persistedPlayer.position[0],
      y: persistedPlayer.position[1],
      z: persistedPlayer.position[2],
      yaw: persistedPlayer.rotation[0],
      pitch: persistedPlayer.rotation[1],
      health: persistedPlayer.health,
      hunger: persistedPlayer.hunger,
      oxygen: 20,
      selectedSlot: persistedPlayer.selectedSlot,
      hotbar: persistedPlayer.inventory
        .filter((slot) => isBlockId(slot.blockId))
        .slice(0, 9)
        .map((slot) => ({ block: slot.blockId as BlockId, count: slot.count })),
      backpack: persistedPlayer.inventory
        .filter((slot) => isBlockId(slot.blockId))
        .slice(9, 9 + BACKPACK_SIZE)
        .map((slot) => ({ block: slot.blockId as BlockId, count: slot.count })),
      mode: persistedPlayer.gameMode,
      flying: false,
    };
    const player = normalizeRuntimePlayer(playerRecord?.runtimePlayer ?? fallbackPlayer, config.mode, meta.spawn);
    const patches = patchRecords
      .map((record) => normalizePatch(record, id))
      .filter((patch): patch is VoxelPatch => patch !== null);
    return {
      schemaVersion: WORLD_DATA_SCHEMA_VERSION,
      config: { ...config, mode: player.mode },
      player,
      patches: patchesToRecord(patches),
      timeOfDay: boundedNumber(metaRecord?.timeOfDay, 0.28, 0, 24_000),
      weather: metaRecord?.weather === "rain" ? "rain" : "clear",
    };
  } catch (error) {
    throw wrapError(`Unable to load world "${id}".`, error);
  }
}

export async function listWorlds(): Promise<WorldConfig[]> {
  try {
    const database = await getDatabase();
    const records = await database.getAllFromIndex("worlds", "by-updated-at");
    return records
      .flatMap((record): WorldConfig[] => {
        const config = normalizeWorldConfig(record.runtimeConfig);
        if (config) return [config];
        const meta = normalizeMeta(record, record.id);
        return meta ? [{
          id: meta.id,
          name: meta.name,
          seed: String(meta.seed),
          mode: "survival",
          generatorVersion: meta.generatorVersion,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        }] : [];
      })
      .sort((left, right) => right.updatedAt - left.updatedAt);
  } catch (error) {
    throw wrapError("Unable to list saved worlds.", error);
  }
}

export async function saveWorldMeta(worldId: string, changes: Partial<Omit<WorldMeta, "id">>): Promise<WorldMeta> {
  const id = cleanId(worldId);
  if (!id) throw new PersistenceError("Invalid world id.");
  try {
    const database = await getDatabase();
    const record = await database.get("worlds", id);
    const current = normalizeMeta(record, id);
    if (!current) throw new PersistenceError(`World "${id}" does not exist.`);
    const updated = normalizeMeta({ ...current, ...changes, id, updatedAt: changes.updatedAt ?? Date.now() }, id);
    if (!updated) throw new PersistenceError("World metadata could not be repaired.");
    const runtimeConfig = record?.runtimeConfig ? {
      ...record.runtimeConfig,
      name: updated.name,
      updatedAt: updated.updatedAt,
    } : undefined;
    await database.put("worlds", { ...record, ...storedMeta(updated), runtimeConfig });
    return updated;
  } catch (error) {
    throw wrapError("Unable to save world metadata.", error);
  }
}

export async function savePlayerState(worldId: string, state: Partial<Omit<PlayerState, "worldId">>): Promise<PlayerState> {
  const id = cleanId(worldId);
  if (!id) throw new PersistenceError("Invalid world id.");
  try {
    const database = await getDatabase();
    const metaRecord = await database.get("worlds", id);
    const meta = normalizeMeta(metaRecord, id);
    if (!meta) throw new PersistenceError(`World "${id}" does not exist.`);
    const playerRecord = await database.get("players", id);
    const current = normalizePlayer(playerRecord, id, meta.spawn);
    const player = normalizePlayer({ ...current, ...state, updatedAt: state.updatedAt ?? Date.now() }, id, meta.spawn);
    const transaction = database.transaction(["players", "worlds"], "readwrite");
    await Promise.all([
      transaction.objectStore("players").put({ ...playerRecord, ...storedPlayer(player) }),
      transaction.objectStore("worlds").put({ ...metaRecord, ...storedMeta({ ...meta, updatedAt: Date.now(), lastPlayedAt: Date.now() }) }),
    ]);
    await transaction.done;
    return player;
  } catch (error) {
    throw wrapError("Unable to save player state.", error);
  }
}

export async function saveWorldSettings(worldId: string, changes: Partial<Omit<WorldSettings, "worldId">>): Promise<WorldSettings> {
  const id = cleanId(worldId);
  if (!id) throw new PersistenceError("Invalid world id.");
  try {
    const database = await getDatabase();
    if (!(await database.get("worlds", id))) throw new PersistenceError(`World "${id}" does not exist.`);
    const current = normalizeSettings(await database.get("settings", id), id);
    const settings = normalizeSettings({ ...current, ...changes, updatedAt: changes.updatedAt ?? Date.now() }, id);
    await database.put("settings", storedSettings(settings));
    return settings;
  } catch (error) {
    throw wrapError("Unable to save world settings.", error);
  }
}

export async function loadSettings(): Promise<GameSettings> {
  try {
    const database = await getDatabase();
    const record = await database.get("globalSettings", "global");
    return normalizeGlobalSettings(record?.settings);
  } catch (error) {
    throw wrapError("Unable to load game settings.", error);
  }
}

export async function saveSettings(changes: Partial<GameSettings>): Promise<GameSettings> {
  try {
    const database = await getDatabase();
    const current = normalizeGlobalSettings((await database.get("globalSettings", "global"))?.settings);
    const settings = normalizeGlobalSettings({ ...current, ...changes });
    await database.put("globalSettings", {
      key: "global",
      schemaVersion: WORLD_DATA_SCHEMA_VERSION,
      settings,
    });
    return settings;
  } catch (error) {
    throw wrapError("Unable to save game settings.", error);
  }
}

export async function saveVoxelPatch(worldId: string, patch: VoxelPatchInput): Promise<VoxelPatch> {
  const [saved] = await saveVoxelPatches(worldId, [patch]);
  if (!saved) throw new PersistenceError("Voxel patch was invalid.");
  return saved;
}

export async function saveVoxelPatches(worldId: string, patches: Iterable<VoxelPatchInput>): Promise<VoxelPatch[]> {
  const id = cleanId(worldId);
  if (!id) throw new PersistenceError("Invalid world id.");
  const deduplicated = new Map<string, VoxelPatch>();
  for (const raw of patches) {
    const patch = normalizePatch(raw, id);
    if (patch) deduplicated.set(patchKey(id, patch.x, patch.y, patch.z), patch);
  }
  const clean = [...deduplicated.values()];
  if (clean.length === 0) return [];
  try {
    const database = await getDatabase();
    const transaction = database.transaction(["worlds", "patches"], "readwrite");
    const metaRecord = await transaction.objectStore("worlds").get(id);
    const meta = normalizeMeta(metaRecord, id);
    if (!meta) {
      transaction.abort();
      throw new PersistenceError(`World "${id}" does not exist.`);
    }
    await Promise.all([
      transaction.objectStore("worlds").put({ ...metaRecord, ...storedMeta({ ...meta, updatedAt: Date.now() }) }),
      ...clean.map((patch) => transaction.objectStore("patches").put(storedPatch(patch))),
    ]);
    await transaction.done;
    return clean;
  } catch (error) {
    throw wrapError("Unable to save voxel changes.", error);
  }
}

export async function getVoxelPatch(worldId: string, x: number, y: number, z: number): Promise<VoxelPatch | null> {
  const id = cleanId(worldId);
  if (!id || ![x, y, z].every(Number.isSafeInteger)) return null;
  try {
    const database = await getDatabase();
    return normalizePatch(await database.get("patches", patchKey(id, x, y, z)), id);
  } catch (error) {
    throw wrapError("Unable to load the voxel change.", error);
  }
}

export async function loadVoxelPatches(worldId: string, bounds: PatchBounds = {}): Promise<VoxelPatch[]> {
  const id = cleanId(worldId);
  if (!id) return [];
  try {
    const database = await getDatabase();
    const records = await database.getAllFromIndex("patches", "by-world", id);
    return records
      .map((record) => normalizePatch(record, id))
      .filter((patch): patch is VoxelPatch => patch !== null)
      .filter((patch) =>
        (bounds.minX === undefined || patch.x >= bounds.minX) &&
        (bounds.maxX === undefined || patch.x <= bounds.maxX) &&
        (bounds.minY === undefined || patch.y >= bounds.minY) &&
        (bounds.maxY === undefined || patch.y <= bounds.maxY) &&
        (bounds.minZ === undefined || patch.z >= bounds.minZ) &&
        (bounds.maxZ === undefined || patch.z <= bounds.maxZ));
  } catch (error) {
    throw wrapError("Unable to load voxel changes.", error);
  }
}

export async function loadChunkPatches(worldId: string, chunkX: number, chunkZ: number): Promise<VoxelPatch[]> {
  const id = cleanId(worldId);
  if (!id || !Number.isSafeInteger(chunkX) || !Number.isSafeInteger(chunkZ)) return [];
  try {
    const database = await getDatabase();
    const records = await database.getAllFromIndex("patches", "by-world-chunk", [id, chunkX, chunkZ]);
    return records
      .map((record) => normalizePatch(record, id))
      .filter((patch): patch is VoxelPatch => patch !== null);
  } catch (error) {
    throw wrapError("Unable to load chunk changes.", error);
  }
}

export async function deleteVoxelPatch(worldId: string, x: number, y: number, z: number): Promise<boolean> {
  const id = cleanId(worldId);
  if (!id || ![x, y, z].every(Number.isSafeInteger)) return false;
  try {
    const database = await getDatabase();
    const key = patchKey(id, x, y, z);
    const existed = (await database.getKey("patches", key)) !== undefined;
    if (existed) await database.delete("patches", key);
    return existed;
  } catch (error) {
    throw wrapError("Unable to delete the voxel change.", error);
  }
}

export async function clearVoxelPatches(worldId: string): Promise<void> {
  const id = cleanId(worldId);
  if (!id) return;
  try {
    const database = await getDatabase();
    const transaction = database.transaction("patches", "readwrite");
    await deleteWorldPatches(transaction.objectStore("patches"), id);
    await transaction.done;
  } catch (error) {
    throw wrapError("Unable to clear voxel changes.", error);
  }
}

export async function deleteWorld(worldId: string): Promise<boolean> {
  const id = cleanId(worldId);
  if (!id) return false;
  try {
    const database = await getDatabase();
    const transaction = database.transaction(["worlds", "players", "settings", "patches"], "readwrite", { durability: "strict" });
    const existed = (await transaction.objectStore("worlds").getKey(id)) !== undefined;
    await deleteWorldPatches(transaction.objectStore("patches"), id);
    await Promise.all([
      transaction.objectStore("worlds").delete(id),
      transaction.objectStore("players").delete(id),
      transaction.objectStore("settings").delete(id),
    ]);
    await transaction.done;
    return existed;
  } catch (error) {
    throw wrapError("Unable to delete the world.", error);
  }
}

export function validateWorldData(input: unknown): WorldValidationResult {
  const issues: DataIssue[] = [];
  let source: unknown = input;
  if (typeof source === "string") {
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      return {
        valid: false,
        snapshot: null,
        issues: [{ level: "error", path: "$", message: "The file is not valid JSON.", repaired: false }],
      };
    }
  }
  if (!isRecord(source)) {
    return {
      valid: false,
      snapshot: null,
      issues: [{ level: "error", path: "$", message: "World data must be a JSON object.", repaired: false }],
    };
  }
  const schemaVersion = integer(source.schemaVersion, 1, 1, Number.MAX_SAFE_INTEGER);
  if (schemaVersion > WORLD_DATA_SCHEMA_VERSION) {
    issues.push({ level: "error", path: "schemaVersion", message: "This world was created by a newer, unsupported version.", repaired: false });
  } else if (source.schemaVersion !== WORLD_DATA_SCHEMA_VERSION) {
    issues.push({ level: "warning", path: "schemaVersion", message: "Legacy world data will be migrated on save.", repaired: true });
  }
  const meta = normalizeMeta(source.meta, undefined, issues);
  if (!meta) {
    issues.push({ level: "error", path: "meta", message: "World metadata is missing or has no usable id.", repaired: false });
    return { valid: false, snapshot: null, issues };
  }
  const player = normalizePlayer(source.player, meta.id, meta.spawn, issues);
  const settings = normalizeSettings(source.settings, meta.id);
  const patchInput = Array.isArray(source.patches) ? source.patches : [];
  if (!Array.isArray(source.patches)) {
    issues.push({ level: "warning", path: "patches", message: "Missing voxel patch list was replaced with an empty list.", repaired: true });
  }
  if (patchInput.length > MAX_PATCHES_PER_IMPORT) {
    issues.push({ level: "error", path: "patches", message: `World contains more than ${MAX_PATCHES_PER_IMPORT.toLocaleString()} patches.`, repaired: false });
  }
  const patchesByKey = new Map<string, VoxelPatch>();
  for (let index = 0; index < Math.min(patchInput.length, MAX_PATCHES_PER_IMPORT); index += 1) {
    const patch = normalizePatch(patchInput[index], meta.id, issues, `patches[${index}]`);
    if (!patch) continue;
    const key = patchKey(meta.id, patch.x, patch.y, patch.z);
    if (patchesByKey.has(key)) {
      issues.push({ level: "warning", path: `patches[${index}]`, message: "Duplicate voxel coordinate replaced an earlier patch.", repaired: true });
    }
    patchesByKey.set(key, patch);
  }
  const snapshot: WorldSnapshot = {
    schemaVersion: WORLD_DATA_SCHEMA_VERSION,
    meta,
    player,
    settings,
    patches: [...patchesByKey.values()],
  };
  return {
    valid: !issues.some((issue) => issue.level === "error"),
    snapshot,
    issues,
  };
}

export async function exportWorld(worldId: string, pretty = true): Promise<string> {
  const snapshot = await loadWorld(worldId);
  if (!snapshot) throw new PersistenceError(`World "${worldId}" does not exist.`);
  return JSON.stringify({ ...snapshot, exportedAt: Date.now() }, null, pretty ? 2 : undefined);
}

export async function downloadWorldExport(worldId: string): Promise<void> {
  if (typeof document === "undefined") throw new PersistenceError("Downloads are unavailable outside a browser window.");
  const snapshot = await loadWorld(worldId);
  if (!snapshot) throw new PersistenceError(`World "${worldId}" does not exist.`);
  const contents = JSON.stringify({ ...snapshot, exportedAt: Date.now() }, null, 2);
  const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${snapshot.config.name.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "") || "world"}.voxel-world.json`;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function importWorld(input: string | Blob | unknown, options: ImportWorldOptions = {}): Promise<WorldSave> {
  let source: unknown = input;
  if (typeof Blob !== "undefined" && input instanceof Blob) {
    if (input.size > MAX_IMPORT_BYTES) {
      throw new MalformedWorldDataError("The selected world file is too large.", [
        { level: "error", path: "$", message: "World imports are limited to 25 MB.", repaired: false },
      ]);
    }
    source = await input.text();
  }
  if (typeof source === "string") {
    if (source.length > MAX_IMPORT_BYTES) {
      throw new MalformedWorldDataError("The selected world file is too large.", [
        { level: "error", path: "$", message: "World imports are limited to 25 MB.", repaired: false },
      ]);
    }
    try {
      source = JSON.parse(source) as unknown;
    } catch {
      throw new MalformedWorldDataError("The selected file is not valid JSON.", [
        { level: "error", path: "$", message: "The file is not valid JSON.", repaired: false },
      ]);
    }
  }
  if (isRecord(source) && "config" in source) {
    const issues: DataIssue[] = [];
    let save = normalizeWorldSave(source, issues);
    if (!save || issues.some((issue) => issue.level === "error")) {
      throw new MalformedWorldDataError("The selected file is not a usable world export.", issues);
    }
    const database = await getDatabase();
    const exists = Boolean(await database.getKey("worlds", save.config.id));
    const conflict = options.conflict ?? "copy";
    if (exists && conflict === "error") throw new PersistenceError(`World "${save.config.id}" already exists.`);
    if (exists && conflict === "copy") {
      const id = randomId();
      save = {
        ...save,
        config: {
          ...save.config,
          id,
          name: cleanName(options.name, `${save.config.name} (Imported)`),
          updatedAt: Date.now(),
        },
      };
    } else if (options.name) {
      save = { ...save, config: { ...save.config, name: cleanName(options.name), updatedAt: Date.now() } };
    }
    return saveRuntimeWorld(save);
  }

  const validation = validateWorldData(source);
  if (!validation.snapshot || !validation.valid) {
    throw new MalformedWorldDataError("The selected file is not a usable world export.", validation.issues);
  }
  let snapshot = validation.snapshot;
  const database = await getDatabase();
  const exists = Boolean(await database.getKey("worlds", snapshot.meta.id));
  const conflict = options.conflict ?? "copy";
  if (exists && conflict === "error") {
    throw new PersistenceError(`World "${snapshot.meta.id}" already exists.`);
  }
  if (exists && conflict === "copy") {
    const id = randomId();
    snapshot = {
      ...snapshot,
      meta: { ...snapshot.meta, id, name: cleanName(options.name, `${snapshot.meta.name} (Imported)`), updatedAt: Date.now(), lastPlayedAt: Date.now() },
      player: { ...snapshot.player, worldId: id, updatedAt: Date.now() },
      settings: { ...snapshot.settings, worldId: id, updatedAt: Date.now() },
      patches: snapshot.patches.map((patch) => ({ ...patch, worldId: id })),
    };
  } else if (options.name) {
    snapshot = { ...snapshot, meta: { ...snapshot.meta, name: cleanName(options.name), updatedAt: Date.now() } };
  }
  await saveWorldSnapshot(snapshot);
  const loaded = await loadWorld(snapshot.meta.id);
  if (!loaded) throw new PersistenceError("Imported world could not be reloaded.");
  return loaded;
}

export async function closeWorldDatabase(): Promise<void> {
  if (!databasePromise) return;
  try {
    const database = await databasePromise;
    database.close();
  } finally {
    databasePromise = undefined;
  }
}
