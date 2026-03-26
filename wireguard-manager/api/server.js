const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');
const { createVpnProvider } = require('./providers');

require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;
const SERVER_IP = process.env.SERVER_IP || '127.0.0.1';
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@kirillprodev';
const TELEGRAM_BOT_USERNAME = (process.env.TELEGRAM_BOT_USERNAME || '@vpn_appguard_bot').replace(/^@/, '');
const ALLOW_LOCAL_WEBAPP = process.env.ALLOW_LOCAL_WEBAPP === 'true';
const DEV_TELEGRAM_ID = parseInt(process.env.DEV_TELEGRAM_ID || '999000', 10);
const DEV_TELEGRAM_USERNAME = process.env.DEV_TELEGRAM_USERNAME || 'localdev';
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || '')
  .split(',')
  .map(item => item.trim().replace(/^@/, ''))
  .filter(Boolean);
const SERVERS_JSON = process.env.SERVERS_JSON || '';
const VPN_PROTOCOL_LABEL = process.env.VPN_PROTOCOL_LABEL || 'Managed VPN';
const VPN_PROFILE_FORMAT = process.env.VPN_PROFILE_FORMAT || 'json';
const VPN_ACCESS_SCHEME = process.env.VPN_ACCESS_SCHEME || 'vpn';
const VPN_ACCESS_PORT = process.env.VPN_ACCESS_PORT || '443';
const VPN_PROFILE_TEMPLATE_JSON = process.env.VPN_PROFILE_TEMPLATE_JSON || '';
const VPN_PROVIDER_MODE = process.env.VPN_PROVIDER_MODE || 'local-template';
const VPN_BACKEND_URL = process.env.VPN_BACKEND_URL || '';
const VPN_BACKEND_TOKEN = process.env.VPN_BACKEND_TOKEN || '';
const VPN_BACKEND_TIMEOUT_MS = parseInt(process.env.VPN_BACKEND_TIMEOUT_MS || '10000', 10);
const TRIAL_TARIFF_CODE = process.env.TRIAL_TARIFF_CODE || 'trial-30d';
const TRIAL_DAYS = parseInt(process.env.TRIAL_DAYS || '30', 10);
const REFERRAL_REWARD_DAYS = parseInt(process.env.REFERRAL_REWARD_DAYS || '7', 10);
const PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || 'manual';
const SUPPORT_USERNAME = process.env.SUPPORT_USERNAME || 'kkasyanov';

const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});

app.use(cors({
  origin: [
    'http://45.87.247.206:3001',
    'http://45.87.247.206:8080',
    'http://localhost:3002'
  ],
  credentials: true
}));
app.use(express.json());

const vpnProvider = createVpnProvider({
  mode: VPN_PROVIDER_MODE,
  backendUrl: VPN_BACKEND_URL,
  backendToken: VPN_BACKEND_TOKEN,
  backendTimeoutMs: VPN_BACKEND_TIMEOUT_MS,
  protocolLabel: VPN_PROTOCOL_LABEL,
  profileFormat: VPN_PROFILE_FORMAT,
  accessScheme: VPN_ACCESS_SCHEME,
  accessPort: VPN_ACCESS_PORT,
  serverIp: SERVER_IP,
  profileTemplateJson: VPN_PROFILE_TEMPLATE_JSON
});

