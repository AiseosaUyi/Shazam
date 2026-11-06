const users = require('./users');
function line(user) {
  return '- ' + users.getUserName(user);
}
module.exports = { line };
