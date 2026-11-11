// audio-tagger.js - Audio Metadata & Embedded Cover Art Reader/Writer + JP-Focused Online Auto-Tagger
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Gracefully resolve ffmpeg-static if present in node_modules, without crashing startup if npm install was pending
let ffmpegStatic = null;
try {
  const mod = await import('ffmpeg-static');
  ffmpegStatic = mod.default || mod;
} catch (_) {
  // ffmpeg-static not yet installed in node_modules; getFfmpegBinaryPath will fall back to system 'ffmpeg'
}

/**
 * Resolve the path to the ffmpeg executable:
 * 1. Explicit FFMPEG_PATH environment variable (if provided)
 * 2. Bundled binary from npm package 'ffmpeg-static'
 * 3. System 'ffmpeg' binary in PATH as last resort
 */
export function getFfmpegBinaryPath() {
  if (process.env.FFMPEG_PATH) {
    if (fsSync.existsSync(process.env.FFMPEG_PATH)) {
      return process.env.FFMPEG_PATH;
    }
    return process.env.FFMPEG_PATH;
  }
  if (ffmpegStatic && fsSync.existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  return 'ffmpeg';
}

export const AUDIO_EXTENSIONS = new Set([
  '.mp3',
  '.flac',
  '.m4a',
  '.mp4',
  '.ogg',
  '.opus',
  '.wav',
  '.aac',
  '.aiff',
]);

export function isAudioFileName(fileName) {
  if (!fileName || typeof fileName !== 'string') return false;
  const ext = path.extname(fileName).toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

/**
 * Inspect image buffer magic bytes to determine MIME type and dimensions.
 */
export function detectImageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) {
    throw new Error('Invalid or empty image buffer');
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    let width = 0;
    let height = 0;
    if (buffer.length >= 24) {
      width = buffer.readUInt32BE(16);
      height = buffer.readUInt32BE(20);
    }
    return { mime: 'image/png', ext: '.png', width, height };
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    let width = 0;
    let height = 0;
    // Scan JPEG markers for SOF0..SOF3 to extract width/height
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === 0xff) {
        offset++;
        continue;
      }
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const segLen = buffer.readUInt16BE(offset + 2);
      if (segLen < 2 || offset + 2 + segLen > buffer.length) break;
      if (
        marker === 0xc0 ||
        marker === 0xc1 ||
        marker === 0xc2 ||
        marker === 0xc3
      ) {
        height = buffer.readUInt16BE(offset + 5);
        width = buffer.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + segLen;
    }
    return { mime: 'image/jpeg', ext: '.jpg', width, height };
  }

  // WebP: RIFF....WEBP
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', ext: '.webp', width: 0, height: 0 };
  }

  throw new Error('Unsupported image format. Please provide a valid JPEG, PNG, or WebP image.');
}

// ============================================================================
// 1. NATIVE MP3 (ID3v2.3 / ID3v2.4) TAG & COVER ART READER / WRITER
// ============================================================================

function decodeSynchsafeInt(buf, offset = 0) {
  return (
    ((buf[offset] & 0x7f) << 21) |
    ((buf[offset + 1] & 0x7f) << 14) |
    ((buf[offset + 2] & 0x7f) << 7) |
    (buf[offset + 3] & 0x7f)
  );
}

function encodeSynchsafeInt(value) {
  const out = Buffer.alloc(4);
  out[0] = (value >>> 21) & 0x7f;
  out[1] = (value >>> 14) & 0x7f;
  out[2] = (value >>> 7) & 0x7f;
  out[3] = value & 0x7f;
  return out;
}

function decodeId3TextPayload(payload) {
  if (!payload || payload.length === 0) return '';
  const encoding = payload[0];
  const raw = payload.subarray(1);
  if (raw.length === 0) return '';

  let str = '';
  if (encoding === 0x00) {
    // ISO-8859-1
    str = raw.toString('latin1');
  } else if (encoding === 0x01) {
    // UTF-16 with BOM
    if (raw.length >= 2 && raw[0] === 0xfe && raw[1] === 0xff) {
      // UTF-16BE: swap bytes for UTF-16LE decoding
      const swapped = Buffer.alloc(raw.length - 2);
      for (let i = 2; i + 1 < raw.length; i += 2) {
        swapped[i - 2] = raw[i + 1];
        swapped[i - 1] = raw[i];
      }
      str = swapped.toString('utf16le');
    } else if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
      str = raw.subarray(2).toString('utf16le');
    } else {
      str = raw.toString('utf16le');
    }
  } else if (encoding === 0x02) {
    // UTF-16BE without BOM
    const swapped = Buffer.alloc(raw.length - (raw.length % 2));
    for (let i = 0; i + 1 < raw.length; i += 2) {
      swapped[i] = raw[i + 1];
      swapped[i + 1] = raw[i];
    }
    str = swapped.toString('utf16le');
  } else {
    // 0x03: UTF-8
    str = raw.toString('utf8');
  }

  return str.replace(/\0+$/g, '').trim();
}

function encodeId3TextPayload(text) {
  // Encode as ID3v2.3 UTF-16 with Little-Endian BOM (0x01 FF FE ...) for universal Kanji/Romaji compatibility
  const clean = String(text ?? '').normalize('NFC');
  const strBuf = Buffer.from(clean, 'utf16le');
  return Buffer.concat([Buffer.from([0x01, 0xff, 0xfe]), strBuf]);
}

