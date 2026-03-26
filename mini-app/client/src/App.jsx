import React, { useEffect, useMemo, useState } from 'react';

const CHANNEL_USERNAME = import.meta.env.VITE_CHANNEL_USERNAME || '@kirillprodev';
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

const defaultProfile = {
  tariff_name: null,
  connections_count: 0,
  tariff_expiry: null,
  vpn_status: 'active'
};

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('ru-RU');
}

function formatServerTitle(index) {
  return `Сервер ${index + 1}`;
}

function formatServerLocation(location) {
  if (!location) return 'Локация неизвестна';
  return location;
}

function normalizeServerStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (['online', 'active', 'running', 'healthy', 'up'].includes(normalized)) {
    return { label: 'Активен', tone: 'online' };
  }
  return { label: 'Недоступен', tone: 'offline' };
}

function downloadConfigFile(config, fileName = 'vpn-profile.json', mimeType = 'application/json') {
  const blob = new Blob([config], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function copyToClipboard(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = data?.error || `Ошибка запроса: ${response.status}`;
    throw new Error(message);
  }

  return response.json();
}

function resolveTelegramContext() {
  if (window.Telegram && window.Telegram.WebApp) {
    return { webApp: window.Telegram.WebApp, isLocalDev: false };
  }

  const hostname = window.location.hostname;
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return { webApp: { initData: null, ready() {}, expand() {} }, isLocalDev: true };
  }

  return null;
}

