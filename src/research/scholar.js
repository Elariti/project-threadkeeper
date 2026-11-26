// Finding papers (and their links) for the Research Desk.
//
// Instead of a general web search, this asks scholarly indexes that return real, structured records: OpenAlex first
// (free, no key, 250M+ works, abstracts and open-access PDF links), then Crossref if OpenAlex fails or finds nothing.
// Every link comes from the index record (DOI, landing page, open-access PDF), so there are no invented or broken
// "search snippet" links, and duplicates are merged by DOI and title. Both services allow requests from the app
// directly, so this works even when the optional AI backend is not running.
// Pure helpers are exported for the tests; nothing here touches React.

const OPENALEX = 'https://api.openalex.org/works';
const CROSSREF = 'https://api.crossref.org/works';
const OA_FIELDS = 'id,doi,display_name,publication_year,authorships,primary_location,best_oa_location,open_access,abstract_inverted_index,cited_by_count,type';

export function normalizeDoi(value) {
  if (!value) return '';
  let s = String(value).trim();
  try { s = decodeURIComponent(s); } catch { /* keep as is */ }
  s = s.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, '').trim().toLowerCase();
  s = s.replace(/[\s.,;)\]]+$/, '');
  return /^10\.\d{4,9}\/\S+$/.test(s) ? s : '';
}

/** Find a DOI (or an arXiv id) inside whatever the user pasted: a DOI, a doi.org link, a publisher URL, an arXiv link. */
export function identifierIn(text) {
  const s = String(text || '').trim();
  const doi = s.match(/10\.\d{4,9}\/[^\s"'<>]+/);
  if (doi) { const d = normalizeDoi(doi[0]); if (d) return { kind: 'doi', value: d }; }
  const arxiv = s.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?/i) || s.match(/^(?:arxiv:)?(\d{4}\.\d{4,5})(?:v\d+)?$/i);
  if (arxiv) return { kind: 'doi', value: `10.48550/arxiv.${arxiv[1]}` };
  return null;
}

export const normTitle = (t) => String(t || '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

export function safeUrl(u) {
  if (!u) return '';
  try { const x = new URL(String(u)); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : ''; } catch { return ''; }
}

/** OpenAlex stores abstracts as {word: [positions]}; rebuild the text. */
export function abstractFromIndex(inv) {
  if (!inv || typeof inv !== 'object') return '';
  const words = [];
  for (const [word, positions] of Object.entries(inv)) for (const p of positions || []) if (Number.isInteger(p) && p >= 0 && p < 20000) words[p] = word;
  return words.filter(Boolean).join(' ').replace(/\s+([.,;:!?)])/g, '$1').trim();
}

const stripTags = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const authorList = (names) => {
  const clean = names.map((n) => String(n || '').trim()).filter(Boolean);
  return clean.length > 6 ? `${clean.slice(0, 6).join(', ')} et al.` : clean.join(', ');
};

export function fromOpenAlex(w) {
  if (!w || !w.display_name) return null;
  const doi = normalizeDoi(w.doi);
  const loc = w.primary_location || {};
  const oa = w.best_oa_location || {};
  const pdf = safeUrl(oa.pdf_url) || safeUrl(loc.pdf_url);
  const landing = safeUrl(loc.landing_page_url) || safeUrl(oa.landing_page_url);
  return {
    id: w.id || doi || normTitle(w.display_name),
    title: stripTags(w.display_name).slice(0, 400),
    authors: authorList((w.authorships || []).map((a) => a?.author?.display_name)),
    year: Number.isInteger(w.publication_year) ? w.publication_year : null,
    venue: stripTags(loc.source?.display_name || '').slice(0, 200),
    doi,
    url: doi ? `https://doi.org/${doi}` : landing,
    landingUrl: landing,
    pdfUrl: pdf,
    openAccess: Boolean(w.open_access?.is_oa || pdf),
    abstract: abstractFromIndex(w.abstract_inverted_index).slice(0, 6000),
    citedBy: Number(w.cited_by_count) || 0,
    type: w.type || '',
    provider: 'OpenAlex',
  };
}

export function fromCrossref(it) {
  const title = stripTags((it?.title || [])[0]);
  if (!title) return null;
  const doi = normalizeDoi(it.DOI);
  const year = it.issued?.['date-parts']?.[0]?.[0];
  const pdf = safeUrl((it.link || []).find((l) => /pdf/i.test(l['content-type'] || ''))?.URL);
  return {
    id: doi || normTitle(title),
    title: title.slice(0, 400),
    authors: authorList((it.author || []).map((a) => [a.given, a.family].filter(Boolean).join(' ') || a.name)),
    year: Number.isInteger(year) ? year : null,
    venue: stripTags((it['container-title'] || [])[0]).slice(0, 200),
    doi,
    url: doi ? `https://doi.org/${doi}` : safeUrl(it.URL),
    landingUrl: safeUrl(it.URL),
    pdfUrl: pdf,
    openAccess: false, // Crossref does not say; a PDF link there is often behind a paywall
    abstract: stripTags(it.abstract).replace(/^abstract\s*/i, '').slice(0, 6000),
    citedBy: Number(it['is-referenced-by-count']) || 0,
    type: it.type || '',
    provider: 'Crossref',
  };
}

/** Merge duplicates (same DOI, or same title + year), keeping the richest record. */
export function dedupe(list) {
  const out = [];
  const byKey = new Map();
  const score = (r) => (r.abstract ? 2 : 0) + (r.pdfUrl ? 2 : 0) + (r.doi ? 1 : 0) + (r.authors ? 1 : 0);
  for (const r of list) {
    if (!r || !r.title) continue;
    const keys = [r.doi && `doi:${r.doi}`, `t:${normTitle(r.title)}|${r.year || ''}`].filter(Boolean);
    const hit = keys.map((k) => byKey.get(k)).find((x) => x !== undefined);
    if (hit !== undefined) {
      const kept = out[hit];
      const merged = score(r) > score(kept) ? { ...kept, ...r } : { ...r, ...kept };
      for (const f of ['abstract', 'pdfUrl', 'doi', 'authors', 'venue', 'landingUrl']) merged[f] = kept[f] || r[f] || '';
      merged.url = merged.doi ? `https://doi.org/${merged.doi}` : merged.url || merged.landingUrl;
      merged.openAccess = Boolean(kept.openAccess || r.openAccess);
      out[hit] = merged;
      for (const k of keys) byKey.set(k, hit);
    } else {
      out.push(r);
      for (const k of keys) byKey.set(k, out.length - 1);
    }
  }
  return out;
}

/** Mark results that are already sources in this project (by DOI or title). */
export function markExisting(results, documents = []) {
  const dois = new Map(); const titles = new Map();
  for (const d of documents) {
    const doi = normalizeDoi(d.doi) || normalizeDoi(d.url);
    if (doi) dois.set(doi, d.id);
    if (d.title) titles.set(normTitle(d.title), d.id);
  }
  return results.map((r) => ({ ...r, existingId: (r.doi && dois.get(r.doi)) || titles.get(normTitle(r.title)) || null }));
}

async function getJson(fetchImpl, url, timeoutMs, outerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  outerSignal?.addEventListener?.('abort', onAbort);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(outerSignal?.aborted ? 'cancelled' : 'timed out');
    throw e;
  } finally { clearTimeout(timer); outerSignal?.removeEventListener?.('abort', onAbort); }
}

