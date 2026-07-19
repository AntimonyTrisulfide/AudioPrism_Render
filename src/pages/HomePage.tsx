import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Check,
  ChevronDown,
  Download,
  FileAudio,
  History,
  Loader2,
  LogOut,
  RefreshCw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { AudioSpectrum } from "@/components/AudioSpectrum";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PrismLogo } from "@/components/PrismLogo";
import { backendConnectionMessage, isLikelyCorsOrNetworkError } from "@/lib/deploymentErrors";

type StemOption = {
  name: string;
  label: string;
};

type StemResult = StemOption & {
  url: string;
  storageKey?: string | null;
};

type HistoryEntry = {
  inputName: string;
  createdAt: string;
  cacheId?: string;
  stems: StemResult[];
  selectedStemLabels?: string[];
};

type InferencePayload = {
  detail?: string;
  error?: string;
  historySaved?: boolean;
  jobId?: string;
  message?: string;
  progress?: Partial<ProcessingProgress>;
  status?: string;
  stems?: StemResult[];
};

type ProcessingProgress = {
  detail: string;
  label: string;
  percent: number;
};

type HomePageProps = {
  apiRoot?: string;
  token: string;
  user: { username?: string; email?: string };
  onLogout: () => void;
};

const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 25);
const UPLOAD_PROGRESS_END = 35;
const INFERENCE_PROGRESS_END = 94;
const INFERENCE_POLL_INTERVAL_MS = 2500;
const INFERENCE_POLL_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_TRANSIENT_POLL_FAILURES = 5;
const FALLBACK_STEMS: StemOption[] = [
  { name: "Vocal", label: "Vocals" },
  { name: "Guitar", label: "Guitar" },
  { name: "Bass", label: "Bass" },
  { name: "Drums", label: "Drums" },
  { name: "Percussion", label: "Percussion" },
  { name: "Piano_Keyboard", label: "Keys" },
  { name: "Woodwinds", label: "Woodwinds" },
  { name: "Brass", label: "Brass" },
  { name: "Strings", label: "Strings" },
  { name: "Effects_Other", label: "Other" },
];

function formatDate(value?: string) {
  if (!value) return "Unknown date";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatMegabytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, ms));
}

function ProgressMeter({ progress }: { progress: ProcessingProgress }) {
  const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));

  return (
    <div className="inference-progress" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="font-medium text-slate-200">{progress.label}</span>
        <span className="tabular-nums text-cyan-200">{percent}%</span>
      </div>
      <div
        className="inference-progress__track"
        role="progressbar"
        aria-label="Inference progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <span className="inference-progress__bar" style={{ width: `${percent}%` }} />
      </div>
      <p className="text-xs text-slate-400">{progress.detail}</p>
    </div>
  );
}

