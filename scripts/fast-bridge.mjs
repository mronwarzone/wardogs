/**
 * Ultra-low-latency provider bridge for the tactical map.
 * Handles /api/ingest + /api/live + /api/entities in raw Node (<5ms),
 * proxies everything else to Next (UI) on NEXT_PORT.
 *
 *   node scripts/fast-bridge.mjs
 *   → http://127.0.0.1:3000   (provider + browser)
 *   → Next UI on 3015
 */
import http from "http";
import { createServer as createNetServer } from "net";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);
const NEXT_PORT = Number(process.env.NEXT_PORT || 3015);

/** @type {Map<string, any>} */
const entities = new Map();
let source = "mock";
let localFaction = "lonestar";
let serverTime = Date.now();
/** @type {Set<import('http').ServerResponse>} */
const sseClients = new Set();

function frame() {
  return {
    type: "entities",
    entities: [...entities.values()],
    source,
    serverTime: Date.now(),
    localFaction,
  };
}

function broadcast() {
  const data = `data: ${JSON.stringify(frame())}\n\n`;
  for (const res of [...sseClients]) {
    try {
      res.write(data);
    } catch {
      sseClients.delete(res);
    }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function applyIngest(msg) {
  if (!msg || typeof msg !== "object") return false;
  if (msg.type === "snapshot" && Array.isArray(msg.entities)) {
    entities.clear();
    for (const e of msg.entities) {
      if (e?.id) entities.set(e.id, e);
    }
    if (msg.localFaction) localFaction = msg.localFaction;
    source = "provider";
    serverTime = Date.now();
    broadcast();
    return true;
  }
  if (msg.type === "delta") {
    for (const e of msg.upsert ?? []) {
      if (e?.id) entities.set(e.id, e);
    }
    for (const id of msg.remove ?? []) entities.delete(id);
    source = "provider";
    serverTime = Date.now();
    broadcast();
    return true;
  }
  if (msg.type === "telemetry") {
    source = "provider";
    return true;
  }
  return false;
}

function proxy(req, res) {
  const opts = {
    hostname: "127.0.0.1",
    port: NEXT_PORT,
    path: req.url,
    method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${NEXT_PORT}` },
  };
  const p = http.request(opts, (pr) => {
    res.writeHead(pr.statusCode || 502, pr.headers);
    pr.pipe(res);
  });
  p.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
    }
    res.end("Next UI not ready — wait for compile");
  });
  req.pipe(p);
}

const server = http.createServer(async (req, res) => {
  const url = req.url || "/";
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.startsWith("/api/ingest") && req.method === "POST") {
    try {
      const raw = await readBody(req);
      const msg = JSON.parse(raw.toString("utf8") || "{}");
      if (!applyIngest(msg)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end('{"ok":false,"error":"bad ingest"}');
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end('{"ok":true}');
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end('{"ok":false,"error":"invalid json"}');
    }
    return;
  }

  if (url.startsWith("/api/live") && req.method === "GET") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    res.write(`data: ${JSON.stringify(frame())}\n\n`);
    sseClients.add(res);
    const ping = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(ping);
        sseClients.delete(res);
      }
    }, 15000);
    req.on("close", () => {
      clearInterval(ping);
      sseClients.delete(res);
    });
    return;
  }

  if (url.startsWith("/api/entities") && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(frame()));
    return;
  }

  proxy(req, res);
});

function waitPort(port) {
  return new Promise((resolve) => {
    const tryOnce = () => {
      const s = createNetServer();
      s.once("error", () => {
        s.close();
        setTimeout(tryOnce, 200);
      });
      s.once("listening", () => {
        s.close(() => resolve(undefined));
      });
      // Actually we want to wait until NEXT is listening, not free
    };
    const check = () => {
      const req = http.get(
        `http://127.0.0.1:${port}/`,
        (r) => {
          r.resume();
          resolve(undefined);
        }
      );
      req.on("error", () => setTimeout(check, 300));
    };
    check();
  });
}

// Start Next UI on side port
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const nextProc = spawn(
  process.execPath,
  [nextBin, "dev", "--turbopack", "-H", "127.0.0.1", "-p", String(NEXT_PORT)],
  { cwd: root, stdio: "inherit", env: { ...process.env } }
);

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[fast-bridge] provider ingest :${PORT}  (UI via Next :${NEXT_PORT})`);
  console.log(`[fast-bridge] open http://127.0.0.1:${PORT}`);
});

process.on("exit", () => nextProc.kill());
process.on("SIGINT", () => {
  nextProc.kill();
  process.exit(0);
});

void waitPort;
