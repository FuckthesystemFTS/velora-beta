"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Download, Radio } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type LiveMode = "audio-video" | "audio-only";

type LiveBroadcastCard = {
  id: string;
  mode: "AUDIO_VIDEO" | "AUDIO_ONLY";
  status: "ACTIVE" | "ENDED";
  recordingUrl: string | null;
  startedAt: string | Date;
  endedAt: string | Date | null;
  expiresAt: string | Date | null;
  creatorId: string;
  creator: {
    username: string;
    profile: {
      displayName: string | null;
      avatarUrl: string | null;
    } | null;
  };
  post: {
    id: string;
    content: string;
    media: Array<{
      secureUrl: string;
      resourceType: "IMAGE" | "VIDEO";
    }>;
  };
};

export function LiveStudio({
  viewerUsername,
  initialActive,
  initialArchive,
  initialOwnActive,
}: {
  viewerUsername: string;
  initialActive: LiveBroadcastCard[];
  initialArchive: LiveBroadcastCard[];
  initialOwnActive: LiveBroadcastCard | null;
}) {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [liveMode, setLiveMode] = useState<LiveMode>("audio-video");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "requesting" | "uploading" | "live">(initialOwnActive ? "live" : "idle");
  const [microphoneEnabled, setMicrophoneEnabled] = useState(true);
  const [cameraEnabled, setCameraEnabled] = useState(true);
  const [description, setDescription] = useState("");
  const [broadcast, setBroadcast] = useState<LiveBroadcastCard | null>(initialOwnActive);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (downloadUrl) {
        URL.revokeObjectURL(downloadUrl);
      }
    };
  }, [downloadUrl]);

  async function startLive() {
    try {
      setError(null);
      setStatus("requesting");
      streamRef.current?.getTracks().forEach((track) => track.stop());

      if (typeof window === "undefined" || !window.isSecureContext) {
        throw new Error("La diretta richiede una connessione HTTPS sicura.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Questo browser non supporta camera o microfono.");
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: liveMode === "audio-video",
      });

      streamRef.current = stream;
      setMicrophoneEnabled(true);
      setCameraEnabled(liveMode === "audio-video");

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const startResponse = await fetch("/api/live/broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: description,
          mode: liveMode === "audio-video" ? "AUDIO_VIDEO" : "AUDIO_ONLY",
          visibility: "PUBLIC",
        }),
      });
      const startData = await startResponse.json();
      if (!startResponse.ok) {
        throw new Error(startData.error ?? "Impossibile avviare la diretta.");
      }

      const mimeType =
        MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
          ? "video/webm;codecs=vp9,opus"
          : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
            ? "video/webm;codecs=vp8,opus"
            : "video/webm";
      const recorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      setBroadcast(startData.broadcast);

      setStatus("live");
      router.refresh();
    } catch (error) {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      const message =
        error instanceof Error
          ? error.message
          : "Permessi audio/video negati o dispositivo non disponibile.";
      setError(message);
      setStatus("idle");
    }
  }

  async function stopLive() {
    if (!broadcast) {
      return;
    }

    setStatus("uploading");
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }

    const recorder = recorderRef.current;
    recorderRef.current = null;

    const finalize = async () => {
      let recordingPayload: Record<string, unknown> | null = null;

      if (chunksRef.current.length) {
        const recordingBlob = new Blob(chunksRef.current, { type: recorder?.mimeType || "video/webm" });
        const file = new File([recordingBlob], `live-${broadcast.id}.webm`, { type: recordingBlob.type });
        const objectUrl = URL.createObjectURL(recordingBlob);
        setDownloadUrl((current) => {
          if (current) URL.revokeObjectURL(current);
          return objectUrl;
        });

        const formData = new FormData();
        formData.append("files", file);
        const uploadResponse = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        const uploadData = await uploadResponse.json();
        if (!uploadResponse.ok) {
          throw new Error(uploadData.error ?? "Upload registrazione fallito.");
        }

        recordingPayload = uploadData.items?.[0] ?? null;
      }

      const response = await fetch(`/api/live/broadcasts/${broadcast.id}/end`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recording: recordingPayload,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? "Chiusura diretta fallita.");
      }

      setBroadcast(null);
      chunksRef.current = [];
      setStatus("idle");
      router.refresh();
    };

    if (recorder && recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve();
        recorder.stop();
      });
    }

    try {
      await finalize();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Impossibile completare la diretta.");
      setStatus("idle");
    }
  }

  function toggleMicrophone() {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicrophoneEnabled(track.enabled);
  }

  function toggleCamera() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCameraEnabled(track.enabled);
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-serif text-4xl font-semibold text-[var(--foreground)]">Studio live</h1>
          <span className="rounded-full border border-[rgba(255,88,62,0.2)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {status === "live" ? "in diretta" : status === "requesting" ? "richiesta permessi" : "pronto"}
          </span>
        </div>
        <p className="text-sm text-[var(--muted)]">
          Abilita microfono e camera per aprire una sessione live. Alla chiusura la registrazione viene pubblicata nel feed e resta visibile per 7 giorni.
        </p>

        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Descrizione della diretta"
          className="min-h-24 w-full rounded-[24px] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-3 text-base text-[var(--foreground)] outline-none md:text-sm"
        />

        <div className="flex flex-wrap gap-3">
          <Button type="button" variant={liveMode === "audio-video" ? "primary" : "secondary"} onClick={() => setLiveMode("audio-video")}>
            Audio + video
          </Button>
          <Button type="button" variant={liveMode === "audio-only" ? "primary" : "secondary"} onClick={() => setLiveMode("audio-only")}>
            Solo audio
          </Button>
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="overflow-hidden rounded-[24px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]">
          {liveMode === "audio-video" ? (
            <video ref={videoRef} autoPlay muted playsInline className="h-[260px] w-full object-cover md:h-[420px]" />
          ) : (
            <div className="flex h-[260px] items-center justify-center text-sm text-[var(--muted)] md:h-[320px]">
              Diretta audio pronta. Il microfono verra richiesto all&apos;avvio.
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-3">
          {status !== "live" ? (
            <Button type="button" disabled={status === "requesting" || status === "uploading"} onClick={() => void startLive()}>
              Avvia live
            </Button>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => toggleMicrophone()}>
                {microphoneEnabled ? "Disattiva microfono" : "Attiva microfono"}
              </Button>
              {liveMode === "audio-video" ? (
                <Button type="button" variant="secondary" onClick={() => toggleCamera()}>
                  {cameraEnabled ? "Disattiva camera" : "Attiva camera"}
                </Button>
              ) : null}
              <Button type="button" onClick={() => void stopLive()}>
                Termina live
              </Button>
            </>
          )}
          {downloadUrl ? (
            <a
              href={downloadUrl}
              download={`diretta-${viewerUsername}.webm`}
              className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] px-4 py-2.5 text-sm font-semibold text-[var(--foreground)]"
            >
              <Download size={16} />
              Scarica la tua diretta
            </a>
          ) : null}
        </div>

        {broadcast ? (
          <p className="text-sm text-[var(--gold)]">
            La tua diretta e visibile ora nel feed e nella sezione Live: <Link href={`/post/${broadcast.post.id}`} className="underline">apri post live</Link>
          </p>
        ) : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-[var(--foreground)]">Dirette in corso</h2>
          <span className="rounded-full border border-[rgba(255,88,62,0.2)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            {initialActive.length}
          </span>
        </div>
        <div className="space-y-3">
          {initialActive.length ? (
            initialActive.map((item) => (
              <div key={item.id} className="rounded-[24px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[var(--foreground)]">
                      {item.creator.profile?.displayName ?? item.creator.username}
                    </p>
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--muted)]">@{item.creator.username}</p>
                  </div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-[rgba(255,88,62,0.22)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--accent)]">
                    <Radio size={12} />
                    live
                  </span>
                </div>
                <p className="mt-3 text-sm text-[var(--foreground)]">{item.post.content}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href={`/post/${item.post.id}`} className="inline-flex rounded-2xl border border-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-semibold text-[var(--foreground)]">
                    Apri post live
                  </Link>
                  <Link href={`/profile/${item.creator.username}`} className="inline-flex rounded-2xl border border-[rgba(255,255,255,0.08)] px-4 py-2 text-sm font-semibold text-[var(--muted)]">
                    Profilo
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--muted)]">Nessuna diretta attiva al momento.</p>
          )}
        </div>
      </Card>

      <Card className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-2xl font-semibold text-[var(--foreground)]">Registrazioni recenti</h2>
          <span className="rounded-full border border-[rgba(255,255,255,0.08)] px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-[var(--muted)]">
            7 giorni
          </span>
        </div>
        <div className="space-y-4">
          {initialArchive.length ? (
            initialArchive.map((item) => (
              <div key={item.id} className="rounded-[24px] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-[var(--foreground)]">
                      {item.creator.profile?.displayName ?? item.creator.username}
                    </p>
                    <p className="truncate text-sm text-[var(--muted)]">{item.post.content}</p>
                  </div>
                  <Link href={`/post/${item.post.id}`} className="text-xs uppercase tracking-[0.14em] text-[var(--muted)] hover:text-[var(--foreground)]">
                    Apri post
                  </Link>
                </div>
                {item.recordingUrl ? (
                  <video src={item.recordingUrl} controls playsInline className="mt-3 h-[220px] w-full rounded-[20px] bg-black object-cover" />
                ) : null}
              </div>
            ))
          ) : (
            <p className="text-sm text-[var(--muted)]">Nessuna registrazione recente disponibile.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
