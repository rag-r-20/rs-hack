import { useState } from "react";
import type { ReactNode } from "react";
import type { ComponentType, PanelComponent } from "../lib/types";
import { newId } from "../lib/db";
import { TopBar } from "./TopBar";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";

const TYPES: { value: ComponentType; label: string }[] = [
  { value: "main_switch", label: "Main switch" },
  { value: "RCD", label: "RCD" },
  { value: "RCBO", label: "RCBO" },
  { value: "MCB", label: "MCB" },
  { value: "blank", label: "Blank / spare" },
  { value: "other", label: "Other" },
];

interface Draft {
  key: string;
  type: ComponentType;
  rating: string;
  label: string;
}

interface Props {
  photoUrl?: string;
  reason: string | null;
  onCancel: () => void;
  onConfirm: (components: PanelComponent[]) => Promise<void> | void;
  cancelLabel?: string;
}

/** Safety net when the vision parse fails: build tiles by hand over the photo. */
export function ManualPlacement({
  photoUrl,
  reason,
  onCancel,
  onConfirm,
  cancelLabel = "Retake photo",
}: Props) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);

  function addTile(type: ComponentType = "MCB") {
    setDrafts((d) => [...d, { key: newId(), type, rating: "", label: "" }]);
  }

  function update(key: string, patch: Partial<Draft>) {
    setDrafts((d) => d.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  function remove(key: string) {
    setDrafts((d) => d.filter((t) => t.key !== key));
  }

  function move(key: string, dir: -1 | 1) {
    setDrafts((d) => {
      const i = d.findIndex((t) => t.key === key);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.length) return d;
      const next = [...d];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function confirm() {
    setSaving(true);
    const components: PanelComponent[] = drafts.map((t, i) => ({
      id: newId(),
      order: i + 1,
      type: t.type,
      rating: t.rating.trim() || null,
      purposeLabel: t.label.trim() || null,
      noteIds: [],
      confidence: 1,
    }));
    await onConfirm(components);
    setSaving(false);
  }

  return (
    <>
      <TopBar title="Add tiles by hand" />
      <main className="flex-1 px-4 py-4">
        <Card className="mb-4 border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">
            Couldn’t auto-read this board
          </p>
          <p className="mt-1 text-sm text-amber-800">
            {reason
              ? `${reason} — add the breakers yourself below; you still get a clean diagram.`
              : "Add the breakers yourself below; you still get a clean diagram."}
          </p>
        </Card>

        <div className="mb-4 overflow-hidden rounded-2xl bg-zinc-900">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt="Board"
              className="mx-auto max-h-64 w-auto object-contain"
            />
          ) : (
            <p className="px-4 py-8 text-center text-sm text-zinc-400">
              No photo — add breakers in order below.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {drafts.map((t, i) => (
            <Card key={t.key} className="p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold text-zinc-500">
                  Position {i + 1}
                </span>
                <div className="flex items-center gap-1">
                  <IconBtn label="Move left" onClick={() => move(t.key, -1)}>
                    ←
                  </IconBtn>
                  <IconBtn label="Move right" onClick={() => move(t.key, 1)}>
                    →
                  </IconBtn>
                  <IconBtn label="Remove" onClick={() => remove(t.key)} danger>
                    ✕
                  </IconBtn>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={t.type}
                  onChange={(e) =>
                    update(t.key, { type: e.target.value as ComponentType })
                  }
                  className="rounded-lg border border-zinc-300 px-2.5 py-2 text-sm outline-none focus:border-blue-500"
                >
                  {TYPES.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <input
                  value={t.rating}
                  onChange={(e) => update(t.key, { rating: e.target.value })}
                  placeholder="Rating (e.g. 32A)"
                  className="rounded-lg border border-zinc-300 px-2.5 py-2 text-sm outline-none focus:border-blue-500"
                />
                <input
                  value={t.label}
                  onChange={(e) => update(t.key, { label: e.target.value })}
                  placeholder="Label (optional)"
                  className="col-span-2 rounded-lg border border-zinc-300 px-2.5 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </Card>
          ))}
        </div>

        <Button
          variant="secondary"
          size="lg"
          block
          className="mt-3"
          onClick={() => addTile()}
        >
          + Add tile
        </Button>
      </main>

      <div className="safe-bottom sticky bottom-0 flex gap-3 border-t border-zinc-200 bg-white p-4">
        <Button variant="ghost" size="lg" onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button
          size="lg"
          block
          onClick={confirm}
          disabled={drafts.length === 0 || saving}
        >
          {saving ? "Saving…" : `Save board (${drafts.length})`}
        </Button>
      </div>
    </>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  danger,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-lg border text-sm ${
        danger
          ? "border-red-200 text-red-500 hover:bg-red-50"
          : "border-zinc-200 text-zinc-500 hover:bg-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}
