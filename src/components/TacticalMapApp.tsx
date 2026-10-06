"use client";

import { useMemo, useRef, useState } from "react";
import { useLiveEntities } from "@/hooks/useLiveEntities";
import { TacticalMapCanvas } from "@/components/TacticalMapCanvas";
import { LegendPanel, type LayerKey } from "@/components/LegendPanel";
import { MatchOpsPanel } from "@/components/MatchOpsPanel";
import { detectMapFromEntities, type MapDefinition } from "@/lib/maps";
import { formatMapCoords } from "@/lib/mapProjection";

export function TacticalMapApp() {
  const { entities, telemetry, source, connected, serverTime } =
    useLiveEntities();
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({
    players: true,
    vehicles: true,
    world: true,
  });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [legendOpen, setLegendOpen] = useState(false);
  const [opsOpen, setOpsOpen] = useState(true);
  const mapRef = useRef<MapDefinition | null>(null);

  const map = useMemo(() => {
    const next = detectMapFromEntities(entities);
    if (mapRef.current && mapRef.current.id === next.id) return mapRef.current;
    mapRef.current = next;
    return next;
  }, [entities]);

  const toggle = (key: LayerKey) =>
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));

  const players = entities.filter((e) => e.type === "player").length;
  const vehicles = entities.filter((e) => e.type === "vehicle").length;
  const clock = serverTime
    ? new Date(serverTime).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <div
      className={`tac-root ${opsOpen ? "ops-open" : ""} ${legendOpen ? "legend-open" : ""}`}
    >
      <header className="tac-topbar">
        <div className="brand-block">
          <div className="brand">WARDOGS</div>
          <div className="brand-sub">Tactical · {map.label}</div>
        </div>

        <div className="hud-strip" aria-label="Status">
          <div className={`hud-cell link ${connected ? "live" : "dead"}`}>
            <span className="hud-label">Link</span>
            <span className="hud-value">{connected ? "LIVE" : "DOWN"}</span>
          </div>
          <div className="hud-cell">
            <span className="hud-label">Src</span>
            <span className="hud-value">{source.toUpperCase()}</span>
          </div>
          <div className="hud-cell">
            <span className="hud-label">Ent</span>
            <span className="hud-value">
              {entities.length}
              <span className="hud-soft">
                {" "}
                · P{players} V{vehicles}
              </span>
            </span>
          </div>
          <div className="hud-cell">
            <span className="hud-label">Time</span>
            <span className="hud-value">{clock}</span>
          </div>
          <div className="hud-cell kills">
            <span className="hud-label">Kills</span>
            <span className="hud-value">{telemetry.stats.kills}</span>
          </div>
          {!map.hasTiles && (
            <div className="hud-cell warn">
              <span className="hud-label">Map</span>
              <span className="hud-value">BOUNDS</span>
            </div>
          )}
        </div>

        <div className="coords-readout mono" title="Cursor world XY">
          {cursor ? formatMapCoords(cursor.x, cursor.y) : "x ———  y ———"}
        </div>

        <div className="topbar-actions">
          <button
            type="button"
            className={`tb-btn ${opsOpen ? "on" : ""}`}
            onClick={() => setOpsOpen((v) => !v)}
            title="Match Ops"
          >
            OPS
          </button>
          <button
            type="button"
            className={`tb-btn ${legendOpen ? "on" : ""}`}
            onClick={() => setLegendOpen((v) => !v)}
            title="Layers & legend"
          >
            LEGEND
          </button>
        </div>
      </header>

      <div className="tac-viewport">
        <TacticalMapCanvas
          map={map}
          entities={entities}
          layers={layers}
          onCursorWorld={setCursor}
        />
        {opsOpen && (
          <MatchOpsPanel
            entities={entities}
            telemetry={telemetry}
            onClose={() => setOpsOpen(false)}
          />
        )}
        {legendOpen && <LegendPanel layers={layers} onToggle={toggle} />}
      </div>
    </div>
  );
}
