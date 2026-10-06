/**
 * Faction colours & IDs — mirrored from provider ESP
 * (`src/model/actor_meta.h`, `src/render/renderer.h`).
 *
 * enum class Faction : Unknown=0, Lonestar, Valkyra, Manticore
 * GenericTeamId 0/1/2 → Lonestar/Valkyra/Manticore
 * RenderSettings defaults: lonestarColor / valkyraColor / manticoreColor
 */

export type FactionId = "unknown" | "lonestar" | "valkyra" | "manticore";

/** Matches md::Faction enum underlying values (Unknown=0 … Manticore=3). */
export type FactionEnum = 0 | 1 | 2 | 3;

export function factionFromEnum(e: number | undefined | null): FactionId {
  switch (e) {
    case 1:
      return "lonestar";
    case 2:
      return "valkyra";
    case 3:
      return "manticore";
    default:
      return "unknown";
  }
}

/** Matches md::FactionFromTeamId(GenericTeamId). */
export function factionFromTeamId(id: number | undefined | null): FactionId {
  if (id === 0) return "lonestar";
  if (id === 1) return "valkyra";
  if (id === 2) return "manticore";
  return "unknown";
}

export function factionToEnum(f: FactionId): FactionEnum {
  switch (f) {
    case "lonestar":
      return 1;
    case "valkyra":
      return 2;
    case "manticore":
      return 3;
    default:
      return 0;
  }
}

/** md::RenderSettings defaults (renderer.h) */
export const FACTION_COLORS: Record<FactionId, string> = {
  lonestar: "#3796FF", // 55/255, 150/255, 1
  valkyra: "#FF4141", // 1, 65/255, 65/255
  manticore: "#3CE669", // 60/255, 230/255, 105/255
  unknown: "#C7C7C7", // unknownColor 0.78
};

export const FACTION_LABELS: Record<FactionId, string> = {
  lonestar: "Lonestar",
  valkyra: "Valkyra",
  manticore: "Manticore",
  unknown: "Unknown",
};

/** Control-zone DA colours (unowned / contested) — map UI only until provider reads FOBs. */
export const POSSESSION_COLORS = {
  lonestar: FACTION_COLORS.lonestar,
  valkyra: FACTION_COLORS.valkyra,
  manticore: FACTION_COLORS.manticore,
  neutral: "#BEBEBE",
  contested: "#9F9F9E",
} as const;

export type PossessionId = keyof typeof POSSESSION_COLORS;

export function factionColor(f?: FactionId | string | null): string {
  if (!f) return FACTION_COLORS.unknown;
  const key = String(f).toLowerCase() as FactionId;
  return FACTION_COLORS[key] ?? FACTION_COLORS.unknown;
}

export function possessionColor(p?: PossessionId | string | null): string {
  if (!p) return POSSESSION_COLORS.neutral;
  const key = String(p).toLowerCase() as PossessionId;
  return POSSESSION_COLORS[key] ?? POSSESSION_COLORS.neutral;
}

/** ActorMeta.factionColorBGRA → CSS #RRGGBB (game FactionData::Color when provider has it). */
export function colorFromBGRA(bgra?: number[] | Uint8Array | null): string | null {
  if (!bgra || bgra.length < 3) return null;
  const b = bgra[0]!,
    g = bgra[1]!,
    r = bgra[2]!;
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * UE / provider yaw → CSS rotate for a tip-up arrow.
 *
 * Basis (verified vs live provider: camera.rotation.y and atan2(dy,dx)):
 *   yaw 0° = +world X, +90° = +world Y
 * worldToImagePx: +X → right, +Y → down (V grows with Y)
 * CSS: 0° = up (image −Y), positive = clockwise
 *
 * Screen forward = (cos yaw, sin yaw) in image px → CSS = atan2(fx, −fy) = yaw + 90.
 * (Not −yaw+90: that would point opposite +Y motion on this projection.)
 */
export function yawToCssRotate(yawDeg?: number): number {
  if (yawDeg == null || Number.isNaN(yawDeg)) return 0;
  return yawDeg + 90;
}
