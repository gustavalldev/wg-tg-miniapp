function renderTemplateValue(value, context) {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
      const result = path.split('.').reduce((acc, key) => (acc == null ? '' : acc[key]), context);
      return result == null ? '' : String(result);
    });
  }

  if (Array.isArray(value)) {
    return value.map(item => renderTemplateValue(item, context));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderTemplateValue(item, context)])
    );
  }

  return value;
}

module.exports = function createLocalProvider(config) {
  const {
    protocolLabel,
    profileFormat,
    accessScheme,
    accessPort,
    serverIp,
    profileTemplateJson
  } = config;

  function buildAccessUri({ server, token, profileName }) {
    const host = server.host || server.entry_host || server.ip || serverIp;
    return `${accessScheme}://${token}@${host}:${accessPort}?label=${encodeURIComponent(profileName)}&server=${encodeURIComponent(server.id)}&type=${encodeURIComponent(server.protocol || protocolLabel)}`;
  }

  function buildPayload({ profile, server, user }) {
    const defaults = {
      version: 1,
      protocol: server.protocol || protocolLabel,
      profile_name: profile.name,
      profile_id: profile.id,
      access_uri: profile.accessUri,
      server: {
        id: server.id,
        name: server.name,
        host: server.host,
        ip: server.ip,
        location: server.location,
        role: server.role
      },
      chain: {
        entry_host: server.entry_host,
        exit_host: server.exit_host
      },
      user: {
        telegram_id: user.id,
        username: user.username || null
      },
      notes: [
        'Профиль создан локальным provider-ом.',
        'Для боевого режима подключите remote-http backend.'
      ]
    };

    if (!profileTemplateJson) {
      return defaults;
    }

    try {
      const template = JSON.parse(profileTemplateJson);
      return renderTemplateValue(template, { profile, server, user, defaults });
    } catch (_error) {
      return defaults;
    }
  }

  return {
    name: 'local-template',
    async provision({ profile, server, user }) {
      const accessUri = buildAccessUri({
        server,
        token: profile.token,
        profileName: profile.name
      });
      const payload = buildPayload({
        profile: { ...profile, accessUri },
        server,
        user
      });

      return {
        protocol: server.protocol || protocolLabel,
        profileFormat,
        accessUri,
        configPayload: payload,
        downloadName: `${profile.name}.${profileFormat === 'uri' ? 'txt' : 'json'}`
      };
    },
    async revoke() {
      return { ok: true };
    }
  };
};
