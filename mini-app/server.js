const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  renderContactsPage,
  renderPrivacyPage,
  renderTermsPage
} = require('./legal-pages');

const app = express();
const port = process.env.MINI_APP_PORT || 3002;
const distDir = path.join(__dirname, 'client', 'dist');
const supportTicketsFile = process.env.SUPPORT_TICKETS_FILE || path.join(__dirname, 'data', 'support-tickets.jsonl');

app.use(express.urlencoded({ extended: false }));
app.use(express.static(distDir));

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('/privacy', (req, res) => {
  res.type('html').send(renderPrivacyPage());
});

app.get('/terms', (req, res) => {
  res.type('html').send(renderTermsPage());
});

app.get('/contact', (req, res) => {
  res.type('html').send(renderContactsPage());
});

app.post('/contact', (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const telegram = String(req.body.telegram || '').trim();
  const message = String(req.body.message || '').trim();

  if (!name || !email || !message) {
    res
      .status(400)
      .type('html')
      .send(renderContactsPage({
        notice: 'Заполните обязательные поля: имя, email и текст обращения.',
        form: { name, email, telegram, message }
      }));
    return;
  }

  const ticketId = `TKT-${Date.now().toString(36).toUpperCase()}`;
  const ticket = {
    id: ticketId,
    created_at: new Date().toISOString(),
    name,
    email,
    telegram,
    message
  };

  fs.mkdirSync(path.dirname(supportTicketsFile), { recursive: true });
  fs.appendFileSync(supportTicketsFile, `${JSON.stringify(ticket)}\n`, 'utf8');

  res
    .status(200)
    .type('html')
    .send(renderContactsPage({
      notice: `Обращение принято. Номер заявки: ${ticketId}.`,
      form: {}
    }));
});

app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Mini App server running on port ${port}`);
});
