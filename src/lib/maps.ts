/** Extracted from DA_UI_* (WDMinimapTextureData) — do not invent. */

export interface MapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface MapDefinition {
  id: string;
  label: string;
  /** Native VT pixel size — plane is this big; tiles fill it when present. */
  imageSize: number;
  sourceSizeX: number;
  tileSize: number;
  maxZoom: number;
  /** Template: /maps/kavkazi/{z}/{y}/{x}.jpg — empty = no raster tiles yet */
  tileUrl: string;
  /** Single full-plane raster when tile pyramid isn't ready / missing. */
  overviewUrl?: string;
  hasTiles: boolean;
  bounds: MapBounds;
  uvOffset: { minU: number; minV: number; maxU: number; maxV: number };
  /** Unreal cm per texture pixel */
  worldUnitsPerPixel: number;
  gridTileSizeM: number;
  subGridAmount: number;
  gridStrength: number;
  largestViewSizeM: number;
  smallestViewSizeM: number;
  zoomPresetsM: number[];
}

const TACTICAL_ZOOM = {
  gridTileSizeM: 1000,
  subGridAmount: 10,
  gridStrength: 0.05,
  largestViewSizeM: 8000,
  smallestViewSizeM: 200,
  zoomPresetsM: [200, 400, 800, 1200, 2000, 3000, 5000],
} as const;

export const KAVKAZI: MapDefinition = {
  id: "Kavkazi",
  label: "KAVKAZI",
  imageSize: 16384,
  sourceSizeX: 16384,
  tileSize: 512,
  maxZoom: 5,
  tileUrl: "/maps/kavkazi/{z}/{y}/{x}.jpg",
  overviewUrl: "/maps/kavkazi/0/0/0.jpg",
  hasTiles: true,
  bounds: {
    minX: -1632000.0,
    minY: -2040000.0,
    maxX: 0.0,
    maxY: -408000.0,
  },
  uvOffset: { minU: 0, minV: 0, maxU: 1, maxV: 1 },
  worldUnitsPerPixel: 100,
  ...TACTICAL_ZOOM,
};

/** DA_UI_NorthAmerica — native VT 32768; web tile pyramid from mip0. */
export const NORTH_AMERICA: MapDefinition = {
  id: "NorthAmerica",
  label: "NORTH AMERICA",
  imageSize: 32768,
  sourceSizeX: 32768,
  tileSize: 512,
  maxZoom: 6,
  tileUrl: "/maps/northamerica/{z}/{y}/{x}.jpg",
  overviewUrl: "/maps/northamerica_overview.jpg",
  hasTiles: true,
  bounds: {
    minX: -819200.0,
    minY: -819200.0,
    maxX: 819200.0,
    maxY: 819200.0,
  },
  uvOffset: { minU: 0, minV: 0, maxU: 1, maxV: 1 },
  worldUnitsPerPixel: 50, // 1638400 / 32768
  ...TACTICAL_ZOOM,
};

/** DA_UI_Europe — VT not exported yet. */
export const EUROPE: MapDefinition = {
  id: "Europe",
  label: "EUROPE",
  imageSize: 16384,
  sourceSizeX: 32768,
  tileSize: 512,
  maxZoom: 0,
  tileUrl: "",
  hasTiles: false,
  bounds: {
    minX: -1616000.0,
    minY: -1616000.0,
    maxX: 16000.0,
    maxY: 16000.0,
  },
  uvOffset: { minU: 0, minV: 0, maxU: 1, maxV: 1 },
  worldUnitsPerPixel: 100, // 1632000 / 16384
  ...TACTICAL_ZOOM,
};

/** DA_UI_Russia — same bounds as Kavkazi, higher-res VT (not exported). */
export const RUSSIA: MapDefinition = {
  id: "Russia",
  label: "RUSSIA",
  imageSize: 16384,
  sourceSizeX: 32768,
  tileSize: 512,
  maxZoom: 0,
  tileUrl: "",
  hasTiles: false,
  bounds: KAVKAZI.bounds,
  uvOffset: { minU: 0, minV: 0, maxU: 1, maxV: 1 },
  worldUnitsPerPixel: 100,
  ...TACTICAL_ZOOM,
};

export const ALL_MAPS: MapDefinition[] = [
  KAVKAZI,
  NORTH_AMERICA,
  EUROPE,
  RUSSIA,
];

/** Prefer Kavkazi when it fits (has tiles); else best enclosing DA_UI bounds. */
export function detectMapFromWorld(x: number, y: number): MapDefinition {
  const scored = ALL_MAPS.map((m) => {
    const { bounds } = m;
    const inside =
      x >= bounds.minX &&
      x <= bounds.maxX &&
      y >= bounds.minY &&
      y <= bounds.maxY;
    if (!inside) return { m, score: -1 };
    const { width, height } = worldExtent(bounds);
    // Prefer tighter fit; bonus for real tiles.
    const nx = (x - bounds.minX) / width;
    const ny = (y - bounds.minY) / height;
    const edge = Math.min(nx, 1 - nx, ny, 1 - ny);
    const score = edge * 10 + (m.hasTiles ? 2 : 0);
    return { m, score };
  }).filter((s) => s.score >= 0);

  if (scored.length === 0) return NORTH_AMERICA; // live coords currently fall here
  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.m;
}

export function detectMapFromEntities(
  entities: { world: { x: number; y: number }; isSelf?: boolean }[]
): MapDefinition {
  const self = entities.find((e) => e.isSelf);
  const sample = self ?? entities.find((e) => e.world.x !== 0 || e.world.y !== 0);
  if (!sample) return KAVKAZI;
  return detectMapFromWorld(sample.world.x, sample.world.y);
}

/** @deprecated use detectMapFromEntities — kept for older imports */
export const ACTIVE_MAP = KAVKAZI;

export function worldExtent(b: MapBounds) {
  return {
    width: b.maxX - b.minX,
    height: b.maxY - b.minY,
  };
}

export function majorGridPx(map: MapDefinition): number {
  return (map.gridTileSizeM * 100) / map.worldUnitsPerPixel;
}

export function subGridPx(map: MapDefinition): number {
  return majorGridPx(map) / map.subGridAmount;
}

export function tileSrc(map: MapDefinition, z: number, x: number, y: number) {
  if (!map.tileUrl) return "";
  return map.tileUrl
    .replace("{z}", String(z))
    .replace("{x}", String(x))
    .replace("{y}", String(y));
}