function parseApicPayload(payload) {
  if (!payload || payload.length < 6) return null;
  const encoding = payload[0];
  let pos = 1;
  // Read null-terminated ASCII MIME string
  const mimeEnd = payload.indexOf(0x00, pos);
  if (mimeEnd === -1) return null;
  const mime = payload.subarray(pos, mimeEnd).toString('ascii') || 'image/jpeg';
  pos = mimeEnd + 1;
  if (pos >= payload.length) return null;

  const picType = payload[pos];
  pos += 1;

  // Skip null-terminated description (1-byte null for Latin1/UTF8, 2-byte null for UTF16)
  if (encoding === 0x01 || encoding === 0x02) {
    while (pos + 1 < payload.length) {
      if (payload[pos] === 0x00 && payload[pos + 1] === 0x00) {
        pos += 2;
        break;
      }
      pos += 2;
    }
  } else {
    const descEnd = payload.indexOf(0x00, pos);
    if (descEnd === -1) return null;
    pos = descEnd + 1;
  }

  if (pos >= payload.length) return null;
  const imageBuffer = payload.subarray(pos);
  return { mime, picType, imageBuffer };
}

function encodeApicPayload(imageBuffer, mime = 'image/jpeg') {
  const mimeBuf = Buffer.from(mime, 'ascii');
  // [0x00 (ISO-8859-1), mime, 0x00, 0x03 (Cover front), 0x00 (empty description), imageBuffer]
  return Buffer.concat([
    Buffer.from([0x00]),
    mimeBuf,
    Buffer.from([0x00, 0x03, 0x00]),
    imageBuffer,
  ]);
}

function parseMp3Id3v2(fileBuf) {
  const result = {
    hasId3v2: false,
    version: 3,
    audioOffset: 0,
    frames: [],
    tags: {
      title: '',
      artist: '',
      album: '',
      year: '',
      trackNumber: '',
      coverBuffer: null,
      coverMime: '',
    },
  };

  if (
    fileBuf.length >= 10 &&
    fileBuf[0] === 0x49 && // 'I'
    fileBuf[1] === 0x44 && // 'D'
    fileBuf[2] === 0x33 // '3'
  ) {
    const ver = fileBuf[3];
    const flags = fileBuf[5];
    const tagSize = decodeSynchsafeInt(fileBuf, 6);
    const totalHeaderTagSize = Math.min(fileBuf.length, 10 + tagSize);

    result.hasId3v2 = true;
    result.version = ver;
    result.audioOffset = totalHeaderTagSize;

    // Only parse standard v2.3 / v2.4 frames (skip unsynchronisation if set, or handle extended header)
    let offset = 10;
    const hasExtendedHeader = (flags & 0x40) !== 0;
    if (hasExtendedHeader && offset + 4 <= totalHeaderTagSize) {
      const extSize =
        ver === 4
          ? decodeSynchsafeInt(fileBuf, offset)
          : fileBuf.readUInt32BE(offset);
      offset += ver === 4 ? extSize : 4 + extSize;
    }

    while (offset + 10 <= totalHeaderTagSize) {
      const frameId = fileBuf.subarray(offset, offset + 4).toString('ascii');
      if (!/^[A-Z0-9]{4}$/.test(frameId)) {
        break; // Reached padding
      }
      const frameSize =
        ver === 4
          ? decodeSynchsafeInt(fileBuf, offset + 4)
          : fileBuf.readUInt32BE(offset + 4);
      const frameFlags = fileBuf.subarray(offset + 8, offset + 10);

      if (frameSize <= 0 || offset + 10 + frameSize > totalHeaderTagSize) {
        break;
      }

      const payload = fileBuf.subarray(offset + 10, offset + 10 + frameSize);
      result.frames.push({ id: frameId, flags: frameFlags, payload });

      if (frameId === 'TIT2' && !result.tags.title) {
        result.tags.title = decodeId3TextPayload(payload);
      } else if (frameId === 'TPE1' && !result.tags.artist) {
        result.tags.artist = decodeId3TextPayload(payload);
      } else if (frameId === 'TALB' && !result.tags.album) {
        result.tags.album = decodeId3TextPayload(payload);
      } else if ((frameId === 'TYER' || frameId === 'TDRC') && !result.tags.year) {
        result.tags.year = decodeId3TextPayload(payload).slice(0, 4);
      } else if (frameId === 'TRCK' && !result.tags.trackNumber) {
        result.tags.trackNumber = decodeId3TextPayload(payload);
      } else if (frameId === 'APIC') {
        const apic = parseApicPayload(payload);
        if (apic && apic.imageBuffer?.length > 0) {
          if (!result.tags.coverBuffer || apic.picType === 3) {
            result.tags.coverBuffer = apic.imageBuffer;
            result.tags.coverMime = apic.mime;
          }
        }
      }

      offset += 10 + frameSize;
    }
  }

  return result;
}

