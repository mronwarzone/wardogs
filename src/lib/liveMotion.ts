/**
 * Shared motion bus — ESP-style.
 * provider samples update targets; a RAF loop coasts + paints DOM transforms.
 * React only remounts when the roster (ids / labels) changes.
 */

import type { LiveEntity, LiveFeedFrame, TelemetryBundle } from "./protocol";
import { buildTelemetry } from "./telemetry";
import { yawToCssRotate } from "./teams";

export type Track = {
  x: number;
  y: number;
  z: number;
  yaw: number;
  tx: number;
  ty: number;
  tz: number;
  tyaw: number;
  vx: number;
  vy: number;
  /** Consecutive rejected teleports — accept after 2 confirms. */
  outlierStreak: number;
  base: LiveEntity;
  t: number;
};

const EMPTY_TELEMETRY: TelemetryBundle = buildTelemetry([], []);

/** Critically damped chase — players stay snappy like overlay. */
const CHASE_PLAYER = 36;
/** Vehicles/helis: softer chase so residual sample noise doesn't thrash icons. */
const CHASE_VEHICLE = 12;
/** FOBs / zones barely move. */
const CHASE_STATIC = 8;
/** Coast on velocity between samples (provider WinHttp is often ~5–15 Hz). */
const COAST_SEC = 0.75;
const COAST_VEHICLE_SEC = 1.1;
const MAX_SPEED = 90000;
/** Heli/ground vehicle plausible ceiling (~250 m/s) + slack. */
const MAX_VEHICLE_SPEED = 28000;
/** Soften sample velocity so DMA jitter doesn't yank icons. */
const VEL_BLEND = 0.55;
const VEL_BLEND_VEHICLE = 0.35;
/** Ignore single-sample teleports under this (cm) unless confirmed. */
const VEHICLE_OUTLIER_CM = 4000;
/** Ignore yaw chatter below this (deg). */
const YAW_DEADBAND_DEG = 6;
const YAW_CHASE_VEHICLE = 8;

type RosterListener = () => void;
type MetaListener = (info: {
  telemetry: TelemetryBundle;
  source: LiveFeedFrame["source"];
  serverTime: number;
  connected: boolean;
}) => void;

const tracks = new Map<string, Track>();
const rosterListeners = new Set<RosterListener>();
const metaListeners = new Set<MetaListener>();
/** id → marker wrap element (position via transform). */
const markerEls = new Map<string, HTMLElement>();
/** id → yaw element inside marker (optional). */
const yawEls = new Map<string, HTMLElement>();

let telemetry: TelemetryBundle = EMPTY_TELEMETRY;
let source: LiveFeedFrame["source"] = "mock";
let serverTime = 0;
let connected = false;
let rosterVersion = 0;
let lastRosterKey = "";
let lastMetaEmit = 0;
let raf = 0;
let lastTick = 0;
let project:
  | ((x: number, y: number) => { px: number; py: number })
  | null = null;

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + 540) % 360) - 180;
  return a + d * t;
}

function angleDelta(a: number, b: number): number {
  return Math.abs(((b - a + 540) % 360) - 180);
}

function isVehicleLike(e: LiveEntity): boolean {
  return e.type === "vehicle";
}

function isStaticLike(e: LiveEntity): boolean {
  return (
    e.type === "fob" ||
    e.type === "control_zone" ||
    e.type === "hotzone" ||
    e.type === "safezone" ||
    e.type === "spawn" ||
    e.type === "supply"
  );
}

function chaseFor(e: LiveEntity): number {
  if (isVehicleLike(e)) return CHASE_VEHICLE;
  if (isStaticLike(e)) return CHASE_STATIC;
  return CHASE_PLAYER;
}

function rosterKey(entities: LiveEntity[]): string {
  // Identity + display fields only — pose does NOT belong here.
  // Vehicle names sticky-resolved in ingest so late FName fills don't remount.
  return entities
    .map((e) =>
      [
        e.id,
        e.type,
        e.name ?? "",
        e.faction ?? "",
        e.lifeState ?? "",
        e.isSelf ? 1 : 0,
        e.isSquad ? 1 : 0,
        e.positionKnown === false ? 0 : 1,
      ].join(":")
    )
    .join("|");
}

function emitMeta(force = false) {
  const now = performance.now();
  if (!force && now - lastMetaEmit < 100) return;
  lastMetaEmit = now;
  const info = { telemetry, source, serverTime, connected };
  for (const l of metaListeners) l(info);
}

