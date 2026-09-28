(() => {
  const app = $('#app');
  const SNAPSHOT = 'quizzle.game';
  let state = null;
  let screenKey = null;
  let cleanup = [];
  let knownPlayers = new Set();
  let game = null;
  let net = null;
  let quizzes = [];

  const keyOf = s => `${s.phase}:${s.qIndex}`;
  const later = (ms, fn) => { const id = setTimeout(fn, ms); cleanup.push(() => clearTimeout(id)); };
  const saveSnapshot = snap => { try { snap ? sessionStorage.setItem(SNAPSHOT, JSON.stringify(snap)) : sessionStorage.removeItem(SNAPSHOT); } catch { } };
  const loadSnapshot = () => { try { return JSON.parse(sessionStorage.getItem(SNAPSHOT)); } catch { return null; } };

  function go(key, html) {
    cleanup.forEach(f => f());
    cleanup = [];
    screenKey = key;
    app.innerHTML = html;
    app.scrollTop = 0;
  }

  function action(name, playerId) {
    if (!state || !game) return;
    Sound.sfx('click');
    if (name === 'next' && game.phase !== state.phase) return; // stale double-click
    game.hostAction(name, playerId);
  }

  function nextButton(label = 'Next ▶') {
    return `<button class="btn big primary next-btn" id="next">${label}</button>`;
  }
  function bindNext() {
    const b = $('#next');
    if (b) b.onclick = () => { b.disabled = true; action('next'); };
  }

  // ── Running a game ──────────────────────────────────────────────────────
  function render(view, snap) {
    state = view;
    saveSnapshot(snap);
    const screen = SCREENS[view.phase];
    if (keyOf(view) !== screenKey) screen.enter(view);
    else screen.update?.(view);
    updateControls();
  }

  /* Registers the PIN on the relay and wires the game to it. Retries a few times when
     restoring after a refresh, because the relay may still be holding the old PIN. */
  async function goOnline(pin, retries) {
    for (let i = 0; ; i++) {
      try {
        return await startHostPeer(pin, {
          onMessage: (connId, msg, reply) => game?.handle(connId, msg, reply),
          onClose: connId => game?.connectionClosed(connId),
        });
      } catch (err) {
        if (i >= retries || !['unavailable-id', 'network', 'server-error', 'socket-error', 'socket-closed'].includes(err.type)) throw err;
        await new Promise(r => setTimeout(r, 2500));
      }
    }
  }

  const handlers = {
    send: (connId, msg) => net?.send(connId, msg),
    onChange: render,
  };

  /* Downloads the quiz's pictures from the private repo so the big screen can show them. */
  async function withImages(quiz) {
    await Promise.all(quiz.questions.map(async q => {
      q.imageUrl = q.image ? await GitHub.imageUrl(q.image).catch(() => '') : '';
    }));
    return quiz;
  }

  async function createGame(quizId) {
    const found = quizzes.find(q => q.id === quizId);
    if (!found) return toast('That quiz could not be found.');
    Sound.sfx('pop');
    go('connecting', `<div class="center-msg"><div class="big-emoji wobble">📡</div><h1>Getting the game ready…</h1></div>`);
    const quiz = await withImages(structuredClone(found));
    for (let tries = 0; tries < 5; tries++) {
      const pin = String(100000 + Math.floor(Math.random() * 900000));
      try {
        net = await goOnline(pin, 1);
        game = new Game({ quiz, pin, ...handlers });
        game.syncHost();
        return;
      } catch (err) {
        if (err.type !== 'unavailable-id') { showOffline(err); return; }
      }
    }
    showOffline(new Error('Could not get a Game PIN.'));
  }

  async function resume(snap) {
    go('connecting', `<div class="center-msg"><div class="big-emoji wobble">📡</div><h1>Reconnecting your game…</h1><p>Game PIN ${esc(snap.pin)}</p></div>`);
    try {
      if (GitHub.token) await withImages(snap.quiz);
      net = await goOnline(snap.pin, 8);
      game = Game.restore(snap, handlers);
      game.syncHost();
    } catch (err) {
      saveSnapshot(null);
      toast('Could not bring back the last game. Start a new one!');
      showPicker();
    }
  }

  function endGame(reason = 'The host ended the game.') {
    game?.end(reason);
    const n = net;
    setTimeout(() => n?.destroy(), 400); // let the "ended" messages go out first
    game = net = state = null;
    saveSnapshot(null);
  }

  function showOffline(err) {
    console.error(err);
    go('offline', `
      <div class="center-msg">
        <div class="big-emoji">📶</div>
        <h1>Couldn't start the game</h1>
        <p>Check the internet connection and try again.</p>
        <button class="btn primary big" id="retry">Try again</button>
      </div>`);
    $('#retry').onclick = showPicker;
  }

  addEventListener('pagehide', () => net?.broadcast({ t: 'host-reload' }));
  addEventListener('beforeunload', e => {
    if (game && game.phase !== 'podium') e.preventDefault();
  });

  // ── Quiz picker ─────────────────────────────────────────────────────────
  function showLocked(error) {
    screenKey = 'locked';
    GitHub.showKeyForm(app, {
      title: '🔒 This Quizzle is private',
      intro: 'Only the quiz owner can host these games. Paste your GitHub key to unlock hosting on this device.',
      write: false,
      error,
      onConnected: showPicker,
    });
  }

  async function showPicker() {
    updateControls();
    Sound.music('lobby');
    if (!GitHub.token) return showLocked();
    go('picker', `
      <div class="picker">
        <header class="picker-head">${logoHtml('xl')}<p class="tagline">Pick a quiz and let's play!</p></header>
        <div class="quiz-grid"><div class="loading">Loading quizzes…</div></div>
        <a class="admin-link" href="admin.html">✏️ Create or edit quizzes</a>
      </div>`);
    try {
      quizzes = await GitHub.list();
    } catch (err) {
      if ([401, 403, 404].includes(err.status)) { GitHub.forget(); return showLocked(err.message); }
      quizzes = [];
      toast(err.message);
    }
    const grid = $('.quiz-grid');
    if (!grid || screenKey !== 'picker') return;
    grid.innerHTML = quizzes.length
      ? quizzes.map((q, i) => `
        <button class="quiz-card pop-in" style="animation-delay:${i * 70}ms;--c:${colorFor(q.title)}" data-id="${esc(q.id)}">
          <span class="qc-emoji">${esc(q.emoji)}</span>
          <span class="qc-title" dir="auto">${esc(q.title)}</span>
          <span class="qc-desc" dir="auto">${esc(q.description)}</span>
          <span class="qc-meta">${q.questions.length} question${q.questions.length === 1 ? '' : 's'}</span>
          <span class="qc-play">Play ▶</span>
        </button>`).join('')
      : `<div class="empty">No quizzes yet! <a href="admin.html">Make your first one →</a></div>`;
    grid.onclick = e => {
      const card = e.target.closest('.quiz-card');
      if (card) createGame(card.dataset.id);
    };
    const auto = new URLSearchParams(location.search).get('quiz');
    if (auto) {
      history.replaceState(null, '', location.pathname);
      createGame(auto);
    }
  }

  // ── Shared bits ─────────────────────────────────────────────────────────
  function qrSvg(text) {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    return qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  }

  function tile(q, i, a, extra = '') {
    const st = answerStyle(q.type, i);
    return `<div class="tile ${st.cls} ${extra} pop-in" style="animation-delay:${i * 90}ms">
      <span class="shape">${st.shape}</span><span class="txt" dir="auto">${esc(a.text)}</span>
      ${extra === 'correct' ? '<span class="tick">✔</span>' : ''}</div>`;
  }

  function pointsBadge(q) {
    if (q.points === 2) return '<div class="badge double">⭐ Double points! ⭐</div>';
    if (q.points === 0) return '<div class="badge nopoints">🎈 Just for fun: no points</div>';
    return '';
  }

  function media(q, s) {
    return q.image
      ? `<img class="q-img zoom-in" src="${esc(q.image)}" alt="">`
      : `<div class="mascot">${esc(s.emoji || '🦉')}</div>`;
  }

  // ── Screens ─────────────────────────────────────────────────────────────
  const SCREENS = {
    lobby: {
      enter(s) {
        Sound.music('lobby');
        knownPlayers = new Set(s.players.map(p => p.id));
        const url = s.joinUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
        go(keyOf(s), `
          <div class="lobby">
            <div class="join-panel slide-down">
              <div class="join-info">
                <div class="join-step">📱 Go to <b>${esc(url)}</b></div>
                <div class="join-step">🔢 Game PIN:</div>
                <div class="pin">${s.pin.slice(0, 3)}&thinsp;${s.pin.slice(3)}</div>
              </div>
              <div class="qr" title="Scan to join">${qrSvg(`${s.joinUrl}?pin=${s.pin}`)}</div>
            </div>
            <div class="lobby-bar">
              <div class="player-count"><span class="n">0</span><small>players</small></div>
              <div class="lobby-title" dir="auto">${esc(s.emoji)} ${esc(s.title)}</div>
              <button class="btn big primary" id="start">Start ▶</button>
            </div>
            <div class="player-cloud"></div>
            <div class="lobby-empty">Waiting for players<span class="dots"><i>.</i><i>.</i><i>.</i></span></div>
          </div>`);
        $('#start').onclick = () => { $('#start').disabled = true; Sound.sfx('start'); action('start'); };
        $('.player-cloud').onclick = e => {
          const chip = e.target.closest('.player-chip');
          if (chip && confirm(`Remove "${chip.dataset.name}" from the game?`)) action('kick', chip.dataset.id);
        };
        this.update(s);
      },
      update(s) {
        const cloud = $('.player-cloud');
        const ids = new Set(s.players.map(p => p.id));
        $$('.player-chip', cloud).forEach(el => {
          if (ids.has(el.dataset.id)) return;
          el.removeAttribute('data-id');
          el.classList.add('pop-out');
          setTimeout(() => el.remove(), 350);
        });
        for (const p of s.players) {
          let el = cloud.querySelector(`[data-id="${p.id}"]`);
          if (!el) {
            el = document.createElement('button');
            el.className = 'player-chip pop-in';
            el.dataset.id = p.id;
            el.dataset.name = p.name;
            el.style.setProperty('--c', colorFor(p.name));
            el.innerHTML = `<span class="av">${esc(p.avatar)}</span><span class="nm" dir="auto">${esc(p.name)}</span><span class="x">✕</span>`;
            cloud.append(el);
            if (!knownPlayers.has(p.id)) Sound.sfx('pop');
            knownPlayers.add(p.id);
          }
          el.classList.toggle('offline', !p.connected);
        }
        const n = $('.player-count .n');
        if (n.textContent !== String(s.players.length)) { n.textContent = s.players.length; bump(n); }
        $('#start').disabled = !s.players.length;
        $('.lobby-empty').hidden = s.players.length > 0;
      },
    },

    intro: {
      enter(s) {
        Sound.stopMusic(0.3);
        Sound.sfx('whoosh');
        const q = s.question;
        go(keyOf(s), `
          <div class="intro">
            <div class="intro-count bounce-in">Question ${s.qIndex + 1} <small>of ${s.total}</small></div>
            <h1 class="intro-text zoom-in" dir="auto">${esc(q.text)}</h1>
            ${pointsBadge(q)}
            <div class="intro-bar"><div style="animation-duration:${s.remainingMs}ms"></div></div>
          </div>`);
      },
    },

    question: {
      enter(s) {
        Sound.music('question');
        const q = s.question;
        const limit = q.timeLimit * 1000;
        const deadline = performance.now() + s.remainingMs;
        go(keyOf(s), `
          <div class="qscreen ${q.image ? 'has-img' : ''}">
            <div class="q-top"><h1 class="q-text slide-down" dir="auto">${esc(q.text)}</h1></div>
            <div class="q-mid">
              <div class="timer"><svg viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="44"/><circle class="prog" cx="50" cy="50" r="44"/></svg><span class="num">${q.timeLimit}</span></div>
              <div class="q-media">${media(q, s)}</div>
              <div class="answered"><span class="n">0</span><small>answers</small></div>
            </div>
            <div class="answers n${q.answers.length}">${q.answers.map((a, i) => tile(q, i, a)).join('')}</div>
            <button class="btn dark skip" id="next">Skip ⏭</button>
          </div>`);
        bindNext();
        const timer = $('.timer'), ring = $('.timer .prog'), num = $('.timer .num');
        const C = 2 * Math.PI * 44;
        ring.style.strokeDasharray = C;
        let lastSec = null, raf;
        const loop = () => {
          const left = Math.max(0, deadline - performance.now());
          const sec = Math.ceil(left / 1000);
          ring.style.strokeDashoffset = C * (1 - left / limit);
          if (sec !== lastSec) {
            num.textContent = sec;
            if (lastSec !== null && sec <= 5 && sec > 0) { Sound.sfx('tick'); bump(num, 'beat'); }
            timer.classList.toggle('urgent', sec <= 5);
            lastSec = sec;
          }
          if (left > 0) raf = requestAnimationFrame(loop);
        };
        loop();
        cleanup.push(() => cancelAnimationFrame(raf));
        this.update(s);
      },
      update(s) {
        const n = $('.answered .n');
        if (n && n.textContent !== String(s.answeredCount)) {
          n.textContent = s.answeredCount;
          bump(n);
          if (s.answeredCount) Sound.sfx('click');
        }
      },
    },

    reveal: {
      enter(s) {
        Sound.stopMusic(0.15);
        Sound.sfx('gong');
        later(350, () => Sound.sfx('reveal'));
        const q = s.question, r = s.reveal;
        const max = Math.max(1, ...r.counts);
        const got = s.players.filter(p => p.result?.correct).length;
        const cheer = s.players.length && got === s.players.length ? '🎉 Everyone got it right! 🎉'
          : got === 0 ? '😮 Tricky one! Nobody got it.'
            : `🎯 ${got} of ${s.players.length} got it right!`;
        go(keyOf(s), `
          <div class="qscreen reveal">
            <div class="q-top"><h1 class="q-text" dir="auto">${esc(q.text)}</h1></div>
            <div class="q-mid">
              <div class="chart">${q.answers.map((a, i) => {
                const st = answerStyle(q.type, i);
                return `<div class="bar-col ${a.correct ? 'correct' : 'wrong'}">
                  <div class="bar-num" style="animation-delay:${600 + i * 120}ms">${r.counts[i]}</div>
                  <div class="bar ${st.cls}" style="--h:${(r.counts[i] / max) * 100}%;animation-delay:${i * 120}ms"></div>
                  <div class="bar-foot ${st.cls}"><span class="shape">${st.shape}</span>${a.correct ? '<span class="tick">✔</span>' : ''}</div>
                </div>`;
              }).join('')}</div>
            </div>
            <div class="answers n${q.answers.length}">${q.answers.map((a, i) => tile(q, i, a, a.correct ? 'correct' : 'dim')).join('')}</div>
            <div class="reveal-foot"><div class="reveal-summary bounce-in">${cheer}</div>${nextButton(s.qIndex + 1 >= s.total ? 'Winners 🏆' : 'Next ▶')}</div>
          </div>`);
        bindNext();
        if (got && got === s.players.length) later(500, () => confetti({ count: 120 }));
      },
    },

    scoreboard: {
      enter(s) {
        Sound.music('lobby');
        const top = s.players.slice(0, 5);
        const ROW = 84;
        const before = [...top].sort((a, b) => a.prevPos - b.prevPos);
        go(keyOf(s), `
          <div class="scoreboard">
            <h1 class="sb-title bounce-in">🏅 Scoreboard</h1>
            <div class="sb-list" style="height:${top.length * ROW}px">
              ${before.map((p, i) => `
                <div class="sb-row slide-in" data-id="${p.id}" style="top:${i * ROW}px;animation-delay:${i * 90}ms;--c:${colorFor(p.name)}">
                  <span class="sb-rank">${p.rank}</span>
                  <span class="sb-av">${esc(p.avatar)}</span>
                  <span class="sb-name" dir="auto">${esc(p.name)}</span>
                  ${p.streak >= 2 ? `<span class="streak">🔥 ${p.streak}</span>` : ''}
                  <span class="sb-score">${(p.score - (p.result?.points || 0)).toLocaleString()}</span>
                </div>`).join('')}
            </div>
            <div class="sb-foot">${nextButton()}</div>
          </div>`);
        bindNext();
        later(900, () => {
          top.forEach((p, i) => {
            const row = $(`.sb-row[data-id="${p.id}"]`);
            row.style.top = `${i * ROW}px`;
            const from = p.score - (p.result?.points || 0);
            if (p.score !== from) { countUp($('.sb-score', row), from, p.score, 1100); row.classList.add('gained'); }
          });
          Sound.sfx('coin');
        });
      },
    },

    podium: {
      enter(s) {
        Sound.stopMusic(0.3);
        const [p1, p2, p3] = s.players;
        const place = (p, n) => `
          <div class="place place-${n}">
            ${p ? `<div class="pl-player">
              <div class="pl-av">${esc(p.avatar)}</div>
              <div class="pl-name" dir="auto">${esc(p.name)}</div>
              <div class="pl-score">${p.score.toLocaleString()} pts · ${p.correct}/${s.total} ✔</div>
            </div>` : '<div class="pl-player"></div>'}
            <div class="pl-block"><span class="medal">${['🥇', '🥈', '🥉'][n - 1]}</span></div>
          </div>`;
        go(keyOf(s), `
          <div class="podium-screen">
            <h1 class="pd-title bounce-in" dir="auto">${esc(s.emoji)} ${esc(s.title)}</h1>
            <div class="podium">${place(p2, 2)}${place(p1, 1)}${place(p3, 3)}</div>
            <div class="pd-actions" hidden>
              <button class="btn" id="results">📋 All results</button>
              <button class="btn primary big" id="again">🔁 Play again</button>
            </div>
          </div>`);
        const show = n => { $(`.place-${n}`).classList.add('show'); Sound.sfx('pop'); };
        later(300, () => Sound.sfx('drumroll', 4.3));
        later(800, () => $('.place-3').classList.add('rise'));
        later(1200, () => $('.place-2').classList.add('rise'));
        later(1600, () => $('.place-1').classList.add('rise'));
        if (p3) later(1900, () => show(3));
        if (p2) later(3000, () => show(2));
        later(4600, () => {
          if (p1) show(1);
          Sound.sfx('fanfare');
          Sound.sfx('cheer');
          confetti({ count: 220, mode: 'cannon' });
          later(1200, () => confetti({ count: 160 }));
        });
        later(6200, () => {
          Sound.music('victory');
          $('.pd-actions').hidden = false;
        });
        $('#again').onclick = () => {
          endGame('Thanks for playing! 🎉');
          showPicker();
        };
        $('#results').onclick = () => showResults(s);
      },
    },
  };

  function showResults(s) {
    const modal = document.createElement('div');
    modal.className = 'modal-bg';
    modal.innerHTML = `
      <div class="modal pop-in">
        <h2>📋 Final results</h2>
        <table class="results">
          <thead><tr><th>#</th><th>Player</th><th>Correct</th><th>Score</th></tr></thead>
          <tbody>${s.players.map(p => `<tr><td>${p.rank}</td><td>${esc(p.avatar)} ${esc(p.name)}</td><td>${p.correct}/${s.total}</td><td>${p.score.toLocaleString()}</td></tr>`).join('')}</tbody>
        </table>
        <button class="btn primary">Close</button>
      </div>`;
    modal.onclick = e => { if (e.target === modal || e.target.matches('.btn')) modal.remove(); };
    document.body.append(modal);
  }

  // ── Top-right controls ──────────────────────────────────────────────────
  function setupControls() {
    const c = $('#controls');
    c.innerHTML = `
      <button class="ctl unlock" id="c-unlock" title="Enable sound">🔈 Tap for sound</button>
      <button class="ctl" id="c-music" title="Music on/off">🎵</button>
      <button class="ctl" id="c-sound" title="Sound on/off">🔊</button>
      <button class="ctl" id="c-full" title="Full screen">⛶</button>
      <button class="ctl" id="c-end" title="End game" hidden>✖</button>`;
    const paint = () => {
      $('#c-music').classList.toggle('off', !Sound.musicOn);
      $('#c-sound').classList.toggle('off', !Sound.soundOn);
      $('#c-sound').textContent = Sound.soundOn ? '🔊' : '🔇';
    };
    $('#c-music').onclick = () => { Sound.toggleMusic(); paint(); };
    $('#c-sound').onclick = () => { Sound.toggleSound(); paint(); };
    $('#c-full').onclick = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.();
    $('#c-end').onclick = () => {
      if (!confirm('End this game for everyone?')) return;
      endGame();
      showPicker();
    };
    $('#c-unlock').onclick = () => Sound.init();
    Sound.onReady(() => $('#c-unlock').remove());
    paint();
  }

  function updateControls() {
    const end = $('#c-end');
    if (end) end.hidden = !state || state.phase === 'podium';
  }

  bgBubbles();
  setupControls();
  const snap = loadSnapshot();
  if (snap) resume(snap); else showPicker();
})();
