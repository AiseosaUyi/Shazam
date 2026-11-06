function isEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@([^\s@.]+\.)+[^\s@.]{2,}$/.test(s);
}
module.exports = { isEmail };
