import { BlockId } from "./blocks";

export interface RecipeIngredient {
  block: BlockId;
  count: number;
}

export interface CraftingRecipe {
  id: string;
  name: string;
  ingredients: RecipeIngredient[];
  output: RecipeIngredient;
}

export const CRAFTING_RECIPES: readonly CraftingRecipe[] = [
  { id: "planks", name: "Oak Planks", ingredients: [{ block: BlockId.OakLog, count: 1 }], output: { block: BlockId.OakPlanks, count: 4 } },
  { id: "birch-planks", name: "Birch Planks", ingredients: [{ block: BlockId.BirchLog, count: 1 }], output: { block: BlockId.BirchPlanks, count: 4 } },
  { id: "spruce-planks", name: "Spruce Planks", ingredients: [{ block: BlockId.SpruceLog, count: 1 }], output: { block: BlockId.SprucePlanks, count: 4 } },
  { id: "sandstone", name: "Sandstone", ingredients: [{ block: BlockId.Sand, count: 4 }], output: { block: BlockId.Sandstone, count: 4 } },
  { id: "glass", name: "Glass", ingredients: [{ block: BlockId.Sand, count: 4 }], output: { block: BlockId.Glass, count: 2 } },
  { id: "brick", name: "Brick", ingredients: [{ block: BlockId.Clay, count: 4 }], output: { block: BlockId.Brick, count: 4 } },
  { id: "stone-bricks", name: "Stone Bricks", ingredients: [{ block: BlockId.Cobblestone, count: 4 }], output: { block: BlockId.StoneBricks, count: 4 } },
  { id: "mossy-cobblestone", name: "Mossy Cobblestone", ingredients: [{ block: BlockId.Cobblestone, count: 2 }, { block: BlockId.OakLeaves, count: 1 }], output: { block: BlockId.MossyCobblestone, count: 2 } },
  { id: "polished-basalt", name: "Polished Basalt", ingredients: [{ block: BlockId.Basalt, count: 4 }], output: { block: BlockId.PolishedBasalt, count: 4 } },
  { id: "terracotta", name: "Terracotta", ingredients: [{ block: BlockId.Clay, count: 4 }], output: { block: BlockId.Terracotta, count: 4 } },
  { id: "bookshelf", name: "Bookshelf", ingredients: [{ block: BlockId.OakPlanks, count: 4 }, { block: BlockId.BirchPlanks, count: 2 }], output: { block: BlockId.Bookshelf, count: 2 } },
  { id: "lumen", name: "Lumen Block", ingredients: [{ block: BlockId.CoalOre, count: 1 }, { block: BlockId.Glass, count: 2 }], output: { block: BlockId.Glow, count: 1 } },
  { id: "amber-lamp", name: "Amber Lamp", ingredients: [{ block: BlockId.GoldOre, count: 1 }, { block: BlockId.Glow, count: 1 }, { block: BlockId.Glass, count: 2 }], output: { block: BlockId.AmberLamp, count: 2 } },
  { id: "ice", name: "Ice", ingredients: [{ block: BlockId.Snow, count: 4 }], output: { block: BlockId.Ice, count: 2 } },
  { id: "tinted-glass", name: "Tinted Glass", ingredients: [{ block: BlockId.Glass, count: 4 }, { block: BlockId.CoalOre, count: 1 }], output: { block: BlockId.TintedGlass, count: 4 } },
  { id: "coal-block", name: "Coal Block", ingredients: [{ block: BlockId.CoalOre, count: 9 }], output: { block: BlockId.CoalBlock, count: 1 } },
  { id: "iron-block", name: "Iron Block", ingredients: [{ block: BlockId.IronOre, count: 9 }], output: { block: BlockId.IronBlock, count: 1 } },
  { id: "copper-block", name: "Copper Block", ingredients: [{ block: BlockId.CopperOre, count: 9 }], output: { block: BlockId.CopperBlock, count: 1 } },
  { id: "cut-copper", name: "Cut Copper", ingredients: [{ block: BlockId.CopperBlock, count: 4 }], output: { block: BlockId.CutCopper, count: 4 } },
  { id: "gold-block", name: "Gold Block", ingredients: [{ block: BlockId.GoldOre, count: 9 }], output: { block: BlockId.GoldBlock, count: 1 } },
  { id: "crystal-block", name: "Aether Crystal Block", ingredients: [{ block: BlockId.CrystalOre, count: 4 }], output: { block: BlockId.CrystalBlock, count: 1 } },
];
