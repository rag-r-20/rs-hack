/** Minimal Web Speech API surface for keyword spotting in hands-free mode. */

export interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
  length: number;
}

export interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultLike[];
}

export interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

export interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  }
}

export function isSpeechRecognitionSupported(): boolean {
  return Boolean(
    typeof window !== "undefined" &&
      (window.SpeechRecognition ?? window.webkitSpeechRecognition),
  );
}

export function createSpeechRecognition(): SpeechRecognitionLike | null {
  const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recognition = new Ctor();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-GB";
  return recognition;
}

/** True when transcript contains the stop phrase. Checked before the wake word. */
export function transcriptHasEndNote(text: string): boolean {
  return /\bend\s+note\b/i.test(text);
}

/** True when transcript contains the wake word, but not as part of "end note". */
export function transcriptHasWakeNote(text: string): boolean {
  if (transcriptHasEndNote(text)) return false;
  return /\bnote\b/i.test(text);
}

/** Remove hands-free wake/stop phrases before sending audio transcripts to the LLM. */
export function stripWakePhrases(text: string): string {
  return text
    .replace(/\bend\s+note\b/gi, "")
    .replace(/\bnote\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}
