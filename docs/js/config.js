/* Where quizzes are stored. Quizzes live in this GitHub repo as docs/quizzes.json,
   and uploaded images go in docs/img/. When hosted on GitHub Pages, owner and repo are
   worked out from the page address; the values below are the fallback for local testing. */
const CONFIG = (() => {
  const cfg = { owner: 'filossof', repo: 'quizzle', branch: 'main', dir: 'docs' };
  const m = /^([\w-]+)\.github\.io$/i.exec(location.hostname);
  const firstPath = location.pathname.split('/')[1];
  if (m && firstPath && !firstPath.includes('.')) { cfg.owner = m[1]; cfg.repo = firstPath; }
  cfg.peerPrefix = 'quizzle-v1-';
  return cfg;
})();

/* Address players open on their phones, e.g. https://filossof.github.io/quizzle/ */
const JOIN_URL = new URL('./', location.href).href;

/* Latest quiz list. Tries the GitHub API first so fresh edits show up right away,
   then falls back to the copy GitHub Pages serves. */
async function loadQuizzes() {
  const api = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.dir}/quizzes.json?ref=${CONFIG.branch}`;
  for (const [url, opts] of [
    [api, { headers: { Accept: 'application/vnd.github.raw' }, cache: 'no-store' }],
    [`quizzes.json?t=${Date.now()}`, { cache: 'no-store' }],
  ]) {
    try {
      const res = await fetch(url, opts);
      if (res.ok) return await res.json();
    } catch { /* try the next source */ }
  }
  throw new Error('Could not load quizzes');
}
