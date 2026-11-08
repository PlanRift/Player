import { describe, expect, it, beforeEach, beforeAll } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTitle, scoreCandidate, findBestCandidate, SOFT_MIN, FALLBACK_MIN, stripCreditLines, timingAgreement, selectAutoWinner } from './scoring';
import type { UnifiedLyrics } from './types';
import { parseLrc, parsePlainLyrics } from './normalize/lrc';
import { parseTtml, parseTtmlTime } from './normalize/ttml';
import { parseYrc } from './normalize/yrc';
import { parseLyricsPlus } from './normalize/lyricsplus';
import { decodeQqLyricPayload, parseQrc, qrcTripleDesDecrypt } from './normalize/qrc';
import { decodeKrcPayload, parseKrc } from './normalize/krc';
import { lyricsCache } from './cache';
import { amllProvider } from './providers/amll';

beforeAll(async () => {
  try {
    const res = await fetch('http://127.0.0.1:3005/api/health');
    if (res.ok) return;
  } catch {
    await import('./index');
  }
});

describe('Relay Scoring & Title Cleaning', () => {
  it('cleans title by stripping remastered, live, feat, and explicit tags', () => {
    expect(cleanTitle('Yellow (Remastered 2011)')).toBe('Yellow');
    expect(cleanTitle('Yellow - Live at Glastonbury 2011')).toBe('Yellow');
    expect(cleanTitle('Yellow (feat. Someone)')).toBe('Yellow');
    expect(cleanTitle('Yellow [Explicit]')).toBe('Yellow');
    expect(cleanTitle('Yellow (Deluxe Edition)')).toBe('Yellow');
  });

  it('scores candidates based on title, artist, and duration ±5s', () => {
    const query = { title: 'Yellow', artist: 'Coldplay', duration: 269 };

    const exactMatch = { title: 'Yellow', artist: 'Coldplay', duration: 269 };
    const closeDuration = { title: 'Yellow', artist: 'Coldplay', duration: 266 };
    const wrongDuration = { title: 'Yellow', artist: 'Coldplay', duration: 180 };
    const wrongTitle = { title: 'Something Else', artist: 'Coldplay', duration: 269 };

    const scoreExact = scoreCandidate(exactMatch, query);
    const scoreClose = scoreCandidate(closeDuration, query);
    const scoreWrongDur = scoreCandidate(wrongDuration, query);
    const scoreWrongTitle = scoreCandidate(wrongTitle, query);

    expect(scoreExact).toBeGreaterThan(scoreClose);
    expect(scoreClose).toBeGreaterThan(scoreWrongDur);
    expect(scoreWrongTitle).toBeLessThan(0);
  });

  it('finds best candidate and rejects completely mismatched candidates', () => {
    const query = { title: 'Yellow', artist: 'Coldplay', duration: 269 };
    const candidates = [
      { id: 1, title: 'In My Place', artist: 'Coldplay', duration: 228 },
      { id: 2, title: 'Yellow', artist: 'Coldplay', duration: 266 },
      { id: 3, title: 'Yellow (Acoustic)', artist: 'Coldplay', duration: 250 },
    ];

    const best = findBestCandidate(candidates, query);
    expect(best?.id).toBe(2);

    const empty = findBestCandidate([{ title: 'Fix You', artist: 'Coldplay' }], { title: 'Sparks', artist: 'Coldplay' });
    expect(empty).toBeNull();
  });
});

