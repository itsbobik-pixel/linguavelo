// Krátká italská hesla (1–2 slova): ověřit Whisperem, špatná přegenerovat (max 4×)
import fs from 'node:fs';
import { geminiPcm, trimPcm, pcmToMp3, clipKey } from './lib.mjs';
const s = fs.readFileSync('C:/LInguaVelo/repo/LinguaVelo.html', 'utf8');
const a = s.indexOf('const LESSONS = ['); const b = s.slice(a).search(/\];\r?\n/) + a + 2;
const LESSONS = new Function(s.slice(a, b) + ';return LESSONS;')();
const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim();
const short = [...new Set(LESSONS.flatMap(l => l.phrases.map(p => p.it)).filter(t => t.replace(/[\/–…?!.,]/g, ' ').trim().split(/\s+/).length <= 2))];
const transcribe = buf => fetch('https://flat-paper-f764.itsbobik.workers.dev/transcribe?lang=it', { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: buf }).then(r => r.json()).then(j => j.text || '').catch(() => null);
const ok = (text, tr) => tr !== null && norm(tr).replace(/ /g, '') === norm(text.replace(/\s+[\/–]\s+/g, ' ')).replace(/ /g, '');
let bad = 0, fixed = 0;
for (const text of short) {
  const f = `C:/LInguaVelo/repo/audio/${clipKey('Puck', text)}.mp3`;
  let tr = await transcribe(fs.readFileSync(f));
  if (tr === null || ok(text, tr)) continue;
  bad++;
  let best = null;
  for (let i = 0; i < 4 && !best; i++) {
    const { pcm, rate } = await geminiPcm(text.replace(/\s+[\/–]\s+/g, ', '), 'Puck');
    const mp3 = pcmToMp3(trimPcm(pcm, rate), rate, 48);
    const t2 = await transcribe(mp3);
    if (ok(text, t2)) { best = mp3; tr = t2; }
  }
  if (best) { fs.writeFileSync(f, best); fixed++; console.log('OPRAVENO', text, '→', tr); }
  else console.log('PONECHÁNO', text, '→', tr);
}
console.log(`krátkých ${short.length}, nesedělo ${bad}, opraveno ${fixed}`);
