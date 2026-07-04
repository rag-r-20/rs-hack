// Shared type contract for ReadBack. All three workstreams (llm/prompts,
// gradium, db/diagram/UI) code against these exact names — do not rename.

/** Kind of module in a consumer unit, as identified by the vision parse. */
export type ComponentType =
  | 'main_switch'
  | 'RCD'
  | 'RCBO'
  | 'MCB'
  | 'blank'
  | 'other';

// ---------- LLM response shapes (what the model returns, pre-DB) ----------

/** One module as returned by the vision parse (prompt 1). */
export interface VisionComponent {
  id: string;
  /** Physical position: left-to-right then top-to-bottom, starting at 1. */
  order: number;
  /** 1-based row tier on the board (optional — inferred from order if absent). */
  row?: number;
  /** 1-based column within the row (optional — inferred from order if absent). */
  col?: number;
  type: ComponentType;
  /** e.g. "32A", "B16", "63A" — null if not legible. */
  rating: string | null;
  /** Text printed on/near the module — null if none. */
  printed_label: string | null;
  /** Model confidence 0..1. */
  confidence: number;
}

/** Grid metadata from the vision parse (prompt 1). */
export interface PanelGrid {
  /** Total module positions if countable. */
  ways: number | null;
  /** Physical horizontal tiers (typically 1–2). NOT the way count. */
  rows: number;
  /** Modules per row in the widest tier (typically ways ÷ rows). */
  cols?: number | null;
}

/** Full vision-parse response: photo → panel JSON. */
export interface VisionParse {
  panel: PanelGrid;
  components: VisionComponent[];
}

/** Structured note produced by the voice-note → clean-note call (prompt 2). */
export interface CleanedNote {
  purpose: string;
  rating: string | null;
  area_served: string | null;
  feeds: string[];
  cautions: string | null;
  /** 1–2 clean sentences a tradesperson reads at the shop. */
  note_text: string;
}

/** Layout change from a board-level voice note. */
export interface BoardLayoutUpdate {
  rows?: number | null;
  cols?: number | null;
}

/** One actionable statement from the board-level voice parse (prompt 5). */
export interface BoardVoiceItem {
  /** Matched tile id from the supplied components JSON; null = job-level. */
  componentId: string | null;
  /** New purpose label for the tile; null = leave unchanged. */
  purposeLabel: string | null;
  /** New rating for the tile; null = leave unchanged. */
  rating: string | null;
  /** Extra detail worth keeping as a note; null if the statement was purely a label/rating fix. */
  note_text: string | null;
  /** New position number (1..n, left-to-right top-to-bottom); null = leave unchanged. */
  order?: number | null;
  /** New 1-based row tier; null = leave unchanged. */
  row?: number | null;
  /** New 1-based column within row; null = leave unchanged. */
  col?: number | null;
}

/** Full board-level voice parse: one transcript → per-tile updates + notes. */
export interface BoardVoiceParse {
  items: BoardVoiceItem[];
  /** One short sentence describing what was understood. */
  summary: string;
  /** Whole-board grid change, e.g. "it's two rows of six". */
  layout?: BoardLayoutUpdate;
}

/** One item from the voice → materials extraction (prompt 3). */
export interface MaterialItem {
  item: string;
  quantity: number | null;
  unit: string | null;
  spec: string | null;
  notes?: string;
}

// ---------- Persisted data model (IndexedDB, see db.ts) ----------

export interface Job {
  id: string;
  title: string;
  address?: string;
  createdAt: number;
}

/** One breaker tile on the panel diagram (post-vision, user-correctable). */
export interface PanelComponent {
  id: string;
  order: number;
  /** 1-based row tier; synced from grid when reordered. */
  row?: number;
  /** 1-based column within row; synced from grid when reordered. */
  col?: number;
  type: ComponentType;
  rating: string | null;
  /** Purpose label shown on the tile, seeded from printed_label. */
  purposeLabel: string | null;
  noteIds: string[];
  confidence: number;
}

export interface Panel {
  id: string;
  jobId: string;
  sourcePhotoId?: string;
  /** User-facing circuit name, e.g. "Garage sub-board". */
  label?: string;
  /** Plain-text description when the board was created without a photo. */
  sourceDescription?: string;
  sourceType?: 'photo' | 'description';
  components: PanelComponent[];
  /** Physical rows on the board (from the vision parse); absent = 1. */
  rows?: number;
  /** Modules per row in the widest tier; absent = inferred from component count. */
  cols?: number;
  createdAt: number;
}

export interface Note {
  id: string;
  jobId: string;
  /** The tile this note is attached to; absent for job-level notes. */
  componentId?: string;
  transcript: string;
  cleaned: CleanedNote;
  audioRef?: string;
  createdAt: number;
}

export interface Material {
  id: string;
  jobId: string;
  item: string;
  quantity: number | null;
  unit: string | null;
  spec: string | null;
  notes?: string;
  /** Stretch: ticked off once bought at the wholesaler. */
  sourced?: boolean;
  createdAt: number;
}

// ---------- Result wrapper so callers never have to try/catch lib calls ----------

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; raw?: string };
