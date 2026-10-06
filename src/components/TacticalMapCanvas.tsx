"use client";

import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { LiveEntity } from "@/lib/protocol";
import { entityDisplayColor, resolveEntityIcon } from "@/lib/protocol";
import { tileSrc, type MapDefinition } from "@/lib/maps";
import {
  formatMapCoords,
  imagePxToWorld,
  scaleForViewSizeM,
  viewSizeMForScale,
  worldToImagePx,
} from "@/lib/mapProjection";
import { yawToCssRotate } from "@/lib/teams";
import {
  getSelfTrack,
  getTracks,
  registerMarker,
  setProjector,
} from "@/lib/liveMotion";
import { MapGrid } from "./MapGrid";
import type { LayerKey } from "./LegendPanel";

type ViewMode = "free" | "track" | "heading";

interface Props {
  map: MapDefinition;
  entities: LiveEntity[];
  layers: Record<LayerKey, boolean>;
  onCursorWorld?: (coords: { x: number; y: number } | null) => void;
}

function layerFor(type: LiveEntity["type"]): LayerKey {
  if (type === "player" || type === "corpse") return "players";
  if (type === "vehicle") return "vehicles";
  return "world";
}

function tileZoomForScale(scale: number, imageSize: number, maxZoom: number): number {
  if (maxZoom <= 0) return 0;
  // Pick mip so ~1 texels/CSS-px — sharper sooner without dumping whole pyramid.
  const needed = (imageSize * scale) / 512;
  const z = Math.round(Math.log2(Math.max(needed, 1)));
  return Math.max(0, Math.min(maxZoom, z));
}

type ViewRect = { x: number; y: number; w: number; h: number };

/** Only the tiles that intersect the current viewport (+ pad). */
function visibleTileRange(
  view: ViewRect | null,
  n: number,
  tileCss: number,
  padTiles = 1
): { x0: number; x1: number; y0: number; y1: number } {
  if (!view || n <= 0) {
    return { x0: 0, x1: n - 1, y0: 0, y1: n - 1 };
  }
  const x0 = Math.max(0, Math.floor(view.x / tileCss) - padTiles);
  const y0 = Math.max(0, Math.floor(view.y / tileCss) - padTiles);
  const x1 = Math.min(n - 1, Math.ceil((view.x + view.w) / tileCss) + padTiles);
  const y1 = Math.min(n - 1, Math.ceil((view.y + view.h) / tileCss) + padTiles);
  return { x0, x1, y0, y1 };
}

function MapTiles({
  map,
  scale,
  view,
}: {
  map: MapDefinition;
  scale: number;
  /** Content-space rect currently on screen (for tile culling). */
  view: ViewRect | null;
}) {
  const z = tileZoomForScale(scale, map.imageSize, map.maxZoom);
  const hasPyramid = Boolean(map.hasTiles && map.tileUrl && map.maxZoom > 0);
  const n = hasPyramid ? 1 << z : 0;
  const tileCss = n > 0 ? map.imageSize / n : map.imageSize;

  // Always keep a full-plane base so zoom never goes blank while sharp tiles load.
  const baseSrc =
    map.overviewUrl ||
    (hasPyramid ? tileSrc(map, 0, 0, 0) : "") ||
    "";

  const range = visibleTileRange(view, n, tileCss, 1);
  const tiles = useMemo(() => {
    if (!hasPyramid || n <= 0 || z < 1) return [];
    const list: { x: number; y: number; key: string }[] = [];
    for (let y = range.y0; y <= range.y1; y++) {
      for (let x = range.x0; x <= range.x1; x++) {
        list.push({ x, y, key: `${z}-${x}-${y}` });
      }
    }
    return list;
  }, [hasPyramid, n, z, range.x0, range.x1, range.y0, range.y1]);

  // +1px overlap hides JPEG seams
  const draw = tileCss + 1;

  return (
    <div className="map-tiles" style={{ width: map.imageSize, height: map.imageSize }}>
      {baseSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="map-tile map-overview"
          src={baseSrc}
          alt=""
          draggable={false}
          decoding="async"
          style={{ left: 0, top: 0, width: map.imageSize, height: map.imageSize }}
        />
      ) : null}
      {tiles.map((t) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={t.key}
          className="map-tile"
          src={tileSrc(map, z, t.x, t.y)}
          alt=""
          width={draw}
          height={draw}
          style={{
            left: t.x * tileCss,
            top: t.y * tileCss,
            width: draw,
            height: draw,
          }}
          draggable={false}
          decoding="async"
          loading="eager"
        />
      ))}
    </div>
  );
}