function parseInitData(initData) {
  if (!initData || !TELEGRAM_TOKEN) {
    return null;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(TELEGRAM_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (calculatedHash !== hash) {
    return null;
  }

  const userRaw = params.get('user');
  const authDate = parseInt(params.get('auth_date') || '0', 10);

  if (!userRaw) {
    return null;
  }

  try {
    const user = JSON.parse(userRaw);
    return { user, authDate };
  } catch (_error) {
    console.warn('Не удалось распарсить user из initData');
    return null;
  }
}

function isAuthDateValid(authDate) {
  if (!authDate) return false;
  return Date.now() - authDate * 1000 <= 24 * 60 * 60 * 1000;
}

function getDevUser() {
  return {
    id: DEV_TELEGRAM_ID,
    username: DEV_TELEGRAM_USERNAME,
    first_name: 'Local',
    last_name: 'Dev'
  };
}

function getWebAppUser({ initData, devRequested }) {
  const parsed = parseInitData(initData);
  if (parsed && isAuthDateValid(parsed.authDate)) {
    return { user: parsed.user, authDate: parsed.authDate, dev: false };
  }

  if (ALLOW_LOCAL_WEBAPP && devRequested) {
    return { user: getDevUser(), authDate: null, dev: true };
  }

  return null;
}

function isAdminUsername(username) {
  if (!username) return false;
  return ADMIN_USERNAMES.includes(username.replace(/^@/, ''));
}

async function checkTelegramSubscription(userId) {
  if (!TELEGRAM_TOKEN || !CHANNEL_USERNAME) {
    return { subscribed: false, status: 'unknown' };
  }

  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/getChatMember`, {
      params: {
        chat_id: CHANNEL_USERNAME,
        user_id: userId
      }
    });
    const status = response.data?.result?.status;
    return {
      subscribed: ['creator', 'administrator', 'member'].includes(status),
      status: status || 'unknown'
    };
  } catch (error) {
    console.error('Ошибка проверки подписки:', error.message);
    // Telegram can be intermittently unreachable from the control server.
    // Fail open here to avoid blocking WebApp auth and profile issuance.
    return { subscribed: true, status: 'error-open' };
  }
}

async function sendTelegramMessage(chatId, text) {
  if (!TELEGRAM_TOKEN) {
    throw new Error('TELEGRAM_TOKEN не настроен');
  }

  await axios.post(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text,
    parse_mode: 'HTML'
  });
}

async function ensureSchema() {
  const statements = [
    'ALTER TABLE public.peers ALTER COLUMN public_key DROP NOT NULL',
    'ALTER TABLE public.peers ALTER COLUMN private_key DROP NOT NULL',
    'ALTER TABLE public.peers ADD COLUMN IF NOT EXISTS route_id text',
    'ALTER TABLE public.peers ADD COLUMN IF NOT EXISTS protocol text DEFAULT \'managed-vpn\'',
    'ALTER TABLE public.peers ADD COLUMN IF NOT EXISTS access_uri text',
    'ALTER TABLE public.peers ADD COLUMN IF NOT EXISTS config_payload jsonb DEFAULT \'{}\'::jsonb',
    'ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS host text',
    'ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS role text DEFAULT \'edge\'',
    'ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS country_code text',
    'ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS provider text',
    'ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS status text DEFAULT \'online\'',
    'ALTER TABLE public.servers ADD COLUMN IF NOT EXISTS enabled boolean DEFAULT true',
    'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_code text',
    'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referred_by_user_id integer',
    'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referred_at timestamp without time zone',
    'ALTER TABLE public.users ADD COLUMN IF NOT EXISTS referral_reward_granted_at timestamp without time zone',
    'ALTER TABLE public.tariffs ADD COLUMN IF NOT EXISTS code text',
    'ALTER TABLE public.tariffs ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true',
    'ALTER TABLE public.tariffs ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0',
    `CREATE TABLE IF NOT EXISTS public.routes (
      id text PRIMARY KEY,
      name text NOT NULL,
      entry_server_id text NOT NULL REFERENCES public.servers(id),
      exit_server_id text NOT NULL REFERENCES public.servers(id),
      protocol text DEFAULT 'managed-vpn',
      profile_format text DEFAULT 'json',
      enabled boolean DEFAULT true,
      is_default boolean DEFAULT false,
      created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS public.access_profiles (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES public.users(id),
      route_id text NOT NULL REFERENCES public.routes(id),
      server_id text REFERENCES public.servers(id),
      profile_name text NOT NULL,
      profile_token text,
      protocol text DEFAULT 'managed-vpn',
      profile_format text DEFAULT 'json',
      access_uri text,
      config_payload jsonb DEFAULT '{}'::jsonb,
      provider_meta jsonb DEFAULT '{}'::jsonb,
      active boolean DEFAULT true,
      created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
      revoked_at timestamp without time zone
    )`,
    `CREATE TABLE IF NOT EXISTS public.payments (
      id serial PRIMARY KEY,
      user_id integer NOT NULL REFERENCES public.users(id),
      tariff_id integer NOT NULL REFERENCES public.tariffs(id),
      amount numeric(10,2) NOT NULL,
      currency text NOT NULL DEFAULT 'RUB',
      status text NOT NULL DEFAULT 'pending',
      provider text NOT NULL DEFAULT 'manual',
      provider_ref text,
      details jsonb DEFAULT '{}'::jsonb,
      created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
      paid_at timestamp without time zone,
      rejected_at timestamp without time zone
    )`,
    'CREATE UNIQUE INDEX IF NOT EXISTS access_profiles_profile_name_uq ON public.access_profiles (profile_name)',
    'CREATE INDEX IF NOT EXISTS access_profiles_user_id_idx ON public.access_profiles (user_id)',
    'CREATE INDEX IF NOT EXISTS access_profiles_route_id_idx ON public.access_profiles (route_id)',
    'CREATE UNIQUE INDEX IF NOT EXISTS routes_name_uq ON public.routes (name)',
    'CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_uq ON public.users (referral_code)',
    'CREATE UNIQUE INDEX IF NOT EXISTS tariffs_code_uq ON public.tariffs (code)',
    'CREATE INDEX IF NOT EXISTS users_referred_by_user_id_idx ON public.users (referred_by_user_id)',
    'CREATE INDEX IF NOT EXISTS payments_user_id_idx ON public.payments (user_id)',
    'CREATE INDEX IF NOT EXISTS payments_status_idx ON public.payments (status)'
  ];

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (error) {
      console.warn(`Не удалось выполнить миграцию "${statement}": ${error.message}`);
    }
  }

  await seedTariffs();
}

async function seedTariffs() {
  const tariffs = [
    {
      code: 'trial-30d',
      name: 'Пробный период',
      duration_months: 1,
      duration_days: TRIAL_DAYS,
      price: 0,
      description: `Первый месяц бесплатно`,
      sort_order: 0
    },
    {
      code: 'plan-1m',
      name: '1 месяц',
      duration_months: 1,
      duration_days: 30,
      price: 190,
      description: 'Подписка на 1 месяц',
      sort_order: 10
    },
    {
      code: 'plan-3m',
      name: '3 месяца',
      duration_months: 3,
      duration_days: 90,
      price: 490,
      description: 'Подписка на 3 месяца',
      sort_order: 20
    },
    {
      code: 'plan-6m',
      name: '6 месяцев',
      duration_months: 6,
      duration_days: 180,
      price: 990,
      description: 'Подписка на 6 месяцев',
      sort_order: 30
    },
    {
      code: 'tester',
      name: 'tester',
      duration_months: 0,
      duration_days: 0,
      price: 0,
      description: 'Тестовый тариф',
      sort_order: 100
    }
  ];

  for (const tariff of tariffs) {
    await pool.query(
      `INSERT INTO public.tariffs (code, name, duration_months, duration_days, price, description, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, true, $7)
       ON CONFLICT (code) DO UPDATE
       SET name = EXCLUDED.name,
           duration_months = EXCLUDED.duration_months,
           duration_days = EXCLUDED.duration_days,
           price = EXCLUDED.price,
           description = EXCLUDED.description,
           is_active = EXCLUDED.is_active,
           sort_order = EXCLUDED.sort_order`,
      [
        tariff.code,
        tariff.name,
        tariff.duration_months,
        tariff.duration_days,
        tariff.price,
        tariff.description,
        tariff.sort_order
      ]
    );
  }
}

function hydrateRoute(route, index = 0) {
  return hydrateServer({
    id: route.id || `route-${index + 1}`,
    route_id: route.id || `route-${index + 1}`,
    name: route.name || `Route ${index + 1}`,
    ip: route.entry_ip || route.entry_host || SERVER_IP,
    host: route.entry_host || route.entry_ip || SERVER_IP,
    location: route.entry_location || route.entry_country_code || route.location || null,
    is_default: Boolean(route.is_default),
    status: route.enabled === false ? 'disabled' : (route.status || 'online'),
    protocol: route.protocol || VPN_PROTOCOL_LABEL,
    role: 'route',
    entry_host: route.entry_host || route.entry_ip || SERVER_IP,
    entry_ip: route.entry_ip || route.entry_host || SERVER_IP,
    entry_country_code: route.entry_country_code || 'RU',
    exit_host: route.exit_host || route.exit_ip || SERVER_IP,
    exit_ip: route.exit_ip || route.exit_host || SERVER_IP,
    exit_country_code: route.exit_country_code || 'NL',
    profile_format: route.profile_format || VPN_PROFILE_FORMAT
  });
}

function hydrateServer(server, index = 0) {
  return {
    id: server.id || `server-${index + 1}`,
    route_id: server.route_id || server.id || `server-${index + 1}`,
    name: server.name || `Server ${index + 1}`,
    ip: server.ip || SERVER_IP,
    host: server.host || server.ip || SERVER_IP,
    location: server.location || null,
    is_default: Boolean(server.is_default),
    status: server.status || 'online',
    protocol: server.protocol || VPN_PROTOCOL_LABEL,
    role: server.role || 'edge',
    entry_host: server.entry_host || server.host || server.ip || SERVER_IP,
    entry_ip: server.entry_ip || server.ip || SERVER_IP,
    entry_country_code: server.entry_country_code || server.country_code || 'RU',
    exit_host: server.exit_host || server.host || server.ip || SERVER_IP,
    exit_ip: server.exit_ip || server.ip || SERVER_IP,
    exit_country_code: server.exit_country_code || server.country_code || 'NL',
    profile_format: server.profile_format || VPN_PROFILE_FORMAT
  };
}

function getConfiguredServers() {
  if (SERVERS_JSON) {
    try {
      const parsed = JSON.parse(SERVERS_JSON);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((server, index) => hydrateServer(server, index));
      }
    } catch (_error) {
      console.warn('SERVERS_JSON невалиден, используем дефолтный сервер');
    }
  }

  return [hydrateServer({
    id: 'server-1',
    name: 'Primary Gateway',
    ip: SERVER_IP,
    is_default: true
  })];
}

async function getServersFromDb() {
  try {
    const routesRes = await pool.query(
      `SELECT r.id, r.name, r.protocol, r.profile_format, r.enabled, r.is_default,
              entry.host AS entry_host, entry.ip AS entry_ip, entry.location AS entry_location, entry.country_code AS entry_country_code,
              exit.host AS exit_host, exit.ip AS exit_ip, exit.location AS exit_location, exit.country_code AS exit_country_code
       FROM routes r
       JOIN servers entry ON entry.id = r.entry_server_id
       JOIN servers exit ON exit.id = r.exit_server_id
       WHERE r.enabled = true
       ORDER BY r.is_default DESC, r.name`
    );
    if (routesRes.rows.length > 0) {
      return routesRes.rows.map((route, index) => hydrateRoute(route, index));
    }

    const res = await pool.query(
      `SELECT id, name, ip, host, location, role, country_code, status, is_default
       FROM servers
       ORDER BY is_default DESC, name`
    );
    if (res.rows.length > 0) {
      return res.rows.map((server, index) => hydrateServer(server, index));
    }
  } catch (error) {
    console.warn('Не удалось получить servers из БД, используем конфиг:', error.message);
  }

  return getConfiguredServers();
}

function makeReferralCode() {
  return crypto.randomBytes(5).toString('hex');
}

function computeExpiryFromDays(currentExpiry, durationDays) {
  const now = new Date();
  const baseDate = currentExpiry && new Date(currentExpiry) > now ? new Date(currentExpiry) : now;
  baseDate.setDate(baseDate.getDate() + durationDays);
  return baseDate;
}

function isProfileActive(profile) {
  if (!profile) return false;
  if (profile.vpn_status === 'blocked') return false;
  if (profile.tariff_code === 'tester') return true;
  if (!profile.tariff_expiry) return false;
  return new Date(profile.tariff_expiry) > new Date();
}

async function ensureUniqueReferralCode() {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = makeReferralCode();
    const existing = await pool.query('SELECT 1 FROM users WHERE referral_code = $1', [code]);
    if (existing.rows.length === 0) {
      return code;
    }
  }

  throw new Error('Не удалось сгенерировать referral code');
}

async function getTariffByCode(code) {
  const result = await pool.query(
    `SELECT id, code, name, duration_months, duration_days, price, description, sort_order
     FROM tariffs
     WHERE code = $1
     LIMIT 1`,
    [code]
  );
  return result.rows[0] || null;
}

async function ensureUser(telegramUser, options = {}) {
  const existing = await pool.query(
    'SELECT id, referral_code, referred_by_user_id FROM users WHERE telegram_id = $1',
    [telegramUser.id]
  );

  if (existing.rows.length > 0) {
    const existingUser = existing.rows[0];
    if (!existingUser.referral_code) {
      const referralCode = await ensureUniqueReferralCode();
      await pool.query('UPDATE users SET referral_code = $1 WHERE id = $2', [referralCode, existingUser.id]);
    }

    if (options.referralCode && !existingUser.referred_by_user_id) {
      await attachReferral(existingUser.id, options.referralCode);
    }

    return existingUser.id;
  }

  const referralCode = await ensureUniqueReferralCode();
  const trialTariff = await getTariffByCode(TRIAL_TARIFF_CODE);
  const trialExpiry = computeExpiryFromDays(null, TRIAL_DAYS);

  const insert = await pool.query(
    `INSERT INTO users (telegram_id, username, tariff_id, tariff_expiry, referral_code, vpn_status)
     VALUES ($1, $2, $3, $4, $5, 'active')
     RETURNING id`,
    [telegramUser.id, telegramUser.username || null, trialTariff?.id || null, trialExpiry, referralCode]
  );

  if (options.referralCode) {
    await attachReferral(insert.rows[0].id, options.referralCode);
  }

  return insert.rows[0].id;
}

async function getUserProfileByTelegramId(telegramId) {
  const res = await pool.query(
    `SELECT u.id, u.vpn_status, u.tariff_expiry, u.referral_code, u.referred_by_user_id, u.referral_reward_granted_at,
            t.name AS tariff_name, t.code AS tariff_code,
            (SELECT COUNT(*) FROM peers WHERE user_id = u.id AND active = true) AS connections_count
     FROM users u
     LEFT JOIN tariffs t ON u.tariff_id = t.id
     WHERE u.telegram_id = $1`,
    [telegramId]
  );
  const profile = res.rows[0] || null;
  if (!profile) return null;
  return {
    ...profile,
    has_active_access: isProfileActive(profile)
  };
}

async function attachReferral(userId, referralCode) {
  if (!referralCode) return;

  const sanitizedCode = String(referralCode).trim().toLowerCase().replace(/^ref[_-]?/i, '');
  if (!sanitizedCode) return;

  const userRes = await pool.query(
    'SELECT id, referred_by_user_id, referral_code FROM users WHERE id = $1',
    [userId]
  );
  const user = userRes.rows[0];
  if (!user || user.referred_by_user_id || user.referral_code === sanitizedCode) {
    return;
  }

  const referrerRes = await pool.query(
    'SELECT id FROM users WHERE referral_code = $1 LIMIT 1',
    [sanitizedCode]
  );
  const referrer = referrerRes.rows[0];
  if (!referrer || referrer.id === userId) {
    return;
  }

  const paidPayments = await pool.query(
    'SELECT 1 FROM payments WHERE user_id = $1 AND status = $2 LIMIT 1',
    [userId, 'paid']
  );
  if (paidPayments.rows.length > 0) {
    return;
  }

  await pool.query(
    `UPDATE users
     SET referred_by_user_id = $1, referred_at = COALESCE(referred_at, NOW())
     WHERE id = $2 AND referred_by_user_id IS NULL`,
    [referrer.id, userId]
  );
}

async function getTariffs() {
  const result = await pool.query(
    `SELECT id, code, name, duration_months, duration_days, price, description, sort_order
     FROM tariffs
     WHERE is_active = true AND code <> 'tester'
     ORDER BY sort_order, duration_days, price`
  );
  return result.rows;
}

async function getReferralSummary(userId, referralCode) {
  const [linked, rewarded] = await Promise.all([
    pool.query(
      'SELECT COUNT(*)::int AS total FROM users WHERE referred_by_user_id = $1',
      [userId]
    ),
    pool.query(
      'SELECT COUNT(*)::int AS total FROM users WHERE referred_by_user_id = $1 AND referral_reward_granted_at IS NOT NULL',
      [userId]
    )
  ]);

  return {
    code: referralCode,
    invite_link: referralCode ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=ref_${referralCode}` : null,
    invited_total: linked.rows[0]?.total || 0,
    rewarded_total: rewarded.rows[0]?.total || 0,
    reward_days: REFERRAL_REWARD_DAYS
  };
}

async function getPendingPayment(userId) {
  const result = await pool.query(
    `SELECT p.id, p.amount, p.currency, p.status, p.created_at, t.name AS tariff_name, t.code AS tariff_code
     FROM payments p
     JOIN tariffs t ON t.id = p.tariff_id
     WHERE p.user_id = $1 AND p.status = 'pending'
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function createPaymentRequest(userId, tariffCode) {
  const tariff = await getTariffByCode(tariffCode);
  if (!tariff || tariff.code === TRIAL_TARIFF_CODE || tariff.code === 'tester') {
    throw new Error('Тариф недоступен для оплаты.');
  }

  const pending = await getPendingPayment(userId);
  if (pending) {
    return pending;
  }

  const result = await pool.query(
    `INSERT INTO payments (user_id, tariff_id, amount, currency, status, provider, details)
     VALUES ($1, $2, $3, 'RUB', 'pending', $4, $5)
     RETURNING id, amount, currency, status, created_at`,
    [userId, tariff.id, tariff.price, PAYMENT_PROVIDER, JSON.stringify({ tariff_code: tariff.code })]
  );

  return {
    ...result.rows[0],
    tariff_name: tariff.name,
    tariff_code: tariff.code
  };
}

async function applyReferralRewardIfEligible(userId) {
  const userRes = await pool.query(
    `SELECT id, referred_by_user_id, referral_reward_granted_at, tariff_expiry
     FROM users
     WHERE id = $1`,
    [userId]
  );
  const user = userRes.rows[0];
  if (!user || !user.referred_by_user_id || user.referral_reward_granted_at) {
    return;
  }

  const rewardExpiryForInvitee = computeExpiryFromDays(user.tariff_expiry, REFERRAL_REWARD_DAYS);
  const referrerRes = await pool.query(
    'SELECT id, tariff_expiry FROM users WHERE id = $1',
    [user.referred_by_user_id]
  );
  const referrer = referrerRes.rows[0];
  const rewardExpiryForReferrer = computeExpiryFromDays(referrer?.tariff_expiry || null, REFERRAL_REWARD_DAYS);

  await pool.query(
    `UPDATE users
     SET tariff_expiry = $1,
         referral_reward_granted_at = NOW()
     WHERE id = $2`,
    [rewardExpiryForInvitee, user.id]
  );

  if (referrer) {
    await pool.query(
      `UPDATE users
       SET tariff_expiry = $1
       WHERE id = $2`,
      [rewardExpiryForReferrer, referrer.id]
    );
  }
}

async function approvePayment(paymentId) {
  const paymentRes = await pool.query(
    `SELECT p.id, p.user_id, p.tariff_id, p.status, t.code AS tariff_code, t.name AS tariff_name, t.duration_days
     FROM payments p
     JOIN tariffs t ON t.id = p.tariff_id
     WHERE p.id = $1
     LIMIT 1`,
    [paymentId]
  );
  const payment = paymentRes.rows[0];
  if (!payment) {
    throw new Error('Платёж не найден.');
  }
  if (payment.status !== 'pending') {
    throw new Error('Платёж уже обработан.');
  }

  const userRes = await pool.query(
    'SELECT tariff_expiry FROM users WHERE id = $1 LIMIT 1',
    [payment.user_id]
  );
  const user = userRes.rows[0];
  const nextExpiry = computeExpiryFromDays(user?.tariff_expiry || null, payment.duration_days || 0);

  await pool.query(
    `UPDATE users
     SET tariff_id = $1,
         tariff_expiry = $2,
         vpn_status = 'active'
     WHERE id = $3`,
    [payment.tariff_id, nextExpiry, payment.user_id]
  );
  await pool.query(
    `UPDATE payments
     SET status = 'paid', paid_at = NOW()
     WHERE id = $1`,
    [payment.id]
  );
  await applyReferralRewardIfEligible(payment.user_id);
}

async function revokePeerAccess(peer, user) {
  await vpnProvider.revoke({
    peer,
    user
  });
  await pool.query('UPDATE access_profiles SET active = false, revoked_at = NOW() WHERE profile_name = $1', [peer.name]);
  await pool.query('DELETE FROM peers WHERE name = $1', [peer.name]);
}

async function enforceActiveAccess(userDbId, telegramUser, req = null) {
  const profile = await getUserProfileByTelegramId(telegramUser.id);
  if (isProfileActive(profile)) {
    return profile;
  }

  const peer = await getUserPeerByUserId(userDbId);
  if (peer) {
    await revokePeerAccess(peer, telegramUser);
    if (req) {
      await logAction(userDbId, peer.name, 'access_revoked_expired', {}, req);
    }
  }

  return profile;
}

function parseConfigPayload(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return {};
  }
}

function normalizePeer(row) {
  if (!row) return null;
  return {
    ...row,
    protocol: row.protocol || VPN_PROTOCOL_LABEL,
    config_payload: parseConfigPayload(row.config_payload)
  };
}

async function getUserPeerByUserId(userId) {
  try {
    const accessProfiles = await pool.query(
      `SELECT profile_name AS name,
              COALESCE(access_profiles.server_id, access_profiles.route_id) AS server_id,
              route_id,
              profile_token AS ip,
              protocol,
              access_uri,
              config_payload,
              profile_format
       FROM access_profiles
       WHERE user_id = $1 AND active = true
       ORDER BY created_at
       LIMIT 1`,
      [userId]
    );
    if (accessProfiles.rows.length > 0) {
      return normalizePeer(accessProfiles.rows[0]);
    }
  } catch (error) {
    console.warn('Не удалось получить access_profiles, используем peers:', error.message);
  }

  const res = await pool.query(
    `SELECT name, ip, protocol, access_uri, config_payload, server_id, route_id
     FROM peers
     WHERE user_id = $1 AND active = true
     ORDER BY created_at
     LIMIT 1`,
    [userId]
  );
  return normalizePeer(res.rows[0] || null);
}

function sanitizeName(value) {
  return (value || 'user')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'user';
}

function buildDownload(peer) {
  const format = peer.profile_format || VPN_PROFILE_FORMAT;
  const downloadName = peer.download_name || `${peer.name}.${format === 'uri' ? 'txt' : 'json'}`;
  return {
    filename: downloadName,
    mimeType: format === 'uri' ? 'text/plain' : 'application/json',
    content: format === 'uri'
      ? (peer.access_uri || '')
      : JSON.stringify(peer.config_payload || {}, null, 2)
  };
}

async function logAction(userId, peerName, action, details = {}, req) {
  try {
    await pool.query(
      `INSERT INTO peer_logs (user_id, peer_name, action, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        userId,
        peerName,
        action,
        JSON.stringify(details),
        req.ip || req.connection.remoteAddress,
        req.get('User-Agent') || ''
      ]
    );
  } catch (error) {
    console.error('Ошибка логирования:', error.message);
  }
}

async function createAccessProfileForUser(userDbId, telegramUser, req, server) {
  const profile = {
    name: `${sanitizeName(telegramUser.username || `user-${telegramUser.id}`)}-${telegramUser.id}`,
    id: `${server.id}-${crypto.randomBytes(4).toString('hex')}`,
    token: crypto.randomBytes(16).toString('hex')
  };
  const provisioned = await vpnProvider.provision({
    profile,
    server,
    user: telegramUser
  });

  const insert = await pool.query(
    `INSERT INTO peers (user_id, server_id, route_id, name, public_key, private_key, ip, protocol, access_uri, config_payload)
     VALUES ($1, $2, $3, $4, NULL, NULL, $5, $6, $7, $8)
     RETURNING name, ip, protocol, access_uri, config_payload, server_id, route_id`,
    [
      userDbId,
      server.id,
      server.route_id || server.id,
      profile.name,
      profile.id,
      provisioned.protocol || server.protocol || VPN_PROTOCOL_LABEL,
      provisioned.accessUri || provisioned.access_uri,
      JSON.stringify(provisioned.configPayload || provisioned.config_payload || {})
    ]
  );

  try {
    await pool.query(
      `INSERT INTO access_profiles
       (user_id, route_id, server_id, profile_name, profile_token, protocol, profile_format, access_uri, config_payload, provider_meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        userDbId,
        server.route_id || server.id,
        server.id,
        profile.name,
        profile.id,
        provisioned.protocol || server.protocol || VPN_PROTOCOL_LABEL,
        provisioned.profileFormat || provisioned.profile_format || VPN_PROFILE_FORMAT,
        provisioned.accessUri || provisioned.access_uri,
        JSON.stringify(provisioned.configPayload || provisioned.config_payload || {}),
        JSON.stringify(provisioned.providerMeta || provisioned.meta || {})
      ]
    );
  } catch (error) {
    console.warn('Не удалось записать access_profiles:', error.message);
  }

  await logAction(userDbId, profile.name, 'create', {
    server_id: server.id,
    route_id: server.route_id || server.id,
    profile_id: profile.id,
    protocol: provisioned.protocol || server.protocol || VPN_PROTOCOL_LABEL,
    provider: vpnProvider.name
  }, req);

  return {
    ...normalizePeer(insert.rows[0]),
    profile_format: provisioned.profileFormat || VPN_PROFILE_FORMAT,
    download_name: provisioned.downloadName || null,
    provider_meta: provisioned.providerMeta || {}
  };
}

async function requireAdmin(req, res) {
  const { initData, dev } = req.body;
  const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
  if (!result) {
    res.status(401).json({ error: 'Invalid init data' });
    return null;
  }

  if (!result.dev && !isAdminUsername(result.user.username)) {
    res.status(403).json({ error: 'Недостаточно прав' });
    return null;
  }

  if (!result.dev) {
    const subscription = await checkTelegramSubscription(result.user.id);
    if (!subscription.subscribed) {
      res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
      return null;
    }
  }

  return result;
}

app.post('/api/webapp/auth', async (req, res) => {
  try {
    const { initData, dev } = req.body;
    const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
    if (!result) {
      return res.status(401).json({ error: 'Invalid init data' });
    }

    const subscription = result.dev
      ? { subscribed: true, status: 'dev' }
      : await checkTelegramSubscription(result.user.id);
    const userDbId = await ensureUser(result.user);
    const profile = await enforceActiveAccess(userDbId, result.user);
    const peer = await getUserPeerByUserId(userDbId);
    const [tariffs, referral, pendingPayment] = await Promise.all([
      getTariffs(),
      getReferralSummary(userDbId, profile?.referral_code),
      getPendingPayment(userDbId)
    ]);

    res.json({
      ok: true,
      user: result.user,
      subscribed: subscription.subscribed,
      subscription_status: subscription.status,
      profile,
      peer: peer ? {
        name: peer.name,
        ip: peer.ip,
        protocol: peer.protocol,
        access_uri: peer.access_uri
      } : null,
      is_admin: isAdminUsername(result.user.username),
      tariffs,
      referral,
      pending_payment: pendingPayment
    });
  } catch (error) {
    console.error('Ошибка webapp auth:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/connect', async (req, res) => {
  try {
    const { initData, dev, server_id } = req.body;
    const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
    if (!result) {
      return res.status(401).json({ error: 'Invalid init data' });
    }

    const subscription = result.dev
      ? { subscribed: true, status: 'dev' }
      : await checkTelegramSubscription(result.user.id);
    if (!subscription.subscribed) {
      return res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
    }

    const servers = await getServersFromDb();
    const selectedServer = server_id
      ? servers.find(server => server.id === server_id)
      : (servers.find(server => server.is_default) || servers[0]);

    if (!selectedServer) {
      return res.status(400).json({ error: 'Выбранный сервер недоступен.' });
    }

    const userDbId = await ensureUser(result.user);
    const profile = await enforceActiveAccess(userDbId, result.user, req);
    if (!isProfileActive(profile)) {
      return res.status(402).json({
        error: 'Пробный период или подписка истекли. Выберите тариф.',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }
    const existingPeer = await getUserPeerByUserId(userDbId);
    if (existingPeer) {
      return res.status(400).json({ error: 'У вас уже есть активный профиль доступа.' });
    }

    const peer = await createAccessProfileForUser(userDbId, result.user, req, selectedServer);
    const download = buildDownload(peer);

    res.json({
      ok: true,
      peer: {
        name: peer.name,
        ip: peer.ip,
        protocol: peer.protocol,
        access_uri: peer.access_uri
      },
      config: download.content,
      mime_type: download.mimeType,
      download_name: download.filename,
      server: selectedServer
    });
  } catch (error) {
    console.error('Ошибка webapp connect:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/remove', async (req, res) => {
  try {
    const { initData, dev } = req.body;
    const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
    if (!result) {
      return res.status(401).json({ error: 'Invalid init data' });
    }

    const subscription = result.dev
      ? { subscribed: true, status: 'dev' }
      : await checkTelegramSubscription(result.user.id);
    if (!subscription.subscribed) {
      return res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
    }

    const userDbId = await ensureUser(result.user);
    await enforceActiveAccess(userDbId, result.user, req);
    const peer = await getUserPeerByUserId(userDbId);
    if (!peer) {
      return res.status(400).json({ error: 'У вас нет активных VPN-профилей.' });
    }

    await revokePeerAccess(peer, result.user);
    await logAction(userDbId, peer.name, 'delete', {}, req);

    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка webapp remove:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/config', async (req, res) => {
  try {
    const { initData, dev } = req.body;
    const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
    if (!result) {
      return res.status(401).json({ error: 'Invalid init data' });
    }

    const subscription = result.dev
      ? { subscribed: true, status: 'dev' }
      : await checkTelegramSubscription(result.user.id);
    if (!subscription.subscribed) {
      return res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
    }

    const userDbId = await ensureUser(result.user);
    const profile = await enforceActiveAccess(userDbId, result.user, req);
    if (!isProfileActive(profile)) {
      return res.status(402).json({
        error: 'Пробный период или подписка истекли. Выберите тариф.',
        code: 'SUBSCRIPTION_REQUIRED'
      });
    }
    const peer = await getUserPeerByUserId(userDbId);
    if (!peer) {
      return res.status(400).json({ error: 'У вас нет активных VPN-профилей.' });
    }

    const download = buildDownload(peer);
    await logAction(userDbId, peer.name, 'download_profile', { profile_id: peer.ip }, req);

    res.json({
      ok: true,
      peer: {
        name: peer.name,
        ip: peer.ip,
        protocol: peer.protocol,
        access_uri: peer.access_uri
      },
      config: download.content,
      mime_type: download.mimeType,
      download_name: download.filename
    });
  } catch (error) {
    console.error('Ошибка webapp config:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/apply-referral', async (req, res) => {
  try {
    const { initData, dev, referral_code } = req.body;
    const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
    if (!result) {
      return res.status(401).json({ error: 'Invalid init data' });
    }

    if (!referral_code || !String(referral_code).trim()) {
      return res.status(400).json({ error: 'referral_code обязателен' });
    }

    const userDbId = await ensureUser(result.user);
    await attachReferral(userDbId, referral_code);
    const profile = await getUserProfileByTelegramId(result.user.id);
    const referral = await getReferralSummary(userDbId, profile?.referral_code);

    res.json({ ok: true, referral });
  } catch (error) {
    console.error('Ошибка apply-referral:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/payments/create', async (req, res) => {
  try {
    const { initData, dev, tariff_code } = req.body;
    const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
    if (!result) {
      return res.status(401).json({ error: 'Invalid init data' });
    }

    const subscription = result.dev
      ? { subscribed: true, status: 'dev' }
      : await checkTelegramSubscription(result.user.id);
    if (!subscription.subscribed) {
      return res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
    }

    const userDbId = await ensureUser(result.user);
    const payment = await createPaymentRequest(userDbId, tariff_code);

    res.json({
      ok: true,
      payment,
      instructions: `Заявка #${payment.id} создана. Сейчас оплата подтверждается вручную через поддержку: @${SUPPORT_USERNAME}.`
    });
  } catch (error) {
    console.error('Ошибка payments create:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/users', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { search } = req.body;
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      params.push(search);
      where = 'WHERE u.username ILIKE $1 OR CAST(u.telegram_id AS TEXT) = $2';
    }

    const users = await pool.query(
      `SELECT u.id, u.telegram_id, u.username, u.vpn_status, u.created_at, u.tariff_expiry, t.name AS tariff_name
       FROM users u
       LEFT JOIN tariffs t ON t.id = u.tariff_id
       ${where}
       ORDER BY u.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({ ok: true, users: users.rows });
  } catch (error) {
    console.error('Ошибка admin users:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/payments', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const payments = await pool.query(
      `SELECT p.id, p.amount, p.currency, p.status, p.created_at, p.paid_at, p.rejected_at,
              t.name AS tariff_name, t.code AS tariff_code,
              u.telegram_id, u.username
       FROM payments p
       JOIN tariffs t ON t.id = p.tariff_id
       JOIN users u ON u.id = p.user_id
       ORDER BY
         CASE p.status
           WHEN 'pending' THEN 0
           WHEN 'paid' THEN 1
           ELSE 2
         END,
         p.created_at DESC
       LIMIT 100`
    );

    res.json({ ok: true, payments: payments.rows });
  } catch (error) {
    console.error('Ошибка admin payments:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/approve-payment', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { payment_id } = req.body;
    if (!payment_id) {
      return res.status(400).json({ error: 'payment_id обязателен' });
    }

    await approvePayment(Number(payment_id));
    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка approve-payment:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/reject-payment', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { payment_id } = req.body;
    if (!payment_id) {
      return res.status(400).json({ error: 'payment_id обязателен' });
    }

    await pool.query(
      `UPDATE payments
       SET status = 'rejected', rejected_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [Number(payment_id)]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка reject-payment:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/peers', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { search } = req.body;
    const params = [];
    let where = '';
    if (search) {
      params.push(`%${search}%`);
      params.push(`%${search}%`);
      where = 'WHERE p.name ILIKE $1 OR u.username ILIKE $2';
    }

    const peers = await pool.query(
      `SELECT p.name, p.ip, p.protocol, p.created_at, p.active, p.access_uri, u.username, u.telegram_id
       FROM peers p
       LEFT JOIN users u ON p.user_id = u.id
       ${where}
       ORDER BY p.created_at DESC
       LIMIT 200`,
      params
    );

    res.json({ ok: true, peers: peers.rows });
  } catch (error) {
    console.error('Ошибка admin peers:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/ban-user', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { telegram_id } = req.body;
    if (!telegram_id) {
      return res.status(400).json({ error: 'telegram_id обязателен' });
    }

    await pool.query('UPDATE users SET vpn_status = $1 WHERE telegram_id = $2', ['blocked', telegram_id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка admin ban-user:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/unban-user', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { telegram_id } = req.body;
    if (!telegram_id) {
      return res.status(400).json({ error: 'telegram_id обязателен' });
    }

    await pool.query('UPDATE users SET vpn_status = $1 WHERE telegram_id = $2', ['active', telegram_id]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка admin unban-user:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/delete-peer', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name обязателен' });
    }

    await pool.query('DELETE FROM peers WHERE name = $1', [name]);
    res.json({ ok: true });
  } catch (error) {
    console.error('Ошибка admin delete-peer:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/peer-config', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'name обязателен' });
    }

    const peerRes = await pool.query(
      'SELECT name, ip, protocol, access_uri, config_payload, server_id FROM peers WHERE name = $1',
      [name]
    );
    const peer = normalizePeer(peerRes.rows[0] || null);
    if (!peer) {
      return res.status(404).json({ error: 'Профиль не найден' });
    }

    const download = buildDownload(peer);
    res.json({
      ok: true,
      peer: {
        name: peer.name,
        ip: peer.ip,
        protocol: peer.protocol,
        access_uri: peer.access_uri
      },
      config: download.content,
      mime_type: download.mimeType,
      download_name: download.filename
    });
  } catch (error) {
    console.error('Ошибка admin peer-config:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webapp/admin/broadcast', async (req, res) => {
  try {
    const auth = await requireAdmin(req, res);
    if (!auth) return;

    const { message } = req.body;
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'message обязателен' });
    }

    const users = await pool.query(
      'SELECT telegram_id FROM users WHERE vpn_status <> $1 OR vpn_status IS NULL',
      ['blocked']
    );

    let success = 0;
    let errors = 0;

    for (const user of users.rows) {
      try {
        await sendTelegramMessage(user.telegram_id, message.trim());
        success += 1;
      } catch (error) {
        console.error(`Ошибка отправки сообщения ${user.telegram_id}:`, error.message);
        errors += 1;
      }
    }

    res.json({ ok: true, success, errors });
  } catch (error) {
    console.error('Ошибка admin broadcast:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/peers', async (_req, res) => {
  try {
    const peers = await pool.query(
      `SELECT p.name, p.ip, p.protocol, p.access_uri, p.active, p.created_at, u.username, u.telegram_id
       FROM peers p
       LEFT JOIN users u ON p.user_id = u.id
       ORDER BY p.created_at DESC`
    );
    res.json({ ok: true, peers: peers.rows });
  } catch (error) {
    console.error('Ошибка получения профилей:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/peers/user/:user_id', async (req, res) => {
  try {
    const peers = await pool.query(
      `SELECT name, ip, protocol, access_uri, active, created_at
       FROM peers
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [req.params.user_id]
    );
    res.json({ ok: true, peers: peers.rows });
  } catch (error) {
    console.error('Ошибка получения профилей пользователя:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/peers/:name/config', async (req, res) => {
  try {
    const peerRes = await pool.query(
      'SELECT name, ip, protocol, access_uri, config_payload, server_id FROM peers WHERE name = $1',
      [req.params.name]
    );
    const peer = normalizePeer(peerRes.rows[0] || null);
    if (!peer) {
      return res.status(404).json({ error: 'Профиль не найден' });
    }

    const download = buildDownload(peer);
    res.set({
      'Content-Type': download.mimeType,
      'Content-Disposition': `attachment; filename="${download.filename}"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });
    res.send(download.content);
  } catch (error) {
    console.error('Ошибка получения профиля:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sync-config', async (_req, res) => {
  res.json({
    ok: true,
    message: 'Локальная синхронизация конфига больше не требуется. Профили хранятся в базе данных.'
  });
});

app.get('/api/servers', async (_req, res) => {
  try {
    const servers = await getServersFromDb();
    res.json({ ok: true, servers });
  } catch (error) {
    console.error('Ошибка получения серверов:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/diagnostics', async (_req, res) => {
  try {
    const [servers, peers] = await Promise.all([
      getServersFromDb(),
      pool.query(
        `SELECT protocol, COUNT(*)::int AS total
         FROM peers
         WHERE active = true
         GROUP BY protocol`
      )
    ]);

    res.json({
      service: {
        name: 'vpn-manager-api',
        status: 'running',
        protocol_label: VPN_PROTOCOL_LABEL,
        profile_format: VPN_PROFILE_FORMAT,
        provider: vpnProvider.name
      },
      servers,
      active_profiles: peers.rows
    });
  } catch (error) {
    console.error('Ошибка диагностики:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/check-config', async (req, res) => {
  try {
    const { peer_name } = req.body;
    if (!peer_name) {
      return res.status(400).json({ error: 'peer_name обязателен' });
    }

    const peerRes = await pool.query(
      'SELECT name, ip, protocol, access_uri, active FROM peers WHERE name = $1',
      [peer_name]
    );
    const peer = peerRes.rows[0];
    if (!peer) {
      return res.status(404).json({ error: 'Профиль не найден' });
    }

    res.json({
      peer_name: peer.name,
      peer_active: peer.active === true || peer.active === null,
      protocol: peer.protocol || VPN_PROTOCOL_LABEL,
      access_uri_present: Boolean(peer.access_uri),
      needs_update: false
    });
  } catch (error) {
    console.error('Ошибка проверки профиля:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/diagnose-peer', async (req, res) => {
  try {
    const { peer_name } = req.body;
    if (!peer_name) {
      return res.status(400).json({ error: 'peer_name обязателен' });
    }

    const peerRes = await pool.query(
      `SELECT p.name, p.ip, p.protocol, p.access_uri, p.active, p.created_at, s.name AS server_name
       FROM peers p
       LEFT JOIN servers s ON p.server_id = s.id
       WHERE p.name = $1`,
      [peer_name]
    );
    const peer = peerRes.rows[0];
    if (!peer) {
      return res.status(404).json({ error: 'Профиль не найден' });
    }

    res.json({
      peer_name: peer.name,
      profile_id: peer.ip,
      protocol: peer.protocol || VPN_PROTOCOL_LABEL,
      server_name: peer.server_name || null,
      access_uri_present: Boolean(peer.access_uri),
      peer_active: peer.active === true || peer.active === null,
      created_at: peer.created_at,
      needs_attention: false,
      issues: []
    });
  } catch (error) {
    console.error('Ошибка диагностики профиля:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, async () => {
  await ensureSchema();
  console.log(`VPN Manager API запущен на порту ${PORT}`);
  console.log(`Профили: ${VPN_PROTOCOL_LABEL} (${VPN_PROFILE_FORMAT})`);
});

module.exports = app;