/**
 * Search scholarly indexes. Returns { results, warnings, provider }. Never throws for a single failing provider;
 * throws only if every provider failed (the message says why).
 */
export async function searchScholarly(query, { fetchImpl = globalThis.fetch, limit = 12, timeoutMs = 12000, signal, mailto = '' } = {}) {
  const q = String(query || '').trim().slice(0, 300);
  if (!q) return { results: [], warnings: [], provider: '' };
  const warnings = [];
  const polite = mailto ? `&mailto=${encodeURIComponent(mailto)}` : '';
  const id = identifierIn(q);
  const errors = [];

  // 1. An exact identifier (DOI, doi.org link, arXiv link): look that one paper up.
  if (id) {
    try {
      const w = await getJson(fetchImpl, `${OPENALEX}/doi:${encodeURIComponent(id.value)}?select=${OA_FIELDS}${polite}`, timeoutMs, signal);
      const r = fromOpenAlex(w);
      if (r) return { results: [r], warnings, provider: 'OpenAlex' };
    } catch (e) { errors.push(`OpenAlex: ${e.message}`); }
    try {
      const c = await getJson(fetchImpl, `${CROSSREF}/${encodeURIComponent(id.value)}`, timeoutMs, signal);
      const r = fromCrossref(c?.message);
      if (r) return { results: [r], warnings, provider: 'Crossref' };
    } catch (e) { errors.push(`Crossref: ${e.message}`); }
    warnings.push(`No record was found for ${id.value}. Showing a keyword search instead.`);
  }

  // 2. Keyword search: OpenAlex, then Crossref if OpenAlex failed or came back thin.
  let results = [];
  let provider = '';
  try {
    const data = await getJson(fetchImpl, `${OPENALEX}?search=${encodeURIComponent(q)}&per-page=${Math.min(25, limit + 4)}&select=${OA_FIELDS}${polite}`, timeoutMs, signal);
    results = (data?.results || []).map(fromOpenAlex).filter(Boolean);
    provider = 'OpenAlex';
  } catch (e) { errors.push(`OpenAlex: ${e.message}`); }
  if (results.length < 3) {
    try {
      const data = await getJson(fetchImpl, `${CROSSREF}?query.bibliographic=${encodeURIComponent(q)}&rows=${Math.min(20, limit)}&select=DOI,title,author,issued,container-title,abstract,URL,link,is-referenced-by-count,type${polite}`, timeoutMs, signal);
      const extra = (data?.message?.items || []).map(fromCrossref).filter(Boolean);
      results = results.concat(extra);
      provider = provider ? `${provider} + Crossref` : 'Crossref';
    } catch (e) { errors.push(`Crossref: ${e.message}`); }
  }
  if (!results.length && errors.length >= 2) {
    throw new Error(`Could not reach the paper indexes (${errors.join('; ')}). Check your internet connection and try again.`);
  }
  if (errors.length && results.length) warnings.push(`One index did not answer (${errors[0]}); results may be incomplete.`);
  // Drop records that are not papers at all (datasets, paratext like "Front matter") and keep the best first.
  const junk = /^(front matter|back matter|table of contents|index|editorial board|cover|issue information)$/i;
  results = dedupe(results).filter((r) => !junk.test(r.title) && r.type !== 'paratext');
  return { results: results.slice(0, limit), warnings, provider };
}
