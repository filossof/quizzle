/* Quizzes are private: they live in a separate private GitHub repo (quizzes.json plus
   pictures in img/). Hosting and editing both need a GitHub key that can read that repo;
   players never need one. When hosted on GitHub Pages the owner is worked out from the
   page address, and the values below are the fallback for local testing. */
const CONFIG = (() => {
  const cfg = { owner: 'filossof', dataRepo: 'quizzle-data', branch: 'main' };
  const m = /^([\w-]+)\.github\.io$/i.exec(location.hostname);
  if (m) cfg.owner = m[1];
  cfg.peerPrefix = 'quizzle-v1-';
  return cfg;
})();

/* Address players open on their phones, e.g. https://filossof.github.io/quizzle/ */
const JOIN_URL = new URL('./', location.href).href;
