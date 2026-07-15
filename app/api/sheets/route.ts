import { NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    const { webhookUrl, secret, statement } = await request.json();
    if (!webhookUrl || !/^https:\/\/script\.google\.com\//.test(webhookUrl)) {
      return NextResponse.json({ error: "Enter a valid Google Apps Script web app URL." }, { status: 400 });
    }
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ secret, statement }),
      redirect: "follow",
    });
    const text = await response.text();
    let result: any;
    try { result = JSON.parse(text); } catch { result = { ok: response.ok, message: text.slice(0, 200) }; }
    if (!response.ok || result.ok === false) throw new Error(result.error || "Google Sheets sync failed.");
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Sheets sync failed." }, { status: 400 });
  }
}

