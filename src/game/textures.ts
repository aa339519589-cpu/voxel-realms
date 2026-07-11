import {
  CanvasTexture,
  ClampToEdgeWrapping,
  NearestFilter,
  SRGBColorSpace,
} from "three";

export const TILE_SIZE = 16;
export const ATLAS_COLUMNS = 8;
export const ATLAS_ROWS = 7;
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
  Gravel = 23,
  Limestone = 24,
  Marble = 25,
  GoldOre = 26,
  BirchLogTop = 27,
  BirchLogSide = 28,
  BirchLeaves = 29,
  BirchPlanks = 30,
  StoneBricks = 31,
  MossyCobblestone = 32,
  PolishedBasalt = 33,
  CutCopper = 34,
  Terracotta = 35,
  Bookshelf = 36,
  AmberLamp = 37,
  Ice = 38,
  TintedGlass = 39,
  SandstoneTop = 40,
  SandstoneSide = 41,
  CoalBlock = 42,
  IronBlock = 43,
  CopperBlock = 44,
  GoldBlock = 45,
  CrystalOre = 46,
  CrystalBlock = 47,
  SpruceLogTop = 48,
  SpruceLogSide = 49,
  SpruceLeaves = 50,
  SprucePlanks = 51,
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

function paintVeinedStone(
  context: PixelContext,
  tile: TileId,
  palette: Palette,
  vein: string,
  seed: number,
): void {
  noiseTile(context, tile, palette, seed);
  const [originX, originY] = tileOrigin(tile);
  for (let path = 0; path < 3; path += 1) {
    let x = Math.floor(hash(path, 1, seed + 1) * TILE_SIZE);
    for (let y = -2; y < TILE_SIZE + 2; y += 1) {
      if (hash(path, y, seed + 2) > 0.56) x += hash(path, y, seed + 3) > 0.5 ? 1 : -1;
      paintPixel(context, originX, originY, (x + TILE_SIZE) % TILE_SIZE, Math.max(0, Math.min(15, y)), vein);
    }
  }
}

function paintLogVariant(
  context: PixelContext,
  top: TileId,
  side: TileId,
  topPalette: Palette,
  sidePalette: Palette,
  ring: string,
  stripe: string,
  seed: number,
): void {
  noiseTile(context, top, topPalette, seed);
  const [topX, topY] = tileOrigin(top);
  context.strokeStyle = ring;
  context.strokeRect(topX + 2.5, topY + 2.5, 11, 11);
  context.strokeRect(topX + 5.5, topY + 5.5, 5, 5);
  context.fillStyle = ring;
  context.fillRect(topX + 7, topY + 7, 2, 2);

  noiseTile(context, side, sidePalette, seed + 1);
  const [sideX, sideY] = tileOrigin(side);
  for (let x = 1; x < TILE_SIZE; x += 4) {
    context.fillStyle = stripe;
    context.fillRect(sideX + x, sideY, 1, TILE_SIZE);
  }
  for (let mark = 0; mark < 8; mark += 1) {
    const x = Math.floor(hash(mark, 4, seed + 2) * 13);
    const y = Math.floor(hash(mark, 8, seed + 3) * 15);
    context.fillRect(sideX + x, sideY + y, 2 + (mark % 3), 1);
  }
}

function paintLeafVariant(context: PixelContext, tile: TileId, palette: Palette, seed: number, needles = false): void {
  const [originX, originY] = tileOrigin(tile);
  for (let y = 0; y < TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const value = hash(x, y, seed);
      const gap = needles ? (x + y * 2) % 7 === 0 : value < 0.1;
      const color = gap ? "rgba(0,0,0,0)" : palette[Math.floor(value * palette.length) % palette.length];
      paintPixel(context, originX, originY, x, y, color);
    }
  }
  context.fillStyle = palette[0];
  if (needles) {
    for (let y = 2; y < TILE_SIZE; y += 4) context.fillRect(originX + 1, originY + y, 14, 1);
  } else {
    context.fillRect(originX + 4, originY + 2, 1, 11);
    context.fillRect(originX + 10, originY + 5, 1, 8);
  }
}

function paintBoards(context: PixelContext, tile: TileId, palette: Palette, seam: string, seed: number): void {
  noiseTile(context, tile, palette, seed);
  const [originX, originY] = tileOrigin(tile);
  for (let y = 3; y < TILE_SIZE; y += 4) {
    context.fillStyle = seam;
    context.fillRect(originX, originY + y, TILE_SIZE, 1);
  }
  for (let row = 0; row < 4; row += 1) {
    const x = (row * 5 + 3) % 15;
    context.fillRect(originX + x, originY + row * 4, 1, 4);
  }
}

