import React, { useEffect, useMemo, useState } from 'react';

const CHANNEL_USERNAME = import.meta.env.VITE_CHANNEL_USERNAME || '@kirillprodev';
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:3000';
const ALLOW_STANDALONE = import.meta.env.VITE_ALLOW_STANDALONE === 'true';
const PERSONAL_ADMIN_MODE = import.meta.env.VITE_PERSONAL_ADMIN_MODE === 'true';
const DEVICE_STORAGE_KEY = 'vpn-guard-device';
const CLIENT_INSTALLED_STORAGE_KEY = 'vpn-guard-client-installed';
const CLIENT_OPTIONS = [
  {
    id: 'ios',
    label: 'iPhone / iPad',
    clientName: 'v2RayTun',
    downloadUrl: 'https://apps.apple.com/ru/app/v2raytun/id6476628951'
  },
  {
    id: 'android',
    label: 'Android',
    clientName: 'v2RayTun',
    downloadUrl: 'https://play.google.com/store/apps/details?id=com.v2raytun.android&hl=ru'
  },
  {
    id: 'mac',
    label: 'Mac',
    clientName: 'v2RayTun',
    downloadUrl: 'https://v2raytun.com/'
  },
  {
    id: 'windows',
    label: 'Windows',
    clientName: 'v2RayTun',
    downloadUrl: 'https://v2raytun.com/'
  }
];

