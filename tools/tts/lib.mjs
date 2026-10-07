// Sdílené funkce pro generování audia (Gemini TTS přes Cloudflare) + MP3
import fs from 'node:fs';
import { Mp3Encoder } from '@breezystack/lamejs';
import { execSync } from 'node:child_process';

export const ACCT = JSON.parse(fs.readFileSync('C:/LInguaVelo/repo/worker/.wrangler/cache/wrangler-account.json', 'utf8')).account.id;
let lastRefresh = 0;
export function refreshToken() {
  if (Date.now() - lastRefresh < 60000) return;
  lastRefresh = Date.now();
  try { execSync('npx -y wrangler@4.148.0 whoami', { cwd: 'C:/LInguaVelo/repo/worker', stdio: 'ignore', timeout: 120000 }); } catch {}
}
export function token() {
  const cfg = fs.readFileSync(process.env.APPDATA + '/xdg.config/.wrangler/config/default.toml', 'utf8');
  return cfg.match(/oauth_token\s*=\s*"([^"]+)"/)[1];
}

// Gemini vrací PCM 16bit (data URI audio/l16;rate=24000) nebo URL na WAV
export async function geminiPcm(text, voice, model = 'google/gemini-3.8-flash-tts') {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, input: { text, voice } }),
        signal: AbortSignal.timeout(90000),
      });
      const txt = await res.text();
      let j; try { j = JSON.parse(txt); } catch {}
      const audio = j?.result?.result?.audio || j?.result?.audio || j?.audio;
      if (!audio) throw new Error(`${res.status} ${txt.slice(0, 200)}`);
      if (audio.startsWith('http')) {
        const wav = Buffer.from(await (await fetch(audio, { signal: AbortSignal.timeout(60000) })).arrayBuffer());
        return wavToPcm(wav);
      }
      const [meta, b64] = audio.split(',');
      const raw = Buffer.from(b64, 'base64');
      // Gemini posílá data:audio/wav → vzít jen chunk "data" (hlavička = cvaknutí, C2PA na konci = šum)
      if (raw.toString('ascii', 0, 4) === 'RIFF') return wavToPcm(raw);
      return { pcm: raw, rate: +(meta.match(/rate=(\d+)/)?.[1] || 24000) };
    } catch (e) {
      const msg = String(e.message);
      if (attempt >= 6 || /^402/.test(msg)) throw e;
      if (/^40[13]/.test(msg)) refreshToken(); // OAuth token wrangleru vyprší po hodině
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

function wavToPcm(wav) {
  // projít RIFF chunky a vzít jen "data" (za ním bývá C2PA podpis)
  let i = 12, rate = wav.readUInt32LE(24);
  while (i < wav.length - 8) {
    const id = wav.toString('ascii', i, i + 4), size = wav.readUInt32LE(i + 4);
    if (id === 'data') { const end = Math.min(wav.length, i + 8 + size); return { pcm: wav.subarray(i + 8, end - ((end - i - 8) & 1)), rate }; }
    i += 8 + size + (size & 1);
  }
  throw new Error('WAV bez data chunku');
}

// délka MP3 v sekundách (projde rámce; MPEG-1/2/2.5 Layer III)
export function mp3Duration(buf) {
  const BR = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
  const SR = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
  let i = 0, secs = 0;
  while (i < buf.length - 4) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) { i++; continue; }
    const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3;
    const bri = buf[i + 2] >> 4, sri = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
    if (ver === 1 || layer !== 1 || bri === 0 || bri === 15 || sri === 3) { i++; continue; }
    const br = BR[ver === 3 ? 1 : 2][bri] * 1000, sr = SR[ver][sri];
    const spf = ver === 3 ? 1152 : 576;
    const len = Math.floor(spf / 8 * br / sr) + pad;
    secs += spf / sr;
    i += len;
  }
  return secs;
}

// ořízne ticho na začátku/konci (Gemini občas přidá dlouhé pauzy)
export function trimPcm(pcm, rate, thr = 400, padMs = 60) {
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  let a = 0, b = s.length - 1;
  while (a < s.length && Math.abs(s[a]) < thr) a++;
  while (b > a && Math.abs(s[b]) < thr) b--;
  const pad = Math.round(rate * padMs / 1000);
  a = Math.max(0, a - pad); b = Math.min(s.length - 1, b + pad);
  return Buffer.from(s.slice(a, b + 1).buffer);
}

export function pcmToMp3(pcm, rate, kbps = 48) {
  const s = new Int16Array(pcm.buffer, pcm.byteOffset, pcm.length >> 1);
  const enc = new Mp3Encoder(1, rate, kbps);
  const out = [];
  for (let i = 0; i < s.length; i += 1152) { const b = enc.encodeBuffer(s.subarray(i, i + 1152)); if (b.length) out.push(Buffer.from(b)); }
  const e = enc.flush(); if (e.length) out.push(Buffer.from(e));
  return Buffer.concat(out);
}

// FNV-1a 64bit (stejná funkce je v appce) → název souboru
export function clipKey(voice, text) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  const s = voice + '|' + text;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}
