import * as THREE from "three";
import { audio } from "./audio";
import { ALL_BLOCKS, BlockId, getBlock } from "./blocks";
import {
  createAABB,
  createPlayerAABB,
  intersectsAABB,
  moveAABBWithVoxelCollisions,
  raycastVoxels,
  type VoxelRaycastHit,
} from "./math";
import { MobManager } from "./mobs";
import { CRAFTING_RECIPES } from "./recipes";
import { addBlock, craftIntoHotbar, createDefaultHotbar, selectSurvivalBlock } from "./inventory";
import { createTextureAtlas } from "./textures";
import {
  DEFAULT_SETTINGS,
  type EngineEvents,
  type EngineRuntimeSnapshot,
  type GameMode,
  type GameScreen,
  type GameSettings,
  type HotbarSlot,
  type HudState,
  type PlayerState,
  type Weather,
  type WorldConfig,
} from "./types";
import { VoxelWorld } from "./world";

interface ParticleBurst {
  group: THREE.Group;
  velocity: THREE.Vector3[];
  life: number;
  material: THREE.MeshLambertMaterial;
}

type MobileAction = "jump" | "break" | "place" | "sprint" | "crouch";

const FIXED_STEP = 1 / 60;
const EYE_HEIGHT = 1.62;
const REACH = 6;
const MAX_WORLD_COORDINATE = 1_000_000;

const blockColors: Partial<Record<BlockId, number>> = {
  [BlockId.Grass]: 0x5e8f43,
  [BlockId.Dirt]: 0x755139,
  [BlockId.Stone]: 0x6d747a,
  [BlockId.Sand]: 0xd9c783,
  [BlockId.OakLog]: 0x775039,
  [BlockId.OakLeaves]: 0x3f7547,
  [BlockId.CoalOre]: 0x34383c,
  [BlockId.IronOre]: 0xb18369,
  [BlockId.CopperOre]: 0xb16c4c,
  [BlockId.OakPlanks]: 0xa87945,
  [BlockId.Brick]: 0x9c5046,
  [BlockId.Glass]: 0xa8d7da,
  [BlockId.Snow]: 0xe8f1ef,
  [BlockId.Glow]: 0x8ee6bd,
  [BlockId.Cobblestone]: 0x687176,
  [BlockId.Clay]: 0x879aa6,
  [BlockId.Basalt]: 0x363b43,
  [BlockId.Cactus]: 0x3d8051,
};

function isCoarsePointer(): boolean {
  return window.matchMedia("(pointer: coarse)").matches;
}

function cloneHotbar(hotbar: HotbarSlot[]): HotbarSlot[] {
  return hotbar.map((slot) => ({ ...slot }));
}

function defaultPlayer(mode: GameMode): PlayerState {
  return {
    x: 0,
    y: 20,
    z: 0,
    yaw: 0,
    pitch: 0,
    health: 20,
    hunger: 20,
    oxygen: 20,
    selectedSlot: 0,
    hotbar: createDefaultHotbar(mode),
    mode,
    flying: mode === "creative",
  };
}

