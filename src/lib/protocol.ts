/**
 * Live entity protocol for the tactical map ingest API.
 * Providers POST these shapes to /api/ingest.
 */

import {
  colorFromBGRA,
  factionColor,
  factionFromEnum,
  factionFromTeamId,
  possessionColor,
  type FactionId,
  type PossessionId,
} from "./teams";

export type { FactionId, PossessionId };

/** md::WorldKind (+ map-only kinds provider does not track yet) */
export type EntityType =
  | "player"
  | "vehicle"
  | "grenade"
  | "mine"
  | "deployable"
  | "corpse"
  | "fob"
  | "control_zone"
  | "spawn"
  | "supply"
  | "hotzone"
  | "ping"
  | "safezone"
  | "vendor"
  | "deployment_board"
  | "refuel"
  | "unknown";

export interface WorldPos {
  x: number;
  y: number;
  z?: number;
}

/**
 * One map contact. Prefer sending provider-native fields:
 *   factionEnum / genericTeamId / factionColorBGRA / squadId / lifeState / …
 */
export interface LiveEntity {
  id: string;
  type: EntityType;
  world: WorldPos;

  /** Actor root / pawn location yaw — derive from velocity or actor rotation when available. */
  yaw?: number;

  /**
   * provider roster can list a player before a world root is known.
   * false → keep in Match Ops; omit map marker. ESP Distance never sets this.
   */
  positionKnown?: boolean;

  // --- Faction (ActorMeta) ---
  /** md::Faction as string */
  faction?: FactionId;
  /** md::Faction underlying enum: Unknown=0, Lonestar=1, Valkyra=2, Manticore=3 */
  factionEnum?: 0 | 1 | 2 | 3;
  /** ActorMeta.genericTeamId (0/1/2) — FactionFromTeamId */
  genericTeamId?: number;
  /** ActorMeta.factionColorBGRA — live FactionData::Color when read OK */
  factionColorBGRA?: [number, number, number, number];
  /** ActorMeta.squadId — same squad as local when equal */
  squadId?: number | string;

  // --- Local relationship (DiscoveryState) ---
  /** pawn == DiscoveryState.localPawn */
  isSelf?: boolean;
  /** squadId matches local player's squad */
  isSquad?: boolean;

  // --- Vitality (PlayerPose) ---
  lifeState?: "unknown" | "alive" | "downed" | "dead";
  hp?: number;
  maxHp?: number;
  bleedout?: number;

  // --- Vehicle (PlayerPose / WorldMarker) ---
  inVehicle?: boolean;
  vehicleName?: string;
  vehicleDestroyed?: boolean;
  engineRunning?: boolean;
  occupants?: string;
  /** Held weapon display name from provider pose */
  weapon?: string;

  // --- Map UI (FOB / CZ / hotzone — provider WorldKind + possession/radiusCm) ---
  possession?: PossessionId;
  radiusCm?: number;

  name?: string;
  icon?: string;
  meta?: Record<string, unknown>;
  updatedAt: number;
}

/** Combat / match event — provider can POST these; web also infers from lifeState flips. */
export type MatchEventKind =
  | "kill"
  | "down"
  | "revive"
  | "vehicle_claim"
  | "vehicle_destroy"
  | "join"
  | "leave"
  | "ping"
  | "note";

export interface MatchEvent {
  id: string;
  kind: MatchEventKind;
  t: number;
  actorId?: string;
  actorName?: string;
  actorFaction?: FactionId;
  targetId?: string;
  targetName?: string;
  targetFaction?: FactionId;
  weapon?: string;
  vehicle?: string;
  rangeM?: number;
  text?: string;
}

export interface MatchStats {
  playersAlive: number;
  playersDown: number;
  playersDead: number;
  vehiclesLive: number;
  kills: number;
  downs: number;
  revives: number;
  byFaction: Record<
    FactionId,
    { alive: number; down: number; dead: number; kills: number }
  >;
}

export interface TelemetryBundle {
  events: MatchEvent[];
  stats: MatchStats;
  matchId?: string;
  mapId?: string;
  startedAt?: number;
}

export interface TelemetryMessage {
  type: "telemetry";
  /** Append events (newest last). */
  events?: MatchEvent[];
  /** Replace entire event log when true. */
  replaceEvents?: boolean;
  matchId?: string;
  mapId?: string;
  startedAt?: number;
  serverTime?: number;
}

export interface EntitySnapshotMessage {
  type: "snapshot";
  mapId?: string;
  entities: LiveEntity[];
  /** DiscoveryState.localFaction */
  localFaction?: FactionId;
  localFactionEnum?: 0 | 1 | 2 | 3;
  serverTime?: number;
  /** Optional: ship killfeed with the same tick */
  events?: MatchEvent[];
  matchId?: string;
  startedAt?: number;
}

