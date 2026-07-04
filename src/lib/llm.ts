// Thin LLM provider switch for ReadBack.
//
// Gemini (PRIMARY, vision + text): REST generateContent, called with plain
//   fetch (no SDK).
//   POST https://generativelanguage.googleapis.com/v1beta/models/<model>:generateContent
//   header x-goog-api-key: <VITE_GEMINI_API_KEY>; image via inline_data base64;
//   JSON output requested via generationConfig.responseMimeType.
//   Model: gemini-3-flash-preview (free tier; gemini-3.1-flash-lite is the
//   cheaper free-tier alternative if quota gets tight).
//
// Vultr Serverless Inference (SECONDARY, TEXT-ONLY): OpenAI-compatible.
//   POST https://api.vultrinference.com/v1/chat/completions
//   header Authorization: Bearer <VITE_VULTR_API_KEY>
//   Used by default for text calls when the key is set (conserves Gemini
//   free-tier quota); any failure falls back to Gemini automatically.

import { getEnv } from "./env";
import {
  VISION_PARSE_PROMPT,
  askJobPrompt,
  boardVoicePrompt,
  cleanNotePrompt,
  descriptionParsePrompt,
  materialsPrompt,
} from "./prompts";
import type {
  BoardVoiceParse,
  CleanedNote,
  ComponentType,
  MaterialItem,
  Result,
  VisionComponent,
  VisionParse,
} from "./types";

const GEMINI_DIRECT = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_MODEL = "gemini-3-flash-preview";

const VALID_TYPES = new Set<ComponentType>([
  "main_switch",
  "RCD",
  "RCBO",
  "MCB",
  "blank",
  "other",
]);

/** Browser → same-origin Vite proxy; node scripts → direct API. */
function geminiEndpoint(path: string): string {
  if (typeof window !== "undefined") {
    return `/gemini-api/v1beta${path}`;
  }
  return `${GEMINI_DIRECT}${path}`;
}

function toNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeComponentType(v: unknown): ComponentType {
  const s = String(v ?? "other")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
  if (VALID_TYPES.has(s as ComponentType)) return s as ComponentType;
  if (s.includes("rcbo")) return "RCBO";
  if (s.includes("rcd")) return "RCD";
  if (s.includes("mcb")) return "MCB";
  if (s.includes("main")) return "main_switch";
  if (s.includes("blank") || s.includes("spare")) return "blank";
  return "other";
}

/**
 * Coerce loosely-typed model JSON into VisionParse. Gemini often returns
 * numeric fields as strings or omits optional grid fields.
 */
export function normalizeVisionParse(raw: unknown): VisionParse | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.panel !== "object" || o.panel === null) return null;
  if (!Array.isArray(o.components) || o.components.length === 0) return null;

  const panelRaw = o.panel as Record<string, unknown>;
  const components: VisionComponent[] = [];

  for (let i = 0; i < o.components.length; i++) {
    const item = o.components[i];
    if (typeof item !== "object" || item === null) continue;
    const c = item as Record<string, unknown>;
    const order = toNum(c.order) ?? i + 1;
    const label =
      c.printed_label ?? c.printedLabel ?? c.label ?? c.purposeLabel ?? null;
    components.push({
      id: typeof c.id === "string" && c.id ? c.id : `c${order}`,
      order,
      ...(toNum(c.row) != null ? { row: toNum(c.row)! } : {}),
      ...(toNum(c.col) != null ? { col: toNum(c.col)! } : {}),
      type: normalizeComponentType(c.type),
      rating:
        c.rating == null || c.rating === ""
          ? null
          : String(c.rating),
      printed_label: label == null || label === "" ? null : String(label),
      confidence: Math.min(1, Math.max(0, toNum(c.confidence) ?? 0.5)),
    });
  }

  if (components.length === 0) return null;

  return {
    panel: {
      ways: toNum(panelRaw.ways),
      rows: toNum(panelRaw.rows) ?? 1,
      cols: toNum(panelRaw.cols),
    },
    components,
  };
}

const VULTR_BASE = "https://api.vultrinference.com/v1";
const VULTR_MODEL = "kimi-k2-instruct";

// ---------- Raw completions (throw on failure; wrapped by the public API) ----

