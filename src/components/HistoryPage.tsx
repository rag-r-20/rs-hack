import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getActivityFeed } from "../lib/db";
import type { ActivityEvent } from "../lib/db";
import { TopBar } from "./TopBar";
import { Card } from "./ui/Card";
import { Spinner } from "./ui/Spinner";

type Kind = ActivityEvent["kind"];
type Filter = "all" | Kind;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "job", label: "Jobs" },
  { key: "panel", label: "Boards" },
  { key: "note", label: "Notes" },
  { key: "material", label: "Materials" },
];

const KIND_COLOR: Record<Kind, string> = {
  job: "var(--color-primary)",
  panel: "var(--color-status-safe)",
  note: "var(--color-status-review)",
  material: "var(--color-dewalt-gold)",
};

export default function HistoryPage() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;
    getActivityFeed()
      .then((data) => {
        if (!cancelled) setEvents(data);
      })
      .catch(() => {
        if (!cancelled) setEvents([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () =>
      (events ?? []).filter((e) => filter === "all" || e.kind === filter),
    [events, filter],
  );

  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  return (
    <>
      <TopBar title="History" subtitle="Recent activity across your jobs" />
      <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:py-6">
        {events === null ? (
          <Card className="flex items-center justify-center p-10 text-[var(--color-on-surface-variant)]">
            <Spinner size={22} label="Loading activity…" />
          </Card>
        ) : events.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`min-h-[40px] rounded-full border px-3 py-2 text-technical-sm transition-colors ${
                      active
                        ? "border-[var(--color-primary)] bg-[var(--color-primary)]/15 text-[var(--color-primary)]"
                        : "border-[var(--color-outline-variant)] bg-[var(--color-surface-container)] text-[var(--color-on-surface-variant)] hover:border-[var(--color-primary)]/50"
                    }`}
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            {filtered.length === 0 ? (
              <p className="px-1 py-6 text-body-md text-[var(--color-on-surface-variant)]">
                No activity for this filter.
              </p>
            ) : (
              <div className="flex flex-col gap-6">
                {groups.map((group) => (
                  <section key={group.label}>
                    <h2 className="mb-2 text-label-caps text-[var(--color-on-surface-variant)]">
                      {group.label}
                    </h2>
                    <div className="flex flex-col">
                      {group.events.map((event) => (
                        <Row
                          key={event.id}
                          event={event}
                          onClick={() => navigate(`/job/${event.jobId}`)}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

function Row({
  event,
  onClick,
}: {
  event: ActivityEvent;
  onClick: () => void;
}) {
  const color = KIND_COLOR[event.kind];
  return (
    <button
      onClick={onClick}
      className="group relative flex min-h-[48px] items-start gap-3 border-l-2 border-[var(--color-slate-light)] py-3 pl-4 pr-2 text-left transition-colors hover:border-[var(--color-primary)]"
    >
      <span
        className="mt-1.5 -ml-[21px] flex h-3 w-3 shrink-0 items-center justify-center rounded-full ring-4 ring-[var(--color-surface)]"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      >
        <KindIcon kind={event.kind} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-body-md text-[var(--color-on-surface)]">
          {event.summary}
        </span>
        <span className="block truncate font-[family-name:var(--font-jetbrains)] text-technical-sm text-[var(--color-on-surface-variant)]">
          {event.jobTitle}
        </span>
      </span>
      <time className="shrink-0 font-[family-name:var(--font-jetbrains)] text-technical-sm text-[var(--color-outline)]">
        {formatTime(event.createdAt)}
      </time>
    </button>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
        <ClockIcon />
      </span>
      <h2 className="text-headline-md text-[var(--color-on-surface)]">
        No activity yet
      </h2>
      <p className="max-w-sm text-body-md text-[var(--color-on-surface-variant)]">
        Create a job, capture a board, or record a voice note and it will show
        up here in your timeline.
      </p>
    </Card>
  );
}

interface DayGroup {
  label: string;
  events: ActivityEvent[];
}

function groupByDay(events: ActivityEvent[]): DayGroup[] {
  const groups: DayGroup[] = [];
  let current: DayGroup | null = null;
  for (const event of events) {
    const label = dayLabel(event.createdAt);
    if (!current || current.label !== label) {
      current = { label, events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }
  return groups;
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function dayLabel(ts: number): string {
  const today = startOfDay(Date.now());
  const day = startOfDay(ts);
  const diffDays = Math.round((today - day) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year:
      new Date(ts).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  });
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function KindIcon({ kind }: { kind: Kind }) {
  const common = {
    width: 8,
    height: 8,
    viewBox: "0 0 24 24",
    fill: "none" as const,
  };
  const stroke = {
    stroke: "var(--color-surface)",
    strokeWidth: 3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (kind) {
    case "job":
      return (
        <svg {...common}>
          <path d="M4 8h16M4 8l0 10a2 2 0 002 2h12a2 2 0 002-2V8M9 8V6a3 3 0 016 0v2" {...stroke} />
        </svg>
      );
    case "panel":
      return (
        <svg {...common}>
          <path d="M4 5h16v14H4zM4 12h16M12 5v14" {...stroke} />
        </svg>
      );
    case "note":
      return (
        <svg {...common}>
          <path d="M12 4v8m0 4v.01M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z" {...stroke} />
        </svg>
      );
    case "material":
      return (
        <svg {...common}>
          <path d="M20 7L12 3 4 7l8 4 8-4zM4 7v10l8 4 8-4V7" {...stroke} />
        </svg>
      );
  }
}

function ClockIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 7v5l3 2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
