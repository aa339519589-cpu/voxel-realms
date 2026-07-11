import "fake-indexeddb/auto";
import { afterAll, describe, expect, it } from "vitest";
import { BlockId } from "./blocks";
import {
  WORLD_DATA_SCHEMA_VERSION,
  closeWorldDatabase,
  deleteWorld,
  exportWorld,
  importWorld,
  listWorlds,
  loadSettings,
  loadWorld,
  loadWorldSnapshot,
  saveSettings,
  saveWorld,
  saveWorldSettings,
  type WorldSave,
} from "./persistence";
import { DEFAULT_SETTINGS } from "./types";

const worldId = `test-world-${Date.now()}`;
const settingsWorldId = `${worldId}-settings`;

const fixture: WorldSave = {
  schemaVersion: WORLD_DATA_SCHEMA_VERSION,
  config: {
    id: worldId,
    name: "Persistence Test",
    seed: "TEST-SEED-42",
    mode: "survival",
    generatorVersion: 2,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_100,
  },
  player: {
    x: -12.5,
    y: 19.01,
    z: 33.5,
    yaw: 1.2,
    pitch: -0.2,
    health: 17,
    hunger: 13,
    oxygen: 20,
    selectedSlot: 2,
    hotbar: [{ block: BlockId.Grass, count: 7 }],
    backpack: Array.from({ length: 27 }, (_, index) => index === 0
      ? { block: BlockId.GoldOre, count: 5 }
      : { block: BlockId.Air, count: 0 }),
    mode: "survival",
    flying: false,
  },
  patches: {
    "-17,8,31": BlockId.Air,
    "-16,9,32": BlockId.Brick,
  },
  timeOfDay: 0.72,
  weather: "rain",
};

afterAll(async () => {
  await deleteWorld(settingsWorldId);
  await deleteWorld(worldId);
  await closeWorldDatabase();
});

describe("world persistence", () => {
  it("round-trips runtime world state and negative voxel patches", async () => {
    await saveWorld(fixture);
    const loaded = await loadWorld(worldId);
    expect(loaded?.config.seed).toBe(fixture.config.seed);
    expect(loaded?.player.x).toBe(-12.5);
    expect(loaded?.patches["-17,8,31"]).toBe(BlockId.Air);
    expect(loaded?.patches["-16,9,32"]).toBe(BlockId.Brick);
    expect(loaded?.weather).toBe("rain");
    expect(loaded?.player.hotbar).toHaveLength(9);
    expect(loaded?.player.backpack).toHaveLength(27);
    expect(loaded?.player.backpack[0]).toEqual({ block: BlockId.GoldOre, count: 5 });
    expect(loaded?.config.generatorVersion).toBe(2);
  });

  it("preserves existing world settings during runtime saves", async () => {
    const settingsFixture = {
      ...fixture,
      config: { ...fixture.config, id: settingsWorldId },
    };
    await saveWorld(settingsFixture);
    const expectedSettings = await saveWorldSettings(settingsWorldId, {
      renderDistance: 11,
      fieldOfView: 96,
      mouseSensitivity: 1.37,
      masterVolume: 0.21,
      effectsVolume: 0.32,
      ambientVolume: 0.43,
      showFps: true,
      invertY: true,
      reducedMotion: true,
      updatedAt: 1_700_000_000_200,
    });

    await saveWorld({
      ...settingsFixture,
      player: { ...settingsFixture.player, x: 4.5 },
      timeOfDay: 0.18,
      weather: "clear",
    });

    const snapshot = await loadWorldSnapshot(settingsWorldId);
    expect(snapshot?.settings).toEqual(expectedSettings);
  });

  it("preserves creative infinite stacks and repairs missing slots", async () => {
    const creativeId = `${worldId}-creative`;
    await saveWorld({
      ...fixture,
      config: { ...fixture.config, id: creativeId, mode: "creative" },
      player: {
        ...fixture.player,
        mode: "creative",
        flying: true,
        hotbar: [{ block: BlockId.Glow, count: -1 }],
        survivalHotbar: [{ block: BlockId.CopperOre, count: 27 }],
      },
    });
    const loaded = await loadWorld(creativeId);
    expect(loaded?.player.hotbar).toHaveLength(9);
    expect(loaded?.player.hotbar.every((slot) => slot.count === -1)).toBe(true);
    expect(loaded?.player.hotbar[0].block).toBe(BlockId.Glow);
    expect(loaded?.player.survivalHotbar).toHaveLength(9);
    expect(loaded?.player.survivalHotbar?.[0]).toEqual({ block: BlockId.CopperOre, count: 27 });
    await deleteWorld(creativeId);
  });

  it("lists, exports, and imports a conflicting world as a copy", async () => {
    const listed = await listWorlds();
    expect(listed.some((world) => world.id === worldId)).toBe(true);
    const exported = await exportWorld(worldId, true);
    const copy = await importWorld(exported, { conflict: "copy" });
    expect(copy.config.id).not.toBe(worldId);
    expect(copy.config.seed).toBe(fixture.config.seed);
    expect(copy.patches["-16,9,32"]).toBe(BlockId.Brick);
    await deleteWorld(copy.config.id);
  });

  it("rejects malformed imports without damaging existing worlds", async () => {
    await expect(importWorld("{not-json")).rejects.toThrow();
    expect((await loadWorld(worldId))?.config.name).toBe("Persistence Test");
  });

  it("repairs unsafe coordinates and ignores unknown block ids", async () => {
    const dirtyId = `${worldId}-dirty`;
    await saveWorld({
      ...fixture,
      config: { ...fixture.config, id: dirtyId },
      player: { ...fixture.player, x: Number.POSITIVE_INFINITY, y: 1e20, z: -1e20, hotbar: [] },
      patches: { "1,8,1": 999, "2,8,2": BlockId.Brick },
    });
    const loaded = await loadWorld(dirtyId);
    expect(loaded?.player.x).toBe(0.5);
    expect(loaded?.player.y).toBe(512);
    expect(loaded?.player.z).toBe(-1_000_000);
    expect(loaded?.patches["1,8,1"]).toBeUndefined();
    expect(loaded?.patches["2,8,2"]).toBe(BlockId.Brick);
    expect(loaded?.player.hotbar).toHaveLength(9);
    await deleteWorld(dirtyId);
  });
});

describe("global settings", () => {
  it("normalizes and restores saved settings", async () => {
    await saveSettings({ ...DEFAULT_SETTINGS, fov: 88, masterVolume: 0.31, renderDistance: 5 });
    const settings = await loadSettings();
    expect(settings.fov).toBe(88);
    expect(settings.masterVolume).toBeCloseTo(0.31);
    expect(settings.renderDistance).toBe(5);
  });
});
