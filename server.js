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

// Hanya dua suara yang dipilih untuk Suara Studio.
const VOICES = {
  'hpp4J3VqNfWAUOO0d1Us': { label: 'Bella', gender: 'Wanita' },
  'JBFqnCBsd6RMkjVDRZzb': { label: 'George', gender: 'Pria' }
};

// Vibe mengatur speed, stability, dan style pada permintaan ElevenLabs.
// Rentang speed yang didukung API adalah 0.7 sampai 1.2.
const VIBES = {
  natural:  { speed: 1.00, stability: 0.55, style: 0.00 },
  ceria:    { speed: 1.08, stability: 0.35, style: 0.25 },
  sedih:    { speed: 0.88, stability: 0.65, style: 0.10 },
  puitis:   { speed: 0.92, stability: 0.45, style: 0.20 },
  semangat: { speed: 1.12, stability: 0.30, style: 0.30 },
  tenang:   { speed: 0.90, stability: 0.72, style: 0.05 },
  tegas:    { speed: 0.98, stability: 0.78, style: 0.05 }
};

function splitText(text, maxChars = 4500) {
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
    let tooLarge = false;

    req.on('data', (part) => {
      size += part.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(Object.assign(new Error('Ukuran narasi melewati batas server (30 MB).'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      parts.push(part);
    });

    req.on('end', () => {
      if (tooLarge) return;
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

  if (typeof text !== 'string' || !text.trim()) {
    return sendJson(res, 400, { error: 'Tuliskan narasi terlebih dahulu.' });
  }
  if (!['id', 'su'].includes(language)) {
    return sendJson(res, 400, { error: 'Bahasa tidak dikenali.' });
  }
  if (!Object.hasOwn(VIBES, vibe)) {
    return sendJson(res, 400, { error: 'Pilihan vibe tidak dikenali.' });
  }
  if (!Object.hasOwn(VOICES, voice)) {
    return sendJson(res, 400, { error: 'Karakter suara tidak tersedia.' });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return sendJson(res, 503, {
      error: 'Server belum dikonfigurasi. Pastikan ELEVENLABS_API_KEY sudah diisi pada Environment Variables Render.'
    });
  }

  const chunks = splitText(text);
  const audioParts = [];
  const settings = VIBES[vibe];

  for (let i = 0; i < chunks.length; i += 1) {
    const endpoint = `https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_22050_32`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text: chunks[i],
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: settings.stability,
            similarity_boost: 0.75,
            style: settings.style,
            use_speaker_boost: true,
            speed: settings.speed
          }
        }),
        signal: controller.signal
      });
    } catch (error) {
      const message = error.name === 'AbortError'
        ? 'Permintaan ke ElevenLabs melewati batas waktu.'
        : 'Tidak dapat terhubung ke layanan ElevenLabs.';
      return sendJson(res, 503, { error: `${message} (bagian ${i + 1} dari ${chunks.length}).` });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const providerMessage = (await response.text()).slice(0, 700);
      let explanation = providerMessage;
      try {
        const parsed = JSON.parse(providerMessage);
        explanation = parsed.detail?.message || parsed.detail?.status || parsed.message || providerMessage;
      } catch {
        // Gunakan pesan asli jika respons bukan JSON.
      }

      let message = `ElevenLabs gagal memproses bagian ${i + 1} dari ${chunks.length}.`;
      if (response.status === 401) message += ' API Key tidak valid atau tidak memiliki izin.';
      else if (response.status === 403) message += ' Akses ke suara ini ditolak atau dibatasi oleh akun.';
      else if (response.status === 429) message += ' Batas penggunaan atau kredit akun mungkin sudah tercapai.';
      else if (response.status === 400 || response.status === 422) message += ' Parameter atau format permintaan tidak diterima.';
      if (explanation) message += ` Detail: ${explanation}`;
      return sendJson(res, 502, { error: message });
    }

    const audio = Buffer.from(await response.arrayBuffer());
    if (!audio.length) {
      return sendJson(res, 502, { error: `ElevenLabs mengembalikan audio kosong pada bagian ${i + 1}.` });
    }
    audioParts.push(audio);
  }

  // Segmen MP3 digabung berurutan menjadi satu respons MP3.
  const mp3 = Buffer.concat(audioParts);
  const safeBaseName = language === 'su' ? 'narasi-bahasa-sunda' : 'narasi-bahasa-indonesia';

  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Content-Length': mp3.length,
    'Content-Disposition': `attachment; filename="${safeBaseName}.mp3"`,
    'X-Audio-Format': 'MP3 22.05 kHz 32 kbps',
    'Cache-Control': 'no-store'
  });
  res.end(mp3);
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
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath);
  } catch {
    return sendJson(res, 400, { error: 'Alamat file tidak valid.' });
  }

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
        configured: Boolean(process.env.ELEVENLABS_API_KEY)
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
      sendJson(res, error.statusCode || 500, {
        error: error.message || 'Terjadi kesalahan pada server.'
      });
    }
  }
});

server.listen(PORT, () => {
  console.log(`Suara Studio berjalan di http://localhost:${PORT}`);
});
