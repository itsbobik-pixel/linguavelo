// Poskládá z hotových nahrávek jeden souvislý MP3 pro každou lekci (Přehrát vše) a každou konverzaci.
// Jeden soubor = iOS ho dohraje i na pozadí / se zamčenou obrazovkou (mezi frázemi nic nepřepíná).
// Výstup: audio/t-<id>-<hash>.mp3 + audio/tracks.json { lessons: {id: {f, m:[časy]}}, dialogs: {"id:N": {f, m}} }
import fs from 'node:fs';
import { clipKey, mp3Duration } from './lib.mjs';

const HTML = 'C:/LInguaVelo/repo/LinguaVelo.html';
const OUT = 'C:/LInguaVelo/repo/audio/';
const VOICE_IT = 'Puck', VOICE_SRC = 'Kore';
const CAST_VOICE = { Bob: 'Puck', Giulia: 'Kore', Anna: 'Aoede', Marco: 'Charon', Luca: 'Fenrir', Signora: 'Leda' };

export function buildTracks() {
  const s = fs.readFileSync(HTML, 'utf8');
  const a = s.indexOf('const LESSONS = ['); const b = s.slice(a).search(/\];\r?\n/) + a + 2;
  const LESSONS = new Function(s.slice(a, b) + ';return LESSONS;')();

  const durCache = new Map();
  const part = name => {
    const f = OUT + name + '.mp3';
    if (!fs.existsSync(f)) return null;
    if (!durCache.has(name)) { const buf = fs.readFileSync(f); durCache.set(name, { buf, d: mp3Duration(buf) }); }
    return { name, ...durCache.get(name) };
  };
  // seq = [[značka?, název souboru], ...] → jeden MP3 + časy značek
  function build(id, seq) {
    const parts = [], marks = [];
    let t = 0;
    for (const [mark, name] of seq) {
      const p = part(name);
      if (!p) return null; // chybí nahrávka → stopa se nedělá (appka hraje po frázích)
      if (mark !== null) marks[mark] = +t.toFixed(3);
      parts.push(p); t += p.d;
    }
    const hash = clipKey('track', parts.map(p => p.name).join(',')).slice(0, 10);
    const f = `t-${id}-${hash}.mp3`;
    if (!fs.existsSync(OUT + f)) fs.writeFileSync(OUT + f, Buffer.concat(parts.map(p => p.buf)));
    return { f, m: marks, d: +t.toFixed(2) };
  }

  const tracks = { lessons: {}, dialogs: {} };
  for (const l of LESSONS) {
    const seq = [];
    l.phrases.forEach((p, i) => {
      seq.push([i, clipKey(VOICE_SRC, p.src)], [null, 'silence-500'], [null, clipKey(VOICE_IT, p.it)], [null, 'silence-900']);
    });
    seq.push([null, 'silence-1500']); // pauza před dalším kolem (🔁)
    const t = build(l.id, seq);
    if (t) tracks.lessons[l.id] = t;
    (l.dialogs || []).forEach((d, di) => {
      const dseq = [];
      d.lines.forEach((ln, i) => dseq.push([i, clipKey(CAST_VOICE[d.cast[ln.s]] || VOICE_IT, ln.it)], [null, 'silence-500']));
      dseq.push([null, 'silence-1500']);
      const dt = build(`${l.id}-${di}`, dseq);
      if (dt) tracks.dialogs[`${l.id}:${di}`] = dt;
    });
  }
  // smazat staré stopy, na které už nic neodkazuje
  const used = new Set([...Object.values(tracks.lessons), ...Object.values(tracks.dialogs)].map(t => t.f));
  let removed = 0;
  for (const f of fs.readdirSync(OUT)) if (/^t-.*\.mp3$/.test(f) && !used.has(f)) { fs.unlinkSync(OUT + f); removed++; }
  fs.writeFileSync(OUT + 'tracks.json', JSON.stringify(tracks));
  const n = Object.keys(tracks.lessons).length, m = Object.keys(tracks.dialogs).length;
  console.log(`stopy: ${n} lekcí, ${m} konverzací (smazáno starých: ${removed})`);
  return tracks;
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) buildTracks();