export default function HomePage({ apiRoot = "", token, user, onLogout }: HomePageProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [availableStems, setAvailableStems] = useState<StemOption[]>(FALLBACK_STEMS);
  const [selectedStems, setSelectedStems] = useState<string[]>([]);
  const [results, setResults] = useState<StemResult[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [processing, setProcessing] = useState(false);
  const [stemsLoading, setStemsLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [draggingFile, setDraggingFile] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingProgress>({
    detail: "Waiting for an audio file.",
    label: "Ready",
    percent: 0,
  });
  const progressTimerRef = useRef<number | null>(null);

  const root = useMemo(() => apiRoot.replace(/\/$/, ""), [apiRoot]);
  const apiUrl = useCallback((path: string) => `${root}${path}`, [root]);
  const authHeaders = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const absoluteUrl = useCallback(
    (value: string) => {
      if (/^https?:\/\//i.test(value) || value.startsWith("blob:")) return value;
      return `${root}${value.startsWith("/") ? value : `/${value}`}`;
    },
    [root],
  );

  const handleUnauthorized = useCallback(() => {
    toast.error("Your session expired. Please log in again.");
    onLogout();
  }, [onLogout]);

  const loadStemCatalog = useCallback(async () => {
    setStemsLoading(true);
    try {
      const response = await fetch(apiUrl("/api/stems"), { headers: authHeaders });
      if (response.status === 401) return handleUnauthorized();
      if (!response.ok) throw new Error("Could not load the model stem list.");
      const payload = (await response.json()) as { stems?: StemOption[] };
      if (!payload.stems?.length) throw new Error("The model returned no stem definitions.");
      setAvailableStems(payload.stems);
      setSelectedStems((current) => {
        const valid = current.filter((name) => payload.stems?.some((stem) => stem.name === name));
        return valid.length ? valid : payload.stems!.map((stem) => stem.name);
      });
    } catch (error) {
      setSelectedStems((current) => (current.length ? current : FALLBACK_STEMS.map((stem) => stem.name)));
      toast.error(
        isLikelyCorsOrNetworkError(error)
          ? backendConnectionMessage(root, "loading stems")
          : error instanceof Error
            ? error.message
            : "Could not load stems.",
      );
    } finally {
      setStemsLoading(false);
    }
  }, [apiUrl, authHeaders, handleUnauthorized, root]);

  const loadHistory = useCallback(async (showErrors = true) => {
    setHistoryLoading(true);
    try {
      const response = await fetch(apiUrl("/api/infer/results"), { headers: authHeaders });
      if (response.status === 401) return handleUnauthorized();
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.detail || "Could not load your history.");
      setHistory(Array.isArray(payload.results) ? payload.results : []);
    } catch (error) {
      if (showErrors) {
        toast.error(
          isLikelyCorsOrNetworkError(error)
            ? backendConnectionMessage(root, "loading history")
            : error instanceof Error
              ? error.message
              : "Could not load your history.",
        );
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [apiUrl, authHeaders, handleUnauthorized, root]);

  useEffect(() => {
    void loadStemCatalog();
    void loadHistory();
  }, [loadHistory, loadStemCatalog]);

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  useEffect(() => {
    return () => clearProgressTimer();
  }, []);

  function clearProgressTimer() {
    if (progressTimerRef.current === null) return;
    window.clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
  }

  function startInferenceProgressEstimate(fileSize: number, stemCount: number) {
    clearProgressTimer();

    const startedAt = Date.now();
    const fileMegabytes = fileSize / (1024 * 1024);
    const estimatedMs = Math.min(180_000, Math.max(22_000, fileMegabytes * 900 + stemCount * 2_500));

    progressTimerRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const eased = 1 - Math.exp(-(elapsed / estimatedMs) * 3);
      const target = UPLOAD_PROGRESS_END + eased * (INFERENCE_PROGRESS_END - UPLOAD_PROGRESS_END);
      const label =
        elapsed < estimatedMs * 0.42
          ? "Separating stems"
          : elapsed < estimatedMs * 0.78
            ? "Reconstructing audio"
            : "Finalizing downloads";

      setProcessingProgress((current) => ({
        detail: "The 512 MB runtime may take a little while on larger files.",
        label,
        percent: Math.max(current.percent, Math.min(INFERENCE_PROGRESS_END, target)),
      }));
    }, 800);
  }

  function chooseFile(nextFile?: File) {
    if (!nextFile) return;
    if (MAX_UPLOAD_MB > 0 && nextFile.size > MAX_UPLOAD_MB * 1024 * 1024) {
      toast.error(`The upload limit is ${MAX_UPLOAD_MB} MB.`);
      return;
    }
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(nextFile);
    setFileUrl(URL.createObjectURL(nextFile));
    setResults([]);
    setProcessingProgress({
      detail: `${formatMegabytes(nextFile.size)} selected.`,
      label: "Ready to separate",
      percent: 0,
    });
  }

  function clearFile() {
    if (fileUrl) URL.revokeObjectURL(fileUrl);
    setFile(null);
    setFileUrl(null);
    setResults([]);
    setProcessingProgress({
      detail: "Waiting for an audio file.",
      label: "Ready",
      percent: 0,
    });
  }

  function toggleStem(name: string, checked: boolean) {
    setSelectedStems((current) =>
      checked ? (current.includes(name) ? current : [...current, name]) : current.filter((item) => item !== name),
    );
  }

  async function processAudio() {
    if (!file) return toast.error("Choose an audio file first.");
    if (!selectedStems.length) return toast.error("Select at least one stem.");

    setProcessing(true);
    setResults([]);
    clearProgressTimer();
    setProcessingProgress({
      detail: `${formatMegabytes(file.size)} queued for upload.`,
      label: "Preparing upload",
      percent: 1,
    });
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("selected_stems", selectedStems.join(","));
      form.append("async_inference", "1");
      const payload = await postInferenceRequest(form, file.size, selectedStems.length);
      if (!Array.isArray(payload.stems) || !payload.stems.length) {
        throw new Error("Processing completed, but the backend returned no stems.");
      }
      setProcessingProgress({
        detail: "Separated stems are ready.",
        label: "Complete",
        percent: 100,
      });
      setResults(payload.stems);
      void loadHistory(false);
      if (payload.historySaved === false) {
        toast.warning("Stems are ready, but MongoDB history could not be updated.");
      } else {
        toast.success(`${payload.stems.length} stem${payload.stems.length === 1 ? "" : "s"} ready.`);
      }
    } catch (error) {
      if (error instanceof Error && error.message) {
        toast.error(error.message);
      } else if (!(error instanceof Error)) {
        toast.error("Audio processing failed.");
      }
    } finally {
      clearProgressTimer();
      setProcessing(false);
    }
  }

  async function pollInferenceJob(jobId: string): Promise<InferencePayload> {
    const deadline = Date.now() + INFERENCE_POLL_TIMEOUT_MS;
    let transientFailures = 0;

    while (Date.now() < deadline) {
      let response: Response;
      try {
        response = await fetch(apiUrl(`/api/infer/jobs/${encodeURIComponent(jobId)}`), { headers: authHeaders });
      } catch (error) {
        if (isLikelyCorsOrNetworkError(error) && transientFailures < MAX_TRANSIENT_POLL_FAILURES) {
          transientFailures += 1;
          setProcessingProgress((current) => ({
            detail: "The backend is busy; reconnecting to the inference job.",
            label: "Reconnecting",
            percent: Math.max(current.percent, UPLOAD_PROGRESS_END),
          }));
          await sleep(INFERENCE_POLL_INTERVAL_MS);
          continue;
        }
        if (isLikelyCorsOrNetworkError(error)) {
          throw new Error(backendConnectionMessage(root, "checking inference status"));
        }
        throw error;
      }

      if (response.status === 401) {
        handleUnauthorized();
        throw new Error("");
      }

      if (response.status >= 500 && transientFailures < MAX_TRANSIENT_POLL_FAILURES) {
        transientFailures += 1;
        setProcessingProgress((current) => ({
          detail: "The backend is still recovering; checking again shortly.",
          label: "Reconnecting",
          percent: Math.max(current.percent, UPLOAD_PROGRESS_END),
        }));
        await sleep(INFERENCE_POLL_INTERVAL_MS);
        continue;
      }

      transientFailures = 0;
      const payload = (await response.json().catch(() => ({}))) as InferencePayload;
      if (response.status === 404) {
        throw new Error(
          "The backend lost the inference job, which usually means the Render worker restarted during processing. Try a shorter clip or move the backend to a larger instance.",
        );
      }
      if (!response.ok) {
        throw new Error(payload.detail || payload.message || "Could not check inference status.");
      }

      if (payload.status === "success" || payload.status === "cached") {
        return payload;
      }

      if (payload.status === "failed") {
        throw new Error(payload.detail || payload.message || payload.error || "Audio processing failed.");
      }

      const reportedPercent =
        typeof payload.progress?.percent === "number"
          ? Math.min(INFERENCE_PROGRESS_END, Math.max(UPLOAD_PROGRESS_END, payload.progress.percent))
          : null;
      setProcessingProgress((current) => ({
        detail: payload.progress?.detail || payload.detail || "The backend is still separating the selected stems.",
        label: payload.progress?.label || (payload.status === "queued" ? "Queued" : "Separating stems"),
        percent:
          reportedPercent === null
            ? Math.max(current.percent, Math.min(INFERENCE_PROGRESS_END, current.percent + 0.8))
            : Math.max(current.percent, reportedPercent),
      }));

      await sleep(INFERENCE_POLL_INTERVAL_MS);
    }

    throw new Error("Audio processing is still running. Refresh your history in a minute.");
  }

  function postInferenceRequest(form: FormData, fileSize: number, stemCount: number) {
    return new Promise<InferencePayload>((resolve, reject) => {
      const request = new XMLHttpRequest();
      let inferenceEstimateStarted = false;

      function startServerSideProgress() {
        if (inferenceEstimateStarted) return;
        inferenceEstimateStarted = true;
        setProcessingProgress((current) => ({
          detail: "Upload complete. The UNet is working through the audio.",
          label: "Starting inference",
          percent: Math.max(current.percent, UPLOAD_PROGRESS_END),
        }));
        startInferenceProgressEstimate(fileSize, stemCount);
      }

      request.open("POST", apiUrl("/api/infer/segment"));
      Object.entries(authHeaders).forEach(([header, value]) => {
        request.setRequestHeader(header, value);
      });

      request.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const uploadRatio = event.total ? event.loaded / event.total : 0;
        setProcessingProgress({
          detail: `${formatMegabytes(event.loaded)} of ${formatMegabytes(event.total)} uploaded.`,
          label: "Uploading audio",
          percent: Math.max(2, uploadRatio * UPLOAD_PROGRESS_END),
        });
      };

      request.upload.onload = startServerSideProgress;

      request.onerror = () => {
        clearProgressTimer();
        reject(new Error(backendConnectionMessage(root, "processing audio")));
      };
      request.onabort = () => {
        clearProgressTimer();
        reject(new Error("Audio processing was cancelled."));
      };
      request.onload = async () => {
        let payload: InferencePayload = {};
        try {
          payload = request.responseText ? (JSON.parse(request.responseText) as InferencePayload) : {};
        } catch {
          payload = { message: request.responseText };
        }

        if (request.status === 401) {
          handleUnauthorized();
          reject(new Error(""));
          return;
        }

        if (request.status === 202) {
          if (!payload.jobId) {
            clearProgressTimer();
            reject(new Error("The backend accepted the upload but did not return an inference job id."));
            return;
          }
          startServerSideProgress();
          try {
            const completed = await pollInferenceJob(payload.jobId);
            clearProgressTimer();
            resolve(completed);
          } catch (error) {
            clearProgressTimer();
            reject(error instanceof Error ? error : new Error("Audio processing failed."));
          }
          return;
        }

        clearProgressTimer();
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(payload.detail || payload.message || "Audio processing failed."));
          return;
        }

        resolve(payload);
      };

      request.send(form);
    });
  }

  const selectedLabels = availableStems
    .filter((stem) => selectedStems.includes(stem.name))
    .map((stem) => stem.label);

  return (
    <main className="min-h-screen text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-slate-950/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <PrismLogo size="sm" showWordmark={false} stableAxis className="hidden sm:flex shrink-0" />
            <div className="min-w-0">
              <h1 className="text-base font-semibold">AudioPrism</h1>
              <p className="truncate text-xs text-slate-400">Signed in as {user.username || user.email}</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onLogout} className="text-slate-300 hover:text-white">
            <LogOut className="mr-2 h-4 w-4" /> Log out
          </Button>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="min-w-0">
          <div className="mb-5">
            <p className="text-xs font-semibold uppercase text-cyan-300">New separation</p>
            <h2 className="mt-1 text-2xl font-semibold">Choose only the stems you need</h2>
          </div>

          <label
            className={`audio-upload-zone relative flex min-h-56 cursor-pointer flex-col items-center justify-center gap-4 border border-dashed p-5 text-center transition sm:flex-row sm:text-left ${draggingFile ? "audio-upload-zone--active border-cyan-300 bg-cyan-300/10" : "border-slate-600 bg-[#0a151e] hover:border-cyan-400/70"}`}
            onDragEnter={(event) => { event.preventDefault(); setDraggingFile(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDraggingFile(false); }}
            onDrop={(event) => { event.preventDefault(); setDraggingFile(false); chooseFile(event.dataTransfer.files?.[0]); }}
          >
            <span className="audio-file-catcher" aria-hidden="true">
              <span className="audio-file-catcher__ears"><span /><span /></span>
              <span className="audio-file-catcher__head">
                <span className="audio-file-catcher__eye audio-file-catcher__eye--left" />
                <span className="audio-file-catcher__eye audio-file-catcher__eye--right" />
                <span className="audio-file-catcher__muzzle" />
                <span className="audio-file-catcher__mouth" />
              </span>
              <span className="audio-file-catcher__arms">
                <span className="audio-file-catcher__arm audio-file-catcher__arm--left" />
                <span className="audio-file-catcher__arm audio-file-catcher__arm--right" />
              </span>
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">
                {draggingFile ? "Drop it here" : file?.name || "Click or drop an audio file"}
              </span>
              <span className="mt-1 block text-xs text-slate-400">
                {draggingFile
                  ? "The catcher is ready."
                  : file
                    ? `${formatMegabytes(file.size)} selected`
                    : `MP3, WAV, FLAC, M4A, AAC, or OGG up to ${MAX_UPLOAD_MB} MB.`}
              </span>
            </span>
            {file && (
              <Button type="button" size="icon" variant="ghost" className="absolute right-3 top-3 shrink-0" title="Remove selected file" onClick={(event) => { event.preventDefault(); clearFile(); }} disabled={processing}>
                <X className="h-4 w-4" />
              </Button>
            )}
            <Input className="sr-only" type="file" disabled={processing} accept="audio/*,.mp3,.wav,.flac,.m4a,.aac,.ogg" onChange={(event) => { chooseFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          </label>

          <div className="mt-6 border-y border-white/10 py-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <span className="text-sm font-medium">Stems to extract</span>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" disabled={processing || stemsLoading} onClick={() => setSelectedStems(availableStems.map((stem) => stem.name))}>All</Button>
                <Button variant="ghost" size="sm" disabled={processing || stemsLoading} onClick={() => setSelectedStems([])}>Clear</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {availableStems.map((stem) => {
                const checked = selectedStems.includes(stem.name);
                return (
                  <label key={stem.name} className={`flex min-h-11 cursor-pointer items-center gap-2 border px-3 py-2 text-sm transition ${checked ? "border-cyan-300/50 bg-cyan-300/10" : "border-white/10 bg-[#0a151e] hover:border-white/25"}`}>
                    <Checkbox checked={checked} disabled={processing || stemsLoading} onCheckedChange={(value) => toggleStem(stem.name, Boolean(value))} />
                    <span className="truncate">{stem.label}</span>
                  </label>
                );
              })}
            </div>
            <p className="mt-3 min-h-5 text-xs text-slate-400">{selectedLabels.length ? selectedLabels.join(", ") : "No stems selected"}</p>
          </div>

          <Button className="mt-5 h-11 w-full bg-cyan-300 text-slate-950 hover:bg-cyan-200" disabled={!file || !selectedStems.length || processing || stemsLoading} onClick={processAudio}>
            {processing ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Separating audio</> : <><AudioLines className="mr-2 h-4 w-4" /> Extract selected stems</>}
          </Button>
          {processing && <ProgressMeter progress={processingProgress} />}

          {fileUrl && (
            <div className="mt-7">
              <p className="mb-3 text-sm font-medium">Original mix</p>
              <AudioSpectrum src={fileUrl} height={72} />
            </div>
          )}
        </section>

        <section className="min-w-0 border-t border-white/10 pt-7 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-emerald-300">Current result</p>
              <h2 className="mt-1 text-2xl font-semibold">Separated stems</h2>
            </div>
            {results.length > 0 && <span className="text-sm text-slate-400">{results.length} ready</span>}
          </div>

          {!results.length && !processing && (
            <div className="grid min-h-56 place-items-center border border-white/10 bg-[#0a151e] px-6 text-center">
              <div><FileAudio className="mx-auto h-8 w-8 text-slate-500" /><p className="mt-3 text-sm text-slate-400">Your selected stems will appear here.</p></div>
            </div>
          )}

          {processing && (
            <div className="grid min-h-56 place-items-center border border-white/10 bg-[#0a151e] px-6 text-center" aria-live="polite">
              <div className="w-full max-w-sm">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-cyan-300" />
                <p className="mt-3 text-sm text-slate-300">{processingProgress.label}</p>
                <ProgressMeter progress={processingProgress} />
              </div>
            </div>
          )}

          <div className="space-y-3">
            {results.map((stem) => {
              const url = absoluteUrl(stem.url);
              return (
                <article key={stem.name} className="border border-white/10 bg-[#0a151e] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2"><Check className="h-4 w-4 shrink-0 text-emerald-300" /><h3 className="truncate text-sm font-medium">{stem.label}</h3></div>
                    <Button asChild size="icon" variant="ghost" title={`Download ${stem.label}`}><a href={url} download><Download className="h-4 w-4" /></a></Button>
                  </div>
                  <AudioSpectrum src={url} height={62} />
                </article>
              );
            })}
          </div>
        </section>
      </div>

      <section className="border-t border-white/10 bg-[#0a151e]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3"><History className="h-5 w-5 text-slate-400" /><div><h2 className="font-semibold">Your history</h2><p className="text-xs text-slate-400">Only runs created by this account</p></div></div>
            <Button variant="outline" size="icon" title="Refresh history" onClick={() => void loadHistory()} disabled={historyLoading}><RefreshCw className={`h-4 w-4 ${historyLoading ? "animate-spin" : ""}`} /></Button>
          </div>

          {!historyLoading && !history.length && <p className="border border-white/10 p-5 text-sm text-slate-400">No saved runs for this account yet.</p>}
          <div className="divide-y divide-white/10 border-y border-white/10">
            {history.map((entry, index) => (
              <details key={entry.cacheId || `${entry.inputName}-${index}`} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                  <div className="min-w-0"><p className="truncate text-sm font-medium">{entry.inputName}</p><p className="mt-1 text-xs text-slate-400">{formatDate(entry.createdAt)} | {entry.stems?.length || 0} stems</p></div>
                  <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
                </summary>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {(entry.stems || []).map((stem) => <a key={`${entry.cacheId}-${stem.name}`} href={absoluteUrl(stem.url)} download className="flex items-center justify-between border border-white/10 px-3 py-2 text-sm hover:border-cyan-300/40"><span>{stem.label}</span><Download className="h-4 w-4 text-slate-400" /></a>)}
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
