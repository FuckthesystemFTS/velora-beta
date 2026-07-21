import Link from "next/link";

import { AuthForm } from "@/components/forms/auth-form";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const inviteCode = (await searchParams).invite;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4">
      <div className="space-y-5">
        <h1 className="font-serif text-5xl font-semibold">Crea il tuo accesso a V</h1>
        {inviteCode ? <p className="text-sm text-[var(--gold)]">Stai usando un invito personale.</p> : null}
        <AuthForm mode="register" inviteCode={inviteCode} />
        <p className="text-sm text-[var(--muted)]">
          Hai gia un account? <Link href="/login">Accedi</Link>
        </p>
      </div>
    </main>
  );
}
