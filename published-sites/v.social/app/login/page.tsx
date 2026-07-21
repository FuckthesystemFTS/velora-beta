import Link from "next/link";

import { AuthForm } from "@/components/forms/auth-form";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center px-4 py-8">
      <div className="grid w-full gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <section className="glass rounded-[30px] p-7 md:p-9">
          <div className="font-serif text-6xl font-semibold leading-none text-[var(--accent)]">V</div>
          <h1 className="mt-6 font-serif text-4xl font-semibold text-[var(--foreground)] md:text-6xl">Bentornato.</h1>
          <p className="mt-4 max-w-md text-base leading-8 text-[var(--muted)]">
            Rientra nel tuo spazio, ritrova persone, post e dirette che vuoi seguire.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Link href="/register" className="rounded-[22px] border border-[var(--border)] bg-black/20 px-4 py-4 text-sm font-semibold text-[var(--foreground)]">
              Crea account
            </Link>
            <Link href="/forgot-password" className="rounded-[22px] border border-[var(--border)] bg-black/20 px-4 py-4 text-sm font-semibold text-[var(--foreground)]">
              Recupera accesso
            </Link>
          </div>
        </section>

        <div className="space-y-5">
          <AuthForm mode="login" />
          <p className="text-sm text-[var(--muted)]">
            Non hai un account? <Link href="/register">Registrati</Link>
          </p>
          <p className="text-sm text-[var(--muted)]">
            Password dimenticata? <Link href="/forgot-password">Recupera accesso</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
