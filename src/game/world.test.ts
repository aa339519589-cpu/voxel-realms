import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { BlockId } from "./blocks";
import { VoxelWorld, WORLD_HEIGHT } from "./world";

function makeWorld(version: number): { atlas: THREE.CanvasTexture; world: VoxelWorld } {
  const atlas = new THREE.CanvasTexture({} as HTMLCanvasElement);
  return { atlas, world: new VoxelWorld(new THREE.Scene(), "V2-CONTENT-TEST", atlas, version) };
}

describe("versioned terrain generation", () => {
  it("keeps legacy worlds on the original block palette", () => {
    const { atlas, world } = makeWorld(1);
    for (let x = -32; x <= 32; x += 1) {
      for (let z = -32; z <= 32; z += 1) {
        for (let y = 0; y < WORLD_HEIGHT; y += 1) expect(world.getBlock(x, y, z)).toBeLessThanOrEqual(BlockId.Cactus);
      }
    }
    world.dispose();
    atlas.dispose();
  });

  it("generates a deterministic v2 world with expanded geology and vegetation", () => {
    const first = makeWorld(2);
    const second = makeWorld(2);
    const found = new Set<BlockId>();
    for (let x = -40; x <= 40; x += 1) {
      for (let z = -40; z <= 40; z += 1) {
        const surface = first.world.surfaceHeight(x, z);
        for (let y = 0; y <= Math.min(WORLD_HEIGHT - 1, surface + 7); y += 1) {
          const block = first.world.getBlock(x, y, z);
          found.add(block);
          if ((x + z + y) % 29 === 0) expect(second.world.getBlock(x, y, z)).toBe(block);
        }
      }
    }
    [
      BlockId.BirchLog,
      BlockId.BirchLeaves,
      BlockId.SpruceLog,
      BlockId.SpruceLeaves,
      BlockId.Gravel,
      BlockId.Clay,
      BlockId.Sandstone,
      BlockId.Terracotta,
      BlockId.Ice,
      BlockId.Limestone,
      BlockId.Marble,
      BlockId.GoldOre,
      BlockId.CrystalOre,
    ].forEach((block) => expect(found.has(block), `${BlockId[block]} should be generated`).toBe(true));
    first.world.dispose();
    first.atlas.dispose();
    second.world.dispose();
    second.atlas.dispose();
  });
});