describe('Relay Parsers', () => {
  it('parses standard line-timed LRC and handles offset', () => {
    const lrc = `
[ti:Yellow]
[offset:500]
[00:33.58]Look at the stars
[00:36.78]Look how they shine for you
    `;
    const lines = parseLrc(lrc);
    expect(lines.length).toBe(2);
    // 33.58 + 0.500 offset = 34.08
    expect(lines[0].t).toBeCloseTo(34.08, 2);
    expect(lines[0].text).toBe('Look at the stars');
  });

  it('parses plain text lyrics into lines with order preservation', () => {
    const plain = `Line one\nLine two\nLine three`;
    const lines = parsePlainLyrics(plain);
    expect(lines.length).toBe(3);
    expect(lines[0].text).toBe('Line one');
    expect(lines[2].text).toBe('Line three');
  });

  it('parses TTML timestamps and word-level spans', () => {
    expect(parseTtmlTime('33.642')).toBe(33.642);
    expect(parseTtmlTime('1:09.547')).toBe(69.547);
    expect(parseTtmlTime('01:00:10.500')).toBe(3610.5);

    const xml = `
<tt xmlns="http://www.w3.org/ns/ttml">
  <body>
    <div>
      <p begin="33.642" end="35.909">
        <span begin="33.642" end="33.958">Look</span>
        <span begin="33.958" end="34.278">at</span>
        <span begin="34.278" end="34.577">the</span>
        <span begin="34.577" end="35.909">stars</span>
      </p>
      <p begin="36.381" end="40.029">
        <span begin="36.381" end="36.697">Look</span>
        <span begin="36.697" end="37.045">how</span>
      </p>
    </div>
  </body>
</tt>
    `;
    const lines = parseTtml(xml);
    expect(lines.length).toBe(2);
    expect(lines[0].t).toBe(33.642);
    expect(lines[0].text).toBe('Look at the stars');
    expect(lines[0].words?.length).toBe(4);
    expect(lines[0].words?.[0].text).toBe('Look');
    expect(lines[0].words?.[0].t).toBe(33.642);
  });

  it('parses NetEase YRC word timings', () => {
    const yrc = `[00:33.790](0,200,0)Look (200,100,0)at (300,300,0)the (600,800,0)stars`;
    const lines = parseYrc(yrc);
    expect(lines.length).toBe(1);
    expect(lines[0].t).toBe(33.79);
    expect(lines[0].text).toBe('Look at the stars');
    expect(lines[0].words?.length).toBe(4);
    expect(lines[0].words?.[0].text).toBe('Look');
    expect(lines[0].words?.[0].t).toBe(33.79);
    expect(lines[0].words?.[1].t).toBeCloseTo(33.99, 2);
  });

  it('parses LyricsPlus JSON timed format and handles errors safely', () => {
    const json = {
      type: 'Word',
      lyrics: [
        {
          time: 33642,
          duration: 2267,
          text: 'Look at the stars',
          syllabus: [
            { time: 33642, duration: 316, text: 'Look ' },
            { time: 33958, duration: 320, text: 'at ' },
            { time: 34278, duration: 299, text: 'the ' },
            { time: 34577, duration: 1332, text: 'stars' },
          ],
        },
      ],
    };
    const lines = parseLyricsPlus(json);
    expect(lines.length).toBe(1);
    expect(lines[0].t).toBe(33.642);
    expect(lines[0].text).toBe('Look at the stars');
    expect(lines[0].words?.length).toBe(4);
    expect(lines[0].words?.[3].text).toBe('stars');

    // Error / empty payload returns empty array without throwing
    expect(parseLyricsPlus(null)).toEqual([]);
    expect(parseLyricsPlus({ error: 'not found' })).toEqual([]);
    expect(parseLyricsPlus({ lyrics: [] })).toEqual([]);
  });
});

describe('Relay Cache', () => {
  beforeEach(() => {
    lyricsCache.clear();
  });

  it('stores and retrieves successful lyrics', () => {
    const sampleLyrics = {
      lines: [{ t: 10, text: 'Hello' }],
      synced: true,
      source: 'lrclib',
      provider: 'LRCLIB',
    };
    lyricsCache.setSuccess('Yellow', 'Coldplay', 269, 'auto', sampleLyrics);

    const hit = lyricsCache.get('Yellow', 'Coldplay', 269, 'auto');
    expect(hit).toEqual(sampleLyrics);
  });

  it('stores honest misses with brief TTL and treats provider failure as uncached', () => {
    lyricsCache.setMiss('Missing Song', 'Nobody', 120, 'netease');
    const miss = lyricsCache.get('Missing Song', 'Nobody', 120, 'netease');
    expect(miss).toBeNull();

    // Unknown key is undefined (not cached)
    expect(lyricsCache.get('Other Song', 'Nobody', 120, 'netease')).toBeUndefined();
  });
});

