const { mean } = require('./stats');
function formatMean(values) {
  return mean(values).toFixed(2);
}
module.exports = { formatMean };
