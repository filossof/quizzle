/* The game engine. It runs inside the host's browser, and phones talk to it through net.js.
   Flow: lobby → intro → question → reveal → scoreboard → intro … → podium */
const INTRO_MS = 4000;
const MAX_PLAYERS = 150;

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
const cleanName = s => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 16);

class Game {
  constructor({ quiz, pin, send, onChange }) {
    this.quiz = quiz;
    this.pin = pin;
    this.send = send;           // (connId, message) → void
    this.onChange = onChange;   // (hostView, snapshot) → void
    this.players = new Map();
    this.byConn = new Map();    // connId → playerId
    this.phase = 'lobby';
    this.qIndex = -1;
    this.qStart = 0;
    this.deadline = 0;
    this.timer = null;
    this.reveal = null;
  }

  get question() { return this.quiz.questions[this.qIndex]; }
  get total() { return this.quiz.questions.length; }
  get isLast() { return this.qIndex >= this.total - 1; }
  get ranked() { return [...this.players.values()].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt); }

  // ── Save / restore (so refreshing the host page doesn't lose the game) ───
  snapshot() {
    const players = [...this.players.values()].map(({ connId, connected, ...p }) => p);
    const { quiz, pin, phase, qIndex, qStart, deadline, reveal } = this;
    return { quiz, pin, phase, qIndex, qStart, deadline, reveal, players };
  }

  static restore(snap, handlers) {
    const g = new Game({ quiz: snap.quiz, pin: snap.pin, ...handlers });
    Object.assign(g, { phase: snap.phase, qIndex: snap.qIndex, qStart: snap.qStart, reveal: snap.reveal });
    for (const p of snap.players) g.players.set(p.id, { ...p, connId: null, connected: false });
    const left = Math.max(0, snap.deadline - Date.now());
    if (g.phase === 'intro') g.setTimer(left, () => g.startQuestion());
    if (g.phase === 'question') g.setTimer(left, () => g.endQuestion());
    return g;
  }

  // ── Messages from phones ──────────────────────────────────────────────────
  handle(connId, msg, reply) {
    const player = this.players.get(this.byConn.get(connId));
    switch (msg.t) {
      case 'check':
        return reply(this.phase === 'podium' ? { error: 'err.finished' } : { ok: true, title: this.quiz.title });
      case 'join': return reply(this.join(connId, msg.name, msg.avatar, msg.gender));
      case 'rejoin': return reply(this.rejoin(connId, msg.playerId));
      case 'answer': return player && this.answer(player, msg.choice);
      case 'leave': return player && this.leave(player.id);
    }
  }

  connectionClosed(connId) {
    const p = this.players.get(this.byConn.get(connId));
    this.byConn.delete(connId);
    if (!p || p.connId !== connId) return;
    p.connected = false;
    p.connId = null;
    this.syncHost();
    if (this.phase === 'question') this.checkAllAnswered();
  }

  // ── Host controls ─────────────────────────────────────────────────────────
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
      case 'kick': {
        const p = this.players.get(arg);
        if (p?.connId) this.send(p.connId, { t: 'kicked' });
        this.leave(arg);
        break;
      }
    }
  }

  end(reason) {
    clearTimeout(this.timer);
    for (const p of this.players.values()) if (p.connId) this.send(p.connId, { t: 'ended', reason });
  }

  // ── Players ───────────────────────────────────────────────────────────────
  join(connId, rawName, avatar, gender) {
    const name = cleanName(rawName);
    if (!name) return { error: 'err.noName' };
    if (this.phase === 'podium') return { error: 'err.finished' };
    if (this.players.size >= MAX_PLAYERS) return { error: 'err.full' };
    for (const p of this.players.values()) {
      if (p.name.toLowerCase() === name.toLowerCase()) return { error: 'err.nameTaken' };
    }
    const player = {
      id: randomId(), name, avatar: Array.from(String(avatar || '🦉')).slice(0, 4).join(''),
      gender: ['m', 'f'].includes(gender) ? gender : null,
      score: 0, streak: 0, correct: 0, rank: 1, pos: this.players.size, prevPos: this.players.size,
      answer: null, result: null, connId: null, connected: false, joinedAt: Date.now(),
    };
    this.players.set(player.id, player);
    this.rankPlayers();
    player.prevPos = player.pos;
    this.bind(connId, player);
    return { ok: true, playerId: player.id };
  }

  rejoin(connId, playerId) {
    const p = this.players.get(playerId);
    if (!p) return { error: 'err.notFound' };
    this.bind(connId, p);
    return { ok: true, playerId: p.id };
  }

  bind(connId, p) {
    if (p.connId && p.connId !== connId) this.byConn.delete(p.connId);
    p.connId = connId;
    p.connected = true;
    this.byConn.set(connId, p.id);
    this.syncPlayer(p);
    this.syncHost();
  }

  leave(playerId) {
    const p = this.players.get(playerId);
    if (!p) return;
    this.players.delete(playerId);
    if (p.connId) this.byConn.delete(p.connId);
    this.rankPlayers();
    this.syncHost();
    if (this.phase === 'question') this.checkAllAnswered();
  }

  // ── Game flow ─────────────────────────────────────────────────────────────
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

  answer(p, choice) {
    if (this.phase !== 'question' || p.answer) return;
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
      const prevStreak = p.streak;
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
      p.result = {
        answered: !!p.answer, correct, points, streak: p.streak, ms: p.answer?.ms ?? null,
        lostStreak: !correct && prevStreak >= 2 ? prevStreak : 0,
        comeback: correct && this.qIndex > 0 && !!p.missedLast,
      };
      p.missedLast = !correct;
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

  // ── Views ─────────────────────────────────────────────────────────────────
  questionView(forHost) {
    if (!['intro', 'question', 'reveal'].includes(this.phase)) return null;
    const q = this.question;
    const reveal = this.phase === 'reveal';
    return {
      text: q.text, type: q.type, timeLimit: q.timeLimit, points: q.points,
      image: forHost ? q.imageUrl || '' : undefined,
      answers: q.answers.map(a => ({ text: a.text, correct: reveal ? a.correct : undefined })),
    };
  }

  hostView() {
    const players = this.ranked;
    return {
      pin: this.pin, joinUrl: JOIN_URL, title: this.quiz.title, emoji: this.quiz.emoji,
      phase: this.phase, qIndex: this.qIndex, total: this.total,
      remainingMs: Math.max(0, this.deadline - Date.now()),
      question: this.questionView(true),
      reveal: this.reveal,
      answeredCount: players.filter(p => p.answer).length,
      players: players.map(p => ({
        id: p.id, name: p.name, avatar: p.avatar, gender: p.gender, score: p.score, rank: p.rank, pos: p.pos, prevPos: p.prevPos,
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
      me: { id: p.id, name: p.name, avatar: p.avatar, gender: p.gender, score: p.score, rank: p.rank, streak: p.streak, correct: p.correct },
      question: this.questionView(false),
      answered: p.answer ? p.answer.choice : null,
      result: p.result,
      ahead: ahead && ahead.score > p.score ? { name: ahead.name, gap: ahead.score - p.score } : null,
    };
  }

  syncHost() { this.onChange(this.hostView(), this.snapshot()); }

  syncPlayer(p) {
    if (p.connId) this.send(p.connId, { t: 'state', s: this.playerView(p) });
  }

  syncAll() {
    this.syncHost();
    for (const p of this.players.values()) this.syncPlayer(p);
  }
}
