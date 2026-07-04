import { useState } from "react";
import type { ReactNode } from "react";
import type { ComponentType, Note, PanelComponent } from "../lib/types";
import { addNote } from "../lib/db";
import { transcribeBlob, speak } from "../lib/gradium";
import { cleanNote } from "../lib/llm";
import { Sheet } from "./ui/Sheet";
import { Button } from "./ui/Button";
import { VoiceRecorder } from "./VoiceRecorder";
import { useToast } from "./ui/Toast";

const TYPES: { value: ComponentType; label: string }[] = [
  { value: "main_switch", label: "Main switch" },
  { value: "RCD", label: "RCD" },
  { value: "RCBO", label: "RCBO" },
  { value: "MCB", label: "MCB" },
  { value: "blank", label: "Blank / spare" },
  { value: "other", label: "Other" },
];

type Pipeline = "idle" | "transcribing" | "cleaning";

interface Props {
  jobId: string;
  tile: PanelComponent;
  notes: Note[];
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onSaveField: (patch: Partial<Omit<PanelComponent, "id">>) => Promise<void>;
  onDelete: () => Promise<void>;
  onMove: (dir: -1 | 1) => Promise<void>;
  onAddAfter: () => Promise<void>;
  onNotesChanged: () => void;
  onClose: () => void;
}

export function TileEditor({
  jobId,
  tile,
  notes,
  canMoveLeft,
  canMoveRight,
  onSaveField,
  onDelete,
  onMove,
  onAddAfter,
  onNotesChanged,
  onClose,
}: Props) {
  const toast = useToast();
  const [rating, setRating] = useState(tile.rating ?? "");
  const [label, setLabel] = useState(tile.purposeLabel ?? "");
  const [pipeline, setPipeline] = useState<Pipeline>("idle");

  async function saveMeta(patch: Partial<Omit<PanelComponent, "id">>) {
    await onSaveField(patch);
  }

  async function handleRecorded(blob: Blob) {
    setPipeline("transcribing");
    const stt = await transcribeBlob(blob);
    if (!stt.ok) {
      setPipeline("idle");
      toast.error(stt.error);
      return;
    }
    setPipeline("cleaning");
    const cleaned = await cleanNote(tile.purposeLabel, tile.rating, stt.transcript);
    if (!cleaned.ok) {
      setPipeline("idle");
      toast.error(cleaned.error);
      return;
    }
    await addNote(jobId, stt.transcript, cleaned.value, { componentId: tile.id });
    setPipeline("idle");
    toast.success("Note saved.");
    onNotesChanged();
    void speak("Note saved.").then((r) => {
      if (!r.ok) return;
      const url = URL.createObjectURL(r.audio);
      const audio = new Audio(url);
      audio.addEventListener("ended", () => URL.revokeObjectURL(url), { once: true });
      void audio.play().catch(() => URL.revokeObjectURL(url));
    });
  }

  return (
    <Sheet open onClose={onClose} title={`Breaker ${tile.order}`}>
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Type</span>
            <select
              value={tile.type}
              onChange={(e) =>
                void saveMeta({ type: e.target.value as ComponentType })
              }
              className="rounded-xl border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-blue-500"
            >
              {TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Rating</span>
            <input
              value={rating}
              onChange={(e) => setRating(e.target.value)}
              onBlur={() => void saveMeta({ rating: rating.trim() || null })}
              placeholder="e.g. 32A"
              className="rounded-xl border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-blue-500"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-zinc-700">Label</span>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => void saveMeta({ purposeLabel: label.trim() || null })}
              placeholder="e.g. Kitchen ring"
              className="rounded-xl border border-zinc-300 px-3 py-2.5 text-base outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!canMoveLeft}
            onClick={() => void onMove(-1)}
          >
            ← Move
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!canMoveRight}
            onClick={() => void onMove(1)}
          >
            Move →
          </Button>
          <Button variant="secondary" size="sm" onClick={() => void onAddAfter()}>
            + Add after
          </Button>
          <Button
            variant="danger"
            size="sm"
            className="ml-auto"
            onClick={() => void onDelete()}
          >
            Delete
          </Button>
        </div>

        <div className="border-t border-zinc-100 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-zinc-700">
            Voice notes
          </h3>

          {notes.length > 0 && (
            <ul className="mb-4 flex flex-col gap-2">
              {notes.map((n) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  tileRating={tile.rating}
                  onApplyRating={(r) => void saveMeta({ rating: r })}
                />
              ))}
            </ul>
          )}

          <div className="rounded-2xl bg-zinc-50 p-4">
            <VoiceRecorder
              onRecorded={handleRecorded}
              busy={pipeline !== "idle"}
              busyLabel={
                pipeline === "transcribing" ? "Transcribing…" : "Cleaning note…"
              }
              idleLabel="Tap and describe this breaker"
            />
          </div>
        </div>
      </div>
    </Sheet>
  );
}

function NoteCard({
  note,
  tileRating,
  onApplyRating,
}: {
  note: Note;
  tileRating: string | null;
  onApplyRating: (rating: string) => void;
}) {
  const c = note.cleaned;
  const rating = c.rating;
  const showApply = rating && rating !== tileRating;
  return (
    <li className="rounded-xl border border-zinc-200 bg-white p-3">
      <p className="font-medium text-zinc-900">{c.purpose}</p>
      <p className="mt-0.5 text-sm text-zinc-600">{c.note_text}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {c.area_served && <Chip>{c.area_served}</Chip>}
        {c.feeds.map((f, i) => (
          <Chip key={i}>{f}</Chip>
        ))}
        {c.cautions && <Chip warn>⚠ {c.cautions}</Chip>}
      </div>
      {showApply && (
        <button
          onClick={() => onApplyRating(rating!)}
          className="mt-2 text-xs font-medium text-blue-700 hover:underline"
        >
          Apply rating “{rating}” to tile
        </button>
      )}
    </li>
  );
}

function Chip({
  children,
  warn,
}: {
  children: ReactNode;
  warn?: boolean;
}) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs ${
        warn ? "bg-amber-100 text-amber-800" : "bg-zinc-100 text-zinc-600"
      }`}
    >
      {children}
    </span>
  );
}
