import { BlockId, HOTBAR_BLOCKS } from "./blocks";
import type { CraftingRecipe } from "./recipes";
import type { GameMode, HotbarSlot } from "./types";

const MAX_STACK = 999;
const SURVIVAL_START_COUNTS = [16, 32, 24, 10, 24, 16, 12, 6, 3] as const;

export function createDefaultHotbar(mode: GameMode): HotbarSlot[] {
  return HOTBAR_BLOCKS.map((block, index) => ({
    block,
    count: mode === "creative" ? -1 : SURVIVAL_START_COUNTS[index] ?? 0,
  }));
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

export function addBlock(hotbar: HotbarSlot[], block: BlockId, count: number): number {
  let remaining = Math.max(0, Math.floor(count));
  for (const slot of hotbar) {
    if (slot.block !== block || slot.count < 0 || slot.count >= MAX_STACK) continue;
    const added = Math.min(remaining, MAX_STACK - slot.count);
    slot.count += added;
    remaining -= added;
    if (remaining === 0) return 0;
  }
  for (const slot of hotbar) {
    if (slot.count !== 0) continue;
    const added = Math.min(remaining, MAX_STACK);
    slot.block = block;
    slot.count = added;
    remaining -= added;
    if (remaining === 0) return 0;
  }
  return remaining;
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

export function craftIntoHotbar(hotbar: HotbarSlot[], recipe: CraftingRecipe): boolean {
  if (!recipe.ingredients.every((ingredient) => countBlock(hotbar, ingredient.block) >= ingredient.count)) return false;

  const next = hotbar.map((slot) => ({ ...slot }));
  for (const ingredient of recipe.ingredients) {
    let remaining = ingredient.count;
    for (const slot of next) {
      if (slot.block !== ingredient.block || slot.count <= 0 || remaining === 0) continue;
      const used = Math.min(slot.count, remaining);
      slot.count -= used;
      remaining -= used;
    }
  }
  if (addBlock(next, recipe.output.block, recipe.output.count) !== 0) return false;
  copyInto(hotbar, next);
  return true;
}
