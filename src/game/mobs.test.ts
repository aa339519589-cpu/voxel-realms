import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { MobManager } from "./mobs";

describe("hostile mob range", () => {
  it("does not damage the player from its night spawn distance", () => {
    let damage = 0;
    const manager = new MobManager(new THREE.Scene(), () => 0, (amount) => { damage += amount; });
    manager.update(1 / 60, 0, new THREE.Vector3(0, 0, 0), 1);
    expect(damage).toBe(0);
    manager.dispose();
  });
});
