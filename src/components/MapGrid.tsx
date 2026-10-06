"use client";

import { useMemo, type ReactNode } from "react";
import { majorGridPx, subGridPx, type MapDefinition } from "@/lib/maps";

/**
 * Procedural grid — DA_TacticalMap 1000 m / SubGrid 10, Grid Strength 0.05.
 * Texture-aligned (0,0) to sit on baked VT lines.
 */
export function MapGrid({
  map,
  scale,
}: {
  map: MapDefinition;
  scale: number;
}) {
  const major = majorGridPx(map);
  const sub = subGridPx(map);
  const size = map.imageSize;
  const ox = 0;
  const oy = 0;

  const majorScreen = major * scale;
  const subScreen = sub * scale;

  // MI Strength 0.05 — keep faint like the in-game sheet.
  const majorAlpha =
    majorScreen < 10 ? 0 : Math.min(0.22, ((majorScreen - 10) / 40) * 0.35);
  const subAlpha =
    subScreen < 14 ? 0 : Math.min(0.1, ((subScreen - 14) / 50) * 0.18);

  const lines = useMemo(() => {
    const out: ReactNode[] = [];

    if (subAlpha > 0.002) {
      for (let x = ox; x <= size; x += sub) {
        const phase = ((x - ox) / major) % 1;
        if (phase < 1e-6 || phase > 1 - 1e-6) continue;
        out.push(
          <line
            key={`sv-${x}`}
            x1={x}
            y1={0}
            x2={x}
            y2={size}
            stroke={`rgba(255,255,255,${subAlpha})`}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      }
      for (let y = oy; y <= size; y += sub) {
        const phase = ((y - oy) / major) % 1;
        if (phase < 1e-6 || phase > 1 - 1e-6) continue;
        out.push(
          <line
            key={`sh-${y}`}
            x1={0}
            y1={y}
            x2={size}
            y2={y}
            stroke={`rgba(255,255,255,${subAlpha})`}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        );
      }
    }

    if (majorAlpha > 0.002) {
      for (let x = ox; x <= size; x += major) {
        out.push(
          <line
            key={`mv-${x}`}
            x1={x}
            y1={0}
            x2={x}
            y2={size}
            stroke={`rgba(255,255,255,${majorAlpha})`}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        );
      }
      for (let y = oy; y <= size; y += major) {
        out.push(
          <line
            key={`mh-${y}`}
            x1={0}
            y1={y}
            x2={size}
            y2={y}
            stroke={`rgba(255,255,255,${majorAlpha})`}
            strokeWidth={1.25}
            vectorEffect="non-scaling-stroke"
          />
        );
      }
    }

    return out;
  }, [major, sub, size, ox, oy, majorAlpha, subAlpha]);

  return (
    <svg
      className="map-grid"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      {lines}
    </svg>
  );
}
