import { sendDueReports } from "../../../../lib/weekly-email";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Unauthorized." }, { status: 401 });
  }
  const result = await sendDueReports({ force: new URL(request.url).searchParams.get("force") === "1" });
  return Response.json(result);
}
