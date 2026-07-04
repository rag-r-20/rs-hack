// IndexedDB storage via Dexie. Four tables keyed by id; panel/note/material
// rows carry jobId so a full job assembles with three indexed queries.

import Dexie, { type Table } from 'dexie';
import {
  inferGridFromVision,
  syncComponentGrid,
} from './diagram';
import type {
  Job,
  Material,
  MaterialItem,
  Note,
  Panel,
  PanelComponent,
  CleanedNote,
  VisionParse,
  VisionComponent,
} from './types';

/** Original capture stored so the before/after view can show the source photo. */
export interface StoredPhoto {
  id: string;
  blob: Blob;
  jobId?: string;
  label?: string;
  createdAt: number;
}

class ReadBackDB extends Dexie {
  jobs!: Table<Job, string>;
  panels!: Table<Panel, string>;
  notes!: Table<Note, string>;
  materials!: Table<Material, string>;
  photos!: Table<StoredPhoto, string>;

  constructor() {
    super('readback');
    this.version(1).stores({
      jobs: 'id, createdAt',
      panels: 'id, jobId, createdAt',
      notes: 'id, jobId, componentId, createdAt',
      materials: 'id, jobId, createdAt',
    });
    // v2: add a photos table for the captured source images (UI/before-after).
    this.version(2).stores({
      photos: 'id, createdAt',
    });
    // v3: job-scoped property photos (gallery, not tied to a panel render).
    this.version(3).stores({
      photos: 'id, jobId, createdAt',
    });
  }
}

export const db = new ReadBackDB();

let dbOpen: Promise<void> | null = null;

