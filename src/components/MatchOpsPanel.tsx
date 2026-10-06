"use client";

import { Fragment, useMemo, useState, type CSSProperties } from "react";
import type { FactionId, LiveEntity, TelemetryBundle } from "@/lib/protocol";
import {
  buildRoster,
  formatEventLine,
  type RosterRow,
} from "@/lib/telemetry";
import { FACTION_COLORS, FACTION_LABELS } from "@/lib/teams";

type Tab = "roster" | "feed" | "stats";
type SortMode = "team" | "kills" | "name" | "state";

const TEAM_ORDER: FactionId[] = [
  "lonestar",
  "valkyra",
  "manticore",
  "unknown",
];

const LIFE_RANK: Record<RosterRow["life"], number> = {
  alive: 0,
  downed: 1,
  unknown: 2,
  dead: 3,
};

interface Props {
  entities: LiveEntity[];
  telemetry: TelemetryBundle;
  onClose?: () => void;
}

function lifeClass(life: RosterRow["life"]) {
  if (life === "alive") return "life-alive";
  if (life === "downed") return "life-down";
  if (life === "dead") return "life-dead";
  return "life-unk";
}

function fmtDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

function compareRows(a: RosterRow, b: RosterRow, sort: SortMode) {
  if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
  if (sort === "kills") {
    return b.kills - a.kills || a.name.localeCompare(b.name);
  }
  if (sort === "name") return a.name.localeCompare(b.name);
  if (sort === "state") {
    return (
      LIFE_RANK[a.life] - LIFE_RANK[b.life] ||
      b.kills - a.kills ||
      a.name.localeCompare(b.name)
    );
  }
  // team: within-group order
  if (a.isSquad !== b.isSquad) return a.isSquad ? -1 : 1;
  return (
    LIFE_RANK[a.life] - LIFE_RANK[b.life] ||
    b.kills - a.kills ||
    a.name.localeCompare(b.name)
  );
}

function RosterRowView({ r }: { r: RosterRow }) {
  return (
    <tr className={`${lifeClass(r.life)} ${r.isSelf ? "is-you" : ""}`}>
      <td>
        <span className="roster-name">
          {r.isSelf ? "★ " : r.isSquad ? "◆ " : ""}
          {r.name}
        </span>
        {r.inVehicle && (
          <div className="roster-veh muted">{r.vehicleName || "vehicle"}</div>
        )}
      </td>
      <td>
        <span
          className="team-swatch"
          style={{ background: FACTION_COLORS[r.faction] }}
        />
        {r.factionLabel.slice(0, 3).toUpperCase()}
      </td>
      <td className="mono">
        {r.life === "dead"
          ? "—"
          : r.hp != null
            ? `${Math.round(r.hp)}${
                r.maxHp != null ? `/${Math.round(r.maxHp)}` : ""
              }`
            : "—"}
      </td>
      <td className="mono">{r.kills}</td>
      <td className="mono state-cell">{r.life}</td>
    </tr>
  );
}

