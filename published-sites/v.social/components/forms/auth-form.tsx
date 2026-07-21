"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function AuthForm({ mode, inviteCode }: { mode: "login" | "register"; inviteCode?: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validateRegister(payload: Record<string, unknown>) {
    const email = String(payload.email ?? "").trim();
    const username = String(payload.username ?? "").trim();
    const displayName = String(payload.displayName ?? "").trim();
    const password = String(payload.password ?? "");
    const acceptPolicies = payload.acceptPolicies === true;

    if (!displayName || displayName.length < 2) {
      return "Il nome visibile deve avere almeno 2 caratteri.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return "Inserisci un indirizzo email valido.";
    }
    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
      return "Lo username deve avere 3-24 caratteri e puo contenere solo lettere, numeri e underscore.";
    }
    if (password.length < 10 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      return "La password deve avere almeno 10 caratteri, una maiuscola, una minuscola e un numero.";
    }
    if (!acceptPolicies) {
      return "Devi accettare policy e regole prima di creare l'account.";
    }

    return null;
  }

  async function onSubmit(formData: FormData) {
    setLoading(true);
    setError(null);
    const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
    const payload: Record<string, unknown> = Object.fromEntries(formData.entries());
    if (mode === "register") {
      payload.acceptPolicies = payload.acceptPolicies === "true" || payload.acceptPolicies === "on";
      const validationError = validateRegister(payload);
      if (validationError) {
        setError(validationError);
        setLoading(false);
        return;
      }
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error ?? "Operazione non riuscita");
      setLoading(false);
      return;
    }

    router.push("/feed");
    router.refresh();
  }

  return (
    <Card className="max-w-md">
      <form
        action={async (formData) => {
          await onSubmit(formData);
        }}
        className="space-y-4"
      >
        {mode === "register" && <Input name="displayName" placeholder="Nome visibile" required />}
        <Input name={mode === "login" ? "identifier" : "email"} type={mode === "login" ? "text" : "email"} placeholder={mode === "login" ? "Email o username" : "Email"} required />
        {mode === "register" && <Input name="username" placeholder="Username" required />}
        <Input name="password" type="password" placeholder="Password" required />
        {mode === "register" ? (
          <div className="rounded-2xl border border-[rgba(255,255,255,0.06)] bg-black/10 px-4 py-3 text-sm leading-7 text-[var(--muted)]">
            <p>Username: 3-24 caratteri, lettere, numeri e underscore.</p>
            <p>Password: almeno 10 caratteri, una maiuscola, una minuscola e un numero.</p>
          </div>
        ) : null}
        {mode === "register" && inviteCode ? <input type="hidden" name="inviteCode" value={inviteCode} /> : null}
        {mode === "register" && (
          <label className="flex items-start gap-3 text-sm text-[var(--muted)]">
            <input name="acceptPolicies" type="checkbox" value="true" required className="mt-1" />
            Accetto Terms, Privacy, Cookie Policy, Community Rules, Moderation Rules e il sistema di controllo distribuito senza appello formale.
          </label>
        )}
        {error ? <p className="text-sm text-[var(--danger)]">{error}</p> : null}
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Invio..." : mode === "login" ? "Accedi" : "Crea account"}
        </Button>
      </form>
    </Card>
  );
}