export class GameEngine {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(DEFAULT_SETTINGS.fov, 1, 0.05, 280);
  private readonly atlas = createTextureAtlas();
  private readonly hemisphere = new THREE.HemisphereLight(0xc9e4ff, 0x364027, 1);
  private readonly sunlight = new THREE.DirectionalLight(0xfff2d0, 1.2);
  private readonly sun = new THREE.Mesh(new THREE.SphereGeometry(4, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffed9d }));
  private readonly moon = new THREE.Mesh(new THREE.SphereGeometry(2.8, 10, 8), new THREE.MeshBasicMaterial({ color: 0xdbe6f4 }));
  private readonly stars: THREE.Points;
  private readonly clouds = new THREE.Group();
  private readonly rain: THREE.Points;
  private readonly selection: THREE.LineSegments;
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly mobileMove = new THREE.Vector2();
  private readonly mobileActions = new Set<MobileAction>();
  private readonly particles: ParticleBurst[] = [];
  private readonly skyDay = new THREE.Color(0x79add1);
  private readonly skyNight = new THREE.Color(0x07111f);
  private readonly skyDusk = new THREE.Color(0xc98262);
  private world: VoxelWorld | null = null;
  private mobs: MobManager | null = null;
  private config: WorldConfig | null = null;
  private player: PlayerState = defaultPlayer("survival");
  private settings: GameSettings = { ...DEFAULT_SETTINGS };
  private screen: GameScreen = "loading";
  private target: VoxelRaycastHit | null = null;
  private targetBlock = BlockId.Air;
  private breaking = false;
  private breakKey = "";
  private breakProgress = 0;
  private breakSoundTimer = 0;
  private onGround = false;
  private airbornePeak = 0;
  private hungerDistance = 0;
  private damageCooldown = 0;
  private stepDistance = 0;
  private bobTime = 0;
  private timeOfDay = 0.24;
  private weather: Weather = "clear";
  private weatherTimer = 75;
  private elapsed = 0;
  private accumulator = 0;
  private lastFrame = performance.now();
  private frameCount = 0;
  private fps = 60;
  private fpsTimer = 0;
  private hudTimer = 0;
  private saveTimer = 0;
  private dirty = false;
  private message = "";
  private messageTimer = 0;
  private lastSpaceAt = 0;
  private animationFrame = 0;
  private disposed = false;
  private nightAmount = 0;
  private survivalHotbar: HotbarSlot[] | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: EngineEvents,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.canvas = this.renderer.domElement;
    this.canvas.className = "game-canvas";
    this.canvas.tabIndex = 0;
    this.host.appendChild(this.canvas);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.scene.background = this.skyDay.clone();
    this.scene.fog = new THREE.Fog(this.skyDay.getHex(), 30, 92);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.hemisphere, this.sunlight, this.sun, this.moon);
    this.sunlight.castShadow = true;
    this.sunlight.shadow.mapSize.set(1024, 1024);
    this.sunlight.shadow.camera.left = -26;
    this.sunlight.shadow.camera.right = 26;
    this.sunlight.shadow.camera.top = 26;
    this.sunlight.shadow.camera.bottom = -26;
    this.sunlight.shadow.camera.near = 1;
    this.sunlight.shadow.camera.far = 95;
    this.sunlight.target.position.set(0, 0, 0);
    this.scene.add(this.sunlight.target);
    this.stars = this.createStars();
    this.rain = this.createRain();
    this.selection = this.createSelection();
    this.scene.add(this.stars, this.clouds, this.rain, this.selection);
    this.createClouds();
    this.bindEvents();
    this.resize();
    this.applySettings(DEFAULT_SETTINGS);
    this.animationFrame = requestAnimationFrame(this.loop);
  }

  private createStars(): THREE.Points {
    const positions = new Float32Array(900 * 3);
    for (let index = 0; index < 900; index += 1) {
      const phi = Math.acos(2 * ((index * 0.61803398875) % 1) - 1);
      const theta = index * 2.399963;
      const radius = 170;
      positions[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      positions[index * 3 + 1] = Math.abs(Math.cos(phi)) * radius + 15;
      positions[index * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xdde8ff, size: 0.75, sizeAttenuation: true, transparent: true, opacity: 0 }));
  }

  private createRain(): THREE.Points {
    const positions = new Float32Array(850 * 3);
    for (let index = 0; index < 850; index += 1) {
      positions[index * 3] = (Math.random() - 0.5) * 54;
      positions[index * 3 + 1] = Math.random() * 32;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 54;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0x8cc9e8, size: 0.095, transparent: true, opacity: 0.62, depthWrite: false }));
  }

  private createSelection(): THREE.LineSegments {
    const geometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.012, 1.012, 1.012));
    const material = new THREE.LineBasicMaterial({ color: 0xf4f5ec, transparent: true, opacity: 0.88, depthTest: false });
    const lines = new THREE.LineSegments(geometry, material);
    lines.renderOrder = 10;
    lines.visible = false;
    return lines;
  }

  private createClouds(): void {
    const material = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.74, depthWrite: false });
    for (let index = 0; index < 14; index += 1) {
      const cloud = new THREE.Group();
      const pieces = 3 + (index % 4);
      for (let piece = 0; piece < pieces; piece += 1) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(5 + (piece % 2) * 3, 1.1, 2.8 + (piece % 3)), material);
        mesh.position.set(piece * 3.2, Math.sin(piece * 2) * 0.35, (piece % 2) * 1.8);
        cloud.add(mesh);
      }
      cloud.position.set((index % 5) * 30 - 60, 31 + (index % 3) * 2, Math.floor(index / 5) * 35 - 45);
      cloud.scale.setScalar(0.8 + (index % 3) * 0.18);
      this.clouds.add(cloud);
    }
  }

  private bindEvents(): void {
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.keyDown, { passive: false });
    window.addEventListener("keyup", this.keyUp);
    document.addEventListener("pointerlockchange", this.pointerLockChange);
    document.addEventListener("visibilitychange", this.visibilityChange);
    window.addEventListener("pagehide", this.pageHide);
    this.canvas.addEventListener("mousemove", this.mouseMove);
    this.canvas.addEventListener("mousedown", this.mouseDown);
    window.addEventListener("mouseup", this.mouseUp);
    this.canvas.addEventListener("wheel", this.wheel, { passive: false });
    this.canvas.addEventListener("contextmenu", this.contextMenu);
    this.canvas.addEventListener("click", this.canvasClick);
  }

  private readonly contextMenu = (event: Event) => event.preventDefault();

  private readonly canvasClick = () => {
    void audio.unlock();
    if (this.screen === "playing") this.requestPointerLock();
  };

  private requestPointerLock(): void {
    if (isCoarsePointer() || document.pointerLockElement === this.canvas) return;
    try {
      void Promise.resolve(this.canvas.requestPointerLock()).catch(() => {
        if (this.screen === "playing") this.showMessage("点击画面以控制视角");
      });
    } catch {
      if (this.screen === "playing") this.showMessage("点击画面以控制视角");
    }
  }

  private resetInput(): void {
    this.keys.clear();
    this.mobileActions.clear();
    this.mobileMove.set(0, 0);
    this.breaking = false;
    this.breakProgress = 0;
    this.breakKey = "";
  }

  private readonly pointerLockChange = () => {
    if (!isCoarsePointer() && this.screen === "playing" && document.pointerLockElement !== this.canvas) this.pause();
  };

  private readonly visibilityChange = () => {
    if (document.hidden && this.screen === "playing") this.pause();
  };

  private readonly pageHide = () => {
    if (this.config) this.events.onSave(this.snapshot());
  };

  private readonly resize = () => {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const pixelRatio = window.devicePixelRatio || 1;
    const cap = isCoarsePointer() ? 1.25 : this.settings.quality === "high" ? 1.65 : this.settings.quality === "medium" ? 1.35 : 1;
    this.renderer.setPixelRatio(Math.min(pixelRatio, cap));
    this.renderer.setSize(width, height, false);
  };

  private readonly keyDown = (event: KeyboardEvent) => {
    if (["Space", "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown"].includes(event.code) && this.screen === "playing") event.preventDefault();
    if (event.repeat && ["KeyE", "F3", "KeyQ"].includes(event.code)) return;
    if (event.code === "Escape" && this.screen === "inventory") {
      this.resume();
      return;
    }
    if (event.code === "KeyE" && (this.screen === "playing" || this.screen === "inventory")) {
      if (this.screen === "playing") this.openInventory();
      else this.resume();
      return;
    }
    if (event.code === "F3") {
      event.preventDefault();
      this.events.onToggleDebug();
      return;
    }
    if (this.screen !== "playing") return;
    if (/^Digit[1-9]$/.test(event.code)) this.selectSlot(Number(event.code.at(-1)) - 1);
    if (event.code === "KeyQ") this.dropSelected();
    if (event.code === "Space" && !event.repeat && this.player.mode === "creative") {
      const now = performance.now();
      if (now - this.lastSpaceAt < 310) {
        this.player.flying = !this.player.flying;
        this.velocity.y = 0;
        this.showMessage(this.player.flying ? "飞行已开启" : "飞行已关闭");
      }
      this.lastSpaceAt = now;
    }
    this.keys.add(event.code);
  };

  private readonly keyUp = (event: KeyboardEvent) => {
    this.keys.delete(event.code);
  };

  private readonly mouseMove = (event: MouseEvent) => {
    if (this.screen !== "playing" || document.pointerLockElement !== this.canvas) return;
    const scale = this.settings.sensitivity * 0.0019;
    this.player.yaw -= event.movementX * scale;
    this.player.pitch -= event.movementY * scale;
    this.player.pitch = THREE.MathUtils.clamp(this.player.pitch, -Math.PI * 0.495, Math.PI * 0.495);
  };

  private readonly mouseDown = (event: MouseEvent) => {
    if (this.screen !== "playing") return;
    void audio.unlock();
    if (!isCoarsePointer() && document.pointerLockElement !== this.canvas) {
      this.requestPointerLock();
      return;
    }
    if (event.button === 0) {
      this.breaking = true;
      if (this.player.mode === "creative") this.breakTarget();
    }
    if (event.button === 2) this.placeSelected();
  };

  private readonly mouseUp = (event: MouseEvent) => {
    if (event.button === 0) {
      this.breaking = false;
      this.breakProgress = 0;
      this.breakKey = "";
    }
  };

  private readonly wheel = (event: WheelEvent) => {
    if (this.screen !== "playing") return;
    event.preventDefault();
    this.selectSlot((this.player.selectedSlot + (event.deltaY > 0 ? 1 : -1) + 9) % 9);
  };

  async loadWorld(config: WorldConfig, saved?: EngineRuntimeSnapshot | null, enterAfterLoad = false): Promise<boolean> {
    try {
      this.setScreen("loading");
      this.resetInput();
      this.events.onLoading(0.02, "初始化世界");
      this.world?.dispose();
      this.mobs?.dispose();
      this.world = null;
      this.mobs = null;
      this.config = { ...config };
      this.player = saved ? {
        ...saved.player,
        hotbar: cloneHotbar(saved.player.hotbar),
        survivalHotbar: saved.player.survivalHotbar ? cloneHotbar(saved.player.survivalHotbar) : undefined,
      } : defaultPlayer(config.mode);
      this.player.mode = config.mode;
      this.survivalHotbar = this.player.survivalHotbar ? cloneHotbar(this.player.survivalHotbar) : null;
      this.timeOfDay = saved?.timeOfDay ?? 0.24;
      this.weather = saved?.weather ?? "clear";
      this.world = new VoxelWorld(this.scene, config.seed, this.atlas, () => { this.dirty = true; });
      this.world.setRenderDistance(this.settings.renderDistance);
      this.world.applyPatches(saved?.patches);
      if (!saved) {
        const spawn = this.findSafeSpawn();
        this.player.x = spawn.x;
        this.player.y = spawn.y;
        this.player.z = spawn.z;
      }
      this.velocity.set(0, 0, 0);
      this.positionCamera();
      await this.world.warmStart(this.player.x, this.player.z, (progress) => this.events.onLoading(0.08 + progress * 0.84, progress < 0.5 ? "生成地形" : "构建区块网格"));
      this.mobs = new MobManager(this.scene, (x, z) => (this.world?.surfaceHeight(x, z) ?? 0) + 0.01, (damage) => this.damage(damage, "黑暗中的生物"));
      this.mobs.populate(this.player.x, this.player.z);
      this.events.onLoading(1, "世界就绪");
      this.dirty = false;
      this.saveTimer = 0;
      this.setScreen(enterAfterLoad ? "playing" : "menu");
      if (enterAfterLoad) this.resume();
      else this.updateHud(true);
      return true;
    } catch (error) {
      this.world?.dispose();
      this.mobs?.dispose();
      this.world = null;
      this.mobs = null;
      this.events.onError(error instanceof Error ? error.message : "世界加载失败");
      this.setScreen("menu");
      return false;
    }
  }

  enterGame(): void {
    this.resume();
  }

  resume(): void {
    if (!this.world) return;
    this.resetInput();
    this.setScreen("playing");
    void audio.unlock().then(() => audio.startAmbient());
    this.requestPointerLock();
  }

  pause(): void {
    if (this.screen !== "playing") return;
    this.resetInput();
    this.setScreen("paused");
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (this.config) this.events.onSave(this.snapshot());
  }

  returnToMenu(): void {
    this.resetInput();
    this.setScreen("menu");
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    if (this.config) this.events.onSave(this.snapshot());
  }

  openInventory(): void {
    if (this.screen !== "playing") return;
    this.resetInput();
    this.setScreen("inventory");
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    audio.play("ui");
  }

  openSettings(): void {
    if (this.screen === "playing") this.pause();
    this.setScreen("settings");
  }

  setScreenFromUI(screen: GameScreen): void {
    this.setScreen(screen);
  }

  respawn(): void {
    if (!this.world) return;
    this.player.health = 20;
    this.player.hunger = 20;
    this.player.oxygen = 20;
    const spawn = this.findSafeSpawn();
    this.player.x = spawn.x;
    this.player.y = spawn.y;
    this.player.z = spawn.z;
    this.velocity.set(0, 0, 0);
    this.resume();
  }

  applySettings(settings: GameSettings): void {
    this.settings = { ...settings };
    this.camera.fov = settings.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.shadowMap.enabled = settings.quality === "high" && !isCoarsePointer();
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.world?.setRenderDistance(settings.renderDistance);
    audio.setVolume(settings.masterVolume);
    this.resize();
  }

  getSettings(): GameSettings {
    return { ...this.settings };
  }

  selectSlot(index: number): void {
    this.player.selectedSlot = Math.max(0, Math.min(8, Math.round(index)));
    this.showMessage(getBlock(this.player.hotbar[this.player.selectedSlot].block).name);
    audio.play("ui");
    this.updateHud(true);
  }

  assignSelectedBlock(block: BlockId): void {
    const slot = this.player.hotbar[this.player.selectedSlot];
    if (this.player.mode === "creative") {
      slot.block = block;
      slot.count = -1;
    } else if (!selectSurvivalBlock(this.player.hotbar, this.player.selectedSlot, block)) {
      this.showMessage("背包中没有该方块");
      return;
    }
    this.showMessage(getBlock(block).name);
    this.dirty = true;
    this.updateHud(true);
  }

  getInventory(): Array<{ block: BlockId; count: number; name: string }> {
    if (this.player.mode === "creative") return ALL_BLOCKS.filter((block) => block.id !== BlockId.Air).map((block) => ({ block: block.id, count: -1, name: block.name }));
    const counts = new Map<BlockId, number>();
    this.player.hotbar.forEach((slot) => counts.set(slot.block, (counts.get(slot.block) ?? 0) + Math.max(0, slot.count)));
    return Array.from(counts, ([block, count]) => ({ block, count, name: getBlock(block).name })).filter((item) => item.count > 0);
  }

  craftRecipe(recipeId: string): boolean {
    if (this.player.mode !== "survival") return false;
    const recipe = CRAFTING_RECIPES.find((item) => item.id === recipeId);
    if (!recipe) return false;
    if (!craftIntoHotbar(this.player.hotbar, recipe)) {
      this.showMessage("材料不足或快捷栏已满");
      audio.play("ui", "generic", { pitch: 0.65 });
      return false;
    }
    audio.play("pickup", recipe.output.block, { pitch: 1.12 });
    this.showMessage(`合成 ${recipe.name} ×${recipe.output.count}`);
    this.dirty = true;
    this.updateHud(true);
    return true;
  }

  snapshot(): EngineRuntimeSnapshot {
    return {
      player: {
        ...this.player,
        hotbar: cloneHotbar(this.player.hotbar),
        survivalHotbar: this.survivalHotbar ? cloneHotbar(this.survivalHotbar) : undefined,
      },
      patches: this.world?.patches ?? {},
      timeOfDay: this.timeOfDay,
      weather: this.weather,
    };
  }

  setMobileMove(x: number, y: number): void {
    this.mobileMove.set(THREE.MathUtils.clamp(x, -1, 1), THREE.MathUtils.clamp(y, -1, 1));
  }

  addMobileLook(deltaX: number, deltaY: number): void {
    if (this.screen !== "playing") return;
    const scale = this.settings.sensitivity * 0.0042;
    this.player.yaw -= deltaX * scale;
    this.player.pitch -= deltaY * scale;
    this.player.pitch = THREE.MathUtils.clamp(this.player.pitch, -Math.PI * 0.495, Math.PI * 0.495);
  }

  setMobileAction(action: MobileAction, active: boolean): void {
    if (active && this.screen !== "playing") return;
    if (active) this.mobileActions.add(action);
    else this.mobileActions.delete(action);
    if (action === "place" && active) this.placeSelected();
    if (action === "break") {
      this.breaking = active;
      if (!active) this.breakProgress = 0;
      else if (this.player.mode === "creative") this.breakTarget();
    }
  }

  setWeather(weather: Weather): void {
    this.weather = weather;
    this.weatherTimer = 90;
    this.showMessage(weather === "rain" ? "雨势渐起" : "天空转晴");
    this.dirty = true;
  }

  setTime(value: "day" | "night" | number): void {
    this.timeOfDay = typeof value === "number" ? ((value % 1) + 1) % 1 : value === "day" ? 0.25 : 0.76;
    this.dirty = true;
  }

  runCommand(raw: string): string {
    const [command, ...args] = raw.trim().replace(/^\//, "").split(/\s+/);
    if (command === "time" && (args[0] === "day" || args[0] === "night")) {
      this.setTime(args[0]);
      return `时间已设为${args[0] === "day" ? "白昼" : "夜晚"}`;
    }
    if (command === "weather" && (args[0] === "clear" || args[0] === "rain")) {
      this.setWeather(args[0]);
      return args[0] === "clear" ? "天气已转晴" : "天气已设为降雨";
    }
    if (command === "gamemode" && (args[0] === "creative" || args[0] === "survival")) {
      const nextMode = args[0];
      if (nextMode === "creative" && this.player.mode !== "creative") {
        this.survivalHotbar = cloneHotbar(this.player.hotbar);
        this.player.hotbar.forEach((slot) => { slot.count = -1; });
      } else if (nextMode === "survival" && this.player.mode !== "survival") {
        this.player.hotbar = cloneHotbar(this.survivalHotbar ?? createDefaultHotbar("survival"));
        this.survivalHotbar = null;
      }
      this.player.mode = nextMode;
      this.player.flying = nextMode === "creative";
      if (this.config) {
        this.config = { ...this.config, mode: nextMode };
        this.events.onConfigChange({ ...this.config });
      }
      this.dirty = true;
      this.updateHud(true);
      return nextMode === "creative" ? "已切换创造模式" : "已切换生存模式";
    }
    if (command === "tp" && args.length >= 3) {
      const values = args.slice(0, 3).map(Number);
      if (values.every(Number.isFinite)
        && Math.abs(values[0]) <= MAX_WORLD_COORDINATE
        && values[1] >= -64 && values[1] <= 512
        && Math.abs(values[2]) <= MAX_WORLD_COORDINATE) {
        [this.player.x, this.player.y, this.player.z] = values;
        this.velocity.set(0, 0, 0);
        return `已传送至 ${values.map((value) => Math.round(value)).join(" ")}`;
      }
      return "传送坐标无效或超出世界边界";
    }
    if (command === "seed") return `世界种子：${this.config?.seed ?? "未知"}`;
    return "命令无法识别";
  }

  private setScreen(screen: GameScreen): void {
    this.screen = screen;
    this.events.onScreen(screen);
  }

  private findSafeSpawn(preferredX = 2.5, preferredZ = 2.5): { x: number; y: number; z: number } {
    if (!this.world) return { x: preferredX, y: 24, z: preferredZ };
    const originX = Math.floor(preferredX);
    const originZ = Math.floor(preferredZ);
    for (let radius = 0; radius <= 16; radius += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        for (let dz = -radius; dz <= radius; dz += 1) {
          if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
          const x = originX + dx + 0.5;
          const z = originZ + dz + 0.5;
          const surface = this.world.surfaceHeight(x, z);
          const y = surface + 1.01;
          if (this.world.getBlock(x, y, z) !== BlockId.Air) continue;
          if (this.world.getBlock(x, y + 1, z) !== BlockId.Air) continue;
          if (!getBlock(this.world.getBlock(x, surface, z)).solid) continue;
          return { x, y, z };
        }
      }
    }
    return { x: preferredX, y: this.world.surfaceHeight(preferredX, preferredZ) + 2.01, z: preferredZ };
  }

  private showMessage(message: string): void {
    this.message = message;
    this.messageTimer = 2.2;
    this.events.onMessage(message);
  }

  private dropSelected(): void {
    const slot = this.player.hotbar[this.player.selectedSlot];
    if (slot.count > 0) {
      slot.count -= 1;
      this.showMessage(`丢弃 ${getBlock(slot.block).name}`);
      this.dirty = true;
      audio.play("ui");
      this.updateHud(true);
    }
  }

  private addToInventory(block: BlockId, count = 1, playSound = true): boolean {
    const remaining = addBlock(this.player.hotbar, block, count);
    if (remaining > 0) this.showMessage("快捷栏已满，方块未拾取");
    if (playSound) audio.play("pickup");
    return remaining === 0;
  }

  private breakTarget(): void {
    if (!this.world || !this.target) return;
    const { x, y, z } = this.target.voxel;
    const block = this.world.getBlock(x, y, z);
    if (block === BlockId.Air || block === BlockId.Water || y <= 0) return;
    this.world.setBlock(x, y, z, BlockId.Air);
    if (this.player.mode === "survival") this.addToInventory(block);
    this.spawnParticles(block, x + 0.5, y + 0.5, z + 0.5);
    audio.play("break", getBlock(block).name);
    this.breakProgress = 0;
    this.breakKey = "";
    this.target = null;
    this.selection.visible = false;
    this.dirty = true;
    this.updateHud(true);
  }

  private placeSelected(): void {
    if (!this.world || !this.target?.previousVoxel || this.screen !== "playing") return;
    const slot = this.player.hotbar[this.player.selectedSlot];
    if (slot.count === 0) {
      this.showMessage("该方块已用完");
      return;
    }
    const { x, y, z } = this.target.previousVoxel;
    if (this.world.getBlock(x, y, z) !== BlockId.Air && this.world.getBlock(x, y, z) !== BlockId.Water) return;
    const blockBox = createAABB({ x, y, z }, { x: x + 1, y: y + 1, z: z + 1 });
    const playerBox = createPlayerAABB(this.player);
    if (intersectsAABB(blockBox, playerBox) && getBlock(slot.block).solid) {
      this.showMessage("这里被占用");
      return;
    }
    this.world.setBlock(x, y, z, slot.block);
    if (slot.count > 0) slot.count -= 1;
    audio.play("place", getBlock(slot.block).name);
    this.spawnParticles(slot.block, x + 0.5, y + 0.5, z + 0.5, 5);
    this.dirty = true;
    this.updateHud(true);
  }

  private spawnParticles(block: BlockId, x: number, y: number, z: number, count = 12): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    const material = new THREE.MeshLambertMaterial({ color: blockColors[block] ?? 0x8a8175 });
    const velocity: THREE.Vector3[] = [];
    for (let index = 0; index < count; index += 1) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.09), material);
      mesh.position.set((Math.random() - 0.5) * 0.65, (Math.random() - 0.5) * 0.65, (Math.random() - 0.5) * 0.65);
      group.add(mesh);
      velocity.push(new THREE.Vector3((Math.random() - 0.5) * 2.7, Math.random() * 2.8 + 0.5, (Math.random() - 0.5) * 2.7));
    }
    this.scene.add(group);
    this.particles.push({ group, velocity, life: 0.72, material });
  }

  private updateParticles(delta: number): void {
    for (let burstIndex = this.particles.length - 1; burstIndex >= 0; burstIndex -= 1) {
      const burst = this.particles[burstIndex];
      burst.life -= delta;
      burst.group.children.forEach((child, index) => {
        const velocity = burst.velocity[index];
        velocity.y -= 9 * delta;
        child.position.addScaledVector(velocity, delta);
        child.rotation.x += delta * 7;
        child.rotation.y += delta * 5;
      });
      if (burst.life > 0) continue;
      this.scene.remove(burst.group);
      burst.group.children.forEach((child) => { if (child instanceof THREE.Mesh) child.geometry.dispose(); });
      burst.material.dispose();
      this.particles.splice(burstIndex, 1);
    }
  }

  private damage(amount: number, reason: string): void {
    if (this.player.mode === "creative" || this.damageCooldown > 0 || this.screen === "dead") return;
    this.player.health = Math.max(0, this.player.health - amount);
    this.damageCooldown = 0.55;
    audio.play("hurt");
    this.host.classList.remove("damage-flash");
    void this.host.offsetWidth;
    this.host.classList.add("damage-flash");
    this.showMessage(reason);
    if (this.player.health <= 0) {
      this.resetInput();
      this.setScreen("dead");
      if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    }
    this.dirty = true;
    this.updateHud(true);
  }

  private updateTarget(delta: number): void {
    if (!this.world || this.screen !== "playing") {
      this.selection.visible = false;
      return;
    }
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    this.target = raycastVoxels(this.camera.position, direction, REACH, (x, y, z) => {
      const block = this.world!.getBlock(x, y, z);
      return block !== BlockId.Air && block !== BlockId.Water;
    });
    if (!this.target) {
      this.selection.visible = false;
      this.targetBlock = BlockId.Air;
      this.breakProgress = 0;
      this.breakKey = "";
      return;
    }
    const { x, y, z } = this.target.voxel;
    this.targetBlock = this.world.getBlock(x, y, z);
    this.selection.visible = true;
    this.selection.position.set(x + 0.5, y + 0.5, z + 0.5);
    if (!this.breaking || this.player.mode === "creative") return;
    const key = `${x},${y},${z}`;
    if (key !== this.breakKey) {
      this.breakKey = key;
      this.breakProgress = 0;
    }
    const hardness = Math.max(0.1, getBlock(this.targetBlock).hardness);
    this.breakProgress += delta / (hardness * 0.42 + 0.16);
    this.breakSoundTimer -= delta;
    if (this.breakSoundTimer <= 0) {
      audio.play("break", getBlock(this.targetBlock).name, { volume: 0.15, pitch: 0.9 });
      this.breakSoundTimer = 0.15;
    }
    if (this.breakProgress >= 1) this.breakTarget();
  }

  private physicsStep(delta: number): void {
    if (!this.world || this.screen !== "playing") return;
    const beforeX = this.player.x;
    const beforeZ = this.player.z;
    const forwardInput = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0) - this.mobileMove.y;
    const sideInput = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0) + this.mobileMove.x;
    const inputLength = Math.hypot(forwardInput, sideInput);
    const normalizedForward = inputLength > 1 ? forwardInput / inputLength : forwardInput;
    const normalizedSide = inputLength > 1 ? sideInput / inputLength : sideInput;
    const sprinting = this.keys.has("ControlLeft") || this.keys.has("ControlRight") || this.mobileActions.has("sprint");
    const crouching = this.keys.has("ShiftLeft") || this.keys.has("ShiftRight") || this.mobileActions.has("crouch");
    const headBlock = this.world.getBlock(this.player.x, this.player.y + 1.5, this.player.z);
    const inWater = headBlock === BlockId.Water;
    const speed = crouching ? 2.1 : sprinting && this.player.hunger > 2 ? 6.1 : 4.35;
    const forwardX = -Math.sin(this.player.yaw);
    const forwardZ = -Math.cos(this.player.yaw);
    const rightX = Math.cos(this.player.yaw);
    const rightZ = -Math.sin(this.player.yaw);
    const targetX = (forwardX * normalizedForward + rightX * normalizedSide) * speed;
    const targetZ = (forwardZ * normalizedForward + rightZ * normalizedSide) * speed;
    const response = 1 - Math.exp(-(this.onGround ? 14 : inWater ? 4 : 3.4) * delta);
    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, targetX, response);
    this.velocity.z = THREE.MathUtils.lerp(this.velocity.z, targetZ, response);

    if (this.player.flying) {
      const up = (this.keys.has("Space") || this.mobileActions.has("jump") ? 1 : 0) - (crouching ? 1 : 0);
      this.velocity.y = THREE.MathUtils.lerp(this.velocity.y, up * 6.2, 1 - Math.exp(-12 * delta));
    } else {
      this.velocity.y = Math.max(-48, this.velocity.y - (inWater ? 7 : 27) * delta);
      const jumpPressed = this.keys.has("Space") || this.mobileActions.has("jump");
      if (jumpPressed && (this.onGround || inWater)) {
        this.velocity.y = inWater ? 4.1 : 8.4;
        this.onGround = false;
        this.airbornePeak = this.player.y;
        audio.play("jump");
      }
    }

    const box = createPlayerAABB(this.player);
    const result = moveAABBWithVoxelCollisions(box, {
      x: this.velocity.x * delta,
      y: this.velocity.y * delta,
      z: this.velocity.z * delta,
    }, (x, y, z) => this.world!.isSolid(x, y, z));
    this.player.x += result.movement.x;
    this.player.y += result.movement.y;
    this.player.z += result.movement.z;
    if (result.collided.x) this.velocity.x = 0;
    if (result.collided.z) this.velocity.z = 0;
    const wasGrounded = this.onGround;
    this.onGround = result.onGround;
    if (!this.onGround) this.airbornePeak = Math.max(this.airbornePeak, this.player.y);
    if (result.collided.y) {
      if (this.velocity.y < 0 && this.onGround && !wasGrounded) {
        const fall = this.airbornePeak - this.player.y;
        if (fall > 4.2) this.damage(Math.ceil((fall - 3.5) * 1.4), "坠落伤害");
      }
      this.velocity.y = 0;
    }
    if (this.player.y < -8) this.damage(20, "坠入虚空");

    const distance = Math.hypot(this.player.x - beforeX, this.player.z - beforeZ);
    if (inputLength > 0.1) {
      this.bobTime += distance * (sprinting ? 3.4 : 2.7);
      this.stepDistance += distance;
      if (this.stepDistance > (sprinting ? 1.8 : 2.35) && this.onGround) {
        this.stepDistance = 0;
        const under = this.world.getBlock(this.player.x, this.player.y - 0.1, this.player.z);
        audio.play("step", getBlock(under).name);
      }
      if (this.player.mode === "survival") {
        this.hungerDistance += distance * (sprinting ? 1.7 : 0.55);
        if (this.hungerDistance > 52) {
          this.hungerDistance = 0;
          this.player.hunger = Math.max(0, this.player.hunger - 1);
          this.dirty = true;
        }
      }
    }
    if (inWater) {
      this.player.oxygen = Math.max(0, this.player.oxygen - delta * 1.2);
      if (this.player.oxygen <= 0 && this.damageCooldown === 0) this.damage(1, "氧气耗尽");
    } else this.player.oxygen = Math.min(20, this.player.oxygen + delta * 5);
    if (this.player.hunger <= 0 && this.damageCooldown === 0) this.damage(1, "饥饿");
    if (this.player.hunger >= 18 && this.player.health < 20 && this.elapsed % 5 < delta) this.player.health = Math.min(20, this.player.health + 1);
    this.positionCamera(inputLength > 0.1 && this.onGround ? Math.sin(this.bobTime) * 0.035 : 0);
  }

  private positionCamera(bob = 0): void {
    this.camera.position.set(this.player.x, this.player.y + EYE_HEIGHT + bob, this.player.z);
    this.camera.rotation.y = this.player.yaw;
    this.camera.rotation.x = this.player.pitch + Math.cos(this.bobTime * 0.5) * Math.abs(bob) * 0.25;
  }

  private updateSky(delta: number): void {
    if (this.screen === "playing") this.timeOfDay = (this.timeOfDay + delta / 720) % 1;
    const angle = this.timeOfDay * Math.PI * 2;
    const daylight = THREE.MathUtils.clamp(Math.sin(angle) * 1.35 + 0.08, 0.04, 1);
    const dusk = Math.max(0, 1 - Math.abs(Math.sin(angle)) * 4) * (Math.cos(angle) < 0 ? 1 : 0);
    this.nightAmount = 1 - daylight;
    const sky = new THREE.Color().lerpColors(this.skyNight, this.skyDay, daylight).lerp(this.skyDusk, dusk * 0.48);
    this.scene.background = sky;
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.color.copy(sky);
      this.scene.fog.near = Math.max(17, this.settings.renderDistance * 8);
      this.scene.fog.far = this.settings.renderDistance * 16 + (this.weather === "rain" ? 16 : 34);
    }
    this.hemisphere.intensity = 0.17 + daylight * 0.88;
    this.sunlight.intensity = 0.08 + daylight * 1.35;
    this.sunlight.color.set(daylight < 0.35 ? 0xffa475 : 0xfff2d0);
    const radius = 82;
    this.sun.position.set(this.player.x + Math.cos(angle) * radius, Math.sin(angle) * radius, this.player.z + 18);
    this.moon.position.copy(this.sun.position).multiplyScalar(-1).add(new THREE.Vector3(this.player.x * 2, 0, this.player.z * 2));
    this.sun.visible = Math.sin(angle) > -0.1;
    this.moon.visible = Math.sin(angle) < 0.2;
    this.sunlight.position.copy(this.sun.position);
    this.sunlight.target.position.set(this.player.x, this.player.y, this.player.z);
    const starMaterial = this.stars.material as THREE.PointsMaterial;
    starMaterial.opacity = THREE.MathUtils.smoothstep(this.nightAmount, 0.35, 0.85);
    this.stars.position.set(this.player.x, 0, this.player.z);
    this.clouds.position.x += delta * (this.weather === "rain" ? 2.1 : 0.75);
    if (this.clouds.position.x > 60) this.clouds.position.x -= 120;
    this.clouds.children.forEach((cloud) => { cloud.position.y = 30 + daylight * 4 + (cloud.userData.offsetY ?? 0); });
  }

  private updateWeather(delta: number): void {
    if (this.screen === "playing") {
      this.weatherTimer -= delta;
      if (this.weatherTimer <= 0) {
        const rainChance = Math.sin(this.elapsed * 0.017 + (this.config?.seed.length ?? 0)) > 0.42;
        this.weather = rainChance ? "rain" : "clear";
        this.weatherTimer = rainChance ? 75 : 115;
        this.showMessage(rainChance ? "雨云正在靠近" : "天空正在放晴");
        this.dirty = true;
      }
    }
    this.rain.visible = this.weather === "rain";
    if (!this.rain.visible) return;
    const attribute = this.rain.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let index = 0; index < attribute.count; index += 1) {
      let y = attribute.getY(index) - delta * 24;
      if (y < 0) y += 32;
      attribute.setY(index, y);
    }
    attribute.needsUpdate = true;
    this.rain.position.set(this.player.x, this.player.y - 3, this.player.z);
  }

  private updateHud(force = false): void {
    if (!force && this.hudTimer > 0) return;
    this.hudTimer = 0.12;
    const targetName = this.targetBlock === BlockId.Air ? "" : getBlock(this.targetBlock).name;
    const hour = Math.floor((this.timeOfDay * 24 + 6) % 24);
    const timeLabel = hour >= 6 && hour < 18 ? `${String(hour).padStart(2, "0")}:00 日间` : `${String(hour).padStart(2, "0")}:00 夜间`;
    const hud: HudState = {
      fps: this.fps,
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      yaw: this.player.yaw,
      health: this.player.health,
      hunger: this.player.hunger,
      oxygen: this.player.oxygen,
      selectedSlot: this.player.selectedSlot,
      hotbar: cloneHotbar(this.player.hotbar),
      targetName,
      breakProgress: this.breakProgress,
      timeLabel,
      weather: this.weather,
      chunks: this.world?.loadedChunks ?? 0,
      seed: this.config?.seed ?? "",
      mode: this.player.mode,
      flying: this.player.flying,
      saving: this.dirty && this.saveTimer > 4.5,
      message: this.message,
    };
    this.events.onHud(hud);
  }

  private readonly loop = (now: number) => {
    if (this.disposed) return;
    const rawDelta = (now - this.lastFrame) / 1000;
    const delta = Math.min(0.05, Math.max(0, rawDelta));
    this.lastFrame = now;
    this.elapsed += delta;
    this.fpsTimer += delta;
    this.frameCount += 1;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.frameCount / this.fpsTimer);
      this.frameCount = 0;
      this.fpsTimer = 0;
    }
    this.hudTimer -= delta;
    this.damageCooldown = Math.max(0, this.damageCooldown - delta);
    this.messageTimer = Math.max(0, this.messageTimer - delta);
    if (this.messageTimer === 0) this.message = "";

    if (this.screen === "playing") {
      this.accumulator = Math.min(this.accumulator + delta, FIXED_STEP * 5);
      while (this.accumulator >= FIXED_STEP) {
        this.physicsStep(FIXED_STEP);
        this.accumulator -= FIXED_STEP;
      }
      this.world?.update(delta, this.player.x, this.player.z);
      this.mobs?.update(delta, this.elapsed, new THREE.Vector3(this.player.x, this.player.y, this.player.z), this.nightAmount);
      this.updateTarget(delta);
      this.saveTimer += delta;
      if (this.dirty && this.saveTimer >= 5) {
        this.saveTimer = 0;
        this.events.onSave(this.snapshot());
        this.dirty = false;
      }
    } else if (this.screen === "menu" && this.world) {
      const center = new THREE.Vector3(this.player.x, this.world.surfaceHeight(this.player.x, this.player.z) + 5, this.player.z);
      const radius = 11;
      this.camera.position.set(center.x + Math.cos(this.elapsed * 0.055) * radius, center.y + 2.5, center.z + Math.sin(this.elapsed * 0.055) * radius);
      this.camera.lookAt(center);
      this.world.update(delta, this.player.x, this.player.z);
    }

    this.updateSky(delta);
    this.updateWeather(delta);
    this.updateParticles(delta);
    this.updateHud();
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.loop);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    if (this.config) this.events.onSave(this.snapshot());
    audio.stopAmbient();
    this.world?.dispose();
    this.mobs?.dispose();
    this.atlas.dispose();
    this.selection.geometry.dispose();
    (this.selection.material as THREE.Material).dispose();
    this.stars.geometry.dispose();
    (this.stars.material as THREE.Material).dispose();
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
    this.clouds.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
    });
    this.renderer.dispose();
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.keyDown);
    window.removeEventListener("keyup", this.keyUp);
    document.removeEventListener("pointerlockchange", this.pointerLockChange);
    document.removeEventListener("visibilitychange", this.visibilityChange);
    window.removeEventListener("pagehide", this.pageHide);
    this.canvas.removeEventListener("mousemove", this.mouseMove);
    this.canvas.removeEventListener("mousedown", this.mouseDown);
    window.removeEventListener("mouseup", this.mouseUp);
    this.canvas.removeEventListener("wheel", this.wheel);
    this.canvas.removeEventListener("contextmenu", this.contextMenu);
    this.canvas.removeEventListener("click", this.canvasClick);
    this.canvas.remove();
  }
}
