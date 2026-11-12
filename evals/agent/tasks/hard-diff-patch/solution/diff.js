function diff(a, b) {
  // Trim the common prefix and suffix first: most real edits touch a small middle section.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  // lcs[i][j] = LCS length of midA[i:] and midB[j:]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = midA[i] === midB[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const ops = a.slice(0, start).map((line) => ({ op: 'keep', line }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) { ops.push({ op: 'keep', line: midA[i] }); i++; j++; }
    else if (i < n && (j >= m || lcs[i + 1][j] >= lcs[i][j + 1])) { ops.push({ op: 'del', line: midA[i] }); i++; }
    else { ops.push({ op: 'add', line: midB[j] }); j++; }
  }
  for (let k = endA; k < a.length; k++) ops.push({ op: 'keep', line: a[k] });
  return ops;
}

function patch(a, ops) {
  const out = [];
  let i = 0;
  for (const { op, line } of ops) {
    if (op === 'add') { out.push(line); continue; }
    if (i >= a.length || a[i] !== line) throw new Error(`Patch does not apply at line ${i + 1}`);
    if (op === 'keep') out.push(line);
    i++;
  }
  if (i < a.length) throw new Error(`Patch does not apply at line ${i + 1}`);
  return out;
}

function unifiedDiff(a, b, { context = 3, aName = 'a', bName = 'b' } = {}) {
  const ops = diff(a, b);
  const changes = [];
  ops.forEach((o, k) => { if (o.op !== 'keep') changes.push(k); });
  if (!changes.length) return '';
  const ranges = [];
  for (const k of changes) {
    const lo = Math.max(0, k - context);
    const hi = Math.min(ops.length - 1, k + context);
    const last = ranges[ranges.length - 1];
    if (last && lo <= last[1] + 1) last[1] = Math.max(last[1], hi);
    else ranges.push([lo, hi]);
  }
  // Prefix counts of lines consumed from a and produced for b before each op index.
  const aBefore = [0];
  const bBefore = [0];
  for (const o of ops) {
    aBefore.push(aBefore[aBefore.length - 1] + (o.op !== 'add' ? 1 : 0));
    bBefore.push(bBefore[bBefore.length - 1] + (o.op !== 'del' ? 1 : 0));
  }
  let out = `--- ${aName}\n+++ ${bName}\n`;
  for (const [lo, hi] of ranges) {
    const slice = ops.slice(lo, hi + 1);
    const aCount = slice.filter((o) => o.op !== 'add').length;
    const bCount = slice.filter((o) => o.op !== 'del').length;
    const aStart = aCount === 0 ? aBefore[lo] : aBefore[lo] + 1;
    const bStart = bCount === 0 ? bBefore[lo] : bBefore[lo] + 1;
    out += `@@ -${aStart},${aCount} +${bStart},${bCount} @@\n`;
    for (const o of slice) out += `${o.op === 'keep' ? ' ' : o.op === 'add' ? '+' : '-'}${o.line}\n`;
  }
  return out;
}

module.exports = { diff, patch, unifiedDiff };
