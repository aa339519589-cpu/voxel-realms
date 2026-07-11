import {
  Archive,
  Box,
  Check,
  ChevronLeft,
  CloudRain,
  Command,
  Download,
  Gamepad2,
  Heart,
  Home,
  Layers3,
  Monitor,
  Moon,
  Pause,
  Pickaxe,
  Play,
  Plus,
  RefreshCcw,
  Save,
  Search,
  Send,
  Settings,
  Shield,
  Sun,
  Trash2,
  Upload,
  Volume2,
  Wind,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ALL_BLOCKS, BlockId, getBlock } from "./game/blocks";
import { GameEngine } from "./game/engine";
import { CRAFTING_RECIPES } from "./game/recipes";
import {
  WORLD_DATA_SCHEMA_VERSION,
  deleteWorld,
  exportWorld,
  importWorld,
  listWorlds,
  loadSettings,
  loadWorld,
  saveSettings,
  saveWorld,
  type WorldSave,
} from "./game/persistence";
import {
  DEFAULT_SETTINGS,
  type EngineRuntimeSnapshot,
  type GameMode,
  type GameScreen,
  type GameSettings,
  type HudState,
  type Weather,
  type WorldConfig,
} from "./game/types";

const emptyHud: HudState = {
  fps: 0,
  x: 0,
  y: 0,
  z: 0,
  yaw: 0,
  health: 20,
  hunger: 20,
  oxygen: 20,
  selectedSlot: 0,
  hotbar: [],
  targetName: "",
  breakProgress: 0,
  timeLabel: "06:00 日间",
  weather: "clear",
  chunks: 0,
  seed: "",
  mode: "survival",
  flying: false,
  saving: false,
  message: "",
};

function randomSeed(): string {
  const adjective = ["CEDAR", "EMBER", "MOSS", "RIVER", "AURORA", "STONE"][Math.floor(Math.random() * 6)];
  return `${adjective}-${Math.floor(100000 + Math.random() * 899999)}`;
}

function newWorldConfig(name: string, seed: string, mode: GameMode): WorldConfig {
  const now = Date.now();
  return { id: `world-${now.toString(36)}`, name: name.trim() || "新世界", seed: seed.trim() || randomSeed(), mode, generatorVersion: 2, createdAt: now, updatedAt: now };
}

function previewConfig(): WorldConfig {
  return { id: "preview", name: "远野", seed: "VOXEL-REALMS-2026", mode: "survival", generatorVersion: 2, createdAt: 0, updatedAt: 0 };
}

