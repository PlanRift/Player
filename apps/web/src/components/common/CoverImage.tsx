import { useEffect, useState } from 'react';
import {
  albumCoverCache,
  FALLBACK_COVER_SVG,
  subsonicClient,
  extractEmbeddedPictureFromStream,
} from '@player/shared';

interface CoverImageProps {
  coverId?: string | null;
  songId?: string | null;
  alt?: string;
  className?: string;
  size?: number;
}

export function CoverImage({
  coverId,
  songId,
  alt = '',
  className = '',
  size = 300,
}: CoverImageProps) {
  const cacheKey = coverId || songId || 'fallback';
  const [src, setSrc] = useState<string>(() => {
    if (albumCoverCache.has(cacheKey)) {
      return albumCoverCache.get(cacheKey)!;
    }
    if (coverId) {
      return subsonicClient.getCoverArtUrl(coverId, size);
    }
    return FALLBACK_COVER_SVG;
  });

  const [hasAttemptedStream, setHasAttemptedStream] = useState(false);

  useEffect(() => {
    if (albumCoverCache.has(cacheKey)) {
      setSrc(albumCoverCache.get(cacheKey)!);
      return;
    }
    if (coverId) {
      setSrc(subsonicClient.getCoverArtUrl(coverId, size));
    } else {
      setSrc(FALLBACK_COVER_SVG);
    }
    setHasAttemptedStream(false);
  }, [coverId, songId, size, cacheKey]);

  const handleError = async () => {
    // Tier 3: Attempt embedded picture extraction from the stream
    if (!hasAttemptedStream && songId) {
      setHasAttemptedStream(true);
      const streamUrl = subsonicClient.getStreamUrl(songId);
      const extractedBlob = await extractEmbeddedPictureFromStream(streamUrl);
      if (extractedBlob) {
        albumCoverCache.set(cacheKey, extractedBlob);
        setSrc(extractedBlob);
        return;
      }
    }

    // Tier 4: SVG monochrome fallback
    if (src !== FALLBACK_COVER_SVG) {
      setSrc(FALLBACK_COVER_SVG);
    }
  };

  const handleLoad = () => {
    if (src && src !== FALLBACK_COVER_SVG) {
      albumCoverCache.set(cacheKey, src);
    }
  };

  return (
    <img
      src={src}
      alt={alt}
      onError={handleError}
      onLoad={handleLoad}
      className={`w-full h-full object-cover select-none ${className}`}
      loading="lazy"
    />
  );
}
