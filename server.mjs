import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const MAX_BODY = 120_000;
const TIMEOUT_MS = 45_000;

function send(res, status, data, type = 'application/json; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('Solicitud demasiado grande.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { reject(new Error('JSON inválido.')); }
    });
    req.on('error', reject);
  });
}

function extractText(response) {
  if (typeof response?.output_text === 'string') return response.output_text;
  const chunks = [];
  for (const item of response?.output || []) {
    for (const c of item?.content || []) {
      if (typeof c?.text === 'string') chunks.push(c.text);
    }
  }
  return chunks.join('\n');
}

function parseJson(text) {
  const cleaned = String(text)
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/, '')
    .replace(/```$/i, '')
    .trim();
  try { return JSON.parse(cleaned); } catch {}
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(cleaned.slice(a, b + 1));
  throw new Error('La IA no devolvió una configuración válida.');
}

function number100(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(1, Math.min(100, Math.round(x))) : null;
}

function cleanText(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function callOpenAI(prompt) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        input: prompt,
        max_output_tokens: 500
      })
    });

    const raw = await response.text();
    let parsed;
    try { parsed = JSON.parse(raw); } catch { parsed = null; }

    if (!response.ok) {
      const apiMessage = parsed?.error?.message || 'Error de la API de OpenAI.';
      const error = new Error(apiMessage);
      error.status = response.status;
      throw error;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

function buildPrompt({ brand, model, hz, level, previous, forceDifferent }) {
  return `Eres el motor de IA de SYSTEM WOODS, una aplicación que genera recomendaciones de sensibilidad para Free Fire.

DATOS DEL USUARIO
- Marca: ${brand}
- Modelo: ${model}
- Tasa de refresco: ${hz} Hz
- Perfil: ${level}
${previous ? `- Configuración anterior: ${JSON.stringify(previous)}` : '- No existe configuración anterior.'}
${forceDifferent ? '- IMPORTANTE: genera una nueva variante; debe ser diferente de la configuración anterior, pero seguir siendo coherente con el mismo dispositivo.' : ''}

OBJETIVO
Crea una configuración orientativa y personalizada. Considera el tipo de dispositivo y la tasa de refresco, pero NO afirmes que conoces sensores, temperatura, FPS, pantalla táctil, archivos del teléfono o datos privados que no fueron proporcionados. No prometas headshots, precisión perfecta ni ventajas garantizadas.

SALIDA
Devuelve ÚNICAMENTE JSON válido, sin Markdown, sin comentarios y sin texto fuera del objeto:
{
  "general": number,
  "redDot": number,
  "scope2x": number,
  "scope4x": number,
  "awm": number,
  "freeCamera": number,
  "range": "baja" | "media" | "alta",
  "buttonSize": number,
  "dpi": string,
  "explanation": string
}

REGLAS
- Todas las sensibilidades y buttonSize: enteros de 1 a 100.
- buttonSize es porcentaje.
- Si no hay una razón clara para un DPI específico, usa exactamente "Sin DPI (Por defecto)".
- Mantén diferencias razonables entre General, Punto rojo y las miras.
- La explicación debe ser breve, clara y en español.
- Si hay configuración anterior y se pidió una variante, cambia algunos valores sin salir de 1-100.`;
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (u.pathname === '/api/health' && req.method === 'GET') {
      return send(res, 200, {
        ok: true,
        aiConfigured: Boolean(API_KEY),
        model: MODEL
      });
    }

    if (u.pathname === '/api/generate' && req.method === 'POST') {
      if (!API_KEY) {
        return send(res, 503, {
          error: 'La IA no está configurada todavía. Agrega OPENAI_API_KEY en las variables de entorno del servidor.'
        });
      }

      const body = await readBody(req);
      const brand = cleanText(body.brand, 80);
      const model = cleanText(body.model, 100);
      const hz = Number(body.hz);
      const level = cleanText(body.level, 20).toLowerCase();
      const previous = body.previous && typeof body.previous === 'object' ? body.previous : null;
      const forceDifferent = Boolean(body.forceDifferent);

      if (!brand || !model || ![60, 90, 120, 144, 165].includes(hz) || !['baja', 'media', 'alta'].includes(level)) {
        return send(res, 400, { error: 'Datos de dispositivo o perfil inválidos.' });
      }

      const response = await callOpenAI(buildPrompt({ brand, model, hz, level, previous, forceDifferent }));
      const data = parseJson(extractText(response));

      const out = {
        general: number100(data.general),
        redDot: number100(data.redDot),
        scope2x: number100(data.scope2x),
        scope4x: number100(data.scope4x),
        awm: number100(data.awm),
        freeCamera: number100(data.freeCamera),
        range: ['baja', 'media', 'alta'].includes(data.range) ? data.range : level,
        buttonSize: number100(data.buttonSize) ?? 48,
        dpi: cleanText(data.dpi, 60) || 'Sin DPI (Por defecto)',
        explanation: cleanText(data.explanation, 500) || 'Configuración generada por IA.'
      };

      if ([out.general, out.redDot, out.scope2x, out.scope4x, out.awm, out.freeCamera].some(v => v === null)) {
        return send(res, 502, { error: 'La IA devolvió una configuración incompleta. Intenta generar otra.' });
      }

      return send(res, 200, out);
    }

    if (req.method === 'GET') {
      const requested = u.pathname === '/' ? '/index.html' : u.pathname;
      const file = path.resolve(ROOT, '.' + requested);
      if (!file.startsWith(ROOT)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        const ext = path.extname(file);
        const types = {
          '.html': 'text/html; charset=utf-8',
          '.js': 'text/javascript; charset=utf-8',
          '.css': 'text/css; charset=utf-8',
          '.json': 'application/json; charset=utf-8'
        };
        return send(res, 200, fs.readFileSync(file), types[ext] || 'application/octet-stream');
      }
    }

    return send(res, 404, { error: 'No encontrado' });
  } catch (error) {
    console.error(error);
    const status = error.name === 'AbortError' ? 504 : (error.status || 500);
    let message = 'Error interno del servidor.';
    if (error.name === 'AbortError') message = 'La IA tardó demasiado en responder. Intenta nuevamente.';
    else if (error.status === 401) message = 'La clave de OpenAI no es válida o no está autorizada.';
    else if (error.status === 429) message = 'La API de OpenAI está limitada temporalmente. Intenta nuevamente en unos segundos.';
    else if (error.message && !String(error.message).toLowerCase().includes('api key')) message = error.message;
    return send(res, status, { error: message });
  }
});

server.listen(PORT, () => {
  console.log(`SYSTEM WOODS funcionando en http://localhost:${PORT}`);
  console.log(`Modelo IA: ${MODEL}`);
  console.log(`IA configurada: ${Boolean(API_KEY)}`);
});
