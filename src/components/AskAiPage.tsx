import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { assembleAllJobsData } from "../lib/db";
import type { JobData } from "../lib/db";
import { askJob } from "../lib/llm";
import { TopBar } from "./TopBar";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Spinner } from "./ui/Spinner";
import { useToast } from "./ui/Toast";

interface Exchange {
  question: string;
  answer: string;
}

const SUGGESTIONS = [
  "Which jobs still need materials?",
  "List every RCBO across all boards",
  "What actions are outstanding?",
  "Which boards need review?",
];

interface Stats {
  jobs: number;
  circuits: number;
  notes: number;
  materials: number;
}

export default function AskAiPage() {
  const toast = useToast();
  const [allJobsData, setAllJobsData] = useState<JobData[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    assembleAllJobsData()
      .then((data) => {
        if (!cancelled) {
          setAllJobsData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllJobsData([]);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo<Stats>(() => {
    const data = allJobsData ?? [];
    let circuits = 0;
    let notes = 0;
    let materials = 0;
    for (const d of data) {
      for (const p of d.panels) {
        circuits += p.components.filter((c) => c.type !== "blank").length;
      }
      notes += d.notes.length;
      materials += d.materials.length;
    }
    return { jobs: data.length, circuits, notes, materials };
  }, [allJobsData]);

  async function handleAsk() {
    const question_ = question.trim();
    if (!question_ || asking || !allJobsData) return;
    setAsking(true);
    const res = await askJob(JSON.stringify(allJobsData), question_);
    setAsking(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setExchanges((prev) => [...prev, { question: question_, answer: res.value }]);
    setQuestion("");
  }

  function useSuggestion(s: string) {
    setQuestion(s);
    inputRef.current?.focus();
  }

  const hasJobs = (allJobsData?.length ?? 0) > 0;

  return (
    <>
      <TopBar title="Ask AI" subtitle="Ask across every job" />
      <div className="mx-auto w-full max-w-3xl px-4 py-4 sm:py-6">
        {loading ? (
          <Card className="flex items-center justify-center p-10 text-[var(--color-on-surface-variant)]">
            <Spinner size={22} label="Loading your jobs…" />
          </Card>
        ) : !hasJobs ? (
          <EmptyState />
        ) : (
          <Card className="ai-glow ai-hud flex flex-col p-4 sm:p-5">
            <header className="mb-3 flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
                <SparkIcon />
              </span>
              <h2 className="text-headline-md text-[var(--color-on-surface)]">
                Ask AI
              </h2>
            </header>

            <div className="flex flex-col gap-3">
              <Bubble role="assistant">
                {`I’ve indexed ${stats.jobs} ${
                  stats.jobs === 1 ? "job" : "jobs"
                }, ${stats.circuits} circuits, ${stats.notes} notes and ${
                  stats.materials
                } materials. Ask me anything across all your jobs.`}
              </Bubble>

              {exchanges.map((ex, i) => (
                <div key={i} className="flex flex-col gap-3">
                  <Bubble role="user">{ex.question}</Bubble>
                  <Bubble role="assistant">{ex.answer}</Bubble>
                </div>
              ))}

              {asking && (
                <Bubble role="assistant">
                  <span className="inline-flex items-center gap-2 text-[var(--color-on-surface-variant)]">
                    <Spinner size={16} /> Thinking…
                  </span>
                </Bubble>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => useSuggestion(s)}
                  className="min-h-[40px] rounded-full border border-[var(--color-primary)]/40 bg-[var(--color-primary)]/10 px-3 py-2 text-technical-sm text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary)]/20"
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="mt-4 flex gap-2">
              <input
                ref={inputRef}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAsk()}
                placeholder="e.g. which jobs still need materials?"
                disabled={asking}
                className="min-h-[48px] min-w-0 flex-1 rounded border border-[var(--color-outline-variant)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-body-md text-[var(--color-on-surface)] outline-none focus:border-[var(--color-primary)] focus:ring-1 focus:ring-[var(--color-primary)] disabled:opacity-60"
              />
              <Button onClick={handleAsk} disabled={asking || !question.trim()}>
                {asking ? <Spinner size={18} /> : "Ask"}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function EmptyState() {
  return (
    <Card className="flex flex-col items-center gap-3 p-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-primary)]/10 text-[var(--color-primary)]">
        <SparkIcon />
      </span>
      <h2 className="text-headline-md text-[var(--color-on-surface)]">
        Nothing to ask about yet
      </h2>
      <p className="max-w-sm text-body-md text-[var(--color-on-surface-variant)]">
        Create a job and capture a board or a voice note first. Once you have
        some data, you can ask questions across all of your jobs here.
      </p>
    </Card>
  );
}

function Bubble({
  role,
  children,
}: {
  role: "assistant" | "user";
  children: ReactNode;
}) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3.5 py-2.5 text-body-md ${
          isUser
            ? "bg-[var(--color-primary-container)] text-white"
            : "border border-[var(--color-primary)]/25 bg-[var(--color-surface-container-lowest)] text-[var(--color-on-surface)]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}

function SparkIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 3l1.8 4.9L18.7 9.7l-4.9 1.8L12 16.4l-1.8-4.9L5.3 9.7l4.9-1.8L12 3z"
        fill="currentColor"
      />
      <path
        d="M19 15l.9 2.4L22.3 18l-2.4.9L19 21l-.9-2.1-2.4-.9 2.4-.6L19 15z"
        fill="currentColor"
      />
    </svg>
  );
}
