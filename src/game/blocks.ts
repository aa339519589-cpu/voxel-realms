import { TileId } from "./textures";

export { getTileUV } from "./textures";

export enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Water = 5,
  OakLog = 6,
  OakLeaves = 7,
  CoalOre = 8,
  IronOre = 9,
  CopperOre = 10,
  OakPlanks = 11,
  Brick = 12,
  Glass = 13,
  Snow = 14,
  Glow = 15,
  Cobblestone = 16,
  Clay = 17,
  Basalt = 18,
  Cactus = 19,
  Gravel = 20,
  Limestone = 21,
  Marble = 22,
  GoldOre = 23,
  BirchLog = 24,
  BirchLeaves = 25,
  BirchPlanks = 26,
  StoneBricks = 27,
  MossyCobblestone = 28,
  PolishedBasalt = 29,
  CutCopper = 30,
  Terracotta = 31,
  Bookshelf = 32,
  AmberLamp = 33,
  Ice = 34,
  TintedGlass = 35,
  Sandstone = 36,
  CoalBlock = 37,
  IronBlock = 38,
  CopperBlock = 39,
  GoldBlock = 40,
  CrystalOre = 41,
  CrystalBlock = 42,
  SpruceLog = 43,
  SpruceLeaves = 44,
  SprucePlanks = 45,
}

export type BlockFace = "top" | "side" | "bottom";
export type BlockRenderLayer = "opaque" | "cutout" | "translucent";

export interface BlockDefinition {
  readonly id: BlockId;
  readonly name: string;
  readonly textures: Readonly<{
    top: TileId;
    side: TileId;
    bottom: TileId;
  }>;
  /** Participates in collision and can support the player. */
  readonly solid: boolean;
  /** Requires alpha-aware rendering or permits seeing neighboring geometry. */
  readonly transparent: boolean;
  readonly liquid: boolean;
  readonly emissive: boolean;
  readonly renderLayer: BlockRenderLayer;
  /** Relative break resistance. Zero denotes a block that is not mined. */
  readonly hardness: number;
}

function define(
  id: BlockId,
  name: string,
  tiles: TileId | { readonly top: TileId; readonly side: TileId; readonly bottom: TileId },
  flags: Partial<Pick<BlockDefinition, "solid" | "transparent" | "liquid" | "emissive" | "hardness" | "renderLayer">> = {},
): BlockDefinition {
  const textures = Object.freeze(typeof tiles === "number"
    ? { top: tiles, side: tiles, bottom: tiles }
    : { ...tiles });

  return Object.freeze({
    id,
    name,
    textures,
    solid: flags.solid ?? true,
    transparent: flags.transparent ?? false,
    liquid: flags.liquid ?? false,
    emissive: flags.emissive ?? false,
    renderLayer: flags.renderLayer ?? (flags.transparent ? "translucent" : "opaque"),
    hardness: flags.hardness ?? 1,
  });
}

