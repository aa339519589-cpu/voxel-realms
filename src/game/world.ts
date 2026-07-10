import { createNoise2D, createNoise3D } from "simplex-noise";
import * as THREE from "three";
import { BlockId, getBlock, getTileUV } from "./blocks";
import { createSeededRandom, floorDiv, hashCoordinates } from "./math";

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 40;
export const SEA_LEVEL = 10;

interface ChunkRecord {
  key: string;
  cx: number;
  cz: number;
  group: THREE.Group;
}

interface MeshBuffers {
  positions: number[];
  normals: number[];
  uvs: number[];
  colors: number[];
  indices: number[];
}

interface Face {
  normal: readonly [number, number, number];
  vertices: ReadonlyArray<readonly [number, number, number]>;
  shade: number;
  texture: "top" | "side" | "bottom";
}

const FACES: Face[] = [
  { normal: [1, 0, 0], vertices: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], shade: 0.82, texture: "side" },
  { normal: [-1, 0, 0], vertices: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], shade: 0.72, texture: "side" },
  { normal: [0, 1, 0], vertices: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], shade: 1, texture: "top" },
  { normal: [0, -1, 0], vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], shade: 0.55, texture: "bottom" },
  { normal: [0, 0, 1], vertices: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], shade: 0.9, texture: "side" },
  { normal: [0, 0, -1], vertices: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], shade: 0.76, texture: "side" },
];

