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
  { id: "cobblestone", name: "Cobblestone", ingredients: [{ block: BlockId.Stone, count: 2 }], output: { block: BlockId.Cobblestone, count: 2 } },
  { id: "glass", name: "Glass", ingredients: [{ block: BlockId.Sand, count: 4 }], output: { block: BlockId.Glass, count: 2 } },
  { id: "brick", name: "Brick", ingredients: [{ block: BlockId.Clay, count: 4 }], output: { block: BlockId.Brick, count: 4 } },
  { id: "lumen", name: "Lumen Block", ingredients: [{ block: BlockId.CoalOre, count: 1 }, { block: BlockId.Glass, count: 2 }], output: { block: BlockId.Glow, count: 1 } },
];
