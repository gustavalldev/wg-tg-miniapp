const axios = require('axios');

module.exports = function createRemoteHttpProvider(config) {
  const {
    backendUrl,
    backendToken,
    protocolLabel,
    profileFormat,
    backendTimeoutMs,
    backendUrlMode,
    backendScheme,
    backendPort
  } = config;

  const normalizedBackendUrl = String(backendUrl || '').replace(/\/+$/, '');
  const normalizedUrlMode = backendUrlMode || 'static';
  const normalizedScheme = backendScheme || 'http';
  const normalizedPort = Number(backendPort) || 3021;

  if (!normalizedBackendUrl && normalizedUrlMode === 'static') {
    throw new Error('VPN_BACKEND_URL обязателен для remote-http provider');
  }

  const clients = new Map();

  function buildBackendUrl(server) {
    const explicitUrl = String(server?.backend_url || server?.provisioner_url || '').trim();
    if (explicitUrl) {
      return explicitUrl.replace(/\/+$/, '');
    }

    if (normalizedUrlMode === 'server-ip') {
      const host = server?.ip || server?.host || null;
      if (!host) {
        throw new Error('Для server-ip режима у сервера должен быть ip или host');
      }
      return `${normalizedScheme}://${host}:${normalizedPort}`;
    }

    return normalizedBackendUrl;
  }

  function getClient(server) {
    const resolvedUrl = buildBackendUrl(server);
    if (!resolvedUrl) {
      throw new Error('Не удалось определить backend URL');
    }

    if (!clients.has(resolvedUrl)) {
      clients.set(resolvedUrl, axios.create({
        baseURL: resolvedUrl,
        timeout: backendTimeoutMs,
        headers: backendToken ? { Authorization: `Bearer ${backendToken}` } : {}
      }));
    }

    return clients.get(resolvedUrl);
  }

  return {
    name: 'remote-http',
    async provision({ profile, server, user }) {
      const client = getClient(server);
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
    async revoke({ peer, server }) {
      const client = getClient(server);
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
