// Self-organising "rings" layout for the research map.
//
//  - Every source is the centre of its own cluster. Its claims and findings sit on a ring around it, and its other
//    items (methods, limitations, questions, gaps…) on a second ring outside that. Your own items (no source) form a
//    cluster around a "Your items" hub.
//  - Threads act as springs: linked items slide round their rings towards each other, and threads between papers pull
//    whole clusters closer, so papers that talk to each other end up side by side.
//  - Circles never overlap, clusters keep apart, and anything you drag stays where you put it (it is pinned); the
//    rest settles around it.
// The simulation is deterministic (same map → same picture) and pure, so it is unit-tested. Positions are CENTRES.

export const NODE_SIZE = { source: 150, hub: 120, inner: 128, outer: 104 };
export const INNER_TYPES = new Set(['claim', 'finding']);
export const HUB_ID = 'hub:mine';
const GAP = 26;

const ringOf = (item) => (INNER_TYPES.has(item.type) ? 'inner' : 'outer');
const centreIdOf = (item) => (item.documentId ? `doc:${item.documentId}` : HUB_ID);

/** Ring radii that leave room for every circle on the ring. */
function radii(nInner, nOuter) {
  const fit = (n, d) => (n * (d + GAP)) / (2 * Math.PI);
  const r1 = Math.max(NODE_SIZE.source / 2 + NODE_SIZE.inner / 2 + 26, fit(nInner, NODE_SIZE.inner));
  const r2 = Math.max(r1 + (NODE_SIZE.inner + NODE_SIZE.outer) / 2 + 18, fit(nOuter, NODE_SIZE.outer));
  return { r1, r2: nOuter ? r2 : r1, extent: (nOuter ? r2 + NODE_SIZE.outer / 2 : nInner ? r1 + NODE_SIZE.inner / 2 : NODE_SIZE.source / 2) + 14 };
}

/**
 * @param view       projectView(...) result: documents, items, connections
 * @param opts.pinned   { nodeId: {x,y} } centres the user placed (they do not move)
 * @param opts.previous { nodeId: {x,y} } last centres, for a gentle warm start (fewer jumps)
 * @returns { positions: {nodeId: {x,y}}, clusters: {centreId: {x,y,extent}} }
 */
