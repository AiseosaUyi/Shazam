const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
function deepMerge(a, b) {
  const out = { ...a };
  for (const key of Object.keys(b)) {
    out[key] = isPlain(out[key]) && isPlain(b[key]) ? deepMerge(out[key], b[key]) : b[key];
  }
  return out;
}
module.exports = { deepMerge };
