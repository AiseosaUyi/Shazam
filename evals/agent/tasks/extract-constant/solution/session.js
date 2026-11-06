const { DAY_MS } = require('./constants');
function expiresAt(now) {
  return now + DAY_MS;
}
module.exports = { expiresAt };
