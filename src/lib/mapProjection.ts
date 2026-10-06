import type { MapDefinition } from "./maps";
import { worldExtent } from "./maps";

export interface Uv {
  u: number;
  v: number;
}

/** DA_UI_* formula: UVOffset remapped from normalized world position. */
export function worldToUv(
  map: MapDefinition,
  x: number,
  y: number
): Uv {
  const { bounds, uvOffset } = map;
  const { width, height } = worldExtent(bounds);
  const nx = width === 0 ? 0 : (x - bounds.minX) / width;
  const ny = height === 0 ? 0 : (y - bounds.minY) / height;
  return {
    u: uvOffset.minU + nx * (uvOffset.maxU - uvOffset.minU),
    v: uvOffset.minV + ny * (uvOffset.maxV - uvOffset.minV),
  };
}

export function uvToWorld(map: MapDefinition, u: number, v: number) {
  const { bounds, uvOffset } = map;
  const { width, height } = worldExtent(bounds);
  const du = uvOffset.maxU - uvOffset.minU;
  const dv = uvOffset.maxV - uvOffset.minV;
  const nx = du === 0 ? 0 : (u - uvOffset.minU) / du;
  const ny = dv === 0 ? 0 : (v - uvOffset.minV) / dv;
  return {
    x: bounds.minX + nx * width,
    y: bounds.minY + ny * height,
  };
}

/** Pixel position on the map image (origin top-left, V grows downward like image). */
export function worldToImagePx(
  map: MapDefinition,
  x: number,
  y: number
): { px: number; py: number } {
  const { u, v } = worldToUv(map, x, y);
  // UVOffset remaps within the VT atlas; multiply by native SizeX.
  return {
    px: u * map.imageSize,
    py: v * map.imageSize,
  };
}

export function imagePxToWorld(
  map: MapDefinition,
  px: number,
  py: number
) {
  return uvToWorld(map, px / map.imageSize, py / map.imageSize);
}

/**
 * CSS transform scale so `viewSizeM` meters of world span `viewportPx` screen pixels.
 * Identical to in-game ViewSize ↔ orthographic width (DA_TacticalMap).
 */
export function scaleForViewSizeM(
  map: MapDefinition,
  viewSizeM: number,
  viewportPx: number
): number {
  const mapPx = (viewSizeM * 100) / map.worldUnitsPerPixel;
  if (mapPx <= 0 || viewportPx <= 0) return 1;
  return viewportPx / mapPx;
}

/** Inverse: meters of world visible across `viewportPx` at the current scale. */
export function viewSizeMForScale(
  map: MapDefinition,
  scale: number,
  viewportPx: number
): number {
  if (scale <= 0) return Infinity;
  const mapPxVisible = viewportPx / scale;
  return (mapPxVisible * map.worldUnitsPerPixel) / 100;
}

export function formatMapCoords(x: number, y: number): string {
  // DA_TacticalMap MarkCoordinatesFormat: "x{XCoord}, y{YCoord}"
  return `x${Math.round(x)}, y${Math.round(y)}`;
}
