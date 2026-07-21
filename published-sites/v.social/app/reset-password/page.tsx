import { ResetPasswordForm } from "@/components/forms/reset-password-form";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4">
      <ResetPasswordForm token={token ?? ""} />
    </main>
  );
}
