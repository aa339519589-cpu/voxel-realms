import * as THREE from "three";

type MobKind = "sheep" | "pig" | "zombie";

interface Mob {
  kind: MobKind;
  group: THREE.Group;
  legs: THREE.Mesh[];
  direction: THREE.Vector2;
  turnIn: number;
  phase: number;
  attackCooldown: number;
}

const materials = {
  wool: new THREE.MeshLambertMaterial({ color: 0xe7e2d0 }),
  face: new THREE.MeshLambertMaterial({ color: 0x31312c }),
  pink: new THREE.MeshLambertMaterial({ color: 0xd98e91 }),
  pinkDark: new THREE.MeshLambertMaterial({ color: 0x9d5e63 }),
  zombie: new THREE.MeshLambertMaterial({ color: 0x5e8f58 }),
  shirt: new THREE.MeshLambertMaterial({ color: 0x365d68 }),
  pants: new THREE.MeshLambertMaterial({ color: 0x384057 }),
};

function cube(width: number, height: number, depth: number, material: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeAnimal(kind: "sheep" | "pig"): Mob {
  const group = new THREE.Group();
  const bodyMaterial = kind === "sheep" ? materials.wool : materials.pink;
  const faceMaterial = kind === "sheep" ? materials.face : materials.pinkDark;
  const body = cube(1.15, 0.78, 1.55, bodyMaterial);
  body.position.y = 1.05;
  group.add(body);
  const head = cube(0.66, 0.68, 0.68, faceMaterial);
  head.position.set(0, 1.18, -1.02);
  group.add(head);
  const legs: THREE.Mesh[] = [];
  for (const x of [-0.39, 0.39]) {
    for (const z of [-0.48, 0.48]) {
      const leg = cube(0.23, 0.72, 0.23, faceMaterial);
      leg.position.set(x, 0.43, z);
      legs.push(leg);
      group.add(leg);
    }
  }
  return { kind, group, legs, direction: new THREE.Vector2(1, 0), turnIn: 2, phase: Math.random() * Math.PI * 2, attackCooldown: 0 };
}

function makeZombie(): Mob {
  const group = new THREE.Group();
  const torso = cube(0.7, 0.9, 0.38, materials.shirt);
  torso.position.y = 1.2;
  group.add(torso);
  const head = cube(0.62, 0.62, 0.62, materials.zombie);
  head.position.y = 1.98;
  group.add(head);
  const legs = [-0.2, 0.2].map((x) => {
    const leg = cube(0.28, 0.9, 0.3, materials.pants);
    leg.position.set(x, 0.45, 0);
    group.add(leg);
    return leg;
  });
  for (const x of [-0.48, 0.48]) {
    const arm = cube(0.22, 0.9, 0.22, materials.zombie);
    arm.position.set(x, 1.38, -0.3);
    arm.rotation.x = Math.PI / 2;
    group.add(arm);
  }
  return { kind: "zombie", group, legs, direction: new THREE.Vector2(1, 0), turnIn: 1, phase: 0, attackCooldown: 0 };
}

export class MobManager {
  private readonly mobs: Mob[] = [];
  private nightMob: Mob | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly surfaceHeight: (x: number, z: number) => number,
    private readonly onPlayerHit: (damage: number) => void,
  ) {}

  populate(centerX: number, centerZ: number): void {
    if (this.mobs.length) return;
    const placements: Array<[MobKind, number, number]> = [
      ["sheep", 7, 4],
      ["sheep", -9, 6],
      ["pig", 5, -10],
      ["pig", -12, -6],
    ];
    for (const [kind, offsetX, offsetZ] of placements) {
      const mob = makeAnimal(kind as "sheep" | "pig");
      const x = centerX + offsetX;
      const z = centerZ + offsetZ;
      mob.group.position.set(x, this.surfaceHeight(x, z) + 0.02, z);
      this.mobs.push(mob);
      this.scene.add(mob.group);
    }
  }

  update(delta: number, elapsed: number, player: THREE.Vector3, nightAmount: number): void {
    if (nightAmount > 0.65 && !this.nightMob) {
      this.nightMob = makeZombie();
      const angle = elapsed * 0.37;
      const x = player.x + Math.cos(angle) * 14;
      const z = player.z + Math.sin(angle) * 14;
      this.nightMob.group.position.set(x, this.surfaceHeight(x, z), z);
      this.mobs.push(this.nightMob);
      this.scene.add(this.nightMob.group);
    } else if (nightAmount < 0.25 && this.nightMob) {
      this.scene.remove(this.nightMob.group);
      const index = this.mobs.indexOf(this.nightMob);
      if (index >= 0) this.mobs.splice(index, 1);
      this.nightMob = null;
    }

    for (const mob of this.mobs) {
      mob.turnIn -= delta;
      mob.attackCooldown = Math.max(0, mob.attackCooldown - delta);
      const position = mob.group.position;
      const toPlayer = new THREE.Vector2(player.x - position.x, player.z - position.z);
      const distanceToPlayerSq = toPlayer.lengthSq();
      if (mob.kind === "zombie" && distanceToPlayerSq < 18 * 18) {
        mob.direction.copy(toPlayer.normalize());
      } else if (mob.turnIn <= 0) {
        const angle = Math.sin(elapsed * 0.23 + mob.phase * 3.1) * Math.PI * 2;
        mob.direction.set(Math.cos(angle), Math.sin(angle));
        mob.turnIn = 2.5 + Math.abs(Math.sin(mob.phase + elapsed)) * 4;
      }
      const speed = mob.kind === "zombie" ? 1.35 : 0.55;
      position.x += mob.direction.x * speed * delta;
      position.z += mob.direction.y * speed * delta;
      position.y = THREE.MathUtils.lerp(position.y, this.surfaceHeight(position.x, position.z), Math.min(1, delta * 8));
      mob.group.rotation.y = Math.atan2(mob.direction.x, mob.direction.y);
      mob.legs.forEach((leg, index) => { leg.rotation.x = Math.sin(elapsed * speed * 7 + index * Math.PI) * 0.38; });
      if (mob.kind === "zombie" && distanceToPlayerSq < 1.6 * 1.6 && mob.attackCooldown === 0) {
        this.onPlayerHit(2);
        mob.attackCooldown = 1.1;
      }
    }
  }

  dispose(): void {
    for (const mob of this.mobs) {
      this.scene.remove(mob.group);
      mob.group.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
    }
    this.mobs.length = 0;
    this.nightMob = null;
  }
}
