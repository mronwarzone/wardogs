import { getEntityStore } from "@/lib/entityStore";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Server-Sent Events live feed for the map client. */
export async function GET(req: Request) {
  const store = getEntityStore();
  const encoder = new TextEncoder();

  let cleanup: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        cleanup?.();
        cleanup = null;
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      const send = (data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Client gone — drop this subscriber so ingest doesn't fan out forever.
          close();
        }
      };

      const unsub = store.subscribe((frame) => send(frame));
      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          close();
        }
      }, 15000);

      cleanup = () => {
        clearInterval(heartbeat);
        unsub();
      };

      req.signal.addEventListener("abort", close, { once: true });
    },
    cancel() {
      if (closed) return;
      closed = true;
      cleanup?.();
      cleanup = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