async function geminiComplete(
  prompt: string,
  opts: { image?: { base64: string; mimeType: string }; json?: boolean } = {},
): Promise<string> {
  const apiKey = getEnv("VITE_GEMINI_API_KEY");
  if (!apiKey) throw new Error("VITE_GEMINI_API_KEY not set");

  const parts: unknown[] = [];
  if (opts.image) {
    parts.push({
      inline_data: { mime_type: opts.image.mimeType, data: opts.image.base64 },
    });
  }
  parts.push({ text: prompt });

  const res = await fetch(
    geminiEndpoint(`/models/${GEMINI_MODEL}:generateContent`),
    {
      method: "POST",
      headers: {
        "x-goog-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
          ...(opts.json ? { responseMimeType: "application/json" } : {}),
        },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("");
  if (!text) throw new Error("Gemini: empty completion");
  return text;
}

async function vultrComplete(prompt: string): Promise<string> {
  const apiKey = getEnv("VITE_VULTR_API_KEY");
  if (!apiKey) throw new Error("VITE_VULTR_API_KEY not set");

  const res = await fetch(`${VULTR_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: VULTR_MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.2,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) {
    throw new Error(`Vultr ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content;
  if (!text) throw new Error("Vultr: empty completion");
  return text;
}

export type TextProvider = "gemini" | "vultr";

/**
 * Text completion with the default routing: Vultr when its key is set
 * (conserves Gemini quota), Gemini otherwise; Vultr failures automatically
 * fall back to Gemini.
 */
async function textComplete(
  prompt: string,
  opts: { provider?: TextProvider; json?: boolean } = {},
): Promise<string> {
  if (opts.provider === "gemini") return geminiComplete(prompt, { json: opts.json });
  if (opts.provider === "vultr") return vultrComplete(prompt);

  if (getEnv("VITE_VULTR_API_KEY")) {
    try {
      return await vultrComplete(prompt);
    } catch (err) {
      console.warn("Vultr failed, falling back to Gemini:", err);
    }
  }
  return geminiComplete(prompt, { json: opts.json });
}

// ---------- Defensive JSON extraction (exported; UI uses failures to ----------
// ---------- trigger the manual-placement fallback)                   ----------

/**
 * Pull a JSON value out of model output that may be wrapped in ```json fences,
 * <think> blocks, or surrounding prose. Never throws — returns a typed Result
 * with the raw output attached on failure.
 */
export function extractJson<T>(raw: string): Result<T> {
  let text = raw
    // Reasoning models may emit thinking blocks before the answer.
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .trim();

  // Prefer fenced block content if present.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();

  // Trim prose around the outermost JSON object/array.
  const first = text.search(/[[{]/);
  if (first === -1) {
    return { ok: false, error: "No JSON found in model output", raw };
  }
  const close = text[first] === "{" ? "}" : "]";
  const last = text.lastIndexOf(close);
  if (last <= first) {
    return { ok: false, error: "Unbalanced JSON in model output", raw };
  }
  text = text.slice(first, last + 1);

  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch (err) {
    return {
      ok: false,
      error: `JSON.parse failed: ${err instanceof Error ? err.message : String(err)}`,
      raw,
    };
  }
}

// ---------- Shape checks (basic, hackathon-pragmatic) ----------

function isCleanedNote(v: unknown): v is CleanedNote {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.purpose === "string" && typeof o.note_text === "string";
}

function isMaterialsArray(v: unknown): v is MaterialItem[] {
  return (
    Array.isArray(v) &&
    v.every(
      (m: unknown) =>
        typeof m === "object" &&
        m !== null &&
        typeof (m as Record<string, unknown>).item === "string",
    )
  );
}

function isBoardVoiceParse(v: unknown): v is BoardVoiceParse {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!Array.isArray(o.items)) return false;
  return o.items.every(
    (i: unknown) => typeof i === "object" && i !== null,
  );
}

function fail<T>(err: unknown): Result<T> {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === "Load failed" || msg === "Failed to fetch") {
    return {
      ok: false,
      error:
        "Network error reaching the vision API — check your connection and reload the page.",
    };
  }
  return { ok: false, error: msg };
}

// ---------- Public API (the UI codes against these exact signatures) ----------

/**
 * Photo → panel JSON. Vision is Gemini-only (Vultr is text-only).
 * On {ok:false} the UI should offer the manual tile-placement fallback.
 */
export async function visionParse(
  imageBase64: string,
  mimeType: string,
  opts?: { provider?: "gemini" },
): Promise<Result<VisionParse>> {
  void opts; // only one vision provider today
  try {
    const raw = await geminiComplete(VISION_PARSE_PROMPT, {
      image: { base64: imageBase64, mimeType },
      json: true,
    });
    const result = extractJson<unknown>(raw);
    if (!result.ok) return result;
    const normalized = normalizeVisionParse(result.value);
    if (!normalized) {
      return { ok: false, error: "Vision JSON did not match expected shape", raw };
    }
    return { ok: true, value: normalized };
  } catch (err) {
    return fail(err);
  }
}

/** Plain-text board description → panel JSON (same shape as vision parse). */
export async function descriptionParse(
  description: string,
  opts?: { provider?: TextProvider },
): Promise<Result<VisionParse>> {
  try {
    const raw = await textComplete(descriptionParsePrompt(description), {
      provider: opts?.provider,
      json: true,
    });
    const result = extractJson<unknown>(raw);
    if (!result.ok) return result;
    const normalized = normalizeVisionParse(result.value);
    if (!normalized) {
      return { ok: false, error: "Description JSON did not match expected shape", raw };
    }
    return { ok: true, value: normalized };
  } catch (err) {
    return fail(err);
  }
}

/** Raw voice transcript about one tile → structured cleaned note. */
export async function cleanNote(
  existingLabel: string | null,
  rating: string | null,
  transcript: string,
  opts?: { provider?: TextProvider },
): Promise<Result<CleanedNote>> {
  try {
    const raw = await textComplete(
      cleanNotePrompt(existingLabel, rating, transcript),
      { provider: opts?.provider, json: true },
    );
    const result = extractJson<CleanedNote>(raw);
    if (!result.ok) return result;
    if (!isCleanedNote(result.value)) {
      return { ok: false, error: "Note JSON did not match expected shape", raw };
    }
    return result;
  } catch (err) {
    return fail(err);
  }
}

/** Voice transcript → materials shopping list. */
export async function extractMaterials(
  transcript: string,
  opts?: { provider?: TextProvider },
): Promise<Result<MaterialItem[]>> {
  try {
    const raw = await textComplete(materialsPrompt(transcript), {
      provider: opts?.provider,
      json: true,
    });
    const result = extractJson<MaterialItem[]>(raw);
    if (!result.ok) return result;
    if (!isMaterialsArray(result.value)) {
      return { ok: false, error: "Materials JSON did not match expected shape", raw };
    }
    // Fill in optional fields the model may omit.
    const items = result.value.map((m) => ({
      item: m.item,
      quantity: m.quantity ?? null,
      unit: m.unit ?? null,
      spec: m.spec ?? null,
      ...(m.notes != null ? { notes: m.notes } : {}),
    }));
    return { ok: true, value: items };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Board-level voice transcript → per-breaker updates + notes.
 * componentsJson = JSON.stringify of the panel's current PanelComponent[].
 */
export async function parseBoardVoice(
  componentsJson: string,
  transcript: string,
  opts?: { provider?: TextProvider },
): Promise<Result<BoardVoiceParse>> {
  try {
    const raw = await textComplete(boardVoicePrompt(componentsJson, transcript), {
      provider: opts?.provider,
      json: true,
    });
    const result = extractJson<BoardVoiceParse>(raw);
    if (!result.ok) return result;
    if (!isBoardVoiceParse(result.value)) {
      return { ok: false, error: "Board voice JSON did not match expected shape", raw };
    }
    // Fill in fields the model may omit and drop empty items.
    const items = result.value.items
      .map((i) => ({
        componentId: i.componentId ?? null,
        purposeLabel: i.purposeLabel ?? null,
        rating: i.rating ?? null,
        note_text: i.note_text ?? null,
        order: i.order ?? null,
        row: i.row ?? null,
        col: i.col ?? null,
      }))
      .filter(
        (i) =>
          i.purposeLabel ||
          i.rating ||
          i.note_text ||
          i.order != null ||
          i.row != null ||
          i.col != null,
      );
    return {
      ok: true,
      value: {
        items,
        summary: result.value.summary ?? "",
        layout: result.value.layout,
      },
    };
  } catch (err) {
    return fail(err);
  }
}

/** Question over one job's data (pre-stringified JSON) → plain-text answer. */
export async function askJob(
  jobJson: string,
  question: string,
  opts?: { provider?: TextProvider },
): Promise<Result<string>> {
  try {
    const raw = await textComplete(askJobPrompt(jobJson, question), {
      provider: opts?.provider,
    });
    const answer = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!answer) return { ok: false, error: "Empty answer", raw };
    return { ok: true, value: answer };
  } catch (err) {
    return fail(err);
  }
}