export default function App() {
  const [statusLine, setStatusLine] = useState('Загрузка…');
  const [error, setError] = useState('');
  const [subscribed, setSubscribed] = useState(true);
  const [profile, setProfile] = useState(defaultProfile);
  const [peer, setPeer] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [users, setUsers] = useState([]);
  const [peers, setPeers] = useState([]);
  const [usersSearch, setUsersSearch] = useState('');
  const [peersSearch, setPeersSearch] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastStatus, setBroadcastStatus] = useState('');
  const [servers, setServers] = useState([]);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [activeTab, setActiveTab] = useState('home');
  const [tgContext, setTgContext] = useState(null);

  const channelLink = useMemo(() => `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`, []);

  useEffect(() => {
    const context = resolveTelegramContext();
    if (!context) {
      setStatusLine('Откройте приложение внутри Telegram.');
      setError('Telegram WebApp не найден. Откройте мини‑апп через кнопку в боте.');
      return;
    }

    setTgContext(context);
    if (context.isLocalDev) {
      setStatusLine('Локальный режим. Авторизация отключена.');
    }

    context.webApp.ready();
    context.webApp.expand();
  }, []);

  async function loadProfile() {
    if (!tgContext) return;
    setError('');
    setStatusLine('Проверяем доступ…');

    const data = await postJson('/api/webapp/auth', {
      initData: tgContext.webApp.initData || null,
      dev: Boolean(tgContext.isLocalDev)
    });

    if (!data.subscribed) {
      setSubscribed(false);
      setStatusLine('VPN Guard');
      setIsAdmin(false);
      return;
    }

    setSubscribed(true);
    setProfile(data.profile || defaultProfile);
    setPeer(data.peer || null);
    setIsAdmin(Boolean(data.is_admin));
    setStatusLine(`Привет, ${data.user?.first_name || 'друг'}!`);
  }

  async function loadServers() {
    const response = await fetch(`${API_BASE}/api/servers`);
    if (!response.ok) {
      throw new Error('Не удалось загрузить список серверов');
    }
    const data = await response.json();
    const list = data.servers || [];
    setServers(list);
    if (!selectedServerId && list.length > 0) {
      const defaultServer = list.find(server => server.is_default) || list[0];
      setSelectedServerId(defaultServer.id);
    }
  }

  async function loadAdminUsers() {
    if (!tgContext) return;
    const result = await postJson('/api/webapp/admin/users', {
      initData: tgContext.webApp.initData || null,
      dev: Boolean(tgContext.isLocalDev),
      search: usersSearch.trim()
    });
    setUsers(result.users || []);
  }

  async function loadAdminPeers() {
    if (!tgContext) return;
    const result = await postJson('/api/webapp/admin/peers', {
      initData: tgContext.webApp.initData || null,
      dev: Boolean(tgContext.isLocalDev),
      search: peersSearch.trim()
    });
    setPeers(result.peers || []);
  }

  useEffect(() => {
    if (!tgContext) return;
    loadProfile().catch(err => setError(err.message));
    loadServers().catch(err => setError(err.message));
  }, [tgContext]);

  useEffect(() => {
    if (!tgContext) return;
    const interval = setInterval(() => {
      loadServers().catch(err => setError(err.message));
    }, 15000);
    return () => clearInterval(interval);
  }, [tgContext]);

  useEffect(() => {
    if (tgContext && isAdmin) {
      loadAdminUsers().catch(err => setError(err.message));
      loadAdminPeers().catch(err => setError(err.message));
    }
  }, [tgContext, isAdmin]);

  async function handleConnect() {
    try {
      setStatusLine('Создаём VPN…');
      const result = await postJson('/api/webapp/connect', {
        initData: tgContext.webApp.initData || null,
        dev: Boolean(tgContext.isLocalDev),
        server_id: selectedServerId || null
      });
      if (result?.peer) {
        setPeer(result.peer);
      }
      await loadProfile();
    } catch (err) {
      setError(err.message);
      setStatusLine('Ошибка');
    }
  }

  async function handleRemove() {
    try {
      setStatusLine('Удаляем VPN…');
      await postJson('/api/webapp/remove', {
        initData: tgContext.webApp.initData || null,
        dev: Boolean(tgContext.isLocalDev)
      });
      await loadProfile();
    } catch (err) {
      setError(err.message);
      setStatusLine('Ошибка');
    }
  }

  async function handleDownload() {
    try {
      setStatusLine('Готовим конфиг…');
      const result = await postJson('/api/webapp/config', {
        initData: tgContext.webApp.initData || null,
        dev: Boolean(tgContext.isLocalDev)
      });
      if (result?.peer) {
        setPeer(result.peer);
      }
      await loadProfile();
    } catch (err) {
      setError(err.message);
      setStatusLine('Ошибка');
    }
  }

  async function handleCopyAccessUri() {
    if (!peer?.access_uri) {
      setError('Ссылка подключения недоступна.');
      return;
    }

    try {
      await copyToClipboard(peer.access_uri);
      setError('');
      setStatusLine('Ссылка скопирована');
    } catch (err) {
      setError('Не удалось скопировать ссылку.');
    }
  }

  function handleOpenInClient() {
    if (!peer?.access_uri) {
      setError('Ссылка подключения недоступна.');
      return;
    }

    window.location.href = peer.access_uri;
  }

  async function handleBan(telegramId) {
    if (!window.confirm('Забанить пользователя?')) return;
    try {
      await postJson('/api/webapp/admin/ban-user', {
        initData: tgContext.webApp.initData || null,
        dev: Boolean(tgContext.isLocalDev),
        telegram_id: Number(telegramId)
      });
      await loadAdminUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleUnban(telegramId) {
    if (!window.confirm('Разбанить пользователя?')) return;
    try {
      await postJson('/api/webapp/admin/unban-user', {
        initData: tgContext.webApp.initData || null,
        dev: Boolean(tgContext.isLocalDev),
        telegram_id: Number(telegramId)
      });
      await loadAdminUsers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDeletePeer(name) {
    if (!window.confirm('Удалить выбранный пир?')) return;
    try {
      await postJson('/api/webapp/admin/delete-peer', {
        initData: tgContext.webApp.initData || null,
        dev: Boolean(tgContext.isLocalDev),
        name
      });
      await loadAdminPeers();
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDownloadPeer(name) {
    try {
      const result = await postJson('/api/webapp/admin/peer-config', {
        initData: tgContext.webApp.initData || null,
        dev: Boolean(tgContext.isLocalDev),
        name
      });
      if (result?.config) {
        downloadConfigFile(result.config, result.download_name, result.mime_type);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleBroadcast() {
    if (!broadcastMessage.trim()) {
      setError('Введите текст рассылки.');
      return;
    }

    if (!window.confirm('Отправить рассылку всем пользователям?')) {
      return;
    }

    try {
      setBroadcastStatus('Отправляем рассылку…');
      const result = await postJson('/api/webapp/admin/broadcast', {
        initData: tgContext.webApp.initData || null,
        dev: Boolean(tgContext.isLocalDev),
        message: broadcastMessage.trim()
      });
      setBroadcastStatus(`Готово: ${result.success} успешно, ${result.errors} ошибок`);
    } catch (err) {
      setBroadcastStatus('Ошибка отправки');
      setError(err.message);
    }
  }

  if (!tgContext) {
    return (
      <div className="app">
        <header className="app__header">
          <h1>VPN Guard</h1>
          <p className="muted">{statusLine}</p>
        </header>
        {error && <section className="card error">{error}</section>}
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>VPN Guard</h1>
        <p className="muted">{statusLine}</p>
      </header>

      <nav className="tabs">
        <button className={activeTab === 'home' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('home')}>Главная</button>
        <button className={activeTab === 'servers' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('servers')}>Серверы</button>
        <button className={activeTab === 'support' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('support')}>Инструкция</button>
        {isAdmin && (
          <button className={activeTab === 'admin' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('admin')}>Админка</button>
        )}
      </nav>

      {!subscribed && activeTab === 'home' && (
        <section className="card">
          <h2>Нужна подписка</h2>
          <p>Для доступа к VPN и приложению подпишитесь на канал.</p>
          <div className="actions">
            <a className="button" href={channelLink} target="_blank" rel="noreferrer">Перейти в канал</a>
            <button className="button button--secondary" onClick={loadProfile}>Проверить подписку</button>
          </div>
        </section>
      )}

      {subscribed && activeTab === 'home' && (
        <>
          <section className="card">
            <h2>Ваш аккаунт</h2>
            <div className="info">
              {'Тариф: ' + (profile.tariff_name || 'Пробный период')}
              {'\nПодключений: ' + (profile.connections_count ?? 0)}
              {'\nБлижайшая оплата: ' + formatDate(profile.tariff_expiry)}
              {'\nVPN статус: ' + (profile.vpn_status || 'active')}
            </div>
          </section>

          <section className="card">
            <h2>Подключение</h2>
            <p className="muted">Сначала выберите сервер, затем создайте профиль доступа.</p>
            <div className="server-select">
              <label className="label">VPN сервер</label>
              <select
                className="input"
                value={selectedServerId}
                onChange={(event) => setSelectedServerId(event.target.value)}
              >
                {servers.map((server, index) => (
                  <option key={server.id} value={server.id}>
                    {formatServerTitle(index)} • {formatServerLocation(server.location)}
                  </option>
                ))}
              </select>
            </div>
            <div className="actions">
              <button
                className="button"
                onClick={handleConnect}
                disabled={Boolean(peer) || !selectedServerId}
              >
                Создать профиль
              </button>
            </div>
          </section>

          <section className="card">
            <h2>Мои подключения</h2>
            {!peer && <p className="muted">У вас пока нет активных подключений.</p>}
            {peer && (
              <div className="admin-item">
                <div>
                  <strong>{peer.name}</strong> ({peer.protocol || 'VPN'})
                  <br />
                  Идентификатор: {peer.ip || '—'}
                  <br />
                  <span className="muted">{peer.access_uri || 'Ссылка подключения недоступна'}</span>
                </div>
                <div className="admin-actions">
                  <button className="button button--secondary" onClick={handleCopyAccessUri}>Скопировать ссылку</button>
                  <button className="button button--secondary" onClick={handleOpenInClient}>Открыть в клиенте</button>
                  <button className="button button--secondary" onClick={handleDownload}>Обновить ссылку</button>
                  <button className="button button--secondary" onClick={handleRemove}>Удалить профиль</button>
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <h2>Поддержка</h2>
            <p>Если есть вопросы — пишите в поддержку.</p>
            <a className="link" href="https://t.me/kkasyanov" target="_blank" rel="noreferrer">@kkasyanov</a>
          </section>
        </>
      )}

      {subscribed && activeTab === 'servers' && (
        <section className="card">
          <h2>VPN серверы</h2>
          <div className="admin-list">
            {servers.length === 0 && <span className="muted">Нет данных</span>}
            {servers.map((server, index) => {
              const status = normalizeServerStatus(server.status);
              return (
              <div key={server.id} className="admin-item">
                <div className="server-row">
                  <strong>{formatServerTitle(index)}</strong>
                  {server.is_default && <span className="badge">Основной</span>}
                  <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span>
                </div>
                <div>Локация: {formatServerLocation(server.location)}</div>
                <div>Протокол: {server.protocol || 'VPN'}</div>
                <div className="muted">IP: {server.ip || '—'}</div>
              </div>
              );
            })}
          </div>
        </section>
      )}

      {subscribed && activeTab === 'admin' && isAdmin && (
        <section className="card">
          <h2>Админка</h2>
          <div className="admin-controls">
            <input
              className="input"
              placeholder="Поиск по username или id"
              value={usersSearch}
              onChange={(event) => setUsersSearch(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && loadAdminUsers()}
            />
            <button className="button button--secondary" onClick={loadAdminUsers}>Обновить пользователей</button>
          </div>

          <div className="admin-section">
            <h3>Пользователи</h3>
            <div className="admin-list">
              {users.length === 0 && <span className="muted">Нет данных</span>}
              {users.map(user => (
                <div key={user.telegram_id} className="admin-item">
                  <div><strong>@{user.username || '—'}</strong> (id: {user.telegram_id})</div>
                  <div>Статус: {user.vpn_status || 'active'}</div>
                  <div className="admin-actions">
                    <button className="button button--secondary" onClick={() => handleBan(user.telegram_id)}>Забанить</button>
                    <button className="button button--secondary" onClick={() => handleUnban(user.telegram_id)}>Разбанить</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-controls">
            <input
              className="input"
              placeholder="Поиск по имени или username"
              value={peersSearch}
              onChange={(event) => setPeersSearch(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && loadAdminPeers()}
            />
            <button className="button button--secondary" onClick={loadAdminPeers}>Обновить пиры</button>
          </div>

          <div className="admin-section">
            <h3>Пиры</h3>
            <div className="admin-list">
              {peers.length === 0 && <span className="muted">Нет данных</span>}
              {peers.map(peerItem => (
                <div key={peerItem.name} className="admin-item">
                  <div>
                    <strong>{peerItem.name}</strong> ({peerItem.protocol || 'VPN'})
                    <br />
                    Идентификатор: {peerItem.ip || '—'}
                  </div>
                  <div>Пользователь: @{peerItem.username || '—'} ({peerItem.telegram_id || '—'})</div>
                  <div className="admin-actions">
                    <button className="button button--secondary" onClick={() => handleDeletePeer(peerItem.name)}>Удалить профиль</button>
                    <button className="button button--secondary" onClick={() => handleDownloadPeer(peerItem.name)}>Скачать профиль</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="admin-section">
            <h3>Рассылка</h3>
            <textarea
              className="textarea"
              rows={4}
              placeholder="Текст рассылки (HTML разрешён)"
              value={broadcastMessage}
              onChange={(event) => setBroadcastMessage(event.target.value)}
            />
            <div className="admin-actions">
              <button className="button" onClick={handleBroadcast}>Отправить</button>
              {broadcastStatus && <span className="muted">{broadcastStatus}</span>}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'support' && (
        <>
          <section className="card">
            <h2>Инструкция</h2>
            <ol className="instructions">
              <li>Выберите сервер и создайте профиль доступа.</li>
              <li>Скачайте выданный JSON или URI-профиль.</li>
              <li>Импортируйте профиль в клиентское приложение, которое будет работать с вашим backend.</li>
              <li>После импорта включите подключение в клиенте.</li>
            </ol>
            <p className="muted">Формат профиля зависит от того, какой VPN backend подключён на серверной стороне.</p>
          </section>
        </>
      )}

      {error && <section className="card error">{error}</section>}
    </div>
  );
}