export const BLOCK_DEFINITIONS: Readonly<Record<BlockId, BlockDefinition>> = Object.freeze({
  [BlockId.Air]: define(BlockId.Air, "Air", TileId.Glass, {
    solid: false,
    transparent: true,
    hardness: 0,
  }),
  [BlockId.Grass]: define(BlockId.Grass, "Grass", {
    top: TileId.GrassTop,
    side: TileId.GrassSide,
    bottom: TileId.Dirt,
  }, { hardness: 0.6 }),
  [BlockId.Dirt]: define(BlockId.Dirt, "Dirt", TileId.Dirt, { hardness: 0.5 }),
  [BlockId.Stone]: define(BlockId.Stone, "Stone", TileId.Stone, { hardness: 1.5 }),
  [BlockId.Sand]: define(BlockId.Sand, "Sand", TileId.Sand, { hardness: 0.5 }),
  [BlockId.Water]: define(BlockId.Water, "Water", TileId.Water, {
    solid: false,
    transparent: true,
    liquid: true,
    hardness: 0,
  }),
  [BlockId.OakLog]: define(BlockId.OakLog, "Oak Log", {
    top: TileId.LogTop,
    side: TileId.LogSide,
    bottom: TileId.LogTop,
  }, { hardness: 2 }),
  [BlockId.OakLeaves]: define(BlockId.OakLeaves, "Oak Leaves", TileId.Leaves, {
    transparent: true,
    renderLayer: "cutout",
    hardness: 0.2,
  }),
  [BlockId.CoalOre]: define(BlockId.CoalOre, "Coal Ore", TileId.CoalOre, { hardness: 3 }),
  [BlockId.IronOre]: define(BlockId.IronOre, "Iron Ore", TileId.IronOre, { hardness: 3 }),
  [BlockId.CopperOre]: define(BlockId.CopperOre, "Copper Ore", TileId.CopperOre, { hardness: 3 }),
  [BlockId.OakPlanks]: define(BlockId.OakPlanks, "Oak Planks", TileId.Planks, { hardness: 2 }),
  [BlockId.Brick]: define(BlockId.Brick, "Brick", TileId.Brick, { hardness: 2 }),
  [BlockId.Glass]: define(BlockId.Glass, "Glass", TileId.Glass, {
    transparent: true,
    hardness: 0.3,
  }),
  [BlockId.Snow]: define(BlockId.Snow, "Snow", {
    top: TileId.SnowTop,
    side: TileId.SnowSide,
    bottom: TileId.SnowSide,
  }, { hardness: 0.2 }),
  [BlockId.Glow]: define(BlockId.Glow, "Lumen Block", TileId.Glow, {
    emissive: true,
    hardness: 1,
  }),
  [BlockId.Cobblestone]: define(BlockId.Cobblestone, "Cobblestone", TileId.Cobblestone, { hardness: 2 }),
  [BlockId.Clay]: define(BlockId.Clay, "Clay", TileId.Clay, { hardness: 0.6 }),
  [BlockId.Basalt]: define(BlockId.Basalt, "Basalt", TileId.Basalt, { hardness: 3 }),
  [BlockId.Cactus]: define(BlockId.Cactus, "Cactus", {
    top: TileId.CactusTop,
    side: TileId.CactusSide,
    bottom: TileId.CactusTop,
  }, { hardness: 0.4 }),
  [BlockId.Gravel]: define(BlockId.Gravel, "Gravel", TileId.Gravel, { hardness: 0.6 }),
  [BlockId.Limestone]: define(BlockId.Limestone, "Limestone", TileId.Limestone, { hardness: 1.4 }),
  [BlockId.Marble]: define(BlockId.Marble, "Marble", TileId.Marble, { hardness: 1.8 }),
  [BlockId.GoldOre]: define(BlockId.GoldOre, "Gold Ore", TileId.GoldOre, { hardness: 3.2 }),
  [BlockId.BirchLog]: define(BlockId.BirchLog, "Birch Log", {
    top: TileId.BirchLogTop,
    side: TileId.BirchLogSide,
    bottom: TileId.BirchLogTop,
  }, { hardness: 2 }),
  [BlockId.BirchLeaves]: define(BlockId.BirchLeaves, "Birch Leaves", TileId.BirchLeaves, {
    transparent: true,
    renderLayer: "cutout",
    hardness: 0.2,
  }),
  [BlockId.BirchPlanks]: define(BlockId.BirchPlanks, "Birch Planks", TileId.BirchPlanks, { hardness: 2 }),
  [BlockId.StoneBricks]: define(BlockId.StoneBricks, "Stone Bricks", TileId.StoneBricks, { hardness: 2.2 }),
  [BlockId.MossyCobblestone]: define(BlockId.MossyCobblestone, "Mossy Cobblestone", TileId.MossyCobblestone, { hardness: 2 }),
  [BlockId.PolishedBasalt]: define(BlockId.PolishedBasalt, "Polished Basalt", TileId.PolishedBasalt, { hardness: 3.2 }),
  [BlockId.CutCopper]: define(BlockId.CutCopper, "Cut Copper", TileId.CutCopper, { hardness: 2.5 }),
  [BlockId.Terracotta]: define(BlockId.Terracotta, "Terracotta", TileId.Terracotta, { hardness: 1.25 }),
  [BlockId.Bookshelf]: define(BlockId.Bookshelf, "Bookshelf", {
    top: TileId.Planks,
    side: TileId.Bookshelf,
    bottom: TileId.Planks,
  }, { hardness: 1.5 }),
  [BlockId.AmberLamp]: define(BlockId.AmberLamp, "Amber Lamp", TileId.AmberLamp, {
    emissive: true,
    hardness: 1,
  }),
  [BlockId.Ice]: define(BlockId.Ice, "Ice", TileId.Ice, {
    transparent: true,
    renderLayer: "translucent",
    hardness: 0.45,
  }),
  [BlockId.TintedGlass]: define(BlockId.TintedGlass, "Tinted Glass", TileId.TintedGlass, {
    transparent: true,
    renderLayer: "translucent",
    hardness: 0.3,
  }),
  [BlockId.Sandstone]: define(BlockId.Sandstone, "Sandstone", {
    top: TileId.SandstoneTop,
    side: TileId.SandstoneSide,
    bottom: TileId.SandstoneTop,
  }, { hardness: 0.9 }),
  [BlockId.CoalBlock]: define(BlockId.CoalBlock, "Coal Block", TileId.CoalBlock, { hardness: 3 }),
  [BlockId.IronBlock]: define(BlockId.IronBlock, "Iron Block", TileId.IronBlock, { hardness: 3.5 }),
  [BlockId.CopperBlock]: define(BlockId.CopperBlock, "Copper Block", TileId.CopperBlock, { hardness: 3 }),
  [BlockId.GoldBlock]: define(BlockId.GoldBlock, "Gold Block", TileId.GoldBlock, { hardness: 3 }),
  [BlockId.CrystalOre]: define(BlockId.CrystalOre, "Aether Crystal Ore", TileId.CrystalOre, { hardness: 3.5 }),
  [BlockId.CrystalBlock]: define(BlockId.CrystalBlock, "Aether Crystal Block", TileId.CrystalBlock, {
    emissive: true,
    hardness: 2.5,
  }),
  [BlockId.SpruceLog]: define(BlockId.SpruceLog, "Spruce Log", {
    top: TileId.SpruceLogTop,
    side: TileId.SpruceLogSide,
    bottom: TileId.SpruceLogTop,
  }, { hardness: 2 }),
  [BlockId.SpruceLeaves]: define(BlockId.SpruceLeaves, "Spruce Leaves", TileId.SpruceLeaves, {
    transparent: true,
    renderLayer: "cutout",
    hardness: 0.2,
  }),
  [BlockId.SprucePlanks]: define(BlockId.SprucePlanks, "Spruce Planks", TileId.SprucePlanks, { hardness: 2 }),
});

/** Short alias suited to hot meshing loops: `BLOCKS[id]`. */
export const BLOCKS = BLOCK_DEFINITIONS;

export const ALL_BLOCKS: readonly BlockDefinition[] = Object.freeze(
  Object.values(BLOCK_DEFINITIONS),
);

export const HOTBAR_BLOCKS: readonly BlockId[] = Object.freeze([
  BlockId.Grass,
  BlockId.Dirt,
  BlockId.Stone,
  BlockId.OakLog,
  BlockId.OakPlanks,
  BlockId.Brick,
  BlockId.Glass,
  BlockId.Glow,
  BlockId.Water,
]);

export const MAX_BLOCK_ID = BlockId.SprucePlanks;

export function isBlockId(value: number): value is BlockId {
  return Number.isInteger(value) && value >= BlockId.Air && value <= MAX_BLOCK_ID;
}

/** Invalid or corrupt ids degrade to air instead of breaking chunk generation. */
export function getBlock(id: BlockId | number): BlockDefinition {
  return isBlockId(id) ? BLOCK_DEFINITIONS[id] : BLOCK_DEFINITIONS[BlockId.Air];
}

export function getFaceTile(id: BlockId | number, face: BlockFace): TileId {
  return getBlock(id).textures[face];
}
