import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY_BYTES = 30 * 1024 * 1024;

async function loadEnvFile() {
  try {
    const content = await readFile(path.join(__dirname, '.env'), 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

// Voice IDs resmi Azure Speech. Client tidak boleh mengirim ID suara sembarang.
const VOICES = {
  id: {
    locale: 'id-ID',
    voices: {
      'id-ID-GadisNeural': { label: 'Gadis', gender: 'Female', description: 'Wanita · natural dan ramah' },
      'id-ID-ArdiNeural': { label: 'Ardi', gender: 'Male', description: 'Pria · natural dan tegas' },
      'id-ID-Cahya:MAI-Voice-2-Flash': { label: 'Cahya', gender: 'Male', description: 'Pria · karakter suara alternatif' },
      'id-ID-Sari:MAI-Voice-2-Flash': { label: 'Sari', gender: 'Female', description: 'Wanita · karakter suara alternatif' }
    }
  },
  su: {
    locale: 'su-ID',
    voices: {
      'su-ID-JajangNeural': { label: 'Jajang', gender: 'Male', description: 'Pria · Bahasa Sunda' },
      'su-ID-TutiNeural': { label: 'Tuti', gender: 'Female', description: 'Wanita · Bahasa Sunda' }
    }
  }
};

// Vibe diterapkan sebagai arahan prosodi SSML, bukan filter audio pascaproses.
const VIBES = {
  natural: { rate: '0%', pitch: '0%', volume: '0dB', pause: false },
  ceria: { rate: '+8%', pitch: '+7%', volume: '+1dB', pause: false },
  sedih: { rate: '-10%', pitch: '-6%', volume: '-2dB', pause: false },
  puitis: { rate: '-7%', pitch: '+1%', volume: '-1dB', pause: true },
  semangat: { rate: '+12%', pitch: '+5%', volume: '+1dB', pause: false },
  tenang: { rate: '-5%', pitch: '-1%', volume: '-1dB', pause: true },
  tegas: { rate: '-1%', pitch: '-2%', volume: '+1dB', pause: false }
};

function escapeXml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

// Memecah naskah pada batas kalimat/paragraf agar permintaan TTS tetap kecil.
// Tidak ada maxlength di UI; teks panjang diproses berurutan di backend.
function splitText(text, maxChars = 1800) {
  let rest = text.trim();
  const chunks = [];
  while (rest.length > maxChars) {
    const sample = rest.slice(0, maxChars + 1);
    const minCut = Math.floor(maxChars * 0.55);
    let cut = -1;

    const paragraphCut = sample.lastIndexOf('\n\n');
    if (paragraphCut >= minCut) cut = paragraphCut + 2;

    if (cut < 0) {
      const sentenceMatches = [...sample.matchAll(/[.!?。！？][\"'”’）)]?\s|\n/g)];
      const lastSentence = sentenceMatches.at(-1);
      if (lastSentence && lastSentence.index >= minCut) {
        cut = lastSentence.index + lastSentence[0].length;
      }
    }

    if (cut < 0) {
      const wordCut = sample.lastIndexOf(' ');
      cut = wordCut >= minCut ? wordCut + 1 : maxChars;
    }

    const part = rest.slice(0, cut).trim();
    if (part) chunks.push(part);
    rest = rest.slice(cut).trim();
  }
  if (rest) chunks.push(rest);
  return chunks;
}

function makeSsml(text, locale, voiceId, vibe) {
  const profile = VIBES[vibe];
  let safeText = escapeXml(text);
  if (profile.pause) safeText = safeText.replace(/\r?\n+/g, '<break time="320ms"/>');

  const gender = voiceId.includes('Jajang') || voiceId.includes('Ardi') || voiceId.includes('Cahya') ? 'Male' : 'Female';
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="${locale}">` +
    `<voice name="${voiceId}" xml:lang="${locale}" xml:gender="${gender}">` +
    `<prosody rate="${profile.rate}" pitch="${profile.pitch}" volume="${profile.volume}">${safeText}</prosody>` +
    `</voice></speak>`;
}

function createWavFromPcm(pcm, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function sendJson(res, statusCode, data) {
  const body = Buffer.from(JSON.stringify(data));
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const parts = [];
    let size = 0;
    req.on('data', (part) => {
      size += part.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Ukuran narasi melewati batas permintaan server (30 MB).'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      parts.push(part);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(parts).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Format data permintaan tidak valid.'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function synthesize(body, res) {
  const { text, language, voice, vibe = 'natural' } = body ?? {};
  if (typeof text !== 'string' || !text.trim()) return sendJson(res, 400, { error: 'Tuliskan narasi terlebih dahulu.' });
  if (!['id', 'su'].includes(language)) return sendJson(res, 400, { error: 'Bahasa tidak dikenali.' });
  if (!VIBES[vibe]) return sendJson(res, 400, { error: 'Pilihan vibe tidak dikenali.' });

  const languageConfig = VOICES[language];
  if (!Object.hasOwn(languageConfig.voices, voice)) {
    return sendJson(res, 400, { error: 'Karakter suara tidak tersedia untuk bahasa tersebut.' });
  }

  const speechKey = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!speechKey || !region) {
    return sendJson(res, 503, { error: 'Server belum dikonfigurasi. Isi AZURE_SPEECH_KEY dan AZURE_SPEECH_REGION di file .env.' });
  }

  const chunks = splitText(text);
  const pcmParts = [];
  const endpoint = `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`;

  for (let i = 0; i < chunks.length; i += 1) {
    const ssml = makeSsml(chunks[i], languageConfig.locale, voice, vibe);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': speechKey,
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'raw-24khz-16bit-mono-pcm',
          'User-Agent': 'SuaraStudioTTS/1.0'
        },
        body: ssml,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const providerMessage = (await response.text()).slice(0, 500);
      const status = response.status;
      return sendJson(res, status >= 400 && status < 500 ? 502 : 503, {
        error: `Layanan suara gagal pada bagian ${i + 1} dari ${chunks.length}. ${providerMessage || `HTTP ${status}`}`
      });
    }

    const pcm = Buffer.from(await response.arrayBuffer());
    if (!pcm.length) return sendJson(res, 502, { error: `Layanan suara mengembalikan audio kosong pada bagian ${i + 1}.` });
    pcmParts.push(pcm);
  }

  const wav = createWavFromPcm(Buffer.concat(pcmParts));
  const safeBaseName = language === 'su' ? 'narasi-bahasa-sunda' : 'narasi-bahasa-indonesia';
  res.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Content-Length': wav.length,
    'Content-Disposition': `attachment; filename="${safeBaseName}.wav"`,
    'X-Audio-Sample-Rate': '24000',
    'Cache-Control': 'no-store'
  });
  res.end(wav);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

async function serveStatic(urlPath, res) {
  const decodedPath = decodeURIComponent(urlPath);
  const relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
  const filePath = path.resolve(PUBLIC_DIR, relativePath);
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== path.join(PUBLIC_DIR, 'index.html')) {
    return sendJson(res, 403, { error: 'Akses file ditolak.' });
  }
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return sendJson(res, 404, { error: 'File tidak ditemukan.' });
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream',
      'Content-Length': fileStat.size,
      'Cache-Control': 'no-cache'
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    if (error.code === 'ENOENT') return sendJson(res, 404, { error: 'File tidak ditemukan.' });
    throw error;
  }
}

await loadEnvFile();
const PORT = Number(process.env.PORT || 3000);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(res, 200, {
        ok: true,
        configured: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION)
      });
    }
    if (req.method === 'POST' && url.pathname === '/api/synthesize') {
      const body = await readJsonBody(req);
      return await synthesize(body, res);
    }
    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      return await serveStatic(url.pathname, res);
    }
    return sendJson(res, 404, { error: 'Endpoint tidak ditemukan.' });
  } catch (error) {
    console.error('Server error:', error);
    if (!res.headersSent && !res.destroyed) {
      sendJson(res, error.statusCode || 500, { error: error.message || 'Terjadi kesalahan pada server.' });
    }
  }
});

server.listen(PORT, () => {
  console.log(`Suara Studio berjalan di http://localhost:${PORT}`);
});
