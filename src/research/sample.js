// Sample project so the map, review and "Thread Shift" can be explored without any AI or PDFs.
// Everything here is ILLUSTRATIVE and invented for the demo. None of these papers exist. Every
// source is titled "(illustrative sample)" and the suggestions are marked "Prewritten sample suggestion".
import { addDocument, addItem, addSuggestedThreads, createConnection, createProject } from './store.js';

const PAGES = {
  A: [
    { page: 1, text: 'Abstract. In this illustrative sample study, 84 first-year undergraduates studied introductory psychology units either with spaced retrieval practice or with a single end-of-unit review. Spaced retrieval practice improved six-week retention compared with the review condition (d = 0.52). Retention was measured with a free-recall test.' },
    { page: 2, text: 'Limitations. All participants came from a single university and were first-year students. We did not test conceptually complex material, and we measured recall only, not transfer to new problems.' },
  ],
  B: [
    { page: 1, text: 'Students who took weekly low-stakes quizzes scored 12 points higher on a six-week recall test than students who reviewed at the end of each unit. The benefit appeared in both smaller seminars and larger sections.' },
    { page: 2, text: 'Method. We compared weekly low-stakes quizzes with end-of-unit review across 14 course sections. A limitation is that only recall was assessed, so we cannot say whether understanding of new problems improved.' },
  ],
  C: [
    { page: 1, text: 'In a lecture course of about 300 students, distributed retrieval practice was associated with better recall at the end of the semester. The advantage persisted after controlling for prior grades.' },
  ],
  D: [
    { page: 1, text: 'In second-year statistics classes, spaced retrieval practice produced no retention benefit for complex statistics material after eight weeks. Performance was measured with transfer problems rather than recall questions.' },
    { page: 2, text: 'Participants had high prior exposure to quantitative methods. The authors suggest that benefits of spacing may depend on the difficulty of the material and on how retention is measured.' },
  ],
};

const DOCS = {
  A: { title: 'Spacing and Retrieval in Introductory Psychology (illustrative sample)', authors: 'Sample, A.', year: 2021 },
  B: { title: 'Quiz Schedules and Six-Week Recall (illustrative sample)', authors: 'Sample, B.', year: 2022 },
  C: { title: 'Distributed Practice in Large Lectures (illustrative sample)', authors: 'Sample, C.', year: 2023 },
  D: { title: 'Retrieval Practice and Complex Statistics Material (illustrative sample)', authors: 'Sample, D.', year: 2024 },
};

export const SAMPLE_QUESTION = 'Does spaced retrieval practice improve long-term retention in undergraduate students, and under what conditions?';

function addSampleDoc(r, projectId, key) {
  let doc;
  [r, doc] = addDocument(r, projectId, { ...DOCS[key], origin: 'sample', pageCount: PAGES[key].length, hasText: true });
  r = { ...r, documents: r.documents.map((d) => (d.id === doc.id ? { ...d, status: 'extracted' } : d)) };
  return [r, doc];
}
const stated = (doc, page, quote) => ({ documentId: doc.id, page, quote, verified: true });
const finding = (doc, title, content, page, quote) => ({ type: 'finding', title, content, documentId: doc.id, provenance: 'source-stated', origin: 'sample', evidence: [stated(doc, page, quote)] });

