const assert = require('node:assert/strict');
const path = require('path');
const { evaluate } = require(path.join(process.cwd(), 'calc.js'));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

const cases = [
  ['1+2*3', {}, 7], ['(1+2)*3', {}, 9], ['10-4-3', {}, 3], ['100/10/5', {}, 2], ['7%4', {}, 3], ['2*3%4', {}, 2],
  ['-2^2', {}, -4], ['2^3^2', {}, 512], ['2^-1', {}, 0.5], ['--3', {}, 3], ['-(-3)', {}, 3], ['+4', {}, 4], ['3-+2', {}, 1],
  ['1.5+.5', {}, 2], ['1e3', {}, 1000], ['2.5E-2*4', {}, 0.1], ['  1 +\t2  ', {}, 3],
  ['x*y+1', { x: 3, y: 4 }, 13], ['a_1+B2', { a_1: 1, B2: 2 }, 3],
  ['min(3,1,2)', {}, 1], ['max(1)', {}, 1], ['max(1+1, 3, 2^2)', {}, 4], ['abs(-5)+abs(5)', {}, 10], ['sqrt(16)', {}, 4],
  ['round(2.5)', {}, 3], ['round(-2.5)', {}, -3], ['round(1.2345, 2)', {}, 1.23], ['round(2.675, 2)', {}, 2.68], ['round(1234.5678, 0)', {}, 1235],
  ['min(1, max(2, 3)) * 2', {}, 2], ['2*(3+4)*(5-1)', {}, 56], ['((((1))))', {}, 1], ['10 % 3 ^ 2', {}, 1], ['-x^2', { x: 3 }, -9],
  ['2^3*2', {}, 16], ['8/2^2', {}, 2], ['1-2-3-4', {}, -8], ['2^2^0', {}, 2],
];
for (const [e, v, want] of cases) near(evaluate(e, v), want);

const errs = [
  ['1 +', {}, 'Unexpected end of input at position 3'], ['', {}, 'Unexpected end of input at position 0'],
  ['(1+2', {}, "Expected ')' at position 4"], ['(1+2 3', {}, "Expected ')' at position 5"], ['2 $ 3', {}, "Unexpected token '$' at position 2"],
  ['1 2', {}, "Unexpected token '2' at position 2"], ['1 + * 2', {}, "Unexpected token '*' at position 4"], [')', {}, "Unexpected token ')' at position 0"],
  ['x', {}, 'Unknown variable: x'], ['foo(1)', {}, 'Unknown function: foo'], ['1/0', {}, 'Division by zero'], ['5%0', {}, 'Division by zero'], ['1/(2-2)', {}, 'Division by zero'],
  ['min()', {}, 'min needs at least 1 argument'], ['max()', {}, 'max needs at least 1 argument'], ['abs(1,2)', {}, 'abs takes 1 argument'], ['abs()', {}, 'abs takes 1 argument'],
  ['sqrt(1,2)', {}, 'sqrt takes 1 argument'], ['round(1,2,3)', {}, 'round takes 1 or 2 arguments'], ['sqrt(-1)', {}, 'sqrt of negative number'],
  ['max(1,', {}, 'Unexpected end of input at position 6'], ['max(1 2)', {}, "Expected ')' at position 6"], ['3 + (4 * )', {}, "Unexpected token ')' at position 9"],
];
for (const [e, v, msg] of errs) {
  assert.throws(() => evaluate(e, v), (err) => err instanceof Error && err.message === msg, `${JSON.stringify(e)} should throw ${msg}`);
}
// A variable named like a function is still a variable when not called; a function name is not a variable.
near(evaluate('min+1', { min: 4 }), 5);
assert.throws(() => evaluate('min'), /Unknown variable: min/);
// No eval/Function.
const src = require('fs').readFileSync(path.join(process.cwd(), 'calc.js'), 'utf8');
assert.ok(!/\beval\s*\(|new Function|Function\s*\(/.test(src), 'must not use eval or Function');
