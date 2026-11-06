const { getUserName } = require('./users');
function greet(user) {
  return 'Hello, ' + getUserName(user);
}
module.exports = { greet };
