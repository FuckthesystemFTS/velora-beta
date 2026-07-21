"use client";

import { useState } from "react";
import { Camera, ImagePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type ProfileEditorProps = {
  displayName: string;
  bio: string | null;
  location: string | null;
  website: string | null;
  avatarUrl: string | null;
  avatarPublicId: string | null;
  coverUrl: string | null;
  coverPublicId: string | null;
};

type UploadedItem = {
  secureUrl: string;
  publicId: string;
};

export function ProfileEditor(props: ProfileEditorProps) {
  const [form, setForm] = useState({
    displayName: props.displayName,
    bio: props.bio ?? "",
    location: props.location ?? "",
    website: props.website ?? "",
    avatarUrl: props.avatarUrl ?? "",
    avatarPublicId: props.avatarPublicId ?? "",
    coverUrl: props.coverUrl ?? "",
    coverPublicId: props.coverPublicId ?? "",
  });
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function uploadSingle(file: File, field: "avatar" | "cover") {
    const formData = new FormData();
    formData.append("files", file);
    const response = await fetch("/api/upload", { method: "POST", body: formData });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error ?? "Upload non riuscito");
      return;
    }

    const uploaded = data.items?.[0] as UploadedItem | undefined;
    if (!uploaded) return;

    setForm((current) => ({
      ...current,
      ...(field === "avatar"
        ? { avatarUrl: uploaded.secureUrl, avatarPublicId: uploaded.publicId }
        : { coverUrl: uploaded.secureUrl, coverPublicId: uploaded.publicId }),
    }));
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Modifica profilo</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-2 text-sm text-[var(--muted)]">
          <span>Nome pubblico</span>
          <input
            value={form.displayName}
            onChange={(event) => setForm((current) => ({ ...current, displayName: event.target.value }))}
            className="h-11 w-full rounded-2xl border border-[var(--border)] bg-black/20 px-4 text-[var(--foreground)] outline-none"
          />
        </label>
        <label className="space-y-2 text-sm text-[var(--muted)]">
          <span>Localita</span>
          <input
            value={form.location}
            onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))}
            className="h-11 w-full rounded-2xl border border-[var(--border)] bg-black/20 px-4 text-[var(--foreground)] outline-none"
          />
        </label>
      </div>

      <label className="space-y-2 text-sm text-[var(--muted)]">
        <span>Bio</span>
        <textarea
          value={form.bio}
          onChange={(event) => setForm((current) => ({ ...current, bio: event.target.value }))}
          className="min-h-28 w-full rounded-3xl border border-[var(--border)] bg-black/20 px-4 py-3 text-[var(--foreground)] outline-none"
        />
      </label>

      <label className="space-y-2 text-sm text-[var(--muted)]">
        <span>Sito web</span>
        <input
          value={form.website}
          onChange={(event) => setForm((current) => ({ ...current, website: event.target.value }))}
          className="h-11 w-full rounded-2xl border border-[var(--border)] bg-black/20 px-4 text-[var(--foreground)] outline-none"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          <Camera size={16} />
          Avatar
          <input type="file" accept="image/*" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadSingle(file, "avatar");
          }} />
        </label>
        <label className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[var(--border)] bg-black/20 px-4 py-3 text-sm text-[var(--muted)] hover:text-[var(--foreground)]">
          <ImagePlus size={16} />
          Cover
          <input type="file" accept="image/*" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadSingle(file, "cover");
          }} />
        </label>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setError(null);
            setMessage(null);
            const response = await fetch("/api/me/profile", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(form),
            });
            const data = await response.json();
            setLoading(false);

            if (!response.ok) {
              setError(data.error ?? "Profilo non aggiornato");
              return;
            }

            setMessage("Profilo aggiornato.");
            window.location.reload();
          }}
        >
          {loading ? "Salvo..." : "Salva"}
        </Button>
      </div>

      {message ? <p className="text-sm text-[var(--gold)]">{message}</p> : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
    </Card>
  );
}
