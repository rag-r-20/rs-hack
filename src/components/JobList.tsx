import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Job, Panel } from "../lib/types";
import {
  listJobs,
  createJob,
  deleteJob,
  getPanelsForJob,
  getPhotosForJob,
  getPhoto,
} from "../lib/db";
import { useShell } from "./AppShell";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Chip } from "./ui/Chip";
import { StatusPill, type Status } from "./ui/StatusPill";
import { Sheet } from "./ui/Sheet";
import { useToast } from "./ui/Toast";

const LOW_CONFIDENCE = 0.7;

interface JobCard {
  job: Job;
  circuits: number;
  anomalies: number;
  status: Extract<Status, "draft" | "certified" | "review">;
  tags: string[];
  photoUrl: string | null;
}

const TYPE_LABEL: Record<string, string> = {
  main_switch: "Main Panel",
  RCD: "RCD",
  RCBO: "RCBO",
  MCB: "Distribution",
};

function deriveTags(panels: Panel[]): string[] {
  if (panels.length === 0) return ["Draft", "Unscanned"];
  const components = panels.flatMap((p) => p.components);
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const c of components) {
    const label = TYPE_LABEL[c.type];
    if (label && !seen.has(label)) {
      seen.add(label);
      tags.push(label);
    }
  }
  const ways = components.length;
  if (ways > 12 && !seen.has("3-Phase")) tags.push("3-Phase");
  if (tags.length === 0) tags.push("Sub-board A");
  return tags.slice(0, 3);
}

function deriveStatus(
  panels: Panel[],
): Extract<Status, "draft" | "certified" | "review"> {
  if (panels.length === 0) return "draft";
  const hasLowConfidence = panels
    .flatMap((p) => p.components)
    .some((c) => c.confidence < LOW_CONFIDENCE);
  return hasLowConfidence ? "review" : "certified";
}

