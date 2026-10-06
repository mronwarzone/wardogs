import { NextResponse } from "next/server";
import { getEntityStore } from "@/lib/entityStore";
import type { IngestMessage } from "@/lib/protocol";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * provider bridge ingest.
 * POST JSON: EntitySnapshotMessage | EntityDeltaMessage
 * Optional header: x-wardogs-token (stub — accept anything for now)
 */
export async function POST(req: Request) {
  let body: IngestMessage;
  try {
    body = (await req.json()) as IngestMessage;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  if (
    !body ||
    (body.type !== "snapshot" &&
      body.type !== "delta" &&
      body.type !== "telemetry")
  ) {
    return NextResponse.json(
      { ok: false, error: "expected type snapshot|delta|telemetry" },
      { status: 400 }
    );
  }

  if (body.type === "snapshot" && !Array.isArray(body.entities)) {
    return NextResponse.json(
      { ok: false, error: "snapshot requires entities[]" },
      { status: 400 }
    );
  }

  const store = getEntityStore();
  store.applyIngest(body);

  // Keep response tiny — count/frame rebuild was adding latency every post.
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    hint: "POST snapshot|delta JSON — see provider_BRIDGE.md",
  });
}
