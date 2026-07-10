import {
  CanvasTexture,
  ClampToEdgeWrapping,
  NearestFilter,
  SRGBColorSpace,
} from "three";

export const TILE_SIZE = 16;
export const ATLAS_COLUMNS = 8;
export const ATLAS_ROWS = 3;
export const ATLAS_WIDTH = TILE_SIZE * ATLAS_COLUMNS;
export const ATLAS_HEIGHT = TILE_SIZE * ATLAS_ROWS;

/** Tile numbers are stable and can be stored directly in chunk mesh data. */
export enum TileId {
  GrassTop = 0,
  GrassSide = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Water = 5,
  LogTop = 6,
  LogSide = 7,
  Leaves = 8,
  CoalOre = 9,
  IronOre = 10,
  CopperOre = 11,
  Planks = 12,
  Brick = 13,
  Glass = 14,
  SnowTop = 15,
  SnowSide = 16,
  Glow = 17,
  Cobblestone = 18,
  Clay = 19,
  Basalt = 20,
  CactusSide = 21,
  CactusTop = 22,
}

export interface AtlasUV {
  readonly u0: number;
  readonly v0: number;
  readonly u1: number;
  readonly v1: number;
}

type PixelContext = CanvasRenderingContext2D;
type Palette = readonly string[];

const STONE = ["#68717a", "#758089", "#5b636c", "#858e95"] as const;

function hash(x: number, y: number, seed: number): number {
  let value = Math.imul(x + 0x9e3779b9, 0x85ebca6b);
  value ^= Math.imul(y + 0xc2b2ae35, 0x27d4eb2d);
  value ^= Math.imul(seed + 0x165667b1, 0x1b873593);
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d);
  value ^= value >>> 12;
  return (value >>> 0) / 0x100000000;
}

function paintPixel(
  context: PixelContext,
  originX: number,
  originY: number,
  x: number,
  y: number,
  color: string,
): void {
  context.fillStyle = color;
  context.fillRect(originX + x, originY + y, 1, 1);
}

function noiseTile(
  context: PixelContext,
  tile: TileId,
  palette: Palette,
  seed: number,
): void {
  const originX = (tile % ATLAS_COLUMNS) * TILE_SIZE;
  const originY = Math.floor(tile / ATLAS_COLUMNS) * TILE_SIZE;
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const color = palette[Math.floor(hash(x, y, seed) * palette.length)];
      paintPixel(context, originX, originY, x, y, color);
    }
  }
}

function tileOrigin(tile: TileId): readonly [number, number] {
  return [
    (tile % ATLAS_COLUMNS) * TILE_SIZE,
    Math.floor(tile / ATLAS_COLUMNS) * TILE_SIZE,
  ];
}

function paintGrass(context: PixelContext): void {
  noiseTile(context, TileId.GrassTop, ["#527c3d", "#609149", "#446d35", "#6b9b50"], 11);
  const [topX, topY] = tileOrigin(TileId.GrassTop);
  for (let i = 0; i < 18; i += 1) {
    const x = Math.floor(hash(i, 2, 101) * TILE_SIZE);
    const y = Math.floor(hash(i, 7, 102) * TILE_SIZE);
    paintPixel(context, topX, topY, x, y, hash(i, 3, 103) > 0.5 ? "#87ad58" : "#315d31");
  }

  noiseTile(context, TileId.GrassSide, ["#79563a", "#835f40", "#684832", "#906747"], 12);
  const [sideX, sideY] = tileOrigin(TileId.GrassSide);
  for (let x = 0; x < TILE_SIZE; x += 1) {
    const depth = 3 + Math.floor(hash(x, 0, 104) * 3);
    for (let y = 0; y < depth; y += 1) {
      const green = hash(x, y, 105) > 0.45 ? "#578541" : "#426d35";
      paintPixel(context, sideX, sideY, x, y, green);
    }
  }
}

