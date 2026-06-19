const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const PORT = process.env.PORT || 3000;

// ── JSON FILE DATABASE ─────────────────────────────────────────────
const dataDir = path.join(__dirname, '.data');
const dataFile = path.join(dataDir, 'apex-data.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function loadData() {
  if (!fs.existsSync(dataFile)) {
    return {
      users: [],
      clients: [],
      contracts: [],
      coldLeads: [],
      assignedLeads: [],
      payments: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  } catch (e) {
    return {
      users: [],
      clients: [],
      contracts: [],
      coldLeads: [],
      assignedLeads: [],
      payments: []
    };
  }
}

function saveData(data) {
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
}

let db = loadData();

// Create admin account if it doesn't exist
if (!db.users.find(u => u.role === 'admin')) {
  const hash = bcrypt.hashSync('Jermel1$', 10);
  db.users.push({
    id: 'admin',
    name: 'Jermel',
    username: 'Superman 3000',
    password: hash,
    role: 'admin',
    email: 'apexmarketinginnovation@gmail.com'
  });
  saveData(db);
}

// Migrate existing agent from old system if not already present
if (!db.users.find(u => u.username === 'Dwight McLittle')) {
  const hash = bcrypt.hashSync('LittleRock', 10);
  db.users.push({
    id: 'ag1781632468367',
    name: 'Dwight McLittle',
    username: 'Dwight McLittle',
    password: hash,
    role: 'agent',
    email: 'dwightmclittle980@gmail.com'
  });
  saveData(db);
}

// ── MIDDLEWARE ─────────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'apex-secret-2024-xK9m',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));
app.use(express.static(__dirname));

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
  db = loadData();
  const user = db.users.find(u => u.username === username);
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
  db = loadData();
  const agents = db.users.filter(u => u.role === 'agent').map(a => ({ id: a.id, name: a.name, username: a.username, email: a.email, role: a.role }));
  res.json(agents);
});

app.post('/api/agents', requireAdmin, (req, res) => {
  const { name, username, password, email } = req.body;
  if (!name || !username || !password || !email) return res.json({ success: false, error: 'All fields required.' });
  db = loadData();
  if (db.users.find(u => u.username === username)) return res.json({ success: false, error: 'Username already exists.' });
  const hash = bcrypt.hashSync(password, 10);
  const id = 'ag' + Date.now();
  db.users.push({ id, name, username, password: hash, role: 'agent', email });
  saveData(db);
  res.json({ success: true });
});

app.delete('/api/agents/:id', requireAdmin, (req, res) => {
  db = loadData();
  db.users = db.users.filter(u => !(u.id === req.params.id && u.role === 'agent'));
  saveData(db);
  res.json({ success: true });
});

// ── CLIENT MANAGEMENT ─────────────────────────────────────────────
app.get('/api/clients', requireAdmin, (req, res) => {
  db = loadData();
  res.json(db.clients.slice().reverse());
});

app.post('/api/clients', requireAdmin, (req, res) => {
  const { bizName, email, pkg, dueDate } = req.body;
  db = loadData();
  db.clients.push({ id: 'cl' + Date.now(), bizName, email, pkg, dueDate, createdAt: new Date().toLocaleDateString() });
  saveData(db);
  res.json({ success: true });
});

app.delete('/api/clients/:id', requireAdmin, (req, res) => {
  db = loadData();
  db.clients = db.clients.filter(c => c.id !== req.params.id);
  saveData(db);
  res.json({ success: true });
});

// ── CONTRACTS ─────────────────────────────────────────────────────
app.get('/api/contracts', requireLogin, (req, res) => {
  db = loadData();
  if (req.session.user.role === 'admin') {
    res.json(db.contracts.slice().reverse());
  } else {
    res.json(db.contracts.filter(c => c.agentId === req.session.user.id).slice().reverse());
  }
});

app.post('/api/contracts', requireLogin, (req, res) => {
  const u = req.session.user;
  const d = req.body;
  db = loadData();
  db.contracts.push({
    id: 'ct' + Date.now(), agentId: u.id, agentName: u.name, bizName: d.bizName, clientEmail: d.clientEmail,
    clientPhone: d.clientPhone, pkg: d.pkg, setupFee: d.setupFee, saleDate: d.saleDate,
    spec: d.spec || {}, status: 'pending', submittedAt: new Date().toLocaleDateString()
  });
  saveData(db);
  res.json({ success: true });
});

