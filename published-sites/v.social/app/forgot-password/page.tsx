"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(formData: FormData) {
    setLoading(true);
    setError(null);
    setMessage(null);
    const identifier = String(formData.get("identifier") ?? "");
    const response = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Errore");
      setLoading(false);
      return;
    }
    setMessage(data.message);
    setLoading(false);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4">
      <Card className="w-full max-w-md space-y-4">
        <h1 className="font-serif text-4xl font-semibold">Reset password</h1>
        <form action={submit} className="space-y-4">
          <Input name="identifier" placeholder="Email o username" required />
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Invio..." : "Invia link"}
          </Button>
        </form>
        {message ? <p className="text-sm text-[var(--gold)]">{message}</p> : null}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <p className="text-sm text-[var(--muted)]">
          Torna a <Link href="/login">login</Link>
        </p>
      </Card>
    </main>
  );
}
