import { normalizeText } from "./normalization";

export function extractGoogleFormId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname !== "docs.google.com") {
    return null;
  }

  const match = parsed.pathname.match(/^\/forms\/d\/e\/([a-zA-Z0-9_-]+)(?:\/|$)/);
  return match?.[1] ?? null;
}

function hashString(value: string): string {
  let hash = 5381;
  for (const char of value) {
    hash = (hash * 33) ^ char.charCodeAt(0);
  }
  return (hash >>> 0).toString(36);
}

export function createFallbackFormKey(url: string, title: string, labels: string[]): string {
  const signature = [url, normalizeText(title), ...labels.slice(0, 5).map(normalizeText)].join("|");
  return `fallback_${hashString(signature)}`;
}

export function createFormKey(url: string, title: string, labels: string[]): string {
  return extractGoogleFormId(url) ?? createFallbackFormKey(url, title, labels);
}