function paintWater(context: PixelContext): void {
  const [originX, originY] = tileOrigin(TileId.Water);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const wave = (x + Math.floor(y / 3) * 2) % 7;
      const color = wave === 0
        ? "rgba(105, 203, 222, 0.76)"
        : hash(x, y, 31) > 0.76
          ? "rgba(31, 128, 181, 0.68)"
          : "rgba(42, 157, 202, 0.70)";
      paintPixel(context, originX, originY, x, y, color);
    }
  }
}

function paintLog(context: PixelContext): void {
  noiseTile(context, TileId.LogTop, ["#b2844f", "#a27446", "#c09257"], 41);
  const [topX, topY] = tileOrigin(TileId.LogTop);
  const rings = [2, 5, 7];
  for (const radius of rings) {
    for (let y = 0; y < TILE_SIZE; y += 1) {
      for (let x = 0; x < TILE_SIZE; x += 1) {
        const distance = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
        if (Math.abs(distance - radius) < 0.55 && hash(x, y, radius) > 0.18) {
          paintPixel(context, topX, topY, x, y, radius === 7 ? "#65452f" : "#805735");
        }
      }
    }
  }
  context.fillStyle = "#5a3928";
  context.fillRect(topX + 7, topY + 7, 2, 2);

  noiseTile(context, TileId.LogSide, ["#785034", "#69442e", "#875c38", "#5e3d2c"], 42);
  const [sideX, sideY] = tileOrigin(TileId.LogSide);
  for (let x = 1; x < TILE_SIZE; x += 4) {
    context.fillStyle = x % 8 === 1 ? "#503227" : "#9a6740";
    context.fillRect(sideX + x, sideY, 1, TILE_SIZE);
  }
  for (let y = 2; y < TILE_SIZE; y += 5) {
    context.fillStyle = "#55372a";
    context.fillRect(sideX + ((y * 3) % 11), sideY + y, 4, 1);
  }
}

function paintLeaves(context: PixelContext): void {
  const [originX, originY] = tileOrigin(TileId.Leaves);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const value = hash(x, y, 51);
      const color = value < 0.08
        ? "rgba(0, 0, 0, 0)"
        : value < 0.36
          ? "#2e613c"
          : value < 0.72
            ? "#3d7545"
            : "#52864d";
      paintPixel(context, originX, originY, x, y, color);
    }
  }
  context.fillStyle = "#234e36";
  context.fillRect(originX + 3, originY + 2, 1, 6);
  context.fillRect(originX + 10, originY + 8, 1, 5);
}

function paintOre(
  context: PixelContext,
  tile: TileId,
  seed: number,
  colors: readonly [string, string],
): void {
  noiseTile(context, tile, STONE, seed);
  const [originX, originY] = tileOrigin(tile);
  for (let cluster = 0; cluster < 6; cluster += 1) {
    const x = 1 + Math.floor(hash(cluster, 4, seed + 1) * 13);
    const y = 1 + Math.floor(hash(cluster, 8, seed + 2) * 13);
    paintPixel(context, originX, originY, x, y, colors[0]);
    paintPixel(context, originX, originY, x + 1, y, colors[1]);
    if (cluster % 2 === 0) {
      paintPixel(context, originX, originY, x, y + 1, colors[1]);
    }
  }
}

function paintPlanks(context: PixelContext): void {
  noiseTile(context, TileId.Planks, ["#a97843", "#b7864c", "#956739", "#c09159"], 71);
  const [originX, originY] = tileOrigin(TileId.Planks);
  for (let y = 3; y < TILE_SIZE; y += 4) {
    context.fillStyle = "#69482f";
    context.fillRect(originX, originY + y, TILE_SIZE, 1);
  }
  context.fillStyle = "#755035";
  context.fillRect(originX + 6, originY, 1, 4);
  context.fillRect(originX + 11, originY + 4, 1, 4);
  context.fillRect(originX + 4, originY + 8, 1, 4);
  context.fillRect(originX + 13, originY + 12, 1, 4);
  context.fillStyle = "#4c3b31";
  context.fillRect(originX + 1, originY + 2, 1, 1);
  context.fillRect(originX + 14, originY + 10, 1, 1);
}

