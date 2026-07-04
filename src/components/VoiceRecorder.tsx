import { useEffect, useRef, useState } from "react";
import { Spinner } from "./ui/Spinner";
import { useToast } from "./ui/Toast";

interface Props {
  onRecorded: (blob: Blob) => void;
  /** Parent is processing the last recording (transcribe/clean) — lock the button. */
  busy?: boolean;
  /** Lock mic while another capture mode (e.g. hands-free) owns the stream. */
  disabled?: boolean;
  /** Status line shown under the button while busy (e.g. "Transcribing…"). */
  busyLabel?: string;
  idleLabel?: string;
}

/** Tap-to-record mic capture. Requires a user gesture (iOS rule) — the button is it. */
export function VoiceRecorder({
  onRecorded,
  busy = false,
  disabled = false,
  busyLabel,
  idleLabel = "Hold to note — tap to record",
}: Props) {
  const toast = useToast();
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const started = Date.now();
    const id = window.setInterval(
      () => setSeconds(Math.floor((Date.now() - started) / 1000)),
      250,
    );
    return () => window.clearInterval(id);
  }, [recording]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function start() {
    if (disabled) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: recorder.mimeType || "audio/webm",
        });
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (blob.size > 0) onRecorded(blob);
      };
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch {
      toast.error("Microphone permission is needed to record notes.");
    }
  }

  function stop() {
    recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  return (
    <div className="flex flex-col items-center gap-2">
      {busy ? (
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-zinc-100 text-blue-700">
          <Spinner size={26} />
        </div>
      ) : (
        <button
          onClick={recording ? stop : start}
          disabled={disabled}
          className={`flex h-16 w-16 items-center justify-center rounded-full text-white shadow-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            recording
              ? "bg-red-600 hover:bg-red-700"
              : "bg-blue-700 hover:bg-blue-800"
          }`}
          aria-label={recording ? "Stop recording" : "Start recording"}
        >
          {recording ? (
            <span className="animate-rec-pulse block h-5 w-5 rounded-sm bg-white" />
          ) : (
            <MicIcon />
          )}
        </button>
      )}
      <p className="text-sm text-zinc-500">
        {busy
          ? busyLabel ?? "Working…"
          : recording
            ? `Recording… ${seconds}s — tap to stop`
            : idleLabel}
      </p>
    </div>
  );
}

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
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
