import { extractEmbeddedPictureFromStream } from './extractor';

export const FALLBACK_COVER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
    '<rect width="300" height="300" fill="#0e0e11"/>' +
    '<circle cx="150" cy="150" r="88" fill="none" stroke="#3f3f46" stroke-width="4"/>' +
    '<circle cx="150" cy="150" r="24" fill="none" stroke="#34d399" stroke-width="4"/>' +
    '<circle cx="150" cy="150" r="6" fill="#34d399"/>' +
    '</svg>'
)}`;

export const albumCoverCache = new Map<string, string>();

/**
 * Resolves cover art using the 4-tier fallback chain:
 * 1. Memory cache
 * 2. Primary Subsonic coverArt URL
 * 3. Embedded picture extraction (ID3v2 APIC / FLAC block from stream range 0-256KB)
 * 4. SVG monochrome vinyl placeholder
 */
export async function resolveCoverArt(
  coverIdOrUrl: string | null | undefined,
  streamUrl?: string | null
): Promise<string> {
  if (!coverIdOrUrl && !streamUrl) {
    return FALLBACK_COVER_SVG;
  }

  const cacheKey = coverIdOrUrl || streamUrl!;
  if (albumCoverCache.has(cacheKey)) {
    return albumCoverCache.get(cacheKey)!;
  }

  // If a full URL is provided, return it; caller can fallback on img error
  if (coverIdOrUrl && (coverIdOrUrl.startsWith('http') || coverIdOrUrl.startsWith('blob:') || coverIdOrUrl.startsWith('data:'))) {
    return coverIdOrUrl;
  }

  // Try extracting from stream if streamUrl is present
  if (streamUrl) {
    try {
      const extracted = await extractEmbeddedPictureFromStream(streamUrl);
      if (extracted) {
        albumCoverCache.set(cacheKey, extracted);
        return extracted;
      }
    } catch {
      // Fallback
    }
  }

  return FALLBACK_COVER_SVG;
}
