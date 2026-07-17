export type GenerateInput = { system: string; prompt: string; schema?: Record<string, unknown>; media?: { mimeType: string; data: string }; maxOutputTokens?: number };
export type GenerateResult = { text: string; provider: "vertex" | "groq"; model: string };
export function configuredProviders(): { vertex: boolean; groq: boolean };
export function generateWithFallback(input: GenerateInput): Promise<GenerateResult>;
