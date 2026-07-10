import { describe, expect, it } from "vitest";
import {
  aabbCollidesWithVoxels,
  createAABB,
  createPlayerAABB,
  createSeededRandom,
  floorDiv,
  floorMod,
  hashCoordinates,
  intersectsAABB,
  moveAABBWithVoxelCollisions,
  randomFloatAt,
  raycastVoxels,
} from "./math";

describe("floor division and modulo", () => {
  it.each([
    [-33, 16, -3, 15],
    [-17, 16, -2, 15],
    [-16, 16, -1, 0],
    [-1, 16, -1, 15],
    [0, 16, 0, 0],
    [15, 16, 0, 15],
    [16, 16, 1, 0],
    [17, 16, 1, 1],
    [5, -3, -2, -1],
  ])(
    "floorDiv(%i, %i) and floorMod reconstruct the coordinate",
    (value, divisor, quotient, remainder) => {
      expect(floorDiv(value, divisor)).toBe(quotient);
      expect(floorMod(value, divisor)).toBe(remainder);
      expect(quotient * divisor + remainder).toBe(value);
    },
  );

  it("handles real negative world positions and rejects zero divisors", () => {
    expect(floorDiv(-0.01, 16)).toBe(-1);
    expect(floorMod(-0.01, 16)).toBeCloseTo(15.99);
    expect(() => floorDiv(3, 0)).toThrow(RangeError);
  });
});

describe("seeded hashing and random streams", () => {
  it("is deterministic for strings, negative coordinates, and random streams", () => {
    expect(hashCoordinates(-120, 7, 44, "same-world")).toBe(
      hashCoordinates(-120, 7, 44, "same-world"),
    );
    expect(randomFloatAt(-120, 7, 44, "same-world")).toBe(
      randomFloatAt(-120, 7, 44, "same-world"),
    );

    const first = createSeededRandom("survival-seed");
    const second = createSeededRandom("survival-seed");
    expect(Array.from({ length: 12 }, () => first())).toEqual(
      Array.from({ length: 12 }, () => second()),
    );
  });

  it("changes when the seed or coordinate changes and stays in range", () => {
    const baseline = hashCoordinates(1, 2, 3, 42);
    expect(hashCoordinates(2, 2, 3, 42)).not.toBe(baseline);
    expect(hashCoordinates(1, 2.875, 3, 42)).not.toBe(baseline);
    expect(hashCoordinates(1, 2, 3, 43)).not.toBe(baseline);

    const random = createSeededRandom(42);
    for (let index = 0; index < 100; index += 1) {
      expect(random()).toBeGreaterThanOrEqual(0);
      expect(random()).toBeLessThan(1);
    }
  });
});

describe("voxel DDA raycast", () => {
  it("hits the first solid voxel and reports distance, face, and previous cell", () => {
    const hit = raycastVoxels(
      { x: 0.2, y: 1.5, z: -1.5 },
      { x: 5, y: 0, z: 0 },
      20,
      (x, y, z) => x === 3 && y === 1 && z === -2,
    );

    expect(hit?.voxel).toEqual({ x: 3, y: 1, z: -2 });
    expect(hit?.previousVoxel).toEqual({ x: 2, y: 1, z: -2 });
    expect(hit?.normal).toEqual({ x: -1, y: 0, z: 0 });
    expect(hit?.distance).toBeCloseTo(2.8);
    expect(hit?.position).toEqual({ x: 3, y: 1.5, z: -1.5 });
  });

  it("traverses negative coordinates correctly", () => {
    const hit = raycastVoxels(
      { x: -0.2, y: 0.5, z: 0.5 },
      { x: -1, y: 0, z: 0 },
      5,
      (x) => x === -3,
    );

    expect(hit?.voxel.x).toBe(-3);
    expect(hit?.normal).toEqual({ x: 1, y: 0, z: 0 });
    expect(hit?.distance).toBeCloseTo(1.8);
  });

  it("returns null for a miss, a too-short ray, or zero direction", () => {
    const wall = (x: number): boolean => x === 4;
    expect(
      raycastVoxels(
        { x: 0.5, y: 0.5, z: 0.5 },
        { x: 1, y: 0, z: 0 },
        2,
        wall,
      ),
    ).toBeNull();
    expect(
      raycastVoxels(
        { x: 0.5, y: 0.5, z: 0.5 },
        { x: 0, y: 0, z: 0 },
        20,
        wall,
      ),
    ).toBeNull();
  });
});

describe("AABBs and swept voxel collision", () => {
  it("uses 0.6 x 1.8 player dimensions and strict overlap semantics", () => {
    const player = createPlayerAABB({ x: 4, y: 2, z: -3 });
    expect(player).toEqual({
      min: { x: 3.7, y: 2, z: -3.3 },
      max: { x: 4.3, y: 3.8, z: -2.7 },
    });

    const touching = createAABB(
      { x: 4.3, y: 2, z: -3.3 },
      { x: 5, y: 3, z: -2.7 },
    );
    expect(intersectsAABB(player, touching)).toBe(false);
    expect(
      intersectsAABB(
        player,
        createAABB(
          { x: 4.29, y: 2, z: -3.3 },
          { x: 5, y: 3, z: -2.7 },
        ),
      ),
    ).toBe(true);
  });

  it("lands on a floor and reports a grounded Y collision", () => {
    const player = createPlayerAABB({ x: 0.5, y: 2, z: 0.5 });
    const result = moveAABBWithVoxelCollisions(
      player,
      { x: 0, y: -3, z: 0 },
      (_x, y) => y === 0,
    );

    expect(result.movement.y).toBeCloseTo(-1);
    expect(result.box.min.y).toBeCloseTo(1);
    expect(result.collided).toEqual({ x: false, y: true, z: false });
    expect(result.collisionNormal).toEqual({ x: 0, y: 1, z: 0 });
    expect(result.onGround).toBe(true);
    expect(aabbCollidesWithVoxels(result.box, (_x, y) => y === 0)).toBe(
      false,
    );
  });

  it("does not tunnel through a wall on a large delta and still slides", () => {
    const player = createPlayerAABB({ x: 0.5, y: 1, z: 0.5 });
    const result = moveAABBWithVoxelCollisions(
      player,
      { x: 8, y: 0, z: 1.25 },
      (x, y, z) => x === 3 && y >= 1 && y <= 2 && z === 0,
    );

    expect(result.movement.x).toBeCloseTo(2.2);
    expect(result.box.max.x).toBeCloseTo(3);
    expect(result.movement.z).toBeCloseTo(1.25);
    expect(result.collided).toEqual({ x: true, y: false, z: false });
  });

  it("resolves walls correctly in negative coordinates", () => {
    const player = createPlayerAABB({ x: -0.5, y: 1, z: -0.5 });
    const result = moveAABBWithVoxelCollisions(
      player,
      { x: -5, y: 0, z: 0 },
      (x, y, z) => x === -3 && y >= 1 && y <= 2 && z === -1,
    );

    expect(result.box.min.x).toBeCloseTo(-2);
    expect(result.movement.x).toBeCloseTo(-1.2);
    expect(result.collisionNormal.x).toBe(1);
  });
});