export function ringLayout(view, { pinned = {}, previous = {}, iterations } = {}) {
  const items = view.items || [];
  const hasMine = items.some((i) => !i.documentId);
  const centreIds = [...(view.documents || []).map((d) => `doc:${d.id}`), ...(hasMine ? [HUB_ID] : [])];
  if (!centreIds.length && !items.length) return { positions: {}, clusters: {} };

  // ---- clusters and their ring sizes
  const members = new Map(centreIds.map((c) => [c, { inner: [], outer: [] }]));
  for (const i of items) {
    const c = centreIdOf(i);
    if (!members.has(c)) members.set(c, { inner: [], outer: [] }); // item of a removed source: own cluster
    members.get(c)[ringOf(i)].push(i);
  }
  const clusterIds = [...members.keys()];
  const size = Object.fromEntries(clusterIds.map((c) => [c, radii(members.get(c).inner.length, members.get(c).outer.length)]));

  // ---- threads (springs)
  const live = (view.connections || []).filter((c) => c.status !== 'rejected');
  const itemById = new Map(items.map((i) => [i.id, i]));
  const links = live.filter((c) => itemById.has(c.from) && itemById.has(c.to)).map((c) => ({
    a: `item:${c.from}`, b: `item:${c.to}`, cross: centreIdOf(itemById.get(c.from)) !== centreIdOf(itemById.get(c.to)), confirmed: c.status === 'confirmed',
  }));
  const clusterLinks = new Map(); // "cA|cB" -> number of threads between the two clusters
  for (const c of live) {
    const a = itemById.get(c.from); const b = itemById.get(c.to);
    if (!a || !b) continue;
    const ca = centreIdOf(a); const cb = centreIdOf(b);
    if (ca === cb) continue;
    const key = [ca, cb].sort().join('|');
    clusterLinks.set(key, (clusterLinks.get(key) || 0) + (c.status === 'confirmed' ? 2 : 1));
  }

  // ---- cluster centres
  const spread = Math.max(...clusterIds.map((c) => size[c].extent)) * 2.3;
  const ringR = clusterIds.length > 1 ? Math.max(spread / 2, (spread * clusterIds.length) / (2 * Math.PI)) : 0;
  const cl = new Map();
  clusterIds.forEach((c, k) => {
    const angle = (2 * Math.PI * k) / Math.max(1, clusterIds.length) - Math.PI / 2;
    const start = pinned[c] || previous[c] || { x: Math.cos(angle) * ringR * 1.4, y: Math.sin(angle) * ringR * 0.8 };
    cl.set(c, { id: c, x: start.x, y: start.y, vx: 0, vy: 0, fixed: Boolean(pinned[c]), extent: size[c].extent });
  });

  // ---- items live ON their ring: only their angle moves. A drag sets the angle (the item snaps back onto its ring).
  const nodes = new Map();
  const angleFrom = (p, c) => Math.atan2(p.y - c.y, p.x - c.x);
  for (const c of clusterIds) {
    const centre = cl.get(c);
    for (const ring of ['inner', 'outer']) {
      const list = members.get(c)[ring];
      const radius = ring === 'inner' ? size[c].r1 : size[c].r2;
      list.forEach((item, k) => {
        const id = `item:${item.id}`;
        const even = (2 * Math.PI * k) / Math.max(1, list.length) - Math.PI / 2 + (ring === 'outer' ? Math.PI / Math.max(2, list.length) : 0);
        const known = pinned[id] || previous[id];
        nodes.set(id, { id, centre: c, ring, radius, theta: known ? angleFrom(known, previous[c] || pinned[c] || centre) : even, fixed: Boolean(pinned[id]), w: 0 });
      });
    }
  }
  // Outer items start next to the claim/finding they are threaded to, so they "surround" it.
  for (const l of links) {
    const a = nodes.get(l.a); const b = nodes.get(l.b);
    if (!a || !b || a.centre !== b.centre || a.ring === b.ring) continue;
    const outer = a.ring === 'outer' ? a : b; const inner = a.ring === 'outer' ? b : a;
    if (!outer.fixed && !pinned[outer.id] && !previous[outer.id] && !outer.placed) { outer.theta = inner.theta + 0.05; outer.placed = true; }
  }
  const posOf = (n) => { const c = cl.get(n.centre); return { x: c.x + Math.cos(n.theta) * n.radius, y: c.y + Math.sin(n.theta) * n.radius }; };
  const wrap = (a) => { let x = a; while (x > Math.PI) x -= 2 * Math.PI; while (x < -Math.PI) x += 2 * Math.PI; return x; };

  const centres = [...cl.values()];
  // ---- simulation
  const steps = iterations ?? (Object.keys(previous).length ? 180 : 420);
  const rings = new Map(); // "centre|ring" -> nodes on it
  for (const n of nodes.values()) { const k = `${n.centre}|${n.ring}`; if (!rings.has(k)) rings.set(k, []); rings.get(k).push(n); }
  for (let step = 0; step < steps; step += 1) {
    const alpha = 1 - step / steps;
    // 1. threads: linked items rotate round their rings to face each other; threads between papers pull clusters together
    for (const n of nodes.values()) n.torque = 0;
    for (const l of links) {
      const a = nodes.get(l.a); const b = nodes.get(l.b);
      const pa = posOf(a); const pb = posOf(b);
      const k = (l.confirmed ? 1 : 0.7) * alpha;
      for (const [self, p, other] of [[a, pa, pb], [b, pb, pa]]) {
        const tx = -Math.sin(self.theta); const ty = Math.cos(self.theta); // tangent
        self.torque += (((other.x - p.x) * tx + (other.y - p.y) * ty) / self.radius) * 0.06 * k;
      }
    }
    // Papers joined by threads want to sit side by side; papers with nothing in common keep a little more room.
    for (let x = 0; x < centres.length; x += 1) {
      for (let y = x + 1; y < centres.length; y += 1) {
        const ca = centres[x]; const cb = centres[y];
        const dx = cb.x - ca.x; const dy = cb.y - ca.y; const d = Math.hypot(dx, dy) || 1;
        const min = ca.extent + cb.extent + 20;
        const strength = clusterLinks.get([ca.id, cb.id].sort().join('|')) || 0;
        const preferred = strength ? min : min * 1.12;
        const f = (d - preferred) * (strength ? Math.min(0.06, 0.02 * strength) : (d < preferred ? 0.02 : 0)) * alpha;
        if (!ca.fixed) { ca.vx += (dx / d) * f; ca.vy += (dy / d) * f; }
        if (!cb.fixed) { cb.vx -= (dx / d) * f; cb.vy -= (dy / d) * f; }
      }
    }
    // 2. items on the same ring keep their spacing
    for (const list of rings.values()) {
      if (list.length < 2) continue;
      const minAngle = (NODE_SIZE[list[0].ring] + GAP) / list[0].radius;
      for (let x = 0; x < list.length; x += 1) {
        for (let y = x + 1; y < list.length; y += 1) {
          const a = list[x]; const b = list[y];
          const d = wrap(b.theta - a.theta);
          const gap = Math.abs(d);
          if (gap >= minAngle) continue;
          const push = (minAngle - gap) * 0.5 * (d >= 0 ? 1 : -1) || 0.01;
          if (!a.fixed) a.theta -= push * (b.fixed ? 2 : 1);
          if (!b.fixed) b.theta += push * (a.fixed ? 2 : 1);
        }
      }
    }
    for (const n of nodes.values()) if (!n.fixed) n.theta += Math.max(-0.12, Math.min(0.12, n.torque));
    // 3. clusters: gravity to the middle, then never overlap (hard)
    for (const c of centres) {
      if (c.fixed) { c.vx = 0; c.vy = 0; continue; }
      c.vx -= c.x * 0.005 * alpha; c.vy -= c.y * 0.01 * alpha; // a little stronger vertically: screens are wider than tall
      c.vx *= 0.6; c.vy *= 0.6;
      c.x += c.vx; c.y += c.vy;
    }
    for (let pass = 0; pass < 3; pass += 1) {
      for (let x = 0; x < centres.length; x += 1) {
        for (let y = x + 1; y < centres.length; y += 1) {
          const a = centres[x]; const b = centres[y];
          let dx = b.x - a.x; let dy = b.y - a.y; let d = Math.hypot(dx, dy);
          const min = a.extent + b.extent + 20;
          if (d >= min) continue;
          if (d < 0.01) { dx = 1 + x; dy = 1 + y; d = Math.hypot(dx, dy); }
          const push = min - d;
          const ux = dx / d; const uy = dy / d;
          if (a.fixed && b.fixed) continue;
          const sa = a.fixed ? 0 : b.fixed ? 1 : 0.5;
          a.x -= ux * push * sa; a.y -= uy * push * sa;
          b.x += ux * push * (1 - sa); b.y += uy * push * (1 - sa);
        }
      }
    }
  }

  const positions = {}; const clusters = {};
  for (const c of centres) { positions[c.id] = { x: Math.round(c.x), y: Math.round(c.y) }; clusters[c.id] = { x: Math.round(c.x), y: Math.round(c.y), extent: Math.round(c.extent), r1: Math.round(size[c.id].r1), r2: Math.round(size[c.id].r2) }; }
  for (const n of nodes.values()) { const p = posOf(n); positions[n.id] = { x: Math.round(p.x), y: Math.round(p.y) }; }
  return { positions, clusters };
}

/** Kept for older callers and tests: centre positions for every source and item. */
export function autoLayout(view) {
  return ringLayout(view).positions;
}