export function MatchOpsPanel({ entities, telemetry, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("roster");
  const [sort, setSort] = useState<SortMode>("team");
  const [teams, setTeams] = useState<Record<FactionId, boolean>>({
    lonestar: true,
    valkyra: true,
    manticore: true,
    unknown: true,
  });

  const roster = useMemo(
    () => buildRoster(entities, telemetry.events),
    [entities, telemetry.events]
  );

  const teamCounts = useMemo(() => {
    const c: Record<FactionId, number> = {
      lonestar: 0,
      valkyra: 0,
      manticore: 0,
      unknown: 0,
    };
    for (const r of roster) c[r.faction]++;
    return c;
  }, [roster]);

  const filtered = useMemo(() => {
    const rows = roster.filter((r) => teams[r.faction]);
    if (sort === "team") {
      const groups: { faction: FactionId; rows: RosterRow[] }[] = [];
      for (const f of TEAM_ORDER) {
        if (!teams[f]) continue;
        const g = rows
          .filter((r) => r.faction === f)
          .sort((a, b) => compareRows(a, b, "team"));
        if (g.length) groups.push({ faction: f, rows: g });
      }
      return { mode: "grouped" as const, groups, flat: [] as RosterRow[] };
    }
    const flat = [...rows].sort((a, b) => compareRows(a, b, sort));
    return { mode: "flat" as const, groups: [], flat };
  }, [roster, teams, sort]);

  const visibleCount =
    filtered.mode === "flat"
      ? filtered.flat.length
      : filtered.groups.reduce((n, g) => n + g.rows.length, 0);

  const { stats } = telemetry;
  const elapsed = telemetry.startedAt
    ? Date.now() - telemetry.startedAt
    : 0;

  const feed = useMemo(
    () => [...telemetry.events].reverse().slice(0, 80),
    [telemetry.events]
  );

  const toggleTeam = (f: FactionId) =>
    setTeams((prev) => {
      const next = { ...prev, [f]: !prev[f] };
      // Keep at least one team visible
      if (!Object.values(next).some(Boolean)) return prev;
      return next;
    });

  const setAllTeams = (on: boolean) =>
    setTeams({
      lonestar: on,
      valkyra: on,
      manticore: on,
      unknown: on,
    });

  return (
    <aside className="panel match-ops-panel" aria-label="Match Ops">
      <header className="match-ops-head">
        <div className="match-ops-titleblock">
          <span className="panel-title">MATCH OPS</span>
          <div className="match-ops-sub mono">
            <span>{telemetry.matchId ?? "session"}</span>
            <span className="dot" />
            <span>{fmtDuration(elapsed)}</span>
          </div>
        </div>
        {onClose && (
          <button type="button" className="tb-btn ghost" onClick={onClose}>
            ✕
          </button>
        )}
      </header>

      <div className="match-ops-tabs" role="tablist">
        {(
          [
            ["roster", "ROSTER", visibleCount],
            ["feed", "FEED", feed.length],
            ["stats", "STATS", null],
          ] as const
        ).map(([id, label, count]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`match-tab ${tab === id ? "on" : ""}`}
            onClick={() => setTab(id)}
          >
            <span>{label}</span>
            {count != null && <span className="tab-count mono">{count}</span>}
          </button>
        ))}
      </div>

      <div className="match-ops-strip mono">
        <div className="strip-cell">
          <span className="strip-n">{stats.playersAlive}</span>
          <span className="strip-l">ALIVE</span>
        </div>
        <div className="strip-cell warn">
          <span className="strip-n">{stats.playersDown}</span>
          <span className="strip-l">DOWN</span>
        </div>
        <div className="strip-cell danger">
          <span className="strip-n">{stats.playersDead}</span>
          <span className="strip-l">DEAD</span>
        </div>
        <div className="strip-cell">
          <span className="strip-n">{stats.vehiclesLive}</span>
          <span className="strip-l">VEH</span>
        </div>
        <div className="strip-cell accent">
          <span className="strip-n">{stats.kills}</span>
          <span className="strip-l">KILLS</span>
        </div>
      </div>

      {tab === "roster" && (
        <div className="match-ops-body">
          <div className="roster-controls">
            <div className="team-filters" role="group" aria-label="Filter teams">
              {TEAM_ORDER.map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`team-chip ${teams[f] ? "on" : ""}`}
                  style={
                    {
                      "--chip": FACTION_COLORS[f],
                    } as CSSProperties
                  }
                  onClick={() => toggleTeam(f)}
                  title={`${teams[f] ? "Hide" : "Show"} ${FACTION_LABELS[f]}`}
                >
                  <span
                    className="chip-dot"
                    style={{ background: FACTION_COLORS[f] }}
                  />
                  <span className="chip-name">
                    {f === "unknown" ? "UNK" : FACTION_LABELS[f].slice(0, 3).toUpperCase()}
                  </span>
                  <span className="chip-n mono">{teamCounts[f]}</span>
                </button>
              ))}
              <button
                type="button"
                className="team-chip all"
                onClick={() => {
                  const allOn = TEAM_ORDER.every((f) => teams[f]);
                  setAllTeams(!allOn);
                }}
                title="Toggle all teams"
              >
                {TEAM_ORDER.every((f) => teams[f]) ? "NONE" : "ALL"}
              </button>
            </div>
            <label className="roster-sort">
              <span className="sort-label">Sort</span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as SortMode)}
              >
                <option value="team">By team</option>
                <option value="kills">By kills</option>
                <option value="state">By state</option>
                <option value="name">By name</option>
              </select>
            </label>
          </div>

          <div className="roster-scroll">
            <table className="roster-table">
              <thead>
                <tr>
                  <th>NAME</th>
                  <th>FAC</th>
                  <th>HP</th>
                  <th>K</th>
                  <th>STATE</th>
                </tr>
              </thead>
              <tbody>
                {filtered.mode === "grouped"
                  ? filtered.groups.map((g) => (
                      <Fragment key={g.faction}>
                        <tr className="roster-group-row">
                          <td colSpan={5}>
                            <div className="roster-group-head">
                              <span
                                className="team-swatch lg"
                                style={{
                                  background: FACTION_COLORS[g.faction],
                                }}
                              />
                              <span className="group-name">
                                {FACTION_LABELS[g.faction]}
                              </span>
                              <span className="group-count mono">
                                {g.rows.length}
                              </span>
                              <span className="group-line" />
                            </div>
                          </td>
                        </tr>
                        {g.rows.map((r) => (
                          <RosterRowView key={r.id} r={r} />
                        ))}
                      </Fragment>
                    ))
                  : filtered.flat.map((r) => (
                      <RosterRowView key={r.id} r={r} />
                    ))}
              </tbody>
            </table>
            {visibleCount === 0 && (
              <div className="match-empty">
                {roster.length === 0
                  ? "Waiting for roster…"
                  : "No players for selected teams."}
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "feed" && (
        <div className="match-ops-body feed-body">
          {feed.map((ev) => (
            <div key={ev.id} className={`feed-row kind-${ev.kind}`}>
              <span className="feed-time mono">
                {new Date(ev.t).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
              <span className="feed-kind">{ev.kind}</span>
              <span className="feed-text">{formatEventLine(ev)}</span>
            </div>
          ))}
          {feed.length === 0 && (
            <div className="match-empty">
              Feed fills from life flips and provider combat events.
            </div>
          )}
        </div>
      )}

      {tab === "stats" && (
        <div className="match-ops-body stats-body">
          <div className="stat-grid">
            <div className="stat-meter">
              <div className="stat-label">KILLS</div>
              <div className="stat-value">{stats.kills}</div>
            </div>
            <div className="stat-meter">
              <div className="stat-label">DOWNS</div>
              <div className="stat-value">{stats.downs}</div>
            </div>
            <div className="stat-meter">
              <div className="stat-label">REVIVES</div>
              <div className="stat-value">{stats.revives}</div>
            </div>
            <div className="stat-meter">
              <div className="stat-label">VEHICLES</div>
              <div className="stat-value">{stats.vehiclesLive}</div>
            </div>
          </div>

          <div className="panel-subhead">BY FACTION</div>
          <ul className="faction-stat-list">
            {(["lonestar", "valkyra", "manticore"] as const).map((f) => {
              const b = stats.byFaction[f];
              return (
                <li key={f}>
                  <span
                    className="team-swatch"
                    style={{ background: FACTION_COLORS[f] }}
                  />
                  <span className="fac-name">{FACTION_LABELS[f]}</span>
                  <span className="mono fac-nums">
                    {b.alive}A · {b.down}D · {b.dead}X · {b.kills}K
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}
