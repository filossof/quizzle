'use strict';
const crypto = require('crypto');

const INTRO_MS = 4000;
const HOST_GRACE_MS = 10 * 60 * 1000;
const GAME_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PLAYERS = 150;

const rid = () => crypto.randomBytes(12).toString('hex');
const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

class Game {
  constructor(manager, quiz) {
    this.manager = manager;
    this.io = manager.io;
    this.quiz = quiz;
    this.pin = manager.newPin();
    this.hostToken = rid();
    this.hostSocketId = null;
    this.players = new Map();
    this.phase = 'lobby'; // lobby → intro → question → reveal → scoreboard → intro … → podium
    this.qIndex = -1;
    this.qStart = 0;
    this.deadline = 0;
    this.timer = null;
    this.hostGoneTimer = null;
    this.reveal = null;
    this.lastActivity = Date.now();
  }

  get question() { return this.quiz.questions[this.qIndex]; }
  get total() { return this.quiz.questions.length; }
  get isLast() { return this.qIndex >= this.total - 1; }
  get ranked() { return [...this.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt); }

  // ── Host ────────────────────────────────────────────────────────────────
  attachHost(socket) {
    if (this.hostSocketId && this.hostSocketId !== socket.id) this.io.to(this.hostSocketId).emit('host:replaced');
    this.hostSocketId = socket.id;
    socket.data.hostPin = this.pin;
    clearTimeout(this.hostGoneTimer);
    this.syncHost();
  }

  detachHost(socketId) {
    if (this.hostSocketId !== socketId) return;
    this.hostSocketId = null;
    this.hostGoneTimer = setTimeout(() => this.destroy('The host left the game.'), HOST_GRACE_MS);
  }

  hostAction(action, arg) {
    switch (action) {
      case 'start':
        if (this.phase === 'lobby' && this.players.size) this.nextQuestion();
        break;
      case 'next':
        if (this.phase === 'question') this.endQuestion();
        else if (this.phase === 'reveal') this.isLast ? this.showPodium() : this.showScoreboard();
        else if (this.phase === 'scoreboard') this.nextQuestion();
        break;
      case 'kick':
        this.kick(arg);
        break;
      case 'end':
        this.destroy('The host ended the game.');
        break;
    }
  }

