// Quote verification and lightweight retrieval. Mirrors backend/research/text.py.

const QUOTE_MAP = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '−': '-', ' ': ' ' };
const STOP = new Set(('a an and are as at be been but by for from had has have in into is it its of on or that the their there these they this those to was were which while with within without we our not no than then so such can could may might also more most other some any each both between using used use study studies paper results result found find shows show showed however thus therefore what how does do did why when who whom whose').split(' '));

export function normalize(text) {
  let t = String(text || '').normalize('NFKC');
  t = t.replace(/[‘’“”–—− ]/g, (c) => QUOTE_MAP[c]).replace(/­/g, '');
  t = t.replace(/-\s*\n\s*/g, '').replace(/\s+/g, ' ').trim();
  return t.toLowerCase();
}

/** True if every fragment of `quote` (split on ellipses) occurs verbatim in `text`. */
export function quoteInText(quote, text, minChars = 12) {
  const hay = normalize(text);
  const frags = String(quote || '').split(/\s*(?:\.\.\.|…)\s*/).map((f) => normalize(f).replace(/^[\s"'.,;:]+|[\s"'.,;:]+$/g, '')).filter(Boolean);
  if (!frags.length || frags.reduce((n, f) => n + f.length, 0) < minChars) return false;
  return frags.every((f) => hay.includes(f));
}

export function tokens(text) {
  const out = [];
  for (let w of String(text || '').toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (w.length < 3 || STOP.has(w)) continue;
    if (w.length > 4 && w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.length > 3 && w.endsWith('es')) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    out.push(w);
  }
  return out;
}

export class TfIdf {
  constructor(texts) {
    const docs = texts.map((t) => { const m = new Map(); for (const w of tokens(t)) m.set(w, (m.get(w) || 0) + 1); return m; });
    const df = new Map();
    for (const d of docs) for (const w of d.keys()) df.set(w, (df.get(w) || 0) + 1);
    this.idf = new Map([...df].map(([w, c]) => [w, Math.log((docs.length + 1) / (c + 1)) + 1]));
    this.vectors = docs.map((d) => this.vector(d));
  }

  vector(counts) {
    const vec = new Map();
    let norm = 0;
    for (const [w, c] of counts) { const v = (1 + Math.log(c)) * (this.idf.get(w) ?? 1); vec.set(w, v); norm += v * v; }
    norm = Math.sqrt(norm) || 1;
    for (const [w, v] of vec) vec.set(w, v / norm);
    return vec;
  }

  cosine(i, j) {
    let [a, b] = [this.vectors[i], this.vectors[j]];
    if (a.size > b.size) [a, b] = [b, a];
    let s = 0;
    for (const [w, v] of a) s += v * (b.get(w) || 0);
    return s;
  }

  sharedTerms(i, j, n = 5) {
    const [a, b] = [this.vectors[i], this.vectors[j]];
    return [...a].filter(([w]) => b.has(w)).map(([w, v]) => [v * b.get(w), w]).sort((x, y) => y[0] - x[0]).slice(0, n).map((x) => x[1]);
  }

  /** Score a free-text query against every indexed text. */
  query(text) {
    const counts = new Map();
    for (const w of tokens(text)) counts.set(w, (counts.get(w) || 0) + 1);
    const q = this.vector(counts);
    return this.vectors.map((v) => { let s = 0; for (const [w, x] of q) s += x * (v.get(w) || 0); return s; });
  }
}
