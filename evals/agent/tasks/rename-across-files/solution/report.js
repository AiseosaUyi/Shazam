const users = require('./users');
function line(user) {
  return '- ' + users.fetchUserName(user);
}
module.exports = { line };
