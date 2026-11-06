function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
function unique(arr) {
  return Array.from(new Set(arr));
}
module.exports = { chunk, unique };