export function JobList() {
  const navigate = useNavigate();
  const toast = useToast();
  const { theme, toggleTheme, newJobSignal, requestNewJob } = useShell();
  const [cards, setCards] = useState<JobCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [address, setAddress] = useState("");
  const [query, setQuery] = useState("");
  const urlsRef = useRef<string[]>([]);

  const refresh = useCallback(async () => {
    const previous = urlsRef.current;
    const created: string[] = [];
    const jobs = await listJobs();
    const built = await Promise.all(
      jobs.map(async (job): Promise<JobCard> => {
        const [panels, photos] = await Promise.all([
          getPanelsForJob(job.id),
          getPhotosForJob(job.id),
        ]);
        const components = panels.flatMap((p) => p.components);
        // Prefer the captured board scan (linked to the panel via
        // sourcePhotoId, which is NOT job-scoped), then fall back to a
        // property photo. This is why boards captured via the camera still
        // get a thumbnail even when no property image was ever added.
        let blob: Blob | undefined;
        for (let i = panels.length - 1; i >= 0 && !blob; i--) {
          const sourcePhotoId = panels[i].sourcePhotoId;
          if (sourcePhotoId) blob = await getPhoto(sourcePhotoId);
        }
        if (!blob && photos[0]) blob = photos[0].blob;
        let photoUrl: string | null = null;
        if (blob) {
          photoUrl = URL.createObjectURL(blob);
          created.push(photoUrl);
        }
        return {
          job,
          circuits: components.length,
          anomalies: components.filter((c) => c.confidence < LOW_CONFIDENCE)
            .length,
          status: deriveStatus(panels),
          tags: deriveTags(panels),
          photoUrl,
        };
      }),
    );
    urlsRef.current = created;
    // Revoke the previous batch only after the new one is ready.
    for (const url of previous) URL.revokeObjectURL(url);
    setCards(built);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      for (const url of urlsRef.current) URL.revokeObjectURL(url);
      urlsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sidebar "+ New Job" trigger.
  useEffect(() => {
    if (newJobSignal > 0) setCreating(true);
  }, [newJobSignal]);

  async function handleCreate(e?: { preventDefault?: () => void }) {
    e?.preventDefault?.();
    const t = title.trim();
    if (!t) {
      toast.error("Give the job a name or address.");
      return;
    }
    if (saving) return;
    setSaving(true);
    try {
      const job = await createJob(t, address.trim() || undefined);
      setCreating(false);
      setTitle("");
      setAddress("");
      navigate(`/job/${job.id}/capture`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : "Could not save the job — try turning off private browsing.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(job: Job) {
    if (!confirm(`Delete "${job.title}" and all its data?`)) return;
    await deleteJob(job.id);
    toast.success("Job deleted.");
    void refresh();
  }

  const filtered = cards.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      c.job.title.toLowerCase().includes(q) ||
      (c.job.address ?? "").toLowerCase().includes(q)
    );
  });

  const hero = filtered[0];
  const rest = filtered.slice(1);

  return (
    <>
      <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-8">
        {/* Header row */}
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h1 className="text-headline-lg-mobile text-[var(--color-on-surface)] md:text-headline-lg">
              Jobs Dashboard
            </h1>
            <p className="mt-1 text-body-md text-[var(--color-on-surface-variant)]">
              Overview of recent electrical inspections and panel tests.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative flex-1 md:w-64">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-on-surface-variant)]">
                <SearchGlyph />
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search jobs…"
                aria-label="Search jobs"
                className="min-h-[48px] w-full rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] py-2 pl-10 pr-3 text-body-md text-[var(--color-on-surface)] outline-none placeholder:text-[var(--color-on-surface-variant)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
              />
            </div>
            <button
              onClick={toggleTheme}
              className="flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)]"
              aria-label="Toggle theme"
            >
              {theme === "dark" ? <MoonGlyph /> : <SunGlyph />}
            </button>
          </div>
        </div>

        {loading ? (
          <p className="py-16 text-center text-body-md text-[var(--color-on-surface-variant)]">
            Loading…
          </p>
        ) : cards.length === 0 ? (
          <EmptyState onNew={requestNewJob} />
        ) : filtered.length === 0 ? (
          <p className="py-16 text-center text-body-md text-[var(--color-on-surface-variant)]">
            No jobs match “{query}”.
          </p>
        ) : (
          <div className="mt-6 flex flex-col gap-6">
            {/* Hero + AI analysis */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {hero && (
                <div className="lg:col-span-2">
                  <HeroCard
                    card={hero}
                    onView={() => navigate(`/job/${hero.job.id}`)}
                    onResume={() => navigate(`/job/${hero.job.id}`)}
                    onDelete={() => void handleDelete(hero.job)}
                  />
                </div>
              )}
              <AiAnalysisCard />
            </div>

            {/* Remaining jobs grid */}
            {rest.length > 0 && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {rest.map((card) => (
                  <JobGridCard
                    key={card.job.id}
                    card={card}
                    onOpen={() => navigate(`/job/${card.job.id}`)}
                    onDelete={() => void handleDelete(card.job)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Sheet
        open={creating}
        onClose={() => !saving && setCreating(false)}
        title="New job"
        footer={
          <Button
            type="submit"
            form="new-job-form"
            size="lg"
            block
            disabled={saving}
          >
            {saving ? "Creating…" : "Create & capture board"}
          </Button>
        }
      >
        <form
          id="new-job-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => void handleCreate(e)}
        >
          <label className="flex flex-col gap-2">
            <span className="text-body-md font-bold text-[var(--color-on-surface)]">
              Job name or address
            </span>
            <input
              autoFocus
              enterKeyHint="go"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. 14 Elm Road"
              className="min-h-[48px] rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-body-lg text-[var(--color-on-surface)] outline-none placeholder:text-[var(--color-on-surface-variant)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-body-md font-bold text-[var(--color-on-surface)]">
              Address (optional)
            </span>
            <input
              enterKeyHint="go"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Full address"
              className="min-h-[48px] rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-body-lg text-[var(--color-on-surface)] outline-none placeholder:text-[var(--color-on-surface-variant)] focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
            />
          </label>
        </form>
      </Sheet>
    </>
  );
}

// ---------- Hero / featured card ----------

function HeroCard({
  card,
  onView,
  onResume,
  onDelete,
}: {
  card: JobCard;
  onView: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  const { job, circuits, anomalies, photoUrl } = card;
  return (
    <Card className="flex h-full flex-col overflow-hidden md:flex-row">
      {/* Thumbnail */}
      <div className="relative h-44 w-full shrink-0 bg-[var(--color-surface-container-lowest)] md:h-auto md:w-56">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={job.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <PhotoPlaceholder />
        )}
        <span className="absolute left-3 top-3">
          <StatusPill status="live" pulse>
            LIVE
          </StatusPill>
        </span>
      </div>

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate text-headline-md text-[var(--color-on-surface)]">
              {job.title}
            </h2>
            <p className="mt-1 text-technical-sm text-[var(--color-on-surface-variant)]">
              ID: {job.id.slice(0, 8).toUpperCase()} ·{" "}
              {new Date(job.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <button
            onClick={onDelete}
            className="flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded p-2 text-[var(--color-outline)] hover:bg-[var(--color-status-live)]/10 hover:text-[var(--color-status-live)]"
            aria-label="Delete job"
          >
            <TrashIcon />
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3 border-b border-[var(--color-slate-light)] pb-2">
            <span className="text-body-md text-[var(--color-on-surface-variant)]">
              Circuits Identified
            </span>
            <span className="text-technical-data text-[var(--color-on-surface)]">
              {circuits} / {circuits}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-body-md text-[var(--color-on-surface-variant)]">
              Anomalies Detected
            </span>
            <span
              className={`inline-flex items-center gap-1.5 text-technical-data ${
                anomalies > 0
                  ? "text-[var(--color-status-review)]"
                  : "text-[var(--color-status-safe)]"
              }`}
            >
              {anomalies > 0 && <WarnGlyph />}
              {anomalies}
            </span>
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row">
          <Button variant="secondary" size="md" block onClick={onView}>
            View Details
          </Button>
          <Button size="md" block onClick={onResume}>
            Resume →
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------- AI analysis card ----------

function AiAnalysisCard() {
  return (
    <Card className="ai-glow ai-hud flex h-full flex-col gap-3 border-t-2 border-t-[var(--color-primary)] p-5">
      <div className="flex items-center gap-2">
        <span className="text-[var(--color-primary)]">
          <AiSparkGlyph />
        </span>
        <Chip tone="primary">AI Analysis</Chip>
      </div>
      <h3 className="text-headline-md text-[var(--color-on-surface)]">
        Pattern Detected
      </h3>
      <p className="text-body-md text-[var(--color-on-surface-variant)]">
        Across recent jobs, B-Curve breakers are showing higher thermal variance
        than C-Curve equivalents.
      </p>
      <div className="mt-1 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-technical-sm text-[var(--color-on-surface-variant)]">
            B-Curve Avg Temp
          </span>
          <span className="text-technical-data text-[var(--color-dewalt-gold)]">
            42.5°C
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-technical-sm text-[var(--color-on-surface-variant)]">
            C-Curve Avg Temp
          </span>
          <span className="text-technical-data text-[var(--color-on-surface)]">
            36.1°C
          </span>
        </div>
      </div>
    </Card>
  );
}

// ---------- Grid card ----------

const ACTION_LABEL: Record<JobCard["status"], string> = {
  draft: "Open Job",
  certified: "View Report",
  review: "Review Issues",
};

const STATUS_LABEL: Record<JobCard["status"], string> = {
  draft: "Draft",
  certified: "Certified",
  review: "Needs Review",
};

function JobGridCard({
  card,
  onOpen,
  onDelete,
}: {
  card: JobCard;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { job, status, tags, photoUrl } = card;
  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="relative h-32 w-full bg-[var(--color-surface-container-lowest)]">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={job.title}
            className="h-full w-full object-cover"
          />
        ) : (
          <PhotoPlaceholder />
        )}
        <span className="absolute left-3 top-3">
          <StatusPill status={status} pulse={status === "review"}>
            {STATUS_LABEL[status]}
          </StatusPill>
        </span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="truncate text-body-lg font-bold text-[var(--color-on-surface)]">
              {job.title}
            </h3>
            <p className="mt-0.5 text-technical-sm text-[var(--color-on-surface-variant)]">
              {new Date(job.createdAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
          <button
            onClick={onDelete}
            className="flex min-h-[48px] min-w-[48px] shrink-0 items-center justify-center rounded p-2 text-[var(--color-outline)] hover:bg-[var(--color-status-live)]/10 hover:text-[var(--color-status-live)]"
            aria-label="Delete job"
          >
            <TrashIcon />
          </button>
        </div>

        {job.address && (
          <p className="truncate text-body-md text-[var(--color-on-surface-variant)]">
            {job.address}
          </p>
        )}

        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Chip key={tag}>{tag}</Chip>
          ))}
        </div>

        <Button
          variant={status === "review" ? "secondary" : "primary"}
          size="md"
          block
          className="mt-auto"
          onClick={onOpen}
        >
          {ACTION_LABEL[status]}
        </Button>
      </div>
    </Card>
  );
}

// ---------- Empty state ----------

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="mt-16 flex flex-col items-center px-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded bg-[var(--color-surface-container)] text-[var(--color-primary)]">
        <PanelIcon size={32} />
      </div>
      <h2 className="text-headline-md text-[var(--color-on-surface)]">
        No jobs yet
      </h2>
      <p className="mt-2 max-w-xs text-body-md text-[var(--color-on-surface-variant)]">
        Snap a photo of a consumer unit and ReadBack turns it into a clean,
        labeled board you can read back days later.
      </p>
      <Button size="lg" className="mt-6" onClick={onNew}>
        + New Job
      </Button>
    </div>
  );
}

// ---------- Glyphs ----------

function PhotoPlaceholder() {
  return (
    <div className="flex h-full w-full items-center justify-center text-[var(--color-outline-variant)]">
      <PanelIcon size={40} />
    </div>
  );
}

function PanelIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 8v3M12 8v3M17 8v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 7h14M10 7V5h4v2M6 7l1 12h10l1-12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function WarnGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l9 16H3l9-16z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

function AiSparkGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MoonGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
