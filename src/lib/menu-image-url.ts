export function isMenuImageUrl(value: string): boolean {
  if (!value) return true;
  if (value.length > 2048 || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !!url.hostname;
  } catch { return false; }
}
