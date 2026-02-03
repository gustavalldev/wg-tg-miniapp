const express = require('express');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { Pool } = require('pg');
const { execSync } = require('child_process');
const axios = require('axios'); // Добавляем axios для отправки уведомлений
const crypto = require('crypto');


const app = express();
const PORT = process.env.PORT || 3000;

// Добавляем CORS для админ-панели
app.use(cors({
  origin: [
    'http://45.87.247.206:3001',
    'http://45.87.247.206:8080',
    'http://localhost:3002'
  ],
  credentials: true
}));

// Middleware
app.use(express.json());


// Путь к скрипту
const WG_SCRIPT = '/app/scripts/wg-manager.sh';

// Настройка подключения к удалённой базе данных
require('dotenv').config();
const SERVER_IP = process.env.SERVER_IP || '109.107.170.233';
const pool = new Pool({
  host: process.env.PG_HOST,
  port: process.env.PG_PORT,
  user: process.env.PG_USER,
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE,
});
const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || '@kirillprodev';
const ALLOW_LOCAL_WEBAPP = process.env.ALLOW_LOCAL_WEBAPP === 'true';
const DEV_TELEGRAM_ID = parseInt(process.env.DEV_TELEGRAM_ID || '999000', 10);
const DEV_TELEGRAM_USERNAME = process.env.DEV_TELEGRAM_USERNAME || 'localdev';
const ADMIN_USERNAMES = (process.env.ADMIN_USERNAMES || '')
    .split(',')
    .map(item => item.trim().replace(/^@/, ''))
    .filter(Boolean);
const SERVERS_JSON = process.env.SERVERS_JSON || '';

// Глобальная переменная для отслеживания ключа сервера
let currentServerPublicKey = null;

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
    } catch (e) {
        console.warn('Не удалось распарсить user из initData');
        return null;
    }
}

function isAuthDateValid(authDate) {
    if (!authDate) return false;
    const authMs = authDate * 1000;
    const now = Date.now();
    const maxAgeMs = 24 * 60 * 60 * 1000;
    return now - authMs <= maxAgeMs;
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
    const normalized = username.replace(/^@/, '');
    return ADMIN_USERNAMES.includes(normalized);
}

function getConfiguredServers() {
    if (SERVERS_JSON) {
        try {
            const parsed = JSON.parse(SERVERS_JSON);
            if (Array.isArray(parsed)) {
                return parsed.map((server, index) => ({
                    id: server.id || `server-${index + 1}`,
                    name: server.name || `Server ${index + 1}`,
                    ip: server.ip || SERVER_IP,
                    location: server.location || null,
                    is_default: Boolean(server.is_default)
                }));
            }
        } catch (e) {
            console.warn('SERVERS_JSON невалиден, используем дефолтный сервер');
        }
    }

    return [{
        id: 'server-1',
        name: 'Main Server',
        ip: SERVER_IP,
        location: null,
        is_default: true
    }];
}

async function getServersFromDb() {
    try {
        const res = await pool.query(
            `SELECT id, name, ip, location, is_default
             FROM servers
             ORDER BY is_default DESC, name`
        );
        if (res.rows.length > 0) {
            return res.rows;
        }
    } catch (error) {
        console.warn('Не удалось получить servers из БД, используем конфиг:', error.message);
    }
    return getConfiguredServers();
}

function getLocalServerStatus() {
    try {
        execSync('wg show wg0', { stdio: 'ignore' });
        return 'online';
    } catch (e) {
        return 'offline';
    }
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
        const subscribed = ['creator', 'administrator', 'member'].includes(status);
        return { subscribed, status: status || 'unknown' };
    } catch (error) {
        console.error('Ошибка проверки подписки:', error.message);
        return { subscribed: false, status: 'error' };
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

async function ensureUser(telegramUser) {
    const telegramId = telegramUser.id;
    const username = telegramUser.username || null;

    const existing = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegramId]);
    if (existing.rows.length > 0) {
        return existing.rows[0].id;
    }

    const insert = await pool.query(
        'INSERT INTO users (telegram_id, username) VALUES ($1, $2) RETURNING id',
        [telegramId, username]
    );
    return insert.rows[0].id;
}

