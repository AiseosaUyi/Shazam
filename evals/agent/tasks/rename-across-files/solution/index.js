const { fetchUserName } = require('./users');
function greet(user) {
  return 'Hello, ' + fetchUserName(user);
}
module.exports = { greet };
