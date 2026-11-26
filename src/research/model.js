// Vocabulary and small pure helpers for the research map. No React in here.

export const ITEM_TYPES = {
  claim: { label: 'Claim', plural: 'Claims', tone: 'lavender', blurb: 'An argument you are building or testing' },
  finding: { label: 'Finding', plural: 'Findings', tone: 'mint', blurb: 'A result reported by a source' },
  limitation: { label: 'Limitation', plural: 'Limitations', tone: 'peach', blurb: 'A weakness or boundary' },
  method: { label: 'Method', plural: 'Methods', tone: 'sky', blurb: 'How something was or could be studied' },
  question: { label: 'Question', plural: 'Questions', tone: 'butter', blurb: 'Something still unanswered' },
  gap: { label: 'Candidate gap', plural: 'Candidate gaps', tone: 'rose', blurb: 'A possible gap, provisional until investigated' },
  contribution: { label: 'Contribution', plural: 'Contributions', tone: 'gold', blurb: 'What your work could add' },
  decision: { label: 'Decision', plural: 'Decisions', tone: 'peach', blurb: 'A choice you made and why' },
  task: { label: 'Task', plural: 'Tasks', tone: 'sage', blurb: 'Something to do (appears in your checklist)' },
};
export const ITEM_TYPE_ORDER = Object.keys(ITEM_TYPES);

export const RELATIONS = {
  supports: { label: 'supports', color: '#4f9a73', sentence: (a, b) => `${a} supports ${b}` },
  contradicts: { label: 'contradicts', color: '#d0675a', sentence: (a, b) => `${a} contradicts ${b}` },
  qualifies: { label: 'qualifies', color: '#c07a2e', sentence: (a, b) => `${a} qualifies ${b}` },
  extends: { label: 'extends', color: '#8a6fc4', sentence: (a, b) => `${a} extends ${b}` },
  explains: { label: 'explains', color: '#4a86b8', sentence: (a, b) => `${a} explains ${b}` },
  motivates: { label: 'motivates', color: '#c79a2c', sentence: (a, b) => `${a} motivates ${b}` },
  informs: { label: 'informs', color: '#6f9a6a', sentence: (a, b) => `${a} informs ${b}` },
  depends_on: { label: 'depends on', color: '#6c7a8c', sentence: (a, b) => `${a} depends on ${b}` },
  related_to: { label: 'related to', color: '#9a8f82', sentence: (a, b) => `${a} is related to ${b}` },
};
export const RELATION_KEYS = Object.keys(RELATIONS);

export const PROVENANCE = {
  'source-stated': { label: 'Source-stated', hint: 'The authors state this and the quoted passage was found in the source text.' },
  'partly-sourced': { label: 'Partly sourced', hint: 'The quote is real, but the item says more than the quote does (see the notes). Check it before relying on it.' },
  'ai-interpretation': { label: 'AI interpretation', hint: 'Written by the AI. Not a statement by the authors. Check it against the source.' },
  'user-confirmed': { label: 'You confirmed', hint: 'You wrote or checked this item.' },
  unverified: { label: 'Unverified', hint: 'Not yet checked against a source.' },
};

export const CONFIDENCE_LABEL = { low: 'Low confidence', medium: 'Medium confidence', high: 'High confidence' };
export const ATTRIBUTION_LABEL = { cited: 'Cites other work', own: "This paper's own result", unclear: '' };
export const ORIGIN_LABEL = { ai: 'AI suggestion', heuristic: 'Keyword match (no AI)', user: 'Added by you', sample: 'Prewritten sample suggestion' };
export const ASSESSMENT_LABEL = {
  genuine_tension: 'Looks like genuine tension',
  possibly_compatible: 'May be compatible once context is considered',
  insufficient_information: 'Not enough information to tell',
};
export const CONTEXT_FACTORS = ['population', 'definitions', 'conditions', 'data', 'outcomes'];

export const nowIso = () => new Date().toISOString();

export function docLabel(doc) {
  if (!doc) return 'Unknown source';
  const lead = (doc.authors || '').split(/,| and | & /)[0].trim() || doc.title || 'Unknown source';
  return `${lead}${doc.year ? ` (${doc.year})` : ''}`;
}

export function shortText(text, n = 90) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trim()}…` : t;
}

export const emptyResearch = () => ({
  projects: [], documents: [], items: [], evidence: [], connections: [], feedback: [], layouts: {}, history: [], gaps: [], outlines: {}, activeProjectId: null,
  checkedPairs: {}, // { [projectId]: { 'idA|idB': checkedAtIso } } pairs the AI already looked at and found nothing
});

/** Make sure a loaded research slice has every collection (older saves, partial saves). */
export function normalizeResearch(r) {
  const base = emptyResearch();
  const out = { ...base, ...(r || {}) };
  for (const k of Object.keys(base)) if (out[k] === undefined || out[k] === null) out[k] = base[k];
  return out;
}