function paintMasonry(context: PixelContext, tile: TileId, palette: Palette, mortar: string, seed: number): void {
  noiseTile(context, tile, palette, seed);
  const [originX, originY] = tileOrigin(tile);
  context.fillStyle = mortar;
  for (let y = 3; y < TILE_SIZE; y += 4) context.fillRect(originX, originY + y, TILE_SIZE, 1);
  for (let row = 0; row < 4; row += 1) {
    const offset = row % 2 === 0 ? 4 : 8;
    context.fillRect(originX + offset, originY + row * 4, 1, 4);
    if (offset + 8 < TILE_SIZE) context.fillRect(originX + offset + 8, originY + row * 4, 1, 4);
  }
}

function paintMetalPanel(context: PixelContext, tile: TileId, palette: Palette, seam: string, seed: number): void {
  noiseTile(context, tile, palette, seed);
  const [originX, originY] = tileOrigin(tile);
  context.strokeStyle = seam;
  context.strokeRect(originX + 0.5, originY + 0.5, 15, 15);
  context.strokeRect(originX + 3.5, originY + 3.5, 9, 9);
  context.fillStyle = "rgba(255,255,255,.25)";
  context.fillRect(originX + 3, originY + 2, 8, 1);
  context.fillRect(originX + 2, originY + 3, 1, 7);
}

function paintBookshelf(context: PixelContext): void {
  const tile = TileId.Bookshelf;
  const [originX, originY] = tileOrigin(tile);
  context.fillStyle = "#765034";
  context.fillRect(originX, originY, TILE_SIZE, TILE_SIZE);
  const books = ["#b54c43", "#d4a64f", "#4d7f74", "#657ab1", "#875b91", "#c36b45"] as const;
  for (let shelf = 0; shelf < 2; shelf += 1) {
    const baseline = shelf * 8 + 6;
    let x = 1;
    while (x < 15) {
      const width = 1 + Math.floor(hash(x, shelf, 301) * 3);
      const height = 4 + Math.floor(hash(x, shelf, 302) * 3);
      context.fillStyle = books[(x + shelf * 3) % books.length];
      context.fillRect(originX + x, originY + baseline - height, width, height);
      x += width + 1;
    }
    context.fillStyle = "#4f3426";
    context.fillRect(originX, originY + baseline + 1, TILE_SIZE, 2);
  }
}

function paintLamp(context: PixelContext): void {
  const [originX, originY] = tileOrigin(TileId.AmberLamp);
  context.fillStyle = "#4a2f20";
  context.fillRect(originX, originY, TILE_SIZE, TILE_SIZE);
  context.fillStyle = "#8f5b2d";
  context.fillRect(originX + 2, originY + 2, 12, 12);
  context.fillStyle = "#f3b84e";
  context.fillRect(originX + 4, originY + 4, 8, 8);
  context.fillStyle = "#fff0a3";
  context.fillRect(originX + 6, originY + 5, 4, 6);
  context.fillStyle = "#5c3923";
  context.fillRect(originX + 7, originY, 2, 4);
  context.fillRect(originX + 7, originY + 12, 2, 4);
  context.fillRect(originX, originY + 7, 4, 2);
  context.fillRect(originX + 12, originY + 7, 4, 2);
}

function paintGlassVariant(context: PixelContext, tile: TileId, fill: string, edge: string, seed: number): void {
  const [originX, originY] = tileOrigin(tile);
  context.fillStyle = fill;
  context.fillRect(originX, originY, TILE_SIZE, TILE_SIZE);
  context.strokeStyle = edge;
  context.strokeRect(originX + 0.5, originY + 0.5, 15, 15);
  context.fillStyle = edge;
  for (let mark = 0; mark < 6; mark += 1) {
    const x = 2 + Math.floor(hash(mark, 2, seed) * 11);
    const y = 2 + Math.floor(hash(mark, 5, seed + 1) * 11);
    context.fillRect(originX + x, originY + y, mark % 2 ? 1 : 3, 1);
  }
}

