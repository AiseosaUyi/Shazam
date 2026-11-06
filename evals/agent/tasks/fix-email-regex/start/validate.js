function isEmail(s) {
  return /.+@.+/.test(s);
}
module.exports = { isEmail };
