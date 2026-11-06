function isPalindrome(s) {
  const r = s.split('').reverse().join('');
  return s === r;
}
module.exports = { isPalindrome };
