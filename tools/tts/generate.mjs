// Vygeneruje MP3 pro všechny fráze (it + zadání) a repliky konverzací → repo/audio/<klíč>.mp3
// Klíč = clipKey(hlas, původní text) – appka počítá stejný. Lze pustit znovu: hotové soubory přeskočí.
import fs from 'node:fs';
import { geminiPcm, trimPcm, pcmToMp3, clipKey } from './lib.mjs';
import { buildTracks } from './build_tracks.mjs';

const HTML = 'C:/LInguaVelo/repo/LinguaVelo.html';
const OUT = 'C:/LInguaVelo/repo/audio/';
fs.mkdirSync(OUT, { recursive: true });

// hlasy (stejná mapa je v appce)
export const VOICE_IT = 'Puck', VOICE_SRC = 'Kore';
export const CAST_VOICE = { Bob: 'Puck', Giulia: 'Kore', Anna: 'Aoede', Marco: 'Charon', Luca: 'Fenrir', Signora: 'Leda' };

const s = fs.readFileSync(HTML, 'utf8');
const a = s.indexOf('const LESSONS = ['); const b = s.slice(a).search(/\];\r?\n/) + a + 2;
const LESSONS = new Function(s.slice(a, b) + ';return LESSONS;')();

const items = new Map(); // key → {voice, text}
const add = (voice, text) => items.set(clipKey(voice, text), { voice, text });
for (const l of LESSONS) {
  for (const p of l.phrases) { add(VOICE_IT, p.it); add(VOICE_SRC, p.src); }
  for (const d of l.dialogs || []) for (const ln of d.lines) add(CAST_VOICE[d.cast[ln.s]] || VOICE_IT, ln.it);
}
// lomítka / pomlčky jako krátká pauza, ať je TTS nečte
const speakText = t => t.replace(/\s+[\/–]\s+/g, ', ');

// ticho pro pauzy mezi frázemi (iOS na pozadí uspí časovače, zvuk ne)
for (const ms of [400, 500, 900, 1500]) {
  const f = `${OUT}silence-${ms}.mp3`;
  if (!fs.existsSync(f)) fs.writeFileSync(f, pcmToMp3(Buffer.alloc(Math.round(24000 * ms / 1000) * 2), 24000, 48));
}

const todo = [...items.entries()].filter(([k]) => !fs.existsSync(`${OUT}${k}.mp3`));
console.log(`celkem ${items.size}, hotovo ${items.size - todo.length}, zbývá ${todo.length}`);
let done = 0, failed = [];
const CONC = +(process.env.CONC || 8);
async function worker() {
  while (todo.length) {
    const [key, it] = todo.shift();
    try {
      const { pcm, rate } = await geminiPcm(speakText(it.text), it.voice);
      const mp3 = pcmToMp3(trimPcm(pcm, rate), rate, 48);
      if (mp3.length < 1500) throw new Error('prázdné audio');
      fs.writeFileSync(`${OUT}${key}.mp3`, mp3);
    } catch (e) {
      failed.push(`${it.voice} | ${it.text} | ${String(e.message).slice(0, 120)}`);
      if (/^402/.test(String(e.message))) { console.log('DOŠEL KREDIT'); todo.length = 0; }
    }
    if (++done % 50 === 0) console.log(`${done} / ${done + todo.length}`);
  }
}
await Promise.all(Array.from({ length: CONC }, worker));
const keys = [...items.keys()].filter(k => fs.existsSync(`${OUT}${k}.mp3`)).sort();
fs.writeFileSync(`${OUT}index.json`, JSON.stringify(keys));
let bytes = 0; for (const k of keys) bytes += fs.statSync(`${OUT}${k}.mp3`).size;
console.log(`HOTOVO: ${keys.length} / ${items.size} souborů, ${(bytes / 1048576).toFixed(1)} MB, chyby: ${failed.length}`);
buildTracks();
if (failed.length) { fs.writeFileSync(`${OUT}../audio-failed.txt`, failed.join('\n')); console.log(failed.slice(0, 10).join('\n')); }
