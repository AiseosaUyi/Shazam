function getCity(user) {
  return (user && user.address && user.address.city) || 'unknown';
}
module.exports = { getCity };