function seedNumber(seed: string): number {
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function buffers(): MeshBuffers {
  return { positions: [], normals: [], uvs: [], colors: [], indices: [] };
}

function chunkKey(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function voxelKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function parseVoxelKey(key: string): [number, number, number] | null {
  const values = key.split(",").map(Number);
  return values.length === 3 && values.every(Number.isFinite) ? [values[0], values[1], values[2]] : null;
}

export class VoxelWorld {
  private readonly chunks = new Map<string, ChunkRecord>();
  private readonly queued = new Set<string>();
  private readonly queue: Array<{ cx: number; cz: number; distance: number }> = [];
  private readonly modifications = new Map<string, BlockId>();
  private readonly noise2D: ReturnType<typeof createNoise2D>;
  private readonly detail2D: ReturnType<typeof createNoise2D>;
  private readonly biome2D: ReturnType<typeof createNoise2D>;
  private readonly cave3D: ReturnType<typeof createNoise3D>;
  private readonly seedValue: number;
  private readonly surfaceCache = new Map<string, number>();
  private readonly biomeCache = new Map<string, "plains" | "forest" | "desert" | "alpine">();
  private readonly opaqueMaterial: THREE.MeshLambertMaterial;
  private readonly transparentMaterial: THREE.MeshLambertMaterial;
  private updateTimer = 0;
  private renderDistance = 3;

  constructor(
    private readonly scene: THREE.Scene,
    readonly seed: string,
    atlas: THREE.CanvasTexture,
    private readonly onPatch?: (key: string, block: BlockId) => void,
  ) {
    this.seedValue = seedNumber(seed);
    const random = createSeededRandom(this.seedValue);
    this.noise2D = createNoise2D(random);
    this.detail2D = createNoise2D(random);
    this.biome2D = createNoise2D(random);
    this.cave3D = createNoise3D(random);
    this.opaqueMaterial = new THREE.MeshLambertMaterial({ map: atlas, vertexColors: true, alphaTest: 0.12 });
    this.transparentMaterial = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      transparent: true,
      opacity: 0.86,
      alphaTest: 0.08,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
  }

  setRenderDistance(distance: number): void {
    this.renderDistance = Math.max(2, Math.min(6, Math.round(distance)));
  }

  get loadedChunks(): number {
    return this.chunks.size;
  }

  get patches(): Record<string, number> {
    return Object.fromEntries(this.modifications.entries());
  }

  applyPatches(patches: Record<string, number> | undefined): void {
    this.modifications.clear();
    if (!patches || typeof patches !== "object") return;
    for (const [key, value] of Object.entries(patches)) {
      if (!parseVoxelKey(key) || !Number.isInteger(value) || value < 0 || value > 255) continue;
      this.modifications.set(key, value as BlockId);
    }
  }

  biomeAt(x: number, z: number): "plains" | "forest" | "desert" | "alpine" {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const key = `${ix},${iz}`;
    const cached = this.biomeCache.get(key);
    if (cached) return cached;
    const value = this.biome2D(ix * 0.0065, iz * 0.0065) + this.detail2D(ix * 0.018, iz * 0.018) * 0.25;
    const biome = value < -0.38 ? "desert" : value > 0.54 ? "alpine" : value > 0.08 ? "forest" : "plains";
    if (this.biomeCache.size > 100_000) this.biomeCache.clear();
    this.biomeCache.set(key, biome);
    return biome;
  }

  surfaceHeight(x: number, z: number): number {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const key = `${ix},${iz}`;
    const cached = this.surfaceCache.get(key);
    if (cached !== undefined) return cached;
    const continental = this.noise2D(ix * 0.008, iz * 0.008);
    const hills = this.detail2D(ix * 0.027, iz * 0.027);
    const ridge = 1 - Math.abs(this.noise2D(ix * 0.014 + 91, iz * 0.014 - 37));
    const biome = this.biomeAt(ix, iz);
    const biomeLift = biome === "alpine" ? 5 + ridge * 5 : biome === "desert" ? -1 : biome === "forest" ? 1 : 0;
    const height = 12 + continental * 5.2 + hills * 2.3 + ridge * 2.2 + biomeLift;
    const result = Math.max(4, Math.min(WORLD_HEIGHT - 7, Math.floor(height)));
    if (this.surfaceCache.size > 100_000) this.surfaceCache.clear();
    this.surfaceCache.set(key, result);
    return result;
  }

  private isTreeAnchor(x: number, z: number): boolean {
    const biome = this.biomeAt(x, z);
    if (biome !== "forest" && biome !== "plains") return false;
    const frequency = biome === "forest" ? 31 : 83;
    return hashCoordinates(x, 47, z, this.seedValue) % frequency === 0 && this.surfaceHeight(x, z) > SEA_LEVEL + 1;
  }

  private featureBlock(x: number, y: number, z: number): BlockId {
    const regionX = floorDiv(x, 64);
    const regionZ = floorDiv(z, 64);
    const ruinX = regionX * 64 + 14 + (hashCoordinates(regionX, 311, regionZ, this.seedValue) % 36);
    const ruinZ = regionZ * 64 + 14 + (hashCoordinates(regionX, 733, regionZ, this.seedValue) % 36);
    const ruinBase = this.surfaceHeight(ruinX, ruinZ);
    const ruinDx = x - ruinX;
    const ruinDz = z - ruinZ;
    if (Math.abs(ruinDx) <= 3 && Math.abs(ruinDz) <= 3 && ruinBase > SEA_LEVEL + 1) {
      const level = y - ruinBase;
      const perimeter = Math.abs(ruinDx) === 3 || Math.abs(ruinDz) === 3;
      const doorway = ruinDz === -3 && Math.abs(ruinDx) <= 1 && level <= 2;
      const weatheredGap = hashCoordinates(x, y, z, this.seedValue) % 13 === 0;
      if (level === 1 && (perimeter || (Math.abs(ruinDx) === 1 && Math.abs(ruinDz) === 1))) return BlockId.Cobblestone;
      if (level >= 2 && level <= 3 && perimeter && !doorway && !weatheredGap) return level === 3 && (ruinDx + ruinDz) % 2 === 0 ? BlockId.Brick : BlockId.Cobblestone;
      if (level === 2 && ruinDx === 0 && ruinDz === 0) return BlockId.Glow;
      if (level === 4 && Math.abs(ruinDx) === 3 && Math.abs(ruinDz) === 3) return BlockId.Basalt;
    }
    for (let anchorX = x - 2; anchorX <= x + 2; anchorX += 1) {
      for (let anchorZ = z - 2; anchorZ <= z + 2; anchorZ += 1) {
        if (!this.isTreeAnchor(anchorX, anchorZ)) continue;
        const root = this.surfaceHeight(anchorX, anchorZ);
        const trunkHeight = 4 + (hashCoordinates(anchorX, 5, anchorZ, this.seedValue) % 2);
        if (x === anchorX && z === anchorZ && y > root && y <= root + trunkHeight) return BlockId.OakLog;
        const dx = Math.abs(x - anchorX);
        const dz = Math.abs(z - anchorZ);
        const dy = y - (root + trunkHeight - 1);
        if (dy >= 0 && dy <= 2) {
          const radius = dy === 2 ? 1 : 2;
          if (dx <= radius && dz <= radius && !(dx === radius && dz === radius && dy > 0)) return BlockId.OakLeaves;
        }
      }
    }
    const biome = this.biomeAt(x, z);
    const surface = this.surfaceHeight(x, z);
    if (biome === "desert" && hashCoordinates(x, 19, z, this.seedValue) % 97 === 0 && y > surface && y <= surface + 3) return BlockId.Cactus;
    return BlockId.Air;
  }

  private generatedBlock(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= WORLD_HEIGHT) return BlockId.Air;
    if (y === 0) return BlockId.Basalt;
    const surface = this.surfaceHeight(x, z);
    if (y > surface) {
      const feature = this.featureBlock(x, y, z);
      if (feature !== BlockId.Air) return feature;
      return y <= SEA_LEVEL ? BlockId.Water : BlockId.Air;
    }
    const biome = this.biomeAt(x, z);
    if (y > 2 && y < surface - 3) {
      const cave = Math.abs(this.cave3D(x * 0.064, y * 0.086, z * 0.064));
      const tunnel = Math.abs(this.cave3D(x * 0.032 + 70, y * 0.055, z * 0.032 - 40));
      if (cave > 0.7 && tunnel > 0.2) return y <= SEA_LEVEL - 2 ? BlockId.Water : BlockId.Air;
    }
    if (y === surface) {
      if (biome === "desert" || surface <= SEA_LEVEL + 1) return BlockId.Sand;
      if (biome === "alpine" && surface > 17) return BlockId.Snow;
      return BlockId.Grass;
    }
    if (y >= surface - 3) return biome === "desert" ? BlockId.Sand : BlockId.Dirt;
    const oreRoll = hashCoordinates(x, y, z, this.seedValue) % 997;
    if (y < 13 && oreRoll < 11) return BlockId.IronOre;
    if (y < 20 && oreRoll >= 11 && oreRoll < 30) return BlockId.CoalOre;
    if (y < 24 && oreRoll >= 30 && oreRoll < 40) return BlockId.CopperOre;
    if (y < 6 && oreRoll === 63) return BlockId.Glow;
    return BlockId.Stone;
  }

  getBlock(x: number, y: number, z: number): BlockId {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    const modified = this.modifications.get(voxelKey(ix, iy, iz));
    return modified === undefined ? this.generatedBlock(ix, iy, iz) : modified;
  }

  isSolid(x: number, y: number, z: number): boolean {
    return getBlock(this.getBlock(x, y, z)).solid;
  }

  setBlock(x: number, y: number, z: number, block: BlockId): void {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const iz = Math.floor(z);
    if (iy <= 0 || iy >= WORLD_HEIGHT) return;
    const key = voxelKey(ix, iy, iz);
    if (block === this.generatedBlock(ix, iy, iz)) this.modifications.delete(key);
    else this.modifications.set(key, block);
    this.onPatch?.(key, block);
    const cx = floorDiv(ix, CHUNK_SIZE);
    const cz = floorDiv(iz, CHUNK_SIZE);
    this.rebuildChunk(cx, cz);
    if (ix - cx * CHUNK_SIZE === 0) this.rebuildChunk(cx - 1, cz);
    if (ix - cx * CHUNK_SIZE === CHUNK_SIZE - 1) this.rebuildChunk(cx + 1, cz);
    if (iz - cz * CHUNK_SIZE === 0) this.rebuildChunk(cx, cz - 1);
    if (iz - cz * CHUNK_SIZE === CHUNK_SIZE - 1) this.rebuildChunk(cx, cz + 1);
  }

  private shouldRenderFace(block: BlockId, neighbor: BlockId): boolean {
    const definition = getBlock(block);
    const adjacent = getBlock(neighbor);
    if (neighbor === BlockId.Air) return true;
    if (definition.liquid) return neighbor !== block && !adjacent.solid;
    if (definition.transparent) return neighbor !== block && (adjacent.transparent || adjacent.liquid);
    return adjacent.transparent || adjacent.liquid;
  }

  private emitFace(target: MeshBuffers, x: number, y: number, z: number, block: BlockId, face: Face): void {
    const definition = getBlock(block);
    const tile = definition.textures[face.texture];
    const uv = getTileUV(tile);
    const base = target.positions.length / 3;
    const liquidTop = definition.liquid ? 0.84 : 1;
    for (const vertex of face.vertices) {
      const adjustedY = vertex[1] === 1 ? liquidTop : vertex[1];
      target.positions.push(x + vertex[0], y + adjustedY, z + vertex[2]);
      target.normals.push(...face.normal);
      const heightLight = 0.88 + Math.min(0.12, y / WORLD_HEIGHT * 0.12);
      const jitter = (hashCoordinates(x + vertex[0], y + adjustedY, z + vertex[2], this.seedValue) % 7) / 150;
      const value = Math.min(1, face.shade * heightLight + jitter + (definition.emissive ? 0.35 : 0));
      target.colors.push(value, value, value);
    }
    target.uvs.push(uv.u0, uv.v0, uv.u1, uv.v0, uv.u1, uv.v1, uv.u0, uv.v1);
    target.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  private geometryFrom(target: MeshBuffers): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(target.positions, 3));
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(target.normals, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(target.uvs, 2));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(target.colors, 3));
    geometry.setIndex(target.indices);
    geometry.computeBoundingSphere();
    return geometry;
  }

  private buildChunk(cx: number, cz: number): ChunkRecord {
    const group = new THREE.Group();
    group.name = `chunk:${cx},${cz}`;
    const opaque = buffers();
    const transparent = buffers();
    const startX = cx * CHUNK_SIZE;
    const startZ = cz * CHUNK_SIZE;
    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      const x = startX + localX;
      for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
        const z = startZ + localZ;
        for (let y = 0; y < WORLD_HEIGHT; y += 1) {
          const block = this.getBlock(x, y, z);
          if (block === BlockId.Air) continue;
          const definition = getBlock(block);
          const target = definition.transparent || definition.liquid ? transparent : opaque;
          for (const face of FACES) {
            const neighbor = this.getBlock(x + face.normal[0], y + face.normal[1], z + face.normal[2]);
            if (this.shouldRenderFace(block, neighbor)) this.emitFace(target, x, y, z, block, face);
          }
        }
      }
    }
    if (opaque.indices.length) {
      const mesh = new THREE.Mesh(this.geometryFrom(opaque), this.opaqueMaterial);
      mesh.receiveShadow = true;
      mesh.castShadow = false;
      mesh.frustumCulled = true;
      group.add(mesh);
    }
    if (transparent.indices.length) {
      const mesh = new THREE.Mesh(this.geometryFrom(transparent), this.transparentMaterial);
      mesh.renderOrder = 2;
      mesh.frustumCulled = true;
      group.add(mesh);
    }
    return { key: chunkKey(cx, cz), cx, cz, group };
  }

  private disposeChunk(record: ChunkRecord): void {
    this.scene.remove(record.group);
    record.group.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
  }

  private rebuildChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const current = this.chunks.get(key);
    if (!current) return;
    this.disposeChunk(current);
    const next = this.buildChunk(cx, cz);
    this.chunks.set(key, next);
    this.scene.add(next.group);
  }

  private addChunk(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    if (this.chunks.has(key)) return;
    const record = this.buildChunk(cx, cz);
    this.chunks.set(key, record);
    this.scene.add(record.group);
  }

  private queueAround(x: number, z: number): void {
    const centerX = floorDiv(Math.floor(x), CHUNK_SIZE);
    const centerZ = floorDiv(Math.floor(z), CHUNK_SIZE);
    for (let dx = -this.renderDistance; dx <= this.renderDistance; dx += 1) {
      for (let dz = -this.renderDistance; dz <= this.renderDistance; dz += 1) {
        const cx = centerX + dx;
        const cz = centerZ + dz;
        const key = chunkKey(cx, cz);
        if (this.chunks.has(key) || this.queued.has(key)) continue;
        this.queued.add(key);
        this.queue.push({ cx, cz, distance: dx * dx + dz * dz });
      }
    }
    this.queue.sort((a, b) => a.distance - b.distance);
    const unloadDistance = this.renderDistance + 2;
    for (const [key, record] of this.chunks) {
      if (Math.abs(record.cx - centerX) <= unloadDistance && Math.abs(record.cz - centerZ) <= unloadDistance) continue;
      this.disposeChunk(record);
      this.chunks.delete(key);
    }
  }

  async warmStart(x: number, z: number, onProgress?: (progress: number) => void): Promise<void> {
    const centerX = floorDiv(Math.floor(x), CHUNK_SIZE);
    const centerZ = floorDiv(Math.floor(z), CHUNK_SIZE);
    const start: Array<{ cx: number; cz: number; distance: number }> = [];
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dz = -1; dz <= 1; dz += 1) start.push({ cx: centerX + dx, cz: centerZ + dz, distance: dx * dx + dz * dz });
    }
    start.sort((a, b) => a.distance - b.distance);
    for (let index = 0; index < start.length; index += 1) {
      this.addChunk(start[index].cx, start[index].cz);
      onProgress?.((index + 1) / start.length);
      if (index < start.length - 1) await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    this.queueAround(x, z);
  }

  update(delta: number, playerX: number, playerZ: number): void {
    this.updateTimer -= delta;
    if (this.updateTimer <= 0) {
      this.queueAround(playerX, playerZ);
      this.updateTimer = 0.45;
    }
    const budget = 1;
    for (let count = 0; count < budget && this.queue.length; count += 1) {
      const next = this.queue.shift()!;
      this.queued.delete(chunkKey(next.cx, next.cz));
      this.addChunk(next.cx, next.cz);
    }
  }

  dispose(): void {
    for (const record of this.chunks.values()) this.disposeChunk(record);
    this.chunks.clear();
    this.queue.length = 0;
    this.queued.clear();
    this.surfaceCache.clear();
    this.biomeCache.clear();
    this.opaqueMaterial.dispose();
    this.transparentMaterial.dispose();
  }
}
