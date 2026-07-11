import { BlockId, HOTBAR_BLOCKS } from "./blocks";
import type { CraftingRecipe } from "./recipes";
import type { GameMode, HotbarSlot } from "./types";

const MAX_STACK = 999;
export const BACKPACK_SIZE = 27;
const SURVIVAL_START_COUNTS = [12, 24, 12, 4, 8, 0, 0, 0, 0] as const;

export function createDefaultHotbar(mode: GameMode): HotbarSlot[] {
  return HOTBAR_BLOCKS.map((block, index) => ({
    block,
    count: mode === "creative" ? -1 : SURVIVAL_START_COUNTS[index] ?? 0,
  }));
}

export function createEmptyBackpack(): HotbarSlot[] {
  return Array.from({ length: BACKPACK_SIZE }, () => ({ block: BlockId.Air, count: 0 }));
}

function copyInto(target: HotbarSlot[], source: HotbarSlot[]): void {
  source.forEach((slot, index) => {
    target[index].block = slot.block;
    target[index].count = slot.count;
  });
}

export function countBlock(hotbar: readonly HotbarSlot[], block: BlockId): number {
  return hotbar.reduce((total, slot) => total + (slot.block === block ? Math.max(0, slot.count) : 0), 0);
}

export function countInventoryBlock(hotbar: readonly HotbarSlot[], backpack: readonly HotbarSlot[], block: BlockId): number {
  return countBlock(hotbar, block) + countBlock(backpack, block);
}

function addAcross(slots: HotbarSlot[], block: BlockId, count: number): number {
  if (block === BlockId.Air) return Math.max(0, Math.floor(count));
  let remaining = Math.max(0, Math.floor(count));
  for (const slot of slots) {
    if (slot.block !== block || slot.count < 0 || slot.count >= MAX_STACK) continue;
    const added = Math.min(remaining, MAX_STACK - slot.count);
    slot.count += added;
    remaining -= added;
    if (remaining === 0) return 0;
  }
  for (const slot of slots) {
    if (slot.count !== 0) continue;
    const added = Math.min(remaining, MAX_STACK);
    slot.block = block;
    slot.count = added;
    remaining -= added;
    if (remaining === 0) return 0;
  }
  return remaining;
}

export function addBlock(hotbar: HotbarSlot[], block: BlockId, count: number): number {
  return addAcross(hotbar, block, count);
}

export function addBlockToInventory(hotbar: HotbarSlot[], backpack: HotbarSlot[], block: BlockId, count: number): number {
  return addAcross([...hotbar, ...backpack], block, count);
}

export function selectSurvivalBlock(hotbar: HotbarSlot[], selectedSlot: number, block: BlockId): boolean {
  const current = hotbar[selectedSlot];
  if (!current) return false;
  if (current.block === block && current.count > 0) return true;
  const sourceIndex = hotbar.findIndex((slot, index) => index !== selectedSlot && slot.block === block && slot.count > 0);
  if (sourceIndex < 0) return false;
  const source = hotbar[sourceIndex];
  const previous = { ...current };
  current.block = source.block;
  current.count = source.count;
  source.block = previous.block;
  source.count = previous.count;
  return true;
}

export function selectSurvivalInventoryBlock(
  hotbar: HotbarSlot[],
  backpack: HotbarSlot[],
  selectedSlot: number,
  block: BlockId,
): boolean {
  const current = hotbar[selectedSlot];
  if (!current) return false;
  if (current.block === block && current.count > 0) return true;
  const source = [...hotbar.filter((_, index) => index !== selectedSlot), ...backpack]
    .find((slot) => slot.block === block && slot.count > 0);
  if (!source) return false;
  const previous = { ...current };
  current.block = source.block;
  current.count = source.count;
  source.block = previous.count > 0 ? previous.block : BlockId.Air;
  source.count = previous.count;
  return true;
}

function craftAcross(hotbar: HotbarSlot[], backpack: HotbarSlot[], recipe: CraftingRecipe): boolean {
  if (!recipe.ingredients.every((ingredient) => countInventoryBlock(hotbar, backpack, ingredient.block) >= ingredient.count)) return false;

  const hotbarCopy = hotbar.map((slot) => ({ ...slot }));
  const backpackCopy = backpack.map((slot) => ({ ...slot }));
  const combined = [...hotbarCopy, ...backpackCopy];
  for (const ingredient of recipe.ingredients) {
    let remaining = ingredient.count;
    for (const slot of combined) {
      if (slot.block !== ingredient.block || slot.count <= 0 || remaining === 0) continue;
      const used = Math.min(slot.count, remaining);
      slot.count -= used;
      remaining -= used;
      if (slot.count === 0) slot.block = BlockId.Air;
    }
  }
  if (addAcross(combined, recipe.output.block, recipe.output.count) !== 0) return false;
  copyInto(hotbar, hotbarCopy);
  copyInto(backpack, backpackCopy);
  return true;
}

export function craftIntoHotbar(hotbar: HotbarSlot[], recipe: CraftingRecipe): boolean {
  return craftAcross(hotbar, [], recipe);
}

export function craftIntoInventory(hotbar: HotbarSlot[], backpack: HotbarSlot[], recipe: CraftingRecipe): boolean {
  return craftAcross(hotbar, backpack, recipe);
}
