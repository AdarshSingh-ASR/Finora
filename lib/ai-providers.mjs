const VERTEX_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const GOOGLE_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";

let cachedGoogleToken;

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Url(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  return bytesToBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ""));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function parseVertexCredentials() {
  const raw = process.env.GOOGLE_VERTEX_CREDENTIALS?.trim();
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch {
    try { parsed = JSON.parse(new TextDecoder().decode(decodeBase64(raw))); }
    catch { throw new Error("GOOGLE_VERTEX_CREDENTIALS must contain service-account JSON or its base64 encoding."); }
  }
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (!parsed?.client_email || !parsed?.private_key || !parsed?.project_id) throw new Error("Vertex credentials are missing client_email, private_key, or project_id.");
  return parsed;
}

async function signServiceAccountJwt(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT", ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}) }));
  const claims = base64Url(JSON.stringify({ iss: credentials.client_email, sub: credentials.client_email, scope: VERTEX_SCOPE, aud: GOOGLE_TOKEN_AUDIENCE, iat: now, exp: now + 3600 }));
  const signingInput = `${header}.${claims}`;
  const privateKey = decodeBase64(credentials.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\n|\n/g, ""));
  const key = await crypto.subtle.importKey("pkcs8", privateKey, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64Url(signature)}`;
}

async function getGoogleAccessToken(credentials) {
  if (cachedGoogleToken?.clientEmail === credentials.client_email && cachedGoogleToken.expiresAt > Date.now() + 60_000) return cachedGoogleToken.value;
  const assertion = await signServiceAccountJwt(credentials);
  const response = await fetch(credentials.token_uri || GOOGLE_TOKEN_AUDIENCE, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  const payload = await response.json();
  if (!response.ok || !payload.access_token) throw new Error(`Google OAuth token exchange failed (${response.status}).`);
  cachedGoogleToken = { clientEmail: credentials.client_email, value: payload.access_token, expiresAt: Date.now() + Number(payload.expires_in || 3600) * 1000 };
  return payload.access_token;
}

async function generateWithVertex({ system, prompt, schema, media }) {
  const credentials = parseVertexCredentials();
  if (!credentials) throw new Error("Vertex AI is not configured.");
  const token = await getGoogleAccessToken(credentials);
  const location = process.env.GOOGLE_VERTEX_LOCATION || "global";
  const model = process.env.GOOGLE_VERTEX_MODEL || "gemini-2.5-flash";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const parts = [];
  if (media) parts.push({ inlineData: { mimeType: media.mimeType, data: media.data } });
  if (prompt) parts.push({ text: prompt });
  const response = await fetch(`https://${host}/v1/projects/${encodeURIComponent(credentials.project_id)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 16384, ...(schema ? { responseMimeType: "application/json", responseSchema: schema } : {}) },
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Vertex AI request failed (${response.status}).`);
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!text) throw new Error("Vertex AI returned no text.");
  return { text, provider: "vertex", model };
}

async function generateWithGroq({ system, prompt, schema }) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Groq is not configured.");
  const model = process.env.GROQ_MODEL || "openai/gpt-oss-20b";
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      reasoning_effort: "low",
      ...(schema ? { response_format: { type: "json_schema", json_schema: { name: "finora_response", strict: true, schema } } } : {}),
    }),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(`Groq request failed (${response.status}).`);
  const text = payload.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned no text.");
  return { text, provider: "groq", model };
}

export function configuredProviders() {
  return { vertex: Boolean(process.env.GOOGLE_VERTEX_CREDENTIALS), groq: Boolean(process.env.GROQ_API_KEY) };
}

export async function generateWithFallback(input) {
  const failures = [];
  try { return await generateWithVertex(input); }
  catch (error) { failures.push(error instanceof Error ? error.message : "Vertex AI failed."); }
  if (!input.media) {
    try { return await generateWithGroq(input); }
    catch (error) { failures.push(error instanceof Error ? error.message : "Groq failed."); }
  }
  throw new Error(failures.join(" "));
}