function paintBrick(context: PixelContext): void {
  const [originX, originY] = tileOrigin(TileId.Brick);
  context.fillStyle = "#9c9a91";
  context.fillRect(originX, originY, TILE_SIZE, TILE_SIZE);
  const brickColors = ["#9b4e43", "#aa594b", "#8d443c", "#b26050"] as const;
  for (let row = 0; row < 4; row += 1) {
    const offset = row % 2 === 0 ? -4 : 0;
    for (let column = offset; column < TILE_SIZE; column += 8) {
      const color = brickColors[(row * 3 + column + 12) % brickColors.length];
      context.fillStyle = color;
      context.fillRect(originX + Math.max(column + 1, 0), originY + row * 4 + 1, Math.min(7, TILE_SIZE - column - 1), 3);
      context.fillStyle = "rgba(255, 210, 170, 0.13)";
      context.fillRect(originX + Math.max(column + 2, 0), originY + row * 4 + 1, Math.min(5, TILE_SIZE - column - 2), 1);
    }
  }
}

function paintGlass(context: PixelContext): void {
  const [originX, originY] = tileOrigin(TileId.Glass);
  context.fillStyle = "rgba(139, 211, 218, 0.14)";
  context.fillRect(originX, originY, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = "rgba(180, 236, 236, 0.68)";
  context.lineWidth = 1;
  context.strokeRect(originX + 0.5, originY + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
  context.fillStyle = "rgba(226, 255, 255, 0.72)";
  context.fillRect(originX + 3, originY + 2, 1, 5);
  context.fillRect(originX + 4, originY + 2, 3, 1);
  context.fillRect(originX + 10, originY + 10, 1, 3);
  context.fillRect(originX + 11, originY + 9, 2, 1);
}

function paintSnow(context: PixelContext): void {
  noiseTile(context, TileId.SnowTop, ["#eef7f4", "#dfecea", "#f8fbf8", "#cfdfdf"], 91);
  noiseTile(context, TileId.SnowSide, ["#e4efed", "#d3e4e3", "#edf6f3"], 92);
  const [originX, originY] = tileOrigin(TileId.SnowSide);
  for (let x = 0; x < TILE_SIZE; x += 1) {
    const y = 11 + Math.floor(hash(x, 1, 93) * 4);
    context.fillStyle = x % 3 === 0 ? "#b9d2d5" : "#c8dcdd";
    context.fillRect(originX + x, originY + y, 1, TILE_SIZE - y);
  }
}

function paintGlow(context: PixelContext): void {
  const [originX, originY] = tileOrigin(TileId.Glow);
  context.fillStyle = "#183b44";
  context.fillRect(originX, originY, TILE_SIZE, TILE_SIZE);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const distance = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      const color = distance < 3
        ? "#efffbd"
        : distance < 6
          ? "#70dcc5"
          : hash(x, y, 101) > 0.72
            ? "#245b5f"
            : "#183b44";
      paintPixel(context, originX, originY, x, y, color);
    }
  }
  context.fillStyle = "#fff5a5";
  context.fillRect(originX + 7, originY + 4, 2, 8);
  context.fillRect(originX + 4, originY + 7, 8, 2);
}

function paintCobble(context: PixelContext): void {
  noiseTile(context, TileId.Cobblestone, ["#626b70", "#747d81", "#555e63"], 111);
  const [originX, originY] = tileOrigin(TileId.Cobblestone);
  context.strokeStyle = "#414b51";
  context.lineWidth = 1;
  const stones = [
    [0, 0, 6, 5], [7, 0, 9, 4], [0, 6, 4, 5], [5, 5, 7, 6],
    [13, 5, 3, 6], [0, 12, 7, 4], [8, 12, 8, 4],
  ] as const;
  for (const [x, y, width, height] of stones) {
    context.strokeRect(originX + x + 0.5, originY + y + 0.5, width - 1, height - 1);
  }
}

function paintBasalt(context: PixelContext): void {
  noiseTile(context, TileId.Basalt, ["#34383f", "#3e434a", "#292d34", "#4a4e54"], 121);
  const [originX, originY] = tileOrigin(TileId.Basalt);
  for (let x = 2; x < TILE_SIZE; x += 5) {
    context.fillStyle = x === 7 ? "#1f242b" : "#555a5f";
    context.fillRect(originX + x, originY, 1, TILE_SIZE);
  }
}

