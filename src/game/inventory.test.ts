import { describe, expect, it } from "vitest";
import { BlockId } from "./blocks";
import { addBlock, countBlock, craftIntoHotbar, selectSurvivalBlock } from "./inventory";
import { CRAFTING_RECIPES } from "./recipes";
import type { HotbarSlot } from "./types";

function hotbar(...slots: Array<[BlockId, number]>): HotbarSlot[] {
  return slots.map(([block, count]) => ({ block, count }));
}

describe("survival inventory", () => {
  it("swaps complete stacks when selecting an existing block", () => {
    const slots = hotbar([BlockId.Dirt, 12], [BlockId.Stone, 4], [BlockId.Grass, 0]);
    expect(selectSurvivalBlock(slots, 0, BlockId.Stone)).toBe(true);
    expect(slots).toEqual(hotbar([BlockId.Stone, 4], [BlockId.Dirt, 12], [BlockId.Grass, 0]));
  });

  it("never creates a block that is absent", () => {
    const slots = hotbar([BlockId.Dirt, 12], [BlockId.Grass, 0]);
    expect(selectSurvivalBlock(slots, 0, BlockId.Glow)).toBe(false);
    expect(countBlock(slots, BlockId.Glow)).toBe(0);
    expect(countBlock(slots, BlockId.Dirt)).toBe(12);
  });

  it("fills matching stacks before an empty slot", () => {
    const slots = hotbar([BlockId.Stone, 998], [BlockId.Dirt, 0]);
    expect(addBlock(slots, BlockId.Stone, 3)).toBe(0);
    expect(slots).toEqual(hotbar([BlockId.Stone, 999], [BlockId.Stone, 2]));
  });

  it("crafts atomically and uses a slot emptied by ingredients", () => {
    const recipe = CRAFTING_RECIPES.find((item) => item.id === "cobblestone")!;
    const slots = hotbar([BlockId.Stone, 2], [BlockId.Dirt, 9]);
    expect(craftIntoHotbar(slots, recipe)).toBe(true);
    expect(slots).toEqual(hotbar([BlockId.Cobblestone, 2], [BlockId.Dirt, 9]));
  });

  it("does not consume ingredients when the output cannot fit", () => {
    const recipe = CRAFTING_RECIPES.find((item) => item.id === "cobblestone")!;
    const slots = hotbar([BlockId.Stone, 3], [BlockId.Dirt, 999]);
    const before = slots.map((slot) => ({ ...slot }));
    expect(craftIntoHotbar(slots, recipe)).toBe(false);
    expect(slots).toEqual(before);
  });
});
