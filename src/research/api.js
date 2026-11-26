// Client for the optional AI service. Every failure becomes an ApiError with a message that is safe to show.
export class ApiError extends Error {
  constructor(message, { status = 0, offline = false } = {}) { super(message); this.status = status; this.offline = offline; }
}

const clean = (base) => (base || 'http://127.0.0.1:8000').replace(/\/$/, '');

async function request(base, path, init = {}, timeoutMs = 300000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(`${clean(base)}${path}`, { ...init, signal: controller.signal });
  } catch (error) {
    if (error.name === 'AbortError') throw new ApiError('The AI service took too long to respond.', { offline: false });
    throw new ApiError(`Could not reach the AI service at ${clean(base)}. Start the backend (see README) or check the URL in Settings.`, { offline: true });
  } finally { clearTimeout(timer); }
  let body = null;
  try { body = await response.json(); } catch { /* not JSON */ }
  if (!response.ok) {
    const detail = typeof body?.detail === 'string' ? body.detail : Array.isArray(body?.detail) ? 'The request was not accepted by the AI service.' : `AI service returned ${response.status}.`;
    throw new ApiError(detail, { status: response.status });
  }
  return body;
}

const json = (payload) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
const R = '/research-map';

export const api = {
  health: (base) => request(base, '/health', {}, 6000),
  parsePdf: (base, file) => { const form = new FormData(); form.append('file', file); return request(base, `${R}/pdf/parse`, { method: 'POST', body: form }, 90000); },
  extract: (base, payload) => request(base, `${R}/extract`, json(payload)),
  discover: (base, payload) => request(base, `${R}/discover-threads`, json(payload)),
  investigate: (base, payload) => request(base, `${R}/investigate-thread`, json(payload)),
  gaps: (base, payload) => request(base, `${R}/explore-gaps`, json(payload)),
  outline: (base, payload) => request(base, `${R}/generate-outline`, json(payload)),
  ask: (base, payload) => request(base, `${R}/ask`, json(payload)),
  searchSources: (base, query) => request(base, '/research', json({ query }), 40000),
  fetchFullText: (base, url) => request(base, `${R}/fetch-fulltext`, json({ url }), 90000),
};
