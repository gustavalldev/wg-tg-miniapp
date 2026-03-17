const createLocalProvider = require('./local');
const createRemoteHttpProvider = require('./remote-http');

function createVpnProvider(config = {}) {
  const mode = config.mode || 'local-template';

  if (mode === 'remote-http') {
    return createRemoteHttpProvider(config);
  }

  return createLocalProvider(config);
}

module.exports = {
  createVpnProvider
};
