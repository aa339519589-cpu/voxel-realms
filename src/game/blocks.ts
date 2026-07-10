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
}

export type BlockFace = "top" | "side" | "bottom";

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
  /** Relative break resistance. Zero denotes a block that is not mined. */
  readonly hardness: number;
}

function define(
  id: BlockId,
  name: string,
  tiles: TileId | { readonly top: TileId; readonly side: TileId; readonly bottom: TileId },
  flags: Partial<Pick<BlockDefinition, "solid" | "transparent" | "liquid" | "emissive" | "hardness">> = {},
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

export function isBlockId(value: number): value is BlockId {
  return Number.isInteger(value) && value >= BlockId.Air && value <= BlockId.Cactus;
}

/** Invalid or corrupt ids degrade to air instead of breaking chunk generation. */
export function getBlock(id: BlockId | number): BlockDefinition {
  return isBlockId(id) ? BLOCK_DEFINITIONS[id] : BLOCK_DEFINITIONS[BlockId.Air];
}

export function getFaceTile(id: BlockId | number, face: BlockFace): TileId {
  return getBlock(id).textures[face];
}
