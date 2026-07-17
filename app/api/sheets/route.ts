import { getAuth } from "../../../lib/auth";
import {
  GoogleWorkspaceError, addSpreadsheetTab, appendSpreadsheetRows, clearSpreadsheetRange,
  connectSpreadsheet, copySpreadsheet, createSpreadsheet, deleteSpreadsheet, deleteSpreadsheetTab,
  disconnectSpreadsheet, getSheetConnection, listSpreadsheets, moveSpreadsheet, renameSpreadsheet,
  shareSpreadsheet, syncSpreadsheet, updateSpreadsheetRange,
} from "../../../lib/google-sheets";

export const runtime = "edge";

async function currentUser(request: Request) {
  const session = await getAuth()!.api.getSession({ headers: request.headers });
  return session?.user || null;
}

function failure(error: unknown) {
  if (error instanceof GoogleWorkspaceError) return Response.json({ error: error.message, code: error.code, permissionRequired: error.code === "GOOGLE_PERMISSION_REQUIRED" }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Google Sheets request failed." }, { status: 400 });
}

export async function GET(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const url = new URL(request.url);
    const connection = await getSheetConnection(user.id);
    const files = url.searchParams.get("includeFiles") === "1" ? await listSpreadsheets(user.id, url.searchParams.get("search") || "") : undefined;
    return Response.json({ connection, files });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action : "sync";
    let connection;
    if (action === "create") connection = await createSpreadsheet(user.id, body.name);
    else if (action === "connect") {
      if (typeof body.spreadsheetId !== "string" || !/^[A-Za-z0-9_-]{20,}$/.test(body.spreadsheetId)) throw new GoogleWorkspaceError("Choose a valid Google spreadsheet.");
      connection = await connectSpreadsheet(user.id, body.spreadsheetId);
    } else if (action === "sync") connection = await syncSpreadsheet(user.id);
    else if (action === "rename") connection = await renameSpreadsheet(user.id, body.name);
    else if (action === "copy") connection = await copySpreadsheet(user.id, body.name);
    else if (action === "move") {
      if (typeof body.folderId !== "string") throw new GoogleWorkspaceError("Enter a Google Drive folder ID.");
      connection = await moveSpreadsheet(user.id, body.folderId);
    } else if (action === "share") {
      if (typeof body.email !== "string") throw new GoogleWorkspaceError("Enter an email address.");
      connection = await shareSpreadsheet(user.id, body.email);
    } else if (action === "addTab") connection = await addSpreadsheetTab(user.id, body.name);
    else if (action === "deleteTab") connection = await deleteSpreadsheetTab(user.id, body.name);
    else if (action === "appendRows") connection = await appendSpreadsheetRows(user.id, body.tab, body.valuesJson);
    else if (action === "updateRange") connection = await updateSpreadsheetRange(user.id, body.range, body.valuesJson);
    else if (action === "clearRange") connection = await clearSpreadsheetRange(user.id, body.range);
    else throw new GoogleWorkspaceError("Unknown Google Sheets action.");
    return Response.json({ ok: true, connection });
  } catch (error) { return failure(error); }
}

export async function DELETE(request: Request) {
  const user = await currentUser(request);
  if (!user) return Response.json({ error: "Sign in required." }, { status: 401 });
  try {
    const permanently = new URL(request.url).searchParams.get("permanent") === "1";
    if (permanently) await deleteSpreadsheet(user.id);
    else await disconnectSpreadsheet(user.id);
    return Response.json({ ok: true });
  } catch (error) { return failure(error); }
}
