import { listJobs } from "@/lib/jobs";

export const dynamic = "force-dynamic";

/**
 * Per-stage progress over SSE. The job rows are the source of truth, so this
 * is a poll-and-diff loop rather than an event bus — one process, one SQLite
 * file, and a diff means the client only re-renders when something changed.
 */
export async function GET(req: Request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let last = "";
      let closed = false;

      const send = () => {
        if (closed) return;
        const payload = JSON.stringify({ jobs: listJobs(20) });
        if (payload === last) return;
        last = payload;
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      send();
      const tick = setInterval(send, 700);
      // Keep-alive comment: proxies drop an idle SSE connection.
      const ping = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, 20_000);

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(tick);
        clearInterval(ping);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", stop);
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
