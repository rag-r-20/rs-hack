import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Job, Note } from "../lib/types";
import { getAllNotes, listJobs } from "../lib/db";
import { TopBar } from "./TopBar";
import { Card } from "./ui/Card";
import { Chip } from "./ui/Chip";
import { Spinner } from "./ui/Spinner";

interface JobGroup {
  job?: Job;
  jobId: string;
  notes: Note[];
}

export default function NotesPage() {
  const navigate = useNavigate();
  const [notes, setNotes] = useState<Note[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([getAllNotes(), listJobs()])
      .then(([n, j]) => {
        if (!alive) return;
        setNotes(n);
        setJobs(j);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const jobMap = useMemo(() => {
    const m = new Map<string, Job>();
    for (const j of jobs) m.set(j.id, j);
    return m;
  }, [jobs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return notes.filter((n) => {
      if (activeJobId && n.jobId !== activeJobId) return false;
      if (!q) return true;
      const job = jobMap.get(n.jobId);
      const haystack = [
        n.transcript,
        n.cleaned.purpose,
        n.cleaned.note_text,
        n.cleaned.area_served ?? "",
        n.cleaned.feeds.join(" "),
        n.cleaned.cautions ?? "",
        job?.title ?? "",
        job?.address ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [notes, query, activeJobId, jobMap]);

  const groups = useMemo<JobGroup[]>(() => {
    const byJob = new Map<string, Note[]>();
    for (const n of filtered) {
      const arr = byJob.get(n.jobId);
      if (arr) arr.push(n);
      else byJob.set(n.jobId, [n]);
    }
    // Preserve job order from listJobs (newest-first); trail unknown jobs.
    const ordered: JobGroup[] = [];
    for (const j of jobs) {
      const jobNotes = byJob.get(j.id);
      if (jobNotes) {
        ordered.push({ job: j, jobId: j.id, notes: jobNotes });
        byJob.delete(j.id);
      }
    }
    for (const [jobId, jobNotes] of byJob) {
      ordered.push({ jobId, notes: jobNotes });
    }
    return ordered;
  }, [filtered, jobs]);

  const jobsWithNotes = useMemo(() => {
    const s = new Set<string>();
    for (const n of notes) s.add(n.jobId);
    return s.size;
  }, [notes]);

  const jobFilterList = useMemo(
    () => jobs.filter((j) => notes.some((n) => n.jobId === j.id)),
    [jobs, notes],
  );

  return (
    <>
      <TopBar title="Notes" subtitle="Every note across your jobs" />

      <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:py-6">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-[var(--color-on-surface-variant)]">
            <Spinner size={24} label="Loading notes…" />
          </div>
        ) : notes.length === 0 ? (
          <EmptyState
            title="No notes yet"
            body="Notes you dictate on a job's Notes tab show up here across every job."
          />
        ) : (
          <div className="flex flex-col gap-5">
            {/* Stat line */}
            <p className="text-technical-sm text-[var(--color-on-surface-variant)]">
              <span className="text-[var(--color-on-surface)]">
                {notes.length}
              </span>{" "}
              {notes.length === 1 ? "note" : "notes"} ·{" "}
              <span className="text-[var(--color-on-surface)]">
                {jobsWithNotes}
              </span>{" "}
              {jobsWithNotes === 1 ? "job" : "jobs"}
            </p>

            {/* Search */}
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--color-on-surface-variant)]">
                <SearchIcon />
              </span>
              <input
                type="search"
                inputMode="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcripts, purpose, areas, jobs…"
                className="min-h-[48px] w-full rounded border border-[var(--color-slate-light)] bg-[var(--color-surface-container-lowest)] pl-10 pr-3 text-body-md text-[var(--color-on-surface)] placeholder:text-[var(--color-outline)] focus:border-[var(--color-primary)] focus:outline-none"
              />
            </div>

            {/* Job filter chips */}
            {jobFilterList.length > 1 && (
              <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
                <FilterChip
                  active={activeJobId === null}
                  onClick={() => setActiveJobId(null)}
                >
                  All jobs
                </FilterChip>
                {jobFilterList.map((j) => (
                  <FilterChip
                    key={j.id}
                    active={activeJobId === j.id}
                    onClick={() =>
                      setActiveJobId((cur) => (cur === j.id ? null : j.id))
                    }
                  >
                    {j.title}
                  </FilterChip>
                ))}
              </div>
            )}

            {groups.length === 0 ? (
              <EmptyState
                title="No matches"
                body="Try a different search term or clear the job filter."
              />
            ) : (
              groups.map((group) => (
                <section key={group.jobId} className="flex flex-col gap-3">
                  <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[var(--color-slate-light)] pb-2">
                    <h2 className="text-headline-md text-[var(--color-on-surface)]">
                      {group.job?.title ?? "Unknown job"}
                    </h2>
                    {group.job?.address && (
                      <span className="text-technical-sm text-[var(--color-on-surface-variant)]">
                        {group.job.address}
                      </span>
                    )}
                    <Chip tone="default" className="ml-auto">
                      {group.notes.length}{" "}
                      {group.notes.length === 1 ? "note" : "notes"}
                    </Chip>
                  </header>

                  <div className="flex flex-col gap-4">
                    {group.notes.map((n) => (
                      <NoteCard
                        key={n.id}
                        note={n}
                        onOpenJob={() => navigate(`/job/${n.jobId}`)}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

function NoteCard({
  note,
  onOpenJob,
}: {
  note: Note;
  onOpenJob: () => void;
}) {
  const { cleaned } = note;
  const fact = cleaned.note_text || cleaned.purpose;
  const actions: string[] = [];
  if (cleaned.cautions) actions.push(cleaned.cautions);
  for (const f of cleaned.feeds) actions.push(`Confirm feed: ${f}`);

  return (
    <Card className="ai-hud flex flex-col gap-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
          <MicIcon />
        </span>
        <h3 className="mr-auto min-w-0 truncate text-body-lg font-bold text-[var(--color-on-surface)]">
          {cleaned.purpose || "Voice note"}
        </h3>
        {cleaned.rating && <Chip tone="gold">{cleaned.rating}</Chip>}
        {cleaned.area_served && <Chip tone="default">{cleaned.area_served}</Chip>}
      </div>

      {/* Transcription */}
      <section>
        <p className="mb-1.5 text-label-caps text-[var(--color-on-surface-variant)]">
          Transcription
        </p>
        <blockquote className="rounded border-l-2 border-[var(--color-primary)]/50 bg-[var(--color-surface-container-lowest)] px-3 py-2.5 text-body-md italic text-[var(--color-on-surface-variant)]">
          “{note.transcript}”
        </blockquote>
      </section>

      {/* Structured observations */}
      {(fact || cleaned.cautions) && (
        <section>
          <p className="mb-1.5 text-label-caps text-[var(--color-on-surface-variant)]">
            Structured Observations
          </p>
          <ul className="flex flex-col gap-2">
            {fact && (
              <li className="flex items-start gap-2 text-body-md text-[var(--color-on-surface)]">
                <span className="mt-0.5 shrink-0 text-[var(--color-status-safe)]">
                  <CheckIcon />
                </span>
                <span>
                  {fact}
                  {(cleaned.rating || cleaned.area_served) && (
                    <span className="ml-1.5 font-[family-name:var(--font-jetbrains)] text-[var(--color-on-surface-variant)]">
                      {[cleaned.rating, cleaned.area_served]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </span>
              </li>
            )}
            {cleaned.cautions && (
              <li className="flex items-start gap-2 text-body-md text-[var(--color-on-surface)]">
                <span className="mt-0.5 shrink-0 text-[var(--color-status-review)]">
                  <WarnIcon />
                </span>
                <span>{cleaned.cautions}</span>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* Actions required */}
      {actions.length > 0 && (
        <section>
          <p className="mb-1.5 text-label-caps text-[var(--color-on-surface-variant)]">
            Actions Required
          </p>
          <ul className="flex flex-col gap-2">
            {actions.map((a, i) => (
              <li
                key={i}
                className="flex items-start gap-2 rounded border-l-2 border-[var(--color-primary)] bg-[var(--color-primary)]/5 px-3 py-2 text-body-md text-[var(--color-on-surface)]"
              >
                <span className="mt-0.5 shrink-0 text-[var(--color-primary)]">
                  <WrenchIcon />
                </span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-[var(--color-slate-light)] pt-3">
        <span className="text-technical-sm text-[var(--color-on-surface-variant)]">
          {formatDate(note.createdAt)}
        </span>
        <button
          onClick={onOpenJob}
          className="inline-flex min-h-[48px] items-center gap-1.5 rounded px-3 text-label-caps text-[var(--color-primary)] transition-colors hover:bg-[var(--color-surface-bright)]"
        >
          Open job
          <ArrowIcon />
        </button>
      </div>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex min-h-[48px] shrink-0 items-center whitespace-nowrap rounded border px-3 font-[family-name:var(--font-jetbrains)] text-[11px] font-semibold uppercase tracking-wide transition-colors ${
        active
          ? "border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 text-[var(--color-primary)]"
          : "border-[var(--color-outline-variant)] bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-bright)]"
      }`}
    >
      {children}
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="flex flex-col items-center gap-2 px-6 py-16 text-center">
      <span className="text-[var(--color-outline)]">
        <MicIcon size={28} />
      </span>
      <h2 className="text-headline-md text-[var(--color-on-surface)]">{title}</h2>
      <p className="max-w-sm text-body-md text-[var(--color-on-surface-variant)]">
        {body}
      </p>
    </Card>
  );
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function MicIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path
        d="M6 11a6 6 0 0 0 12 0M12 17v3"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M8 12l2.5 2.5L16 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l9 16H3l9-16z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M12 10v4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M14.7 6.3a4 4 0 0 0-5.4 4.9L4 16.5 7.5 20l5.3-5.3a4 4 0 0 0 4.9-5.4l-2.3 2.3-2.1-.6-.6-2.1 2-1.6z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M20 20l-3.5-3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12h14M13 6l6 6-6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
