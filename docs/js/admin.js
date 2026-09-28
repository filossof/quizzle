(() => {
  const app = $('#app');
  const COVER_EMOJIS = ['🦉', '🐾', '🚀', '🧮', '🌍', '🎨', '🎵', '⚽', '🦕', '🍎', '🔬', '📚', '🌈', '🐳', '🍕', '🏰', '🧙', '🎃', '🎄', '🌻', '🦄', '🤖', '🚂', '⭐'];
  const TIMES = [5, 10, 15, 20, 30, 45, 60, 90, 120];

  let quizzes = [];
  let quiz = null;
  let current = 0;
  let dirty = false;

  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => b.toString(16).padStart(2, '0')).join('');

  /* Cleans up a quiz before saving; throws a friendly message when something is missing. */
  function sanitizeQuiz(input) {
    const str = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
    const title = str(input.title, 80);
    if (!title) throw new Error(t('a.needTitle'));
    const questions = (input.questions || []).map((q, i) => {
      const type = q.type === 'truefalse' ? 'truefalse' : 'quiz';
      const text = str(q.text, 200);
      if (!text) throw new Error(t('a.needs', { n: i + 1, what: t('a.needText') }));
      let answers = (q.answers || []).slice(0, 4).map(a => ({ text: str(a?.text, 90), correct: !!a?.correct }));
      if (type === 'truefalse') {
        const trueIsCorrect = answers[0]?.correct || !answers[1]?.correct;
        answers = [
          { text: answers[0]?.text || t('true'), correct: trueIsCorrect },
          { text: answers[1]?.text || t('false'), correct: !trueIsCorrect },
        ];
      } else {
        answers = answers.filter(a => a.text);
        if (answers.length < 2) throw new Error(t('a.needs', { n: i + 1, what: t('a.needAnswers') }));
        if (!answers.some(a => a.correct)) throw new Error(t('a.needs', { n: i + 1, what: t('a.needCorrect') }));
      }
      return {
        id: q.id || newId(), type, text,
        image: typeof q.image === 'string' ? q.image : '',
        timeLimit: Math.min(240, Math.max(5, Math.round(Number(q.timeLimit) || 20))),
        points: [0, 1, 2].includes(Number(q.points)) ? Number(q.points) : 1,
        answers,
      };
    });
    if (!questions.length) throw new Error(t('a.needQuestions'));
    return {
      id: input.id || newId(), title,
      description: str(input.description, 160),
      emoji: Array.from(str(input.emoji, 16) || '🦉').slice(0, 4).join(''),
      lang: LANGS.includes(input.lang) ? input.lang : '',
      questions, updatedAt: Date.now(),
    };
  }

  /* Uploads any newly added pictures and swaps them for their file path. */
  async function uploadImages(q) {
    for (const question of q.questions) {
      if (!question.image?.startsWith('data:')) continue;
      const data = question.image;
      question.image = await GitHub.uploadImage(data);
    }
    return q;
  }

  function fail(err) {
    toast(err.message || String(err));
    if (err.status === 401) showLogin(err.message);
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

  const thumbType = q => `${t(q.type === 'truefalse' ? 'a.typeTF' : 'a.typeQuiz')} · ${t('a.sec', { n: q.timeLimit })}`;

  function problemsOf(q) {
    const issues = [];
    if (!q.text.trim()) issues.push(t('a.needText'));
    if (q.type === 'truefalse') {
      if (!q.answers.some(a => a.correct)) issues.push(t('a.needCorrect'));
    } else {
      const filled = q.answers.filter(a => a.text.trim());
      if (filled.length < 2) issues.push(t('a.needAnswers'));
      if (!filled.some(a => a.correct)) issues.push(t('a.needCorrect'));
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

  function resizeImage(file, max = 1600) {
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
      img.onerror = () => reject(new Error(t('a.notImage')));
      img.src = URL.createObjectURL(file);
    });
  }

  // ── Connect to GitHub ───────────────────────────────────────────────────
  function showLogin(error = '') {
    GitHub.showKeyForm(app, {
      title: t('a.title'),
      intro: t('a.intro', { repo: esc(GitHub.repoName) }),
      write: true,
      error,
      onConnected: showList,
      backLink: `<a class="link-btn" href="host.html">${t('a.back')}</a>`,
    });
  }

  // ── Quiz list ───────────────────────────────────────────────────────────
  async function showList() {
    quiz = null;
    dirty = false;
    app.innerHTML = `
      <div class="admin">
        <header class="a-top">
          ${logoHtml('sm')}<span class="a-sub">${t('a.studio')}</span>
          <div class="grow"></div>
          <a class="btn" href="host.html" target="_blank">${t('a.host')}</a>
          <button class="btn" id="import">${t('a.import')}</button>
          <button class="btn primary" id="new">${t('a.new')}</button>
          ${langButton('btn small')}
          <button class="btn small" id="logout" title="${t('a.logout')}">🔌</button>
        </header>
        <main class="a-main"><div class="quiz-grid"><div class="loading">${t('a.loading')}</div></div>
          <p class="gh-status" style="text-align:center;margin-top:2rem">${t('a.savedIn', { repo: `<a href="${GitHub.repoUrl}/commits/${CONFIG.branch}" target="_blank" rel="noopener">${esc(GitHub.repoName)}</a>` })}</p>
        </main>
        <input type="file" id="importFile" accept=".json,application/json" hidden>
      </div>`;
    $('#new').onclick = () => openEditor({ title: '', emoji: '🦉', description: '', lang: LANG, questions: [newQuestion()] });
    $('#import').onclick = () => $('#importFile').click();
    $('#importFile').onchange = importFile;
    $('#logout').onclick = () => {
      if (!confirm(t('a.logoutConfirm'))) return;
      GitHub.forget();
      showLogin();
    };

    try { quizzes = await GitHub.list(); } catch (err) { return fail(err); }
    const grid = $('.quiz-grid');
    if (!grid) return;
    grid.innerHTML = quizzes.length ? quizzes.map((q, i) => `
      <div class="quiz-card admin-card pop-in" style="animation-delay:${i * 50}ms;--c:${colorFor(q.title)}" data-id="${esc(q.id)}">
        <span class="qc-emoji">${esc(q.emoji)}</span>
        <span class="qc-title" dir="auto">${esc(q.title)}</span>
        <span class="qc-desc" dir="auto">${esc(q.description)}</span>
        <span class="qc-meta">${t('nQuestions', { n: q.questions.length })} · ${t(`a.lang.${q.lang || 'any'}`)}</span>
        <div class="qc-actions">
          <button class="btn small primary" data-act="edit">${t('a.edit')}</button>
          <button class="btn small" data-act="play" title="${t('a.hostThis')}">▶</button>
          <button class="btn small" data-act="dup" title="${t('a.duplicate')}">⧉</button>
          <button class="btn small" data-act="export" title="${t('a.download')}">⬇</button>
          <button class="btn small danger" data-act="delete" title="${t('a.delete')}">🗑</button>
        </div>
      </div>`).join('')
      : `<div class="empty">${t('a.empty')}</div>`;

    grid.onclick = async e => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const id = btn.closest('[data-id]').dataset.id;
      const q = quizzes.find(x => x.id === id);
      try {
        switch (btn.dataset.act) {
          case 'edit': openEditor(q); break;
          case 'play': window.open(`host.html?quiz=${encodeURIComponent(id)}`, '_blank'); break;
          case 'dup': {
            const copy = { ...structuredClone(q), id: newId(), title: t('a.copy', { title: q.title }).slice(0, 80), updatedAt: Date.now() };
            btn.disabled = true;
            await GitHub.update(`Duplicate quiz "${q.title}"`, list => [copy, ...list]);
            toast(t('a.duplicated'));
            showList();
            break;
          }
          case 'export': {
            const { id: _, updatedAt, ...data } = q;
            downloadJson(q.title, data);
            break;
          }
          case 'delete':
            if (!confirm(t('a.deleteConfirm', { title: q.title }))) return;
            btn.disabled = true;
            await GitHub.update(`Delete quiz "${q.title}"`, list => list.filter(x => x.id !== id));
            toast(t('a.deleted'));
            showList();
            break;
        }
      } catch (err) { fail(err); }
    };
  }

  async function importFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const items = (Array.isArray(data) ? data : [data]).map(q => sanitizeQuiz({ ...q, id: undefined }));
      for (const q of items) await uploadImages(q);
      await GitHub.update(`Import ${items.length} quiz(zes)`, list => [...items, ...list]);
      toast(t('a.imported', { n: items.length }));
      showList();
    } catch (err) {
      fail(new Error(t('a.importFailed', { msg: err.message })));
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
          <button class="btn" id="back">${t('a.quizzes')}</button>
          <button class="emoji-btn" id="emoji" title="${t('a.pickEmoji')}">${esc(quiz.emoji)}</button>
          <input class="title-in" id="title" dir="auto" maxlength="80" placeholder="${t('a.namePlaceholder')}" value="${esc(quiz.title)}">
          <div class="grow"></div>
          <span class="save-state"></span>
          <button class="btn primary" id="save">${t('a.save')}</button>
        </header>
        <div class="ed-body">
          <aside class="ed-side">
            <input class="desc-in" id="desc" dir="auto" maxlength="160" placeholder="${t('a.descPlaceholder')}" value="${esc(quiz.description)}">
            <label class="lang-pick">${t('a.quizLang')}
              <select id="qlang">${['he', 'en', ''].map(l => `<option value="${l}" ${(quiz.lang || '') === l ? 'selected' : ''}>${t(`a.lang.${l || 'any'}`)}</option>`).join('')}</select>
            </label>
            <div class="q-thumbs"></div>
            <button class="btn add-q" id="addQ">${t('a.addQ')}</button>
          </aside>
          <main class="ed-main"></main>
        </div>
      </div>`;

    $('#back').onclick = () => { if (!dirty || confirm(t('a.leaveConfirm'))) showList(); };
    $('#title').oninput = e => { quiz.title = e.target.value; markDirty(); };
    $('#desc').oninput = e => { quiz.description = e.target.value; markDirty(); };
    $('#qlang').onchange = e => { quiz.lang = e.target.value; markDirty(); };
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
    if (s) s.textContent = t('a.unsaved');
  }

  function emojiPicker(e) {
    e.stopPropagation();
    document.querySelector('.emoji-pop')?.remove();
    const pop = document.createElement('div');
    pop.className = 'emoji-pop pop-in';
    pop.innerHTML = COVER_EMOJIS.map(x => `<button>${x}</button>`).join('') +
      `<input maxlength="4" placeholder="${t('a.typeEmoji')}" aria-label="${t('a.typeEmoji')}">`;
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
        <span class="t-text" dir="auto">${esc(q.text) || `<i>${t('a.newQ')}</i>`}</span>
        <span class="t-type">${thumbType(q)}</span>
        <span class="t-move">
          <button data-move="-1" title="${t('a.moveUp')}" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button data-move="1" title="${t('a.moveDown')}" ${i === quiz.questions.length - 1 ? 'disabled' : ''}>▼</button>
        </span>
      </div>`).join('');
    box.onclick = e => {
      const thumb = e.target.closest('.thumb');
      if (!thumb) return;
      const i = Number(thumb.dataset.i);
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
    const el = $(`.thumb[data-i="${current}"]`);
    if (!el) return;
    $('.t-text', el).innerHTML = esc(q.text) || `<i>${t('a.newQ')}</i>`;
    $('.t-type', el).textContent = thumbType(q);
    el.classList.toggle('invalid', problemsOf(q).length > 0);
  }

  function renderQuestion() {
    const q = quiz.questions[current];
    const main = $('.ed-main');
    main.innerHTML = `
      <div class="qe fade-in">
        <div class="qe-settings">
          <label>${t('a.type')}
            <select id="q-type">
              <option value="quiz" ${q.type === 'quiz' ? 'selected' : ''}>${t('a.optQuiz')}</option>
              <option value="truefalse" ${q.type === 'truefalse' ? 'selected' : ''}>${t('a.optTF')}</option>
            </select></label>
          <label>${t('a.time')}
            <select id="q-time">${TIMES.map(sec => `<option value="${sec}" ${q.timeLimit === sec ? 'selected' : ''}>${t('a.sec', { n: sec })}</option>`).join('')}
              ${TIMES.includes(q.timeLimit) ? '' : `<option selected value="${q.timeLimit}">${t('a.sec', { n: q.timeLimit })}</option>`}</select></label>
          <label>${t('a.points')}
            <select id="q-points">
              <option value="1" ${q.points === 1 ? 'selected' : ''}>${t('a.ptsStandard')}</option>
              <option value="2" ${q.points === 2 ? 'selected' : ''}>${t('a.ptsDouble')}</option>
              <option value="0" ${q.points === 0 ? 'selected' : ''}>${t('a.ptsNone')}</option>
            </select></label>
          <div class="grow"></div>
          <button class="btn small" id="q-dup">${t('a.dupQ')}</button>
          <button class="btn small danger" id="q-del" ${quiz.questions.length < 2 ? 'disabled' : ''}>${t('a.delQ')}</button>
        </div>
        <textarea id="q-text" class="qe-text" dir="auto" maxlength="200" rows="2" placeholder="${t('a.qPlaceholder')}">${esc(q.text)}</textarea>
        <div class="qe-media">
          ${q.image
            ? `<div class="media-preview"><img alt="" data-path="${esc(q.image)}"><button class="btn small danger" id="img-rm">${t('a.removeImg')}</button></div>`
            : `<div class="media-drop" id="drop">
                 <div class="md-icon">🖼️</div>
                 <p>${t('a.addPic')}</p>
                 <div class="md-btns"><button class="btn small" id="img-up">${t('a.upload')}</button><button class="btn small" id="img-url">${t('a.fromLink')}</button></div>
                 <input type="file" id="img-file" accept="image/*" hidden>
               </div>`}
        </div>
        <div class="qe-answers n${q.answers.length}">
          ${q.answers.map((a, i) => {
            const st = answerStyle(q.type, i);
            const tf = q.type === 'truefalse';
            return `<div class="qe-ans ${st.cls} ${a.correct ? 'is-correct' : ''} ${!tf && !a.text.trim() ? 'empty' : ''}" data-i="${i}">
              <span class="shape">${st.shape}</span>
              <input maxlength="90" dir="auto" value="${esc(a.text)}" placeholder="${tf ? t(i ? 'false' : 'true') : t(i < 2 ? 'a.answerN' : 'a.answerOpt', { n: i + 1 })}">
              <button class="correct-toggle" title="${t('a.markCorrect')}" aria-pressed="${a.correct}">✔</button>
            </div>`;
          }).join('')}
        </div>
        <p class="qe-hint">${t(q.type === 'quiz' ? 'a.hintMulti' : 'a.hintTF')}</p>
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
        ? [{ text: t('true'), correct: true }, { text: t('false'), correct: false }]
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
      if (!confirm(t('a.delQConfirm'))) return;
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

    const img = $('.media-preview img');
    if (img) GitHub.imageUrl(img.dataset.path).then(url => { img.src = url; }).catch(() => { img.alt = t('a.imgFailed'); });

    const setImage = v => { q.image = v; changed(true); };
    $('#img-rm')?.addEventListener('click', () => setImage(''));
    $('#img-up')?.addEventListener('click', () => $('#img-file').click());
    $('#img-url')?.addEventListener('click', () => {
      const url = prompt(t('a.imgPrompt'));
      if (url && /^https?:\/\//.test(url.trim())) setImage(url.trim());
      else if (url) toast(t('a.imgBadLink'));
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
    if (!quiz.title.trim()) { toast(t('a.needTitle')); $('#title').focus(); return; }
    const bad = quiz.questions.findIndex(q => problemsOf(q).length);
    if (bad >= 0) {
      current = bad;
      renderThumbs();
      renderQuestion();
      toast(t('a.needs', { n: bad + 1, what: problemsOf(quiz.questions[bad]).join(t('a.and')) }));
      return;
    }
    const btn = $('#save');
    btn.disabled = true;
    $('.save-state').textContent = t('a.saving');
    try {
      const clean = await uploadImages(sanitizeQuiz(quiz));
      const isNew = !quizzes.some(q => q.id === clean.id);
      quizzes = await GitHub.update(`${isNew ? 'Add' : 'Update'} quiz "${clean.title}"`, list =>
        list.some(q => q.id === clean.id) ? list.map(q => (q.id === clean.id ? clean : q)) : [clean, ...list]);
      quiz.id = clean.id;
      clean.questions.forEach((sq, i) => { Object.assign(quiz.questions[i], { id: sq.id, image: sq.image }); });
      dirty = false;
      $('.save-state').textContent = t('a.saved');
      toast(t('a.savedToast'));
    } catch (err) {
      $('.save-state').textContent = t('a.notSaved');
      fail(err);
    } finally {
      btn.disabled = false;
    }
  }

  addEventListener('beforeunload', e => { if (dirty) e.preventDefault(); });
  addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && quiz) { e.preventDefault(); save(); }
  });

  bgBubbles(10);
  if (GitHub.token) showList(); else showLogin();
})();
