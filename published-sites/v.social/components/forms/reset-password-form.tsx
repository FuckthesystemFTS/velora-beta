"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function ResetPasswordForm({ token }: { token: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(formData: FormData) {
    setLoading(true);
    setError(null);
    setMessage(null);
    const newPassword = String(formData.get("newPassword") ?? "");
    const response = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, newPassword }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Errore");
      setLoading(false);
      return;
    }
    setMessage("Password aggiornata. Ora puoi fare login.");
    setLoading(false);
  }

  return (
    <Card className="w-full max-w-md space-y-4">
      <h1 className="font-serif text-4xl font-semibold">Nuova password</h1>
      <form action={submit} className="space-y-4">
        <Input name="newPassword" type="password" placeholder="Nuova password" required />
        <Button type="submit" className="w-full" disabled={!token || loading}>
          {loading ? "Aggiorno..." : "Aggiorna password"}
        </Button>
      </form>
      {!token ? <p className="text-sm text-[var(--danger)]">Token mancante o invalido.</p> : null}
      {message ? <p className="text-sm text-[var(--gold)]">{message}</p> : null}
      {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
      <p className="text-sm text-[var(--muted)]">
        Torna a <Link href="/login">login</Link>
      </p>
    </Card>
  );
}
