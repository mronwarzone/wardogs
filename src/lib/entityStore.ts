import type {
  IngestMessage,
  LiveEntity,
  LiveFeedFrame,
  FactionId,
  PossessionId,
  MatchEvent,
} from "./protocol";
import { ACTIVE_MAP } from "./maps";
import { buildTelemetry, inferLifeEvents } from "./telemetry";
import { resolveFaction } from "./protocol";

type Listener = (frame: LiveFeedFrame) => void;

declare global {
  var __wardogsEntityStore: EntityStore | undefined;
}

/** Demo possession flips across the three real factions + contested/unowned. */
const POSSESSION_CYCLE: PossessionId[] = [
  "lonestar",
  "contested",
  "valkyra",
  "contested",
  "manticore",
  "neutral",
];

export class EntityStore {
  private entities = new Map<string, LiveEntity>();
  private listeners = new Set<Listener>();
  private source: LiveFeedFrame["source"] = "mock";
  private mockTimer: ReturnType<typeof setInterval> | null = null;
  private mockStarted = false;
  private prevPos = new Map<string, { x: number; y: number }>();
  private localFaction: FactionId = "lonestar";
  private events: MatchEvent[] = [];
  private matchId = "local-session";
  private matchStartedAt = Date.now();
  private mapId?: string;
  private lifePrev = new Map<string, LiveEntity>();
  private emitTimer: ReturnType<typeof setTimeout> | null = null;
  private emitDirty = false;
  private lastEmitAt = 0;
  /** Cap SSE fan-out (~60 Hz) so pose tracks like overlay. */
  private static readonly EMIT_MIN_MS = 16;

  getAll(): LiveEntity[] {
    return Array.from(this.entities.values());
  }

  frame(): LiveFeedFrame {
    const entities = this.getAll();
    // Slim SSE: skip heavy telemetry rebuild every tick — HUD can poll /entities.
    return {
      type: "entities",
      entities,
      source: this.source,
      serverTime: Date.now(),
      localFaction: this.localFaction,
      telemetry: buildTelemetry(entities, this.events, {
        matchId: this.matchId,
        mapId: this.mapId,
        startedAt: this.matchStartedAt,
      }),
    };
  }

