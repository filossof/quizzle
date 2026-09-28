/* Reads and saves quizzes in the private data repo (quizzes.json + img/) through the
   GitHub API, using a fine-grained access token pasted in once per device. */
const GitHub = (() => {
  const KEY = 'quizzle.ghtoken';
  const repoName = `${CONFIG.owner}/${CONFIG.dataRepo}`;
  const base = `https://api.github.com/repos/${repoName}`;
  let token = (() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } })();
  const images = new Map(); // image path → displayable URL

  const toBase64 = str => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fromBase64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

  async function call(method, path, body, accept = 'application/vnd.github+json') {
    const res = await fetch(base + path, {
      method,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(res.status === 401 ? 'Your GitHub key stopped working. Please connect again.'
        : res.status === 403 ? `That key doesn't have permission for ${repoName}.`
          : res.status === 404 && path === '' ? `That key can't see the private ${repoName} repo.`
            : data.message || `GitHub error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res;
  }
  const json = async (...args) => (await call(...args)).json();

  async function read() {
    let meta;
    try {
      meta = await json('GET', `/contents/quizzes.json?ref=${CONFIG.branch}`);
    } catch (e) {
      if (e.status === 404) return { list: [], sha: null };
      throw e;
    }
    const text = meta.content ? fromBase64(meta.content)
      : await (await call('GET', `/contents/quizzes.json?ref=${CONFIG.branch}`, null, 'application/vnd.github.raw')).text();
    return { list: JSON.parse(text), sha: meta.sha };
  }

  const api = {
    get token() { return token; },
    repoName,
    repoUrl: `https://github.com/${repoName}`,

    /* Checks the key can read the data repo (and write to it, when `write` is set) and remembers it. */
    async connect(newToken, { write = true } = {}) {
      token = newToken.trim();
      const repo = await json('GET', '');
      if (write && !repo.permissions?.push) throw new Error("That key can read your quizzes but can't save them. Give it Contents: Read and write.");
      try { localStorage.setItem(KEY, token); } catch { }
    },

    forget() {
      token = '';
      try { localStorage.removeItem(KEY); } catch { }
    },

    async list() { return (await read()).list; },

    /* Read the latest quizzes, apply a change, and save it as one commit. Retries if another save got there first. */
    async update(message, change) {
      for (let attempt = 0; ; attempt++) {
        const { list, sha } = await read();
        const next = change(list);
        try {
          await call('PUT', '/contents/quizzes.json', {
            message, branch: CONFIG.branch, sha: sha || undefined,
            content: toBase64(JSON.stringify(next, null, 1) + '\n'),
          });
          return next;
        } catch (e) {
          // 409 = the file changed since we read it (or GitHub served a slightly stale copy): re-read and retry.
          if (attempt >= 3 || ![409, 422].includes(e.status)) throw e;
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    },

    /* Uploads a data: URL image and returns its path in the data repo, e.g. "img/3f2a….jpg". */
    async uploadImage(dataUrl) {
      const m = /^data:image\/(png|jpeg|gif|webp);base64,(.*)$/s.exec(dataUrl);
      if (!m) throw new Error('Unsupported image');
      const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      const name = `img/${hash}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
      try {
        await call('PUT', `/contents/${name}`, { message: `Add image ${name}`, branch: CONFIG.branch, content: m[2] });
      } catch (e) {
        if (e.status !== 422) throw e; // 422 = same image is already uploaded
      }
      images.set(name, dataUrl);
      return name;
    },

    /* Pictures live in the private repo, so they're downloaded with the key and shown from memory. */
    async imageUrl(path) {
      if (!path || /^(https?:|data:|blob:)/.test(path)) return path || '';
      if (!images.has(path)) {
        const res = await call('GET', `/contents/${path}?ref=${CONFIG.branch}`, null, 'application/vnd.github.raw');
        images.set(path, URL.createObjectURL(await res.blob()));
      }
      return images.get(path);
    },

    /* The "paste your key" screen, shared by the host and admin pages. */
    showKeyForm(container, { title, intro, write, error = '', onConnected, backLink = '' }) {
      container.innerHTML = `
        <div class="join">
          ${logoHtml('xl')}
          <form class="join-card pop-in" id="keyForm" style="width:min(540px,100%)">
            <div class="join-title">${title}</div>
            <p class="gh-status">${intro}</p>
            <details class="gh-help" ${token ? '' : 'open'}>
              <summary>How do I get a key?</summary>
              <ol class="gh-steps">
                <li>Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → new fine-grained token</a></li>
                <li>Name it <b>quizzle</b> and pick an expiration (for example, 1 year)</li>
                <li><b>Repository access</b> → Only select repositories → <b>${esc(CONFIG.dataRepo)}</b></li>
                <li><b>Permissions</b> → Repository permissions → <b>Contents: Read and write</b></li>
                <li>Click <b>Generate token</b>, copy it, and paste it here 👇</li>
              </ol>
            </details>
            <input type="password" id="token" placeholder="github_pat_…" aria-label="GitHub key" autocomplete="off">
            <button class="btn big dark">Unlock</button>
            <div class="form-error">${esc(error)}</div>
          </form>
          ${backLink}
        </div>`;
      const form = container.querySelector('#keyForm');
      const btn = form.querySelector('.btn');
      form.querySelector('#token').focus();
      form.onsubmit = async e => {
        e.preventDefault();
        btn.disabled = true;
        btn.textContent = 'Checking…';
        try {
          await api.connect(form.querySelector('#token').value, { write });
          onConnected();
        } catch (err) {
          api.forget();
          form.querySelector('.form-error').textContent = err.status === 401 ? "GitHub didn't accept that key. Copy it again?" : err.message;
          bump(form, 'shake');
          btn.disabled = false;
          btn.textContent = 'Unlock';
        }
      };
    },
  };
  return api;
})();
