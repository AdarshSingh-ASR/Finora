import { getDb } from "../../../../db";
import { agentAuthRequest } from "../../../../db/schema";
import { randomSecret, randomUserCode, sha256 } from "../../../../lib/agent-auth";

export const runtime = "edge";

export async function POST(request: Request) {
  const deviceCode = randomSecret("finora_device_");
  const userCode = randomUserCode();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60_000);
  await getDb().insert(agentAuthRequest).values({
    id: crypto.randomUUID(), deviceCodeHash: await sha256(deviceCode), userCode,
    status: "pending", createdAt: now, expiresAt,
  });
  const origin = new URL(request.url).origin;
  return Response.json({
    deviceCode, userCode, expiresIn: 600, interval: 3,
    verificationUrl: `${origin}/connect?code=${encodeURIComponent(userCode)}`,
  });
}
