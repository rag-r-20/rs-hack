import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import type { Job, Material } from "../lib/types";
import { getAllMaterials, listJobs, toggleMaterialSourced } from "../lib/db";
import { TopBar } from "./TopBar";
import { Card } from "./ui/Card";
import { Chip } from "./ui/Chip";
import { Spinner } from "./ui/Spinner";

type ViewMode = "consolidated" | "byJob";

/** Extract a breaker curve descriptor (e.g. "B-Curve") from a free-text spec. */
function curveOf(spec: string | null | undefined): string | null {
  const m = spec?.match(/\b([A-D])[-\s]?curve\b/i);
  return m ? `${m[1].toUpperCase()}-Curve` : null;
}

/** Normalized grouping key: item name + spec, case-insensitive & trimmed. */
function groupKey(m: Material): string {
  return `${(m.item ?? "").trim().toLowerCase()}||${(m.spec ?? "").trim().toLowerCase()}`;
}

interface ConsolidatedRow {
  key: string;
  item: string;
  spec: string | null;
  materials: Material[];
  /** Distinct jobIds that need this line. */
  jobIds: string[];
  /** Summed quantity when all units agree and no null quantities; else null. */
  summedQuantity: number | null;
  /** Unit when unified; else null. */
  unit: string | null;
}

function buildConsolidated(materials: Material[]): ConsolidatedRow[] {
  const map = new Map<string, ConsolidatedRow>();
  for (const m of materials) {
    const key = groupKey(m);
    let row = map.get(key);
    if (!row) {
      row = {
        key,
        item: m.item,
        spec: m.spec,
        materials: [],
        jobIds: [],
        summedQuantity: 0,
        unit: null,
      };
      map.set(key, row);
    }
    row.materials.push(m);
    if (!row.jobIds.includes(m.jobId)) row.jobIds.push(m.jobId);
  }

  for (const row of map.values()) {
    const units = new Set(
      row.materials.map((m) => (m.unit ?? "").trim().toLowerCase()),
    );
    const anyNullQty = row.materials.some((m) => m.quantity == null);
    if (units.size === 1 && !anyNullQty) {
      row.unit = row.materials[0].unit;
      row.summedQuantity = row.materials.reduce(
        (sum, m) => sum + (m.quantity ?? 0),
        0,
      );
    } else {
      row.summedQuantity = null;
      row.unit = null;
    }
  }

  return [...map.values()];
}