function buildMp3WithUpdatedId3v2(fileBuf, updates) {
  const parsed = parseMp3Id3v2(fileBuf);
  const audioData = fileBuf.subarray(parsed.audioOffset);

  const replacedFrameIds = new Set();
  if (updates.title !== undefined) replacedFrameIds.add('TIT2');
  if (updates.artist !== undefined) replacedFrameIds.add('TPE1');
  if (updates.album !== undefined) replacedFrameIds.add('TALB');
  if (updates.year !== undefined) {
    replacedFrameIds.add('TYER');
    replacedFrameIds.add('TDRC');
  }
  if (updates.coverBuffer) {
    replacedFrameIds.add('APIC');
  }

  // Keep existing frames that are not being replaced (only if we parsed v2.3/v2.4 cleanly)
  const keptFrames =
    parsed.version === 3 || parsed.version === 4
      ? parsed.frames.filter((f) => !replacedFrameIds.has(f.id))
      : [];

  const newFrames = [];
  const pushTextFrame = (id, val) => {
    const clean = String(val ?? '').trim();
    if (!clean) return;
    newFrames.push({
      id,
      flags: Buffer.from([0x00, 0x00]),
      payload: encodeId3TextPayload(clean),
    });
  };

  if (updates.title !== undefined) pushTextFrame('TIT2', updates.title);
  if (updates.artist !== undefined) pushTextFrame('TPE1', updates.artist);
  if (updates.album !== undefined) pushTextFrame('TALB', updates.album);
  if (updates.year !== undefined) {
    const yr = String(updates.year ?? '').trim();
    if (yr) {
      pushTextFrame('TYER', yr);
      pushTextFrame('TDRC', yr);
    }
  }
  if (updates.coverBuffer) {
    newFrames.push({
      id: 'APIC',
      flags: Buffer.from([0x00, 0x00]),
      payload: encodeApicPayload(updates.coverBuffer, updates.coverMime || 'image/jpeg'),
    });
  }

  const allFrames = [...newFrames, ...keptFrames];

  // Serialize as ID3v2.3 (most universally compatible across Windows, macOS, Navidrome, and ffmpeg)
  const frameBuffers = allFrames.map((f) => {
    const header = Buffer.alloc(10);
    header.write(f.id, 0, 4, 'ascii');
    header.writeUInt32BE(f.payload.length, 4);
    header[8] = 0x00;
    header[9] = 0x00;
    return Buffer.concat([header, f.payload]);
  });

  const padding = Buffer.alloc(1024, 0x00);
  const bodyBuf = Buffer.concat([...frameBuffers, padding]);

  const id3Header = Buffer.alloc(10);
  id3Header.write('ID3', 0, 3, 'ascii');
  id3Header[3] = 0x03; // ID3v2.3.0
  id3Header[4] = 0x00;
  id3Header[5] = 0x00; // No unsynchronisation or extended header
  encodeSynchsafeInt(bodyBuf.length).copy(id3Header, 6);

  return Buffer.concat([id3Header, bodyBuf, audioData]);
}

// ============================================================================
// 2. NATIVE FLAC (VORBIS_COMMENT + METADATA_BLOCK_PICTURE) READER / WRITER
// ============================================================================

function parseVorbisCommentBlock(payload) {
  const comments = [];
  let vendor = 'PlenripAudio';
  const tags = {
    title: '',
    artist: '',
    album: '',
    year: '',
    trackNumber: '',
  };

  if (!payload || payload.length < 8) return { vendor, comments, tags };
  let offset = 0;
  const vendorLen = payload.readUInt32LE(offset);
  offset += 4;
  if (offset + vendorLen > payload.length) return { vendor, comments, tags };
  vendor = payload.subarray(offset, offset + vendorLen).toString('utf8');
  offset += vendorLen;

  if (offset + 4 > payload.length) return { vendor, comments, tags };
  const count = payload.readUInt32LE(offset);
  offset += 4;

  for (let i = 0; i < count && offset + 4 <= payload.length; i++) {
    const len = payload.readUInt32LE(offset);
    offset += 4;
    if (offset + len > payload.length) break;
    const rawStr = payload.subarray(offset, offset + len).toString('utf8');
    offset += len;
    const eqIdx = rawStr.indexOf('=');
    if (eqIdx > 0) {
      const key = rawStr.slice(0, eqIdx).toUpperCase();
      const val = rawStr.slice(eqIdx + 1);
      comments.push({ key, val });
      if (key === 'TITLE' && !tags.title) tags.title = val;
      else if (key === 'ARTIST' && !tags.artist) tags.artist = val;
      else if (key === 'ALBUM' && !tags.album) tags.album = val;
      else if ((key === 'DATE' || key === 'YEAR') && !tags.year) tags.year = val.slice(0, 4);
      else if (key === 'TRACKNUMBER' && !tags.trackNumber) tags.trackNumber = val;
      else if ((key === 'METADATA_BLOCK_PICTURE' || key === 'COVERART') && !tags.coverBuffer) {
        try {
          const picBuf = Buffer.from(val, 'base64');
          if (key === 'METADATA_BLOCK_PICTURE') {
            const pic = parseFlacPictureBlock(picBuf);
            if (pic && pic.imageBuffer?.length > 0) {
              tags.coverBuffer = pic.imageBuffer;
              tags.coverMime = pic.mime || 'image/jpeg';
            }
          } else {
            tags.coverBuffer = picBuf;
            tags.coverMime = 'image/jpeg';
          }
        } catch (_) {}
      }
    }
  }

  return { vendor, comments, tags };
}

function encodeVorbisCommentBlock(vendor, comments) {
  const vendorBuf = Buffer.from(vendor || 'PlenripAudio', 'utf8');
  const vendorLenBuf = Buffer.alloc(4);
  vendorLenBuf.writeUInt32LE(vendorBuf.length, 0);

  const commentBufs = [];
  for (const c of comments) {
    const strBuf = Buffer.from(`${c.key}=${c.val}`, 'utf8');
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32LE(strBuf.length, 0);
    commentBufs.push(lenBuf, strBuf);
  }

  const countBuf = Buffer.alloc(4);
  countBuf.writeUInt32LE(comments.length, 0);

  return Buffer.concat([vendorLenBuf, vendorBuf, countBuf, ...commentBufs]);
}