async function getUserProfileByTelegramId(telegramId) {
    const userRes = await pool.query(
        `SELECT u.id, u.vpn_status, u.tariff_expiry, t.name as tariff_name,
                (SELECT COUNT(*) FROM peers WHERE user_id = u.id AND active = true) as connections_count
         FROM users u
         LEFT JOIN tariffs t ON u.tariff_id = t.id
         WHERE u.telegram_id = $1`,
        [telegramId]
    );
    return userRes.rows[0] || null;
}

async function getUserPeerByUserId(userId) {
    const peerRes = await pool.query(
        'SELECT name, ip, public_key, private_key FROM peers WHERE user_id = $1 ORDER BY created_at LIMIT 1',
        [userId]
    );
    return peerRes.rows[0] || null;
}

async function createPeerForUser(userId, name, req, serverId) {
    const existingPeer = await pool.query('SELECT name FROM peers WHERE name = $1', [name]);
    if (existingPeer.rows.length > 0) {
        throw new Error('Peer с таким именем уже существует');
    }

    const usedIPs = await pool.query('SELECT ip FROM peers WHERE active = true');
    const used = usedIPs.rows.map(row => row.ip);
    let ip;
    for (let i = 2; i <= 254; i++) {
        const candidate = `10.8.0.${i}`;
        if (!used.includes(candidate)) {
            ip = candidate;
            break;
        }
    }
    if (!ip) {
        throw new Error('Нет свободных IP');
    }

    const privateKey = execSync('wg genkey').toString().trim();
    const publicKey = execSync(`echo ${privateKey} | wg pubkey`).toString().trim();

    const peerRes = await pool.query(
        `INSERT INTO peers (user_id, server_id, name, public_key, private_key, ip)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [userId, serverId, name, publicKey, privateKey, ip]
    );

    await logAction(userId, name, 'create', { ip, public_key: publicKey }, req);
    await updateWireGuardConfig();

    const serverPublicKey = execSync('wg show wg0 public-key').toString().trim();
    const config = `[Interface]
PrivateKey = ${privateKey}
Address = ${ip}/32
DNS = 1.1.1.1, 8.8.8.8
MTU = 1420

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${SERVER_IP}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;

    return { peer: peerRes.rows[0], config };
}

function buildPeerConfig(peer) {
    const serverPublicKey = execSync('wg show wg0 public-key').toString().trim();
    return `[Interface]
PrivateKey = ${peer.private_key}
Address = ${peer.ip}/32
DNS = 1.1.1.1, 8.8.8.8
MTU = 1420

[Peer]
PublicKey = ${serverPublicKey}
Endpoint = ${SERVER_IP}:51820
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = 25
`;
}

// Функция для получения публичного ключа сервера
function getServerPublicKey() {
    try {
        return execSync('wg show wg0 public-key').toString().trim();
    } catch (e) {
        console.warn('Не удалось получить публичный ключ сервера:', e.message);
        return null;
    }
}

// Функция для проверки изменения ключа сервера
async function checkServerKeyChange() {
    const newPublicKey = getServerPublicKey();
    
    if (currentServerPublicKey && newPublicKey && currentServerPublicKey !== newPublicKey) {
        console.warn('⚠️ ВНИМАНИЕ: Изменился публичный ключ сервера!');
        console.warn('Старый ключ:', currentServerPublicKey);
        console.warn('Новый ключ:', newPublicKey);
        
        // Логируем изменение ключа
        try {
            await pool.query(
                `INSERT INTO peer_logs (user_id, peer_name, action, details, ip_address, user_agent)
                 VALUES (0, 'SERVER', 'key_change', $1, '127.0.0.1', 'system')`,
                [JSON.stringify({
                    old_key: currentServerPublicKey,
                    new_key: newPublicKey,
                    timestamp: new Date().toISOString()
                })]
            );
        } catch (e) {
            console.error('Ошибка логирования изменения ключа:', e.message);
        }
        
        console.warn('⚠️ Уведомление админов не настроено (админ-бот удалён).');
    }
    
    currentServerPublicKey = newPublicKey;
}

// Функция для выполнения bash-команд
function execCommand(command) {
    return new Promise((resolve, reject) => {
        exec(command, (error, stdout, stderr) => {
            if (error) {
                reject(error);
            } else {
                resolve(stdout.trim());
            }
        });
    });
}

// Функция для логирования действий
async function logAction(user_id, peer_name, action, details = {}, req) {
    try {
        const ip_address = req.ip || req.connection.remoteAddress;
        const user_agent = req.get('User-Agent') || '';
        
        await pool.query(
            `INSERT INTO peer_logs (user_id, peer_name, action, details, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [user_id, peer_name, action, JSON.stringify(details), ip_address, user_agent]
        );
    } catch (error) {
        console.error('Ошибка логирования:', error);
        // Не прерываем основную операцию из-за ошибки логирования
    }
}

// Функция для генерации полного конфига WireGuard из базы данных
async function generateWireGuardConfig() {
    try {
        // Получить существующий приватный ключ сервера
        let serverPrivateKey;
        try {
            // Сначала попробуем получить из существующего конфига
            if (fs.existsSync('/etc/wireguard/wg0.conf')) {
                const configContent = fs.readFileSync('/etc/wireguard/wg0.conf', 'utf8');
                const privateKeyMatch = configContent.match(/PrivateKey\s*=\s*([^\s]+)/);
                if (privateKeyMatch) {
                    serverPrivateKey = privateKeyMatch[1];
                }
            }
            
            // Если не нашли в конфиге, попробуем получить из файла ключа
            if (!serverPrivateKey && fs.existsSync('/etc/wireguard/server_private.key')) {
                serverPrivateKey = fs.readFileSync('/etc/wireguard/server_private.key', 'utf8').trim();
            }
            
            // Если все еще нет, сгенерируем новый
            if (!serverPrivateKey) {
                serverPrivateKey = execSync('wg genkey').toString().trim();
                // Сохраним для будущего использования
                fs.writeFileSync('/etc/wireguard/server_private.key', serverPrivateKey);
            }
        } catch (e) {
            console.warn('Ошибка получения приватного ключа сервера:', e.message);
            serverPrivateKey = execSync('wg genkey').toString().trim();
        }
        
        // Начать конфиг с секции [Interface]
        let config = `[Interface]
PrivateKey = ${serverPrivateKey}
Address = 10.8.0.1/24
ListenPort = 51820
PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

`;
        
        // Получить все активные peer'ы из базы
        const peers = await pool.query(`
            SELECT p.name, p.public_key, p.ip, u.username 
            FROM peers p 
            LEFT JOIN users u ON p.user_id = u.id 
            WHERE p.active = true OR p.active IS NULL
            ORDER BY p.created_at
        `);
        
        // Добавить каждый peer в конфиг
        for (const peer of peers.rows) {
            config += `[Peer]
# ${peer.username || peer.name}
PublicKey = ${peer.public_key}
AllowedIPs = ${peer.ip}/32

`;
        }
        
        return config;
    } catch (error) {
        console.error('Ошибка генерации конфига WireGuard:', error);
        throw error;
    }
}

// Функция для обновления конфига WireGuard
async function updateWireGuardConfig() {
    try {
        // Проверяем изменение ключа сервера перед обновлением
        await checkServerKeyChange();
        
        // Сгенерировать новый конфиг
        const config = await generateWireGuardConfig();
        
        // Сохранить конфиг во временный файл с правильным именем
        const tempConfigPath = '/tmp/wg0.conf';
        fs.writeFileSync(tempConfigPath, config);
        
        // Проверить синтаксис конфига
        try {
            execSync(`wg-quick strip wg0 > /dev/null`, { cwd: '/tmp' });
        } catch (e) {
            throw new Error(`Ошибка синтаксиса конфига: ${e.message}`);
        }
        
        // Создать бэкап текущего конфига
        const backupPath = `/etc/wireguard/wg0.conf.backup.${Date.now()}`;
        if (fs.existsSync('/etc/wireguard/wg0.conf')) {
            fs.copyFileSync('/etc/wireguard/wg0.conf', backupPath);
        }
        
        // Заменить конфиг
        fs.copyFileSync(tempConfigPath, '/etc/wireguard/wg0.conf');
        
        // Более безопасная перезагрузка WireGuard
        try {
            // Сначала попробуем синхронизировать конфиг без перезапуска
            execSync('wg syncconf wg0 <(wg-quick strip wg0)');
            console.log('✅ Конфиг WireGuard обновлен и синхронизирован');
        } catch (e) {
            console.warn('⚠️ Не удалось синхронизировать конфиг:', e.message);
            
            // Если синхронизация не удалась, перезапустим сервис
            try {
                execSync('systemctl restart wg-quick@wg0');
                console.log('✅ WireGuard перезапущен');
            } catch (restartError) {
                console.error('❌ Ошибка перезапуска WireGuard:', restartError.message);
                // Восстановить бэкап если перезагрузка не удалась
                fs.copyFileSync(backupPath, '/etc/wireguard/wg0.conf');
                throw new Error(`Ошибка перезагрузки WireGuard: ${restartError.message}`);
            }
        }
        
        // Проверяем изменение ключа после обновления
        await checkServerKeyChange();
        
        // Удалить временный файл
        fs.unlinkSync(tempConfigPath);
        
    } catch (error) {
        console.error('Ошибка обновления конфига WireGuard:', error);
        throw error;
    }
}

// Создание peer через базу данных
app.post('/api/peers', async (req, res) => {
    try {
        const { user_id, name } = req.body;
        if (!user_id || !name) {
            return res.status(400).json({ error: 'user_id и name обязательны' });
        }
        const { peer, config } = await createPeerForUser(user_id, name, req, null);
        res.json({
            success: true,
            name: peer.name,
            ip: peer.ip,
            config
        });
    } catch (error) {
        console.error('Ошибка создания peer:', error);
        res.status(500).json({ error: error.message });
    }
});

// Удаление peer
app.delete('/api/peers/:name', async (req, res) => {
    try {
        const { name } = req.params;
        // Получаем информацию о peer'е перед удалением для логирования
        const peerInfo = await pool.query('SELECT user_id FROM peers WHERE name = $1', [name]);
        const user_id = peerInfo.rows[0]?.user_id;
        
        // Удалить peer из базы данных
        await pool.query('DELETE FROM peers WHERE name = $1', [name]);
        
        // Логируем удаление peer'а
        if (user_id) {
            await logAction(user_id, name, 'delete', {}, req);
        }
        
        // Обновить конфиг WireGuard из базы данных
        await updateWireGuardConfig();
        res.json({ success: true, message: `Peer ${name} удалён` });
    } catch (error) {
        console.error('Ошибка удаления peer:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить все peer'ы пользователя
app.get('/api/peers/user/:user_id', async (req, res) => {
    try {
        const { user_id } = req.params;
        const peers = await pool.query(`
            SELECT p.*, u.username, u.telegram_id 
            FROM peers p 
            LEFT JOIN users u ON p.user_id = u.id 
            WHERE p.user_id = $1
        `, [user_id]);
        res.json({ peers: peers.rows });
    } catch (error) {
        console.error('Ошибка получения peer\'ов пользователя:', error);
        res.status(500).json({ error: error.message });
    }
});

// Получить конфиг peer'а по имени из базы
app.get('/api/peers/:name/config', async (req, res) => {
    try {
        const { name } = req.params;
        const peerRes = await pool.query('SELECT * FROM peers WHERE name = $1', [name]);
        if (!peerRes.rows.length) {
            return res.status(404).json({ error: 'Peer not found' });
        }
        const peer = peerRes.rows[0];
        const config = buildPeerConfig(peer);
        
        // Логируем скачивание конфига
        await logAction(peer.user_id, name, 'download_config', {
            ip: peer.ip
        }, req);
        
        // Правильные заголовки для скачивания файла
        const filename = `wg-${name}.conf`;
        
        res.set({
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
            'Content-Length': Buffer.byteLength(config, 'utf8'),
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0',
            'Last-Modified': new Date().toUTCString()
        });
        
        res.send(config);
    } catch (error) {
        console.error('Ошибка получения конфига peer:', error);
        res.status(500).json({ error: error.message });
    }
});

// Mini App auth and profile
app.post('/api/webapp/auth', async (req, res) => {
    try {
        const { initData, dev } = req.body;
        const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
        if (!result) {
            return res.status(401).json({ error: 'Invalid init data' });
        }

        const { user, dev: isDev } = result;
        const subscription = isDev ? { subscribed: true, status: 'dev' } : await checkTelegramSubscription(user.id);
        const userDbId = await ensureUser(user);
        const profile = await getUserProfileByTelegramId(user.id);
        const peer = await getUserPeerByUserId(userDbId);
        const isAdmin = isAdminUsername(user.username);

        res.json({
            ok: true,
            user,
            subscribed: subscription.subscribed,
            subscription_status: subscription.status,
            profile,
            peer: peer ? { name: peer.name, ip: peer.ip } : null,
            is_admin: isAdmin
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

        const { user, dev: isDev } = result;
        const subscription = isDev ? { subscribed: true, status: 'dev' } : await checkTelegramSubscription(user.id);
        if (!subscription.subscribed) {
            return res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
        }

        const availableServers = await getServersFromDb();
        const selectedServer = server_id
            ? availableServers.find(server => server.id === server_id)
            : availableServers.find(server => server.is_default) || availableServers[0];

        if (!selectedServer) {
            return res.status(400).json({ error: 'Выбранный сервер недоступен.' });
        }

        if (selectedServer.ip !== SERVER_IP) {
            return res.status(400).json({ error: 'Этот сервер пока не поддерживается. Выберите основной сервер.' });
        }

        const userDbId = await ensureUser(user);
        const existingPeer = await getUserPeerByUserId(userDbId);
        if (existingPeer) {
            return res.status(400).json({ error: 'У вас уже есть активный VPN-профиль.' });
        }

        const peerName = user.username || `user_${user.id}`;
        const { peer, config } = await createPeerForUser(userDbId, peerName, req, selectedServer?.id || null);

        await pool.query(
            `UPDATE users SET tariff_id = (SELECT id FROM tariffs WHERE name = 'tester' LIMIT 1) WHERE telegram_id = $1`,
            [user.id]
        );

        res.json({
            ok: true,
            peer: { name: peer.name, ip: peer.ip },
            config,
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

        const { user, dev: isDev } = result;
        const subscription = isDev ? { subscribed: true, status: 'dev' } : await checkTelegramSubscription(user.id);
        if (!subscription.subscribed) {
            return res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
        }

        const userDbId = await ensureUser(user);
        const peer = await getUserPeerByUserId(userDbId);
        if (!peer) {
            return res.status(400).json({ error: 'У вас нет активных VPN-профилей.' });
        }

        await pool.query('DELETE FROM peers WHERE name = $1', [peer.name]);
        await logAction(userDbId, peer.name, 'delete', {}, req);
        await updateWireGuardConfig();

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

        const { user, dev: isDev } = result;
        const subscription = isDev ? { subscribed: true, status: 'dev' } : await checkTelegramSubscription(user.id);
        if (!subscription.subscribed) {
            return res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
        }

        const userDbId = await ensureUser(user);
        const peer = await getUserPeerByUserId(userDbId);
        if (!peer) {
            return res.status(400).json({ error: 'У вас нет активных VPN-профилей.' });
        }

        const config = buildPeerConfig(peer);
        await logAction(userDbId, peer.name, 'download_config', { ip: peer.ip }, req);

        res.json({
            ok: true,
            peer: { name: peer.name, ip: peer.ip },
            config
        });
    } catch (error) {
        console.error('Ошибка webapp config:', error.message);
        res.status(500).json({ error: error.message });
    }
});

async function requireAdmin(req, res) {
    const { initData, dev } = req.body;
    const result = getWebAppUser({ initData, devRequested: Boolean(dev) });
    if (!result) {
        res.status(401).json({ error: 'Invalid init data' });
        return null;
    }

    const { user, dev: isDev } = result;
    if (!isDev && !isAdminUsername(user.username)) {
        res.status(403).json({ error: 'Недостаточно прав' });
        return null;
    }

    if (!isDev) {
        const subscription = await checkTelegramSubscription(user.id);
        if (!subscription.subscribed) {
            res.status(403).json({ error: 'Подпишитесь на канал для доступа.' });
            return null;
        }
    }

    return { user, isDev };
}

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
            where = `WHERE u.username ILIKE $1 OR CAST(u.telegram_id AS TEXT) = $2`;
        }

        const users = await pool.query(
            `
            SELECT u.id, u.telegram_id, u.username, u.vpn_status, u.created_at, u.tariff_expiry
            FROM users u
            ${where}
            ORDER BY u.created_at DESC
            LIMIT 200
            `,
            params
        );
        res.json({ ok: true, users: users.rows });
    } catch (error) {
        console.error('Ошибка admin users:', error.message);
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
            where = `WHERE p.name ILIKE $1 OR u.username ILIKE $2`;
        }

        const peers = await pool.query(
            `
            SELECT p.name, p.ip, p.public_key, p.created_at, p.active, u.username, u.telegram_id
            FROM peers p
            LEFT JOIN users u ON p.user_id = u.id
            ${where}
            ORDER BY p.created_at DESC
            LIMIT 200
            `,
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

        const peerInfo = await pool.query('SELECT user_id FROM peers WHERE name = $1', [name]);
        const userId = peerInfo.rows[0]?.user_id;

        await pool.query('DELETE FROM peers WHERE name = $1', [name]);
        if (userId) {
            await logAction(userId, name, 'delete', { reason: 'admin_delete' }, req);
        }
        await updateWireGuardConfig();
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

        const peerRes = await pool.query('SELECT * FROM peers WHERE name = $1', [name]);
        if (!peerRes.rows.length) {
            return res.status(404).json({ error: 'Peer не найден' });
        }

        const peer = peerRes.rows[0];
        const config = buildPeerConfig(peer);
        await logAction(peer.user_id, name, 'download_config', { ip: peer.ip, reason: 'admin_download' }, req);

        res.json({ ok: true, peer: { name: peer.name, ip: peer.ip }, config });
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
        if (!message || typeof message !== 'string') {
            return res.status(400).json({ error: 'message обязателен' });
        }

        const usersRes = await pool.query('SELECT telegram_id FROM users WHERE telegram_id IS NOT NULL');
        const users = usersRes.rows;

        let successCount = 0;
        let errorCount = 0;

        for (const user of users) {
            try {
                await sendTelegramMessage(user.telegram_id, message);
                successCount++;
            } catch (error) {
                errorCount++;
                console.error(`Ошибка отправки пользователю ${user.telegram_id}:`, error.message);
            }
        }

        res.json({ ok: true, success: successCount, errors: errorCount });
    } catch (error) {
        console.error('Ошибка admin broadcast:', error.message);
        res.status(500).json({ error: error.message });
    }
});



// Получить все peer'ы (для админки)
app.get('/api/peers', async (req, res) => {
    try {
        const peers = await pool.query(`
            SELECT p.*, u.username, u.telegram_id 
            FROM peers p 
            LEFT JOIN users u ON p.user_id = u.id
        `);
        res.json({ peers: peers.rows });
    } catch (error) {
        console.error('Ошибка получения списка peer\'ов:', error);
        res.status(500).json({ error: error.message });
    }
});

// Синхронизировать конфиг WireGuard с базой данных
app.post('/api/sync-config', async (req, res) => {
    try {
        await updateWireGuardConfig();
        res.json({ success: true, message: 'Конфиг WireGuard синхронизирован с базой данных' });
    } catch (error) {
        console.error('Ошибка синхронизации конфига:', error);
        res.status(500).json({ error: error.message });
    }
});

// Проверка здоровья API
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Список VPN серверов и их статус
app.get('/api/servers', (req, res) => {
    try {
        getServersFromDb()
            .then(servers => {
                const status = getLocalServerStatus();
                const now = new Date().toISOString();

                const result = servers.map(server => ({
                    ...server,
                    status: server.ip === SERVER_IP ? status : 'unknown',
                    last_checked: now
                }));

                res.json({ servers: result });
            })
            .catch(error => {
                console.error('Ошибка получения серверов:', error.message);
                res.status(500).json({ error: error.message });
            });
    } catch (error) {
        console.error('Ошибка получения серверов:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// Диагностика WireGuard
app.get('/api/diagnostics', async (req, res) => {
    try {
        const diagnostics = {
            timestamp: new Date().toISOString(),
            server: {
                status: 'unknown',
                interface: 'wg0',
                public_key: null,
                listen_port: 51820
            },
            peers: [],
            connections: []
        };
        
        // Проверить статус WireGuard
        try {
            const wgShow = execSync('wg show', { encoding: 'utf8' });
            diagnostics.server.status = 'running';
            
            // Получить публичный ключ сервера
            try {
                diagnostics.server.public_key = execSync('wg show wg0 public-key', { encoding: 'utf8' }).trim();
            } catch (e) {
                console.warn('Не удалось получить публичный ключ сервера:', e.message);
            }
            
            // Парсим информацию о peer'ах
            const lines = wgShow.split('\n');
            let currentPeer = null;
            
            for (const line of lines) {
                if (line.startsWith('peer:')) {
                    if (currentPeer) {
                        diagnostics.peers.push(currentPeer);
                    }
                    currentPeer = { public_key: line.split(':')[1].trim() };
                } else if (line.includes('endpoint:')) {
                    if (currentPeer) {
                        currentPeer.endpoint = line.split(':')[1].trim();
                    }
                } else if (line.includes('latest handshake:')) {
                    if (currentPeer) {
                        currentPeer.latest_handshake = line.split(':')[1].trim();
                    }
                } else if (line.includes('transfer:')) {
                    if (currentPeer) {
                        currentPeer.transfer = line.split(':')[1].trim();
                    }
                } else if (line.includes('persistent keepalive:')) {
                    if (currentPeer) {
                        currentPeer.persistent_keepalive = line.split(':')[1].trim();
                    }
                }
            }
            
            if (currentPeer) {
                diagnostics.peers.push(currentPeer);
            }
            
        } catch (e) {
            diagnostics.server.status = 'error';
            diagnostics.server.error = e.message;
        }
        
        // Получить информацию о peer'ах из базы данных
        try {
            const dbPeers = await pool.query(`
                SELECT p.name, p.public_key, p.ip, p.active, u.username 
                FROM peers p 
                LEFT JOIN users u ON p.user_id = u.id
                ORDER BY p.created_at
            `);
            diagnostics.connections = dbPeers.rows;
        } catch (e) {
            console.warn('Ошибка получения peer\'ов из БД:', e.message);
        }
        
        res.json(diagnostics);
    } catch (error) {
        console.error('Ошибка диагностики:', error);
        res.status(500).json({ error: error.message });
    }
});

// Проверить актуальность конфига клиента
app.post('/api/check-config', async (req, res) => {
    try {
        const { peer_name, client_public_key } = req.body;
        
        if (!peer_name) {
            return res.status(400).json({ error: 'peer_name обязателен' });
        }
        
        // Получить информацию о peer из базы
        const peerRes = await pool.query('SELECT * FROM peers WHERE name = $1', [peer_name]);
        if (!peerRes.rows.length) {
            return res.status(404).json({ error: 'Peer не найден' });
        }
        
        const peer = peerRes.rows[0];
        
        // Получить текущий публичный ключ сервера
        const currentServerKey = getServerPublicKey();
        
        // Проверить, совпадает ли публичный ключ клиента
        const clientKeyValid = !client_public_key || client_public_key === peer.public_key;
        
        // Проверить, активен ли peer
        const peerActive = peer.active === true || peer.active === null;
        
        // Проверить, не изменился ли ключ сервера
        const serverKeyChanged = currentServerPublicKey && currentServerKey && 
                                currentServerPublicKey !== currentServerKey;
        
        const result = {
            peer_name: peer.name,
            peer_active: peerActive,
            client_key_valid: clientKeyValid,
            server_key_changed: serverKeyChanged,
            needs_update: !peerActive || !clientKeyValid || serverKeyChanged,
            current_server_key: currentServerKey,
            peer_ip: peer.ip,
            last_handshake: null
        };
        
        // Если есть проблемы, получить дополнительную информацию
        if (result.needs_update) {
            try {
                // Попробуем получить информацию о handshake
                const wgShow = execSync('wg show', { encoding: 'utf8' });
                const lines = wgShow.split('\n');
                let currentPeer = null;
                
                for (const line of lines) {
                    if (line.startsWith('peer:') && line.includes(peer.public_key)) {
                        currentPeer = {};
                    } else if (currentPeer && line.includes('latest handshake:')) {
                        result.last_handshake = line.split(':')[1].trim();
                        break;
                    }
                }
            } catch (e) {
                console.warn('Не удалось получить информацию о handshake:', e.message);
            }
        }
        
        res.json(result);
    } catch (error) {
        console.error('Ошибка проверки конфига:', error);
        res.status(500).json({ error: error.message });
    }
});



// Диагностика конкретного клиента
app.post('/api/diagnose-peer', async (req, res) => {
    try {
        const { peer_name } = req.body;
        
        if (!peer_name) {
            return res.status(400).json({ error: 'peer_name обязателен' });
        }
        
        // Получить информацию о peer из базы
        const peerRes = await pool.query('SELECT * FROM peers WHERE name = $1', [peer_name]);
        if (!peerRes.rows.length) {
            return res.status(404).json({ error: 'Peer не найден' });
        }
        
        const peer = peerRes.rows[0];
        
        // Получить текущий публичный ключ сервера
        const currentServerKey = getServerPublicKey();
        
        // Проверить, активен ли peer
        const peerActive = peer.active === true || peer.active === null;
        
        // Проверить, не изменился ли ключ сервера
        const serverKeyChanged = currentServerPublicKey && currentServerKey && 
                                currentServerPublicKey !== currentServerKey;
        
        // Получить информацию о handshake
        let lastHandshake = null;
        let hasActiveConnection = false;
        
        try {
            const wgShow = execSync('wg show', { encoding: 'utf8' });
            const lines = wgShow.split('\n');
            let currentPeer = null;
            
            for (const line of lines) {
                if (line.startsWith('peer:') && line.includes(peer.public_key)) {
                    currentPeer = {};
                    hasActiveConnection = true;
                } else if (currentPeer && line.includes('latest handshake:')) {
                    lastHandshake = line.split(':')[1].trim();
                    break;
                }
            }
        } catch (e) {
            console.warn('Не удалось получить информацию о handshake:', e.message);
        }
        
        // Определить проблемы
        const issues = [];
        
        if (!peerActive) {
            issues.push('peer_inactive');
        }
        
        if (serverKeyChanged) {
            issues.push('server_key_changed');
        }
        
        if (!hasActiveConnection && peerActive) {
            issues.push('no_handshake');
        }
        
        const result = {
            peer_name: peer.name,
            peer_active: peerActive,
            server_key_changed: serverKeyChanged,
            has_active_connection: hasActiveConnection,
            last_handshake: lastHandshake,
            current_server_key: currentServerKey,
            peer_ip: peer.ip,
            issues: issues,
            needs_attention: issues.length > 0
        };
        
        res.json(result);
    } catch (error) {
        console.error('Ошибка диагностики peer:', error);
        res.status(500).json({ error: error.message });
    }
});

// Запуск сервера
app.listen(PORT, async () => {
    console.log(`🚀 WireGuard Manager API запущен на порту ${PORT}`);
    console.log(`📝 Скрипт: ${WG_SCRIPT}`);
    
    // Инициализируем отслеживание ключа сервера
    try {
        currentServerPublicKey = getServerPublicKey();
        if (currentServerPublicKey) {
            console.log(`🔑 Текущий публичный ключ сервера: ${currentServerPublicKey}`);
        } else {
            console.warn('⚠️ Не удалось получить публичный ключ сервера при запуске');
        }
    } catch (e) {
        console.warn('⚠️ Ошибка инициализации отслеживания ключа:', e.message);
    }
});

module.exports = app; 
