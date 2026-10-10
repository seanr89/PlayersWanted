import { handleDispatchRequest, type WorkerEnv } from "../../../../delivery/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Called by a scheduler (with `Authorization: Bearer $CRON_SECRET`) to deliver pending notifications. */
export async function POST(request: Request) {
  return handleDispatchRequest(request, process.env as WorkerEnv);
}
