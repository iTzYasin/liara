function normalizedOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

export function isAllowedRequestOrigin(
  suppliedOrigin: string | null,
  applicationOrigin: string,
  configuredOrigins = process.env.ALLOWED_ORIGINS ?? "",
) {
  if (!suppliedOrigin) return true;
  const origin = normalizedOrigin(suppliedOrigin);
  if (!origin) return false;
  const allowed = new Set([
    normalizedOrigin(applicationOrigin),
    ...configuredOrigins.split(",").map((item) => normalizedOrigin(item.trim())).filter(Boolean),
  ]);
  return allowed.has(origin);
}

function lastForwardedValue(value: string | null) {
  return value?.split(",").map((item) => item.trim()).filter(Boolean).at(-1);
}

export function resolveApplicationOrigin(
  headers: Headers,
  fallbackProtocol: string,
  trustedProxyHops: number,
) {
  const forwardedHost = trustedProxyHops > 0
    ? lastForwardedValue(headers.get("x-forwarded-host"))
    : undefined;
  const forwardedProtocol = trustedProxyHops > 0
    ? lastForwardedValue(headers.get("x-forwarded-proto"))
    : undefined;
  const host = forwardedHost ?? headers.get("host");
  const protocol = forwardedProtocol ? `${forwardedProtocol.replace(/:$/, "")}:` : fallbackProtocol;
  return host ? `${protocol}//${host}` : "";
}