function isPreview(config: WorldConfig | null): boolean {
  return config?.id === "preview";
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export default function App() {
  const viewportRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const currentConfigRef = useRef<WorldConfig | null>(null);
  const saveChain = useRef<Promise<unknown>>(Promise.resolve());
  const invalidatedWorlds = useRef(new Set<string>());
  const pendingSaves = useRef(0);
  const importInput = useRef<HTMLInputElement>(null);
  const messageTimer = useRef<number | null>(null);
  const [screen, setScreen] = useState<GameScreen>("loading");
  const [loading, setLoading] = useState({ progress: 0, stage: "启动渲染器" });
  const [hud, setHud] = useState<HudState>(emptyHud);
  const [worlds, setWorlds] = useState<WorldConfig[]>([]);
  const [currentConfig, setCurrentConfig] = useState<WorldConfig | null>(null);
  const [settings, setSettingsState] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [debug, setDebug] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newWorldOpen, setNewWorldOpen] = useState(false);
  const [worldListOpen, setWorldListOpen] = useState(false);
  const [inventorySearch, setInventorySearch] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [settingsReturn, setSettingsReturn] = useState<GameScreen>("paused");
  const [worldName, setWorldName] = useState("我的新世界");
  const [worldSeed, setWorldSeed] = useState(randomSeed);
  const [worldMode, setWorldMode] = useState<GameMode>("survival");
  const [isSaving, setIsSaving] = useState(false);
  const [worldReady, setWorldReady] = useState(false);
  const [fatalError, setFatalError] = useState("");

  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (messageTimer.current) window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setNotice(""), 2600);
  }, []);

  const refreshWorlds = useCallback(async () => {
    const next = await listWorlds();
    setWorlds(next);
    return next;
  }, []);

  const persistSnapshot = useCallback((snapshot: EngineRuntimeSnapshot) => {
    const config = currentConfigRef.current;
    if (!config || isPreview(config) || invalidatedWorlds.current.has(config.id)) return Promise.resolve();
    pendingSaves.current += 1;
    setIsSaving(true);
    const queued = saveChain.current.then(async () => {
      if (invalidatedWorlds.current.has(config.id)) return;
      const updatedConfig = { ...config, updatedAt: Date.now() };
      const save: WorldSave = {
        schemaVersion: WORLD_DATA_SCHEMA_VERSION,
        config: updatedConfig,
        player: snapshot.player,
        patches: snapshot.patches,
        timeOfDay: snapshot.timeOfDay,
        weather: snapshot.weather,
      };
      await saveWorld(save);
      if (invalidatedWorlds.current.has(config.id)) return;
      if (currentConfigRef.current === config) {
        currentConfigRef.current = updatedConfig;
        setCurrentConfig(updatedConfig);
      }
      setWorlds((items) => {
        const exists = items.some((item) => item.id === updatedConfig.id);
        const next = exists
          ? items.map((item) => item.id === updatedConfig.id ? { ...item, updatedAt: updatedConfig.updatedAt } : item)
          : [updatedConfig, ...items];
        return next.sort((left, right) => right.updatedAt - left.updatedAt);
      });
    }).catch(() => {
      if (!invalidatedWorlds.current.has(config.id)) setError("世界保存失败，当前游戏仍可继续。");
    }).finally(() => {
      pendingSaves.current = Math.max(0, pendingSaves.current - 1);
      setIsSaving(pendingSaves.current > 0);
    });
    saveChain.current = queued;
    return queued;
  }, []);

  useEffect(() => {
    const host = viewportRef.current;
    if (!host) return;
    let cancelled = false;
    let engine: GameEngine | null = null;
    const start = async () => {
      let savedSettings = { ...DEFAULT_SETTINGS };
      try {
        savedSettings = await loadSettings();
      } catch {
        setError("设置读取失败，已使用默认设置。");
      }
      if (cancelled) return;
      setSettingsState(savedSettings);
      try {
        engine = new GameEngine(host, {
          onHud: setHud,
          onScreen: setScreen,
          onLoading: (progress, stage) => setLoading({ progress, stage }),
          onMessage: showNotice,
          onError: setError,
          onSave: persistSnapshot,
          onConfigChange: (config) => {
            currentConfigRef.current = config;
            setCurrentConfig(config);
            setWorlds((items) => items.map((item) => item.id === config.id ? config : item));
          },
          onToggleDebug: () => setDebug((value) => !value),
        });
        engineRef.current = engine;
        engine.applySettings(savedSettings);
        let config = previewConfig();
        let saved: WorldSave | null = null;
        try {
          const available = await refreshWorlds();
          if (cancelled) return;
          const listedConfig = available[0] ?? config;
          saved = isPreview(listedConfig) ? null : await loadWorld(listedConfig.id);
          config = saved?.config ?? listedConfig;
        } catch (cause) {
          setError(errorMessage(cause, "本地存档暂时无法读取，已打开预览世界。"));
        }
        if (cancelled) return;
        currentConfigRef.current = config;
        setCurrentConfig(config);
        setWorldReady(await engine.loadWorld(config, saved, false));
      } catch (cause) {
        engine?.dispose();
        engine = null;
        engineRef.current = null;
        const message = errorMessage(cause, "浏览器无法启动 3D 世界。");
        setFatalError(message);
        setError("");
        setScreen("menu");
      }
    };
    void start();
    return () => {
      cancelled = true;
      engine?.dispose();
      if (messageTimer.current) window.clearTimeout(messageTimer.current);
    };
  }, [persistSnapshot, refreshWorlds, showNotice]);

  useEffect(() => {
    const openConsole = (event: KeyboardEvent) => {
      if (event.code === "Slash" && screen === "playing") {
        event.preventDefault();
        engineRef.current?.pause();
        setCommandOpen(true);
        setCommand("");
      }
    };
    window.addEventListener("keydown", openConsole, true);
    return () => window.removeEventListener("keydown", openConsole, true);
  }, [screen]);

  const loadConfig = async (config: WorldConfig, enter = false): Promise<boolean> => {
    const engine = engineRef.current;
    if (!engine) return false;
    setWorldListOpen(false);
    setNewWorldOpen(false);
    setError("");
    try {
      const saved = isPreview(config) ? null : await loadWorld(config.id);
      const effectiveConfig = saved?.config ?? config;
      invalidatedWorlds.current.delete(effectiveConfig.id);
      currentConfigRef.current = effectiveConfig;
      setCurrentConfig(effectiveConfig);
      setWorldReady(false);
      const ready = await engine.loadWorld(effectiveConfig, saved, enter);
      setWorldReady(ready);
      return ready;
    } catch (cause) {
      setWorldReady(false);
      setError(errorMessage(cause, "世界无法加载。"));
      return false;
    }
  };

  const createWorld = async (event: FormEvent) => {
    event.preventDefault();
    const engine = engineRef.current;
    if (!engine) return;
    try {
      const config = newWorldConfig(worldName, worldSeed, worldMode);
      invalidatedWorlds.current.delete(config.id);
      currentConfigRef.current = config;
      setCurrentConfig(config);
      setNewWorldOpen(false);
      setWorldReady(false);
      const ready = await engine.loadWorld(config, null, true);
      setWorldReady(ready);
      if (!ready) return;
      await persistSnapshot(engine.snapshot());
      await refreshWorlds();
    } catch (cause) {
      setError(errorMessage(cause, "新世界无法创建。"));
    }
  };

  const removeWorld = async (config: WorldConfig) => {
    if (!window.confirm(`删除世界“${config.name}”？此操作不可恢复。`)) return;
    invalidatedWorlds.current.add(config.id);
    let removed = false;
    try {
      await saveChain.current;
      await deleteWorld(config.id);
      removed = true;
      const remaining = await refreshWorlds();
      showNotice("世界已删除");
      if (currentConfigRef.current?.id === config.id) {
        const next = remaining[0] ?? previewConfig();
        await loadConfig(next, false);
      }
    } catch (cause) {
      if (!removed) invalidatedWorlds.current.delete(config.id);
      else setWorlds((items) => items.filter((item) => item.id !== config.id));
      setError(errorMessage(cause, removed ? "世界已删除，但存档列表刷新失败。" : "世界无法删除。"));
    }
  };

  const downloadWorld = async (config: WorldConfig) => {
    try {
      const json = await exportWorld(config.id, true);
      const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${config.name.replace(/[^\p{L}\p{N}-]+/gu, "-") || "voxel-world"}.json`;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      showNotice("世界已导出");
    } catch (cause) {
      setError(errorMessage(cause, "世界无法导出。"));
    }
  };

  const importWorldFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const imported = await importWorld(file, { conflict: "copy" });
      await refreshWorlds();
      if (await loadConfig(imported.config, false)) showNotice("世界已导入");
    } catch (cause) {
      setError(errorMessage(cause, "世界文件无法导入。"));
    }
  };

  const updateSettings = (patch: Partial<GameSettings>) => {
    const next = { ...settings, ...patch };
    setSettingsState(next);
    engineRef.current?.applySettings(next);
    void saveSettings(next).catch(() => showNotice("设置暂时无法保存"));
  };

  const openSettings = (returnTo: GameScreen) => {
    setSettingsReturn(returnTo);
    engineRef.current?.openSettings();
  };

  const closeSettings = () => {
    if (settingsReturn === "menu") engineRef.current?.returnToMenu();
    else engineRef.current?.setScreenFromUI("paused");
  };

  const submitCommand = (event: FormEvent) => {
    event.preventDefault();
    if (!command.trim()) return;
    const result = engineRef.current?.runCommand(command) ?? "命令无法执行";
    setCommandOpen(false);
    showNotice(result);
    engineRef.current?.resume();
  };

  const modalKey = newWorldOpen ? "new-world"
    : worldListOpen ? "world-list"
      : commandOpen ? "command"
        : (["paused", "inventory", "settings", "dead"] as GameScreen[]).includes(screen) ? screen : "";

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.code !== "Escape") return;
      let handled = true;
      if (newWorldOpen) setNewWorldOpen(false);
      else if (worldListOpen) setWorldListOpen(false);
      else if (commandOpen) {
        setCommandOpen(false);
        engineRef.current?.resume();
      } else if (screen === "settings") {
        if (settingsReturn === "menu") engineRef.current?.returnToMenu();
        else engineRef.current?.setScreenFromUI("paused");
      } else if (screen === "inventory" || screen === "paused") engineRef.current?.resume();
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [commandOpen, newWorldOpen, screen, settingsReturn, worldListOpen]);

  useEffect(() => {
    if (!modalKey) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = Array.from(viewportRef.current?.querySelectorAll<HTMLElement>(".pause-screen, .inventory-screen, .settings-screen, .death-screen, .world-modal, .world-list-panel, .command-overlay form") ?? []).at(-1);
    if (!dialog) return;
    const labels: Record<string, string> = {
      paused: "世界已暂停",
      inventory: "物品与方块",
      settings: "世界设置",
      dead: "玩家倒下",
      "new-world": "创建新世界",
      "world-list": "世界存档",
      command: "命令控制台",
    };
    dialog.setAttribute("role", modalKey === "dead" ? "alertdialog" : "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", labels[modalKey] ?? "对话框");
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter((element) => !element.hidden);
    const frame = window.requestAnimationFrame(() => {
      if (!dialog.contains(document.activeElement)) focusable()[0]?.focus();
    });
    const trapFocus = (event: KeyboardEvent) => {
      if (event.code !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      dialog.removeEventListener("keydown", trapFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, [modalKey]);

  const inventory = useMemo(() => {
    const query = inventorySearch.trim().toLowerCase();
    return (engineRef.current?.getInventory() ?? []).filter((item) => !query || item.name.toLowerCase().includes(query));
  }, [inventorySearch, screen, hud.hotbar]);

  return <main className={`game-root crosshair-${settings.crosshair}`} ref={viewportRef}>
    {fatalError ? <FatalScreen message={fatalError} /> : null}
    {!fatalError && screen === "loading" ? <LoadingScreen progress={loading.progress} stage={loading.stage} /> : null}
    {!fatalError && screen === "menu" ? <TitleMenu config={currentConfig} hasSave={Boolean(worldReady && currentConfig && !isPreview(currentConfig))} worldCount={worlds.length} onContinue={() => engineRef.current?.enterGame()} onNew={() => setNewWorldOpen(true)} onWorlds={() => setWorldListOpen(true)} onSettings={() => openSettings("menu")} /> : null}
    {screen === "playing" ? <GameHud hud={hud} debug={debug} isSaving={isSaving} onPause={() => engineRef.current?.pause()} onSelect={(index) => engineRef.current?.selectSlot(index)} /> : null}
    {screen === "paused" ? <PauseMenu config={currentConfig} onResume={() => engineRef.current?.resume()} onSave={() => { const engine = engineRef.current; if (engine) persistSnapshot(engine.snapshot()); showNotice("保存请求已提交"); }} onSettings={() => openSettings("paused")} onMenu={() => engineRef.current?.returnToMenu()} /> : null}
    {screen === "inventory" ? <InventoryScreen mode={hud.mode} items={inventory} selected={hud.hotbar[hud.selectedSlot]?.block} query={inventorySearch} onQuery={setInventorySearch} onSelect={(block) => engineRef.current?.assignSelectedBlock(block)} onCraft={(recipeId) => engineRef.current?.craftRecipe(recipeId)} onClose={() => engineRef.current?.resume()} /> : null}
    {screen === "settings" ? <SettingsScreen settings={settings} hud={hud} onChange={updateSettings} onWeather={(weather) => engineRef.current?.setWeather(weather)} onTime={(time) => engineRef.current?.setTime(time)} onClose={closeSettings} /> : null}
    {screen === "dead" ? <DeathScreen onRespawn={() => engineRef.current?.respawn()} onMenu={() => engineRef.current?.returnToMenu()} /> : null}
    {newWorldOpen ? <NewWorldModal name={worldName} seed={worldSeed} mode={worldMode} onName={setWorldName} onSeed={setWorldSeed} onMode={setWorldMode} onRandomSeed={() => setWorldSeed(randomSeed())} onClose={() => setNewWorldOpen(false)} onSubmit={createWorld} /> : null}
    {worldListOpen ? <WorldList worlds={worlds} currentId={currentConfig?.id} onSelect={(config) => void loadConfig(config, false)} onDelete={(config) => void removeWorld(config)} onExport={(config) => void downloadWorld(config)} onImport={() => importInput.current?.click()} onClose={() => setWorldListOpen(false)} /> : null}
    {commandOpen ? <CommandConsole value={command} onChange={setCommand} onSubmit={submitCommand} onClose={() => { setCommandOpen(false); engineRef.current?.resume(); }} /> : null}
    {screen === "playing" ? <MobileControls engine={engineRef.current} /> : null}
    {notice || hud.message ? <div className="world-notice" role="status" aria-live="polite">{notice || hud.message}</div> : null}
    {error ? <div className="error-banner" role="alert" aria-live="assertive"><Zap size={17} /><span>{error}</span><button title="关闭" aria-label="关闭错误提示" onClick={() => setError("")}><X size={16} /></button></div> : null}
    <input className="sr-only" ref={importInput} type="file" accept="application/json,.json" onChange={(event) => { void importWorldFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
  </main>;
}

function LoadingScreen({ progress, stage }: { progress: number; stage: string }) {
  return <section className="loading-screen overlay"><div className="voxel-logo"><span>VOXEL</span><b>//</b><span>REALMS</span></div><div className="loading-status"><span>{stage}</span><strong>{Math.round(progress * 100)}%</strong></div><div className="loading-track"><i style={{ width: `${Math.max(2, progress * 100)}%` }} /></div></section>;
}

function FatalScreen({ message }: { message: string }) {
  return <section className="fatal-screen overlay" role="alert"><div><Zap size={28} /><span className="kicker">RENDERER UNAVAILABLE</span><h1>3D 世界无法启动</h1><p>{message}</p><button className="menu-primary" onClick={() => window.location.reload()}><RefreshCcw size={18} />重新加载</button></div></section>;
}

function TitleMenu({ config, hasSave, worldCount, onContinue, onNew, onWorlds, onSettings }: { config: WorldConfig | null; hasSave: boolean; worldCount: number; onContinue: () => void; onNew: () => void; onWorlds: () => void; onSettings: () => void }) {
  return <section className="title-menu overlay"><header className="title-top"><div className="voxel-logo"><span>VOXEL</span><b>//</b><span>REALMS</span></div><div className="build-label">WEBGL WORLD · BUILD 1.1</div></header><div className="title-content"><div className="title-copy"><span className="kicker">PERSISTENT VOXEL SANDBOX</span><h1>{hasSave ? config?.name : "一片等待被改变的世界"}</h1><p>{hasSave ? `${config?.mode === "creative" ? "创造" : "生存"}模式 · ${config?.seed}` : "世界由种子确定，改变由你永久保存。"}</p></div><div className="menu-actions">{hasSave ? <button className="menu-primary" onClick={onContinue}><Play size={19} fill="currentColor" />继续世界</button> : <button className="menu-primary" onClick={onNew}><Plus size={20} />创建世界</button>}<button onClick={onNew}><Layers3 size={18} />新世界</button><button onClick={onWorlds}><Archive size={18} />世界存档 <span>{worldCount}</span></button><button onClick={onSettings}><Settings size={18} />设置</button></div></div><footer className="title-footer"><span>45 种方块 · 27 格背包 · 本机存档</span><span>{config?.seed ?? "WORLD PREVIEW"}</span></footer></section>;
}

function GameHud({ hud, debug, isSaving, onPause, onSelect }: { hud: HudState; debug: boolean; isSaving: boolean; onPause: () => void; onSelect: (index: number) => void }) {
  const direction = ((Math.round((hud.yaw / (Math.PI * 2)) * 4) % 4) + 4) % 4;
  return <div className="hud-layer"><div className="hud-top-left"><div className="world-status"><span className="status-dot" /><b>{hud.mode === "creative" ? "创造" : "生存"}</b><span>{hud.timeLabel}</span>{hud.weather === "rain" ? <CloudRain size={14} /> : <Sun size={14} />}</div>{debug ? <div className="debug-panel"><span>FPS {hud.fps}</span><span>XYZ {hud.x.toFixed(2)} / {hud.y.toFixed(2)} / {hud.z.toFixed(2)}</span><span>方向 {['北','东','南','西'][direction]} · 区块 {hud.chunks}</span><span>SEED {hud.seed}</span><span>{hud.flying ? "FLYING" : "GROUND PHYSICS"}</span></div> : null}</div><button className="pause-button icon-control" title="暂停" onClick={onPause}><Pause size={18} fill="currentColor" /></button><div className="crosshair"><i /><i />{hud.breakProgress > 0 ? <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="17" style={{ strokeDashoffset: 107 - hud.breakProgress * 107 }} /></svg> : null}</div>{hud.targetName ? <div className="target-name">{hud.targetName}</div> : null}<div className="survival-hud">{hud.mode === "survival" ? <><Vitals icon={Heart} value={hud.health} tone="health" /><Vitals icon={Shield} value={hud.hunger} tone="hunger" />{hud.oxygen < 20 ? <Vitals icon={Wind} value={hud.oxygen} tone="oxygen" /> : null}</> : <div className="creative-state"><Zap size={14} />创造模式{hud.flying ? " · 飞行" : ""}</div>}</div><div className="hotbar">{hud.hotbar.map((slot, index) => { const empty = slot.block === BlockId.Air || slot.count === 0; return <button key={index} className={hud.selectedSlot === index ? "hotbar-slot selected" : "hotbar-slot"} onClick={() => onSelect(index)} title={empty ? "空槽" : getBlock(slot.block).name}><small>{index + 1}</small>{empty ? null : <BlockSwatch block={slot.block} />}{empty ? null : <b>{slot.count < 0 ? "∞" : slot.count}</b>}</button>; })}</div><div className={`save-state ${isSaving ? "active" : ""}`}><Save size={13} />{isSaving ? "保存中" : "已保存"}</div></div>;
}

function Vitals({ icon: Icon, value, tone }: { icon: typeof Heart; value: number; tone: string }) {
  return <div className={`vitals ${tone}`}><Icon size={14} fill="currentColor" /><div>{Array.from({ length: 10 }, (_, index) => <i key={index} className={value > index * 2 ? "full" : value > index * 2 - 1 ? "half" : ""} />)}</div></div>;
}

function BlockSwatch({ block }: { block: BlockId }) {
  return <span className={`block-swatch block-${BlockId[block].toLowerCase()}`} aria-hidden="true"><i /></span>;
}

function PauseMenu({ config, onResume, onSave, onSettings, onMenu }: { config: WorldConfig | null; onResume: () => void; onSave: () => void; onSettings: () => void; onMenu: () => void }) {
  return <section className="pause-screen overlay dark-overlay"><div className="pause-panel"><span className="kicker">WORLD PAUSED</span><h2>{config?.name ?? "世界"}</h2><div className="pause-actions"><button className="menu-primary" onClick={onResume}><Play size={18} fill="currentColor" />继续</button><button onClick={onSave}><Save size={18} />保存世界</button><button onClick={onSettings}><Settings size={18} />设置</button><button onClick={onMenu}><Home size={18} />返回标题</button></div></div></section>;
}

function InventoryScreen({ mode, items, selected, query, onQuery, onSelect, onCraft, onClose }: { mode: GameMode; items: Array<{ block: BlockId; count: number; name: string }>; selected?: BlockId; query: string; onQuery: (value: string) => void; onSelect: (block: BlockId) => void; onCraft: (recipeId: string) => boolean | undefined; onClose: () => void }) {
  const counts = new Map(items.map((item) => [item.block, item.count]));
  return <section className="inventory-screen overlay dark-overlay"><div className="inventory-panel"><header><div><span className="kicker">{mode === "creative" ? "CREATIVE CATALOG" : "PLAYER INVENTORY"}</span><h2>物品与方块</h2></div><button className="icon-control" title="关闭背包" onClick={onClose}><X size={19} /></button></header><label className="inventory-search"><Search size={17} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="搜索方块" /></label><div className="inventory-grid">{items.map((item) => <button key={item.block} className={selected === item.block ? "inventory-slot selected" : "inventory-slot"} onClick={() => onSelect(item.block)} title={item.name}><BlockSwatch block={item.block} /><span>{item.name}</span><b>{item.count < 0 ? "∞" : item.count}</b></button>)}</div>{mode === "survival" ? <div className="crafting-strip"><span className="kicker">CRAFTING LIBRARY</span><div>{CRAFTING_RECIPES.map((recipe) => { const ready = recipe.ingredients.every((item) => (counts.get(item.block) ?? 0) >= item.count); return <button key={recipe.id} disabled={!ready} onClick={() => onCraft(recipe.id)} title={recipe.name}><span className="recipe-inputs">{recipe.ingredients.map((item) => <i key={item.block}><BlockSwatch block={item.block} /><b>{item.count}</b></i>)}</span><span className="recipe-arrow">→</span><i><BlockSwatch block={recipe.output.block} /><b>{recipe.output.count}</b></i><span className="recipe-name">{recipe.name}</span></button>; })}</div></div> : null}<footer><span>{mode === "creative" ? `${ALL_BLOCKS.length - 1} 种方块` : `${items.length} 种材料 · 27 格背包`}</span><button className="menu-primary" onClick={onClose}><Check size={17} />完成</button></footer></div></section>;
}

function SettingsScreen({ settings, hud, onChange, onWeather, onTime, onClose }: { settings: GameSettings; hud: HudState; onChange: (patch: Partial<GameSettings>) => void; onWeather: (weather: Weather) => void; onTime: (time: "day" | "night") => void; onClose: () => void }) {
  return <section className="settings-screen overlay dark-overlay"><div className="settings-panel"><header><div><span className="kicker">WORLD SETTINGS</span><h2>设置</h2></div><button className="icon-control" title="关闭设置" onClick={onClose}><X size={19} /></button></header><div className="settings-body"><SettingRange icon={Monitor} label="视野" value={settings.fov} min={55} max={100} step={1} suffix="°" onChange={(fov) => onChange({ fov })} /><SettingRange icon={Gamepad2} label="灵敏度" value={settings.sensitivity} min={0.2} max={1.6} step={0.05} onChange={(sensitivity) => onChange({ sensitivity })} /><SettingRange icon={Layers3} label="渲染距离" value={settings.renderDistance} min={2} max={6} step={1} suffix=" 区块" onChange={(renderDistance) => onChange({ renderDistance })} /><SettingRange icon={Volume2} label="主音量" value={settings.masterVolume} min={0} max={1} step={0.05} format={(value) => `${Math.round(value * 100)}%`} onChange={(masterVolume) => onChange({ masterVolume })} /><div className="setting-row"><span><Monitor size={17} />画质</span><div className="segment-control">{(["low", "medium", "high"] as const).map((quality) => <button key={quality} className={settings.quality === quality ? "active" : ""} onClick={() => onChange({ quality })}>{quality === "low" ? "性能" : quality === "medium" ? "平衡" : "精细"}</button>)}</div></div><div className="setting-row"><span><Plus size={17} />准星</span><div className="segment-control">{(["adaptive", "light", "dark"] as const).map((crosshair) => <button key={crosshair} className={settings.crosshair === crosshair ? "active" : ""} onClick={() => onChange({ crosshair })}>{crosshair === "adaptive" ? "自适应" : crosshair === "light" ? "浅色" : "深色"}</button>)}</div></div><div className="setting-row world-rule"><span><CloudRain size={17} />世界状态</span><div><button title="晴天" aria-label="设为晴天" className={hud.weather === "clear" ? "active" : ""} onClick={() => onWeather("clear")}><Sun size={16} /></button><button title="下雨" aria-label="设为下雨" className={hud.weather === "rain" ? "active" : ""} onClick={() => onWeather("rain")}><CloudRain size={16} /></button><button title="白昼" aria-label="设为白昼" onClick={() => onTime("day")}><Sun size={16} /></button><button title="夜晚" aria-label="设为夜晚" onClick={() => onTime("night")}><Moon size={16} /></button></div></div></div><footer><button className="menu-primary" onClick={onClose}><Check size={17} />完成</button></footer></div></section>;
}

function SettingRange({ icon: Icon, label, value, min, max, step, suffix = "", format, onChange }: { icon: typeof Monitor; label: string; value: number; min: number; max: number; step: number; suffix?: string; format?: (value: number) => string; onChange: (value: number) => void }) {
  return <label className="setting-range"><span><Icon size={17} />{label}</span><strong>{format ? format(value) : `${value}${suffix}`}</strong><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>;
}

function DeathScreen({ onRespawn, onMenu }: { onRespawn: () => void; onMenu: () => void }) {
  return <section className="death-screen overlay"><div><span className="kicker">YOU FELL</span><h2>世界仍在等待</h2><button className="menu-primary" onClick={onRespawn}><RefreshCcw size={18} />重生</button><button onClick={onMenu}><Home size={18} />返回标题</button></div></section>;
}

function NewWorldModal({ name, seed, mode, onName, onSeed, onMode, onRandomSeed, onClose, onSubmit }: { name: string; seed: string; mode: GameMode; onName: (value: string) => void; onSeed: (value: string) => void; onMode: (value: GameMode) => void; onRandomSeed: () => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  return <section className="modal-backdrop overlay"><form className="world-modal" onSubmit={onSubmit}><header><div><span className="kicker">CREATE WORLD</span><h2>创建新世界</h2></div><button type="button" className="icon-control" title="关闭" onClick={onClose}><X size={19} /></button></header><label>世界名称<input value={name} onChange={(event) => onName(event.target.value)} maxLength={40} autoFocus required /></label><label>世界种子<div className="seed-input"><input value={seed} onChange={(event) => onSeed(event.target.value)} maxLength={80} required /><button type="button" title="随机种子" onClick={onRandomSeed}><RefreshCcw size={17} /></button></div></label><div className="mode-select"><button type="button" className={mode === "survival" ? "active" : ""} onClick={() => onMode("survival")}><Heart size={19} />生存<span>资源有限，存在伤害与饥饿</span></button><button type="button" className={mode === "creative" ? "active" : ""} onClick={() => onMode("creative")}><Zap size={19} />创造<span>无限方块，自由飞行</span></button></div><footer><button type="button" onClick={onClose}>取消</button><button className="menu-primary" type="submit"><Play size={18} fill="currentColor" />生成世界</button></footer></form></section>;
}

function WorldList({ worlds, currentId, onSelect, onDelete, onExport, onImport, onClose }: { worlds: WorldConfig[]; currentId?: string; onSelect: (config: WorldConfig) => void; onDelete: (config: WorldConfig) => void; onExport: (config: WorldConfig) => void; onImport: () => void; onClose: () => void }) {
  return <section className="modal-backdrop overlay"><div className="world-list-panel"><header><div><span className="kicker">LOCAL WORLDS</span><h2>世界存档</h2></div><button className="icon-control" title="关闭" onClick={onClose}><X size={19} /></button></header><div className="world-list">{worlds.length ? worlds.map((world) => <article key={world.id} className={world.id === currentId ? "active" : ""}><button className="world-main" onClick={() => onSelect(world)}><span className="world-thumb"><Layers3 size={22} /></span><div><b>{world.name}</b><small>{world.mode === "creative" ? "创造" : "生存"} · {world.seed}</small><em>{new Date(world.updatedAt).toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</em></div></button><div className="world-actions"><button title="导出世界" onClick={() => onExport(world)}><Download size={16} /></button><button title="删除世界" onClick={() => onDelete(world)}><Trash2 size={16} /></button></div></article>) : <div className="empty-worlds"><Archive size={24} /><b>还没有保存的世界</b></div>}</div><footer><button onClick={onImport}><Upload size={17} />导入世界</button><button className="menu-primary" onClick={onClose}><Check size={17} />完成</button></footer></div></section>;
}

function CommandConsole({ value, onChange, onSubmit, onClose }: { value: string; onChange: (value: string) => void; onSubmit: (event: FormEvent) => void; onClose: () => void }) {
  return <section className="command-overlay overlay"><form onSubmit={onSubmit}><Command size={18} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="输入命令" autoFocus /><button title="执行" type="submit"><Send size={17} /></button><button title="关闭" type="button" onClick={onClose}><X size={17} /></button></form></section>;
}

function MobileControls({ engine }: { engine: GameEngine | null }) {
  const knob = useRef<HTMLSpanElement>(null);
  const joystickPointer = useRef<number | null>(null);
  const origin = useRef({ x: 0, y: 0 });
  const lookPointer = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const joystickStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    joystickPointer.current = event.pointerId;
    origin.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const joystickMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickPointer.current !== event.pointerId) return;
    const dx = event.clientX - origin.current.x;
    const dy = event.clientY - origin.current.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const radius = 34;
    const scale = Math.min(1, radius / length);
    knob.current?.style.setProperty("transform", `translate(${dx * scale}px, ${dy * scale}px)`);
    engine?.setMobileMove(dx * scale / radius, dy * scale / radius);
  };
  const joystickEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (joystickPointer.current !== event.pointerId) return;
    joystickPointer.current = null;
    knob.current?.style.setProperty("transform", "translate(0, 0)");
    engine?.setMobileMove(0, 0);
  };
  const lookStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    lookPointer.current = event.pointerId;
    lookLast.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const lookMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (lookPointer.current !== event.pointerId) return;
    const dx = event.clientX - lookLast.current.x;
    const dy = event.clientY - lookLast.current.y;
    lookLast.current = { x: event.clientX, y: event.clientY };
    engine?.addMobileLook(dx, dy);
  };
  const lookEnd = (event: ReactPointerEvent<HTMLDivElement>) => { if (lookPointer.current === event.pointerId) lookPointer.current = null; };
  return <div className="mobile-controls"><div className="look-zone" onPointerDown={lookStart} onPointerMove={lookMove} onPointerUp={lookEnd} onPointerCancel={lookEnd} /><div className="joystick" onPointerDown={joystickStart} onPointerMove={joystickMove} onPointerUp={joystickEnd} onPointerCancel={joystickEnd}><span ref={knob}><Gamepad2 size={21} /></span></div><div className="mobile-actions"><button title="跳跃" onPointerDown={() => engine?.setMobileAction("jump", true)} onPointerUp={() => engine?.setMobileAction("jump", false)} onPointerCancel={() => engine?.setMobileAction("jump", false)}><ChevronLeft size={23} className="jump-icon" /></button><button title="挖掘" onPointerDown={() => engine?.setMobileAction("break", true)} onPointerUp={() => engine?.setMobileAction("break", false)} onPointerCancel={() => engine?.setMobileAction("break", false)}><Pickaxe size={22} /></button><button title="放置" onPointerDown={() => engine?.setMobileAction("place", true)} onPointerUp={() => engine?.setMobileAction("place", false)} onPointerCancel={() => engine?.setMobileAction("place", false)}><Box size={22} /></button></div><div className="mobile-utility"><button title="打开背包" onPointerDown={() => engine?.openInventory()}><Archive size={20} /></button><button title="下降或潜行" onPointerDown={() => engine?.setMobileAction("crouch", true)} onPointerUp={() => engine?.setMobileAction("crouch", false)} onPointerCancel={() => engine?.setMobileAction("crouch", false)}><ChevronLeft size={21} className="down-icon" /></button></div></div>;
}
