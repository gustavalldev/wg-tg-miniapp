const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function getLegalConfig() {
  const serviceName = process.env.LEGAL_SERVICE_NAME || 'VPN Guard';
  const ownerName = process.env.LEGAL_OWNER_NAME || 'REPLACE_WITH_OWNER_NAME';
  const supportEmail = process.env.SUPPORT_EMAIL || process.env.LEGAL_CONTACT_EMAIL || 'support@example.com';
  const legalEmail = process.env.LEGAL_CONTACT_EMAIL || supportEmail;
  const address = process.env.LEGAL_CONTACT_ADDRESS || 'Адрес предоставляется по запросу в службу поддержки';
  const supportHours = process.env.SUPPORT_HOURS || 'Ежедневно, ответ в течение 24 часов';
  const ticketUrl = process.env.SUPPORT_TICKET_URL || '';

  return {
    serviceName,
    ownerName,
    supportEmail,
    legalEmail,
    address,
    supportHours,
    ticketUrl
  };
}

function renderLayout({ title, description, body, notice }) {
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <style>
      :root {
        color-scheme: light;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f4f7fb;
        color: #16202a;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: linear-gradient(180deg, #f7faff 0%, #eef3fb 100%); }
      main {
        width: min(880px, calc(100% - 32px));
        margin: 24px auto 40px;
      }
      .card {
        background: #fff;
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 14px 40px rgba(24, 39, 75, 0.08);
      }
      .eyebrow {
        display: inline-block;
        margin-bottom: 12px;
        padding: 6px 10px;
        border-radius: 999px;
        background: #edf3ff;
        color: #1e57d8;
        font-weight: 600;
        font-size: 13px;
      }
      h1, h2, h3 { margin: 0 0 12px; line-height: 1.2; }
      p, li { line-height: 1.7; }
      .muted { color: #5c677a; }
      .notice {
        margin-bottom: 16px;
        padding: 12px 14px;
        border-radius: 14px;
        background: #eefbf2;
        color: #1d7a3a;
        font-weight: 600;
      }
      .contacts {
        display: grid;
        gap: 12px;
        margin: 20px 0 24px;
      }
      .contact-row {
        padding: 14px 16px;
        border-radius: 14px;
        background: #f7f9fc;
      }
      .contact-row strong {
        display: block;
        margin-bottom: 4px;
      }
      a { color: #1e57d8; text-decoration: none; }
      form { display: grid; gap: 12px; margin-top: 20px; }
      input, textarea {
        width: 100%;
        padding: 12px 14px;
        border: 1px solid #dbe3ee;
        border-radius: 12px;
        font: inherit;
      }
      button {
        border: none;
        border-radius: 12px;
        padding: 12px 16px;
        background: #1e57d8;
        color: #fff;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }
      ol, ul { padding-left: 20px; }
      section + section { margin-top: 24px; }
      .footer {
        margin-top: 20px;
        color: #5c677a;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <div class="card">
        <span class="eyebrow">${escapeHtml(title)}</span>
        ${notice ? `<div class="notice">${escapeHtml(notice)}</div>` : ''}
        ${body}
        <div class="footer">
          Документ размещён в сервисе и доступен по постоянной ссылке.
        </div>
      </div>
    </main>
  </body>
</html>`;
}

function renderPrivacyPage() {
  const config = getLegalConfig();

  return renderLayout({
    title: 'Политика конфиденциальности',
    description: `Политика конфиденциальности сервиса ${config.serviceName}`,
    body: `
      <h1>Политика конфиденциальности</h1>
      <p class="muted">Настоящая политика регулирует сбор, использование и защиту информации пользователей сервиса ${escapeHtml(config.serviceName)}.</p>

      <section>
        <h2>1. Общие положения</h2>
        <p>Используя сервис, Telegram-бот, mini app, формы оплаты и обращения в поддержку, пользователь подтверждает согласие с настоящей политикой. Если пользователь не согласен с её условиями, он обязан прекратить использование сервиса.</p>
      </section>

      <section>
        <h2>2. Какие данные мы можем собирать</h2>
        <ul>
          <li>идентификаторы аккаунта, включая Telegram ID, username, имя профиля;</li>
          <li>технические данные: IP-адрес, тип устройства, браузер, операционная система, время запросов;</li>
          <li>данные о подписках, платежах, тарифах, промокодах и обращениях в поддержку;</li>
          <li>историю взаимодействия с сервисом и служебные журналы, необходимые для работы функций и безопасности.</li>
        </ul>
        <p>Сервис не запрашивает паспортные данные, фотографии документов или иную личную информацию сверх минимально необходимой для оказания услуг.</p>
      </section>

      <section>
        <h2>3. Для чего используются данные</h2>
        <ul>
          <li>для предоставления доступа к функциям сервиса и учёта подписок;</li>
          <li>для связи с пользователем по вопросам оплаты, доступа, поддержки и безопасности;</li>
          <li>для предотвращения злоупотреблений, сбоев и мошеннических операций;</li>
          <li>для исполнения требований законодательства и запросов платёжных провайдеров.</li>
        </ul>
      </section>

      <section>
        <h2>4. Передача данных третьим лицам</h2>
        <p>Администрация не продаёт персональные данные пользователей. Передача возможна только:</p>
        <ul>
          <li>платёжным и техническим провайдерам, если это требуется для работы сервиса;</li>
          <li>по запросу государственных органов в случаях, предусмотренных законом;</li>
          <li>при наличии отдельного согласия пользователя.</li>
        </ul>
      </section>

      <section>
        <h2>5. Хранение и защита данных</h2>
        <p>Данные хранятся в течение срока, необходимого для оказания услуг, обработки платежей, рассмотрения обращений и соблюдения обязательных требований. Администрация принимает разумные организационные и технические меры защиты, но не может гарантировать абсолютную безопасность передачи данных через интернет.</p>
      </section>

      <section>
        <h2>6. Обращения пользователя</h2>
        <p>Запросы по вопросам обработки данных, удаления аккаунта и связи с поддержкой принимаются по адресу <a href="mailto:${escapeHtml(config.legalEmail)}">${escapeHtml(config.legalEmail)}</a>.</p>
      </section>

      <section>
        <h2>7. Изменение политики</h2>
        <p>Администрация вправе обновлять настоящую политику. Актуальная редакция публикуется на этой странице и применяется с момента размещения.</p>
      </section>
    `
  });
}

function renderTermsPage() {
  const config = getLegalConfig();

  return renderLayout({
    title: 'Пользовательское соглашение',
    description: `Пользовательское соглашение сервиса ${config.serviceName}`,
    body: `
      <h1>Пользовательское соглашение</h1>
      <p class="muted">Документ регулирует порядок использования сервиса ${escapeHtml(config.serviceName)}, включая Telegram-бот, mini app, учётные записи, цифровые подписки и службу поддержки.</p>

      <section>
        <h2>1. Общие положения</h2>
        <p>Использование сервиса, запуск бота, регистрация, оформление подписки, оплата или получение доступа к функционалу означает полное принятие условий настоящего соглашения.</p>
      </section>

      <section>
        <h2>2. Характер услуг</h2>
        <p>Сервис предоставляет цифровой доступ к программным и сервисным функциям, связанным с управлением аккаунтом, настройками, подпиской, платежами, цифровыми материалами и поддержкой пользователей. Состав функций может меняться без предварительного уведомления, если это не ухудшает уже оплаченный объём услуг без законного основания.</p>
      </section>

      <section>
        <h2>3. Порядок использования</h2>
        <ul>
          <li>пользователь обязан указывать достоверные данные, необходимые для работы сервиса и оплаты;</li>
          <li>запрещается передавать доступ третьим лицам, вмешиваться в работу сервиса и злоупотреблять инфраструктурой;</li>
          <li>администрация вправе ограничить доступ при нарушении условий соглашения, подозрении на мошенничество или по требованиям закона и платёжных провайдеров.</li>
        </ul>
      </section>

      <section>
        <h2>4. Платежи и возвраты</h2>
        <p>Оплата производится на условиях, указанных в сервисе до момента подтверждения платежа. Возвраты рассматриваются индивидуально, если оплаченная услуга фактически не была предоставлена по технической вине сервиса. Перед инициированием chargeback пользователь обязан сначала обратиться в поддержку.</p>
      </section>

      <section>
        <h2>5. Ограничение ответственности</h2>
        <p>Сервис предоставляется по модели “как есть”. Администрация не гарантирует бесперебойную работу, соответствие ожиданиям пользователя и отсутствие ограничений со стороны третьих лиц. В максимальной степени, допустимой законом, администрация не несёт ответственности за косвенные убытки, упущенную выгоду и последствия действий пользователя вне контроля сервиса.</p>
      </section>

      <section>
        <h2>6. Интеллектуальная собственность</h2>
        <p>Интерфейсы, базы данных, тексты, программный код, цифровые материалы и иные элементы сервиса охраняются законом. Копирование, перепродажа, передача доступа и иное использование вне предоставленного функционала допускаются только с письменного разрешения правообладателя.</p>
      </section>

      <section>
        <h2>7. Контакты и изменения условий</h2>
        <p>Актуальная редакция соглашения публикуется на этой странице. По вопросам использования сервиса и возвратов пользователь может обратиться по адресу <a href="mailto:${escapeHtml(config.supportEmail)}">${escapeHtml(config.supportEmail)}</a>.</p>
      </section>
    `
  });
}

function renderContactsPage({ notice = '', form = {} } = {}) {
  const config = getLegalConfig();

  return renderLayout({
    title: 'Контакты и поддержка',
    description: `Контактная информация сервиса ${config.serviceName}`,
    notice,
    body: `
      <h1>Контакты и поддержка</h1>
      <p class="muted">Страница для связи с владельцем сервиса и службой поддержки.</p>

      <div class="contacts">
        <div class="contact-row">
          <strong>Сервис</strong>
          ${escapeHtml(config.serviceName)}
        </div>
        <div class="contact-row">
          <strong>Владелец / администратор</strong>
          ${escapeHtml(config.ownerName)}
        </div>
        <div class="contact-row">
          <strong>Юридические вопросы</strong>
          <a href="mailto:${escapeHtml(config.legalEmail)}">${escapeHtml(config.legalEmail)}</a>
        </div>
        <div class="contact-row">
          <strong>Служба поддержки</strong>
          <a href="mailto:${escapeHtml(config.supportEmail)}">${escapeHtml(config.supportEmail)}</a>
        </div>
        <div class="contact-row">
          <strong>Режим обработки обращений</strong>
          ${escapeHtml(config.supportHours)}
        </div>
        <div class="contact-row">
          <strong>Почтовый адрес</strong>
          ${escapeHtml(config.address)}
        </div>
        ${config.ticketUrl ? `<div class="contact-row"><strong>Тикет-система</strong><a href="${escapeHtml(config.ticketUrl)}" target="_blank" rel="noreferrer">${escapeHtml(config.ticketUrl)}</a></div>` : ''}
      </div>

      <section>
        <h2>Форма обращения</h2>
        <p>Если отдельная тикет-система ещё не подключена, обращение можно отправить через форму ниже. Заявке будет присвоен внутренний номер.</p>
        <form method="post" action="/contact">
          <input name="name" type="text" placeholder="Ваше имя" value="${escapeHtml(form.name || '')}" required />
          <input name="email" type="email" placeholder="Email для ответа" value="${escapeHtml(form.email || '')}" required />
          <input name="telegram" type="text" placeholder="Telegram username (необязательно)" value="${escapeHtml(form.telegram || '')}" />
          <textarea name="message" rows="6" placeholder="Опишите вопрос или проблему" required>${escapeHtml(form.message || '')}</textarea>
          <button type="submit">Отправить обращение</button>
        </form>
      </section>
    `
  });
}

module.exports = {
  renderContactsPage,
  renderPrivacyPage,
  renderTermsPage
};
