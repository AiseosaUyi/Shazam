function sortPeople(list) {
  return [...list].sort((a, b) => a.age - b.age || a.name.localeCompare(b.name));
}
module.exports = { sortPeople };
