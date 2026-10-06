import type {
  FactionId,
  LiveEntity,
  MatchEvent,
  MatchStats,
  TelemetryBundle,
} from "./protocol";
import { resolveFaction } from "./protocol";
import { FACTION_LABELS } from "./teams";

const FACTIONS: FactionId[] = ["lonestar", "valkyra", "manticore", "unknown"];

export function emptyFactionBucket(): MatchStats["byFaction"] {
  return {
    lonestar: { alive: 0, down: 0, dead: 0, kills: 0 },
    valkyra: { alive: 0, down: 0, dead: 0, kills: 0 },
    manticore: { alive: 0, down: 0, dead: 0, kills: 0 },
    unknown: { alive: 0, down: 0, dead: 0, kills: 0 },
  };
}

export function computeMatchStats(
  entities: LiveEntity[],
  events: MatchEvent[]
): MatchStats {
  const byFaction = emptyFactionBucket();
  let playersAlive = 0;
  let playersDown = 0;
  let playersDead = 0;
  let vehiclesLive = 0;

  for (const e of entities) {
    if (e.type === "vehicle" && !e.vehicleDestroyed) vehiclesLive++;
    if (e.type !== "player" && e.type !== "corpse") continue;
    const f = resolveFaction(e);
    const dead = e.type === "corpse" || e.lifeState === "dead";
    const down = !dead && e.lifeState === "downed";
    if (dead) {
      playersDead++;
      byFaction[f].dead++;
    } else if (down) {
      playersDown++;
      byFaction[f].down++;
    } else {
      playersAlive++;
      byFaction[f].alive++;
    }
  }

  let kills = 0;
  let downs = 0;
  let revives = 0;
  for (const ev of events) {
    if (ev.kind === "kill") {
      kills++;
      if (ev.actorFaction && byFaction[ev.actorFaction]) {
        byFaction[ev.actorFaction].kills++;
      }
    } else if (ev.kind === "down") downs++;
    else if (ev.kind === "revive") revives++;
  }

  return {
    playersAlive,
    playersDown,
    playersDead,
    vehiclesLive,
    kills,
    downs,
    revives,
    byFaction,
  };
}

export function buildTelemetry(
  entities: LiveEntity[],
  events: MatchEvent[],
  meta?: { matchId?: string; mapId?: string; startedAt?: number }
): TelemetryBundle {
  const capped = events.slice(-200);
  return {
    events: capped,
    stats: computeMatchStats(entities, capped),
    matchId: meta?.matchId,
    mapId: meta?.mapId,
    startedAt: meta?.startedAt,
  };
}

export interface RosterRow {
  id: string;
  name: string;
  faction: FactionId;
  factionLabel: string;
  life: "alive" | "downed" | "dead" | "unknown";
  hp?: number;
  maxHp?: number;
  inVehicle?: boolean;
  vehicleName?: string;
  isSelf?: boolean;
  isSquad?: boolean;
  squadId?: string | number;
  kills: number;
}

export function buildRoster(
  entities: LiveEntity[],
  events: MatchEvent[]
): RosterRow[] {
  const killsById = new Map<string, number>();
  for (const ev of events) {
    if (ev.kind !== "kill" || !ev.actorId) continue;
    killsById.set(ev.actorId, (killsById.get(ev.actorId) ?? 0) + 1);
  }

  const rows: RosterRow[] = [];
  for (const e of entities) {
    if (e.type !== "player" && e.type !== "corpse") continue;
    const faction = resolveFaction(e);
    const dead = e.type === "corpse" || e.lifeState === "dead";
    const life = dead
      ? "dead"
      : e.lifeState === "downed"
        ? "downed"
        : e.lifeState === "alive"
          ? "alive"
          : "unknown";
    rows.push({
      id: e.id,
      name: e.name || e.id.slice(0, 10),
      faction,
      factionLabel: FACTION_LABELS[faction],
      life,
      hp: e.hp,
      maxHp: e.maxHp,
      inVehicle: e.inVehicle,
      vehicleName: e.vehicleName,
      isSelf: e.isSelf,
      isSquad: e.isSquad,
      squadId: e.squadId,
      kills: killsById.get(e.id) ?? 0,
    });
  }

  rows.sort((a, b) => {
    const order: Record<string, number> = {
      lonestar: 0,
      valkyra: 1,
      manticore: 2,
      unknown: 3,
    };
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const fa = order[a.faction] ?? 9;
    const fb = order[b.faction] ?? 9;
    if (fa !== fb) return fa - fb;
    if (a.isSquad !== b.isSquad) return a.isSquad ? -1 : 1;
    return b.kills - a.kills || a.name.localeCompare(b.name);
  });
  return rows;
}

