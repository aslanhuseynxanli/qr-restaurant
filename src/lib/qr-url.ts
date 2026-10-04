export function publicOrigin(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    if (host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || host === "0.0.0.0" || host.startsWith("127.")) return null;
    return url.origin;
  } catch { return null; }
}
export function tableMenuPath(slug: string, token: string): string {
  return `/r/${encodeURIComponent(slug)}/t/${encodeURIComponent(token)}`;
}