function paintCactus(context: PixelContext): void {
  noiseTile(context, TileId.CactusSide, ["#397a4f", "#438858", "#327046"], 131);
  const [sideX, sideY] = tileOrigin(TileId.CactusSide);
  for (let x = 2; x < TILE_SIZE; x += 5) {
    context.fillStyle = "#75a65f";
    context.fillRect(sideX + x, sideY, 1, TILE_SIZE);
  }
  for (let i = 0; i < 9; i += 1) {
    const x = Math.floor(hash(i, 2, 132) * 14);
    const y = Math.floor(hash(i, 3, 133) * 14);
    paintPixel(context, sideX, sideY, x, y, "#d6d7a5");
  }

  noiseTile(context, TileId.CactusTop, ["#4d8d55", "#5c9d61", "#3d7949"], 134);
  const [topX, topY] = tileOrigin(TileId.CactusTop);
  context.strokeStyle = "#b8c77f";
  context.strokeRect(topX + 3.5, topY + 3.5, 9, 9);
  context.fillStyle = "#d5d993";
  context.fillRect(topX + 7, topY + 7, 2, 2);
}

function drawAtlas(context: PixelContext): void {
  context.clearRect(0, 0, ATLAS_WIDTH, ATLAS_HEIGHT);
  context.imageSmoothingEnabled = false;

  paintGrass(context);
  noiseTile(context, TileId.Dirt, ["#765338", "#825c3d", "#67472f", "#916544"], 21);
  noiseTile(context, TileId.Stone, STONE, 22);
  noiseTile(context, TileId.Sand, ["#d6c27c", "#e1cf8d", "#c8b26f", "#ead99a"], 23);
  paintWater(context);
  paintLog(context);
  paintLeaves(context);
  paintOre(context, TileId.CoalOre, 61, ["#252a2e", "#3a4045"]);
  paintOre(context, TileId.IronOre, 62, ["#b88b6f", "#d3a184"]);
  paintOre(context, TileId.CopperOre, 63, ["#bd6d47", "#5b9a83"]);
  paintPlanks(context);
  paintBrick(context);
  paintGlass(context);
  paintSnow(context);
  paintGlow(context);
  paintCobble(context);
  noiseTile(context, TileId.Clay, ["#8799a6", "#91a4af", "#7b8c99", "#a0afb6"], 112);
  paintBasalt(context);
  paintCactus(context);
}

/**
 * Returns atlas UV bounds with a small inward offset. CanvasTexture uses a
 * bottom-left UV origin, while tile rows are authored from the canvas top.
 */
export function getTileUV(tile: TileId | number, insetPixels = 0.02): AtlasUV {
  const safeTile = Math.max(0, Math.min(ATLAS_COLUMNS * ATLAS_ROWS - 1, Math.trunc(tile)));
  const column = safeTile % ATLAS_COLUMNS;
  const row = Math.floor(safeTile / ATLAS_COLUMNS);
  const inset = Math.max(0, Math.min(TILE_SIZE / 2 - 0.01, insetPixels));

  return {
    u0: (column * TILE_SIZE + inset) / ATLAS_WIDTH,
    v0: 1 - ((row + 1) * TILE_SIZE - inset) / ATLAS_HEIGHT,
    u1: ((column + 1) * TILE_SIZE - inset) / ATLAS_WIDTH,
    v1: 1 - (row * TILE_SIZE + inset) / ATLAS_HEIGHT,
  };
}

/** Creates the complete original pixel atlas without loading external assets. */
export function createTextureAtlas(): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_WIDTH;
  canvas.height = ATLAS_HEIGHT;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("This browser does not support the 2D canvas required for block textures.");
  }

  drawAtlas(context);

  const texture = new CanvasTexture(canvas);
  texture.name = "Voxel Realms Original Pixel Atlas";
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.anisotropy = 1;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  texture.userData = {
    ...texture.userData,
    tileSize: TILE_SIZE,
    columns: ATLAS_COLUMNS,
    rows: ATLAS_ROWS,
  };
  return texture;
}
