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

// ---------- Cross-job queries (global Notes / Materials / Ask AI / History) ----

/** Every note across all jobs, newest first. */
export async function getAllNotes(): Promise<Note[]> {
  await ensureDb();
  return db.notes.orderBy('createdAt').reverse().toArray();
}

/** Every material across all jobs, newest first. */
export async function getAllMaterials(): Promise<Material[]> {
  await ensureDb();
  return db.materials.orderBy('createdAt').reverse().toArray();
}

/** Every panel across all jobs, newest first. */
export async function getAllPanels(): Promise<Panel[]> {
  await ensureDb();
  return db.panels.orderBy('createdAt').reverse().toArray();
}

/** Full data for every job — feeds the global "ask across all jobs" prompt. */
export async function assembleAllJobsData(): Promise<JobData[]> {
  await ensureDb();
  const jobs = await listJobs();
  const [allPanels, allNotes, allMaterials] = await Promise.all([
    getAllPanels(),
    getAllNotes(),
    getAllMaterials(),
  ]);
  return jobs.map((job) => ({
    job,
    panels: allPanels.filter((p) => p.jobId === job.id),
    notes: allNotes.filter((n) => n.jobId === job.id),
    materials: allMaterials.filter((m) => m.jobId === job.id),
  }));
}

/** One entry in the activity timeline (derived from row createdAt values). */
export interface ActivityEvent {
  id: string;
  jobId: string;
  jobTitle: string;
  kind: 'job' | 'panel' | 'note' | 'material';
  summary: string;
  createdAt: number;
}

/**
 * A merged, newest-first activity feed across all jobs: job creation, panel
 * captures, notes recorded, and materials added. Powers the History screen.
 */
export async function getActivityFeed(): Promise<ActivityEvent[]> {
  await ensureDb();
  const [jobs, panels, notes, materials] = await Promise.all([
    listJobs(),
    getAllPanels(),
    getAllNotes(),
    getAllMaterials(),
  ]);
  const titleOf = new Map(jobs.map((j) => [j.id, j.title]));
  const events: ActivityEvent[] = [];

  for (const j of jobs) {
    events.push({
      id: `job-${j.id}`,
      jobId: j.id,
      jobTitle: j.title,
      kind: 'job',
      summary: `Job created${j.address ? ` · ${j.address}` : ''}`,
      createdAt: j.createdAt,
    });
  }
  for (const p of panels) {
    const live = p.components.filter((c) => c.type !== 'blank').length;
    events.push({
      id: `panel-${p.id}`,
      jobId: p.jobId,
      jobTitle: titleOf.get(p.jobId) ?? 'Unknown job',
      kind: 'panel',
      summary:
        p.sourceType === 'description'
          ? `Board described (${live} circuits)`
          : `Board captured (${live} circuits)`,
      createdAt: p.createdAt,
    });
  }
  for (const n of notes) {
    events.push({
      id: `note-${n.id}`,
      jobId: n.jobId,
      jobTitle: titleOf.get(n.jobId) ?? 'Unknown job',
      kind: 'note',
      summary: `Note: ${n.cleaned.purpose || n.cleaned.note_text || 'Voice note recorded'}`,
      createdAt: n.createdAt,
    });
  }
  for (const m of materials) {
    events.push({
      id: `material-${m.id}`,
      jobId: m.jobId,
      jobTitle: titleOf.get(m.jobId) ?? 'Unknown job',
      kind: 'material',
      summary: `Material: ${m.item}`,
      createdAt: m.createdAt,
    });
  }

  return events.sort((a, b) => b.createdAt - a.createdAt);
}

// ---------- Backup / restore (local "Sync") ----------

export interface BackupData {
  version: 1;
  exportedAt: number;
  jobs: Job[];
  panels: Panel[];
  notes: Note[];
  materials: Material[];
}

/**
 * Serialise all job data (not photo blobs) into a portable JSON backup.
 * Used by the Sync panel to let a tech move data between devices.
 */
export async function exportBackup(): Promise<BackupData> {
  await ensureDb();
  const [jobs, panels, notes, materials] = await Promise.all([
    db.jobs.toArray(),
    db.panels.toArray(),
    db.notes.toArray(),
    db.materials.toArray(),
  ]);
  return { version: 1, exportedAt: Date.now(), jobs, panels, notes, materials };
}

function isBackupData(v: unknown): v is BackupData {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.version === 1 &&
    Array.isArray(o.jobs) &&
    Array.isArray(o.panels) &&
    Array.isArray(o.notes) &&
    Array.isArray(o.materials)
  );
}

export interface RestoreResult {
  jobs: number;
  panels: number;
  notes: number;
  materials: number;
}

/**
 * Restore a backup produced by {@link exportBackup}. Rows are upserted by id
 * (bulkPut), so importing the same file twice is idempotent and importing a
 * newer export merges cleanly. Throws on a malformed file.
 */
export async function importBackup(raw: unknown): Promise<RestoreResult> {
  if (!isBackupData(raw)) {
    throw new Error('Not a valid ReadBack backup file.');
  }
  await ensureDb();
  await db.transaction(
    'rw',
    [db.jobs, db.panels, db.notes, db.materials],
    async () => {
      await db.jobs.bulkPut(raw.jobs);
      await db.panels.bulkPut(raw.panels);
      await db.notes.bulkPut(raw.notes);
      await db.materials.bulkPut(raw.materials);
    },
  );
  return {
    jobs: raw.jobs.length,
    panels: raw.panels.length,
    notes: raw.notes.length,
    materials: raw.materials.length,
  };
}