/** Chevron / arrowhead — tip at top so CSS rotate(0) faces up the screen. */
function PlayerArrow({
  color,
  self,
}: {
  color: string;
  self?: boolean;
}) {
  if (self) {
    return (
      <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
        <path
          d="M12 2 L20 20 L12 16 L4 20 Z"
          fill={color}
          stroke="#fff"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <circle cx="12" cy="14" r="2.2" fill="#fff" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden>
      <path
        d="M12 1.5 L21 21.5 L12 17 L3 21.5 Z"
        fill={color}
        stroke="rgba(0,0,0,0.75)"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const EntityMarker = memo(function EntityMarker({
  map,
  e,
  hover,
  mapScale,
  onHover,
}: {
  map: MapDefinition;
  e: LiveEntity;
  hover: boolean;
  mapScale: number;
  onHover: (id: string | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const yawRef = useRef<HTMLButtonElement>(null);

  const icon = resolveEntityIcon(e);
  const color = entityDisplayColor(e);
  const isPlayer = e.type === "player" || e.type === "corpse";
  const isDead = e.type === "corpse" || e.lifeState === "dead";
  const isVehicle = e.type === "vehicle";
  const isHeli =
    isVehicle &&
    /havoc|rotary|heli|lakota|ah-6|mh-6|z20/i.test(
      `${e.vehicleName ?? ""} ${e.name ?? ""}`
    );
  const isZone = e.type === "hotzone" || e.type === "safezone";
  const isBase =
    e.type === "fob" || e.type === "control_zone" || e.type === "spawn";
  const useArrow = isPlayer && !isDead;
  const needsYaw = useArrow || isVehicle;

  // MUST run after DOM commit — never register while early-returning null
  // (that left markers stuck at 0,0 with no arrows on screen).
  useLayoutEffect(() => {
    registerMarker(e.id, wrapRef.current, needsYaw ? yawRef.current : null);
    return () => registerMarker(e.id, null);
  }, [e.id, needsYaw, mapScale]);

  // Screen-constant size in content px. Clamp so zoom extremes don't vanish/explode.
  const screenPx = e.isSelf
    ? 18
    : isHeli
      ? 20
      : isVehicle
        ? 16
        : useArrow
          ? 14
          : isZone
            ? 0
            : isBase
              ? 14
              : 12;
  const inv = 1 / Math.max(mapScale, 0.0001);
  const size = Math.min(Math.max(screenPx * inv, screenPx * 0.35), screenPx * 80);
  const labelLift =
    (useArrow || e.isSelf ? screenPx * 0.55 : screenPx * 0.45) * inv;

  let radiusPx = 0;
  // Real game map: capture rings only on control zone + hotzone (not FOB icons).
  const drawRing =
    e.type === "control_zone" || e.type === "hotzone" || e.type === "safezone";
  if (drawRing && e.radiusCm && e.radiusCm > 0) {
    radiusPx = e.radiusCm / map.worldUnitsPerPixel;
  }

  // Initial yaw; liveMotion overwrites each frame with smoothed yawToCssRotate.
  const yawCss = needsYaw ? yawToCssRotate(e.yaw) : 0;
  const zoneClass =
    e.type === "hotzone"
      ? "zone-hotzone"
      : e.type === "safezone"
        ? "zone-safezone"
        : `possession-${e.possession ?? "neutral"}`;

  return (
    <div
      ref={wrapRef}
      className={`marker-wrap ${hover ? "is-hover" : ""} ${e.isSelf ? "is-self-wrap" : ""}`}
      style={{
        left: 0,
        top: 0,
        zIndex: e.isSelf
          ? 200
          : isPlayer
            ? 150
            : e.type === "hotzone"
              ? 60
              : e.type === "safezone"
                ? 50
                : isBase
                  ? 40
                  : 25,
      }}
      onMouseEnter={() => onHover(e.id)}
      onMouseLeave={() => onHover(null)}
    >
      {radiusPx > 0 && (
        <div
          className={`zone-ring ${zoneClass}`}
          style={{
            width: radiusPx * 2,
            height: radiusPx * 2,
            marginLeft: -radiusPx,
            marginTop: -radiusPx,
          }}
        />
      )}

      {!isZone && (
        <button
          ref={yawRef}
          type="button"
          className={`marker marker-${e.type} ${e.isSelf ? "is-self" : ""} ${e.isSquad ? "is-squad" : ""} ${useArrow ? "is-arrow" : ""}`}
          style={{
            width: size,
            height: size,
            minWidth: size,
            minHeight: size,
            transform: `translate(-50%, -50%) rotate(${yawCss}deg)`,
            ["--team" as string]: color,
          }}
          title={`${e.name ?? e.id}${e.occupants ? ` · ${e.occupants}` : ""}${e.faction ? ` · ${e.faction}` : ""}\n${formatMapCoords(e.world?.x ?? 0, e.world?.y ?? 0)}`}
        >
          {useArrow ? (
            <PlayerArrow color={color} self={e.isSelf} />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={icon} alt="" draggable={false} />
          )}
        </button>
      )}

      {(isPlayer || isBase || isVehicle || e.isSelf) && (e.name || e.isSelf || e.occupants) && (
        <span
          className="marker-label"
          style={{
            color: e.isSelf ? "#E8F0FF" : color,
            top: labelLift,
            // HEAD mode: --map-heading counter-rotates so names stay screen-upright.
            // Arrows stay map-relative (correct facing on rotated map).
            transform: `translate(-50%, 0) scale(${inv}) rotate(calc(-1 * var(--map-heading, 0deg)))`,
            transformOrigin: "top center",
          }}
        >
          {e.isSelf
            ? e.name || "YOU"
            : isVehicle && e.occupants
              ? `${e.name || e.vehicleName || "vehicle"} [${e.occupants}]`
              : e.name}
        </span>
      )}
    </div>
  );
});

export function TacticalMapCanvas({ map, entities, layers, onCursorWorld }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapPlaneRef = useRef<HTMLDivElement>(null);
  const headingLayerRef = useRef<HTMLDivElement>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [viewport, setViewport] = useState({ w: 1280, h: 720 });
  const [viewMode, setViewMode] = useState<ViewMode>("track");
  const viewModeRef = useRef<ViewMode>("track");
  const initialCenteredRef = useRef<string>("");
  const setTransformRef = useRef<
    ((x: number, y: number, scale: number, anim?: number) => void) | null
  >(null);
  const scaleRef = useRef(0.1);
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  viewModeRef.current = viewMode;

  // ESP-style: motion bus projects world→px every frame onto marker DOM nodes.
  useEffect(() => {
    setProjector((x, y) => worldToImagePx(map, x, y));
    return () => setProjector(null);
  }, [map]);

  // Follow / heading-up camera — every frame from liveMotion, not React pose spam.
  // Rotation lives on headingLayerRef (no React style prop) so re-renders can't wipe it.
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const mode = viewModeRef.current;
      const layer = headingLayerRef.current;
      const stage = wrapRef.current;
      const setT = setTransformRef.current;
      if (mode === "free") {
        if (layer) {
          layer.style.transform = "";
          layer.style.transformOrigin = "";
          layer.style.setProperty("--map-heading", "0deg");
        }
        stage?.classList.remove("is-heading");
        return;
      }
      const self = getSelfTrack();
      if (!self || !setT) return;
      const { px, py } = worldToImagePx(map, self.x, self.y);
      const scale = scaleRef.current;
      const { w, h } = viewportRef.current;
      setT(w / 2 - px * scale, h / 2 - py * scale, scale, 0);
      if (mode === "heading" && layer) {
        // Rotate map so map-relative CSS facing is screen-up. Arrows keep yawToCssRotate;
        // do not zero self yaw or subtract heading again.
        const rot = -yawToCssRotate(self.yaw);
        layer.style.transformOrigin = `${px}px ${py}px`;
        layer.style.transform = `rotate(${rot}deg)`;
        // Labels counter-rotate via --map-heading (same angle as layer rotate).
        layer.style.setProperty("--map-heading", `${rot}deg`);
        stage?.classList.add("is-heading");
      } else if (layer) {
        layer.style.transform = "";
        layer.style.transformOrigin = "";
        layer.style.setProperty("--map-heading", "0deg");
        stage?.classList.remove("is-heading");
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [map, ready]);

  const visible = useMemo(
    () => {
      const tracks = getTracks();
      return entities.filter((e) => {
        if (!layers[layerFor(e.type)]) return false;
        const tr = tracks.get(e.id);
        // Prefer live track pose — React roster world can be stale between identity changes.
        const wx = tr?.x ?? e.world?.x ?? 0;
        const wy = tr?.y ?? e.world?.y ?? 0;
        const known =
          tr != null
            ? tr.base.positionKnown !== false
            : e.positionKnown !== false;
        if (!known) return false;
        if (wx === 0 && wy === 0 && !e.isSelf) return false;
        return true;
      });
    },
    [entities, layers]
  );

  const self = useMemo(() => entities.find((e) => e.isSelf), [entities]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 8 || height < 8) return;
      setViewport({ w: width, h: height });
      setReady(true);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const shortSide = Math.min(viewport.w, viewport.h);
  const coverScale = Math.max(viewport.w / map.imageSize, viewport.h / map.imageSize);
  const scaleAtLargest = scaleForViewSizeM(map, map.largestViewSizeM, shortSide);
  const scaleAtSmallest = scaleForViewSizeM(map, map.smallestViewSizeM, shortSide);
  const minScale = Math.max(coverScale, scaleAtLargest);
  const maxScale = Math.max(minScale * 1.01, scaleAtSmallest);
  // Default tactical view ~2 km around you when we have a self ping
  const initialViewM = self ? 2000 : map.largestViewSizeM;
  const initialScale = Math.min(
    maxScale,
    Math.max(minScale, scaleForViewSizeM(map, initialViewM, shortSide))
  );

  // One-shot frame on first self / map load only — after that the view stays put.
  useEffect(() => {
    if (!self || !ready) return;
    const key = `${map.id}:${self.id}`;
    if (initialCenteredRef.current === key) return;
    initialCenteredRef.current = key;
    const scale = Math.min(
      maxScale,
      Math.max(minScale, scaleForViewSizeM(map, 2000, shortSide))
    );
    const { px, py } = worldToImagePx(map, self.world.x, self.world.y);
    const t = window.setTimeout(() => {
      setTransformRef.current?.(
        viewport.w / 2 - px * scale,
        viewport.h / 2 - py * scale,
        scale,
        0
      );
    }, 50);
    return () => clearTimeout(t);
  }, [self, map, ready, maxScale, minScale, shortSide, viewport.w, viewport.h]);

  const onMove = useCallback(
    (ev: MouseEvent) => {
      const el = wrapRef.current;
      if (!el) return;
      const content = el.querySelector("[data-map-content]") as HTMLElement | null;
      if (!content) return;
      const rect = content.getBoundingClientRect();
      const nx = (ev.clientX - rect.left) / rect.width;
      const ny = (ev.clientY - rect.top) / rect.height;
      if (nx < 0 || ny < 0 || nx > 1 || ny > 1) {
        onCursorWorld?.(null);
        return;
      }
      const w = imagePxToWorld(map, nx * map.imageSize, ny * map.imageSize);
      onCursorWorld?.(w);
    },
    [map, onCursorWorld]
  );

  return (
    <div
      className="map-stage"
      ref={wrapRef}
      onMouseMove={onMove}
      onMouseLeave={() => onCursorWorld?.(null)}
    >
      {/* MI_Map_VirtualTexture-ish grade: full greyscale + mild crush (not UE 0.3 white-point — that whites out JPEG tiles). */}
      <svg width={0} height={0} aria-hidden style={{ position: "absolute" }}>
        <defs>
          <filter id="wardogs-map-grade" colorInterpolationFilters="sRGB">
            <feColorMatrix
              type="matrix"
              values="0.2126 0.7152 0.0722 0 0
                      0.2126 0.7152 0.0722 0 0
                      0.2126 0.7152 0.0722 0 0
                      0 0 0 1 0"
              result="grey"
            />
            <feComponentTransfer in="grey">
              <feFuncR type="gamma" amplitude="1" exponent="1.65" offset="0" />
              <feFuncG type="gamma" amplitude="1" exponent="1.65" offset="0" />
              <feFuncB type="gamma" amplitude="1" exponent="1.65" offset="0" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>
      {ready && (
        <TransformWrapper
          key={`${map.id}-${viewport.w.toFixed(0)}x${viewport.h.toFixed(0)}`}
          initialScale={initialScale}
          minScale={minScale}
          maxScale={maxScale}
          centerOnInit
          smooth={viewMode === "free"}
          wheel={{ step: 0.0045 }}
          doubleClick={{ disabled: false, mode: "zoomIn", step: 0.35 }}
          panning={{
            velocityDisabled: true,
            disabled: viewMode !== "free",
          }}
          limitToBounds={false}
          zoomAnimation={{ disabled: false, size: 0.08 }}
          onPanningStart={() => {
            // Manual drag drops you into free look.
            if (viewModeRef.current !== "free") {
              viewModeRef.current = "free";
              setViewMode("free");
            }
          }}
        >
          {({ zoomIn, zoomOut, resetTransform, setTransform, state }) => {
            setTransformRef.current = setTransform;
            scaleRef.current = state.scale;
            const viewM = viewSizeMForScale(map, state.scale, shortSide);
            // Content-space viewport for tile culling (avoid loading entire z-level).
            const s = Math.max(state.scale, 1e-6);
            const pad = viewMode === "heading" ? 1.4 : 1;
            const viewRect = {
              x: -state.positionX / s - (viewport.w / s) * (pad - 1) * 0.5,
              y: -state.positionY / s - (viewport.h / s) * (pad - 1) * 0.5,
              w: (viewport.w / s) * pad,
              h: (viewport.h / s) * pad,
            };

            return (
              <>
                <div className="map-toolbar">
                  <button type="button" onClick={() => zoomIn(0.12)} title="Zoom in">
                    +
                  </button>
                  <button type="button" onClick={() => zoomOut(0.12)} title="Zoom out">
                    −
                  </button>
                  <span className="toolbar-sep" />
                  <button
                    type="button"
                    className={viewMode === "free" ? "on" : ""}
                    title="Free look — pan the map yourself"
                    onClick={() => setViewMode("free")}
                  >
                    FREE
                  </button>
                  <button
                    type="button"
                    className={viewMode === "track" ? "on" : ""}
                    title="Track — follow you, north up"
                    onClick={() => setViewMode("track")}
                  >
                    TRACK
                  </button>
                  <button
                    type="button"
                    className={viewMode === "heading" ? "on" : ""}
                    title="Heading — follow you, your arrow always points up"
                    onClick={() => setViewMode("heading")}
                  >
                    HEAD
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode("track");
                      if (!self) {
                        resetTransform();
                        return;
                      }
                      const scale = Math.min(
                        maxScale,
                        Math.max(minScale, state.scale)
                      );
                      const { px, py } = worldToImagePx(
                        map,
                        self.world.x,
                        self.world.y
                      );
                      setTransform(
                        viewport.w / 2 - px * scale,
                        viewport.h / 2 - py * scale,
                        scale,
                        0
                      );
                    }}
                    title="Snap to you (track mode)"
                  >
                    ME
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode("free");
                      resetTransform();
                    }}
                    title="Full map"
                  >
                    RST
                  </button>
                  <span className="toolbar-sep" />
                  {map.zoomPresetsM.map((m) => (
                    <button
                      key={m}
                      type="button"
                      className="preset"
                      title={`View ${m}m`}
                      onClick={() => {
                        const scale = Math.min(
                          maxScale,
                          Math.max(minScale, scaleForViewSizeM(map, m, shortSide))
                        );
                        scaleRef.current = scale;
                        const tr = getSelfTrack();
                        if (tr && viewModeRef.current !== "free") {
                          const { px, py } = worldToImagePx(map, tr.x, tr.y);
                          setTransform(
                            viewport.w / 2 - px * scale,
                            viewport.h / 2 - py * scale,
                            scale,
                            0
                          );
                        } else if (self) {
                          const { px, py } = worldToImagePx(
                            map,
                            self.world.x,
                            self.world.y
                          );
                          setTransform(
                            viewport.w / 2 - px * scale,
                            viewport.h / 2 - py * scale,
                            scale,
                            180
                          );
                        } else {
                          setTransform(state.positionX, state.positionY, scale, 180);
                        }
                      }}
                    >
                      {m >= 1000 ? `${m / 1000}k` : m}
                    </button>
                  ))}
                  <span className="toolbar-meta mono">
                    {map.label}
                    {!map.hasTiles ? " · NO VT" : ""} · {viewMode.toUpperCase()} ·{" "}
                    {Math.round(viewM)}m · {visible.length} contacts
                  </span>
                </div>

                <TransformComponent
                  wrapperClass="map-transform-wrap"
                  contentClass="map-transform-content"
                >
                  <div
                    ref={mapPlaneRef}
                    data-map-content
                    className="map-plane"
                    style={{ width: map.imageSize, height: map.imageSize }}
                  >
                    {/* Imperative rotate target — no React style prop, so HEAD yaw can't be wiped. */}
                    <div ref={headingLayerRef} className="map-heading-layer">
                      <MapTiles map={map} scale={state.scale} view={viewRect} />
                      <MapGrid map={map} scale={state.scale} />
                      <div className="map-vignette" />

                      {visible.map((e) => (
                        <EntityMarker
                          key={e.id}
                          map={map}
                          e={e}
                          hover={hoverId === e.id}
                          mapScale={state.scale}
                          onHover={setHoverId}
                        />
                      ))}
                    </div>
                  </div>
                </TransformComponent>
              </>
            );
          }}
        </TransformWrapper>
      )}
    </div>
  );
}