function parseFlacPictureBlock(payload) {
  if (!payload || payload.length < 32) return null;
  let offset = 0;
  const picType = payload.readUInt32BE(offset);
  offset += 4;

  const mimeLen = payload.readUInt32BE(offset);
  offset += 4;
  if (offset + mimeLen > payload.length) return null;
  const mime = payload.subarray(offset, offset + mimeLen).toString('ascii') || 'image/jpeg';
  offset += mimeLen;

  if (offset + 4 > payload.length) return null;
  const descLen = payload.readUInt32BE(offset);
  offset += 4 + descLen;

  // Skip width (4), height (4), depth (4), colors (4) = 16 bytes
  offset += 16;
  if (offset + 4 > payload.length) return null;

  const dataLen = payload.readUInt32BE(offset);
  offset += 4;
  if (offset + dataLen > payload.length) return null;

  const imageBuffer = payload.subarray(offset, offset + dataLen);
  return { picType, mime, imageBuffer };
}

function encodeFlacPictureBlock(imageBuffer, mime = 'image/jpeg', width = 0, height = 0) {
  const mimeBuf = Buffer.from(mime, 'ascii');
  const descBuf = Buffer.alloc(0);

  const header = Buffer.alloc(32 + mimeBuf.length + descBuf.length);
  let offset = 0;
  header.writeUInt32BE(3, offset); // 3 = Cover (front)
  offset += 4;
  header.writeUInt32BE(mimeBuf.length, offset);
  offset += 4;
  mimeBuf.copy(header, offset);
  offset += mimeBuf.length;
  header.writeUInt32BE(descBuf.length, offset);
  offset += 4;
  header.writeUInt32BE(width || 0, offset);
  offset += 4;
  header.writeUInt32BE(height || 0, offset);
  offset += 4;
  header.writeUInt32BE(24, offset); // color depth
  offset += 4;
  header.writeUInt32BE(0, offset); // indexed colors
  offset += 4;
  header.writeUInt32BE(imageBuffer.length, offset);

  return Buffer.concat([header, imageBuffer]);
}

function parseFlacFile(fileBuf) {
  if (fileBuf.length < 8 || fileBuf.subarray(0, 4).toString('ascii') !== 'fLaC') {
    throw new Error('Not a valid FLAC file (missing fLaC header)');
  }

  const blocks = [];
  const tags = {
    title: '',
    artist: '',
    album: '',
    year: '',
    trackNumber: '',
    coverBuffer: null,
    coverMime: '',
  };

  let offset = 4;
  while (offset + 4 <= fileBuf.length) {
    const byte0 = fileBuf[offset];
    const isLast = (byte0 & 0x80) !== 0;
    const blockType = byte0 & 0x7f;
    const blockLen =
      (fileBuf[offset + 1] << 16) |
      (fileBuf[offset + 2] << 8) |
      fileBuf[offset + 3];

    offset += 4;
    if (offset + blockLen > fileBuf.length) {
      throw new Error('Corrupt FLAC metadata block');
    }

    const payload = fileBuf.subarray(offset, offset + blockLen);
    blocks.push({ blockType, payload });

    if (blockType === 4) {
      const vc = parseVorbisCommentBlock(payload);
      tags.title = vc.tags.title || tags.title;
      tags.artist = vc.tags.artist || tags.artist;
      tags.album = vc.tags.album || tags.album;
      tags.year = vc.tags.year || tags.year;
      tags.trackNumber = vc.tags.trackNumber || tags.trackNumber;
    } else if (blockType === 6) {
      const pic = parseFlacPictureBlock(payload);
      if (pic && pic.imageBuffer?.length > 0) {
        if (!tags.coverBuffer || pic.picType === 3) {
          tags.coverBuffer = pic.imageBuffer;
          tags.coverMime = pic.mime;
        }
      }
    }

    offset += blockLen;
    if (isLast) break;
  }

  return { blocks, audioOffset: offset, tags };
}

