import { handleSessionRequest } from "../../../server/generation/session-route.js";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  return handleSessionRequest(request);
}
