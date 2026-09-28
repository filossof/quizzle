(() => {
  const app = $('#app');
  const SESSION = 'quizzle.player';
  let state = null;
  let screenKey = null;
  let cleanup = [];
  let session = load();
  let pinFromUrl = new URLSearchParams(location.search).get('pin') || '';
  let myAvatar = pick(AVATARS);
  let wakeLock = null;

  function load() { try { return JSON.parse(localStorage.getItem(SESSION)); } catch { return null; } }
  function save(v) {
    session = v;
    try { v ? localStorage.setItem(SESSION, JSON.stringify(v)) : localStorage.removeItem(SESSION); } catch { }
  }
  const buzz = pattern => navigator.vibrate?.(pattern);
  const later = (ms, fn) => { const id = setTimeout(fn, ms); cleanup.push(() => clearTimeout(id)); };
  const keyOf = s => `${s.phase}:${s.qIndex}${s.phase === 'question' && s.answered !== null ? ':a' : ''}`;

  function go(key, html, mood = '') {
    cleanup.forEach(f => f());
    cleanup = [];
    screenKey = key;
    document.body.dataset.mood = mood;
    app.innerHTML = html;
  }

  async function keepAwake() {
    try { if (!wakeLock && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch { }
    wakeLock?.addEventListener?.('release', () => { wakeLock = null; });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && state) keepAwake(); });

  // ── Connection ──────────────────────────────────────────────────────────
  const link = new PlayerLink({ onMessage, onStatus });

  function onMessage(msg) {
    if (msg.t === 'state') {
      const prev = state;
      state = msg.s;
      const screen = SCREENS[state.phase];
      if (keyOf(state) !== screenKey) screen.enter(state, prev);
      else screen.update?.(state);
    } else if (msg.t === 'kicked') {
      leaveGame();
      go('kicked', `
        <div class="p-center">
          <div class="big-emoji wobble">🙈</div>
          <h1>${t('p.kicked')}</h1>
          <button class="btn big dark" id="again">${t('p.joinAgain')}</button>
        </div>`);
      $('#again').onclick = () => showPin();
    } else if (msg.t === 'ended') {
      const wasPodium = state?.phase === 'podium';
      leaveGame();
      if (wasPodium) return;
      go('ended', `
        <div class="p-center">
          <div class="big-emoji">👋</div>
          <h1 dir="auto">${esc(t(msg.reason))}</h1>
          <p>${t('p.thanks')}</p>
          <button class="btn big dark" id="again">${t('p.joinNew')}</button>
        </div>`);
      $('#again').onclick = () => showPin();
    }
  }

  function onStatus(status) {
    $('#net-status').hidden = status !== 'reconnecting' || !session;
    if (status === 'gone' && session) {
      go('lost', `
        <div class="p-center">
          <div class="big-emoji">📶</div>
          <h1>${t('p.lostTitle')}</h1>
          <p>${t('p.lostText')}</p>
          <button class="btn big dark" id="retry">${t('p.reconnect')}</button>
          <button class="link-btn" id="new">${t('p.joinOther')}</button>
        </div>`);
      $('#retry').onclick = resumeSession;
      $('#new').onclick = () => { leaveGame(); showPin(); };
    }
  }

  function leaveGame() {
    save(null);
    state = null;
    link.disconnect();
  }

  link.onReconnect = async () => {
    if (!session) return;
    const res = await link.request({ t: 'rejoin', playerId: session.playerId });
    if (res?.ok) return;
    const hadGame = !!state;
    leaveGame();
    if (hadGame) toast(t('p.gameEnded'));
    showPin();
  };

  async function resumeSession() {
    go('resume', `<div class="p-center"><div class="big-emoji wobble">📡</div><h1>${t('p.resuming')}</h1></div>`);
    try {
      await link.connect(session.pin);
      await link.onReconnect();
    } catch {
      leaveGame();
      showPin();
    }
  }

  // ── Joining ─────────────────────────────────────────────────────────────
  function showPin(error) {
    go('join-pin', `
      <div class="join">
        ${logoHtml('xl')}
        <form class="join-card pop-in" id="pinForm" autocomplete="off">
          <input id="pin" inputmode="numeric" pattern="[0-9 ]*" maxlength="7" placeholder="${t('p.pin')}" aria-label="${t('p.pin')}" dir="ltr">
          <button class="btn big dark">${t('p.enter')}</button>
          <div class="form-error" role="alert"></div>
        </form>
        <p class="join-hint">${t('p.hint')}</p>
        ${langButton('link-btn')}
      </div>`);
    const form = $('#pinForm'), input = $('#pin'), btn = form.querySelector('.btn');
    const fail = msg => {
      $('.form-error').textContent = msg;
      bump(form, 'shake');
      buzz([60, 40, 60]);
    };
    form.onsubmit = async e => {
      e.preventDefault();
      const pin = input.value.replace(/\D/g, '');
      if (pin.length !== 6) return fail(t('p.pinLen'));
      btn.disabled = true;
      btn.textContent = t('p.connecting');
      try {
        await link.connect(pin);
        const res = await link.request({ t: 'check' });
        if (!res?.ok) throw new Error(t(res?.error || 'p.oops'));
        showName(pin, res.title);
      } catch (err) {
        link.disconnect();
        btn.disabled = false;
        btn.textContent = t('p.enter');
        fail(err.message === 'no-game' ? t('p.noGame')
          : err.message === 'timeout' || err.type ? t('p.noNet') : err.message);
      }
    };
    if (error) fail(error);
    if (pinFromUrl) {
      input.value = pinFromUrl;
      pinFromUrl = '';
      form.requestSubmit();
    } else {
      input.focus();
    }
  }

  function showName(pin, title) {
    go('join-name', `
      <div class="join">
        ${logoHtml()}
        <form class="join-card name-card pop-in" id="nameForm" autocomplete="off">
          <div class="join-title" dir="auto">${esc(title)}</div>
          <div class="avatar-preview bounce">${myAvatar}</div>
          <div class="name-row">
            <input id="name" dir="auto" maxlength="16" placeholder="${t('p.nickname')}" aria-label="${t('p.nickname')}" autocapitalize="words" spellcheck="false">
            <button type="button" class="dice" title="${t('p.randomName')}">🎲</button>
          </div>
          <div class="avatars">${AVATARS.map(a => `<button type="button" class="av-opt ${a === myAvatar ? 'sel' : ''}" data-av="${a}">${a}</button>`).join('')}</div>
          <button class="btn big dark">${t('p.go')}</button>
          <div class="form-error" role="alert"></div>
        </form>
        <button class="link-btn" id="back">${t('p.back')}</button>
      </div>`);
    const form = $('#nameForm'), input = $('#name');
    input.focus();
    $('#back').onclick = () => { link.disconnect(); showPin(); };
    $('.dice').onclick = () => {
      input.value = t('p.randomNames');
      bump($('.dice'), 'spin');
      Sound.sfx('pop');
    };
    $('.avatars').onclick = e => {
      const b = e.target.closest('.av-opt');
      if (!b) return;
      myAvatar = b.dataset.av;
      $$('.av-opt').forEach(x => x.classList.toggle('sel', x === b));
      const prev = $('.avatar-preview');
      prev.textContent = myAvatar;
      bump(prev, 'boing');
      Sound.sfx('pop');
    };
    form.onsubmit = e => {
      e.preventDefault();
      const name = input.value.trim();
      const fail = msg => { $('.form-error').textContent = msg; bump(form, 'shake'); buzz([60, 40, 60]); };
      if (!name) return fail(t('p.needName'));
      form.querySelector('.btn').disabled = true;
      link.request({ t: 'join', name, avatar: myAvatar }).then(res => {
        form.querySelector('.btn').disabled = false;
        if (!res?.ok) return fail(t(res?.error || 'p.joinFail'));
        save({ pin, playerId: res.playerId });
        Sound.sfx('correct');
        keepAwake();
      });
    };
  }

  // ── Game screens ────────────────────────────────────────────────────────
  const foot = s => `
    <div class="p-foot">
      <span class="pf-me"><span class="pf-av">${esc(s.me.avatar)}</span><span dir="auto">${esc(s.me.name)}</span></span>
      <button class="pf-sound" title="${t('sound')}">${Sound.soundOn ? '🔊' : '🔇'}</button>
      <span class="pf-score">${s.me.score.toLocaleString()}</span>
    </div>`;
  const head = s => `<div class="p-head"><span>${s.qIndex >= 0 ? t('p.qOf', { n: s.qIndex + 1, total: s.total }) : `<span dir="auto">${esc(s.title)}</span>`}</span><span class="p-timer"></span></div>`;

  function rankLine(s) {
    if (s.me.rank === 1) return t('p.first');
    let line = t('p.place', { n: s.me.rank });
    if (s.ahead) line += `<br><small>${t('p.behind', { gap: s.ahead.gap.toLocaleString(), name: `<span dir="auto">${esc(s.ahead.name)}</span>` })}</small>`;
    return line;
  }

  const SCREENS = {
    lobby: {
      enter(s) {
        go(keyOf(s), `
          ${head(s)}
          <div class="p-center">
            <div class="big-av bounce">${esc(s.me.avatar)}</div>
            <h1 class="pop-in">${t('p.youreIn')}</h1>
            <p>${t('p.seeName')}</p>
            <div class="wait-shapes">${SHAPES.map((sh, i) => `<span class="${ANSWER_CLASSES[i]}" style="animation-delay:${i * 150}ms">${sh}</span>`).join('')}</div>
            <p class="muted"><span class="pcount">${s.playerCount}</span> ${t('p.ready')}</p>
          </div>
          ${foot(s)}`);
      },
      update(s) {
        const n = $('.pcount');
        if (n) n.textContent = s.playerCount;
      },
    },

    intro: {
      enter(s) {
        Sound.sfx('whoosh');
        buzz(30);
        go(keyOf(s), `
          ${head(s)}
          <div class="p-center">
            <div class="p-qnum bounce-in">${t('p.qNum', { n: s.qIndex + 1 })}</div>
            <div class="p-qtext zoom-in" dir="auto">${esc(s.question.text)}</div>
            ${s.question.points === 2 ? `<div class="badge double">${t('p.double')}</div>` : ''}
            <div class="wait-shapes spin">${SHAPES.map((sh, i) => `<span class="${ANSWER_CLASSES[i]}">${sh}</span>`).join('')}</div>
            <p>${t('p.getReady')}</p>
          </div>
          ${foot(s)}`);
      },
    },

    question: {
      enter(s) {
        if (s.answered !== null) return showAnswered(s, s.answered);
        const q = s.question;
        const deadline = performance.now() + s.remainingMs;
        go(keyOf(s), `
          ${head(s)}
          <div class="p-qtext small" dir="auto">${esc(q.text)}</div>
          <div class="p-answers n${q.answers.length}">
            ${q.answers.map((a, i) => {
              const st = answerStyle(q.type, i);
              return `<button class="p-ans ${st.cls} pop-in" style="animation-delay:${i * 70}ms" data-i="${i}">
                <span class="shape">${st.shape}</span><span class="txt" dir="auto">${esc(a.text)}</span></button>`;
            }).join('')}
          </div>
          ${foot(s)}`);
        const timerEl = $('.p-timer');
        const iv = setInterval(() => {
          const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
          timerEl.textContent = `⏱ ${left}`;
          timerEl.classList.toggle('urgent', left <= 5);
          if (!left) clearInterval(iv);
        }, 200);
        cleanup.push(() => clearInterval(iv));
        $('.p-answers').onclick = e => {
          const b = e.target.closest('.p-ans');
          if (!b) return;
          const choice = Number(b.dataset.i);
          buzz(40);
          link.send({ t: 'answer', choice });
          showAnswered({ ...state, answered: choice }, choice);
        };
      },
    },

    reveal: {
      enter(s) {
        const r = s.result || { answered: false, correct: false, points: 0, streak: 0 };
        const q = s.question;
        const right = q.answers.filter(a => a.correct).map(a => a.text).join(' / ');
        let mood, html;
        if (r.correct) {
          mood = 'good';
          Sound.sfx('correct');
          buzz([50, 50, 120]);
          html = `
            <div class="result-icon pop-big">✔</div>
            <h1 class="result-title">${t('p.correct')}</h1>
            <div class="points">+<span class="pts">0</span></div>
            ${r.streak >= 2 ? `<div class="streak-pill wobble">${t('p.streak', { n: r.streak })}</div>` : ''}`;
          later(300, () => confetti({ count: 70 }));
        } else if (r.answered) {
          mood = 'bad';
          Sound.sfx('wrong');
          buzz([150]);
          html = `
            <div class="result-icon pop-big">✖</div>
            <h1 class="result-title">${t('p.wrong')}</h1>
            <p class="answer-was">${t('p.answerWas')} <b dir="auto">${esc(right)}</b></p>
            <p>${t('p.cheer')}</p>`;
        } else {
          mood = 'late';
          Sound.sfx('timeout');
          html = `
            <div class="result-icon pop-big">⏰</div>
            <h1 class="result-title">${t('p.timeUp')}</h1>
            <p class="answer-was">${t('p.answerWas')} <b dir="auto">${esc(right)}</b></p>
            <p>${t('p.beQuick')}</p>`;
        }
        go(keyOf(s), `
          ${head(s)}
          <div class="p-center">${html}<div class="rank-line slide-up">${rankLine(s)}</div></div>
          ${foot(s)}`, mood);
        if (r.correct) countUp($('.pts'), 0, r.points, 900);
      },
    },

    scoreboard: {
      enter(s) {
        go(keyOf(s), `
          ${head(s)}
          <div class="p-center">
            <div class="rank-badge pop-big" style="--c:${colorFor(s.me.name)}">${s.me.rank}</div>
            <h1>${rankLine(s)}</h1>
            <p class="muted">${t('p.lookScreen')}</p>
          </div>
          ${foot(s)}`);
      },
    },

    podium: {
      enter(s) {
        go(keyOf(s), `
          <div class="p-center">
            <div class="big-emoji drum">🥁</div>
            <h1>${t('p.drumroll')}</h1>
          </div>`);
        later(4700, () => {
          const rank = s.me.rank;
          const top = rank <= 3;
          const medals = { 1: '🏆', 2: '🥈', 3: '🥉' };
          go(keyOf(s), `
            <div class="p-center">
              <div class="big-emoji pop-big">${top ? medals[rank] : '🌟'}</div>
              <h1 class="result-title">${rank === 1 ? t('p.won') : top ? t('p.topPlace', { n: rank }) : t('p.finished', { n: rank })}</h1>
              <p class="big-score">${t('p.points', { n: s.me.score.toLocaleString() })}</p>
              <p>${t('p.gotRight', { c: s.me.correct, total: s.total })} ${top ? '' : t('p.greatGame')}</p>
              <button class="btn big dark" id="again">${t('p.playAnother')}</button>
            </div>`, top ? 'good' : '');
          $('#again').onclick = () => {
            link.send({ t: 'leave' });
            leaveGame();
            showPin();
          };
          if (top) {
            Sound.sfx('fanfare');
            confetti({ count: 200, mode: 'cannon' });
            buzz([100, 60, 100, 60, 250]);
          } else {
            Sound.sfx('reveal');
            confetti({ count: 60 });
          }
        });
      },
    },
  };

  function showAnswered(s, choice) {
    const st = answerStyle(s.question.type, choice);
    Sound.sfx('lock');
    go(keyOf(s), `
      ${head(s)}
      <div class="p-center">
        <div class="chosen ${st.cls} pop-big"><span class="shape">${st.shape}</span></div>
        <h1>${t('p.locked')}</h1>
        <p>${t('p.waitLines')}</p>
        <div class="dots-loader"><i></i><i></i><i></i></div>
      </div>
      ${foot(s)}`);
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('.pf-sound, #p-sound');
    if (!b) return;
    Sound.toggleSound();
    $$('.pf-sound, #p-sound').forEach(x => { x.textContent = Sound.soundOn ? '🔊' : '🔇'; });
  });

  $('#p-sound').textContent = Sound.soundOn ? '🔊' : '🔇';
  $('#net-status').textContent = t('net.reconnecting');
  bgBubbles(10);
  if (session) resumeSession(); else showPin();
})();
