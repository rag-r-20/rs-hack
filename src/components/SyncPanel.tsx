import { useEffect, useRef, useState } from "react";
import { exportBackup, importBackup, listJobs } from "../lib/db";
import type { RestoreResult } from "../lib/db";
import { Sheet } from "./ui/Sheet";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { useToast } from "./ui/Toast";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful import so the app can refresh cached data. */
  onImported?: () => void;
}

const LAST_SYNC_KEY = "readback-last-sync";

function readLastSync(): number | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(LAST_SYNC_KEY);
  return v ? Number(v) || null : null;
}

/**
 * Local "Sync": export all job data to a portable JSON file and restore it on
 * another device. There is no server — this is the offline-first backup story.
 */
export function SyncPanel({ open, onClose, onImported }: Props) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"idle" | "export" | "import">("idle");
  const [jobCount, setJobCount] = useState<number | null>(null);
  const [lastSync, setLastSync] = useState<number | null>(readLastSync);

  useEffect(() => {
    if (!open) return;
    void listJobs().then((jobs) => setJobCount(jobs.length));
    setLastSync(readLastSync());
  }, [open]);

  function markSynced() {
    const now = Date.now();
    try {
      localStorage.setItem(LAST_SYNC_KEY, String(now));
    } catch {
      // Ignore private-mode storage failures.
    }
    setLastSync(now);
  }

  async function handleExport() {
    if (busy !== "idle") return;
    setBusy("export");
    try {
      const data = await exportBackup();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const stamp = new Date(data.exportedAt).toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = `readback-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      markSynced();
      toast.success(
        `Backed up ${data.jobs.length} job(s), ${data.notes.length} note(s), ${data.materials.length} material(s).`,
      );
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not export a backup.",
      );
    } finally {
      setBusy("idle");
    }
  }

  async function handleFile(file: File) {
    if (busy !== "idle") return;
    setBusy("import");
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const result: RestoreResult = await importBackup(parsed);
      markSynced();
      setJobCount((await listJobs()).length);
      toast.success(
        `Restored ${result.jobs} job(s), ${result.notes} note(s), ${result.materials} material(s).`,
      );
      onImported?.();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "That doesn’t look like a ReadBack backup.",
      );
    } finally {
      setBusy("idle");
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="Sync">
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3 rounded border border-[var(--color-slate-light)] bg-[var(--color-surface-container-lowest)] p-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-status-safe)]/15 text-[var(--color-status-safe)]">
            <CloudIcon />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-body-md font-bold text-[var(--color-on-surface)]">
              Offline-first
            </p>
            <p className="text-technical-sm text-[var(--color-on-surface-variant)]">
              {jobCount == null
                ? "Checking local data…"
                : `${jobCount} job(s) stored on this device`}
            </p>
          </div>
          {lastSync && (
            <Chip tone="safe">
              {`SYNCED ${new Date(lastSync).toLocaleDateString()}`}
            </Chip>
          )}
        </div>

        <p className="text-body-md text-[var(--color-on-surface-variant)]">
          ReadBack keeps everything on your device. Export a backup to move your
          jobs, boards, notes and materials to another phone or laptop, then
          import it there.
        </p>

        <div className="flex flex-col gap-2">
          <span className="text-label-caps text-[var(--color-on-surface-variant)]">
            Backup
          </span>
          <Button
            size="lg"
            block
            onClick={() => void handleExport()}
            disabled={busy !== "idle"}
          >
            {busy === "export" ? "Exporting…" : "Export backup (.json)"}
          </Button>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-label-caps text-[var(--color-on-surface-variant)]">
            Restore
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
          <Button
            variant="secondary"
            size="lg"
            block
            onClick={() => fileRef.current?.click()}
            disabled={busy !== "idle"}
          >
            {busy === "import" ? "Restoring…" : "Import backup"}
          </Button>
          <p className="text-technical-sm text-[var(--color-outline)]">
            Restoring merges by id — existing jobs are updated, new ones added.
          </p>
        </div>
      </div>
    </Sheet>
  );
}

function CloudIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M7 18a4 4 0 010-8 5 5 0 019.6-1.3A3.5 3.5 0 0117 18H7z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