export function seedSampleProject(r0) {
  let r = r0;
  let project;
  [r, project] = createProject(r, { name: 'Sample: spaced retrieval and retention', researchQuestion: SAMPLE_QUESTION, sample: true });
  const docs = {};
  for (const key of ['A', 'B', 'C']) [r, docs[key]] = addSampleDoc(r, project.id, key);
  const add = (p) => { let it; [r, it] = addItem(r, project.id, p); return it; };
  const claim = add({ type: 'claim', title: 'Spaced retrieval improves long-term retention in undergraduates', content: 'The working claim of this project: spacing retrieval practice over time leads to better retention weeks later.', provenance: 'user-confirmed', origin: 'sample' });
  const fA = add(finding(docs.A, 'Spaced retrieval improved six-week retention', 'Compared with a single end-of-unit review, spaced retrieval practice improved six-week recall (d = 0.52) in 84 first-year students.', 1, 'Spaced retrieval practice improved six-week retention compared with the review condition (d = 0.52)'));
  const fB = add(finding(docs.B, 'Weekly quizzes raised six-week recall by 12 points', 'Students with weekly low-stakes quizzes scored higher on a six-week recall test than students who reviewed at the end of each unit.', 1, 'scored 12 points higher on a six-week recall test than students who reviewed at the end of each unit'));
  const fC = add(finding(docs.C, 'Benefit persisted in a 300-student lecture', 'Distributed retrieval practice was associated with better end-of-semester recall, also after controlling for prior grades.', 1, 'The advantage persisted after controlling for prior grades'));
  const lA = add({ type: 'limitation', title: 'Single university, first-year students only', content: 'The sample came from one university and only first-year students; complex material and transfer were not tested.', documentId: docs.A.id, provenance: 'source-stated', origin: 'sample', evidence: [stated(docs.A, 2, 'All participants came from a single university and were first-year students')] });
  const lB = add({ type: 'limitation', title: 'Only recall was assessed', content: 'The authors note they cannot say whether understanding of new problems improved.', documentId: docs.B.id, provenance: 'source-stated', origin: 'sample', evidence: [stated(docs.B, 2, 'only recall was assessed, so we cannot say whether understanding of new problems improved')] });
  add({ type: 'method', title: 'Weekly quizzes versus end-of-unit review', content: 'A comparison of two study schedules across 14 course sections.', documentId: docs.B.id, provenance: 'source-stated', origin: 'sample', evidence: [stated(docs.B, 2, 'We compared weekly low-stakes quizzes with end-of-unit review across 14 course sections')] });
  const q1 = add({ type: 'question', title: 'Does the benefit hold for conceptually complex material?', content: 'The sources test recall of fairly simple units. What about material that needs understanding rather than memorising?', provenance: 'user-confirmed', origin: 'sample' });
  add({ type: 'claim', title: 'Recall benefits may not imply transfer benefits', content: 'Both limitations mention that only recall was measured, which suggests a gap between recall and transfer. This is an interpretation, not a statement by the authors.', provenance: 'ai-interpretation', origin: 'sample' });
  const link = (from, to, relationship, explanation) => { [r] = createConnection(r, project.id, { from: from.id, to: to.id, relationship, explanation }); };
  link(fA, claim, 'supports', 'Six-week recall was higher with spaced retrieval in a first-year sample.');
  link(fB, claim, 'supports', 'Weekly quizzing raised six-week recall across 14 sections.');
  link(fC, claim, 'supports', 'The advantage held in a large lecture course after controlling for prior grades.');
  link(lA, q1, 'motivates', 'A single-site, first-year sample leaves complex material untested.');
  link(lB, q1, 'motivates', 'Recall-only measurement leaves understanding of new problems open.');
  // The sample links are the user's "starting map", so they are stitched. Reset their origin label.
  r = { ...r, connections: r.connections.map((c) => (c.projectId === project.id ? { ...c, origin: 'sample' } : c)) };
  r = { ...r, activeProjectId: project.id };
  return { r, project, pages: Object.fromEntries(Object.entries(docs).map(([k, d]) => [d.id, PAGES[k]])) };
}

/** The "Thread Shift" paper: a new source whose result differs. Adds prewritten suggestions, clearly labelled as samples. */
export function addSampleNewPaper(r0, projectId) {
  let r = r0;
  let doc;
  [r, doc] = addSampleDoc(r, projectId, 'D');
  const add = (p) => { let it; [r, it] = addItem(r, projectId, p); return it; };
  const fD = add(finding(doc, 'No retention benefit for complex statistics material at eight weeks', 'In second-year statistics classes, spaced retrieval practice produced no retention benefit after eight weeks, measured with transfer problems.', 1, 'spaced retrieval practice produced no retention benefit for complex statistics material after eight weeks'));
  add({ type: 'limitation', title: 'Participants had high prior quantitative exposure', content: 'The participants were already experienced with quantitative methods.', documentId: doc.id, provenance: 'source-stated', origin: 'sample', evidence: [stated(doc, 2, 'Participants had high prior exposure to quantitative methods')] });
  const cD = add({ type: 'claim', title: 'Spacing benefits may depend on material difficulty and how retention is measured', content: 'The authors suggest the effect of spacing is conditional rather than universal.', documentId: doc.id, provenance: 'source-stated', origin: 'sample', evidence: [stated(doc, 2, 'benefits of spacing may depend on the difficulty of the material and on how retention is measured')] });
  const view = r.items.filter((i) => i.projectId === projectId);
  const claim = view.find((i) => i.type === 'claim' && i.title.startsWith('Spaced retrieval improves'));
  const q1 = view.find((i) => i.type === 'question' && i.title.startsWith('Does the benefit hold'));
  const threads = [];
  if (claim) threads.push({
    from: fD.id, to: claim.id, relationship: 'contradicts', origin: 'sample', confidence: 'medium',
    explanation: 'A finding of no retention benefit for complex statistics material cuts against the broad claim that spaced retrieval improves long-term retention.',
    evidence: [{ itemId: fD.id, quote: 'spaced retrieval practice produced no retention benefit for complex statistics material after eight weeks' }],
    uncertainty: 'Different population (second-year statistics students), a longer delay (eight weeks) and a transfer-problem outcome instead of recall. These differences may explain the result rather than a true conflict.',
  });
  if (q1) threads.push({
    from: cD.id, to: q1.id, relationship: 'informs', origin: 'sample', confidence: 'medium',
    explanation: 'The authors’ suggestion that benefits depend on material difficulty bears directly on this open question.',
    evidence: [{ itemId: cD.id, quote: 'benefits of spacing may depend on the difficulty of the material and on how retention is measured' }],
    uncertainty: 'One source, and the suggestion is the authors’ interpretation rather than a tested result.',
  });
  let added;
  [r, added] = addSuggestedThreads(r, projectId, threads, 'sample');
  return { r, doc, pages: { [doc.id]: PAGES.D }, threads: added };
}
