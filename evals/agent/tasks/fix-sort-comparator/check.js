const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const load = (p) => require(path.join(process.cwd(), p));
const read = (p) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const taskDir = __dirname;
const { sortPeople } = load('people.js');
const input = [
  { name: 'Cy', age: 40 }, { name: 'Bo', age: 25 }, { name: 'Al', age: 40 }, { name: 'Di', age: 5 }, { name: 'Ed', age: 25 },
];
const snapshot = JSON.parse(JSON.stringify(input));
const out = sortPeople(input);
assert.deepEqual(out.map((p) => p.name), ['Di', 'Bo', 'Ed', 'Al', 'Cy']);
assert.deepEqual(input, snapshot, 'input must not be mutated');
assert.notEqual(out, input);