app.post('/api/contracts/:id/approve', requireAdmin, (req, res) => {
  db = loadData();
  const c = db.contracts.find(x => x.id === req.params.id);
  if (c) c.status = 'approved';
  saveData(db);
  res.json({ success: true });
});

// ── COLD LEADS ─────────────────────────────────────────────────────
app.get('/api/cold-leads', requireLogin, (req, res) => {
  db = loadData();
  if (req.session.user.role === 'admin') {
    res.json(db.coldLeads.slice().reverse());
  } else {
    res.json(db.coldLeads.filter(c => c.agentId === req.session.user.id).slice().reverse());
  }
});

app.post('/api/cold-leads', requireLogin, (req, res) => {
  const u = req.session.user;
  const d = req.body;
  db = loadData();
  db.coldLeads.push({
    id: 'cd' + Date.now(), agentId: u.id, agentName: u.name, bizName: d.bizName, email: d.email,
    reason: d.reason, notes: d.notes, submittedAt: new Date().toLocaleDateString()
  });
  saveData(db);
  res.json({ success: true });
});

// ── ASSIGNED LEADS ────────────────────────────────────────────────
app.get('/api/assigned-leads', requireLogin, (req, res) => {
  db = loadData();
  if (req.session.user.role === 'admin') {
    res.json(db.assignedLeads.slice().reverse());
  } else {
    res.json(db.assignedLeads.filter(l => l.agentId === req.session.user.id).slice().reverse());
  }
});

app.post('/api/assigned-leads', requireAdmin, (req, res) => {
  const { agentId, bizName, email } = req.body;
  db = loadData();
  db.assignedLeads.push({ id: 'al' + Date.now(), agentId, bizName, email, assignedAt: new Date().toLocaleDateString() });
  saveData(db);
  res.json({ success: true });
});

// ── PAYMENTS / COMMISSIONS ─────────────────────────────────────────
app.get('/api/payments', requireLogin, (req, res) => {
  db = loadData();
  if (req.session.user.role === 'admin') {
    res.json(db.payments.slice().reverse());
  } else {
    res.json(db.payments.filter(p => p.agentId === req.session.user.id).slice().reverse());
  }
});

app.post('/api/payments', requireAdmin, (req, res) => {
  const { agentId, agentName, amount, client } = req.body;
  db = loadData();
  db.payments.push({ id: 'py' + Date.now(), agentId, agentName, amount, client, sentAt: new Date().toLocaleDateString() });
  saveData(db);
  res.json({ success: true });
});

// ── STRIPE CHARGE (real card processing — secret key never leaves the server) ──
app.post('/api/charge', async (req, res) => {
  try {
    const { paymentMethodId, amount, description, receiptEmail } = req.body;
    if (!paymentMethodId || !amount) {
      return res.status(400).json({ success: false, error: 'Missing payment method or amount.' });
    }
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(parseFloat(amount) * 100), // Stripe uses cents
      currency: 'usd',
      payment_method: paymentMethodId,
      confirm: true,
      description: description || 'Apex Marketing Innovation payment',
      receipt_email: receiptEmail || undefined,
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
    });
    if (paymentIntent.status === 'succeeded') {
      res.json({ success: true, paymentIntentId: paymentIntent.id });
    } else {
      res.json({ success: false, error: 'Payment did not complete. Status: ' + paymentIntent.status });
    }
  } catch (err) {
    res.json({ success: false, error: err.message || 'Payment failed. Please check the card details and try again.' });
  }
});

// ── DOCUMENT ROUTES ────────────────────────────────────────────────
app.get('/doc/application', (req, res) => {
  res.sendFile(path.join(__dirname, 'application.html'));
});
app.get('/doc/contract', (req, res) => {
  res.sendFile(path.join(__dirname, 'contractor-agreement.html'));
});
app.get('/doc/welcome', (req, res) => {
  res.sendFile(path.join(__dirname, 'welcome-email.html'));
});

// ── SERVE MAIN APP ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index-1.html'));
});

app.listen(PORT, () => {
  console.log(`Apex Portal running on port ${PORT}`);
});
