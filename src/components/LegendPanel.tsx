"use client";

import type { EntityType } from "@/lib/protocol";
import { ENTITY_ICON_DEFAULTS } from "@/lib/protocol";
import { FACTION_COLORS, FACTION_LABELS, POSSESSION_COLORS } from "@/lib/teams";

const LEGEND: { type: EntityType; label: string }[] = [
  { type: "player", label: "Player" },
  { type: "vehicle", label: "Vehicle" },
  { type: "spawn", label: "Spawn" },
  { type: "fob", label: "FOB / Base" },
  { type: "control_zone", label: "Control Zone" },
  { type: "supply", label: "Supply" },
  { type: "hotzone", label: "Hot Zone" },
  { type: "safezone", label: "Safe / Overall" },
  { type: "corpse", label: "Corpse" },
];

export type LayerKey = "players" | "vehicles" | "world";

interface Props {
  layers: Record<LayerKey, boolean>;
  onToggle: (key: LayerKey) => void;
}

export function LegendPanel({ layers, onToggle }: Props) {
  return (
    <aside className="panel legend-panel" aria-label="Legend">
      <header className="panel-head">
        <span className="panel-title">LAYERS</span>
      </header>

      <div className="layer-toggles">
        {(
          [
            ["players", "Players"],
            ["vehicles", "Vehicles"],
            ["world", "World / Bases"],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className={`layer-row ${layers[key] ? "on" : ""}`}>
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => onToggle(key)}
            />
            <span className="layer-check" aria-hidden />
            <span>{label}</span>
          </label>
        ))}
      </div>

      <div className="panel-subhead">FACTIONS</div>
      <ul className="legend-list compact">
        {(["lonestar", "valkyra", "manticore"] as const).map((id) => (
          <li key={id}>
            <span
              className="team-swatch lg"
              style={{ background: FACTION_COLORS[id] }}
            />
            <span>{FACTION_LABELS[id]}</span>
          </li>
        ))}
      </ul>

      <div className="panel-subhead">POSSESSION</div>
      <ul className="legend-list compact">
        {(
          [
            ["lonestar", "Lonestar"],
            ["valkyra", "Valkyra"],
            ["manticore", "Manticore"],
            ["neutral", "Unowned"],
            ["contested", "Contested"],
          ] as const
        ).map(([id, label]) => (
          <li key={id}>
            <span
              className="team-swatch lg"
              style={{ background: POSSESSION_COLORS[id] }}
            />
            <span>{label}</span>
          </li>
        ))}
      </ul>

      <div className="panel-subhead">MARKERS</div>
      <ul className="legend-list icons">
        {LEGEND.map((row) => (
          <li key={row.type}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={ENTITY_ICON_DEFAULTS[row.type]} alt="" />
            <span>{row.label}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
