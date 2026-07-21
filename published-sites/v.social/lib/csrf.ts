export async function verifyCsrfToken(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (!origin || !host) {
    return false;
  }

  try {
    const requestOrigin = new URL(origin);
    return requestOrigin.host === host;
  } catch {
    return false;
  }
}
