const express = require('express');
const path = require('path');

const app = express();
const port = process.env.MINI_APP_PORT || 3002;
const distDir = path.join(__dirname, 'client', 'dist');

app.use(express.static(distDir));

app.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Mini App server running on port ${port}`);
});