export default function MaterialsPage() {
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<Material[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<ViewMode>("consolidated");
  const [search, setSearch] = useState("");
  const [hideSourced, setHideSourced] = useState(false);

  const jobMap = useMemo(() => {
    const map = new Map<string, Job>();
    for (const j of jobs) map.set(j.id, j);
    return map;
  }, [jobs]);

  async function load() {
    const [mats, jbs] = await Promise.all([getAllMaterials(), listJobs()]);
    setMaterials(mats);
    setJobs(jbs);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  const jobTitle = (jobId: string) => jobMap.get(jobId)?.title ?? "Unknown job";

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials.filter((m) => {
      if (hideSourced && m.sourced) return false;
      if (!q) return true;
      const hay = [
        m.item,
        m.spec ?? "",
        m.notes ?? "",
        jobTitle(m.jobId),
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [materials, search, hideSourced, jobMap]);

  const stats = useMemo(() => {
    const total = materials.length;
    const sourced = materials.filter((m) => m.sourced).length;
    return { total, sourced, toSource: total - sourced };
  }, [materials]);

  async function toggleOne(id: string) {
    await toggleMaterialSourced(id);
    await load();
  }

  async function toggleGroup(rows: Material[]) {
    const allSourced = rows.every((m) => m.sourced);
    // Flip only those that need to change to reach "all sourced" (or "all needed").
    const targets = allSourced
      ? rows.filter((m) => m.sourced)
      : rows.filter((m) => !m.sourced);
    for (const m of targets) {
      // eslint-disable-next-line no-await-in-loop
      await toggleMaterialSourced(m.id);
    }
    await load();
  }

  const consolidatedRows = useMemo(
    () => buildConsolidated(filtered),
    [filtered],
  );

  const byJobGroups = useMemo(() => {
    const map = new Map<string, Material[]>();
    for (const m of filtered) {
      const arr = map.get(m.jobId) ?? [];
      arr.push(m);
      map.set(m.jobId, arr);
    }
    // Order groups by the job order in `jobs`.
    const ordered: { jobId: string; items: Material[] }[] = [];
    for (const j of jobs) {
      const items = map.get(j.id);
      if (items && items.length) ordered.push({ jobId: j.id, items });
    }
    // Any orphan jobIds not in jobs list.
    for (const [jobId, items] of map) {
      if (!jobMap.has(jobId)) ordered.push({ jobId, items });
    }
    return ordered;
  }, [filtered, jobs, jobMap]);

  const progress = stats.total > 0 ? stats.sourced / stats.total : 0;

  return (
    <div className="min-h-full">
      <TopBar title="Materials" subtitle="Consolidated shopping list" />

      <div className="mx-auto w-full max-w-4xl px-4 py-4 sm:py-6">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-[var(--color-on-surface-variant)]">
            <Spinner size={28} label="Loading materials…" />
          </div>
        ) : materials.length === 0 ? (
          <Card className="flex flex-col items-center gap-3 p-10 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
              <BoxIcon />
            </span>
            <p className="text-headline-md text-[var(--color-on-surface)]">
              No materials yet
            </p>
            <p className="text-body-md text-[var(--color-on-surface-variant)]">
              Add materials inside a job and they’ll roll up here as one
              wholesaler shopping list.
            </p>
          </Card>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Stats + progress */}
            <Card className="p-4">
              <p className="font-[family-name:var(--font-jetbrains)] text-technical-sm text-[var(--color-on-surface-variant)]">
                <span className="text-[var(--color-on-surface)]">
                  {stats.total}
                </span>{" "}
                items ·{" "}
                <span className="text-[var(--color-dewalt-gold)]">
                  {stats.toSource}
                </span>{" "}
                to source ·{" "}
                <span className="text-[var(--color-status-safe)]">
                  {stats.sourced}
                </span>{" "}
                sourced
              </p>
              <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-container-lowest)]">
                <div
                  className="h-full rounded-full bg-[var(--color-status-safe)] transition-[width]"
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            </Card>

            {/* Segmented control */}
            <div className="flex rounded border border-[var(--color-slate-light)] bg-[var(--color-surface-container-lowest)] p-1">
              <SegBtn
                active={view === "consolidated"}
                onClick={() => setView("consolidated")}
                icon={<BoxIcon />}
                label="Consolidated"
              />
              <SegBtn
                active={view === "byJob"}
                onClick={() => setView("byJob")}
                icon={<ListIcon />}
                label="By job"
              />
            </div>

            {/* Search + hide sourced */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items, specs, notes, jobs…"
                className="min-h-[48px] flex-1 rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-body-md text-[var(--color-on-surface)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)]"
              />
              <button
                onClick={() => setHideSourced((v) => !v)}
                className={`flex min-h-[48px] shrink-0 items-center gap-2 rounded border px-3 py-2 text-body-md transition-colors ${
                  hideSourced
                    ? "border-[var(--color-status-safe)] bg-[var(--color-status-safe)]/10 text-[var(--color-status-safe)]"
                    : "border-[var(--color-slate-light)] bg-[var(--color-surface-container-lowest)] text-[var(--color-on-surface-variant)]"
                }`}
                aria-pressed={hideSourced}
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
                    hideSourced
                      ? "border-[var(--color-status-safe)] bg-[var(--color-status-safe)] text-white"
                      : "border-[var(--color-outline-variant)] text-transparent"
                  }`}
                >
                  <CheckIcon />
                </span>
                Hide sourced
              </button>
            </div>

            {filtered.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-body-md text-[var(--color-on-surface-variant)]">
                  Nothing matches — try a different search
                  {hideSourced ? " or show sourced items." : "."}
                </p>
              </Card>
            ) : view === "consolidated" ? (
              <ul className="flex flex-col gap-2">
                {consolidatedRows.map((row) => (
                  <ConsolidatedRowView
                    key={row.key}
                    row={row}
                    jobTitle={jobTitle}
                    onToggle={() => void toggleGroup(row.materials)}
                  />
                ))}
              </ul>
            ) : (
              <div className="flex flex-col gap-4">
                {byJobGroups.map(({ jobId, items }) => {
                  const job = jobMap.get(jobId);
                  return (
                    <Card key={jobId} className="overflow-hidden">
                      <button
                        onClick={() => navigate(`/job/${jobId}`)}
                        className="flex w-full items-center gap-3 border-b border-[var(--color-slate-light)] bg-[var(--color-surface-container-lowest)] p-4 text-left transition-colors hover:bg-[var(--color-surface-bright)]"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body-lg font-bold text-[var(--color-on-surface)]">
                            {job?.title ?? "Unknown job"}
                          </p>
                          {job?.address && (
                            <p className="truncate font-[family-name:var(--font-jetbrains)] text-technical-sm text-[var(--color-on-surface-variant)]">
                              {job.address}
                            </p>
                          )}
                        </div>
                        <Chip tone="primary">{items.length}</Chip>
                        <span className="text-[var(--color-on-surface-variant)]">
                          <ChevronIcon />
                        </span>
                      </button>
                      <ul className="flex flex-col gap-2 p-3">
                        {items.map((m) => (
                          <MaterialRow
                            key={m.id}
                            material={m}
                            onToggle={() => void toggleOne(m.id)}
                          />
                        ))}
                      </ul>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SegBtn({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded text-body-md font-medium transition-colors ${
        active
          ? "bg-[var(--color-primary)] text-white shadow-sm"
          : "text-[var(--color-on-surface-variant)] hover:text-[var(--color-on-surface)]"
      }`}
      aria-pressed={active}
    >
      {icon}
      {label}
    </button>
  );
}

