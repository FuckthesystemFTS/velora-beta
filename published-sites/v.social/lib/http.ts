import { env } from "@/lib/env";

export function verifySameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return new URL(origin).origin === new URL(env.APP_URL).origin;
}

export function getRequestIp(request: Request) {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "127.0.0.1"
  );
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
