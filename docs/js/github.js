/* Saves quizzes into the GitHub repo (docs/quizzes.json) and uploaded images into
   docs/img/, using a fine-grained access token that the admin pastes in once. */
const GitHub = (() => {
  const KEY = 'quizzle.ghtoken';
  const base = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`;
  const quizPath = `${CONFIG.dir}/quizzes.json`;
  let token = (() => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } })();

  const toBase64 = str => {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  };
  const fromBase64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0)));

  async function req(method, path, body, accept = 'application/vnd.github+json') {
    const res = await fetch(base + path, {
      method,
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      const err = new Error(res.status === 401 ? 'Your GitHub key stopped working. Please connect again.'
        : res.status === 403 || res.status === 404 ? "That key can't write to the quizzle repo. Check its permissions."
          : data.message || `GitHub error ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return accept.endsWith('raw') ? res.text() : res.json();
  }

  async function read() {
    let meta;
    try {
      meta = await req('GET', `/contents/${quizPath}?ref=${CONFIG.branch}`);
    } catch (e) {
      if (e.status === 404) return { list: [], sha: null };
      throw e;
    }
    const text = meta.content ? fromBase64(meta.content)
      : await req('GET', `/contents/${quizPath}?ref=${CONFIG.branch}`, null, 'application/vnd.github.raw');
    return { list: JSON.parse(text), sha: meta.sha };
  }

  async function write(list, sha, message) {
    await req('PUT', `/contents/${quizPath}`, {
      message, branch: CONFIG.branch, sha: sha || undefined,
      content: toBase64(JSON.stringify(list, null, 1) + '\n'),
    });
  }

  return {
    get token() { return token; },
    repoUrl: `https://github.com/${CONFIG.owner}/${CONFIG.repo}`,

    async connect(newToken) {
      token = newToken.trim();
      const repo = await req('GET', '');
      if (!repo.permissions?.push) throw new Error("That key can read the repo but can't save to it. Give it Contents: Read and write.");
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
          await write(next, sha, message);
          return next;
        } catch (e) {
          // 409 = the file changed since we read it (or GitHub served a slightly stale copy): re-read and retry.
          if (attempt >= 3 || ![409, 422].includes(e.status)) throw e;
          await new Promise(r => setTimeout(r, 1500));
        }
      }
    },

    /* Uploads a data: URL image and returns its path inside the site, e.g. "img/3f2a….jpg". */
    async uploadImage(dataUrl) {
      const m = /^data:image\/(png|jpeg|gif|webp);base64,(.*)$/s.exec(dataUrl);
      if (!m) throw new Error('Unsupported image');
      const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      const name = `img/${hash}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
      try {
        await req('PUT', `/contents/${CONFIG.dir}/${name}`, { message: `Add image ${name}`, branch: CONFIG.branch, content: m[2] });
      } catch (e) {
        if (e.status !== 422) throw e; // 422 = same image is already uploaded
      }
      return name;
    },
  };
})();