function buildFlacWithUpdatedTags(fileBuf, updates) {
  const parsed = parseFlacFile(fileBuf);
  const audioData = fileBuf.subarray(parsed.audioOffset);

  const hasTextUpdates =
    updates.title !== undefined ||
    updates.artist !== undefined ||
    updates.album !== undefined ||
    updates.year !== undefined;

  let vorbisUpdated = false;
  const outputBlocks = [];

  for (const blk of parsed.blocks) {
    // Skip padding blocks (type 1) so we can add a clean padding block if needed
    if (blk.blockType === 1) continue;

    if (blk.blockType === 4) {
      vorbisUpdated = true;
      if (hasTextUpdates) {
        const vc = parseVorbisCommentBlock(blk.payload);
        const keysToReplace = new Set();
        if (updates.title !== undefined) keysToReplace.add('TITLE');
        if (updates.artist !== undefined) keysToReplace.add('ARTIST');
        if (updates.album !== undefined) keysToReplace.add('ALBUM');
        if (updates.year !== undefined) {
          keysToReplace.add('DATE');
          keysToReplace.add('YEAR');
        }

        const filtered = vc.comments.filter((c) => !keysToReplace.has(c.key));
        const pushTag = (key, val) => {
          const clean = String(val ?? '').normalize('NFC').trim();
          if (clean) filtered.push({ key, val: clean });
        };

        if (updates.title !== undefined) pushTag('TITLE', updates.title);
        if (updates.artist !== undefined) pushTag('ARTIST', updates.artist);
        if (updates.album !== undefined) pushTag('ALBUM', updates.album);
        if (updates.year !== undefined) {
          pushTag('DATE', updates.year);
          pushTag('YEAR', updates.year);
        }

        outputBlocks.push({
          blockType: 4,
          payload: encodeVorbisCommentBlock(vc.vendor, filtered),
        });
      } else {
        outputBlocks.push(blk);
      }
      continue;
    }

    if (blk.blockType === 6 && updates.coverBuffer) {
      // Remove existing front cover (type 3) or all picture blocks when replacing cover
      const pic = parseFlacPictureBlock(blk.payload);
      if (!pic || pic.picType === 3 || pic.picType === 0) {
        continue;
      }
    }

    outputBlocks.push(blk);
  }

  if (!vorbisUpdated && hasTextUpdates) {
    const newComments = [];
    const pushTag = (key, val) => {
      const clean = String(val ?? '').normalize('NFC').trim();
      if (clean) newComments.push({ key, val: clean });
    };
    if (updates.title !== undefined) pushTag('TITLE', updates.title);
    if (updates.artist !== undefined) pushTag('ARTIST', updates.artist);
    if (updates.album !== undefined) pushTag('ALBUM', updates.album);
    if (updates.year !== undefined) {
      pushTag('DATE', updates.year);
      pushTag('YEAR', updates.year);
    }
    outputBlocks.push({
      blockType: 4,
      payload: encodeVorbisCommentBlock('PlenripAudio', newComments),
    });
  }

  if (updates.coverBuffer) {
    const picPayload = encodeFlacPictureBlock(
      updates.coverBuffer,
      updates.coverMime || 'image/jpeg',
      updates.coverWidth || 0,
      updates.coverHeight || 0
    );
    if (picPayload.length > 0xffffff) {
      throw new Error('Cover image exceeds FLAC 16MB metadata block limit. Please use a smaller image.');
    }
    outputBlocks.push({
      blockType: 6,
      payload: picPayload,
    });
  }

  // Serialize metadata blocks with isLast flag on final block
  const serializedBlocks = outputBlocks.map((b, idx) => {
    const isLast = idx === outputBlocks.length - 1;
    const hdr = Buffer.alloc(4);
    hdr[0] = (isLast ? 0x80 : 0x00) | (b.blockType & 0x7f);
    const len = b.payload.length;
    hdr[1] = (len >>> 16) & 0xff;
    hdr[2] = (len >>> 8) & 0xff;
    hdr[3] = len & 0xff;
    return Buffer.concat([hdr, b.payload]);
  });

  return Buffer.concat([Buffer.from('fLaC', 'ascii'), ...serializedBlocks, audioData]);
}

// ============================================================================
// 3. OGG / OPUS PACKET PARSER & FFMPEG AUDIO TAG WRITER
// ============================================================================

/**
 * Extract logical packets from an Ogg bitstream (used for OpusTags / Vorbis comments).
 */
function extractOggPackets(buf, maxPackets = 8) {
  let offset = 0;
  const streams = new Map();
  const finishedPackets = [];

  while (offset + 27 <= buf.length) {
    if (buf.readUInt32BE(offset) !== 0x4f676753) { // 'OggS'
      const next = buf.indexOf(Buffer.from('OggS'), offset + 1);
      if (next === -1) break;
      offset = next;
      continue;
    }

    const serial = buf.readUInt32LE(offset + 14);
    const segCount = buf[offset + 26];
    const segTableOffset = offset + 27;
    if (segTableOffset + segCount > buf.length) break;

    let payloadLen = 0;
    for (let i = 0; i < segCount; i++) {
      payloadLen += buf[segTableOffset + i];
    }
    const dataOffset = segTableOffset + segCount;
    if (dataOffset + payloadLen > buf.length) break;

    let pageStream = streams.get(serial);
    if (!pageStream) {
      pageStream = { currentPacketChunks: [] };
      streams.set(serial, pageStream);
    }

    let segOffset = dataOffset;
    for (let i = 0; i < segCount; i++) {
      const segLen = buf[segTableOffset + i];
      pageStream.currentPacketChunks.push(buf.subarray(segOffset, segOffset + segLen));
      segOffset += segLen;
      if (segLen < 255) {
        // End of logical packet
        const fullPacket = Buffer.concat(pageStream.currentPacketChunks);
        pageStream.currentPacketChunks = [];
        finishedPackets.push(fullPacket);
        if (finishedPackets.length >= maxPackets) return finishedPackets;
      }
    }

    offset = dataOffset + payloadLen;
  }

  return finishedPackets;
}

/**
 * Parse Vorbis comment metadata and cover art from an Ogg Opus (.opus) or Ogg Vorbis (.ogg) file.
 */
function parseOpusOrOggFile(buf) {
  const packets = extractOggPackets(buf, 8);
  for (const p of packets) {
    // Opus comment header: "OpusTags" (8 bytes)
    if (p.length >= 8 && p.subarray(0, 8).toString('ascii') === 'OpusTags') {
      return parseVorbisCommentBlock(p.subarray(8));
    }
    // Vorbis comment header: 0x03 + "vorbis" (7 bytes)
    if (p.length >= 7 && p[0] === 0x03 && p.subarray(1, 7).toString('ascii') === 'vorbis') {
      return parseVorbisCommentBlock(p.subarray(7));
    }
  }
  return null;
}

