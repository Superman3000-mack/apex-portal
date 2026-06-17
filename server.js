const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ── DATABASE SETUP ─────────────────────────────────────────────────
const dbPath = path.join(__dirname, '.data', 'apex.db');
if (!fs.existsSync(path.join(__dirname, '.data'))) {
  fs.mkdirSync(path.join(__dirname, '.data'), { recursive: true });
}

const db = new Database(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'agent',
    email TEXT
  );
  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    bizName TEXT, email TEXT, pkg TEXT, dueDate TEXT, agentId TEXT, createdAt TEXT
  );
  CREATE TABLE IF NOT EXISTS contracts (
    id TEXT PRIMARY KEY,
    agentId TEXT, agentName TEXT, bizName TEXT, clientEmail TEXT,
    clientPhone TEXT, pkg TEXT, setupFee TEXT, saleDate TEXT,
    spec TEXT, status TEXT DEFAULT 'pending', submittedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS cold_leads (
    id TEXT PRIMARY KEY,
    agentId TEXT, agentName TEXT, bizName TEXT, email TEXT,
    reason TEXT, notes TEXT, submittedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS assigned_leads (
    id TEXT PRIMARY KEY,
    agentId TEXT, bizName TEXT, email TEXT, assignedAt TEXT
  );
  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    agentId TEXT, agentName TEXT, amount TEXT, client TEXT, sentAt TEXT
  );
`);

// Create admin account if it doesn't exist
const adminExists = db.prepare('SELECT id FROM users WHERE role = ?').get('admin');
if (!adminExists) {
  const hash = bcrypt.hashSync('Jermel1$', 10);
  db.prepare('INSERT INTO users (id, name, username, password, role, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run('admin', 'Jermel', 'Superman 3000', hash, 'admin', 'apexmarketinginnovation@gmail.com');
}

// ── MIDDLEWARE ─────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'apex-secret-2024-xK9m',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── AUTH MIDDLEWARE ────────────────────────────────────────────────
function requireLogin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Not logged in' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}

// ── AUTH ROUTES ────────────────────────────────────────────────────
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.json({ success: false, error: 'Incorrect username or password.' });
  }
  req.session.user = { id: user.id, name: user.name, role: user.role, email: user.email, username: user.username };
  res.json({ success: true, user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.json({ user: null });
  res.json({ user: req.session.user });
});

// ── AGENT MANAGEMENT (Admin only) ─────────────────────────────────
app.get('/api/agents', requireAdmin, (req, res) => {
  const agents = db.prepare('SELECT id, name, username, email, role FROM users WHERE role = ?').all('agent');
  res.json(agents);
});

app.post('/api/agents', requireAdmin, (req, res) => {
  const { name, username, password, email } = req.body;
  if (!name || !username || !password || !email) return res.json({ success: false, error: 'All fields required.' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.json({ success: false, error: 'Username already exists.' });
  const hash = bcrypt.hashSync(password, 10);
  const id = 'ag' + Date.now();
  db.prepare('INSERT INTO users (id, name, username, password, role, email) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, name, username, hash, 'agent', email);
  res.json({ success: true });
});

app.delete('/api/agents/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM users WHERE id = ? AND role = ?').run(req.params.id, 'agent');
  res.json({ success: true });
});

// ── CLIENT MANAGEMENT ─────────────────────────────────────────────
app.get('/api/clients', requireAdmin, (req, res) => {
  res.json(db.prepare('SELECT * FROM clients ORDER BY createdAt DESC').all());
});

app.post('/api/clients', requireAdmin, (req, res) => {
  const { bizName, email, pkg, dueDate } = req.body;
  db.prepare('INSERT INTO clients (id, bizName, email, pkg, dueDate, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run('cl' + Date.now(), bizName, email, pkg, dueDate, new Date().toLocaleDateString());
  res.json({ success: true });
});

app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ── CONTRACTS ─────────────────────────────────────────────────────
app.get('/api/contracts', requireLogin, (req, res) => {
  if (req.session.user.role === 'admin') {
    res.json(db.prepare('SELECT * FROM contracts ORDER BY submittedAt DESC').all());
  } else {
    res.json(db.prepare('SELECT * FROM contracts WHERE agentId = ? ORDER BY submittedAt DESC').all(req.session.user.id));
  }
});

app.post('/api/contracts', requireLogin, (req, res) => {
  const u = req.session.user;
  const d = req.body;
  db.prepare('INSERT INTO contracts (id, agentId, agentName, bizName, clientEmail, clientPhone, pkg, setupFee, saleDate, spec, status, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run('ct' + Date.now(), u.id, u.name, d.bizName, d.clientEmail, d.clientPhone, d.pkg, d.setupFee, d.saleDate, JSON.stringify(d.spec || {}), 'pending', new Date().toLocaleDateString());
  res.json({ success: true });
});

app.post('/api/contracts/:id/approve', requireAdmin, (req, res) => {
  db.prepare("UPDATE contracts SET status = 'approved' WHERE id = ?").run(req.params.id);
  res.json({ success: true });
});

// ── COLD LEADS ─────────────────────────────────────────────────────
app.get('/api/cold-leads', requireLogin, (req, res) => {
  if (req.session.user.role === 'admin') {
    res.json(db.prepare('SELECT * FROM cold_leads ORDER BY submittedAt DESC').all());
  } else {
    res.json(db.prepare('SELECT * FROM cold_leads WHERE agentId = ? ORDER BY submittedAt DESC').all(req.session.user.id));
  }
});

app.post('/api/cold-leads', requireLogin, (req, res) => {
  const u = req.session.user;
  const d = req.body;
  db.prepare('INSERT INTO cold_leads (id, agentId, agentName, bizName, email, reason, notes, submittedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run('cd' + Date.now(), u.id, u.name, d.bizName, d.email, d.reason, d.notes, new Date().toLocaleDateString());
  res.json({ success: true });
});

// ── ASSIGNED LEADS ────────────────────────────────────────────────
app.get('/api/assigned-leads', requireLogin, (req, res) => {
  if (req.session.user.role === 'admin') {
    res.json(db.prepare('SELECT * FROM assigned_leads ORDER BY assignedAt DESC').all());
  } else {
    res.json(db.prepare('SELECT * FROM assigned_leads WHERE agentId = ? ORDER BY assignedAt DESC').all(req.session.user.id));
  }
});

app.post('/api/assigned-leads', requireAdmin, (req, res) => {
  const { agentId, bizName, email } = req.body;
  db.prepare('INSERT INTO assigned_leads (id, agentId, bizName, email, assignedAt) VALUES (?, ?, ?, ?, ?)')
    .run('al' + Date.now(), agentId, bizName, email, new Date().toLocaleDateString());
  res.json({ success: true });
});

// ── PAYMENTS / COMMISSIONS ─────────────────────────────────────────
app.get('/api/payments', requireLogin, (req, res) => {
  if (req.session.user.role === 'admin') {
    res.json(db.prepare('SELECT * FROM payments ORDER BY sentAt DESC').all());
  } else {
    res.json(db.prepare('SELECT * FROM payments WHERE agentId = ? ORDER BY sentAt DESC').all(req.session.user.id));
  }
});

app.post('/api/payments', requireAdmin, (req, res) => {
  const { agentId, agentName, amount, client } = req.body;
  db.prepare('INSERT INTO payments (id, agentId, agentName, amount, client, sentAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run('py' + Date.now(), agentId, agentName, amount, client, new Date().toLocaleDateString());
  res.json({ success: true });
});

// ── DOCUMENT ROUTES ────────────────────────────────────────────────
app.get('/doc/application', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'application.html'));
});
app.get('/doc/contract', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'contractor-agreement.html'));
});
app.get('/doc/welcome', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'welcome-email.html'));
});

// ── SERVE MAIN APP ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Apex Portal running on port ${PORT}`);
});
