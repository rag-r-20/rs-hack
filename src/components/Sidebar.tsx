import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

interface Props {
  onNewJob: () => void;
  /** Open the Sync (backup/restore) modal. */
  onSync: () => void;
  /** Mobile drawer only: render a close (X) button in the brand row. */
  showClose?: boolean;
  onClose?: () => void;
}

export function Sidebar({ onNewJob, onSync, showClose, onClose }: Props) {
  return (
    <nav className="flex h-full min-h-dvh flex-col gap-6 px-4 py-5">
      {/* Brand + technician identity */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded bg-[var(--color-primary-container)] text-white">
              <BrandGlyph />
            </span>
            <span className="text-headline-md text-[var(--color-on-surface)]">
              ReadBack
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-container-highest)] text-[var(--color-on-surface-variant)]"
              aria-hidden="true"
            >
              <AvatarGlyph />
            </span>
            <div className="min-w-0">
              <p className="truncate text-body-md font-bold text-[var(--color-on-surface)]">
                Field Tech
              </p>
              <p className="truncate text-technical-sm text-[var(--color-on-surface-variant)]">
                ID: 9928-RT
              </p>
            </div>
          </div>
        </div>
        {showClose && (
          <button
            onClick={onClose}
            className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded p-2 text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-bright)] hover:text-[var(--color-on-surface)]"
            aria-label="Close menu"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}
      </div>

      {/* New job */}
      <button
        onClick={onNewJob}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded bg-[var(--color-primary-container)] px-4 py-3 text-body-md font-bold text-white shadow-sm transition-colors hover:bg-[var(--color-inverse-primary)]"
      >
        <PlusGlyph />
        New Job
      </button>

      {/* Contextual nav */}
      <div className="flex flex-col gap-1">
        <NavItem to="/" end icon={<BoardGlyph />} label="Board" />
        <NavItem to="/notes" icon={<NotesGlyph />} label="Notes" />
        <NavItem to="/materials" icon={<MaterialsGlyph />} label="Materials" />
        <NavItem to="/ask" icon={<AiGlyph />} label="Ask AI" />
      </div>

      <div className="my-1 h-px bg-[var(--color-slate-light)]" />

      <div className="flex flex-col gap-1">
        <NavItem to="/history" icon={<HistoryGlyph />} label="History" />
        <StaticItem
          icon={<SyncGlyph />}
          label="Sync"
          trailing={<SyncDot />}
          onClick={onSync}
        />
      </div>
    </nav>
  );
}

function NavItem({
  to,
  end,
  icon,
  label,
  inert,
}: {
  to: string;
  end?: boolean;
  icon: ReactNode;
  label: string;
  /** Contextual item that navigates but never shows an active highlight. */
  inert?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex min-h-[48px] items-center gap-3 rounded px-3 py-2 text-body-md transition-colors ${
          isActive && !inert
            ? "bg-[var(--color-primary-container)] font-bold text-white"
            : "text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-bright)] hover:text-[var(--color-on-surface)]"
        }`
      }
    >
      <span className="shrink-0">{icon}</span>
      {label}
    </NavLink>
  );
}

function StaticItem({
  icon,
  label,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[48px] items-center gap-3 rounded px-3 py-2 text-body-md text-[var(--color-on-surface-variant)] transition-colors hover:bg-[var(--color-surface-bright)] hover:text-[var(--color-on-surface)]"
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {trailing}
    </button>
  );
}

// ---------- Glyphs ----------

function BrandGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
      <path
        d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"
        fill="currentColor"
      />
    </svg>
  );
}

function AvatarGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5 20a7 7 0 0114 0"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function BoardGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M7 8v3M12 8v3M17 8v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function NotesGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="5" y="3" width="14" height="18" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9 8h6M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MaterialsGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4M21 7v10l-9 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AiGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M18 15l.7 1.8L20.5 17.5l-1.8.7L18 20l-.7-1.8L15.5 17.5l1.8-.7L18 15z" fill="currentColor" />
    </svg>
  );
}

function HistoryGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 12a9 9 0 109-9 9 9 0 00-7 3.4M3 3v3.5H6.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12 8v4l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SyncGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path
        d="M4 12a8 8 0 0113.7-5.6L20 8M20 4v4h-4M20 12a8 8 0 01-13.7 5.6L4 16M4 20v-4h4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SyncDot() {
  return (
    <span
      className="h-2 w-2 rounded-full bg-[var(--color-status-safe)]"
      aria-label="Synced"
      title="Synced"
    />
  );
}
