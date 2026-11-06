const { DAY_MS } = require('./constants');
function ttl(days) {
  return days * DAY_MS;
}
module.exports = { ttl };
