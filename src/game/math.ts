/** Small, dependency-free geometry helpers shared by terrain and player code. */

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

export interface VoxelCoord {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type Axis = "x" | "y" | "z";
export type Seed = number | string;
export type VoxelQuery = (x: number, y: number, z: number) => boolean;

export interface AABB {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface AxisCollisions {
  readonly x: boolean;
  readonly y: boolean;
  readonly z: boolean;
}

export interface VoxelCollisionResult {
  readonly box: AABB;
  readonly attempted: Vec3;
  readonly movement: Vec3;
  readonly remaining: Vec3;
  readonly collided: AxisCollisions;
  readonly collisionNormal: Vec3;
  readonly onGround: boolean;
}

export interface VoxelRaycastHit {
  /** Convenience coordinates mirroring `voxel`. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly voxel: VoxelCoord;
  readonly previousVoxel: VoxelCoord | null;
  readonly position: Vec3;
  /** The outward normal of the face crossed to enter this voxel. */
  readonly normal: VoxelCoord;
  /** World-space distance from the ray origin. */
  readonly distance: number;
}

export interface SeededRandom {
  /** Returns a floating point value in [0, 1). */
  (): number;
  /** Returns the next unsigned 32-bit value. */
  uint32(): number;
  /** Returns a floating point value in [min, max). */
  range(min: number, max: number): number;
  /** Returns an integer in [min, maxExclusive). */
  int(min: number, maxExclusive: number): number;
  /** Exposes the current state for deterministic save/restore systems. */
  getState(): number;
}

export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_DEPTH = 0.6;

const UINT32_RANGE = 0x1_0000_0000;
const COLLISION_EPSILON = 1e-9;
const DDA_EPSILON = 1e-10;
const DEFAULT_AXIS_ORDER: readonly Axis[] = ["x", "y", "z"];
const NUMBER_HASH_BUFFER = new ArrayBuffer(8);
const NUMBER_HASH_VIEW = new DataView(NUMBER_HASH_BUFFER);

function assertFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${name} must be a finite number`);
  }
}

function assertVector(vector: Vec3, name: string): void {
  assertFinite(vector.x, `${name}.x`);
  assertFinite(vector.y, `${name}.y`);
  assertFinite(vector.z, `${name}.z`);
}

function withoutNegativeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

/**
 * Mathematical floor division. Unlike JavaScript truncation, negative values
 * stay in the correct chunk: floorDiv(-1, 16) === -1.
 */
export function floorDiv(dividend: number, divisor: number): number {
  assertFinite(dividend, "dividend");
  assertFinite(divisor, "divisor");
  if (divisor === 0) {
    throw new RangeError("divisor must not be zero");
  }
  return withoutNegativeZero(Math.floor(dividend / divisor));
}

/**
 * Remainder paired with floorDiv. The invariant
 * `dividend === floorDiv(dividend, divisor) * divisor + floorMod(...)` holds.
 * Its sign follows the divisor, matching mathematical floor-mod semantics.
 */
export function floorMod(dividend: number, divisor: number): number {
  const quotient = floorDiv(dividend, divisor);
  return withoutNegativeZero(dividend - quotient * divisor);
}

/** A high-quality 32-bit avalanche suitable for procedural world hashing. */
export function hash32(value: number): number {
  assertFinite(value, "value");
  let hash = Math.trunc(value) >>> 0;
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Stable UTF-16 string hash, finalized through hash32. */
export function hashString(value: string, seed = 0x811c9dc5): number {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash32(hash);
}

export function seedToUint32(seed: Seed): number {
  return typeof seed === "string" ? hashString(seed) : hash32(seed);
}

function hashNumber(value: number): number {
  assertFinite(value, "coordinate");
  NUMBER_HASH_VIEW.setFloat64(0, withoutNegativeZero(value), true);
  const low = NUMBER_HASH_VIEW.getUint32(0, true);
  const high = NUMBER_HASH_VIEW.getUint32(4, true);
  return hash32(low ^ Math.imul(high, 0x9e3779b1));
}

/** Deterministically hashes a world coordinate and seed, including fractions. */
export function hashCoordinates(
  x: number,
  y: number,
  z: number,
  seed: Seed = 0,
): number {
  let hash = seedToUint32(seed);
  hash = hash32(hash ^ hashNumber(x) ^ 0x9e3779b9);
  hash = hash32(hash ^ hashNumber(y) ^ 0x85ebca6b);
  hash = hash32(hash ^ hashNumber(z) ^ 0xc2b2ae35);
  return hash >>> 0;
}

export const hashVoxel = hashCoordinates;

/** Stateless deterministic noise value in [0, 1) for a voxel coordinate. */
export function randomFloatAt(
  x: number,
  y: number,
  z: number,
  seed: Seed = 0,
): number {
  return hashCoordinates(x, y, z, seed) / UINT32_RANGE;
}

/**
 * Creates a Mulberry32 stream. Number seeds are first avalanched so nearby
 * world seeds do not start with correlated output.
 */
export function createSeededRandom(seed: Seed): SeededRandom {
  let state = seedToUint32(seed);

  const nextUint32 = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  };

  const random = (() => nextUint32() / UINT32_RANGE) as SeededRandom;
  random.uint32 = nextUint32;
  random.range = (min: number, max: number): number => {
    assertFinite(min, "min");
    assertFinite(max, "max");
    if (max < min) {
      throw new RangeError("max must be greater than or equal to min");
    }
    return min + random() * (max - min);
  };
  random.int = (min: number, maxExclusive: number): number => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(maxExclusive)) {
      throw new RangeError("integer range bounds must be safe integers");
    }
    if (maxExclusive <= min) {
      throw new RangeError("maxExclusive must be greater than min");
    }
    return min + Math.floor(random() * (maxExclusive - min));
  };
  random.getState = () => state;

  return random;
}

export const mulberry32 = createSeededRandom;

function makeHit(
  voxel: VoxelCoord,
  previousVoxel: VoxelCoord | null,
  position: Vec3,
  normal: VoxelCoord,
  distance: number,
): VoxelRaycastHit {
  return {
    x: voxel.x,
    y: voxel.y,
    z: voxel.z,
    voxel,
    previousVoxel,
    position,
    normal,
    distance: withoutNegativeZero(distance),
  };
}

function initialBoundaryDistance(
  origin: number,
  voxel: number,
  direction: number,
  step: number,
): number {
  if (step === 0) return Number.POSITIVE_INFINITY;
  const boundary = step > 0 ? voxel + 1 : voxel;
  return Math.max(0, (boundary - origin) / direction);
}

/**
 * Amanatides-Woo voxel traversal. `direction` need not be normalized;
 * `maxDistance` and the returned distance are always world-space units.
 */
export function raycastVoxels(
  origin: Vec3,
  direction: Vec3,
  maxDistance: number,
  isSolid: VoxelQuery,
): VoxelRaycastHit | null {
  assertVector(origin, "origin");
  assertVector(direction, "direction");
  assertFinite(maxDistance, "maxDistance");
  if (maxDistance < 0) {
    throw new RangeError("maxDistance must be non-negative");
  }

  const directionLength = Math.hypot(direction.x, direction.y, direction.z);
  if (directionLength === 0) return null;

  const unit: Vec3 = {
    x: direction.x / directionLength,
    y: direction.y / directionLength,
    z: direction.z / directionLength,
  };
  const current: MutableVec3 = {
    x: Math.floor(origin.x),
    y: Math.floor(origin.y),
    z: Math.floor(origin.z),
  };
  const step: MutableVec3 = {
    x: Math.sign(unit.x),
    y: Math.sign(unit.y),
    z: Math.sign(unit.z),
  };

  if (isSolid(current.x, current.y, current.z)) {
    return makeHit(
      { ...current },
      null,
      { ...origin },
      { x: 0, y: 0, z: 0 },
      0,
    );
  }

  const delta: MutableVec3 = {
    x: step.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / unit.x),
    y: step.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / unit.y),
    z: step.z === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / unit.z),
  };
  const next: MutableVec3 = {
    x: initialBoundaryDistance(origin.x, current.x, unit.x, step.x),
    y: initialBoundaryDistance(origin.y, current.y, unit.y, step.y),
    z: initialBoundaryDistance(origin.z, current.z, unit.z, step.z),
  };

  for (;;) {
    const distance = Math.min(next.x, next.y, next.z);
    if (!Number.isFinite(distance) || distance > maxDistance + DDA_EPSILON) {
      return null;
    }

    const previous: VoxelCoord = { ...current };
    const normal: MutableVec3 = { x: 0, y: 0, z: 0 };

    // Step all tied axes. This visits the diagonal voxel at exact edge/corner
    // crossings without reporting cells that the ray only touches tangentially.
    if (next.x <= distance + DDA_EPSILON) {
      current.x += step.x;
      next.x += delta.x;
      normal.x = -step.x;
    }
    if (next.y <= distance + DDA_EPSILON) {
      current.y += step.y;
      next.y += delta.y;
      normal.y = -step.y;
    }
    if (next.z <= distance + DDA_EPSILON) {
      current.z += step.z;
      next.z += delta.z;
      normal.z = -step.z;
    }

    if (isSolid(current.x, current.y, current.z)) {
      return makeHit(
        { ...current },
        previous,
        {
          x: origin.x + unit.x * distance,
          y: origin.y + unit.y * distance,
          z: origin.z + unit.z * distance,
        },
        normal,
        distance,
      );
    }
  }
}

export const voxelRaycast = raycastVoxels;

export function createAABB(min: Vec3, max: Vec3): AABB {
  assertVector(min, "min");
  assertVector(max, "max");
  if (min.x > max.x || min.y > max.y || min.z > max.z) {
    throw new RangeError("AABB min must not exceed max");
  }
  return { min: { ...min }, max: { ...max } };
}

/** Creates a feet-anchored player box centered on X/Z. */
export function createPlayerAABB(
  feetPosition: Vec3,
  width = PLAYER_WIDTH,
  height = PLAYER_HEIGHT,
  depth = PLAYER_DEPTH,
): AABB {
  assertVector(feetPosition, "feetPosition");
  assertFinite(width, "width");
  assertFinite(height, "height");
  assertFinite(depth, "depth");
  if (width <= 0 || height <= 0 || depth <= 0) {
    throw new RangeError("player dimensions must be positive");
  }

  return createAABB(
    {
      x: feetPosition.x - width / 2,
      y: feetPosition.y,
      z: feetPosition.z - depth / 2,
    },
    {
      x: feetPosition.x + width / 2,
      y: feetPosition.y + height,
      z: feetPosition.z + depth / 2,
    },
  );
}

export const playerAABB = createPlayerAABB;

/** Touching faces are not considered overlapping. */
export function intersectsAABB(a: AABB, b: AABB): boolean {
  return (
    a.min.x < b.max.x &&
    a.max.x > b.min.x &&
    a.min.y < b.max.y &&
    a.max.y > b.min.y &&
    a.min.z < b.max.z &&
    a.max.z > b.min.z
  );
}

export const aabbIntersects = intersectsAABB;

export function containsPointAABB(box: AABB, point: Vec3): boolean {
  return (
    point.x >= box.min.x &&
    point.x <= box.max.x &&
    point.y >= box.min.y &&
    point.y <= box.max.y &&
    point.z >= box.min.z &&
    point.z <= box.max.z
  );
}

export function translateAABB(box: AABB, offset: Vec3): AABB {
  return {
    min: {
      x: box.min.x + offset.x,
      y: box.min.y + offset.y,
      z: box.min.z + offset.z,
    },
    max: {
      x: box.max.x + offset.x,
      y: box.max.y + offset.y,
      z: box.max.z + offset.z,
    },
  };
}

export function expandAABB(box: AABB, amount: Vec3): AABB {
  return createAABB(
    {
      x: box.min.x - amount.x,
      y: box.min.y - amount.y,
      z: box.min.z - amount.z,
    },
    {
      x: box.max.x + amount.x,
      y: box.max.y + amount.y,
      z: box.max.z + amount.z,
    },
  );
}

function overlappedVoxelRange(min: number, max: number): readonly [number, number] {
  return [
    Math.floor(min + COLLISION_EPSILON),
    Math.floor(max - COLLISION_EPSILON),
  ];
}

export function aabbCollidesWithVoxels(box: AABB, isSolid: VoxelQuery): boolean {
  const [minX, maxX] = overlappedVoxelRange(box.min.x, box.max.x);
  const [minY, maxY] = overlappedVoxelRange(box.min.y, box.max.y);
  const [minZ, maxZ] = overlappedVoxelRange(box.min.z, box.max.z);

  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      for (let z = minZ; z <= maxZ; z += 1) {
        if (isSolid(x, y, z)) return true;
      }
    }
  }
  return false;
}

function otherAxes(axis: Axis): readonly [Axis, Axis] {
  if (axis === "x") return ["y", "z"];
  if (axis === "y") return ["x", "z"];
  return ["x", "y"];
}

function layerHasSolidVoxel(
  box: AABB,
  axis: Axis,
  layer: number,
  isSolid: VoxelQuery,
): boolean {
  const [firstAxis, secondAxis] = otherAxes(axis);
  const [firstMin, firstMax] = overlappedVoxelRange(
    box.min[firstAxis],
    box.max[firstAxis],
  );
  const [secondMin, secondMax] = overlappedVoxelRange(
    box.min[secondAxis],
    box.max[secondAxis],
  );

  for (let first = firstMin; first <= firstMax; first += 1) {
    for (let second = secondMin; second <= secondMax; second += 1) {
      const voxel: MutableVec3 = { x: 0, y: 0, z: 0 };
      voxel[axis] = layer;
      voxel[firstAxis] = first;
      voxel[secondAxis] = second;
      if (isSolid(voxel.x, voxel.y, voxel.z)) return true;
    }
  }
  return false;
}

function allowedAxisMovement(
  box: AABB,
  axis: Axis,
  desired: number,
  isSolid: VoxelQuery,
): number {
  if (desired === 0) return 0;

  if (desired > 0) {
    const firstLayer = Math.floor(box.max[axis] - COLLISION_EPSILON) + 1;
    const lastLayer = Math.floor(
      box.max[axis] + desired - COLLISION_EPSILON,
    );
    for (let layer = firstLayer; layer <= lastLayer; layer += 1) {
      if (layerHasSolidVoxel(box, axis, layer, isSolid)) {
        return Math.max(0, layer - box.max[axis]);
      }
    }
    return desired;
  }

  const firstLayer = Math.floor(box.min[axis] + COLLISION_EPSILON) - 1;
  const lastLayer = Math.floor(box.min[axis] + desired + COLLISION_EPSILON);
  for (let layer = firstLayer; layer >= lastLayer; layer -= 1) {
    if (layerHasSolidVoxel(box, axis, layer, isSolid)) {
      return Math.min(0, layer + 1 - box.min[axis]);
    }
  }
  return desired;
}

function axisVector(axis: Axis, amount: number): Vec3 {
  return {
    x: axis === "x" ? amount : 0,
    y: axis === "y" ? amount : 0,
    z: axis === "z" ? amount : 0,
  };
}

/**
 * Swept, axis-separated voxel movement. Every crossed voxel layer is tested,
 * so large frame deltas cannot tunnel through one-block walls. The default
 * X/Y/Z order is deterministic; callers may supply another permutation.
 */
export function moveAABBWithVoxelCollisions(
  box: AABB,
  delta: Vec3,
  isSolid: VoxelQuery,
  axisOrder: readonly Axis[] = DEFAULT_AXIS_ORDER,
): VoxelCollisionResult {
  assertVector(delta, "delta");
  if (
    axisOrder.length !== 3 ||
    new Set(axisOrder).size !== 3 ||
    !axisOrder.every((axis) => DEFAULT_AXIS_ORDER.includes(axis))
  ) {
    throw new RangeError("axisOrder must contain x, y, and z exactly once");
  }

  let movedBox: AABB = createAABB(box.min, box.max);
  const movement: MutableVec3 = { x: 0, y: 0, z: 0 };
  const collided: { x: boolean; y: boolean; z: boolean } = {
    x: false,
    y: false,
    z: false,
  };

  for (const axis of axisOrder) {
    const allowed = withoutNegativeZero(
      allowedAxisMovement(movedBox, axis, delta[axis], isSolid),
    );
    movement[axis] = allowed;
    collided[axis] = Math.abs(allowed - delta[axis]) > COLLISION_EPSILON;
    movedBox = translateAABB(movedBox, axisVector(axis, allowed));
  }

  const collisionNormal: Vec3 = {
    x: collided.x ? -Math.sign(delta.x) : 0,
    y: collided.y ? -Math.sign(delta.y) : 0,
    z: collided.z ? -Math.sign(delta.z) : 0,
  };

  return {
    box: movedBox,
    attempted: { ...delta },
    movement: { ...movement },
    remaining: {
      x: withoutNegativeZero(delta.x - movement.x),
      y: withoutNegativeZero(delta.y - movement.y),
      z: withoutNegativeZero(delta.z - movement.z),
    },
    collided: { ...collided },
    collisionNormal,
    onGround: collided.y && delta.y < 0,
  };
}

export const moveAABB = moveAABBWithVoxelCollisions;
export const moveWithVoxelCollisions = moveAABBWithVoxelCollisions;
