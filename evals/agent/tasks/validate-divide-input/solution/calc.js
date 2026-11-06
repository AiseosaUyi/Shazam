function divide(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
    throw new TypeError('arguments must be finite numbers');
  }
  if (b === 0) throw new RangeError('cannot divide by zero');
  return a / b;
}
module.exports = { divide };