const defaultProfile = {
  tariff_name: null,
  tariff_code: null,
  connections_count: 0,
  tariff_expiry: null,
  vpn_status: 'active',
  has_active_access: true
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

function formatPrice(value) {
  return new Intl.NumberFormat('ru-RU').format(Number(value || 0));
}

function normalizePaymentStatus(status) {
  if (status === 'paid') return { label: 'Оплачен', tone: 'online' };
  if (status === 'rejected') return { label: 'Отклонён', tone: 'offline' };
  return { label: 'Ожидает', tone: 'pending' };
}

function normalizePromoStatus(promoCode) {
  if (promoCode.active === false) return { label: 'Выключен', tone: 'offline' };
  if ((promoCode.redemptions_count ?? 0) >= (promoCode.max_redemptions ?? 0)) {
    return { label: 'Лимит исчерпан', tone: 'pending' };
  }
  return { label: 'Активен', tone: 'online' };
}

function formatMetricValue(value) {
  if (value === null || value === undefined) return '0';
  return new Intl.NumberFormat('ru-RU').format(Number(value));
}

function inferDeviceOptionId() {
  const userAgent = navigator.userAgent || '';

  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'mac';
  if (/Windows/i.test(userAgent)) return 'windows';

  return '';
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
  const hostname = window.location.hostname;
  if (ALLOW_STANDALONE || hostname === 'localhost' || hostname === '127.0.0.1') {
    return { webApp: { initData: null, ready() {}, expand() {} }, isLocalDev: true };
  }

  if (window.Telegram && window.Telegram.WebApp) {
    return { webApp: window.Telegram.WebApp, isLocalDev: false };
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
  const [tariffs, setTariffs] = useState([]);
  const [referral, setReferral] = useState(null);
  const [pendingPayment, setPendingPayment] = useState(null);
  const [referralInput, setReferralInput] = useState('');
  const [promoCodeInput, setPromoCodeInput] = useState('');
  const [promoCodes, setPromoCodes] = useState([]);
  const [adminMetrics, setAdminMetrics] = useState(null);
  const [adminTab, setAdminTab] = useState('overview');
  const [newUserForm, setNewUserForm] = useState({
    telegram_id: '',
    username: ''
  });
  const [userServerSelections, setUserServerSelections] = useState({});
  const [promoForm, setPromoForm] = useState({
    code: '',
    description: '',
    duration_days: '30',
    max_redemptions: '1',
    expires_at: ''
  });
  const [selectedServerId, setSelectedServerId] = useState('');
  const [activeTab, setActiveTab] = useState(PERSONAL_ADMIN_MODE ? 'admin' : 'home');
  const [tgContext, setTgContext] = useState(null);
  const [busyMessage, setBusyMessage] = useState('');
  const [deviceOptionId, setDeviceOptionId] = useState('');
  const [clientInstalled, setClientInstalled] = useState(false);

  const channelLink = useMemo(() => `https://t.me/${CHANNEL_USERNAME.replace('@', '')}`, []);
  const legalLinks = useMemo(() => {
    const origin = window.location.origin;
    return {
      privacy: `${origin}/privacy`,
      terms: `${origin}/terms`,
      contact: `${origin}/contact`
    };
  }, []);
  const selectedDevice = useMemo(
    () => CLIENT_OPTIONS.find((option) => option.id === deviceOptionId) || null,
    [deviceOptionId]
  );
  const selectedServer = useMemo(
    () => servers.find((server) => server.id === selectedServerId) || servers[0] || null,
    [servers, selectedServerId]
  );
  const defaultAdminServerId = useMemo(
    () => selectedServerId || servers.find((server) => server.is_default)?.id || servers[0]?.id || '',
    [servers, selectedServerId]
  );
  const hasMultipleServers = servers.length > 1;
  const canConnectNow = Boolean(selectedServerId) && profile.has_active_access && clientInstalled && !peer;
  const isBusy = Boolean(busyMessage);

  async function runWithBusy(message, action) {
    setError('');
    setBusyMessage(message);
    try {
      return await action();
    } finally {
      setBusyMessage('');
    }
  }

  function getAuthPayload(extra = {}) {
    return {
      initData: tgContext?.webApp?.initData || null,
      dev: Boolean(tgContext?.isLocalDev),
      ...extra
    };
  }

  function getUserSelectedServerId(telegramId) {
    return userServerSelections[String(telegramId)] || defaultAdminServerId;
  }

  function handleUserServerChange(telegramId, serverId) {
    setUserServerSelections(prev => ({
      ...prev,
      [String(telegramId)]: serverId
    }));
  }

  async function refreshAdminData() {
    await Promise.all([
      loadAdminMetrics(),
      loadAdminUsers(),
      loadAdminPeers()
    ]);
  }

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

  useEffect(() => {
    const savedDevice = window.localStorage.getItem(DEVICE_STORAGE_KEY);
    const inferredDevice = inferDeviceOptionId();
    const initialDevice = savedDevice || inferredDevice;
    const savedClientInstalled = window.localStorage.getItem(CLIENT_INSTALLED_STORAGE_KEY) === '1';

    if (initialDevice) {
      setDeviceOptionId(initialDevice);
    }
    setClientInstalled(savedClientInstalled);
  }, []);

  useEffect(() => {
    if (deviceOptionId) {
      window.localStorage.setItem(DEVICE_STORAGE_KEY, deviceOptionId);
    }
  }, [deviceOptionId]);

  useEffect(() => {
    window.localStorage.setItem(CLIENT_INSTALLED_STORAGE_KEY, clientInstalled ? '1' : '0');
  }, [clientInstalled]);

  useEffect(() => {
    if (peer?.access_uri) {
      setClientInstalled(true);
    }
  }, [peer]);

  async function loadProfile(options = {}) {
    if (!tgContext) return;
    if (!options.silent) {
      setError('');
      setStatusLine('Проверяем доступ…');
    }

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
    setTariffs(data.tariffs || []);
    setReferral(data.referral || null);
    setPendingPayment(data.pending_payment || null);
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

  async function loadAdminMetrics() {
    if (!tgContext) return;
    const result = await postJson('/api/webapp/admin/metrics', {
      initData: tgContext.webApp.initData || null,
      dev: Boolean(tgContext.isLocalDev)
    });
    setAdminMetrics(result.metrics || null);
  }

  async function loadAdminPromoCodes() {
    if (!tgContext) return;
    const result = await postJson('/api/webapp/admin/promo-codes', {
      initData: tgContext.webApp.initData || null,
      dev: Boolean(tgContext.isLocalDev)
    });
    setPromoCodes(result.promo_codes || []);
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
      loadAdminMetrics().catch(err => setError(err.message));
      loadAdminUsers().catch(err => setError(err.message));
      loadAdminPeers().catch(err => setError(err.message));
      if (!PERSONAL_ADMIN_MODE) {
        loadAdminPromoCodes().catch(err => setError(err.message));
      }
    }
  }, [tgContext, isAdmin]);

  async function handleConnect() {
    try {
      await runWithBusy('Создаём профиль…', async () => {
        const result = await postJson('/api/webapp/connect', {
          initData: tgContext.webApp.initData || null,
          dev: Boolean(tgContext.isLocalDev),
          server_id: selectedServerId || null
        });
        if (result?.peer) {
          setPeer(result.peer);
          setClientInstalled(true);
        }
        await loadProfile({ silent: true });
        if (result?.peer?.access_uri) {
          setStatusLine('VPN готов. Открываем приложение…');
          setTimeout(() => {
            window.location.href = result.peer.access_uri;
          }, 150);
          return;
        }
        setStatusLine('VPN готов к подключению');
      });
    } catch (err) {
      setError(err.message);
      setStatusLine('Ошибка');
    }
  }

  async function handleRemove() {
    try {
      await runWithBusy('Удаляем профиль…', async () => {
        await postJson('/api/webapp/remove', {
          initData: tgContext.webApp.initData || null,
          dev: Boolean(tgContext.isLocalDev)
        });
        await loadProfile({ silent: true });
      });
    } catch (err) {
      setError(err.message);
      setStatusLine('Ошибка');
    }
  }

  async function handleDownload() {
    try {
      await runWithBusy('Обновляем ссылку…', async () => {
        const result = await postJson('/api/webapp/config', {
          initData: tgContext.webApp.initData || null,
          dev: Boolean(tgContext.isLocalDev)
        });
        if (result?.peer) {
          setPeer(result.peer);
        }
        await loadProfile({ silent: true });
      });
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

    setStatusLine('Открываем VPN в приложении…');
    window.location.href = peer.access_uri;
  }

  function handleChooseDevice(optionId) {
    setDeviceOptionId(optionId);
    if (!peer) {
      setClientInstalled(false);
    }
    setError('');
  }

  function handleInstallClient() {
    if (!selectedDevice) {
      setError('Сначала выберите устройство.');
      return;
    }

    setStatusLine(`Установите ${selectedDevice.clientName}, затем вернитесь сюда.`);
    window.open(selectedDevice.downloadUrl, '_blank', 'noreferrer');
  }

  function handleClientInstalled() {
    if (!selectedDevice) {
      setError('Сначала выберите устройство.');
      return;
    }

    setClientInstalled(true);
    setError('');
    setStatusLine(`${selectedDevice.clientName} установлен. Осталось подключить VPN.`);
  }

  async function handleCreatePayment(tariffCode) {
    try {
      await runWithBusy('Создаём заявку на оплату…', async () => {
        const result = await postJson('/api/webapp/payments/create', {
          initData: tgContext.webApp.initData || null,
          dev: Boolean(tgContext.isLocalDev),
          tariff_code: tariffCode
        });
        setPendingPayment(result.payment || null);
        setStatusLine(result.instructions || 'Заявка на оплату создана.');
        await loadProfile({ silent: true });
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleApplyReferral() {
    if (!referralInput.trim()) {
      setError('Введите referral code.');
      return;
    }

    try {
      await runWithBusy('Применяем код…', async () => {
        const result = await postJson('/api/webapp/apply-referral', {
          initData: tgContext.webApp.initData || null,
          dev: Boolean(tgContext.isLocalDev),
          referral_code: referralInput.trim()
        });
        setReferral(result.referral || null);
        setReferralInput('');
        setStatusLine('Бонусный код применён');
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleApplyPromoCode() {
    if (!promoCodeInput.trim()) {
      setError('Введите промокод.');
      return;
    }

    try {
      await runWithBusy('Активируем промокод…', async () => {
        const result = await postJson('/api/webapp/apply-promo', {
          initData: tgContext.webApp.initData || null,
          dev: Boolean(tgContext.isLocalDev),
          promo_code: promoCodeInput.trim()
        });
        setPromoCodeInput('');
        setProfile(result.profile || defaultProfile);
        setStatusLine(`Промокод активирован: +${result.promo?.duration_days || 0} дн.`);
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCopyReferralLink() {
    if (!referral?.invite_link) {
      setError('Реферальная ссылка недоступна.');
      return;
    }

    try {
      await copyToClipboard(referral.invite_link);
      setStatusLine('Ссылка приглашения скопирована');
    } catch (_err) {
      setError('Не удалось скопировать ссылку приглашения.');
    }
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

  async function handleCreateLocalUser() {
    if (!newUserForm.telegram_id.trim()) {
      setError('Введите Telegram ID пользователя.');
      return;
    }

    try {
      await runWithBusy('Добавляем пользователя…', async () => {
        await postJson('/api/webapp/admin/create-user', getAuthPayload({
          telegram_id: newUserForm.telegram_id.trim(),
          username: newUserForm.username.trim()
        }));
        setNewUserForm({ telegram_id: '', username: '' });
        await refreshAdminData();
        setStatusLine('Пользователь добавлен');
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleCreateUserPeer(user) {
    try {
      await runWithBusy('Создаём профиль…', async () => {
        const result = await postJson('/api/webapp/admin/create-peer', getAuthPayload({
          telegram_id: Number(user.telegram_id),
          server_id: getUserSelectedServerId(user.telegram_id) || null
        }));
        if (result?.config) {
          downloadConfigFile(result.config, result.download_name, result.mime_type);
        }
        await refreshAdminData();
        setStatusLine(`Профиль создан для @${user.username || user.telegram_id}`);
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleReissueUserPeer(user) {
    if (!window.confirm('Перевыпустить профиль? Старое подключение будет отозвано.')) return;

    try {
      await runWithBusy('Перевыпускаем профиль…', async () => {
        const result = await postJson('/api/webapp/admin/reissue-peer', getAuthPayload({
          telegram_id: Number(user.telegram_id),
          server_id: getUserSelectedServerId(user.telegram_id) || null
        }));
        if (result?.config) {
          downloadConfigFile(result.config, result.download_name, result.mime_type);
        }
        await refreshAdminData();
        setStatusLine(`Профиль перевыпущен для @${user.username || user.telegram_id}`);
      });
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
      await refreshAdminData();
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

  async function handleCreatePromoCode() {
    if (!promoForm.code.trim()) {
      setError('Введите код промокода.');
      return;
    }

    try {
      await runWithBusy('Создаём промокод…', async () => {
        await postJson('/api/webapp/admin/create-promo-code', {
          initData: tgContext.webApp.initData || null,
          dev: Boolean(tgContext.isLocalDev),
          code: promoForm.code.trim(),
          description: promoForm.description.trim(),
          duration_days: Number(promoForm.duration_days || 30),
          max_redemptions: Number(promoForm.max_redemptions || 1),
          expires_at: promoForm.expires_at || null
        });
        setPromoForm({
          code: '',
          description: '',
          duration_days: '30',
          max_redemptions: '1',
          expires_at: ''
        });
        await loadAdminPromoCodes();
      });
    } catch (err) {
      setError(err.message);
    }
  }

  async function handleDisablePromoCode(promoCodeId) {
    try {
      await runWithBusy('Выключаем промокод…', async () => {
        await postJson('/api/webapp/admin/disable-promo-code', {
          initData: tgContext.webApp.initData || null,
          dev: Boolean(tgContext.isLocalDev),
          promo_code_id: Number(promoCodeId)
        });
        await loadAdminPromoCodes();
      });
    } catch (err) {
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
        <section className="card">
          <h2>Документы и контакты</h2>
          <div className="actions">
            <a className="button button--secondary" href={legalLinks.privacy} target="_blank" rel="noreferrer">Политика конфиденциальности</a>
            <a className="button button--secondary" href={legalLinks.terms} target="_blank" rel="noreferrer">Пользовательское соглашение</a>
            <a className="button button--secondary" href={legalLinks.contact} target="_blank" rel="noreferrer">Контакты и поддержка</a>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app__header">
        <h1>VPN Guard</h1>
        <p className="muted">{statusLine}</p>
      </header>

      {isBusy && <section className="loading-notice">{busyMessage || 'Загрузка…'}</section>}

      <nav className="tabs">
        <button className={activeTab === 'home' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('home')}>
          {PERSONAL_ADMIN_MODE ? 'Мой доступ' : 'Главная'}
        </button>
        {!PERSONAL_ADMIN_MODE && (
          <button className={activeTab === 'billing' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('billing')}>Тарифы</button>
        )}
        {!PERSONAL_ADMIN_MODE && (
          <button className={activeTab === 'referral' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('referral')}>Бонусы</button>
        )}
        <button className={activeTab === 'servers' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('servers')}>Серверы</button>
        {!PERSONAL_ADMIN_MODE && (
          <button className={activeTab === 'support' ? 'tab tab--active' : 'tab'} onClick={() => setActiveTab('support')}>Помощь</button>
        )}
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
            <button className="button button--secondary" onClick={loadProfile} disabled={isBusy}>Проверить подписку</button>
          </div>
        </section>
      )}

      {subscribed && activeTab === 'home' && (
        <>
          <section className="card">
            <h2>{PERSONAL_ADMIN_MODE ? 'Локальный доступ' : 'Ваш аккаунт'}</h2>
            <div className="info">
              {PERSONAL_ADMIN_MODE
                ? `Подключений: ${profile.connections_count ?? 0}\nVPN статус: ${profile.vpn_status || 'active'}`
                : 'Тариф: ' + (profile.tariff_name || 'Без тарифа')
                  + '\nПодключений: ' + (profile.connections_count ?? 0)
                  + '\nДействует до: ' + formatDate(profile.tariff_expiry)
                  + '\nVPN статус: ' + (profile.vpn_status || 'active')}
            </div>
            {!PERSONAL_ADMIN_MODE && !profile.has_active_access && (
              <p className="billing-alert">
                Для продолжения работы выберите подходящий тариф.
              </p>
            )}
            {!PERSONAL_ADMIN_MODE && profile.tariff_code === 'trial-30d' && profile.has_active_access && (
              <p className="billing-note">
                У новых пользователей первый месяц бесплатный. После этого понадобится платный тариф.
              </p>
            )}
          </section>

          <section className="card">
            <h2>Подключить VPN</h2>
            <p className="muted">
              Здесь всего три шага: выберите устройство, установите приложение и нажмите кнопку подключения.
            </p>

            <div className="step-list">
              <div className={`step-card ${selectedDevice ? 'step-card--done' : ''}`}>
                <span className="step-card__number">1</span>
                <div className="step-card__content">
                  <strong>Выберите устройство</strong>
                  <span>{selectedDevice ? `Сейчас выбрано: ${selectedDevice.label}` : 'Покажем только нужную кнопку установки.'}</span>
                </div>
              </div>
              <div className={`step-card ${clientInstalled ? 'step-card--done' : ''}`}>
                <span className="step-card__number">2</span>
                <div className="step-card__content">
                  <strong>Установите приложение</strong>
                  <span>{selectedDevice ? `${selectedDevice.clientName} нужен один раз.` : 'Сначала выберите устройство.'}</span>
                </div>
              </div>
              <div className={`step-card ${peer ? 'step-card--done' : ''}`}>
                <span className="step-card__number">3</span>
                <div className="step-card__content">
                  <strong>Подключите VPN</strong>
                  <span>{peer ? 'VPN уже готов. Можно открывать приложение.' : 'Мы создадим подключение автоматически.'}</span>
                </div>
              </div>
            </div>

            <div className="device-grid">
              {CLIENT_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  className={deviceOptionId === option.id ? 'button device-button device-button--active' : 'button button--secondary device-button'}
                  onClick={() => handleChooseDevice(option.id)}
                  disabled={isBusy}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {selectedDevice && (
              <div className="onboarding-panel">
                <div className="onboarding-panel__header">
                  <strong>{selectedDevice.label}</strong>
                  <span className="muted">Рекомендуем {selectedDevice.clientName}</span>
                </div>
                {!clientInstalled && (
                  <div className="actions">
                    <button className="button" onClick={handleInstallClient} disabled={isBusy}>Установить приложение</button>
                    <button className="button button--secondary" onClick={handleClientInstalled} disabled={isBusy}>Приложение уже установлено</button>
                  </div>
                )}
                {clientInstalled && !peer && (
                  <div className="actions">
                    <button
                      className="button"
                      onClick={handleConnect}
                      disabled={isBusy || !canConnectNow}
                    >
                      {isBusy ? 'Подождите…' : 'Подключить VPN'}
                    </button>
                    <button className="button button--secondary" onClick={() => setClientInstalled(false)} disabled={isBusy}>
                      Выбрать другое устройство
                    </button>
                  </div>
                )}
              </div>
            )}

            {!selectedDevice && (
              <p className="muted">Если вы открыли mini app с телефона, устройство обычно определится автоматически.</p>
            )}

            {hasMultipleServers && (
              <div className="server-select">
                <label className="label">Сервер</label>
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
            )}
            {selectedServer && (
              <p className="muted">
                {hasMultipleServers ? 'Выбранный сервер' : 'Сервер по умолчанию'}: {formatServerLocation(selectedServer.location)}
              </p>
            )}
            {!profile.has_active_access && (
              <p className="billing-alert">Сначала активируйте тариф, затем сможете подключить VPN.</p>
            )}
          </section>

          <section className="card">
            <h2>{peer ? 'VPN готов' : 'Если что-то не получилось'}</h2>
            {!peer && (
              <p className="muted">
                Если приложение уже установлено, но подключение не запускается, откройте вкладку «Помощь» или напишите в поддержку.
              </p>
            )}
            {peer && (
              <>
                <p className="muted">
                  Если приложение не открылось автоматически, нажмите кнопку ниже. В крайнем случае скопируйте ссылку и вставьте её в клиент вручную.
                </p>
                <div className="admin-actions">
                  <button className="button" onClick={handleOpenInClient} disabled={isBusy}>Открыть VPN</button>
                  <button className="button button--secondary" onClick={handleCopyAccessUri} disabled={isBusy}>Скопировать ссылку</button>
                  <button className="button button--secondary" onClick={handleDownload} disabled={isBusy}>{isBusy ? 'Подождите…' : 'Обновить подключение'}</button>
                  <button className="button button--secondary" onClick={handleRemove} disabled={isBusy}>{isBusy ? 'Подождите…' : 'Сбросить подключение'}</button>
                </div>
              </>
            )}
          </section>

          {!PERSONAL_ADMIN_MODE && (
            <>
              <section className="card">
                <h2>Поддержка</h2>
                <p>Если есть вопросы по доступу или оплате, пишите в поддержку.</p>
                <a className="link" href="https://t.me/vpnguardsupport" target="_blank" rel="noreferrer">@vpnguardsupport</a>
                <div className="actions" style={{ marginTop: 12 }}>
                  <a className="button button--secondary" href={legalLinks.contact} target="_blank" rel="noreferrer">Контакты и форма обращения</a>
                </div>
              </section>

              <section className="card">
                <h2>Документы</h2>
                <div className="actions">
                  <a className="button button--secondary" href={legalLinks.privacy} target="_blank" rel="noreferrer">Политика конфиденциальности</a>
                  <a className="button button--secondary" href={legalLinks.terms} target="_blank" rel="noreferrer">Пользовательское соглашение</a>
                </div>
              </section>
            </>
          )}
        </>
      )}

      {!PERSONAL_ADMIN_MODE && subscribed && activeTab === 'billing' && (
        <section className="card">
          <h2>Тарифы</h2>
          <p className="muted">Выберите подходящий тариф. Первый месяц для новых пользователей бесплатный.</p>
          <div className="plan-current">
            <strong>Текущий тариф:</strong> {profile.tariff_name || 'Без тарифа'}
            <br />
            <span className="muted">Действует до: {formatDate(profile.tariff_expiry)}</span>
          </div>
          <div className="plan-list">
            {tariffs.filter(tariff => tariff.code !== 'trial-30d').map(tariff => (
              <div key={tariff.code} className="plan-card">
                <div>
                  <strong>{tariff.name}</strong>
                  <div className="muted">{tariff.description}</div>
                </div>
                <div className="plan-card__footer">
                  <span className="plan-price">{formatPrice(tariff.price)} ₽</span>
                  <button
                    className="button button--secondary"
                    onClick={() => handleCreatePayment(tariff.code)}
                    disabled={isBusy}
                  >
                    {isBusy ? 'Подождите…' : 'Выбрать'}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {pendingPayment && (
            <p className="billing-note">
              Заявка #{pendingPayment.id} на тариф {pendingPayment.tariff_name} уже создана. Для подтверждения оплаты напишите в поддержку.
            </p>
          )}
        </section>
      )}

      {!PERSONAL_ADMIN_MODE && subscribed && activeTab === 'referral' && (
        <section className="card">
          <h2>Бонусы за приглашения</h2>
          <p className="muted">
            За первую оплаченную подписку приглашённого пользователя вы оба получите по {referral?.reward_days || 7} дней доступа.
          </p>
          {referral?.invite_link && (
            <div className="admin-actions">
              <button className="button button--secondary" onClick={handleCopyReferralLink} disabled={isBusy}>Скопировать ссылку</button>
            </div>
          )}
          {referral && (
            <div className="info">
              {'Код: ' + (referral.code || '—')}
              {'\nПриглашено: ' + (referral.invited_total ?? 0)}
              {'\nНаград начислено: ' + (referral.rewarded_total ?? 0)}
            </div>
          )}
          <div className="admin-controls">
            <input
              className="input"
              placeholder="Ввести бонусный код"
              value={referralInput}
              onChange={(event) => setReferralInput(event.target.value)}
            />
            <button className="button button--secondary" onClick={handleApplyReferral} disabled={isBusy}>
              {isBusy ? 'Подождите…' : 'Применить'}
            </button>
          </div>

          <div className="promo-block">
            <h3>Промокод</h3>
            <p className="muted">Если у вас есть промокод от администратора, активируйте его здесь.</p>
            <div className="admin-controls">
              <input
                className="input"
                placeholder="Ввести промокод"
                value={promoCodeInput}
                onChange={(event) => setPromoCodeInput(event.target.value)}
              />
              <button className="button button--secondary" onClick={handleApplyPromoCode} disabled={isBusy}>
                {isBusy ? 'Подождите…' : 'Активировать'}
              </button>
            </div>
          </div>
        </section>
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
          <div className="admin-subtabs">
            <button className={adminTab === 'overview' ? 'tab tab--active' : 'tab'} onClick={() => setAdminTab('overview')}>Обзор</button>
            <button className={adminTab === 'users' ? 'tab tab--active' : 'tab'} onClick={() => setAdminTab('users')}>Пользователи</button>
            <button className={adminTab === 'peers' ? 'tab tab--active' : 'tab'} onClick={() => setAdminTab('peers')}>Подключения</button>
            {!PERSONAL_ADMIN_MODE && (
              <button className={adminTab === 'promo' ? 'tab tab--active' : 'tab'} onClick={() => setAdminTab('promo')}>Промокоды</button>
            )}
            {!PERSONAL_ADMIN_MODE && (
              <button className={adminTab === 'broadcast' ? 'tab tab--active' : 'tab'} onClick={() => setAdminTab('broadcast')}>Рассылка</button>
            )}
          </div>

          {adminTab === 'overview' && (
            <div className="admin-section">
              <div className="admin-actions">
                <button className="button button--secondary" onClick={loadAdminMetrics} disabled={isBusy}>Обновить метрики</button>
              </div>
              <div className="metrics-grid">
                <div className="metric-card">
                  <span className="muted">Пользователей всего</span>
                  <strong>{formatMetricValue(adminMetrics?.total_users)}</strong>
                </div>
                <div className="metric-card">
                  <span className="muted">Активный доступ</span>
                  <strong>{formatMetricValue(adminMetrics?.active_access_users)}</strong>
                </div>
                {!PERSONAL_ADMIN_MODE && (
                  <div className="metric-card">
                    <span className="muted">Активные платные тарифы</span>
                    <strong>{formatMetricValue(adminMetrics?.active_paid_subscriptions)}</strong>
                  </div>
                )}
                <div className="metric-card">
                  <span className="muted">Активные профили</span>
                  <strong>{formatMetricValue(adminMetrics?.active_profiles)}</strong>
                </div>
                {!PERSONAL_ADMIN_MODE && (
                  <>
                    <div className="metric-card">
                      <span className="muted">Оплаченных заказов</span>
                      <strong>{formatMetricValue(adminMetrics?.paid_orders_count)}</strong>
                    </div>
                    <div className="metric-card">
                      <span className="muted">Выручка, ₽</span>
                      <strong>{formatMetricValue(adminMetrics?.paid_revenue_rub)}</strong>
                    </div>
                    <div className="metric-card">
                      <span className="muted">Активные промокоды</span>
                      <strong>{formatMetricValue(adminMetrics?.active_promo_codes)}</strong>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {adminTab === 'users' && (
            <div className="admin-section">
              {PERSONAL_ADMIN_MODE && (
                <div className="admin-panel">
                  <h3>Добавить пользователя</h3>
                  <div className="admin-controls admin-controls--three">
                    <input
                      className="input"
                      inputMode="numeric"
                      placeholder="Telegram ID"
                      value={newUserForm.telegram_id}
                      onChange={(event) => setNewUserForm(prev => ({ ...prev, telegram_id: event.target.value }))}
                    />
                    <input
                      className="input"
                      placeholder="username без @"
                      value={newUserForm.username}
                      onChange={(event) => setNewUserForm(prev => ({ ...prev, username: event.target.value }))}
                    />
                    <button className="button" onClick={handleCreateLocalUser} disabled={isBusy}>
                      {isBusy ? 'Подождите…' : 'Добавить'}
                    </button>
                  </div>
                </div>
              )}

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
              <div className="admin-list">
                {users.length === 0 && <span className="muted">Нет данных</span>}
                {users.map(user => (
                  <div key={user.telegram_id} className="admin-item">
                    <div className="server-row">
                      <strong>@{user.username || '—'}</strong>
                      <span className="muted">id: {user.telegram_id}</span>
                      <span className={`status-pill status-pill--${user.vpn_status === 'blocked' ? 'offline' : 'online'}`}>
                        {user.vpn_status === 'blocked' ? 'Отключён' : 'Активен'}
                      </span>
                    </div>
                    {!PERSONAL_ADMIN_MODE && <div>Тариф: {user.tariff_name || '—'}</div>}
                    <div>Статус: {user.vpn_status || 'active'}</div>
                    <div className="muted">
                      Подключение: {user.active_peer_name || 'нет'}
                      {user.active_server_name ? ` · ${user.active_server_name}` : ''}
                    </div>
                    {PERSONAL_ADMIN_MODE && servers.length > 0 && (
                      <div className="server-select compact-select">
                        <label className="label" htmlFor={`server-${user.telegram_id}`}>Сервер для нового профиля</label>
                        <select
                          id={`server-${user.telegram_id}`}
                          className="input"
                          value={getUserSelectedServerId(user.telegram_id)}
                          onChange={(event) => handleUserServerChange(user.telegram_id, event.target.value)}
                        >
                          {servers.map((server, index) => (
                            <option key={server.id} value={server.id}>
                              {formatServerTitle(index)} · {formatServerLocation(server.location)} · {server.protocol || 'VPN'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="admin-actions">
                      {PERSONAL_ADMIN_MODE && !user.active_peer_name && (
                        <button className="button" onClick={() => handleCreateUserPeer(user)} disabled={isBusy}>
                          Создать профиль
                        </button>
                      )}
                      {PERSONAL_ADMIN_MODE && user.active_peer_name && (
                        <button className="button" onClick={() => handleReissueUserPeer(user)} disabled={isBusy}>
                          Перевыпустить
                        </button>
                      )}
                      <button className="button button--secondary" onClick={() => handleBan(user.telegram_id)}>
                        {PERSONAL_ADMIN_MODE ? 'Отключить' : 'Забанить'}
                      </button>
                      <button className="button button--secondary" onClick={() => handleUnban(user.telegram_id)}>
                        {PERSONAL_ADMIN_MODE ? 'Включить' : 'Разбанить'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {adminTab === 'peers' && (
            <div className="admin-section">
              <div className="admin-controls">
                <input
                  className="input"
                  placeholder="Поиск по имени или username"
                  value={peersSearch}
                  onChange={(event) => setPeersSearch(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && loadAdminPeers()}
                />
                <button className="button button--secondary" onClick={loadAdminPeers}>Обновить подключения</button>
              </div>
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
                    <div className="muted">
                      Сервер: {peerItem.server_name || peerItem.server_id || '—'}
                      {peerItem.server_location ? ` · ${formatServerLocation(peerItem.server_location)}` : ''}
                    </div>
                    {PERSONAL_ADMIN_MODE && servers.length > 0 && (
                      <div className="server-select compact-select">
                        <label className="label" htmlFor={`peer-server-${peerItem.name}`}>Перевыпустить на сервере</label>
                        <select
                          id={`peer-server-${peerItem.name}`}
                          className="input"
                          value={getUserSelectedServerId(peerItem.telegram_id)}
                          onChange={(event) => handleUserServerChange(peerItem.telegram_id, event.target.value)}
                        >
                          {servers.map((server, index) => (
                            <option key={server.id} value={server.id}>
                              {formatServerTitle(index)} · {formatServerLocation(server.location)} · {server.protocol || 'VPN'}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="admin-actions">
                      {PERSONAL_ADMIN_MODE && (
                        <button className="button" onClick={() => handleReissueUserPeer(peerItem)} disabled={isBusy}>Перевыпустить</button>
                      )}
                      <button className="button button--secondary" onClick={() => handleDeletePeer(peerItem.name)}>Удалить профиль</button>
                      <button className="button button--secondary" onClick={() => handleDownloadPeer(peerItem.name)}>Скачать профиль</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {adminTab === 'promo' && (
            <div className="admin-section">
              <div className="promo-form">
                <input
                  className="input"
                  placeholder="Код"
                  value={promoForm.code}
                  onChange={(event) => setPromoForm(prev => ({ ...prev, code: event.target.value.toUpperCase() }))}
                />
                <input
                  className="input"
                  placeholder="Описание"
                  value={promoForm.description}
                  onChange={(event) => setPromoForm(prev => ({ ...prev, description: event.target.value }))}
                />
                <input
                  className="input"
                  placeholder="Дней доступа"
                  value={promoForm.duration_days}
                  onChange={(event) => setPromoForm(prev => ({ ...prev, duration_days: event.target.value }))}
                />
                <input
                  className="input"
                  placeholder="Лимит использований"
                  value={promoForm.max_redemptions}
                  onChange={(event) => setPromoForm(prev => ({ ...prev, max_redemptions: event.target.value }))}
                />
                <input
                  className="input"
                  type="datetime-local"
                  value={promoForm.expires_at}
                  onChange={(event) => setPromoForm(prev => ({ ...prev, expires_at: event.target.value }))}
                />
                <button className="button button--secondary" onClick={handleCreatePromoCode} disabled={isBusy}>
                  {isBusy ? 'Подождите…' : 'Создать промокод'}
                </button>
              </div>
              <div className="admin-actions">
                <button className="button button--secondary" onClick={loadAdminPromoCodes} disabled={isBusy}>Обновить промокоды</button>
              </div>
              <div className="admin-list">
                {promoCodes.length === 0 && <span className="muted">Нет данных</span>}
                {promoCodes.map(promoCode => {
                  const status = normalizePromoStatus(promoCode);
                  return (
                    <div key={promoCode.id} className="admin-item">
                      <div className="server-row">
                        <strong>{promoCode.code}</strong>
                        <span className={`status-pill status-pill--${status.tone}`}>{status.label}</span>
                      </div>
                      <div>{promoCode.description || 'Без описания'}</div>
                      <div>Дней доступа: {promoCode.duration_days}</div>
                      <div>Использований: {promoCode.redemptions_count} / {promoCode.max_redemptions}</div>
                      <div className="muted">Истекает: {formatDate(promoCode.expires_at)}</div>
                      {promoCode.active !== false && (
                        <div className="admin-actions">
                          <button
                            className="button button--secondary"
                            onClick={() => handleDisablePromoCode(promoCode.id)}
                            disabled={isBusy}
                          >
                            {isBusy ? 'Подождите…' : 'Выключить'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {adminTab === 'broadcast' && (
            <div className="admin-section">
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
          )}
        </section>
      )}

      {!PERSONAL_ADMIN_MODE && activeTab === 'support' && (
        <>
          <section className="card">
            <h2>Быстрое подключение</h2>
            <ol className="instructions">
              <li>Откройте вкладку «Главная» и выберите своё устройство.</li>
              <li>Нажмите «Установить приложение» и поставьте v2RayTun.</li>
              <li>Вернитесь в mini app и нажмите «Подключить VPN».</li>
              <li>Если приложение не открылось само, используйте кнопку «Скопировать ссылку».</li>
            </ol>
            <div className="admin-item">
              <div><strong>Скачать приложение</strong></div>
              {CLIENT_OPTIONS.map((option) => (
                <a key={option.id} className="link" href={option.downloadUrl} target="_blank" rel="noreferrer">
                  {option.label}
                </a>
              ))}
            </div>
            <div className="admin-item">
              <div><strong>Telegram-канал</strong></div>
              <a className="link" href="https://t.me/+0Dpn_XGJPJcwOTJi" target="_blank" rel="noreferrer">Перейти в канал</a>
            </div>
            <div className="admin-item">
              <div><strong>Документы и контакты</strong></div>
              <a className="link" href={legalLinks.privacy} target="_blank" rel="noreferrer">Политика конфиденциальности</a>
              <a className="link" href={legalLinks.terms} target="_blank" rel="noreferrer">Пользовательское соглашение</a>
              <a className="link" href={legalLinks.contact} target="_blank" rel="noreferrer">Контакты и форма обращения</a>
            </div>
            <p className="muted">После добавления профиля включите подключение внутри v2RayTun.</p>
          </section>
        </>
      )}

      {error && <section className="card error">{error}</section>}
    </div>
  );
}
