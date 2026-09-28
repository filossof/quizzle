(() => {
  const app = $('#app');
  const PW_KEY = 'quizzle.adminpw';
  const COVER_EMOJIS = ['🦉', '🐾', '🚀', '🧮', '🌍', '🎨', '🎵', '⚽', '🦕', '🍎', '🔬', '📚', '🌈', '🐳', '🍕', '🏰', '🧙', '🎃', '🎄', '🌻', '🦄', '🤖', '🚂', '⭐'];
  const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120];

  let pw = (() => { try { return localStorage.getItem(PW_KEY) || ''; } catch { return ''; } })();
  let quiz = null;
  let current = 0;
  let dirty = false;

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'content-type': 'application/json', 'x-admin-password': pw },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { showLogin('Please log in again.'); throw new Error('Wrong password'); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  const newQuestion = () => ({
    type: 'quiz', text: '', image: '', timeLimit: 20, points: 1,
    answers: [0, 1, 2, 3].map(() => ({ text: '', correct: false })),
  });

  // Editor always works with 4 answer slots for quiz questions.
  function normalize(q) {
    if (q.type === 'truefalse') return q;
    q.answers = [0, 1, 2, 3].map(i => q.answers[i] || { text: '', correct: false });
    return q;
  }

  function problemsOf(q) {
    const issues = [];
    if (!q.text.trim()) issues.push('question text');
    if (q.type === 'quiz') {
      const filled = q.answers.filter(a => a.text.trim());
      if (filled.length < 2) issues.push('at least 2 answers');
      if (!filled.some(a => a.correct)) issues.push('a correct answer');
    }
    return issues;
  }

  function downloadJson(name, data) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = name.replace(/[^\w-]+/g, '-').toLowerCase() + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function resizeImage(file, max = 1000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error('That file is not an image.'));
      img.src = URL.createObjectURL(file);
    });
  }

  // ── Login ───────────────────────────────────────────────────────────────
  function showLogin(error = '') {
    app.innerHTML = `
      <div class="join">
        ${logoHtml('xl')}
        <form class="join-card pop-in" id="login">
          <div class="join-title">Quiz Studio 🔑</div>
          <input type="password" id="pw" placeholder="Admin password" aria-label="Admin password">
          <button class="btn big dark">Enter</button>
          <div class="form-error">${esc(error)}</div>
        </form>
        <a class="link-btn" href="/host">← Back to games</a>
      </div>`;
    $('#pw').focus();
    $('#login').onsubmit = async e => {
      e.preventDefault();
      pw = $('#pw').value;
      const ok = (await fetch('/api/admin/login', { method: 'POST', headers: { 'x-admin-password': pw } })).ok;
      if (!ok) { $('.form-error').textContent = 'Wrong password'; bump($('#login'), 'shake'); return; }
      try { localStorage.setItem(PW_KEY, pw); } catch { }
      showList();
    };
  }

  // ── Quiz list ───────────────────────────────────────────────────────────
  async function showList() {
    quiz = null;
    dirty = false;
    app.innerHTML = `
      <div class="admin">
        <header class="a-top">
          ${logoHtml('sm')}<span class="a-sub">Studio</span>
          <div class="grow"></div>
          <a class="btn" href="/host" target="_blank">🎮 Host a game</a>
          <button class="btn" id="import">📥 Import</button>
          <button class="btn primary" id="new">＋ New quiz</button>
        </header>
        <main class="a-main"><div class="quiz-grid"><div class="loading">Loading…</div></div></main>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
      </div>`;
    $('#new').onclick = () => openEditor({ title: '', emoji: '🦉', description: '', questions: [newQuestion()] });
    $('#import').onclick = () => $('#importFile').click();
    $('#importFile').onchange = importFile;

    const list = await (await fetch('/api/quizzes')).json();
    const grid = $('.quiz-grid');
    if (!grid) return;
    grid.innerHTML = list.length ? list.map((q, i) => `
      <div class="quiz-card admin-card pop-in" style="animation-delay:${i * 50}ms;--c:${colorFor(q.title)}" data-id="${esc(q.id)}">
        <span class="qc-emoji">${esc(q.emoji)}</span>
        <span class="qc-title">${esc(q.title)}</span>
        <span class="qc-desc">${esc(q.description)}</span>
        <span class="qc-meta">${q.questionCount} question${q.questionCount === 1 ? '' : 's'}</span>
        <div class="qc-actions">
          <button class="btn small primary" data-act="edit">✏️ Edit</button>
          <button class="btn small" data-act="play" title="Host this quiz">▶</button>
          <button class="btn small" data-act="dup" title="Duplicate">⧉</button>
          <button class="btn small" data-act="export" title="Download">⬇</button>
          <button class="btn small danger" data-act="delete" title="Delete">🗑</button>
        </div>
      </div>`).join('')
      : '<div class="empty">No quizzes yet. Click <b>＋ New quiz</b> to make one!</div>';

    grid.onclick = async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('[data-id]').dataset.id;
      const title = list.find(q => q.id === id)?.title;
      try {
        switch (btn.dataset.act) {
          case 'edit': openEditor(await api('GET', `/api/admin/quizzes/${id}`)); break;
          case 'play': window.open(`/host?quiz=${encodeURIComponent(id)}`, '_blank'); break;
          case 'dup': {
            const q = await api('GET', `/api/admin/quizzes/${id}`);
            await api('POST', '/api/admin/quizzes', { ...q, id: undefined, title: `${q.title} (copy)`.slice(0, 80) });
            toast('Duplicated!');
            showList();
            break;
          }
          case 'export': {
            const { id: _, updatedAt, ...q } = await api('GET', `/api/admin/quizzes/${id}`);
            downloadJson(q.title, q);
            break;
          }
          case 'delete':
            if (!confirm(`Delete "${title}"? This can't be undone.`)) return;
            await api('DELETE', `/api/admin/quizzes/${id}`);
            toast('Deleted');
            showList();
            break;
        }
      } catch (err) { toast(err.message); }
    };
  }

  async function importFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const items = Array.isArray(data) ? data : [data];
      for (const q of items) await api('POST', '/api/admin/quizzes', { ...q, id: undefined });
      toast(`Imported ${items.length} quiz${items.length === 1 ? '' : 'zes'}!`);
      showList();
    } catch (err) {
      toast(`Import failed: ${err.message}`);
    }
  }

  // ── Editor ──────────────────────────────────────────────────────────────
  function openEditor(data) {
    quiz = structuredClone(data);
    quiz.questions = quiz.questions.map(normalize);
    current = 0;
    dirty = false;
    app.innerHTML = `
      <div class="admin editor">
        <header class="a-top">
          <button class="btn" id="back">← Quizzes</button>
          <button class="emoji-btn" id="emoji" title="Pick a cover emoji">${esc(quiz.emoji)}</button>
          <input class="title-in" id="title" maxlength="80" placeholder="Name your quiz…" value="${esc(quiz.title)}">
          <div class="grow"></div>
          <span class="save-state"></span>
          <button class="btn primary" id="save">💾 Save</button>
        </header>
        <div class="ed-body">
          <aside class="ed-side">
            <input class="desc-in" id="desc" maxlength="160" placeholder="Short description (optional)" value="${esc(quiz.description)}">
            <div class="q-thumbs"></div>
            <button class="btn add-q" id="addQ">＋ Add question</button>
          </aside>
          <main class="ed-main"></main>
        </div>
      </div>`;

    $('#back').onclick = () => { if (!dirty || confirm('You have unsaved changes. Leave anyway?')) showList(); };
    $('#title').oninput = e => { quiz.title = e.target.value; markDirty(); };
    $('#desc').oninput = e => { quiz.description = e.target.value; markDirty(); };
    $('#save').onclick = save;
    $('#addQ').onclick = () => {
      quiz.questions.push(newQuestion());
      current = quiz.questions.length - 1;
      markDirty();
      renderThumbs();
      renderQuestion();
      $('#q-text').focus();
    };
    $('#emoji').onclick = emojiPicker;
    renderThumbs();
    renderQuestion();
    if (!quiz.title) $('#title').focus();
  }

  function markDirty() {
    dirty = true;
    const s = $('.save-state');
    if (s) s.textContent = 'Unsaved changes';
  }

  function emojiPicker(e) {
    e.stopPropagation();
    document.querySelector('.emoji-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'emoji-pop pop-in';
    pop.innerHTML = COVER_EMOJIS.map(x => `<button>${x}</button>`).join('') +
      `<input maxlength="4" placeholder="or type one" aria-label="Custom emoji">`;
    const rect = e.currentTarget.getBoundingClientRect();
    pop.style.left = rect.left + 'px';
    pop.style.top = rect.bottom + 8 + 'px';
    document.body.append(pop);
    const set = v => {
      quiz.emoji = v;
      $('#emoji').textContent = v;
      markDirty();
      pop.remove();
    };
    pop.onclick = ev => { ev.stopPropagation(); if (ev.target.tagName === 'BUTTON') set(ev.target.textContent); };
    pop.querySelector('input').onchange = ev => ev.target.value.trim() && set(ev.target.value.trim());
    setTimeout(() => document.addEventListener('click', () => pop.remove(), { once: true }));
  }

  function renderThumbs() {
    const box = $('.q-thumbs');
    box.innerHTML = quiz.questions.map((q, i) => `
      <div class="thumb ${i === current ? 'active' : ''} ${problemsOf(q).length ? 'invalid' : ''}" data-i="${i}">
        <span class="t-num">${i + 1}</span>
        <span class="t-text">${esc(q.text) || '<i>New question</i>'}</span>
        <span class="t-type">${q.type === 'truefalse' ? 'True/False' : 'Quiz'} · ${q.timeLimit}s</span>
        <span class="t-move">
          <button data-move="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button data-move="1" title="Move down" ${i === quiz.questions.length - 1 ? 'disabled' : ''}>▼</button>
        </span>
      </div>`).join('');
    box.onclick = e => {
      const t = e.target.closest('.thumb');
      if (!t) return;
      const i = Number(t.dataset.i);
      const move = e.target.closest('[data-move]');
      if (move) {
        const j = i + Number(move.dataset.move);
        [quiz.questions[i], quiz.questions[j]] = [quiz.questions[j], quiz.questions[i]];
        current = j;
        markDirty();
      } else {
        current = i;
      }
      renderThumbs();
      renderQuestion();
    };
  }

  function refreshThumb() {
    const q = quiz.questions[current];
    const t = $(`.thumb[data-i="${current}"]`);
    if (!t) return;
    $('.t-text', t).innerHTML = esc(q.text) || '<i>New question</i>';
    $('.t-type', t).textContent = `${q.type === 'truefalse' ? 'True/False' : 'Quiz'} · ${q.timeLimit}s`;
    t.classList.toggle('invalid', problemsOf(q).length > 0);
  }

  function renderQuestion() {
    const q = quiz.questions[current];
    const main = $('.ed-main');
    main.innerHTML = `
      <div class="qe fade-in">
        <div class="qe-settings">
          <label>Type
            <select id="q-type">
              <option value="quiz" ${q.type === 'quiz' ? 'selected' : ''}>🔷 Quiz</option>
              <option value="truefalse" ${q.type === 'truefalse' ? 'selected' : ''}>✅ True / False</option>
            </select></label>
          <label>⏱ Time
            <select id="q-time">${TIMES.map(t => `<option value="${t}" ${q.timeLimit === t ? 'selected' : ''}>${t} sec</option>`).join('')}
              ${TIMES.includes(q.timeLimit) ? '' : `<option selected value="${q.timeLimit}">${q.timeLimit} sec</option>`}</select></label>
          <label>⭐ Points
            <select id="q-points">
              <option value="1" ${q.points === 1 ? 'selected' : ''}>Standard</option>
              <option value="2" ${q.points === 2 ? 'selected' : ''}>Double</option>
              <option value="0" ${q.points === 0 ? 'selected' : ''}>No points</option>
            </select></label>
          <div class="grow"></div>
          <button class="btn small" id="q-dup">⧉ Duplicate</button>
          <button class="btn small danger" id="q-del" ${quiz.questions.length < 2 ? 'disabled' : ''}>🗑 Delete</button>
        </div>
        <textarea id="q-text" class="qe-text" maxlength="200" rows="2" placeholder="Type your question here…">${esc(q.text)}</textarea>
        <div class="qe-media">
          ${q.image
            ? `<div class="media-preview"><img src="${esc(q.image)}" alt=""><button class="btn small danger" id="img-rm">✕ Remove image</button></div>`
            : `<div class="media-drop" id="drop">
                 <div class="md-icon">🖼️</div>
                 <p>Add a picture <small>(optional)</small></p>
                 <div class="md-btns"><button class="btn small" id="img-up">⬆ Upload</button><button class="btn small" id="img-url">🔗 From link</button></div>
                 <input type="file" id="img-file" accept="image/*" hidden>
               </div>`}
        </div>
        <div class="qe-answers n${q.answers.length}">
          ${q.answers.map((a, i) => {
            const st = answerStyle(q.type, i);
            const tf = q.type === 'truefalse';
            return `<div class="qe-ans ${st.cls} ${a.correct ? 'is-correct' : ''} ${!tf && !a.text.trim() ? 'empty' : ''}" data-i="${i}">
              <span class="shape">${st.shape}</span>
              <input maxlength="90" value="${esc(a.text)}" placeholder="Answer ${i + 1}${i < 2 ? '' : ' (optional)'}" ${tf ? 'readonly' : ''}>
              <button class="correct-toggle" title="Mark as correct" aria-pressed="${a.correct}">✔</button>
            </div>`;
          }).join('')}
        </div>
        <p class="qe-hint">Tap the ✔ to mark the right answer${q.type === 'quiz' ? ' (you can pick more than one)' : ''}.</p>
      </div>`;

    const changed = (rerender = false) => {
      markDirty();
      refreshThumb();
      if (rerender) renderQuestion();
    };

    $('#q-text').oninput = e => { q.text = e.target.value; changed(); };
    $('#q-time').onchange = e => { q.timeLimit = Number(e.target.value); changed(); };
    $('#q-points').onchange = e => { q.points = Number(e.target.value); changed(); };
    $('#q-type').onchange = e => {
      q.type = e.target.value;
      q.answers = q.type === 'truefalse'
        ? [{ text: 'True', correct: true }, { text: 'False', correct: false }]
        : [0, 1, 2, 3].map(() => ({ text: '', correct: false }));
      changed(true);
    };
    $('#q-dup').onclick = () => {
      quiz.questions.splice(current + 1, 0, { ...structuredClone(q), id: undefined });
      current++;
      markDirty();
      renderThumbs();
      renderQuestion();
    };
    $('#q-del').onclick = () => {
      if (!confirm('Delete this question?')) return;
      quiz.questions.splice(current, 1);
      current = Math.min(current, quiz.questions.length - 1);
      markDirty();
      renderThumbs();
      renderQuestion();
    };

    $('.qe-answers').oninput = e => {
      const box = e.target.closest('.qe-ans');
      q.answers[box.dataset.i].text = e.target.value;
      box.classList.toggle('empty', !e.target.value.trim());
      changed();
    };
    $('.qe-answers').onclick = e => {
      const btn = e.target.closest('.correct-toggle');
      if (!btn) return;
      const i = Number(btn.closest('.qe-ans').dataset.i);
      if (q.type === 'truefalse') q.answers.forEach((a, j) => { a.correct = j === i; });
      else q.answers[i].correct = !q.answers[i].correct;
      changed(true);
    };

    const setImage = v => { q.image = v; changed(true); };
    $('#img-rm')?.addEventListener('click', () => setImage(''));
    $('#img-up')?.addEventListener('click', () => $('#img-file').click());
    $('#img-url')?.addEventListener('click', () => {
      const url = prompt('Paste an image link (https://…)');
      if (url && /^https?:\/\//.test(url.trim())) setImage(url.trim());
      else if (url) toast('That link should start with https://');
    });
    const useFile = async file => {
      try { setImage(await resizeImage(file)); } catch (err) { toast(err.message); }
    };
    $('#img-file')?.addEventListener('change', e => e.target.files[0] && useFile(e.target.files[0]));
    const drop = $('#drop');
    if (drop) {
      drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
      drop.ondragleave = () => drop.classList.remove('over');
      drop.ondrop = e => {
        e.preventDefault();
        drop.classList.remove('over');
        const f = e.dataTransfer.files[0];
        if (f) useFile(f);
      };
    }
  }

  async function save() {
    if (!quiz.title.trim()) { toast('Give your quiz a name first!'); $('#title').focus(); return; }
    const bad = quiz.questions.findIndex(q => problemsOf(q).length);
    if (bad >= 0) {
      current = bad;
      renderThumbs();
      renderQuestion();
      toast(`Question ${bad + 1} needs ${problemsOf(quiz.questions[bad]).join(' and ')}.`);
      return;
    }
    const btn = $('#save');
    btn.disabled = true;
    try {
      const saved = quiz.id
        ? await api('PUT', `/api/admin/quizzes/${quiz.id}`, quiz)
        : await api('POST', '/api/admin/quizzes', quiz);
      quiz.id = saved.id;
      saved.questions.forEach((sq, i) => { if (quiz.questions[i]) quiz.questions[i].id = sq.id; });
      dirty = false;
      $('.save-state').textContent = '✔ Saved';
      toast('Saved! 🎉');
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && quiz) { e.preventDefault(); save(); }
  });

  bgBubbles(10);
  if (pw) {
    fetch('/api/admin/login', { method: 'POST', headers: { 'x-admin-password': pw } })
      .then(r => (r.ok ? showList() : showLogin()));
  } else {
    showLogin();
  }
})();
