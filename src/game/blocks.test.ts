import { describe, expect, it } from "vitest";
import { ALL_BLOCKS, BLOCKS, BlockId, HOTBAR_BLOCKS, getBlock } from "./blocks";
import { ATLAS_COLUMNS, ATLAS_ROWS, getTileUV } from "./textures";

describe("block registry", () => {
  it("defines a contiguous, unique registry", () => {
    expect(ALL_BLOCKS).toHaveLength(BlockId.Cactus + 1);
    expect(new Set(ALL_BLOCKS.map((block) => block.id)).size).toBe(ALL_BLOCKS.length);
    for (let id = BlockId.Air; id <= BlockId.Cactus; id += 1) expect(BLOCKS[id as BlockId].id).toBe(id);
  });

  it("keeps air and water non-solid while construction blocks collide", () => {
    expect(getBlock(BlockId.Air).solid).toBe(false);
    expect(getBlock(BlockId.Water).solid).toBe(false);
    expect(getBlock(BlockId.Water).liquid).toBe(true);
    expect(getBlock(BlockId.Glass).transparent).toBe(true);
    expect(getBlock(BlockId.Stone).solid).toBe(true);
  });

  it("provides nine usable hotbar defaults", () => {
    expect(HOTBAR_BLOCKS).toHaveLength(9);
    expect(HOTBAR_BLOCKS.every((id) => id !== BlockId.Air && getBlock(id).hardness >= 0)).toBe(true);
  });
});

describe("texture atlas UVs", () => {
  it("keeps every registered face inside the atlas", () => {
    const tileLimit = ATLAS_COLUMNS * ATLAS_ROWS;
    for (const block of ALL_BLOCKS) {
      for (const tile of Object.values(block.textures)) {
        expect(tile).toBeGreaterThanOrEqual(0);
        expect(tile).toBeLessThan(tileLimit);
        const uv = getTileUV(tile);
        expect(uv.u0).toBeGreaterThanOrEqual(0);
        expect(uv.v0).toBeGreaterThanOrEqual(0);
        expect(uv.u1).toBeLessThanOrEqual(1);
        expect(uv.v1).toBeLessThanOrEqual(1);
        expect(uv.u1).toBeGreaterThan(uv.u0);
        expect(uv.v1).toBeGreaterThan(uv.v0);
      }
    }
  });
});