describe('Relay Features (Romaji & Title Translation)', () => {
  it('serves health status with all feature flags', async () => {
    const res = await fetch('http://127.0.0.1:3005/api/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.features).toContain('romaji');
    expect(data.features).toContain('translate-title');
  });

  it('translates Japanese title using Deezer and returns candidate', async () => {
    const res = await fetch('http://127.0.0.1:3005/api/translate-title?title=%E9%81%8E%E5%8E%BB%E3%82%92%E5%96%B0%E3%82%89%E3%81%86&artist=MyGO!!!!!');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.originalTitle).toBe('過去を喰らう');
    expect(data.translatedTitle).toContain('Eat The Past');
    expect(data.source).toBe('deezer');
  });

  it('ignores non-Japanese titles for translation', async () => {
    const res = await fetch('http://127.0.0.1:3005/api/translate-title?title=Yellow&artist=Coldplay');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.originalTitle).toBe('Yellow');
    expect(data.translatedTitle).toBeNull();
  });

  it('provides romaji readings through /api/romaji endpoint', async () => {
    const res = await fetch('http://127.0.0.1:3005/api/romaji?text=%E4%BA%A4%E5%B7%AE%E7%82%B9%E3%81%AE%E7%9C%9F%E3%82%93%E4%B8%AD');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.romaji.toLowerCase()).toContain('man');
    expect(data.english).toBeDefined();
  });
});

describe('Phase 9 score gate (relay)', () => {
  it('SOFT_MIN gates the match, FALLBACK_MIN is the single-best floor', async () => {
    const { SOFT_MIN, FALLBACK_MIN } = await import('./scoring');
    expect(SOFT_MIN).toBe(50);
    expect(FALLBACK_MIN).toBe(20);
  });

  it('findBestCandidate returns the gated match when one passes', () => {
    const query = { title: 'Yellow', artist: 'Coldplay', duration: 269 };
    const best = findBestCandidate(
      [
        { id: 1, title: 'Yellow', artist: 'Somebody Else', duration: 269 },
        { id: 2, title: 'Yellow', artist: 'Coldplay', duration: 269 },
      ],
      query
    );
    expect(best?.id).toBe(2);
  });

  it('findBestCandidate falls back to the single best when nothing passes the gate', () => {
    const query = { title: 'Yellow', artist: 'Coldplay' };
    const best = findBestCandidate(
      [{ id: 1, title: 'Yellow', artist: 'Somebody Else' }],
      query
    );
    expect(best?.id).toBe(1);
  });

  it('findBestCandidate rejects everything below the fallback floor', () => {
    const query = { title: 'Yellow', artist: 'Coldplay', duration: 269 };
    const best = findBestCandidate(
      [{ id: 1, title: 'Something Else', artist: 'Coldplay', duration: 269 }],
      query
    );
    expect(best).toBeNull();
  });
});

describe('Phase 9 TTML duet and song parts', () => {
  it('parses ttm:agent v1/v2 and Apple centred agents v1000/v2000', () => {
    const xml = `<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
      <p begin="00:01.000" end="00:02.000" ttm:agent="v1"><span begin="00:01.000">Lead</span></p>
      <p begin="00:02.000" end="00:03.000" ttm:agent="v2"><span begin="00:02.000">Duet</span></p>
      <p begin="00:03.000" end="00:04.000" ttm:agent="v1000"><span begin="00:03.000">Centred</span></p>
      <p begin="00:04.000" end="00:05.000" ttm:agent="v2000"><span begin="00:04.000">Centred two</span></p>
    </div></body></tt>`;
    const lines = parseTtml(xml);
    expect(lines[0].agent).toBe('lead');
    expect(lines[1].agent).toBe('duet');
    expect(lines[2].agent).toBe('center');
    expect(lines[3].agent).toBe('center');
  });

  it('parses ttm:role x-bg and itunes:songPart', () => {
    const xml = `<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal"><body><div>
      <p begin="00:01.000" end="00:02.000" ttm:role="x-bg"><span begin="00:01.000">Background</span></p>
      <p begin="00:02.000" end="00:03.000" itunes:songPart="Chorus"><span begin="00:02.000">Chorus line</span></p>
    </div></body></tt>`;
    const lines = parseTtml(xml);
    expect(lines[0].isBG).toBe(true);
    expect(lines[1].part).toBe('Chorus');
  });

  it('skips x-translation and x-roman spans (AMLL inline translations are not sung words)', () => {
    const xml = `<tt xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
      <p begin="00:14.969" end="00:18.855" ttm:agent="v1"><span begin="00:14.969" end="00:15.427">悴</span><span begin="00:15.427" end="00:15.578">ん</span><span begin="00:15.578" end="00:15.845">だ</span><span begin="00:15.845" end="00:17.050">心</span> <span begin="00:17.160" end="00:17.430">ふ</span><span begin="00:17.470" end="00:17.680">る</span><span begin="00:17.770" end="00:18.040">え</span><span begin="00:18.060" end="00:18.170">る</span><span begin="00:18.240" end="00:18.630">眼</span><span begin="00:18.660" end="00:18.900">差</span><span begin="00:18.950" end="00:19.160">し</span><span ttm:role="x-translation" xml:lang="zh-Hans">内心满是憔悴 眼神颤抖不止</span><span ttm:role="x-translation" xml:lang="ko">마음은 초췌해지고 눈빛은 하염없이 떨려</span><span ttm:role="x-translation" xml:lang="en">Numb heart a trembling gaze</span><span ttm:role="x-roman">Kajikanda kokoro furueru manazashi</span></p>
    </div></body></tt>`;
    const lines = parseTtml(xml);
    expect(lines.length).toBe(1);
    expect(lines[0].text).toBe('悴んだ心 ふるえる眼差し');
    expect(lines[0].words?.length).toBe(11);
    expect(lines[0].words?.[0]).toEqual({ t: 14.969, text: '悴' });
    expect(lines[0].words?.map((w) => w.text).join('')).not.toContain('Numb');
  });
});

