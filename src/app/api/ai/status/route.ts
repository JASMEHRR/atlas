import { getNotices, isConfigured, providerStatus } from "@/lib/ai";

export const dynamic = "force-dynamic";

/**
 * Which provider would serve the next request, and anything the user needs to
 * be told — most importantly, if OpenRouter had no free model available.
 */
export async function GET() {
  return Response.json({
    configured: isConfigured(),
    providers: await providerStatus(),
    notices: getNotices(),
  });
}