export function formatEventLine(ev: MatchEvent): string {
  if (ev.text) return ev.text;
  const a = ev.actorName || "???";
  const t = ev.targetName || "???";
  switch (ev.kind) {
    case "kill":
      return `${a} killed ${t}${ev.weapon ? ` [${ev.weapon}]` : ""}${
        ev.rangeM != null ? ` @ ${Math.round(ev.rangeM)}m` : ""
      }`;
    case "down":
      return `${a} downed ${t}${ev.weapon ? ` [${ev.weapon}]` : ""}`;
    case "revive":
      return `${a} revived ${t}`;
    case "vehicle_claim":
      return `${a} took ${ev.vehicle || "vehicle"}`;
    case "vehicle_destroy":
      return `${ev.vehicle || "vehicle"} destroyed${a !== "???" ? ` (${a})` : ""}`;
    case "join":
      return `${a} joined`;
    case "leave":
      return `${a} left`;
    case "ping":
      return `${a} pinged`;
    default:
      return ev.text || `${a}`;
  }
}

/** Infer down/kill/revive from consecutive entity snapshots (no provider killfeed yet). */
export function inferLifeEvents(
  prev: Map<string, LiveEntity>,
  next: LiveEntity[],
  now: number
): MatchEvent[] {
  const out: MatchEvent[] = [];
  const nextMap = new Map(next.map((e) => [e.id, e]));

  for (const e of next) {
    if (e.type !== "player" && e.type !== "corpse") continue;
    const old = prev.get(e.id);
    if (!old) {
      if (e.type === "player" && !e.isSelf) {
        out.push({
          id: `join-${e.id}-${now}`,
          kind: "join",
          t: now,
          actorId: e.id,
          actorName: e.name,
          actorFaction: resolveFaction(e),
        });
      }
      continue;
    }
    const wasDead = old.type === "corpse" || old.lifeState === "dead";
    const isDead = e.type === "corpse" || e.lifeState === "dead";
    const wasDown = old.lifeState === "downed";
    const isDown = e.lifeState === "downed";

    if (!wasDown && isDown && !isDead) {
      out.push({
        id: `down-${e.id}-${now}`,
        kind: "down",
        t: now,
        targetId: e.id,
        targetName: e.name,
        targetFaction: resolveFaction(e),
      });
    }
    if (!wasDead && isDead) {
      out.push({
        id: `kill-${e.id}-${now}`,
        kind: "kill",
        t: now,
        targetId: e.id,
        targetName: e.name,
        targetFaction: resolveFaction(e),
      });
    }
    if ((wasDown || wasDead) && !isDown && !isDead && e.lifeState === "alive") {
      out.push({
        id: `revive-${e.id}-${now}`,
        kind: "revive",
        t: now,
        targetId: e.id,
        targetName: e.name,
        targetFaction: resolveFaction(e),
      });
    }
  }

  for (const [id, old] of prev) {
    if (old.type !== "player") continue;
    if (nextMap.has(id)) continue;
    out.push({
      id: `leave-${id}-${now}`,
      kind: "leave",
      t: now,
      actorId: id,
      actorName: old.name,
      actorFaction: resolveFaction(old),
    });
  }

  return out;
}

export { FACTIONS };