  // ── Players ─────────────────────────────────────────────────────────────
  join(socket, rawName, avatar) {
    const name = cleanName(rawName);
    if (!name) return { error: 'Please type a nickname!' };
    if (this.phase === 'podium') return { error: 'This game has already finished.' };
    if (this.players.size >= MAX_PLAYERS) return { error: 'Sorry, this game is full.' };
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) return { error: 'Someone already has that name. Try another!' };
    }
    const player = {
      id: rid(), name, avatar: Array.from(String(avatar || '🦉')).slice(0, 4).join(''),
      score: 0, streak: 0, correct: 0, rank: 1, pos: this.players.size, prevPos: this.players.size,
      answer: null, result: null, socketId: null, connected: false, joinedAt: Date.now(),
    };
    this.players.set(player.id, player);
    this.rankPlayers();
    player.prevPos = player.pos;
    this.bindPlayer(socket, player);
    return { ok: true, playerId: player.id };
  }

  rejoin(socket, playerId) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'Could not find you in this game.' };
    this.bindPlayer(socket, p);
    return { ok: true, playerId: p.id };
  }

  bindPlayer(socket, p) {
    p.socketId = socket.id;
    p.connected = true;
    socket.data.playerPin = this.pin;
    socket.data.playerId = p.id;
    this.syncPlayer(p);
    this.syncHost();
  }

  playerDisconnected(socketId, playerId) {
    const p = this.players.get(playerId);
    if (!p || p.socketId !== socketId) return;
    p.connected = false;
    p.socketId = null;
    this.syncHost();
    if (this.phase === 'question') this.checkAllAnswered();
  }

  leave(playerId) {
    if (!this.players.delete(playerId)) return;
    this.rankPlayers();
    this.syncHost();
    if (this.phase === 'question') this.checkAllAnswered();
  }

  kick(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    if (p.socketId) this.io.to(p.socketId).emit('player:kicked');
    this.leave(playerId);
  }

  // ── Game flow ───────────────────────────────────────────────────────────
  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.timer = setTimeout(fn, ms);
    this.deadline = Date.now() + ms;
  }

  nextQuestion() {
    this.qIndex++;
    this.phase = 'intro';
    this.reveal = null;
    for (const p of this.players.values()) { p.answer = null; p.result = null; }
    this.setTimer(INTRO_MS, () => this.startQuestion());
    this.syncAll();
  }

  startQuestion() {
    this.phase = 'question';
    this.qStart = Date.now();
    this.setTimer(this.question.timeLimit * 1000, () => this.endQuestion());
    this.syncAll();
  }

  answer(playerId, choice) {
    const p = this.players.get(playerId);
    if (!p || this.phase !== 'question' || p.answer) return;
    choice = Number(choice);
    if (!Number.isInteger(choice) || choice < 0 || choice >= this.question.answers.length) return;
    p.answer = { choice, ms: Date.now() - this.qStart };
    this.syncPlayer(p);
    this.syncHost();
    this.checkAllAnswered();
  }

  checkAllAnswered() {
    const active = [...this.players.values()].filter(p => p.connected);
    if (active.length && active.every(p => p.answer)) this.setTimer(800, () => this.endQuestion());
  }

  endQuestion() {
    if (this.phase !== 'question') return;
    clearTimeout(this.timer);
    const q = this.question;
    const limit = q.timeLimit * 1000;
    const counts = q.answers.map(() => 0);

    for (const p of this.players.values()) {
      p.prevPos = p.pos;
      let points = 0;
      const correct = !!p.answer && q.answers[p.answer.choice].correct;
      if (p.answer) counts[p.answer.choice]++;
      if (correct) {
        p.streak++;
        p.correct++;
        if (q.points > 0) {
          // Faster answers earn more: 1000 points instantly, down to 500 at the buzzer.
          const speed = 1 - Math.min(p.answer.ms, limit) / limit / 2;
          points = Math.round(1000 * speed) * q.points + Math.min(p.streak - 1, 5) * 100;
        }
      } else {
        p.streak = 0;
      }
      p.score += points;
      p.result = { answered: !!p.answer, correct, points, streak: p.streak };
    }

    this.rankPlayers();
    this.reveal = { counts, correct: q.answers.flatMap((a, i) => (a.correct ? [i] : [])) };
    this.phase = 'reveal';
    this.syncAll();
  }

  rankPlayers() {
    let lastScore = null, lastRank = 0;
    this.ranked.forEach((p, i) => {
      if (p.score !== lastScore) { lastRank = i + 1; lastScore = p.score; }
      p.rank = lastRank;
      p.pos = i;
    });
  }

  showScoreboard() {
    this.phase = 'scoreboard';
    this.syncAll();
  }

  showPodium() {
    clearTimeout(this.timer);
    this.phase = 'podium';
    this.syncAll();
  }

  destroy(reason) {
    clearTimeout(this.timer);
    clearTimeout(this.hostGoneTimer);
    for (const p of this.players.values()) if (p.socketId) this.io.to(p.socketId).emit('game:ended', { reason });
    if (this.hostSocketId) this.io.to(this.hostSocketId).emit('game:ended', { reason });
    this.manager.games.delete(this.pin);
  }

  // ── Views ───────────────────────────────────────────────────────────────
  questionView(forHost) {
    if (!['intro', 'question', 'reveal'].includes(this.phase)) return null;
    const q = this.question;
    const reveal = this.phase === 'reveal';
    return {
      text: q.text, type: q.type, timeLimit: q.timeLimit, points: q.points,
      image: forHost ? q.image : undefined,
      answers: q.answers.map(a => ({ text: a.text, correct: reveal ? a.correct : undefined })),
    };
  }

  hostView() {
    const players = this.ranked;
    return {
      pin: this.pin, joinUrl: this.manager.joinUrl, title: this.quiz.title, emoji: this.quiz.emoji,
      phase: this.phase, qIndex: this.qIndex, total: this.total,
      remainingMs: Math.max(0, this.deadline - Date.now()),
      question: this.questionView(true),
      reveal: this.reveal,
      answeredCount: players.filter(p => p.answer).length,
      players: players.map(p => ({
        id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank: p.rank, pos: p.pos, prevPos: p.prevPos,
        streak: p.streak, correct: p.correct, connected: p.connected, result: p.result,
      })),
    };
  }

  playerView(p) {
    const list = this.ranked;
    const ahead = list[list.indexOf(p) - 1];
    return {
      pin: this.pin, title: this.quiz.title, phase: this.phase, qIndex: this.qIndex, total: this.total,
      remainingMs: Math.max(0, this.deadline - Date.now()),
      playerCount: this.players.size,
      me: { id: p.id, name: p.name, avatar: p.avatar, score: p.score, rank: p.rank, streak: p.streak, correct: p.correct },
      question: this.questionView(false),
      answered: p.answer ? p.answer.choice : null,
      result: p.result,
      ahead: ahead && ahead.score > p.score ? { name: ahead.name, gap: ahead.score - p.score } : null,
    };
  }

  syncHost() {
    this.lastActivity = Date.now();
    if (this.hostSocketId) this.io.to(this.hostSocketId).emit('host:state', this.hostView());
  }

  syncPlayer(p) {
    if (p.socketId) this.io.to(p.socketId).emit('player:state', this.playerView(p));
  }

  syncAll() {
    this.syncHost();
    for (const p of this.players.values()) this.syncPlayer(p);
  }
}

class GameManager {
  constructor(io, joinUrl) {
    this.io = io;
    this.joinUrl = joinUrl;
    this.games = new Map();
    setInterval(() => {
      for (const g of this.games.values()) if (Date.now() - g.lastActivity > GAME_TTL_MS) g.destroy('This game expired.');
    }, 10 * 60 * 1000).unref();
  }

  newPin() {
    let pin;
    do pin = String(100000 + Math.floor(Math.random() * 900000));
    while (this.games.has(pin));
    return pin;
  }

  create(quiz) {
    const game = new Game(this, quiz);
    this.games.set(game.pin, game);
    return game;
  }

  get(pin) {
    return this.games.get(String(pin ?? '').replace(/\D/g, ''));
  }
}

module.exports = { GameManager };