async function writeTagsWithFfmpeg(filePath, updates, tmpDir) {
  const ext = path.extname(filePath).toLowerCase();
  const id = `ff_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const tempCoverPath = updates.coverBuffer
    ? path.join(tmpDir, `${id}${updates.coverExt || '.jpg'}`)
    : null;
  const tempOutPath = path.join(tmpDir, `${id}${ext}`);

  try {
    if (tempCoverPath && updates.coverBuffer) {
      await fs.writeFile(tempCoverPath, updates.coverBuffer);
    }

    const args = ['-y', '-i', filePath];

    if (ext === '.opus' || ext === '.ogg') {
      // In Ogg Opus & Vorbis containers, cover art MUST be embedded via METADATA_BLOCK_PICTURE
      // (a base64-encoded FLAC picture block). Video stream muxing fails in Opus muxers.
      // Audio is copied losslessly with -c:a copy.
      args.push('-map', '0:a:0', '-c:a', 'copy');

      if (updates.coverBuffer) {
        const picBlock = encodeFlacPictureBlock(
          updates.coverBuffer,
          updates.coverMime || 'image/jpeg',
          updates.coverWidth || 0,
          updates.coverHeight || 0
        );
        const base64Pic = picBlock.toString('base64');
        args.push('-metadata', `METADATA_BLOCK_PICTURE=${base64Pic}`);
        args.push('-metadata:s:a:0', `METADATA_BLOCK_PICTURE=${base64Pic}`);
      }

      if (updates.title !== undefined && String(updates.title).trim()) {
        const val = String(updates.title).trim();
        args.push('-metadata', `title=${val}`, '-metadata:s:a:0', `title=${val}`);
      }
      if (updates.artist !== undefined && String(updates.artist).trim()) {
        const val = String(updates.artist).trim();
        args.push('-metadata', `artist=${val}`, '-metadata:s:a:0', `artist=${val}`);
      }
      if (updates.album !== undefined && String(updates.album).trim()) {
        const val = String(updates.album).trim();
        args.push('-metadata', `album=${val}`, '-metadata:s:a:0', `album=${val}`);
      }
      if (updates.year !== undefined && String(updates.year).trim()) {
        const val = String(updates.year).trim();
        args.push('-metadata', `date=${val}`, '-metadata:s:a:0', `date=${val}`);
      }
    } else {
      // Other containers (.m4a, .mp4, .wav, etc.)
      if (tempCoverPath) {
        args.push('-i', tempCoverPath, '-map', '0:a', '-map', '1:v', '-c', 'copy', '-disposition:v:0', 'attached_pic');
      } else {
        args.push('-map', '0', '-c', 'copy');
      }

      if (updates.title !== undefined && String(updates.title).trim()) {
        args.push('-metadata', `title=${String(updates.title).trim()}`);
      }
      if (updates.artist !== undefined && String(updates.artist).trim()) {
        args.push('-metadata', `artist=${String(updates.artist).trim()}`);
      }
      if (updates.album !== undefined && String(updates.album).trim()) {
        args.push('-metadata', `album=${String(updates.album).trim()}`);
      }
      if (updates.year !== undefined && String(updates.year).trim()) {
        args.push('-metadata', `date=${String(updates.year).trim()}`);
      }
    }

    args.push(tempOutPath);
    const ffmpegBin = getFfmpegBinaryPath();
    await execFileAsync(ffmpegBin, args, { timeout: 60000 });
    await fs.copyFile(tempOutPath, filePath);
  } finally {
    if (tempCoverPath && fsSync.existsSync(tempCoverPath)) {
      await fs.unlink(tempCoverPath).catch(() => {});
    }
    if (fsSync.existsSync(tempOutPath)) {
      await fs.unlink(tempOutPath).catch(() => {});
    }
  }
}

/**
 * Read current metadata tags and embedded cover art from an audio file.
 */
export async function readAudioMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const baseName = path.basename(filePath, ext);
  const parentName = path.basename(path.dirname(filePath));

  const fallback = {
    title: baseName.replace(/^\d+[\s._-]+/, ''),
    artist: '',
    album: parentName !== 'storage' && parentName !== 'Music' ? parentName : '',
    year: '',
    trackNumber: '',
    hasCover: false,
    coverDataUrl: null,
  };

  try {
    if (ext === '.mp3') {
      const buf = await fs.readFile(filePath);
      const parsed = parseMp3Id3v2(buf);
      const t = parsed.tags;
      return {
        title: t.title || fallback.title,
        artist: t.artist || fallback.artist,
        album: t.album || fallback.album,
        year: t.year || fallback.year,
        trackNumber: t.trackNumber || '',
        hasCover: Boolean(t.coverBuffer && t.coverBuffer.length > 0),
        coverDataUrl:
          t.coverBuffer && t.coverBuffer.length > 0
            ? `data:${t.coverMime || 'image/jpeg'};base64,${t.coverBuffer.toString('base64')}`
            : null,
      };
    }

    if (ext === '.flac') {
      const buf = await fs.readFile(filePath);
      const parsed = parseFlacFile(buf);
      const t = parsed.tags;
      return {
        title: t.title || fallback.title,
        artist: t.artist || fallback.artist,
        album: t.album || fallback.album,
        year: t.year || fallback.year,
        trackNumber: t.trackNumber || '',
        hasCover: Boolean(t.coverBuffer && t.coverBuffer.length > 0),
        coverDataUrl:
          t.coverBuffer && t.coverBuffer.length > 0
            ? `data:${t.coverMime || 'image/jpeg'};base64,${t.coverBuffer.toString('base64')}`
            : null,
      };
    }

    if (ext === '.opus' || ext === '.ogg') {
      const buf = await fs.readFile(filePath);
      const parsed = parseOpusOrOggFile(buf);
      if (parsed) {
        const t = parsed.tags;
        return {
          title: t.title || fallback.title,
          artist: t.artist || fallback.artist,
          album: t.album || fallback.album,
          year: t.year || fallback.year,
          trackNumber: t.trackNumber || '',
          hasCover: Boolean(t.coverBuffer && t.coverBuffer.length > 0),
          coverDataUrl:
            t.coverBuffer && t.coverBuffer.length > 0
              ? `data:${t.coverMime || 'image/jpeg'};base64,${t.coverBuffer.toString('base64')}`
              : null,
        };
      }
    }
  } catch (err) {
    console.warn(`[AudioTagger] Could not parse native tags for ${path.basename(filePath)}: ${err.message}`);
  }

  return fallback;
}

/**
 * Write metadata tags and/or embedded cover art to a single audio file safely via staging temp dir.
 */
export async function writeAudioMetadata(filePath, updates, tmpDir) {
  const ext = path.extname(filePath).toLowerCase();
  const enriched = { ...updates };

  if (enriched.coverBuffer) {
    const info = detectImageInfo(enriched.coverBuffer);
    enriched.coverMime = info.mime;
    enriched.coverExt = info.ext;
    enriched.coverWidth = info.width;
    enriched.coverHeight = info.height;
  }

  const stageFile = path.join(
    tmpDir,
    `tagstage_${Date.now()}_${crypto.randomBytes(6).toString('hex')}${ext}`
  );

  try {
    if (ext === '.mp3') {
      const buf = await fs.readFile(filePath);
      const updatedBuf = buildMp3WithUpdatedId3v2(buf, enriched);
      await fs.writeFile(stageFile, updatedBuf);
      await fs.copyFile(stageFile, filePath);
      return { format: 'mp3', engine: 'native-id3v2' };
    }

    if (ext === '.flac') {
      const buf = await fs.readFile(filePath);
      const updatedBuf = buildFlacWithUpdatedTags(buf, enriched);
      await fs.writeFile(stageFile, updatedBuf);
      await fs.copyFile(stageFile, filePath);
      return { format: 'flac', engine: 'native-flac' };
    }

    // Other audio formats (.m4a, .ogg, .opus, .wav, .aac): use ffmpeg
    await writeTagsWithFfmpeg(filePath, enriched, tmpDir);
    return { format: ext.slice(1), engine: 'ffmpeg' };
  } finally {
    if (fsSync.existsSync(stageFile)) {
      await fs.unlink(stageFile).catch(() => {});
    }
  }
}

// ============================================================================
// 4. ONLINE METADATA AUTO-TAGGING (iTunes JP, Spotify JP, MusicBrainz, Deezer)
// ============================================================================

const USER_AGENT = 'PlenripAudio/1.0.0 ( https://plenrip.planrift.me )';

let spotifyTokenCache = {
  accessToken: null,
  expiresAt: 0,
  clientId: '',
};

async function getSpotifyAccessToken(clientId, clientSecret) {
  const id = (clientId || process.env.SPOTIFY_CLIENT_ID || '').trim();
  const secret = (clientSecret || process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!id || !secret) return null;

  if (
    spotifyTokenCache.accessToken &&
    spotifyTokenCache.clientId === id &&
    Date.now() < spotifyTokenCache.expiresAt - 30000
  ) {
    return spotifyTokenCache.accessToken;
  }

  const credentials = Buffer.from(`${id}:${secret}`).toString('base64');
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    throw new Error(`Spotify auth HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data.access_token) return null;

  spotifyTokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
    clientId: id,
  };
  return data.access_token;
}