function emitRoster() {
  for (const l of rosterListeners) l();
}

export function getTracks(): Map<string, Track> {
  return tracks;
}

/** Live smoothed self pose for camera follow / heading-up. */
export function getSelfTrack(): Track | null {
  for (const tr of tracks.values()) {
    if (tr.base.isSelf) return tr;
  }
  return null;
}

export function getRosterEntities(): LiveEntity[] {
  return [...tracks.values()].map((tr) => tr.base);
}

export function getRosterVersion(): number {
  return rosterVersion;
}

export function setProjector(
  fn: ((x: number, y: number) => { px: number; py: number }) | null
) {
  project = fn;
}

export function registerMarker(
  id: string,
  el: HTMLElement | null,
  yawEl?: HTMLElement | null
) {
  if (!el) {
    markerEls.delete(id);
    yawEls.delete(id);
    return;
  }
  markerEls.set(id, el);
  if (yawEl) yawEls.set(id, yawEl);
  else yawEls.delete(id);
  // Snap immediately so first frame isn't at 0,0
  const tr = tracks.get(id);
  if (tr && project) {
    const { px, py } = project(tr.x, tr.y);
    el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
  }
}

function tick(now: number) {
  const prev = lastTick || now;
  lastTick = now;
  const dt = Math.min(0.05, Math.max(0.001, (now - prev) / 1000));
  const proj = project;

  for (const tr of tracks.values()) {
    const hasWorld =
      tr.base.world &&
      tr.base.positionKnown !== false &&
      (tr.tx !== 0 || tr.ty !== 0 || tr.base.isSelf);
    if (!hasWorld) continue;

    const chase = chaseFor(tr.base);
    const alpha = 1 - Math.exp(-chase * dt);
    const coastSec = isVehicleLike(tr.base) ? COAST_VEHICLE_SEC : COAST_SEC;
    const age = Math.max(0, (now - tr.t) / 1000);
    const coast = Math.min(age, coastSec);
    const coastFade =
      age <= coastSec ? 1 : Math.max(0, 1 - (age - coastSec) / 0.35);
    const leadX = tr.tx + tr.vx * coast * coastFade;
    const leadY = tr.ty + tr.vy * coast * coastFade;
    tr.x += (leadX - tr.x) * alpha;
    tr.y += (leadY - tr.y) * alpha;
    tr.z += (tr.tz - tr.z) * alpha;

    const hasYaw =
      (typeof tr.base.yaw === "number" && Number.isFinite(tr.base.yaw)) ||
      Number.isFinite(tr.tyaw);
    if (hasYaw) {
      if (isVehicleLike(tr.base)) {
        if (angleDelta(tr.yaw, tr.tyaw) >= YAW_DEADBAND_DEG) {
          const yawAlpha = 1 - Math.exp(-YAW_CHASE_VEHICLE * dt);
          tr.yaw = lerpAngle(tr.yaw, tr.tyaw, yawAlpha);
        }
      } else {
        tr.yaw = lerpAngle(tr.yaw, tr.tyaw, alpha);
      }
    }

    const el = markerEls.get(tr.base.id);
    if (el && proj) {
      const { px, py } = proj(tr.x, tr.y);
      el.style.transform = `translate3d(${px}px, ${py}px, 0)`;
      const yawEl = yawEls.get(tr.base.id);
      if (yawEl) {
        // Map-relative facing only — HEAD rotates the map plane, never re-apply heading here.
        const css = yawToCssRotate(tr.yaw);
        yawEl.style.transform = `translate(-50%, -50%) rotate(${css}deg)`;
      }
    }
  }
}

function ensureLoop() {
  if (raf) return;
  const loop = (now: number) => {
    tick(now);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
}

export function stopMotionLoop() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  lastTick = 0;
}

function stickyVehicleLabel(e: LiveEntity, old?: Track): LiveEntity {
  if (!isVehicleLike(e) || !old) return e;
  const blank =
    !e.name || e.name === "vehicle" || e.name.toLowerCase() === "vehicle";
  if (!blank) return e;
  const keep = old.base.name;
  if (!keep || keep === "vehicle") return e;
  return {
    ...e,
    name: keep,
    vehicleName: old.base.vehicleName ?? e.vehicleName ?? keep,
  };
}

