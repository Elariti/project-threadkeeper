import { ATTRIBUTION_LABEL, PROVENANCE, RELATIONS, ITEM_TYPES, docLabel } from './model.js';
import { buildOutline } from './outline.js';

const q = (s) => String(s || '').replace(/\n+/g, ' ').trim();

/** Markdown export of a project, keeping provenance and the "proposed vs stitched" distinction visible. */
export function exportMarkdown(view) {
  const lines = [];
  const p = view.project;
  lines.push(`# ${p.name}`, '', `**Research question:** ${p.researchQuestion || '(not set)'}`, '', `_Exported from Threadkeeper on ${new Date().toLocaleDateString()}._`);
  if (p.sample) lines.push('', '> This is the illustrative sample project. The sources are invented for demonstration.');
  lines.push('', '## Sources', '');
  for (const d of view.documents) lines.push(`- ${docLabel(d)} — ${d.title}${d.doi ? ` (DOI ${d.doi})` : ''}${d.verified === false ? ' _[unverified external source]_' : ''}`);
  if (!view.documents.length) lines.push('_No sources yet._');

  lines.push('', '## Items', '');
  for (const type of Object.keys(ITEM_TYPES)) {
    const items = view.items.filter((i) => i.type === type);
    if (!items.length) continue;
    lines.push(`### ${ITEM_TYPES[type].plural}`, '');
    for (const i of items) {
      lines.push(`- **${q(i.title)}** _(${PROVENANCE[i.provenance]?.label || i.provenance}${i.attribution === 'cited' ? `; ${ATTRIBUTION_LABEL.cited.toLowerCase()}` : ''})_${i.documentId ? ` — ${docLabel(view.docById[i.documentId])}` : ''}`);
      if (i.content) lines.push(`  ${q(i.content)}`);
      if (i.provenance === 'partly-sourced' && i.supportNotes?.length) lines.push(`  _Not covered by the quote: ${i.supportNotes.map(q).join('; ')}._`);
      for (const e of view.evidenceByItem[i.id] || []) lines.push(`  > “${q(e.quote)}” — ${docLabel(view.docById[e.documentId])}${e.page ? `, p. ${e.page}` : ''}${e.verified ? '' : ' _(not verified against source text)_'}`);
    }
    lines.push('');
  }

  const title = (id) => q(view.itemById[id]?.title || 'item');
  const where = (c) => (c.crossSource === true ? ' [different papers]' : c.crossSource === false ? ' [same paper]' : '');
  const quotes = (c) => (c.evidence || []).map((e) => `\n    > “${q(e.quote)}” (${title(e.itemId)})`).join('');
  const checked = (c) => (c.checked === 'fixed' ? ' _[corrected on a second AI reading]_' : c.checked === 'kept' ? ' _[double-checked by the AI]_' : '');
  const stitched = view.connections.filter((c) => c.status === 'confirmed');
  const proposed = view.connections.filter((c) => c.status === 'suggested');
  lines.push('## Stitched threads (confirmed by you)', '');
  for (const c of stitched) lines.push(`- ${title(c.from)} **${RELATIONS[c.relationship].label}** ${title(c.to)}${where(c)}${c.explanation ? ` — ${q(c.explanation)}` : ''}${c.editedByUser ? ' _(edited by you)_' : ''}${quotes(c)}`);
  if (!stitched.length) lines.push('_None yet._');
  lines.push('', '## Proposed threads (not yet reviewed)', '');
  for (const c of proposed) lines.push(`- ${title(c.from)} _${RELATIONS[c.relationship].label}?_ ${title(c.to)}${where(c)}${checked(c)}${c.explanation ? ` — ${q(c.explanation)}` : ''}${c.uncertainty ? ` _Uncertain: ${q(c.uncertainty)}_` : ''}${c.reasoning ? `\n    _AI reasoning: ${q(c.reasoning)}_` : ''}${quotes(c)}`);
  if (!proposed.length) lines.push('_None._');
  const dismissed = view.connections.filter((c) => c.status === 'rejected');
  const aiMade = (c) => c.origin !== 'user';
  const all = stitched.filter(aiMade).length + dismissed.filter(aiMade).length;
  lines.push('', '## Thread review summary', '', `- Stitched: ${stitched.length} (${stitched.filter((c) => c.editedByUser).length} edited first)`, `- Dismissed: ${dismissed.length}`, `- Still proposed: ${proposed.length}`,
    `- Between different papers: ${view.connections.filter((c) => c.crossSource === true).length} of ${view.connections.length}`,
    `- Tensions (contradicts/qualifies): ${view.connections.filter((c) => ['contradicts', 'qualifies'].includes(c.relationship)).length}`);
  if (all) lines.push(`- Acceptance rate of reviewed AI/keyword suggestions: ${Math.round((stitched.filter(aiMade).length / all) * 100)}% (${stitched.filter(aiMade).length} of ${all}; threads you created yourself are not counted)`);

  const gaps = view.gaps.filter((g) => g.status !== 'dismissed');
  if (gaps.length) {
    lines.push('', '## Candidate gaps (provisional)', '', '_Observed in this collection only. Not proof that the wider literature lacks a study._', '');
    for (const g of gaps) lines.push(`- **${q(g.title)}** [${g.status === 'investigated' ? 'externally investigated' : 'candidate gap'}] — ${q(g.description)}`);
  }

  const outline = view.outline?.sections ? view.outline : buildOutline(view);
  lines.push('', `## Outline (${outline.mode === 'ai' ? 'AI draft from the reviewed map' : 'built from the map'})`, '');
  outline.sections.forEach((s, n) => {
    lines.push(`${n + 1}. **${q(s.heading)}**${s.needsEvidence ? ` _(${(s.needsLabel || 'needs evidence').toLowerCase()})_` : ''}`);
    for (const e of s.entries) lines.push(`   - [${e.role}${e.status === 'proposed' ? ', proposed' : ''}] ${q(e.title)}${e.citations?.[0] ? ` (${e.citations[0].source}${e.citations[0].page ? `, p. ${e.citations[0].page}` : ''})` : ''}`);
  });

  if (view.history.length) {
    lines.push('', '## Change log', '');
    for (const h of view.history.slice(0, 40)) lines.push(`- ${new Date(h.at).toLocaleString()} — ${q(h.summary)}`);
  }
  return `${lines.join('\n')}\n`;
}
