const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

function toBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// POST /transcribe  — tělo = nahrávka (audio/mp4, audio/webm…), ?lang=it
async function transcribe(request, env) {
  const buf = await request.arrayBuffer();
  if (!buf.byteLength) return json({ error: 'empty audio' }, 400);
  if (buf.byteLength > 5 * 1024 * 1024) return json({ error: 'audio too large' }, 413);
  const language = new URL(request.url).searchParams.get('lang') || 'it';
  try {
    const r = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: toBase64(buf), language });
    return json({ text: (r.text || '').trim() });
  } catch (e) {
    // záloha: starší Whisper bere pole bajtů
    try {
      const r = await env.AI.run('@cf/openai/whisper', { audio: [...new Uint8Array(buf)] });
      return json({ text: (r.text || '').trim(), fallback: true });
    } catch (e2) {
      return json({ error: String(e2.message || e2) }, 500);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ ok: true });

    if (new URL(request.url).pathname === '/transcribe') return transcribe(request, env);

    const body = await request.json();
    const isChat = body.chat === true;

    let messages, systemPrompt, maxTokens;

    if (isChat) {
      systemPrompt = body.system;
      messages = body.messages;
      maxTokens = 300;
    } else {
      messages = [{
        role: 'user',
        content: `Preloz do italstiny, zvol kategorii a obtiznost. Odpovez POUZE jako JSON bez backticks: {"translation":"...","category":"...","difficulty":"easy|medium|hard"}\nKategorie: Pozdravy, Cestování, Restaurace, Kavárna, Nakupování, Hotel, Doprava, Rodina, Práce, Zdraví, Čísla a čas, Konverzace, Gramatika, Ostatní\nObtiznost: easy=kratke jednoduche fraze, medium=bezne fraze, hard=dlouhe nebo slozite fraze\nText: ${body.text}`
      }];
      maxTokens = 200;
    }

    const payload = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      messages: messages,
    };
    if (systemPrompt) payload.system = systemPrompt;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    const text = data.content[0].text.trim();

    if (isChat) return json({ reply: text });
    return json(JSON.parse(text));
  }
};