/** Individual material row (By job view) — mirrors MaterialsList treatment. */
function MaterialRow({
  material: m,
  onToggle,
}: {
  material: Material;
  onToggle: () => void;
}) {
  const curve = curveOf(m.spec);
  const specText =
    m.spec && (!curve || m.spec.trim().toLowerCase() !== curve.toLowerCase())
      ? m.spec
      : null;
  const metaParts = [
    m.quantity != null
      ? `Qty: ${m.quantity}${m.unit ? ` ${m.unit}` : ""}`
      : m.unit ?? null,
    m.notes ? `(${m.notes})` : null,
  ].filter(Boolean) as string[];

  return (
    <li>
      <div
        className={`flex items-start gap-3 rounded border border-[var(--color-slate-light)] bg-[var(--color-surface-container-lowest)] p-3 transition-opacity ${
          m.sourced ? "opacity-55" : "opacity-100"
        }`}
      >
        <button
          onClick={onToggle}
          className={`flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-md border-2 ${
            m.sourced
              ? "border-[var(--color-status-safe)] bg-[var(--color-status-safe)] text-white"
              : "border-[var(--color-outline-variant)] text-transparent hover:border-[var(--color-outline)]"
          }`}
          aria-label={m.sourced ? "Mark as needed" : "Mark as sourced"}
        >
          <CheckIcon />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`text-body-lg font-bold text-[var(--color-on-surface)] ${
                m.sourced ? "line-through" : ""
              }`}
            >
              {m.item}
            </p>
            {curve && <Chip tone="gold">{curve}</Chip>}
          </div>
          {(metaParts.length > 0 || specText) && (
            <p className="mt-1 font-[family-name:var(--font-jetbrains)] text-technical-sm text-[var(--color-on-surface-variant)]">
              {[specText, ...metaParts].filter(Boolean).join("  ·  ")}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

/** Consolidated row aggregating one line item across jobs. */
function ConsolidatedRowView({
  row,
  jobTitle,
  onToggle,
}: {
  row: ConsolidatedRow;
  jobTitle: (jobId: string) => string;
  onToggle: () => void;
}) {
  const allSourced = row.materials.every((m) => m.sourced);
  const curve = curveOf(row.spec);
  const specText =
    row.spec &&
    (!curve || row.spec.trim().toLowerCase() !== curve.toLowerCase())
      ? row.spec
      : null;

  const qtyText =
    row.summedQuantity != null
      ? `Qty: ${row.summedQuantity}${row.unit ? ` ${row.unit}` : ""}`
      : `${row.materials.length} line-items`;

  const jobNames = row.jobIds.map(jobTitle);
  const jobsCaption =
    row.jobIds.length === 1
      ? `For 1 job: ${jobNames[0]}`
      : `For ${row.jobIds.length} jobs: ${jobNames.join(", ")}`;

  return (
    <li>
      <div
        className={`flex items-start gap-3 rounded border border-[var(--color-slate-light)] bg-[var(--color-surface-container-lowest)] p-3 transition-opacity ${
          allSourced ? "opacity-55" : "opacity-100"
        }`}
      >
        <button
          onClick={onToggle}
          className={`flex h-[48px] w-[48px] shrink-0 items-center justify-center rounded-md border-2 ${
            allSourced
              ? "border-[var(--color-status-safe)] bg-[var(--color-status-safe)] text-white"
              : "border-[var(--color-outline-variant)] text-transparent hover:border-[var(--color-outline)]"
          }`}
          aria-label={allSourced ? "Mark all as needed" : "Mark all as sourced"}
        >
          <CheckIcon />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={`text-body-lg font-bold text-[var(--color-on-surface)] ${
                allSourced ? "line-through" : ""
              }`}
            >
              {row.item}
            </p>
            {curve && <Chip tone="gold">{curve}</Chip>}
            <span className="font-[family-name:var(--font-jetbrains)] text-technical-sm text-[var(--color-on-surface)]">
              {qtyText}
            </span>
          </div>
          {specText && (
            <p className="mt-1 font-[family-name:var(--font-jetbrains)] text-technical-sm text-[var(--color-on-surface-variant)]">
              {specText}
            </p>
          )}
          <p className="mt-1 font-[family-name:var(--font-jetbrains)] text-technical-sm text-[var(--color-outline)]">
            {jobsCaption}
          </p>
        </div>
      </div>
    </li>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M5 12l5 5L19 7"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BoxIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
      <path
        d="M21 8l-9-5-9 5m18 0l-9 5m9-5v8l-9 5m0-8L3 8m9 5v8M3 8v8l9 5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M9 5l7 7-7 7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