/**
 * 1. iTunes Search API (Japan Store: &country=jp&lang=ja_jp)
 */
async function searchItunesJP(query) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', query);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('country', 'jp');
  url.searchParams.set('lang', 'ja_jp');
  url.searchParams.set('limit', '12');

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`iTunes JP HTTP ${res.status}`);
  const data = await res.json();

  return (data.results || []).map((item) => {
    const thumb = item.artworkUrl100 || item.artworkUrl60 || '';
    // Upgrade iTunes 100x100 artwork to 1000x1000 high-resolution cover art
    const highResCover = thumb ? thumb.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/1000x1000bb.$1') : '';
    const year = item.releaseDate ? String(item.releaseDate).slice(0, 4) : '';
    return {
      source: 'iTunes JP',
      sourceId: `itunes_${item.trackId || item.collectionId}`,
      title: item.trackName || item.collectionName || '',
      artist: item.artistName || '',
      album: item.collectionName || '',
      year,
      trackNumber: item.trackNumber || '',
      coverUrl: highResCover || thumb,
      thumbnailUrl: thumb ? thumb.replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/300x300bb.$1') : '',
      resolution: '1000×1000',
    };
  });
}

/**
 * 2. Spotify Web API (Japan Market: &market=JP with Client Credentials flow)
 */
async function searchSpotifyJP(query, options = {}) {
  const token = await getSpotifyAccessToken(options.spotifyClientId, options.spotifyClientSecret);
  if (!token) {
    return [];
  }

  const url = new URL('https://api.spotify.com/v1/search');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'track');
  url.searchParams.set('market', 'JP');
  url.searchParams.set('limit', '10');

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Spotify JP HTTP ${res.status}`);
  const data = await res.json();
  const items = data?.tracks?.items || [];

  return items.map((track) => {
    const images = track?.album?.images || [];
    const largest = images[0]?.url || '';
    const medium = images[1]?.url || largest;
    const resLabel = images[0]?.width ? `${images[0].width}×${images[0].height}` : '640×640';
    const year = track?.album?.release_date ? String(track.album.release_date).slice(0, 4) : '';
    return {
      source: 'Spotify JP',
      sourceId: `spotify_${track.id}`,
      title: track.name || '',
      artist: (track.artists || []).map((a) => a.name).join(', '),
      album: track?.album?.name || '',
      year,
      trackNumber: track.track_number || '',
      coverUrl: largest,
      thumbnailUrl: medium,
      resolution: resLabel,
    };
  });
}

/**
 * 3. MusicBrainz JSON API + Cover Art Archive
 */
async function searchMusicBrainz(query) {
  const url = new URL('https://musicbrainz.org/ws/2/recording/');
  url.searchParams.set('query', query);
  url.searchParams.set('fmt', 'json');
  url.searchParams.set('limit', '8');

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: 'application/json',
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`);
  const data = await res.json();
  const recordings = data.recordings || [];

  const results = [];
  for (const rec of recordings) {
    const releases = rec.releases || [];
    // Prefer Japanese release ("JP") or first release with an ID
    const jpRelease = releases.find((r) => r.country === 'JP') || releases[0];
    const releaseId = jpRelease?.id || '';
    const artist = (rec['artist-credit'] || [])
      .map((ac) => ac.name || ac.artist?.name || '')
      .filter(Boolean)
      .join(', ');
    const dateStr = jpRelease?.date || rec['first-release-date'] || '';
    const year = dateStr ? String(dateStr).slice(0, 4) : '';

    const coverUrl = releaseId
      ? `https://coverartarchive.org/release/${releaseId}/front-1200`
      : '';
    const thumbnailUrl = releaseId
      ? `https://coverartarchive.org/release/${releaseId}/front-250`
      : '';

    results.push({
      source: 'MusicBrainz',
      sourceId: `mb_${rec.id}`,
      title: rec.title || '',
      artist,
      album: jpRelease?.title || '',
      year,
      trackNumber: '',
      coverUrl,
      thumbnailUrl,
      resolution: releaseId ? 'CAA High-Res' : 'Metadata Only',
    });
  }

  return results;
}