describe('AMLL provider', () => {
  const searchJson = {
    status: 200,
    data: {
      items: [
        {
          id: 3095751498181711,
          musicNames: ['春日影'],
          artistNames: ['CRYCHIC'],
          albumNames: ["TVアニメ「BanG Dream! It's MyGO!!!!!」Original Soundtrack Vol.2"],
        },
        {
          id: 3389400055524916,
          musicNames: ['春日影 (MyGO!!!!! ver.)'],
          artistNames: ['MyGO!!!!!'],
          albumNames: ['迷跡波'],
        },
        {
          id: 6919818940559618,
          musicNames: ['春日影 (MyGO!!!!! ver.)', '春日影 - MyGO!!!!! ver.', 'Haruhikage'],
          artistNames: ['MyGO!!!!!'],
          albumNames: ['迷跡波'],
        },
      ],
      pagination: { page: 1, limit: 20, total: 3 },
    },
  };

  const ttml = `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata"><body><div>
    <p begin="00:14.969" end="00:18.855"><span begin="00:14.969" end="00:15.427">悴</span><span begin="00:15.427" end="00:15.578">ん</span><span begin="00:15.578" end="00:15.845">だ</span><span begin="00:15.845" end="00:17.050">心</span></p>
    <p begin="00:18.855" end="00:22.000" ttm:agent="v2"><span begin="00:18.855" end="00:19.500">影</span><span begin="00:19.500" end="00:20.000">色</span></p>
  </div></body></tt>`;

  function mockAmllFetch(getId: number | null = 3389400055524916): { restore: () => void; getCalls: string[] } {
    const originalFetch = globalThis.fetch;
    const getCalls: string[] = [];
    globalThis.fetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/v1/lyrics/search')) {
        return new Response(JSON.stringify(searchJson), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (urlStr.includes('/v1/lyrics/get')) {
        getCalls.push(urlStr);
        const body =
          getId === null
            ? { status: 200, data: { id: 1 } }
            : { status: 200, data: { id: getId, lyrics: ttml } };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('Not found', { status: 404 });
    };
    return {
      restore: () => {
        globalThis.fetch = originalFetch;
      },
      getCalls,
    };
  }

  it('returns word-synced lines for 春日影 by MyGO!!!!! and picks the MyGO item over CRYCHIC', async () => {
    const { restore, getCalls } = mockAmllFetch();
    try {
      const res = await amllProvider.fetch({ title: '春日影', artist: 'MyGO!!!!!', duration: 256 });
      expect(res).not.toBeNull();
      expect(res!.source).toBe('amll');
      expect(res!.provider).toBe('AMLL');
      expect(res!.synced).toBe(true);
      expect(res!.hasWordSync).toBe(true);
      expect(res!.lines.length).toBe(2);
      expect(res!.lines[0].words?.length).toBe(4);
      expect(res!.lines[0].words?.[0]).toEqual({ t: 14.969, text: '悴' });
      expect(res!.lines[1].agent).toBe('duet');
      expect(res!.match?.artist).toBe('MyGO!!!!!');
      expect(res!.match?.title).toBe('春日影 (MyGO!!!!! ver.)');
      expect(getCalls.length).toBe(1);
      expect(getCalls[0]).toContain('id=3389400055524916');
    } finally {
      restore();
    }
  });

  it('scores the CRYCHIC-only match below SOFT_MIN but above FALLBACK_MIN (fallback, not a gate pass)', () => {
    const score = scoreCandidate(
      { title: '春日影', artist: 'CRYCHIC' },
      { title: '春日影', artist: 'MyGO!!!!!', duration: 256 }
    );
    expect(score).toBe(60 - 15);
    expect(score).toBeLessThan(SOFT_MIN);
    expect(score).toBeGreaterThanOrEqual(FALLBACK_MIN);

    const best = findBestCandidate([{ title: '春日影', artist: 'CRYCHIC' }], {
      title: '春日影',
      artist: 'MyGO!!!!!',
      duration: 256,
    });
    expect(best).not.toBeNull();

    const mygoScore = scoreCandidate(
      { title: '春日影 (MyGO!!!!! ver.)', artist: 'MyGO!!!!!' },
      { title: '春日影', artist: 'MyGO!!!!!', duration: 256 }
    );
    expect(mygoScore).toBeGreaterThanOrEqual(SOFT_MIN);
  });

  it('returns null on an empty search and on a get without embedded TTML', async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url: string | URL | Request) => {
        const urlStr = url.toString();
        if (urlStr.includes('/v1/lyrics/search')) {
          return new Response(JSON.stringify({ status: 200, data: { items: [], pagination: {} } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('Not found', { status: 404 });
      };
      expect(await amllProvider.fetch({ title: '名無声', artist: 'MyGO!!!!!' })).toBeNull();

      const { restore } = mockAmllFetch(null);
      try {
        expect(await amllProvider.fetch({ title: '春日影', artist: 'MyGO!!!!!' })).toBeNull();
      } finally {
        restore();
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe('Phase 9 LRC duet, background vocals, and song parts', () => {
  it('parses speaker tags, bg tags, song parts, and word tags', () => {
    const lines = parseLrc(
      '[songPart: Verse]\n[00:01.00][v2] Duet line\n[00:02.00]v1: Lead line\n[00:03.00][bg] Background\n[00:04.00]<00:04.00>Hello <00:04.50>world'
    );
    expect(lines[0].agent).toBe('duet');
    expect(lines[0].part).toBe('Verse');
    expect(lines[1].agent).toBe('lead');
    expect(lines[2].isBG).toBe(true);
    expect(lines[3].words).toEqual([
      { t: 4, text: 'Hello' },
      { t: 4.5, text: 'world' },
    ]);
  });

  it('marks an echo repeat within 1200ms as a background vocal', () => {
    const lines = parseLrc('[00:10.00]Repeat\n[00:11.00]Repeat');
    expect(lines[1].isBG).toBe(true);
  });
});

describe('Lyrics timing fix: credit stripping + agreement tie-breaker', () => {
  const query = { title: '名無声', artist: 'MyGO!!!!!', duration: 272 };

  it('strips leading credit lines and keeps real lyrics', () => {
    const hit = {
      lines: [
        { t: 0, text: '名無声 - MyGO!!!!!' },
        { t: 0.1, text: '词：藤原優樹(SUPA LOVE)' },
        { t: 0.31, text: '曲：金崎真士(SUPA LOVE)' },
        { t: 0.779, text: '何が僕にできるか' },
        { t: 5.773, text: 'わからないけれど' },
      ],
      synced: true,
      source: 'qq',
      provider: 'QQ Music',
    };
    const cleaned = stripCreditLines(hit, query);
    expect(cleaned).not.toBeNull();
    expect(cleaned!.lines.map((l) => l.text)).toEqual(['何が僕にできるか', 'わからないけれど']);
  });

  it('strips NetEase 作词/作曲 credits but keeps an early real line', () => {
    const hit = {
      lines: [
        { t: 0, text: '作词 : 織田あすか' },
        { t: 1, text: '作曲 : 上松範康' },
        { t: 0.92, text: 'Yo this is LZ ri' },
      ],
      synced: true,
      source: 'netease',
      provider: 'NetEase Music',
    };
    const cleaned = stripCreditLines(hit, query);
    expect(cleaned!.lines.map((l) => l.text)).toEqual(['Yo this is LZ ri']);
  });

  it('strips 制作人 producer credits (Yorushika 451)', () => {
    const hit = {
      lines: [
        { t: 0, text: '制作人 : n-buna' },
        { t: 0.114, text: '作词 : n-buna' },
        { t: 0.228, text: '作曲 : n-buna' },
        { t: 0.342, text: '编曲 : n-buna' },
        { t: 0.456, text: 'あの太陽を見てた' },
      ],
      synced: true,
      source: 'netease',
      provider: 'NetEase Music',
    };
    const cleaned = stripCreditLines(hit, { title: '451', artist: 'ヨルシカ' });
    expect(cleaned!.lines.map((l) => l.text)).toEqual(['あの太陽を見てた']);
  });

  it('does not strip a real first line that is not a credit', () => {
    const hit = {
      lines: [
        { t: 0.779, text: '何が僕にできるか' },
        { t: 5.773, text: 'わからないけれど' },
      ],
      synced: true,
      source: 'lrcred',
      provider: 'lrc.red',
    };
    expect(stripCreditLines(hit, query)).toBe(hit);
  });

  it('returns null when only credits remain', () => {
    const hit = {
      lines: [{ t: 0, text: '作词 : Someone' }],
      synced: true,
      source: 'netease',
      provider: 'NetEase Music',
    };
    expect(stripCreditLines(hit, query)).toBeNull();
  });

  it('timing agreement: identical hits agree at 0, drifted hits score worse', () => {
    const base = {
      lines: [
        { t: 0.779, text: '何が僕にできるか' },
        { t: 5.773, text: 'わからないけれど' },
      ],
      synced: true,
      source: 'lrcred',
      provider: 'lrc.red',
    };
    const identical = { ...base, source: 'lyricsplus', provider: 'LyricsPlus' };
    const drifted = {
      ...base,
      source: 'lrclib',
      provider: 'LRCLIB',
      lines: [
        { t: 0.74, text: '何が僕にできるか' },
        { t: 5.79, text: 'わからないけれど' },
        { t: 47.16, text: '遠くにある理想よりも' },
      ],
    };
    expect(timingAgreement(base, [identical])).toBe(0);
    expect(timingAgreement(base, [drifted])).toBeGreaterThan(0);
    expect(timingAgreement(drifted, [base, identical])).toBeGreaterThan(timingAgreement(base, [drifted, identical]));
  });

  it('auto winner: real 名無声 fixtures pick the exact-timed hit, not LRCLIB', () => {
    const dir = join(import.meta.dir, 'fixtures');
    const load = (name: string) => JSON.parse(readFileSync(join(dir, `namonaki-${name}.json`), 'utf-8')) as UnifiedLyrics;
    const hits = ['lrclib', 'lrcred', 'lyricsplus', 'netease', 'qq'].map(load);
    const cleaned = hits
      .map((h) => stripCreditLines(h, query))
      .filter((h): h is UnifiedLyrics => h !== null);
    const winner = selectAutoWinner(cleaned, query);
    expect(winner).not.toBeNull();
    expect(winner!.source).toBe('lrcred');
    expect(winner!.lines[0]).toEqual(expect.objectContaining({ t: 0.779, text: '何が僕にできるか' }));
    expect(winner!.lines.length).toBe(44);
  });
});

describe('QQ QRC decrypt + parse (real 壱雫空 fixtures)', () => {
  const dir = join(import.meta.dir, 'fixtures');
  const rawJson = JSON.parse(readFileSync(join(dir, 'qrc-ichishizuku-raw.json'), 'utf-8')) as { lyric: string; trans: string; roma: string };
  const qrcText = readFileSync(join(dir, 'qrc-ichishizuku.txt'), 'utf-8');

  it('decrypts the captured hex payload to a zlib stream', () => {
    const decrypted = qrcTripleDesDecrypt(new Uint8Array(Buffer.from(rawJson.lyric, 'hex')));
    expect(Buffer.from(decrypted.subarray(0, 2)).toString('hex')).toBe('789c');
  });

  it('decodes the captured payload to the exact QRC text', () => {
    expect(decodeQqLyricPayload(rawJson.lyric)).toBe(qrcText);
  });

  it('decodes a Base64 LRC payload (crypt=0 fallback)', () => {
    const lrc = '[00:00.78]何が僕にできるか\n[00:05.77]わからないけれど';
    expect(decodeQqLyricPayload(Buffer.from(lrc, 'utf-8').toString('base64'))).toBe(lrc);
  });

  it('parses QRC lines with per-word timings, skipping metadata', () => {
    const lines = parseQrc(qrcText);
    expect(lines.length).toBe(55);
    expect(lines.every((l) => Array.isArray(l.words) && l.words.length > 0)).toBe(true);
    expect(lines.every((l) => l.words!.every((w) => w.text.length > 0))).toBe(true);
    expect(lines[0]).toEqual(expect.objectContaining({ t: 0, text: '壱雫空 - MyGO!!!!!' }));
    expect(lines[0].words!.map((w) => w.text)).toEqual(['壱', '雫', '空', '-', 'MyGO!!!!!']);
    expect(lines[0].words![0].t).toBe(0);
    expect(lines[0].words![1].t).toBe(0.065);
    const mid = lines.find((l) => Math.abs(l.t - 163.317) < 0.01);
    expect(mid).toBeDefined();
    expect(mid!.text).toBe('まだ道は乾かないだろう');
    expect(mid!.words!.length).toBe(11);
    expect(lines.some((l) => l.text.includes('[ti:') || l.text.includes('[kana:'))).toBe(false);
  });

  it('roma sidecar aligns with the main lines after credit stripping', () => {
    const main = parseQrc(qrcText);
    expect(main.length).toBe(55);
    const query = { title: '壱雫空', artist: 'MyGO!!!!!', duration: 189 };
    const stripped = stripCreditLines({ lines: main, synced: true, source: 'qq', provider: 'QQ Music' }, query);
    expect(stripped!.lines.length).toBe(51);
    const roma = parseQrc(decodeQqLyricPayload(rawJson.roma));
    expect(roma.length).toBe(51);
    expect(roma[0].text).toBe("mo shi ko no a me ga a ga 't te mo");
    expect(roma[0].words!.length).toBeGreaterThan(5);
  });

  it('trans field is plain LRC, not QRC (Chinese translation, never attached)', () => {
    const decoded = decodeQqLyricPayload(rawJson.trans);
    expect(decoded.startsWith('[ti:')).toBe(true);
    expect(parseQrc(decoded).length).toBe(0);
    expect(parseLrc(decoded).length).toBe(55);
  });
});

describe('KuGou KRC decrypt + parse (real 夜に駆ける fixtures)', () => {
  const dir = join(import.meta.dir, 'fixtures');
  const rawJson = JSON.parse(readFileSync(join(dir, 'krc-yorunikakeru-raw.json'), 'utf-8')) as { content: string };
  const krcText = readFileSync(join(dir, 'krc-yorunikakeru.txt'), 'utf-8');

  it('decrypts the krc1 payload to the exact fixture text', () => {
    const decoded = decodeKrcPayload(rawJson.content);
    expect(decoded).toBe(krcText);
    expect(decoded.startsWith('[ti:夜に駆ける(奔向黑夜)]')).toBe(true);
  });

  it('parses 69 word-synced lines with per-character timings', () => {
    const lines = parseKrc(krcText);
    expect(lines.length).toBe(69);
    expect(lines.every((l) => l.words && l.words.length > 0)).toBe(true);
    expect(lines[0].t).toBe(0);
    expect(lines[0].text).toBe('夜に駆ける - YOASOBI (ヨアソビ)');
    expect(lines[0].words!.map((w) => w.t)).toEqual([0, 0.076, 0.113, 0.151, 0.189, 0.227, 0.264, 0.302, 0.34, 0.378, 0.415, 0.453]);
    const last = lines[lines.length - 1];
    expect(last.t).toBe(239.986);
    expect(last.text).toBe('二人今 夜に駆け出していく');
  });

  it('the [language:] type 1 sidecar aligns 1:1 (69) but is Chinese, so it stays unattached', () => {
    const match = krcText.match(/\[language:([A-Za-z0-9+/=]+)\]/);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(Buffer.from(match![1], 'base64').toString('utf-8'));
    const items = parsed.content as Array<{ type: number; lyricContent: string[][] }>;
    expect(items.length).toBe(1);
    expect(items[0].type).toBe(1);
    expect(items[0].lyricContent.length).toBe(69);
  });

  it('bad input decodes/parses to nothing', () => {
    expect(decodeKrcPayload('')).toBe('');
    expect(decodeKrcPayload('not-base64!!!')).toBe('');
    expect(parseKrc('')).toEqual([]);
    expect(parseKrc('[ti:only metadata]\n[ar:artist]\n')).toEqual([]);
  });
});