function paintCrystal(context: PixelContext): void {
  paintOre(context, TileId.CrystalOre, 331, ["#58d7d1", "#c9fff1"]);
  const [originX, originY] = tileOrigin(TileId.CrystalBlock);
  context.fillStyle = "#164b57";
  context.fillRect(originX, originY, TILE_SIZE, TILE_SIZE);
  for (let x = 0; x < TILE_SIZE; x += 1) {
    for (let y = 0; y < TILE_SIZE; y += 1) {
      const distance = Math.abs(x - 7.5) + Math.abs(y - 7.5);
      if (distance < 4 || (x + y) % 9 === 0) {
        paintPixel(context, originX, originY, x, y, distance < 2.5 ? "#e4fff2" : "#4ed4c7");
      }
    }
  }
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
  noiseTile(context, TileId.Gravel, ["#77756f", "#8a867d", "#62645f", "#a29a8c"], 141);
  paintVeinedStone(context, TileId.Limestone, ["#bbb8a5", "#cbc7b3", "#aaa895", "#d8d2bb"], "#929383", 142);
  paintVeinedStone(context, TileId.Marble, ["#d8d9d5", "#ecece4", "#c4c9c7", "#f5f3e8"], "#8d9aa1", 143);
  paintOre(context, TileId.GoldOre, 144, ["#e4b849", "#ffdc66"]);
  paintLogVariant(context, TileId.BirchLogTop, TileId.BirchLogSide, ["#e5d3a4", "#d3bd8c", "#f1dfb4"], ["#d8d4bd", "#eee9d2", "#c9c5ad"], "#9b8055", "#443d35", 151);
  paintLeafVariant(context, TileId.BirchLeaves, ["#355f38", "#4f7b45", "#6b934f", "#2d5235"], 153);
  paintBoards(context, TileId.BirchPlanks, ["#d4b878", "#e2c98c", "#c5a666", "#efd69b"], "#9f8050", 154);
  paintMasonry(context, TileId.StoneBricks, ["#697278", "#788087", "#5f686e"], "#3f484e", 161);
  paintMasonry(context, TileId.MossyCobblestone, ["#626b65", "#727c70", "#555f59"], "#3f4a43", 162);
  {
    const [x, y] = tileOrigin(TileId.MossyCobblestone);
    context.fillStyle = "#4f7042";
    context.fillRect(x + 1, y + 1, 6, 2);
    context.fillRect(x + 10, y + 5, 4, 3);
    context.fillRect(x + 4, y + 12, 7, 2);
  }
  paintMetalPanel(context, TileId.PolishedBasalt, ["#30343b", "#40454c", "#252a31"], "#646a70", 163);
  paintMetalPanel(context, TileId.CutCopper, ["#a95d3f", "#bd704b", "#8f4d38", "#5d8e75"], "#6f3f32", 164);
  noiseTile(context, TileId.Terracotta, ["#a75f48", "#b96b50", "#914f3d", "#c47a5c"], 165);
  paintBookshelf(context);
  paintLamp(context);
  paintGlassVariant(context, TileId.Ice, "rgba(167,220,229,.35)", "rgba(226,252,250,.86)", 171);
  paintGlassVariant(context, TileId.TintedGlass, "rgba(39,54,72,.58)", "rgba(119,153,172,.72)", 173);
  noiseTile(context, TileId.SandstoneTop, ["#d5be78", "#e2cb86", "#c7ad69", "#efd998"], 181);
  noiseTile(context, TileId.SandstoneSide, ["#d2ba76", "#dec582", "#c6aa67"], 182);
  {
    const [x, y] = tileOrigin(TileId.SandstoneSide);
    context.fillStyle = "#b99c5d";
    for (let row = 3; row < TILE_SIZE; row += 4) context.fillRect(x, y + row, TILE_SIZE, 1);
  }
  paintMetalPanel(context, TileId.CoalBlock, ["#202429", "#2c3136", "#171b1f"], "#444a50", 191);
  paintMetalPanel(context, TileId.IronBlock, ["#aeb5b7", "#c4c9c7", "#919a9e"], "#737d82", 192);
  paintMetalPanel(context, TileId.CopperBlock, ["#a85f43", "#c37451", "#8f4f3a"], "#6f4033", 193);
  paintMetalPanel(context, TileId.GoldBlock, ["#d5a72e", "#efc64d", "#bd8e22"], "#8b671d", 194);
  paintCrystal(context);
  paintLogVariant(context, TileId.SpruceLogTop, TileId.SpruceLogSide, ["#8b6740", "#a27a49", "#785733"], ["#493a2d", "#594432", "#3e332a"], "#5d422a", "#2b261f", 201);
  paintLeafVariant(context, TileId.SpruceLeaves, ["#1f4b3b", "#2b5d47", "#376b4e", "#183d33"], 203, true);
  paintBoards(context, TileId.SprucePlanks, ["#6d5238", "#7c5d3e", "#5e4733", "#886746"], "#493629", 204);
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
