function sortPeople(list) {
  return list.sort((a, b) => a.age > b.age);
}
module.exports = { sortPeople };