export function ingestLiveFrame(frame: LiveFeedFrame) {
  const now = performance.now();
  const prev = tracks;
  const next = new Map<string, Track>();

  for (const raw of frame.entities) {
    const old = prev.get(raw.id);
    const e = stickyVehicleLabel(raw, old);
    const wx = e.world?.x ?? 0;
    const wy = e.world?.y ?? 0;
    const wz = e.world?.z ?? 0;
    const wyaw = typeof e.yaw === "number" ? e.yaw : 0;
    const vehicle = isVehicleLike(e);

    let tx = wx;
    let ty = wy;
    let tz = wz;
    let tyaw = wyaw;
    let outlierStreak = 0;
    let vx = old?.vx ?? 0;
    let vy = old?.vy ?? 0;

    if (old && e.world && (old.tx !== 0 || old.ty !== 0 || e.isSelf)) {
      const sampleDt = Math.max(0.008, (now - old.t) / 1000);
      const dist = Math.hypot(wx - old.tx, wy - old.ty);

      if (vehicle) {
        const maxStep = MAX_VEHICLE_SPEED * sampleDt * 1.6 + 2000;
        const softOutlier = Math.max(VEHICLE_OUTLIER_CM, maxStep);
        if (dist > softOutlier && dist < 80000) {
          outlierStreak = (old.outlierStreak ?? 0) + 1;
          if (outlierStreak < 2) {
            // Hold previous target — don't chase source thrash.
            tx = old.tx;
            ty = old.ty;
            tz = old.tz;
            tyaw = old.tyaw;
            vx = old.vx;
            vy = old.vy;
          } else {
            outlierStreak = 0;
          }
        }
      }

      if (tx === wx && ty === wy) {
        const nx = (wx - old.tx) / sampleDt;
        const ny = (wy - old.ty) / sampleDt;
        const speedCap = vehicle ? MAX_VEHICLE_SPEED : MAX_SPEED;
        const blend = vehicle ? VEL_BLEND_VEHICLE : VEL_BLEND;
        if (Math.hypot(nx, ny) <= speedCap) {
          vx = old.vx * (1 - blend) + nx * blend;
          vy = old.vy * (1 - blend) + ny * blend;
        } else {
          vx = 0;
          vy = 0;
        }
      }
    }

    const jump =
      !old ||
      !e.world ||
      Math.hypot(wx - (old?.tx ?? wx), wy - (old?.ty ?? wy)) > 80000;

    next.set(e.id, {
      x: jump ? wx : old!.x,
      y: jump ? wy : old!.y,
      z: jump ? wz : old!.z,
      yaw: jump ? wyaw : old!.yaw,
      tx,
      ty,
      tz,
      tyaw,
      vx: jump ? 0 : vx,
      vy: jump ? 0 : vy,
      outlierStreak: jump ? 0 : outlierStreak,
      base: e,
      t: now,
    });
  }

  // Clear removed markers' DOM maps
  for (const id of markerEls.keys()) {
    if (!next.has(id)) {
      markerEls.delete(id);
      yawEls.delete(id);
    }
  }

  tracks.clear();
  for (const [k, v] of next) tracks.set(k, v);

  telemetry = frame.telemetry ?? EMPTY_TELEMETRY;
  source = frame.source;
  serverTime = frame.serverTime;
  connected = true;

  const key = rosterKey([...next.values()].map((tr) => tr.base));
  if (key !== lastRosterKey) {
    lastRosterKey = key;
    rosterVersion++;
    emitRoster();
  }
  emitMeta();
  ensureLoop();
}

export function setDisconnected() {
  connected = false;
  emitMeta(true);
}

export function subscribeRoster(fn: RosterListener): () => void {
  rosterListeners.add(fn);
  fn();
  ensureLoop();
  return () => rosterListeners.delete(fn);
}

export function subscribeMeta(fn: MetaListener): () => void {
  metaListeners.add(fn);
  fn({ telemetry, source, serverTime, connected });
  return () => metaListeners.delete(fn);
}

/** Snapshot for UI that still wants entity array (throttled by roster). */
export function snapshotEntitiesSmoothed(): LiveEntity[] {
  const out: LiveEntity[] = [];
  for (const tr of tracks.values()) {
    const hasWorld =
      tr.base.world &&
      tr.base.positionKnown !== false &&
      (tr.tx !== 0 || tr.ty !== 0 || tr.base.isSelf);
    if (!hasWorld) {
      out.push(tr.base);
      continue;
    }
    out.push({
      ...tr.base,
      world: { ...tr.base.world!, x: tr.x, y: tr.y, z: tr.z },
      yaw: typeof tr.base.yaw === "number" ? tr.yaw : tr.base.yaw,
    });
  }
  return out;
}
