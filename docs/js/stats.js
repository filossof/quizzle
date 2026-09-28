/* The owner's stats page: who signed up, who's active, quizzes made and games hosted.
   The database only lets the Quizzle owner read this data. */
(() => {
  const app = $('#app');
  const DAY = 86400000, WEEK = 7 * DAY, WEEKS = 12;
  const nf = new Intl.NumberFormat(LANG);
  const rtf = new Intl.RelativeTimeFormat(LANG, { numeric: 'auto' });

  function ago(ms) {
    if (!ms) return t('s.never');
    const diff = ms - Date.now();
    const abs = Math.abs(diff);
    if (abs < 90000) return t('s.justNow');
    if (abs >= 30 * DAY) {
      // Months are phrased by hand: some browsers add a stray "(2)" to the Hebrew "two months ago".
      const n = Math.round(abs / (30 * DAY));
      return t('s.monthsAgo', { n });
    }
    const [unit, size] = abs < 3600000 ? ['minute', 60000] : abs < DAY ? ['hour', 3600000] : ['day', DAY];
    return rtf.format(Math.round(diff / size), unit);
  }
  const shortDate = ms => new Date(ms).toLocaleDateString(LANG === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'numeric' });

  /* Start of the week (Sunday) for a time, used to bucket sign-ups and games. */
  function weekStart(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - d.getDay());
    return d.getTime();
  }
  function weekly(times) {
    const first = weekStart(Date.now()) - (WEEKS - 1) * WEEK;
    const buckets = Array.from({ length: WEEKS }, (_, i) => ({ start: first + i * WEEK, value: 0 }));
    for (const ms of times) {
      const i = Math.round((weekStart(ms) - first) / WEEK);
      if (i >= 0 && i < WEEKS) buckets[i].value++;
    }
    return buckets;
  }

  /* A single-series column chart (inline SVG) with a hover tooltip per week. */
  function columnChart(id, title, buckets, tipKey) {
    const W = 560, H = 200, padL = 30, padB = 26, padT = 18;
    const max = Math.max(1, ...buckets.map(b => b.value));
    const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
    const top = Math.ceil(max / step) * step;
    const y = v => padT + (H - padT - padB) * (1 - v / top);
    const band = (W - padL) / buckets.length;
    const barW = Math.min(24, band * 0.6);
    const ticks = [];
    for (let v = 0; v <= top; v += step) ticks.push(v);
    const bar = (b, i) => {
      const x = padL + i * band + (band - barW) / 2;
      const h = y(0) - y(b.value);
      const r = Math.min(4, h);
      // Rounded top (data end), square at the baseline.
      const path = b.value ? `M${x},${y(0)} V${y(b.value) + r} Q${x},${y(b.value)} ${x + r},${y(b.value)} H${x + barW - r} Q${x + barW},${y(b.value)} ${x + barW},${y(b.value) + r} V${y(0)} Z` : '';
      return `<g class="col" data-tip="${esc(t(tipKey, { n: b.value, date: shortDate(b.start) }))}">
        <rect class="hit" x="${padL + i * band}" y="${padT}" width="${band}" height="${H - padT - padB}"/>
        ${path ? `<path class="bar" d="${path}"/>` : ''}
        ${b.value ? `<text class="val" x="${x + barW / 2}" y="${y(b.value) - 5}">${b.value}</text>` : ''}
        ${i % 2 === (buckets.length - 1) % 2 ? `<text class="xl" x="${x + barW / 2}" y="${H - 8}">${shortDate(b.start)}</text>` : ''}
      </g>`;
    };
    return `
      <section class="s-card chart-card">
        <h2>${title}</h2>
        <div class="chart-wrap" dir="ltr" id="${id}">
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}: ${buckets.map(b => `${shortDate(b.start)} ${b.value}`).join(', ')}">
            ${ticks.map(v => `<line class="grid" x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text class="yl" x="${padL - 6}" y="${y(v) + 4}">${v}</text>`).join('')}
            ${buckets.map(bar).join('')}
          </svg>
          <div class="chart-tip" hidden></div>
        </div>
      </section>`;
  }

  function bindTips(root) {
    root.querySelectorAll('.chart-wrap').forEach(wrap => {
      const tip = wrap.querySelector('.chart-tip');
      wrap.addEventListener('pointermove', e => {
        const g = e.target.closest('.col');
        wrap.querySelectorAll('.col.on').forEach(x => x !== g && x.classList.remove('on'));
        if (!g) { tip.hidden = true; return; }
        g.classList.add('on');
        tip.textContent = g.dataset.tip;
        tip.hidden = false;
        const box = wrap.getBoundingClientRect();
        tip.style.left = `${Math.min(box.width - tip.offsetWidth, Math.max(0, e.clientX - box.left - tip.offsetWidth / 2))}px`;
        tip.style.top = `${e.clientY - box.top - tip.offsetHeight - 12}px`;
      });
      wrap.addEventListener('pointerleave', () => { tip.hidden = true; wrap.querySelectorAll('.col.on').forEach(x => x.classList.remove('on')); });
    });
  }

  function tile(label, value, cls = '') {
    return `<div class="s-tile ${cls}"><div class="s-num">${nf.format(value)}</div><div class="s-label">${label}</div></div>`;
  }

  function avatar(u) {
    return u.photo ? `<img class="s-av" src="${esc(u.photo)}" alt="" referrerpolicy="no-referrer">` : `<span class="s-av s-av-empty">👤</span>`;
  }

  async function render() {
    app.innerHTML = `<div class="admin"><header class="a-top">${logoHtml('sm')}<span class="a-sub">${t('s.title')}</span><div class="grow"></div>
      <a class="btn small" href="admin.html">${t('s.back')}</a>${langButton('btn small')}${userChip()}</header>
      <main class="a-main"><div class="loading">${t('a.loading')}</div></main></div>`;
    let data;
    try {
      data = await Store.adminData();
    } catch (err) {
      console.error(err);
      $('.a-main').innerHTML = `<div class="center-msg" style="min-height:50vh"><div class="big-emoji">🔒</div><h1>${t('s.onlyOwner')}</h1></div>`;
      return;
    }

    // People: profiles, plus anyone who made quizzes before profiles existed.
    const people = new Map(data.users.map(u => [u.uid, { ...u, quizzes: [], games: [] }]));
    for (const q of data.quizzes) {
      if (!people.has(q.owner)) people.set(q.owner, { uid: q.owner, name: t('s.unknown'), unknown: true, quizzes: [], games: [] });
      people.get(q.owner).quizzes.push(q);
    }
    for (const g of data.games) people.get(g.owner)?.games.push(g);
    const list = [...people.values()].sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));

    const now = Date.now();
    const newThisWeek = data.users.filter(u => now - (u.joinedAt || 0) < WEEK).length;
    const activeThisWeek = data.users.filter(u => now - (u.lastSeen || 0) < WEEK).length;
    const players = data.games.reduce((n, g) => n + (g.players || 0), 0);
    const recent = [...data.games].sort((a, b) => b.at - a.at).slice(0, 10);

    $('.a-main').innerHTML = `
      <div class="s-kpis">
        ${tile(t('s.users'), list.length, 'hero')}
        ${tile(t('s.newWeek'), newThisWeek)}
        ${tile(t('s.activeWeek'), activeThisWeek)}
        ${tile(t('s.quizzes'), data.quizzes.length)}
        ${tile(t('s.games'), data.games.length)}
        ${tile(t('s.players'), players)}
      </div>
      <div class="s-charts">
        ${columnChart('c-signups', t('s.signupsChart'), weekly(data.users.map(u => u.joinedAt).filter(Boolean)), 's.tipSignups')}
        ${columnChart('c-games', t('s.gamesChart'), weekly(data.games.map(g => g.at)), 's.tipGames')}
      </div>
      <section class="s-card">
        <h2>${t('s.people')}</h2>
        <div class="s-table-wrap"><table class="s-table">
          <thead><tr><th>${t('s.colPerson')}</th><th>${t('s.colJoined')}</th><th>${t('s.colLast')}</th><th class="num">${t('s.colQuizzes')}</th><th class="num">${t('s.colGames')}</th><th class="num">${t('s.colPlayers')}</th></tr></thead>
          <tbody>${list.map((p, i) => `
            <tr class="s-person" data-i="${i}">
              <td><div class="s-who">${avatar(p)}<div><div class="s-name" dir="auto">${esc(p.name || p.email || p.uid)}</div><div class="s-email" dir="ltr">${esc(p.email || '')}</div></div></div></td>
              <td>${p.joinedAt ? ago(p.joinedAt) : t('s.never')}</td>
              <td>${ago(p.lastSeen)}</td>
              <td class="num">${p.quizzes.length}</td>
              <td class="num">${p.gamesHosted || p.games.length || 0}</td>
              <td class="num">${p.playersHosted || 0}</td>
            </tr>
            <tr class="s-detail" data-for="${i}" hidden><td colspan="6">${p.quizzes.length
              ? `<div class="s-quizzes">${p.quizzes.map(q => `<span class="s-quiz" dir="auto">${esc(q.emoji || '')} ${esc(q.title)} <small>· ${t('nQuestions', { n: q.questions })}</small></span>`).join('')}</div>`
              : `<span class="s-muted">${t('s.noQuizzes')}</span>`}</td></tr>`).join('')}
          </tbody>
        </table></div>
      </section>
      <section class="s-card">
        <h2>${t('s.recent')}</h2>
        ${recent.length ? `<div class="s-table-wrap"><table class="s-table">
          <thead><tr><th>${t('s.colWhen')}</th><th>${t('s.colHost')}</th><th>${t('s.colQuiz')}</th><th class="num">${t('s.colPlayers')}</th></tr></thead>
          <tbody>${recent.map(g => `<tr><td>${ago(g.at)}</td><td dir="auto">${esc(people.get(g.owner)?.name || '')}</td><td dir="auto">${esc(g.quizTitle)}</td><td class="num">${g.players}</td></tr>`).join('')}</tbody>
        </table></div>` : `<p class="s-muted">${t('s.noGames')}</p>`}
      </section>`;

    bindTips(app);
    $('.s-table tbody').onclick = e => {
      const row = e.target.closest('.s-person');
      if (!row) return;
      const detail = $(`.s-detail[data-for="${row.dataset.i}"]`);
      detail.hidden = !detail.hidden;
      row.classList.toggle('open', !detail.hidden);
    };
  }

  bgBubbles(8);
  Store.ready.then(u => (u ? render() : showSignIn(app, {
    title: t('s.title'),
    intro: t('s.signInIntro'),
    onSignedIn: render,
    backLink: `<a class="link-btn" href="admin.html">${t('s.back')}</a>`,
  })));
})();
