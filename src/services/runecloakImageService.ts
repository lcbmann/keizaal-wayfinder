import { normalizeRunecloakImageUrl } from "./runecloakService.js";

// Album IDs are not image IDs. Preserve the submitted album, but use its cover
// for the Discord preview. Only fetch canonical Imgur pages, never arbitrary URLs.
export function runecloakImgurAlbumUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (!["imgur.com", "www.imgur.com", "m.imgur.com"].includes(url.hostname)) return null;
    const match = /^\/(a|gallery)\/([a-zA-Z0-9]+)\/?$/u.exec(url.pathname);
    return match ? `https://imgur.com/${match[1]}/${match[2]}` : null;
  } catch {
    return null;
  }
}

export function runecloakAlbumCover(html: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    const attributes = new Map([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gu)]
      .map((match) => [match[1]!.toLowerCase(), match[3]!]));
    if (attributes.get("property") !== "og:image") continue;
    const content = attributes.get("content");
    if (!content) continue;
    try {
      const url = new URL(content.replace(/&amp;/gu, "&"));
      if (url.protocol !== "https:" || url.hostname !== "i.imgur.com" || url.port || url.username || url.password) continue;
      if (!/^\/[a-zA-Z0-9]+\.(?:jpe?g|png|gif|webp)$/iu.test(url.pathname)) continue;
      return `https://i.imgur.com${url.pathname}`;
    } catch {
      continue;
    }
  }
  return null;
}

export async function resolveRunecloakImageUrl(value: string, fetchPage: typeof fetch = fetch): Promise<string | null> {
  const albumUrl = runecloakImgurAlbumUrl(value);
  if (!albumUrl) return normalizeRunecloakImageUrl(value);
  try {
    const response = await fetchPage(albumUrl, { redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok || !response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        size += chunk.byteLength;
        if (size > 256 * 1024) return null;
        chunks.push(chunk);
      }
    } finally {
      await reader.cancel();
    }
    return runecloakAlbumCover(Buffer.concat(chunks).toString("utf8"));
  } catch {
    // An unavailable image host must not prevent admission. The post retains
    // the original clickable album link and startup can retry the preview.
    return null;
  }
}
