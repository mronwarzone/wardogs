"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import type { LiveEntity, LiveFeedFrame, TelemetryBundle } from "@/lib/protocol";
import { buildTelemetry } from "@/lib/telemetry";
import {
  getRosterEntities,
  getRosterVersion,
  ingestLiveFrame,
  setDisconnected,
  snapshotEntitiesSmoothed,
  subscribeMeta,
  subscribeRoster,
} from "@/lib/liveMotion";

const EMPTY_TELEMETRY: TelemetryBundle = buildTelemetry([], []);

/**
 * Roster + HUD metadata only. Pose is painted by liveMotion RAF → DOM
 * (same idea as provider overlay: sample ingest, every-frame draw).
 */
export function useLiveEntities() {
  const rosterVersion = useSyncExternalStore(
    subscribeRoster,
    getRosterVersion,
    () => 0
  );

  const [entities, setEntities] = useState<LiveEntity[]>(() =>
    snapshotEntitiesSmoothed()
  );
  const [telemetry, setTelemetry] =
    useState<TelemetryBundle>(EMPTY_TELEMETRY);
  const [source, setSource] = useState<LiveFeedFrame["source"]>("mock");
  const [connected, setConnected] = useState(false);
  const [serverTime, setServerTime] = useState(0);

  // Refresh React entity list only when roster identity changes (not every pose).
  useEffect(() => {
    setEntities(snapshotEntitiesSmoothed());
  }, [rosterVersion]);

  useEffect(() => {
    const unsubMeta = subscribeMeta((info) => {
      setTelemetry(info.telemetry);
      setSource(info.source);
      setServerTime(info.serverTime);
      setConnected(info.connected);
    });

    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let es: EventSource | null = null;

    const connect = () => {
      es?.close();
      es = new EventSource("/api/live");
      es.onmessage = (ev) => {
        try {
          ingestLiveFrame(JSON.parse(ev.data) as LiveFeedFrame);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        setDisconnected();
        es?.close();
        if (retry) clearTimeout(retry);
        fetch("/api/entities")
          .then((r) => r.json())
          .then((frame: LiveFeedFrame) => {
            if (!cancelled) ingestLiveFrame(frame);
          })
          .catch(() => undefined);
        if (!cancelled) retry = setTimeout(connect, 800);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      es?.close();
      unsubMeta();
    };
  }, []);

  // Soft roster refresh so newly-positioned players mount markers (pose still DOM-driven).
  useEffect(() => {
    const id = window.setInterval(() => {
      setEntities(snapshotEntitiesSmoothed());
    }, 500);
    return () => clearInterval(id);
  }, []);

  void getRosterEntities;
  return { entities, telemetry, source, connected, serverTime };
}
