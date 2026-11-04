// Parse ID3v2 APIC or FLAC picture block from the first 256KB of an audio stream
export async function extractEmbeddedPictureFromStream(streamUrl: string): Promise<string | null> {
  if (!streamUrl || typeof window === 'undefined') {
    return null;
  }

  try {
    const response = await fetch(streamUrl, {
      headers: { Range: 'bytes=0-262143' },
    });

    if (!response.ok) {
      return null;
    }

    const buffer = await response.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    // Scan for PNG (89 50 4E 47 ... 49 45 4E 44) or JPEG (FF D8 FF ... FF D9)
    for (let i = 0; i < bytes.length - 16; i += 1) {
      // PNG check
      if (
        bytes[i] === 0x89 &&
        bytes[i + 1] === 0x50 &&
        bytes[i + 2] === 0x4e &&
        bytes[i + 3] === 0x47
      ) {
        for (let j = i + 8; j < bytes.length - 8; j += 1) {
          if (
            bytes[j] === 0x49 &&
            bytes[j + 1] === 0x45 &&
            bytes[j + 2] === 0x4e &&
            bytes[j + 3] === 0x44
          ) {
            const slice = bytes.slice(i, j + 8);
            return URL.createObjectURL(new Blob([slice], { type: 'image/png' }));
          }
        }
      }

      // JPEG check
      if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) {
        for (let j = i + 4; j < bytes.length - 2; j += 1) {
          if (bytes[j] === 0xff && bytes[j + 1] === 0xd9) {
            const slice = bytes.slice(i, j + 2);
            return URL.createObjectURL(new Blob([slice], { type: 'image/jpeg' }));
          }
        }
      }
    }
  } catch {
    return null;
  }

  return null;
}
