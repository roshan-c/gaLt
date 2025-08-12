import OpenAI from 'openai';

const CB_ERROR_CODES = new Set([400, 403, 404, 429, 500, 503, 504]);

async function transcribeAudioWithOpenAI(wavBuffer: Buffer): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const file = await OpenAI.toFile(wavBuffer, 'audio.wav');
  try {
    const res = await openai.audio.transcriptions.create({
      model: 'whisper-1',
      file,
      response_format: 'text',
      temperature: 0,
    } as any);
    const text = (res as any)?.text || '';
    return typeof text === 'string' ? text : '';
  } catch (err) {
    return '';
  }
}

export async function transcribeAudioWithGemini(wavBuffer: Buffer, googleApiKey: string): Promise<string> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(googleApiKey)}`;
  const base64 = wavBuffer.toString('base64');
  const payload = {
    contents: [
      {
        role: 'user',
        parts: [
          { inline_data: { mime_type: 'audio/wav', data: base64 } },
          { text: 'Transcribe the audio to plain text. Return only the transcription.' },
        ],
      },
    ],
  } as any;

  let res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    // Retry once after brief delay on 503/overload
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 1000));
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
  }
  if (!res.ok) {
    const status = res.status;
    // Fallback to OpenAI if configured and status is in breaker set
    if (CB_ERROR_CODES.has(status) && process.env.OPENAI_API_KEY) {
      return await transcribeAudioWithOpenAI(wavBuffer);
    }
    const txt = await res.text().catch(() => '');
    throw new Error(`Gemini transcription failed: ${res.status} ${res.statusText} ${txt}`);
  }
  const data: any = await res.json().catch(() => ({} as any));
  try {
    const text: string | undefined = data && data.candidates && data.candidates[0] && data.candidates[0].content && Array.isArray(data.candidates[0].content.parts)
      ? data.candidates[0].content.parts.map((p: any) => p?.text).filter(Boolean).join(' ')
      : '';
    return text || '';
  } catch {
    return '';
  }
}



