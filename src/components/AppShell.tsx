import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { SyncPanel } from "./SyncPanel";

// ---------- Theme (dark-mode-first, persisted) ----------

export type Theme = "dark" | "light";

const THEME_KEY = "readback-theme";

function readStoredTheme(): Theme {
  if (typeof localStorage === "undefined") return "dark";
  const stored = localStorage.getItem(THEME_KEY);
  // Dark-mode-first: default to dark unless the user explicitly chose light.
  return stored === "light" ? "light" : "dark";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

// ---------- Shell context (theme toggle + new-job trigger) ----------

interface ShellContextValue {
  theme: Theme;
  toggleTheme: () => void;
  /** Ask the dashboard to open its "new job" sheet (navigates home first). */
  requestNewJob: () => void;
  /** Monotonic signal the dashboard watches to open its sheet. */
  newJobSignal: number;
}

const ShellContext = createContext<ShellContextValue | null>(null);

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error("useShell must be used inside <AppShell>.");
  return ctx;
}

interface Props {
  children: ReactNode;
}

export function AppShell({ children }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [newJobSignal, setNewJobSignal] = useState(0);
  const [syncOpen, setSyncOpen] = useState(false);

  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Ignore private-mode storage failures — theme still applies this session.
    }
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((t) => (t === "dark" ? "light" : "dark"));
  }, []);

  const requestNewJob = useCallback(() => {
    if (location.pathname !== "/") navigate("/");
    setNewJobSignal((n) => n + 1);
    setDrawerOpen(false);
  }, [location.pathname, navigate]);

  const openSync = useCallback(() => {
    setSyncOpen(true);
    setDrawerOpen(false);
  }, []);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);

  const value: ShellContextValue = {
    theme,
    toggleTheme,
    requestNewJob,
    newJobSignal,
  };

  return (
    <ShellContext.Provider value={value}>
      <div className="flex min-h-full w-full bg-[var(--color-background)] text-[var(--color-on-background)]">
        {/* Desktop persistent sidebar */}
        <aside className="hidden w-60 shrink-0 border-r border-[var(--color-slate-light)] bg-[var(--color-surface-container-low)] md:block">
          <div className="sticky top-0 h-dvh overflow-y-auto rb-scroll">
            <Sidebar onNewJob={requestNewJob} onSync={openSync} />
          </div>
        </aside>

        {/* Mobile slide-in drawer + backdrop */}
        <div
          className={`fixed inset-0 z-50 md:hidden ${drawerOpen ? "" : "pointer-events-none"}`}
          aria-hidden={!drawerOpen}
        >
          <div
            className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${
              drawerOpen ? "opacity-100" : "opacity-0"
            }`}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className={`rb-drawer absolute inset-y-0 left-0 w-[80vw] max-w-[300px] overflow-y-auto rb-scroll border-r border-[var(--color-slate-light)] bg-[var(--color-surface-container-low)] ${
              drawerOpen ? "translate-x-0" : "-translate-x-full"
            }`}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <Sidebar
              onNewJob={requestNewJob}
              onSync={openSync}
              onClose={() => setDrawerOpen(false)}
              showClose
            />
          </div>
        </div>

        {/* Main content region */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Mobile-only header with hamburger */}
          <header className="sticky top-0 z-30 flex min-h-[56px] items-center gap-2 border-b border-[var(--color-slate-light)] bg-[var(--color-surface)]/90 px-3 backdrop-blur md:hidden">
            <button
              onClick={() => setDrawerOpen(true)}
              className="flex min-h-[48px] min-w-[48px] items-center justify-center rounded p-2 text-[var(--color-on-surface-variant)] hover:bg-[var(--color-surface-bright)] hover:text-[var(--color-on-surface)]"
              aria-label="Open menu"
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 6h16M4 12h16M4 18h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
            <span className="text-headline-md text-[var(--color-on-surface)]">
              ReadBack
            </span>
          </header>

          <main className="min-h-0 flex-1 overflow-y-auto rb-scroll">
            {children}
          </main>
        </div>
      </div>

      <SyncPanel open={syncOpen} onClose={() => setSyncOpen(false)} />
    </ShellContext.Provider>
  );
}
