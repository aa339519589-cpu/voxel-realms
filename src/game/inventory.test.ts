import { describe, expect, it } from "vitest";
import { BlockId } from "./blocks";
import {
  addBlock,
  addBlockToInventory,
  countBlock,
  craftIntoHotbar,
  craftIntoInventory,
  createEmptyBackpack,
  selectSurvivalBlock,
  selectSurvivalInventoryBlock,
} from "./inventory";
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
    const recipe = CRAFTING_RECIPES.find((item) => item.id === "stone-bricks")!;
    const slots = hotbar([BlockId.Cobblestone, 4], [BlockId.Dirt, 9]);
    expect(craftIntoHotbar(slots, recipe)).toBe(true);
    expect(slots).toEqual(hotbar([BlockId.StoneBricks, 4], [BlockId.Dirt, 9]));
  });

  it("does not consume ingredients when the output cannot fit", () => {
    const recipe = CRAFTING_RECIPES.find((item) => item.id === "stone-bricks")!;
    const slots = hotbar([BlockId.Cobblestone, 5], [BlockId.Dirt, 999]);
    const before = slots.map((slot) => ({ ...slot }));
    expect(craftIntoHotbar(slots, recipe)).toBe(false);
    expect(slots).toEqual(before);
  });

  it("stores a tenth material in the backpack and equips it into the hotbar", () => {
    const slots = hotbar(
      [BlockId.Grass, 1], [BlockId.Dirt, 1], [BlockId.Stone, 1],
      [BlockId.Sand, 1], [BlockId.OakLog, 1], [BlockId.OakPlanks, 1],
      [BlockId.Brick, 1], [BlockId.Glass, 1], [BlockId.Glow, 1],
    );
    const backpack = createEmptyBackpack();
    expect(addBlockToInventory(slots, backpack, BlockId.GoldOre, 3)).toBe(0);
    expect(backpack[0]).toEqual({ block: BlockId.GoldOre, count: 3 });
    expect(selectSurvivalInventoryBlock(slots, backpack, 0, BlockId.GoldOre)).toBe(true);
    expect(slots[0]).toEqual({ block: BlockId.GoldOre, count: 3 });
    expect(backpack[0]).toEqual({ block: BlockId.Grass, count: 1 });
  });

  it("crafts atomically across hotbar and backpack stacks", () => {
    const recipe = CRAFTING_RECIPES.find((item) => item.id === "tinted-glass")!;
    const slots = hotbar([BlockId.Glass, 2], [BlockId.Dirt, 1]);
    const backpack = createEmptyBackpack();
    backpack[0] = { block: BlockId.Glass, count: 2 };
    backpack[1] = { block: BlockId.CoalOre, count: 1 };
    expect(craftIntoInventory(slots, backpack, recipe)).toBe(true);
    expect(countBlock([...slots, ...backpack], BlockId.Glass)).toBe(0);
    expect(countBlock([...slots, ...backpack], BlockId.CoalOre)).toBe(0);
    expect(countBlock([...slots, ...backpack], BlockId.TintedGlass)).toBe(4);
  });
});
