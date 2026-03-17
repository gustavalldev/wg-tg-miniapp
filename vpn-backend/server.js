const express = require('express');
const crypto = require('crypto');

require('dotenv').config();

const app = express();
const PORT = process.env.VPN_BACKEND_PORT || 3020;
const DEFAULT_PROTOCOL = process.env.VPN_BACKEND_PROTOCOL || 'VLESS';
const DEFAULT_PROFILE_FORMAT = process.env.VPN_BACKEND_PROFILE_FORMAT || 'uri';
const NODES_JSON = process.env.VPN_BACKEND_NODES_JSON || '';

app.use(express.json());

function normalizeNode(node, index = 0) {
  return {
    id: node.id || `node-${index + 1}`,
    name: node.name || `Node ${index + 1}`,
    protocol: node.protocol || DEFAULT_PROTOCOL,
    profile_format: node.profile_format || DEFAULT_PROFILE_FORMAT,
    enabled: node.enabled !== false,
    is_default: Boolean(node.is_default),
    host: node.host || node.ip || '127.0.0.1',
    ip: node.ip || node.host || '127.0.0.1',
    port: Number(node.port) || 443,
    country_code: node.country_code || 'SG',
    transport: node.transport || 'tcp',
    security: node.security || 'tls',
    sni: node.sni || node.host || node.ip || '127.0.0.1'
  };
}

function getNodes() {
  if (NODES_JSON) {
    try {
      const parsed = JSON.parse(NODES_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((node, index) => normalizeNode(node, index));
      }
    } catch (_error) {
      console.warn('VPN_BACKEND_NODES_JSON невалиден, используем дефолтную ноду');
    }
  }

  return [
    normalizeNode({
      id: 'foreign-vless-main',
      name: 'Foreign VLESS Main',
      is_default: true,
      host: 'vpnnew1.com',
      ip: '176.98.191.110',
      country_code: 'SG',
      port: 443,
      transport: 'tcp',
      security: 'tls',
      sni: 'vpnnew1.com'
    })
  ];
}

function resolveNode(_profile, server) {
  const nodes = getNodes().filter(node => node.enabled);
  if (nodes.length === 0) {
    throw new Error('Нет доступных VPN-нод');
  }

  const preferredId = server?.node_id || server?.route_id || server?.id;
  if (preferredId) {
    return nodes.find(node => node.id === preferredId) || null;
  }

  return nodes.find(node => node.is_default) || nodes[0];
}

function uuidFromToken(token) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token)) {
    return token;
  }

  const hex = crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32)
  ].join('-');
}

function buildAccessUri({ profile, node }) {
  const uuid = uuidFromToken(profile.token);
  const query = new URLSearchParams({
    encryption: 'none',
    type: node.transport,
    security: node.security,
    sni: node.sni
  });

  return `vless://${uuid}@${node.host}:${node.port}?${query.toString()}#${encodeURIComponent(profile.name)}`;
}

function buildConfigPayload({ profile, node, user }) {
  return {
    version: 1,
    protocol: node.protocol,
    profile_name: profile.name,
    profile_id: profile.id,
    node: {
      id: node.id,
      name: node.name,
      host: node.host,
      ip: node.ip,
      port: node.port,
      country_code: node.country_code,
      transport: node.transport,
      security: node.security,
      sni: node.sni
    },
    user: {
      telegram_id: user.id,
      username: user.username || null
    },
    client_import: {
      format: node.profile_format,
      access_uri: buildAccessUri({ profile, node })
    },
    notes: [
      'Профиль построен для прямого подключения к одной foreign VLESS-ноде.',
      'Этот backend пока отдаёт шаблон профиля и не управляет реальным Xray provision/revoke.'
    ]
  };
}

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    status: 'running',
    nodes: getNodes().map(node => ({
      id: node.id,
      name: node.name,
      enabled: node.enabled
    }))
  });
});

app.post('/provision', (req, res) => {
  try {
    const { profile, server, user } = req.body || {};

    if (!profile?.name || !profile?.id || !profile?.token) {
      return res.status(400).json({ error: 'profile.name, profile.id и profile.token обязательны' });
    }

    if (!user?.id) {
      return res.status(400).json({ error: 'user.id обязателен' });
    }

    const node = resolveNode(profile, server);
    if (!node) {
      return res.status(404).json({ error: 'VPN-нода не найдена' });
    }

    const accessUri = buildAccessUri({ profile, node });
    const configPayload = buildConfigPayload({ profile, node, user });

    res.json({
      protocol: node.protocol,
      profile_format: node.profile_format,
      access_uri: accessUri,
      config_payload: configPayload,
      download_name: `${profile.name}.${node.profile_format === 'uri' ? 'txt' : 'json'}`,
      meta: {
        node_id: node.id,
        node_name: node.name,
        country_code: node.country_code,
        host: node.host,
        port: node.port
      }
    });
  } catch (error) {
    console.error('Ошибка provision:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/revoke', (req, res) => {
  const { peer } = req.body || {};
  res.json({
    ok: true,
    revoked_profile: peer?.name || null
  });
});

app.listen(PORT, () => {
  console.log(`VPN backend listening on port ${PORT}`);
});
