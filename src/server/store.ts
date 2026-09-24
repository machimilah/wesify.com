import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { DEMO_TIME_SCALE, MIN_ACTIVE_MARKETS } from "@/lib/shared/constants";
import { listBackups, runBackup } from "./backup";
import { log, errorFields } from "./log";
import { raiseAlert } from "./world/context";
import { seedDemoWorld, seedMainWorld } from "./world/seed";
import { emptyState, migrate, type WorldState } from "./world/state";
import { World, MAIN_WORLD_DEFAULTS } from "./world/world";

/**
 * File-backed persistence (checklist §34, decision: keep the JSON store and harden it). The state
 * shape mirrors db/schema.sql so the store can be swapped for Postgres without touching the
 * engines. Writes are atomic (temp file + rename), loads run versioned migrations, and hourly
 * backups run from the world tick. Staging and production must use separate WESIFY_DATA_DIRs.
 */

const DATA_DIR = process.env.WESIFY_DATA_DIR || path.join(process.cwd(), ".data");
const MAIN_FILE = path.join(DATA_DIR, "main.json");
const MAX_DEMO_WORLDS = 50;
const DEMO_IDLE_MS = 30 * 60_000;

type Registry = {
  main: World | null;
  demos: Map<string, { world: World; lastUsed: number }>;
  flushTimer: NodeJS.Timeout | null;
  health: { lastFlushAt: number | null; lastFlushError: string | null; lastFlushBytes: number; lastBackupAt: number | null; lastBackupError: string | null };
};

const g = globalThis as unknown as { __wesify?: Registry };
const registry: Registry = (g.__wesify ??= {
  main: null,
  demos: new Map(),
  flushTimer: null,
  health: { lastFlushAt: null, lastFlushError: null, lastFlushBytes: 0, lastBackupAt: null, lastBackupError: null },
});
registry.health ??= { lastFlushAt: null, lastFlushError: null, lastFlushBytes: 0, lastBackupAt: null, lastBackupError: null };

export const storeHealth = () => ({ ...registry.health, dataFile: MAIN_FILE, backups: listBackups().slice(0, 5) });

function scheduleFlush() {
  if (registry.flushTimer) return;
  registry.flushTimer = setTimeout(() => {
    registry.flushTimer = null;
    flushNow();
  }, 1500);
}

export function flushNow() {
  const world = registry.main;
  if (!world) return;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${MAIN_FILE}.${process.pid}.tmp`;
  const json = JSON.stringify(world.state);
  fs.writeFileSync(tmp, json);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, MAIN_FILE);
      registry.health.lastFlushAt = Date.now();
      registry.health.lastFlushError = null;
      registry.health.lastFlushBytes = json.length;
      return;
    } catch (err) {
      // Sync clients (OneDrive, antivirus) can briefly lock the target on Windows.
      if (attempt >= 5) {
        registry.health.lastFlushError = errorFields(err).error;
        log.error("failed to persist state", errorFields(err));
        raiseAlert(world.ctx, "critical", "Failed to persist state to disk", { error: registry.health.lastFlushError });
        return;
      }
      const until = Date.now() + 50 * (attempt + 1);
      while (Date.now() < until) {
        /* short busy wait; flushes are rare */
      }
    }
  }
}

function loadState(): WorldState | null {
  try {
    const raw = fs.readFileSync(MAIN_FILE, "utf8");
    const state = JSON.parse(raw) as WorldState;
    return state.version === 1 && state.kind === "main" ? migrate(state) : null;
  } catch (err) {
    if (fs.existsSync(MAIN_FILE)) {
      // Never silently start empty over a file we couldn't read: that would look like data loss.
      log.error("state file exists but could not be loaded; refusing to overwrite it", errorFields(err));
      throw new Error(`Could not load ${MAIN_FILE}. Restore it from a backup (npm run restore) or move it aside.`);
    }
    return null;
  }
}

function hourlyBackup(world: World) {
  if (process.env.WESIFY_BACKUPS === "0") return;
  try {
    flushNow();
    const r = runBackup(world.state);
    registry.health.lastBackupAt = Date.now();
    registry.health.lastBackupError = null;
    log.info("backup written", { file: path.basename(r.file), bytes: r.bytes });
  } catch (err) {
    registry.health.lastBackupError = errorFields(err).error;
    raiseAlert(world.ctx, "critical", "Backup failed", { error: registry.health.lastBackupError });
  }
}

export function getMainWorld(): World {
  if (registry.main) return registry.main;
  const loaded = loadState();
  const now = Date.now();
  const state = loaded ?? emptyState("main", { epochReal: now, epochWorld: now, scale: 1 });
  const world = new World(state, { ...MAIN_WORLD_DEFAULTS, onChange: scheduleFlush, onHourly: hourlyBackup });
  if (!loaded) {
    seedMainWorld(world.ctx, MIN_ACTIVE_MARKETS + 4);
    scheduleFlush();
  }
  registry.main = world;
  return world;
}

export function createDemoWorld(): { id: string; world: World } {
  pruneDemos();
  const id = randomBytes(12).toString("base64url");
  const now = Date.now();
  const state = emptyState("demo", { epochReal: now, epochWorld: now, scale: DEMO_TIME_SCALE });
  const world = new World(state, { bots: true, botChance: 0.6, minActiveMarkets: 0 });
  seedDemoWorld(world.ctx);
  registry.demos.set(id, { world, lastUsed: now });
  return { id, world };
}

export function getDemoWorld(id: string | undefined): World | null {
  if (!id) return null;
  const entry = registry.demos.get(id);
  if (!entry) return null;
  entry.lastUsed = Date.now();
  return entry.world;
}

export function deleteDemoWorld(id: string) {
  registry.demos.delete(id);
}

export function demoWorldCount() {
  return registry.demos.size;
}

function pruneDemos() {
  const now = Date.now();
  for (const [id, entry] of registry.demos) {
    if (now - entry.lastUsed > DEMO_IDLE_MS) registry.demos.delete(id);
  }
  while (registry.demos.size >= MAX_DEMO_WORLDS) {
    const oldest = [...registry.demos.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    registry.demos.delete(oldest[0]);
  }
}
