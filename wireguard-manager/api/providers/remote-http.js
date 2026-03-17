const axios = require('axios');

module.exports = function createRemoteHttpProvider(config) {
  const {
    backendUrl,
    backendToken,
    protocolLabel,
    profileFormat,
    backendTimeoutMs
  } = config;

  if (!backendUrl) {
    throw new Error('VPN_BACKEND_URL обязателен для remote-http provider');
  }

  const client = axios.create({
    baseURL: backendUrl.replace(/\/+$/, ''),
    timeout: backendTimeoutMs,
    headers: backendToken ? { Authorization: `Bearer ${backendToken}` } : {}
  });

  return {
    name: 'remote-http',
    async provision({ profile, server, user }) {
      const response = await client.post('/provision', {
        profile,
        server,
        user
      });
      const data = response.data || {};

      return {
        protocol: data.protocol || server.protocol || protocolLabel,
        profileFormat: data.profile_format || profileFormat,
        accessUri: data.access_uri || null,
        configPayload: data.config_payload || {},
        downloadName: data.download_name || `${profile.name}.${(data.profile_format || profileFormat) === 'uri' ? 'txt' : 'json'}`,
        providerMeta: data.meta || {}
      };
    },
    async revoke({ peer }) {
      await client.post('/revoke', {
        peer: {
          name: peer.name,
          id: peer.ip,
          protocol: peer.protocol,
          access_uri: peer.access_uri
        }
      });
      return { ok: true };
    }
  };
};
