'use strict';
const path = require('path');
const os = require('os');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const store = require('./src/store');
const { GameManager } = require('./src/game');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'quizzle';

function lanAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return 'localhost';
}
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://${lanAddress()}:${PORT}`).replace(/\/$/, '');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const games = new GameManager(io, PUBLIC_URL);

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

const requireAdmin = (req, res, next) =>
  req.get('x-admin-password') === ADMIN_PASSWORD ? next() : res.status(401).json({ error: 'Wrong password' });

const summary = q => ({
  id: q.id, title: q.title, description: q.description, emoji: q.emoji,
  questionCount: q.questions.length, updatedAt: q.updatedAt,
});

// Questions with uploaded images are served by URL so game updates stay small.
const imageUrl = (quiz, q) =>
  q.image && q.image.startsWith('data:') ? `/img/${quiz.id}/${q.id}?v=${quiz.updatedAt}` : q.image || '';

const quizForGame = quiz => ({
  ...quiz,
  questions: quiz.questions.map(q => ({ ...q, image: imageUrl(quiz, q) })),
});

app.get('/api/info', (req, res) => res.json({ joinUrl: PUBLIC_URL }));

app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || PUBLIC_URL).slice(0, 500);
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#1d1145', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
});

app.get('/api/quizzes', (req, res) => res.json(store.list().map(summary)));

app.get('/img/:quizId/:qid', (req, res) => {
  const q = store.get(req.params.quizId)?.questions.find(x => x.id === req.params.qid);
  const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,(.*)$/s.exec(q?.image || '');
  if (!m) return res.sendStatus(404);
  res.type(m[1]).set('Cache-Control', 'public, max-age=86400').send(Buffer.from(m[2], 'base64'));
});

app.post('/api/admin/login', requireAdmin, (req, res) => res.json({ ok: true }));

app.get('/api/admin/quizzes/:id', requireAdmin, (req, res) => {
  const quiz = store.get(req.params.id);
  quiz ? res.json(quiz) : res.status(404).json({ error: 'Quiz not found' });
});

app.post('/api/admin/quizzes', requireAdmin, (req, res) => {
  try { res.json(store.create(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/admin/quizzes/:id', requireAdmin, (req, res) => {
  try {
    const quiz = store.update(req.params.id, req.body);
    quiz ? res.json(quiz) : res.status(404).json({ error: 'Quiz not found' });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/admin/quizzes/:id', requireAdmin, (req, res) => {
  store.remove(req.params.id);
  res.json({ ok: true });
});

io.on('connection', socket => {
  const reply = (ack, value) => typeof ack === 'function' && ack(value);
  const hostGame = () => games.get(socket.data.hostPin);
  const playerGame = () => games.get(socket.data.playerPin);

  socket.on('host:create', ({ quizId } = {}, ack) => {
    const quiz = store.get(quizId);
    if (!quiz || !quiz.questions.length) return reply(ack, { error: 'That quiz could not be found.' });
    const game = games.create(quizForGame(quiz));
    game.attachHost(socket);
    reply(ack, { ok: true, pin: game.pin, hostToken: game.hostToken });
  });

  socket.on('host:rejoin', ({ pin, hostToken } = {}, ack) => {
    const game = games.get(pin);
    if (!game || game.hostToken !== hostToken) return reply(ack, { error: 'Game not found.' });
    game.attachHost(socket);
    reply(ack, { ok: true });
  });

  socket.on('host:action', ({ action, from, playerId } = {}) => {
    const game = hostGame();
    if (!game || game.hostSocketId !== socket.id) return;
    if (from && from !== game.phase) return; // stale double-click
    game.hostAction(action, playerId);
  });

  socket.on('player:check', ({ pin } = {}, ack) => {
    const game = games.get(pin);
    if (!game) return reply(ack, { error: "Hmm, we couldn't find a game with that PIN." });
    if (game.phase === 'podium') return reply(ack, { error: 'That game has already finished.' });
    reply(ack, { ok: true, title: game.quiz.title });
  });

  socket.on('player:join', ({ pin, name, avatar } = {}, ack) => {
    const game = games.get(pin);
    if (!game) return reply(ack, { error: "Hmm, we couldn't find a game with that PIN." });
    reply(ack, game.join(socket, name, avatar));
  });

  socket.on('player:rejoin', ({ pin, playerId } = {}, ack) => {
    const game = games.get(pin);
    if (!game) return reply(ack, { error: 'That game has ended.' });
    reply(ack, game.rejoin(socket, playerId));
  });

  socket.on('player:answer', ({ choice } = {}) => playerGame()?.answer(socket.data.playerId, choice));

  socket.on('player:leave', () => {
    playerGame()?.leave(socket.data.playerId);
    socket.data.playerPin = socket.data.playerId = null;
  });

  socket.on('disconnect', () => {
    hostGame()?.detachHost(socket.id);
    playerGame()?.playerDisconnected(socket.id, socket.data.playerId);
  });
});

server.listen(PORT, () => {
  console.log(`\n  🦉 Quizzle is running!\n`);
  console.log(`  Host a game:   http://localhost:${PORT}/host`);
  console.log(`  Make quizzes:  http://localhost:${PORT}/admin   (password: ${ADMIN_PASSWORD === 'quizzle' ? 'quizzle' : '<ADMIN_PASSWORD>'})`);
  console.log(`  Players join:  ${PUBLIC_URL}\n`);
});