  /** Pose-only fan-out for live map (no event log / roster stats). */
  lightFrame(): LiveFeedFrame {
    return {
      type: "entities",
      entities: this.getAll(),
      source: this.source,
      serverTime: Date.now(),
      localFaction: this.localFaction,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.frame());
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.emitDirty = true;
    const now = Date.now();
    const wait = Math.max(0, EntityStore.EMIT_MIN_MS - (now - this.lastEmitAt));
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      if (!this.emitDirty || !this.listeners.size) return;
      this.emitDirty = false;
      this.lastEmitAt = Date.now();
      // Light frame for SSE — keeps WinHttp→browser pipe snappy.
      const frame = this.lightFrame();
      for (const l of [...this.listeners]) {
        try {
          l(frame);
        } catch {
          this.listeners.delete(l);
        }
      }
    }, wait);
  }

  private pushEvents(evs: MatchEvent[]) {
    if (!evs.length) return;
    this.events.push(...evs);
    if (this.events.length > 250) this.events = this.events.slice(-200);
  }

  private noteLifeTransitions(nextList: LiveEntity[]) {
    const inferred = inferLifeEvents(this.lifePrev, nextList, Date.now());
    this.pushEvents(inferred);
    this.lifePrev = new Map(
      nextList
        .filter((e) => e.type === "player" || e.type === "corpse")
        .map((e) => [e.id, { ...e }])
    );
  }

  private stopMock(clearSyntheticEvents = true) {
    if (this.mockTimer) {
      clearInterval(this.mockTimer);
      this.mockTimer = null;
    }
    if (clearSyntheticEvents) {
      this.events = this.events.filter(
        (e) => e.id !== "boot" && !e.id.startsWith("mock-")
      );
    }
  }

  applyIngest(msg: IngestMessage) {
    if (msg.type === "telemetry") {
      this.stopMock();
      if (msg.replaceEvents) this.events = [];
      if (msg.events?.length) this.pushEvents(msg.events);
      if (msg.matchId) this.matchId = msg.matchId;
      if (msg.mapId) this.mapId = msg.mapId;
      if (msg.startedAt) this.matchStartedAt = msg.startedAt;
      this.source = "provider";
      this.emit();
      return;
    }

    this.stopMock();
    if (msg.type === "snapshot") {
      this.entities.clear();
      for (const e of msg.entities) this.entities.set(e.id, e);
      if (msg.localFaction) this.localFaction = msg.localFaction;
      if (msg.mapId) this.mapId = msg.mapId;
      if (msg.matchId) this.matchId = msg.matchId;
      if (msg.startedAt) this.matchStartedAt = msg.startedAt;
      this.source = "provider";
      this.noteLifeTransitions(msg.entities);
      if (msg.events?.length) this.pushEvents(msg.events);
    } else {
      for (const e of msg.upsert ?? []) this.entities.set(e.id, e);
      for (const id of msg.remove ?? []) this.entities.delete(id);
      this.source = "provider";
      this.noteLifeTransitions(this.getAll());
      if (msg.events?.length) this.pushEvents(msg.events);
    }
    this.emit();
  }

  ensureMockRunning() {
    if (this.mockStarted) return;
    this.mockStarted = true;

    const { bounds } = ACTIVE_MAP;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const spanX = (bounds.maxX - bounds.minX) * 0.38;
    const spanY = (bounds.maxY - bounds.minY) * 0.38;
    const now = Date.now();
    this.localFaction = "lonestar";
    this.matchId = `mock-${Date.now().toString(36)}`;
    this.matchStartedAt = now;
    this.mapId = ACTIVE_MAP.id;
    this.events = [
      {
        id: "boot",
        kind: "note",
        t: now,
        text: "Match ops online (mock telemetry)",
      },
    ];

    const seed: LiveEntity[] = [
      // Lonestar (local)
      {
        id: "self-1",
        type: "player",
        world: { x: cx, y: cy, z: 200 },
        yaw: 45,
        faction: "lonestar",
        factionEnum: 1,
        genericTeamId: 0,
        isSelf: true,
        isSquad: true,
        name: "YOU",
        hp: 100,
        maxHp: 100,
        updatedAt: now,
      },
      {
        id: "ls-squad-2",
        type: "player",
        world: { x: cx - spanX * 0.15, y: cy + spanY * 0.1 },
        yaw: 120,
        faction: "lonestar",
        factionEnum: 1,
        genericTeamId: 0,
        isSquad: true,
        name: "LS-2",
        hp: 72,
        maxHp: 100,
        updatedAt: now,
      },
      {
        id: "ls-3",
        type: "player",
        world: { x: cx - spanX * 0.22, y: cy - spanY * 0.08 },
        yaw: -20,
        faction: "lonestar",
        factionEnum: 1,
        genericTeamId: 0,
        name: "LS-3",
        hp: 100,
        maxHp: 100,
        updatedAt: now,
      },
      // Valkyra
      {
        id: "vk-1",
        type: "player",
        world: { x: cx + spanX * 0.4, y: cy + spanY * 0.28 },
        yaw: 210,
        faction: "valkyra",
        factionEnum: 2, genericTeamId: 1,
        name: "VK-1",
        hp: 100,
        maxHp: 100,
        updatedAt: now,
      },
      {
        id: "vk-2",
        type: "player",
        world: { x: cx + spanX * 0.48, y: cy + spanY * 0.2 },
        yaw: 185,
        faction: "valkyra",
        factionEnum: 2, genericTeamId: 1,
        name: "VK-2",
        hp: 80,
        maxHp: 100,
        updatedAt: now,
      },
      {
        id: "vk-3",
        type: "player",
        world: { x: cx + spanX * 0.35, y: cy + spanY * 0.35 },
        yaw: 240,
        faction: "valkyra",
        factionEnum: 2, genericTeamId: 1,
        name: "VK-3",
        hp: 100,
        maxHp: 100,
        updatedAt: now,
      },
      // Manticore
      {
        id: "mt-1",
        type: "player",
        world: { x: cx - spanX * 0.4, y: cy - spanY * 0.35 },
        yaw: 40,
        faction: "manticore",
        factionEnum: 3, genericTeamId: 2,
        name: "MT-1",
        hp: 100,
        maxHp: 100,
        updatedAt: now,
      },
      {
        id: "mt-2",
        type: "player",
        world: { x: cx - spanX * 0.48, y: cy - spanY * 0.28 },
        yaw: 70,
        faction: "manticore",
        factionEnum: 3, genericTeamId: 2,
        name: "MT-2",
        hp: 90,
        maxHp: 100,
        updatedAt: now,
      },
      {
        id: "veh-ls-havoc",
        type: "vehicle",
        world: { x: cx - spanX * 0.3, y: cy + spanY * 0.15 },
        yaw: 200,
        faction: "lonestar",
        factionEnum: 1,
        genericTeamId: 0,
        name: "HAVOC-LS",
        meta: { vehicleClass: "havoc", occupants: 2, capacity: 4 },
        updatedAt: now,
      },
      {
        id: "veh-vk-havoc",
        type: "vehicle",
        world: { x: cx + spanX * 0.5, y: cy + spanY * 0.32 },
        yaw: 250,
        faction: "valkyra",
        factionEnum: 2, genericTeamId: 1,
        name: "HAVOC-VK",
        meta: { vehicleClass: "havoc", occupants: 1, capacity: 4 },
        updatedAt: now,
      },
      {
        id: "veh-mt-kodiak",
        type: "vehicle",
        world: { x: cx - spanX * 0.35, y: cy - spanY * 0.4 },
        yaw: 10,
        faction: "manticore",
        factionEnum: 3, genericTeamId: 2,
        name: "KODIAK-MT",
        meta: { vehicleClass: "kodiak", occupants: 1, capacity: 6 },
        updatedAt: now,
      },
      {
        id: "veh-ls-phalanx",
        type: "vehicle",
        world: { x: cx - spanX * 0.05, y: cy + spanY * 0.35 },
        yaw: 90,
        faction: "lonestar",
        factionEnum: 1,
        genericTeamId: 0,
        isSquad: true,
        name: "PHALANX",
        meta: { vehicleClass: "phalanx" },
        updatedAt: now,
      },
      {
        id: "fob-lonestar",
        type: "fob",
        world: { x: cx - spanX * 0.52, y: cy + spanY * 0.05 },
        faction: "lonestar",
        factionEnum: 1,
        genericTeamId: 0,
        possession: "lonestar",
        name: "FOB LONESTAR",
        radiusCm: 25000,
        updatedAt: now,
      },
      {
        id: "fob-valkyra",
        type: "fob",
        world: { x: cx + spanX * 0.45, y: cy - spanY * 0.35 },
        faction: "valkyra",
        factionEnum: 2, genericTeamId: 1,
        possession: "valkyra",
        name: "FOB VALKYRA",
        radiusCm: 22000,
        updatedAt: now,
      },
      {
        id: "fob-manticore",
        type: "fob",
        world: { x: cx - spanX * 0.45, y: cy - spanY * 0.15 },
        faction: "manticore",
        factionEnum: 3, genericTeamId: 2,
        possession: "manticore",
        name: "FOB MANTICORE",
        radiusCm: 22000,
        updatedAt: now,
      },
      {
        id: "fob-cross",
        type: "fob",
        world: { x: cx + spanX * 0.05, y: cy - spanY * 0.05 },
        possession: "neutral",
        name: "FOB CROSSROADS",
        radiusCm: 28000,
        updatedAt: now,
      },
      {
        id: "cz-bridge",
        type: "control_zone",
        world: { x: cx - spanX * 0.15, y: cy - spanY * 0.22 },
        possession: "contested",
        name: "CZ BRIDGE",
        radiusCm: 35000,
        updatedAt: now,
      },
      {
        id: "spawn-ls",
        type: "spawn",
        world: { x: cx - spanX * 0.58, y: cy + spanY * 0.08 },
        faction: "lonestar",
        factionEnum: 1,
        genericTeamId: 0,
        possession: "lonestar",
        name: "SPAWN LS",
        updatedAt: now,
      },
      {
        id: "supply-1",
        type: "supply",
        world: { x: cx + spanX * 0.12, y: cy - spanY * 0.42 },
        faction: "lonestar",
        factionEnum: 1,
        genericTeamId: 0,
        name: "SUPPLY",
        updatedAt: now,
      },
      {
        id: "safezone-1",
        type: "safezone",
        world: { x: cx, y: cy },
        name: "OVERALL",
        // Large playable / overall circle (~1.2 km radius)
        radiusCm: 120000,
        updatedAt: now,
      },
      {
        id: "hotzone-1",
        type: "hotzone",
        world: { x: cx + spanX * 0.12, y: cy + spanY * 0.08 },
        name: "HOT ZONE",
        // Smaller yellow magnet / hot zone that drifts
        radiusCm: 28000,
        updatedAt: now,
      },
      {
        id: "corpse-1",
        type: "corpse",
        world: { x: cx - spanX * 0.08, y: cy - spanY * 0.18 },
        name: "KIA",
        updatedAt: now,
      },
    ];

    for (const e of seed) {
      this.entities.set(e.id, e);
      this.prevPos.set(e.id, { x: e.world.x, y: e.world.y });
    }
    this.lifePrev = new Map(
      seed
        .filter((e) => e.type === "player" || e.type === "corpse")
        .map((e) => [e.id, { ...e }])
    );
    this.source = "mock";
    this.emit();

    const t0 = Date.now();
    this.mockTimer = setInterval(() => {
      // Live provider snapshots stop the timer; keep this guard for mixed races.
      if (this.source === "provider" || this.source === "mixed") return;

      const t = (Date.now() - t0) / 1000;

      // Contested objective flips through real factions
      const flipIdx = Math.floor(t / 7) % POSSESSION_CYCLE.length;
      for (const id of ["fob-cross", "cz-bridge"]) {
        const e = this.entities.get(id);
        if (!e) continue;
        const possession = POSSESSION_CYCLE[flipIdx]!;
        const faction: FactionId =
          possession === "lonestar" ||
          possession === "valkyra" ||
          possession === "manticore"
            ? possession
            : "unknown";
        this.entities.set(id, {
          ...e,
          possession,
          faction,
          factionEnum:
            faction === "lonestar"
              ? 1
              : faction === "valkyra"
                ? 2
                : faction === "manticore"
                  ? 3
                  : 0,
          genericTeamId:
            faction === "lonestar"
              ? 0
              : faction === "valkyra"
                ? 1
                : faction === "manticore"
                  ? 2
                  : 0xff,
          updatedAt: Date.now(),
        });
      }

      // Home bases stay their faction; occasional contest on Valkyra FOB
      {
        const e = this.entities.get("fob-valkyra");
        if (e) {
          const pulse = Math.floor(t / 14) % 4;
          const possession: PossessionId =
            pulse === 1 ? "contested" : pulse === 2 ? "lonestar" : "valkyra";
          this.entities.set("fob-valkyra", {
            ...e,
            possession,
            faction:
              possession === "lonestar"
                ? "lonestar"
                : possession === "valkyra"
                  ? "valkyra"
                  : "unknown",
            updatedAt: Date.now(),
          });
        }
      }

      // Hot zone drifts inside the overall circle (yellow magnet).
      {
        const hz = this.entities.get("hotzone-1");
        if (hz) {
          const hx = cx + Math.cos(t * 0.11) * spanX * 0.18;
          const hy = cy + Math.sin(t * 0.09) * spanY * 0.16;
          this.entities.set("hotzone-1", {
            ...hz,
            world: { x: hx, y: hy },
            radiusCm: 28000 + Math.sin(t * 0.2) * 4000,
            updatedAt: Date.now(),
          });
        }
      }

      for (const [id, e] of this.entities) {
        if (e.type !== "player" && e.type !== "vehicle") continue;

        const phase = hashId(id);
        const home =
          e.faction === "valkyra"
            ? { ox: cx + spanX * 0.35, oy: cy + spanY * 0.22 }
            : e.faction === "manticore"
              ? { ox: cx - spanX * 0.4, oy: cy - spanY * 0.3 }
              : { ox: cx - spanX * 0.05, oy: cy };

        const ampX = spanX * 0.08;
        const ampY = spanY * 0.08;
        const nx = home.ox + Math.cos(t * 0.32 + phase) * ampX * (1 + (phase % 3) * 0.2);
        const ny = home.oy + Math.sin(t * 0.26 + phase * 1.3) * ampY * (1 + (phase % 2) * 0.25);

        const prev = this.prevPos.get(id) ?? { x: nx, y: ny };
        const dx = nx - prev.x;
        const dy = ny - prev.y;
        let yaw = e.yaw ?? 0;
        if (dx * dx + dy * dy > 50) {
          yaw = (Math.atan2(dy, dx) * 180) / Math.PI;
        }
        this.prevPos.set(id, { x: nx, y: ny });

        this.entities.set(id, {
          ...e,
          world: { ...e.world, x: nx, y: ny },
          yaw,
          updatedAt: Date.now(),
        });
      }

      // Synthetic fight feed so Match Ops has something to show without provider kill offsets.
      if (Math.floor(t) % 8 === 0 && Math.floor(t * 20) % 20 === 0) {
        const players = [...this.entities.values()].filter(
          (e) => e.type === "player" && !e.isSelf
        );
        if (players.length >= 2) {
          const a = players[Math.floor(t * 3) % players.length]!;
          const b = players[Math.floor(t * 5 + 1) % players.length]!;
          if (a.id !== b.id) {
            const kind = Math.floor(t / 8) % 3 === 0 ? "down" : "kill";
            this.pushEvents([
              {
                id: `mock-${kind}-${Math.floor(t)}`,
                kind,
                t: Date.now(),
                actorId: a.id,
                actorName: a.name,
                actorFaction: resolveFaction(a),
                targetId: b.id,
                targetName: b.name,
                targetFaction: resolveFaction(b),
                weapon: ["AS Val", "AK", "DMR", "Havoc cannon"][
                  Math.floor(t) % 4
                ],
                rangeM: 40 + (Math.floor(t * 17) % 220),
              },
            ]);
          }
        }
      }

      this.emit();
    }, 50);
  }
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 1000;
}

export function getEntityStore(): EntityStore {
  if (!globalThis.__wardogsEntityStore) {
    globalThis.__wardogsEntityStore = new EntityStore();
  }
  const store = globalThis.__wardogsEntityStore;
  store.ensureMockRunning();
  return store;
}