export interface EntityDeltaMessage {
  type: "delta";
  upsert?: LiveEntity[];
  remove?: string[];
  serverTime?: number;
  events?: MatchEvent[];
}

export type IngestMessage =
  | EntitySnapshotMessage
  | EntityDeltaMessage
  | TelemetryMessage;

export interface LiveFeedFrame {
  type: "entities";
  entities: LiveEntity[];
  source: "mock" | "provider" | "mixed";
  serverTime: number;
  localFaction?: FactionId;
  telemetry?: TelemetryBundle;
}

export const ENTITY_ICON_DEFAULTS: Record<EntityType, string> = {
  player: "/icons/T_UI_Player_Icon.png",
  vehicle: "/icons/T_UI_Havoc_Icon_Packed.png",
  grenade: "/icons/T_UI_Map_Spotted_FOB.png",
  mine: "/icons/T_UI_Map_BuildableMagnet.png",
  deployable: "/icons/T_UI_Map_BuildableMagnet.png",
  corpse: "/icons/T_UI_PlayerDead_Icon.png",
  fob: "/icons/T_UI_FOB_Temp.png",
  control_zone: "/icons/T_UI_FOB_Temp.png",
  spawn: "/icons/T_UI_MapTracker_SpawnVehicle.png",
  supply: "/icons/T_UI_SupplyPallet_Icon.png",
  hotzone: "/icons/T_UI_Map_Spotted_HotzoneMagnet.png",
  ping: "/icons/T_UI_Map_Spotted_FOB.png",
  safezone: "/icons/T_UI_VisionCone.png",
  vendor: "/icons/T_UI_SupplyPallet_Icon.png",
  deployment_board: "/icons/T_UI_MapTracker_SpawnVehicle.png",
  refuel: "/icons/T_UI_Repair_Icon_Packed.png",
  unknown: "/icons/T_UI_FriendlyMarker_Map_Icon_Packed.png",
};

export function resolveFaction(e: LiveEntity): FactionId {
  if (e.factionEnum != null) return factionFromEnum(e.factionEnum);
  if (e.genericTeamId != null && e.genericTeamId !== 0xff) {
    return factionFromTeamId(e.genericTeamId);
  }
  if (
    e.faction === "lonestar" ||
    e.faction === "valkyra" ||
    e.faction === "manticore" ||
    e.faction === "unknown"
  ) {
    return e.faction;
  }
  return "unknown";
}

export function resolveEntityIcon(e: LiveEntity): string {
  if (e.icon) return e.icon;
  const faction = resolveFaction(e);

  if (e.type === "corpse" || e.lifeState === "dead") {
    return "/icons/T_UI_PlayerDead_Icon.png";
  }
  if (e.type === "player") {
    if (e.isSelf) return "/icons/player_dot_self.png";
    return `/icons/player_dot_${faction}.png`;
  }
  const vn = (e.vehicleName ?? e.name ?? "").toLowerCase();
  if (e.type === "vehicle") {
    if (
      vn.includes("havoc") ||
      vn.includes("rotary") ||
      vn.includes("heli") ||
      vn.includes("lakota") ||
      vn.includes("ah-6") ||
      vn.includes("mh-6") ||
      vn.includes("z20")
    ) {
      return `/icons/heli_${faction === "unknown" ? "unknown" : faction}.png`;
    }
    if (vn.includes("kodiak")) return "/icons/T_UI_Kodiak_Icon_Packed.png";
    if (vn.includes("phalanx") || vn.includes("stingray")) {
      return "/icons/T_UI_MapTracker_Phalanx.png";
    }
  }
  if (e.type === "fob" || e.type === "control_zone") {
    return "/icons/T_UI_FOB_Temp.png";
  }
  return ENTITY_ICON_DEFAULTS[e.type] ?? ENTITY_ICON_DEFAULTS.unknown;
}

export function entityDisplayColor(e: LiveEntity): string {
  if (e.type === "hotzone") return "#FFF700";
  if (e.type === "safezone") return "#6EBEFF";
  if (e.lifeState === "downed") return "#FF8C1E"; // renderer.cpp downed tint
  if (e.lifeState === "dead") return "#8C8C8C";

  if (e.type === "fob" || e.type === "control_zone" || e.type === "spawn") {
    if (e.possession) return possessionColor(e.possession);
  }

  const live = colorFromBGRA(e.factionColorBGRA);
  if (live) return live;

  return factionColor(resolveFaction(e));
}
