import { NextResponse } from "next/server";
import { processStatementInput, StatementProcessingError, type StatementInput } from "../../../lib/statement-parser";

export const runtime = "edge";

export async function POST(request: Request) {
  try {
    return NextResponse.json(await processStatementInput(await request.json() as StatementInput));
  } catch (error) {
    const message = error instanceof Error ? error.message : "The statement could not be processed.";
    return NextResponse.json({ error: message }, { status: error instanceof StatementProcessingError ? error.status : 502 });
  }
}
