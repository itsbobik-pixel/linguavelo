// Ruční oprava hesel, která Gemini čte anglicky: zkusí italské varianty textu (přízvuky, interpunkce),
// soubor se ale uloží pod klíčem PŮVODNÍHO textu (appka ho tak najde).
import fs from 'node:fs';
import { geminiPcm, trimPcm, pcmToMp3, clipKey } from './lib.mjs';
const FIX = {
  'La camera': ['la càmera', 'La càmera', 'la camera', 'La càmera.'],
  "Dov'è?": ["Dov'è?", "Dov'è", 'Dove è?', "Dov'è…?"],
  'Vuoi…?': ['Vuoi?', 'Vuòi?', 'Vuoi…?', 'Vuoi?!'],
};
const norm = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const transcribe = buf => fetch('https://flat-paper-f764.itsbobik.workers.dev/transcribe?lang=it', { method: 'POST', headers: { 'Content-Type': 'audio/mpeg' }, body: buf }).then(r => r.json()).then(j => j.text || '').catch(() => '');
for (const [orig, variants] of Object.entries(FIX)) {
  let saved = false;
  for (const v of [...variants, ...variants, ...variants]) {
    const { pcm, rate } = await geminiPcm(v, 'Puck');
    const mp3 = pcmToMp3(trimPcm(pcm, rate), rate, 48);
    const tr = await transcribe(mp3);
    if (norm(tr) === norm(orig)) { fs.writeFileSync(`C:/LInguaVelo/repo/audio/${clipKey('Puck', orig)}.mp3`, mp3); console.log('OK', orig, '←', v, '→', tr); saved = true; break; }
    console.log('  ×', orig, '←', v, '→', tr);
  }
  if (!saved) console.log('NEPOVEDLO SE', orig);
}