/** Open IndexedDB once; surfaces a clear error on mobile/private browsing. */
export async function ensureDb(): Promise<void> {
  if (!dbOpen) {
    dbOpen = db
      .open()
      .then(() => undefined)
      .catch((err) => {
        dbOpen = null;
        throw err;
      });
  }
  return dbOpen;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- Jobs ----------

export async function createJob(title: string, address?: string): Promise<Job> {
  await ensureDb();
  const job: Job = { id: newId(), title, address, createdAt: Date.now() };
  await db.jobs.add(job);
  return job;
}

export async function getJob(jobId: string): Promise<Job | undefined> {
  await ensureDb();
  return db.jobs.get(jobId);
}

export async function listJobs(): Promise<Job[]> {
  await ensureDb();
  return db.jobs.orderBy('createdAt').reverse().toArray();
}

/** Deletes the job and everything hanging off it (including captured photos). */
export async function deleteJob(jobId: string): Promise<void> {
  await db.transaction('rw', [db.jobs, db.panels, db.notes, db.materials, db.photos], async () => {
    const panels = await db.panels.where('jobId').equals(jobId).toArray();
    const photoIds = new Set(
      panels
        .map((p) => p.sourcePhotoId)
        .filter((id): id is string => Boolean(id)),
    );
    const jobPhotos = await db.photos.where('jobId').equals(jobId).toArray();
    for (const photo of jobPhotos) photoIds.add(photo.id);
    if (photoIds.size) await db.photos.bulkDelete([...photoIds]);
    await db.panels.where('jobId').equals(jobId).delete();
    await db.notes.where('jobId').equals(jobId).delete();
    await db.materials.where('jobId').equals(jobId).delete();
    await db.jobs.delete(jobId);
  });
}

// ---------- Photos ----------

/** Store a captured image blob; returns the id to pass as sourcePhotoId. */
export async function addPhoto(
  blob: Blob,
  opts?: { jobId?: string; label?: string },
): Promise<string> {
  const id = newId();
  await db.photos.add({
    id,
    blob,
    jobId: opts?.jobId,
    label: opts?.label,
    createdAt: Date.now(),
  });
  return id;
}

/** Property-level photos for a job (not necessarily linked to a panel render). */
export async function getPhotosForJob(jobId: string): Promise<StoredPhoto[]> {
  return db.photos.where('jobId').equals(jobId).sortBy('createdAt');
}

/** Fetch a stored photo blob (undefined if missing). */
export async function getPhoto(photoId: string): Promise<Blob | undefined> {
  const row = await db.photos.get(photoId);
  return row?.blob;
}

// ---------- Panels & components ----------

export interface AddPanelOpts {
  sourcePhotoId?: string;
  rows?: number;
  cols?: number;
  label?: string;
  sourceDescription?: string;
  sourceType?: 'photo' | 'description';
}

export async function addPanel(
  jobId: string,
  components: PanelComponent[],
  opts?: AddPanelOpts,
): Promise<Panel>;
export async function addPanel(
  jobId: string,
  components: PanelComponent[],
  sourcePhotoId?: string,
  rows?: number,
  cols?: number,
): Promise<Panel>;
export async function addPanel(
  jobId: string,
  components: PanelComponent[],
  sourcePhotoIdOrOpts?: string | AddPanelOpts,
  rows?: number,
  cols?: number,
): Promise<Panel> {
  const opts: AddPanelOpts =
    typeof sourcePhotoIdOrOpts === 'object' && sourcePhotoIdOrOpts != null
      ? sourcePhotoIdOrOpts
      : {
          sourcePhotoId: sourcePhotoIdOrOpts,
          rows,
          cols,
        };
  const panel: Panel = {
    id: newId(),
    jobId,
    sourcePhotoId: opts.sourcePhotoId,
    label: opts.label,
    sourceDescription: opts.sourceDescription,
    sourceType: opts.sourceType,
    components,
    rows: opts.rows,
    cols: opts.cols,
    createdAt: Date.now(),
  };
  await db.panels.add(panel);
  return panel;
}

export async function getPanelsForJob(jobId: string): Promise<Panel[]> {
  return db.panels.where('jobId').equals(jobId).sortBy('createdAt');
}

/** Patch one tile in place (fix rating/type/label, attach note ids). */
export async function updateComponent(
  panelId: string,
  componentId: string,
  patch: Partial<Omit<PanelComponent, 'id'>>,
): Promise<void> {
  const panel = await db.panels.get(panelId);
  if (!panel) return;
  const components = panel.components.map((c) =>
    c.id === componentId ? { ...c, ...patch } : c,
  );
  await db.panels.update(panelId, { components });
}

/**
 * Replace a panel's whole component list (used for add/remove/reorder in the
 * tile editor). Order and row/col fields are re-synced to the panel grid.
 */
export async function replacePanelComponents(
  panelId: string,
  components: PanelComponent[],
): Promise<void> {
  const panel = await db.panels.get(panelId);
  if (!panel) return;
  const rows = panel.rows ?? 1;
  const cols = panel.cols ?? Math.max(1, Math.ceil(components.length / rows));
  const synced = syncComponentGrid(components, rows, cols);
  await db.panels.update(panelId, { components: synced });
}

/** Update the board grid shape (rows/cols) and re-sync tile positions. */
export async function updatePanelLayout(
  panelId: string,
  patch: { rows?: number; cols?: number },
  components?: PanelComponent[],
): Promise<void> {
  const panel = await db.panels.get(panelId);
  if (!panel) return;
  const rows = patch.rows ?? panel.rows ?? 1;
  const cols =
    patch.cols ??
    panel.cols ??
    Math.max(1, Math.ceil((components ?? panel.components).length / rows));
  const synced = syncComponentGrid(components ?? panel.components, rows, cols);
  await db.panels.update(panelId, { rows, cols, components: synced });
}

/**
 * Apply board-voice or manual edits, optionally preserving explicit row/col
 * positions instead of re-flowing to a uniform grid.
 */
export async function replacePanelComponentsRaw(
  panelId: string,
  components: PanelComponent[],
  layout?: { rows?: number; cols?: number },
  opts?: { preservePositions?: boolean },
): Promise<void> {
  const panel = await db.panels.get(panelId);
  if (!panel) return;
  const rows = layout?.rows ?? panel.rows ?? 1;
  const cols =
    layout?.cols ??
    panel.cols ??
    Math.max(1, Math.ceil(components.length / rows));
  const final = opts?.preservePositions
    ? components.map((c, i) => ({ ...c, order: i + 1 }))
    : syncComponentGrid(components, rows, cols);
  await db.panels.update(panelId, { rows, cols, components: final });
}

export interface BoardVoiceNoteDraft {
  componentId?: string;
  transcript: string;
  cleaned: CleanedNote;
}

/** Atomically persist board-voice layout edits and any new notes. */
export async function applyBoardVoiceChanges(
  jobId: string,
  panelId: string,
  components: PanelComponent[],
  layout: { rows: number; cols: number },
  opts: { preservePositions?: boolean },
  notes: BoardVoiceNoteDraft[],
): Promise<void> {
  await db.transaction("rw", [db.panels, db.notes], async () => {
    const panel = await db.panels.get(panelId);
    if (!panel) throw new Error("Panel not found");

    const rows = layout.rows;
    const cols = layout.cols;
    let final = opts.preservePositions
      ? components.map((c, i) => ({ ...c, order: i + 1 }))
      : syncComponentGrid(components, rows, cols);

    const newNotes: Note[] = [];
    for (const draft of notes) {
      const note: Note = {
        id: newId(),
        jobId,
        componentId: draft.componentId,
        transcript: draft.transcript,
        cleaned: draft.cleaned,
        createdAt: Date.now(),
      };
      newNotes.push(note);
      if (draft.componentId) {
        final = final.map((c) =>
          c.id === draft.componentId
            ? { ...c, noteIds: [...c.noteIds, note.id] }
            : c,
        );
      }
    }

    await db.panels.update(panelId, { rows, cols, components: final });
    if (newNotes.length) await db.notes.bulkAdd(newNotes);
  });
}

/**
 * Convert a vision-parse result into storable PanelComponent tiles.
 * printed_label seeds purposeLabel; the user refines it in the tile editor.
 */
export function visionParseToComponents(parse: VisionParse): PanelComponent[] {
  const { cols } = inferGridFromVision(parse);
  const sorted = [...parse.components].sort((a, b) => {
    const ar = a.row ?? Math.floor((a.order - 1) / cols) + 1;
    const br = b.row ?? Math.floor((b.order - 1) / cols) + 1;
    if (ar !== br) return ar - br;
    const ac = a.col ?? ((a.order - 1) % cols) + 1;
    const bc = b.col ?? ((b.order - 1) % cols) + 1;
    return ac - bc;
  });
  return sorted.map((v: VisionComponent, i) => ({
    id: v.id || newId(),
    order: i + 1,
    row: v.row ?? Math.floor(i / cols) + 1,
    col: v.col ?? (i % cols) + 1,
    type: v.type,
    rating: v.rating,
    purposeLabel: v.printed_label,
    noteIds: [] as string[],
    confidence: v.confidence,
  }));
}

// ---------- Notes ----------

export async function addNote(
  jobId: string,
  transcript: string,
  cleaned: CleanedNote,
  opts?: { componentId?: string; audioRef?: string },
): Promise<Note> {
  const note: Note = {
    id: newId(),
    jobId,
    componentId: opts?.componentId,
    transcript,
    cleaned,
    audioRef: opts?.audioRef,
    createdAt: Date.now(),
  };
  await db.notes.add(note);
  // Keep the tile's noteIds in sync so the diagram can show a note marker.
  if (opts?.componentId) {
    const panels = await getPanelsForJob(jobId);
    for (const panel of panels) {
      const target = panel.components.find((c) => c.id === opts.componentId);
      if (target) {
        await updateComponent(panel.id, target.id, {
          noteIds: [...target.noteIds, note.id],
        });
        break;
      }
    }
  }
  return note;
}

export async function getNotesForJob(jobId: string): Promise<Note[]> {
  return db.notes.where('jobId').equals(jobId).sortBy('createdAt');
}

// ---------- Materials ----------

export async function addMaterials(
  jobId: string,
  items: MaterialItem[],
): Promise<Material[]> {
  const now = Date.now();
  const rows: Material[] = items.map((m) => ({
    id: newId(),
    jobId,
    item: m.item,
    quantity: m.quantity,
    unit: m.unit,
    spec: m.spec,
    notes: m.notes,
    sourced: false,
    createdAt: now,
  }));
  await db.materials.bulkAdd(rows);
  return rows;
}

export async function getMaterialsForJob(jobId: string): Promise<Material[]> {
  return db.materials.where('jobId').equals(jobId).sortBy('createdAt');
}

export async function toggleMaterialSourced(materialId: string): Promise<void> {
  const material = await db.materials.get(materialId);
  if (!material) return;
  await db.materials.update(materialId, { sourced: !material.sourced });
}

// ---------- Retrieval ----------

export interface JobData {
  job: Job;
  panels: Panel[];
  notes: Note[];
  materials: Material[];
}

/** Everything about a job in one object — feeds the "ask your job" prompt. */
export async function assembleJobData(jobId: string): Promise<JobData | undefined> {
  const job = await db.jobs.get(jobId);
  if (!job) return undefined;
  const [panels, notes, materials] = await Promise.all([
    getPanelsForJob(jobId),
    getNotesForJob(jobId),
    getMaterialsForJob(jobId),
  ]);
  return { job, panels, notes, materials };
}
