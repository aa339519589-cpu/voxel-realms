import { describe, expect, it } from "vitest";
import { BlockId, getBlock } from "./blocks";
import { CRAFTING_RECIPES } from "./recipes";

describe("crafting recipes", () => {
  it("uses unique ids and valid positive block stacks", () => {
    expect(new Set(CRAFTING_RECIPES.map((recipe) => recipe.id)).size).toBe(CRAFTING_RECIPES.length);
    for (const recipe of CRAFTING_RECIPES) {
      expect(recipe.ingredients.length).toBeGreaterThan(0);
      expect(recipe.output.count).toBeGreaterThan(0);
      expect(recipe.output.block).not.toBe(BlockId.Air);
      expect(getBlock(recipe.output.block).id).toBe(recipe.output.block);
      for (const ingredient of recipe.ingredients) {
        expect(ingredient.count).toBeGreaterThan(0);
        expect(ingredient.block).not.toBe(BlockId.Air);
        expect(getBlock(ingredient.block).id).toBe(ingredient.block);
      }
    }
  });

  it("gives the major new material families a survival recipe", () => {
    const outputs = new Set(CRAFTING_RECIPES.map((recipe) => recipe.output.block));
    [
      BlockId.BirchPlanks,
      BlockId.SprucePlanks,
      BlockId.StoneBricks,
      BlockId.TintedGlass,
      BlockId.AmberLamp,
      BlockId.CoalBlock,
      BlockId.IronBlock,
      BlockId.CopperBlock,
      BlockId.GoldBlock,
      BlockId.CrystalBlock,
    ].forEach((block) => expect(outputs.has(block)).toBe(true));
  });
});
