// The 4 prompts from readback-build-doc.md, copied faithfully, exposed as
// constants / template functions. llm.ts is the only consumer.

/** Prompt 1: vision parse — photo → panel JSON. Send with the image attached. */
export const VISION_PARSE_PROMPT = `You are a vision assistant for electricians. You are shown a photo of a domestic
consumer unit / distribution board. Identify ONLY what is visibly present. Do NOT
infer wiring, circuits served, or purpose. Return STRICT JSON only, no prose.

{
  "panel": {
    "ways": <int total module positions if countable, else null>,
    "rows": <int physical horizontal TIERS on the board — typically 1 or 2. This is NOT the way count.>,
    "cols": <int modules per row in the widest tier — typically ways ÷ rows, e.g. 12 ways in 2 rows → 6 cols>
  },
  "components": [
    { "id": "c1",
      "order": <int, left-to-right then top-to-bottom, starting at 1>,
      "row": <int 1-based tier, top row = 1>,
      "col": <int 1-based column within that row, left = 1>,
      "type": "main_switch | RCD | RCBO | MCB | blank | other",
      "rating": "<e.g. 32A, B16, 63A; null if not legible>",
      "printed_label": "<text printed on/near it; null if none>",
      "confidence": <0.0-1.0> }
  ]
}
Order strictly by physical position (row then col). rows × cols should cover all
modules. If unsure of type, use "other" with low confidence. Never fabricate
ratings or labels.`;

/** Text description → panel JSON (same shape as vision parse, no image). */
export function descriptionParsePrompt(description: string): string {
  return `You are an assistant for electricians. The user described a domestic consumer
unit / distribution board in plain English. Infer ONLY what they stated. Do NOT
invent wiring, circuits served, or labels they did not mention. Return STRICT JSON
only, no prose.

{
  "panel": {
    "ways": <int total module positions if stated or inferable, else null>,
    "rows": <int physical horizontal TIERS — typically 1 or 2. This is NOT the way count.>,
    "cols": <int modules per row in the widest tier>
  },
  "components": [
    { "id": "c1",
      "order": <int, left-to-right then top-to-bottom, starting at 1>,
      "row": <int 1-based tier, top row = 1>,
      "col": <int 1-based column within that row, left = 1>,
      "type": "main_switch | RCD | RCBO | MCB | blank | other",
      "rating": "<e.g. 32A, B16, 63A; null if not stated>",
      "printed_label": "<purpose label if stated; null if none>",
      "confidence": <0.0-1.0 — lower when inferred from vague wording> }
  ]
}
Order strictly by physical position (row then col). If unsure of type, use "other"
with low confidence. Never fabricate ratings or labels.

DESCRIPTION: ${description}`;
}

/** Prompt 2: voice note → clean note (one tile). */
export function cleanNotePrompt(
  existingLabel: string | null,
  rating: string | null,
  transcript: string,
): string {
  return `Clean an electrician's spoken note about ONE breaker into a tidy record.
Inputs: the breaker's current label/rating, and a raw voice transcript.
Return STRICT JSON:
{ "purpose": "<short, e.g. 'Kitchen ring main'>",
  "rating": "<if stated, else keep existing>",
  "area_served": "<e.g. 'Kitchen + utility'>",
  "feeds": ["<e.g. 'oven', 'window sockets'>"],
  "cautions": "<any warning stated, else null>",
  "note_text": "<1-2 clean sentences a tradesperson reads at the shop>" }
Use only information in the transcript or existing label. Do not invent.

EXISTING LABEL: ${existingLabel ?? "(none)"}
EXISTING RATING: ${rating ?? "(none)"}
TRANSCRIPT: ${transcript}`;
}

/** Prompt 3: voice → materials list (base instruction, no transcript). */
export const MATERIALS_PROMPT = `Extract materials the electrician says they need into a job shopping list.
Return STRICT JSON array, one object per item:
[ { "item": "<e.g. 'Twin & earth cable'>",
    "quantity": <number or null>,
    "unit": "<m, each, box... or null>",
    "spec": "<e.g. '6mm2', '32A Type B MCB'; null if none>",
    "notes": "<optional>" } ]
Merge obvious duplicates. Use null when quantity/unit/spec is unclear.
Only include items actually requested.`;

/** Prompt 3 with the transcript appended — what llm.ts actually sends. */
export function materialsPrompt(transcript: string): string {
  return `${MATERIALS_PROMPT}

TRANSCRIPT: ${transcript}`;
}

/** Prompt 5: board-level voice note → per-breaker updates + layout edits. */
export function boardVoicePrompt(contextJson: string, transcript: string): string {
  return `An electrician looked at a whole consumer unit and spoke one free-form note that may
describe SEVERAL breakers, correct the board layout, or move breakers around
("number 3 is the kitchen ring, 32 amp; it's actually two rows of six; move the
shower to position 8; swap breakers 3 and 4"). Split the transcript into
actionable statements and match each to a component from the panel JSON below,
using position number ("order"), row/col, existing label ("purposeLabel") or
rating. Return STRICT JSON:

{ "layout": { "rows": <int or null>, "cols": <int or null> },
  "items": [
    { "componentId": "<id of the matched component, or null if no confident match>",
      "purposeLabel": "<new/updated purpose label for that tile, else null>",
      "rating": "<rating if stated, e.g. '32A', else null>",
      "note_text": "<1 clean sentence of extra detail worth keeping, else null>",
      "order": <new position 1..n left-to-right top-to-bottom, or null>,
      "row": <new 1-based row tier, or null>,
      "col": <new 1-based column within row, or null> } ],
  "summary": "<one short sentence: what you understood overall>" }

Rules:
- Use only information in the transcript; never invent labels or ratings.
- "number N" / "breaker N" / "position N" refers to the component with order == N.
- Layout commands ("two rows of six", "single row board") go in layout.rows / layout.cols.
- Moving a breaker: set order and/or row+col on the matched item. Swapping two
  breakers: two items each with their new order/row/col.
- If a statement clearly matches no component, keep it: componentId null, the
  content in note_text.
- Omit layout entirely if the transcript does not mention grid shape.
- Every item must have at least one of purposeLabel, rating, note_text, order,
  row, col non-null.

PANEL CONTEXT: ${contextJson}
TRANSCRIPT: ${transcript}`;
}

/** Prompt 4: ask your job (retrieval). jobJson = JSON.stringify of the job. */
export function askJobPrompt(jobJson: string, question: string): string {
  return `Answer the electrician's question using ONLY this job's data (panel components,
notes, materials) given as JSON. Be concise and practical. If the answer isn't in
the data, say so plainly. After the answer, cite the source (breaker order number
and/or note) you used.
JOB DATA: ${jobJson}
QUESTION: ${question}`;
}
