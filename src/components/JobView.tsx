import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { Job, Material, Note, Panel, PanelComponent } from "../lib/types";
import {
  getJob,
  getPanelsForJob,
  getNotesForJob,
  getMaterialsForJob,
  getPhotosForJob,
  updateComponent,
  replacePanelComponents,
  newId,
  type StoredPhoto,
} from "../lib/db";
import { TopBar } from "./TopBar";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { BeforeAfter } from "./BeforeAfter";
import { BoardVoice } from "./BoardVoice";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { TileEditor } from "./TileEditor";
import { NotesList } from "./NotesList";
import { MaterialsList } from "./MaterialsList";
import { JobSearch } from "./JobSearch";
import { PropertyImages } from "./PropertyImages";

type Tab = "board" | "notes" | "materials" | "ask";

const TABS: { id: Tab; label: string }[] = [
  { id: "board", label: "Board" },
  { id: "notes", label: "Notes" },
  { id: "materials", label: "Materials" },
  { id: "ask", label: "Ask" },
];

export function JobView() {
  const { jobId = "" } = useParams();
  const navigate = useNavigate();

  const [job, setJob] = useState<Job | null>(null);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [materials, setMaterials] = useState<Material[]>([]);
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("board");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightIds, setHighlightIds] = useState<Set<string> | null>(null);

  const refresh = useCallback(async () => {
    const j = await getJob(jobId);
    if (!j) {
      navigate("/", { replace: true });
      return;
    }
    const [panels, ns, ms, ps] = await Promise.all([
      getPanelsForJob(jobId),
      getNotesForJob(jobId),
      getMaterialsForJob(jobId),
      getPhotosForJob(jobId),
    ]);
    setJob(j);
    setPanel(panels.length ? panels[panels.length - 1] : null);
    setNotes(ns);
    setMaterials(ms);
    setPhotos(ps);
    setLoading(false);
  }, [jobId, navigate]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const components = panel?.components ?? [];
  const boardTitle = panel?.label ?? job?.title;
  const boardCaption =
    panel?.sourceType === "description" && panel.sourceDescription
      ? panel.sourceDescription
      : undefined;
  const selectedTile = useMemo(
    () => components.find((c) => c.id === selectedId) ?? null,
    [components, selectedId],
  );
  const selectedIndex = selectedTile
    ? components.findIndex((c) => c.id === selectedTile.id)
    : -1;
  const tileNotes = useMemo(
    () => notes.filter((n) => n.componentId === selectedId),
    [notes, selectedId],
  );

  function openTile(id: string) {
    setTab("board");
    setSelectedId(id);
  }

  async function saveField(patch: Partial<Omit<PanelComponent, "id">>) {
    if (!panel || !selectedTile) return;
    await updateComponent(panel.id, selectedTile.id, patch);
    await refresh();
  }

  async function deleteTile() {
    if (!panel || !selectedTile) return;
    await replacePanelComponents(
      panel.id,
      components.filter((c) => c.id !== selectedTile.id),
    );
    setSelectedId(null);
    await refresh();
  }

  async function moveTile(dir: -1 | 1) {
    if (!panel || selectedIndex < 0) return;
    const j = selectedIndex + dir;
    if (j < 0 || j >= components.length) return;
    const next = [...components];
    [next[selectedIndex], next[j]] = [next[j], next[selectedIndex]];
    await replacePanelComponents(panel.id, next);
    await refresh();
  }

  async function reorderTiles(orderedIds: string[]) {
    if (!panel) return;
    const byId = new Map(components.map((c) => [c.id, c]));
    const next = orderedIds
      .map((id) => byId.get(id))
      .filter((c): c is PanelComponent => Boolean(c));
    if (next.length !== components.length) return;
    await replacePanelComponents(panel.id, next);
    await refresh();
  }

  async function addAfter() {
    if (!panel || selectedIndex < 0) return;
    const fresh: PanelComponent = {
      id: newId(),
      order: 0,
      type: "MCB",
      rating: null,
      purposeLabel: null,
      noteIds: [],
      confidence: 1,
    };
    const next = [...components];
    next.splice(selectedIndex + 1, 0, fresh);
    await replacePanelComponents(panel.id, next);
    await refresh();
    setSelectedId(fresh.id);
  }

  if (loading) {
    return (
      <>
        <TopBar title="Loading…" back backTo="/" />
        <p className="py-16 text-center text-sm text-zinc-400">Loading…</p>
      </>
    );
  }

  return (
    <>
      <TopBar
        title={job?.title ?? "Job"}
        subtitle={job?.address}
        back
        backTo="/"
        right={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => navigate(`/job/${jobId}/capture`)}
          >
            {panel ? "Recapture" : "Capture"}
          </Button>
        }
      />

      <nav className="sticky top-[57px] z-20 flex border-b border-zinc-200 bg-white">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
              tab === t.id
                ? "border-blue-700 text-blue-700"
                : "border-transparent text-zinc-500 hover:text-zinc-800"
            }`}
          >
            {t.label}
            {t.id === "notes" && notes.length > 0 && ` (${notes.length})`}
            {t.id === "materials" &&
              materials.length > 0 &&
              ` (${materials.length})`}
          </button>
        ))}
      </nav>

      <main className="flex-1 px-4 py-4">
        <PropertyImages jobId={jobId} photos={photos} onChanged={refresh} />

        {tab === "board" &&
          (panel ? (
            <>
              <ErrorBoundary>
                {boardCaption && (
                  <p className="mb-3 text-sm text-zinc-500">{boardCaption}</p>
                )}
                <BeforeAfter
                  photoId={panel.sourcePhotoId}
                  components={components}
                  rows={panel.rows}
                  cols={panel.cols}
                  title={boardTitle}
                  selectedId={selectedId}
                  highlightIds={highlightIds ?? undefined}
                  onSelectTile={openTile}
                  onReorder={(ids) => void reorderTiles(ids)}
                />
              </ErrorBoundary>
              <ErrorBoundary>
                <BoardVoice
                  jobId={jobId}
                  panel={panel}
                  components={components}
                  onChanged={() => void refresh()}
                />
              </ErrorBoundary>
            </>
          ) : (
            <NoBoard
              onCapture={() => navigate(`/job/${jobId}/capture`)}
              onDescribe={() => navigate(`/job/${jobId}/describe`)}
            />
          ))}

        {tab === "notes" && (
          <NotesList
            notes={notes}
            components={components}
            onSelectTile={openTile}
          />
        )}

        {tab === "materials" && (
          <MaterialsList
            jobId={jobId}
            materials={materials}
            onChanged={refresh}
          />
        )}

        {tab === "ask" && (
          <JobSearch
            jobId={jobId}
            components={components}
            notes={notes}
            materials={materials}
            onHighlight={setHighlightIds}
            onSelectTile={openTile}
          />
        )}
      </main>

      {selectedTile && panel && (
        <TileEditor
          jobId={jobId}
          tile={selectedTile}
          notes={tileNotes}
          canMoveLeft={selectedIndex > 0}
          canMoveRight={selectedIndex < components.length - 1}
          onSaveField={saveField}
          onDelete={deleteTile}
          onMove={moveTile}
          onAddAfter={addAfter}
          onNotesChanged={refresh}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}

function NoBoard({
  onCapture,
  onDescribe,
}: {
  onCapture: () => void;
  onDescribe: () => void;
}) {
  return (
    <Card className="mt-8 flex flex-col items-center p-8 text-center">
      <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <rect
            x="3"
            y="6"
            width="18"
            height="13"
            rx="2"
            stroke="currentColor"
            strokeWidth="1.8"
          />
          <circle cx="12" cy="12.5" r="3.5" stroke="currentColor" strokeWidth="1.8" />
          <path d="M8 6l1.5-2h5L16 6" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-zinc-900">No board yet</h2>
      <p className="mt-1 max-w-xs text-sm text-zinc-500">
        Capture a photo or describe the board in plain English to generate a
        clean, labeled diagram.
      </p>
      <div className="mt-5 flex w-full max-w-xs flex-col gap-2">
        <Button size="lg" block onClick={onCapture}>
          Capture board
        </Button>
        <Button size="lg" variant="secondary" block onClick={onDescribe}>
          Describe board
        </Button>
      </div>
    </Card>
  );
}