/**
 * 4. Deezer Public Search API
 */
async function searchDeezer(query) {
  const url = new URL('https://api.deezer.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '10');

  const res = await fetch(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept-Language': 'ja-JP,ja;q=0.9,en;q=0.8',
    },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Deezer HTTP ${res.status}`);
  const data = await res.json();
  const items = data.data || [];

  return items.map((item) => {
    const coverUrl = item.album?.cover_xl || item.album?.cover_big || item.album?.cover_medium || '';
    const thumbnailUrl = item.album?.cover_medium || coverUrl;
    return {
      source: 'Deezer',
      sourceId: `deezer_${item.id}`,
      title: item.title || '',
      artist: item.artist?.name || '',
      album: item.album?.title || '',
      year: '',
      trackNumber: '',
      coverUrl,
      thumbnailUrl,
      resolution: item.album?.cover_xl ? '1000×1000' : '500×500',
    };
  });
}

/**
 * Concurrently search all 4 external metadata providers (iTunes JP, Spotify JP, MusicBrainz, Deezer).
 */
export async function searchMetadataOnline(query, options = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return { results: [], sources: {} };

  const [itunesRes, spotifyRes, mbRes, deezerRes] = await Promise.allSettled([
    searchItunesJP(cleanQuery),
    searchSpotifyJP(cleanQuery, options),
    searchMusicBrainz(cleanQuery),
    searchDeezer(cleanQuery),
  ]);

  const hasSpotifyCreds = Boolean(
    (options.spotifyClientId || process.env.SPOTIFY_CLIENT_ID) &&
      (options.spotifyClientSecret || process.env.SPOTIFY_CLIENT_SECRET)
  );

  const sources = {
    itunesJP: {
      ok: itunesRes.status === 'fulfilled',
      count: itunesRes.status === 'fulfilled' ? itunesRes.value.length : 0,
      error: itunesRes.status === 'rejected' ? itunesRes.reason?.message : null,
    },
    spotifyJP: {
      ok: spotifyRes.status === 'fulfilled',
      configured: hasSpotifyCreds,
      count: spotifyRes.status === 'fulfilled' ? spotifyRes.value.length : 0,
      error: spotifyRes.status === 'rejected' ? spotifyRes.reason?.message : null,
    },
    musicBrainz: {
      ok: mbRes.status === 'fulfilled',
      count: mbRes.status === 'fulfilled' ? mbRes.value.length : 0,
      error: mbRes.status === 'rejected' ? mbRes.reason?.message : null,
    },
    deezer: {
      ok: deezerRes.status === 'fulfilled',
      count: deezerRes.status === 'fulfilled' ? deezerRes.value.length : 0,
      error: deezerRes.status === 'rejected' ? deezerRes.reason?.message : null,
    },
  };

  const combined = [
    ...(itunesRes.status === 'fulfilled' ? itunesRes.value : []),
    ...(spotifyRes.status === 'fulfilled' ? spotifyRes.value : []),
    ...(deezerRes.status === 'fulfilled' ? deezerRes.value : []),
    ...(mbRes.status === 'fulfilled' ? mbRes.value : []),
  ];

  return {
    query: cleanQuery,
    sources,
    results: combined,
  };
}

/**
 * Download a remote cover art image URL into a validated Buffer.
 */
export async function fetchRemoteCoverBuffer(coverUrl) {
  const raw = String(coverUrl || '').trim();
  if (!raw || (!raw.startsWith('https://') && !raw.startsWith('http://'))) {
    throw new Error('Invalid remote cover URL');
  }

  // Try the primary URL first; for Cover Art Archive front-1200, fall back to front-500 or front if needed
  const candidates = [raw];
  if (raw.includes('coverartarchive.org') && raw.endsWith('/front-1200')) {
    candidates.push(raw.replace(/\/front-1200$/, '/front-500'));
    candidates.push(raw.replace(/\/front-1200$/, '/front'));
  }

  let lastErr = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'follow',
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} fetching cover art`);
      }
      const arrayBuf = await res.arrayBuffer();
      const buf = Buffer.from(arrayBuf);
      detectImageInfo(buf); // Validate magic bytes
      return buf;
    } catch (err) {
      lastErr = err;
    }
  }

  throw lastErr || new Error('Failed to download remote cover image');
}
