function slugify(text) {
  return String(text).replace(/[^A-Za-z0-9]+/g, '-');
}
module.exports = { slugify };
