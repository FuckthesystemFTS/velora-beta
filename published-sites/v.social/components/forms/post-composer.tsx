/* eslint-disable @next/next/no-img-element */
"use client";

import { useRouter } from "next/navigation";
import { ImagePlus, Video, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type UploadedMedia = {
  secureUrl: string;
  publicId: string;
  resourceType: "IMAGE" | "VIDEO";
  format: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
  bytes: number | null;
  fingerprint: string;
};

type PendingUpload = {
  id: string;
  previewUrl: string;
  resourceType: "IMAGE" | "VIDEO";
  name: string;
};

export function PostComposer() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadedMedia[]>([]);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);

  async function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);

    const fileList = Array.from(files);
    const pending = fileList.map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      previewUrl: URL.createObjectURL(file),
      resourceType: file.type.startsWith("video/") ? ("VIDEO" as const) : ("IMAGE" as const),
      name: file.name,
    }));
    setPendingUploads((current) => current.concat(pending));
    setUploading(true);

    const formData = new FormData();
    fileList.forEach((file) => formData.append("files", file));

    try {
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error ?? "Upload fallito");
        return;
      }

      setUploads((current) => current.concat(data.items));
    } finally {
      pending.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPendingUploads((current) => current.filter((item) => !pending.some((entry) => entry.id === item.id)));
      setUploading(false);
    }
  }

  async function submit(formData: FormData) {
    setLoading(true);
    setError(null);

    const response = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: formData.get("content"),
        visibility: formData.get("visibility"),
        media: uploads,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Pubblicazione non riuscita");
      setLoading(false);
      return;
    }

    setUploads([]);
    setLoading(false);
    router.refresh();
  }

  return (
    <Card className="space-y-4 p-4 md:p-5">
      <form
        action={async (formData) => {
          await submit(formData);
        }}
        className="space-y-4"
      >
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(213,49,39,0.18))]" />
          <div>
            <p className="text-sm font-semibold text-[var(--foreground)]">Nuovo post</p>
          </div>
        </div>

        <Textarea
          name="content"
          placeholder="A cosa stai pensando?"
          className="min-h-28 border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)]"
        />

        {uploads.length || pendingUploads.length ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {pendingUploads.map((item) => (
              <div
                key={item.id}
                className="overflow-hidden rounded-[20px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)]"
              >
                <div className="relative">
                  {item.resourceType === "IMAGE" ? (
                    <img src={item.previewUrl} alt="" className="h-40 w-full object-cover opacity-45 blur-[1px]" />
                  ) : (
                    <video src={item.previewUrl} muted className="h-40 w-full object-cover opacity-45 blur-[1px]" />
                  )}
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[rgba(6,6,8,0.56)]">
                    <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[rgba(255,88,62,0.28)] bg-[radial-gradient(circle_at_top,rgba(213,49,39,0.28),rgba(12,12,16,0.92))]">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[rgba(255,255,255,0.2)] border-t-[var(--accent)] animate-spin" />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-semibold text-[var(--foreground)]">Caricamento in corso</p>
                      <p className="mt-1 max-w-[180px] truncate text-xs uppercase tracking-[0.12em] text-[var(--muted)]">
                        {item.name}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
            {uploads.map((item) => (
              <div key={item.publicId} className="overflow-hidden rounded-[20px] border border-[rgba(255,255,255,0.05)] bg-[rgba(255,255,255,0.02)]">
                <div className="relative">
                  {item.resourceType === "IMAGE" ? (
                    <img src={item.secureUrl} alt="" className="h-40 w-full object-cover" loading="lazy" />
                  ) : (
                    <video src={item.secureUrl} controls className="h-40 w-full object-cover" />
                  )}
                  <button
                    type="button"
                    className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/70 text-white"
                    onClick={() => setUploads((current) => current.filter((media) => media.publicId !== item.publicId))}
                  >
                    <X size={14} />
                  </button>
                </div>
                <div className="px-3 py-2 text-[11px] uppercase tracking-[0.14em] text-[var(--muted)]">
                  {item.resourceType === "IMAGE" ? "Immagine" : "Video"}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <select
              name="visibility"
              className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-2.5 text-base md:text-sm"
              defaultValue="PUBLIC"
            >
              <option value="PUBLIC">Pubblico</option>
              <option value="FOLLOWERS_ONLY">Solo follower</option>
              <option value="PRIVATE">Privato</option>
            </select>

            <label className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-2.5 text-sm text-[var(--muted)] hover:border-[rgba(255,88,62,0.2)] hover:text-[var(--foreground)]">
              <ImagePlus size={16} />
              Immagine
              <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => void handleFiles(event.target.files)} />
            </label>

            <label className="inline-flex items-center gap-2 rounded-2xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] px-4 py-2.5 text-sm text-[var(--muted)] hover:border-[rgba(255,88,62,0.2)] hover:text-[var(--foreground)]">
              <Video size={16} />
              Video
              <input type="file" accept="video/*" className="hidden" onChange={(event) => void handleFiles(event.target.files)} />
            </label>
          </div>

          <Button type="submit" disabled={loading || uploading} className="min-w-[120px]">
            {uploading ? "Carico..." : loading ? "Pubblico..." : "Pubblica"}
          </Button>
        </div>

        {uploading ? <p className="text-sm text-[var(--gold)]">Attendi la fine del caricamento prima di pubblicare.</p> : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      </form>
    </Card>
  );
}
