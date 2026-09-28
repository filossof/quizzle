/* Quiz storage in Firebase. Each quiz and picture is saved with its owner's user id, and
   the Firestore rules only let the owner read or change it. */
const Store = (() => {
  firebase.initializeApp(FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.firestore();

  // Local testing against the Firebase emulator (only on localhost, when switched on).
  const emulator = ['localhost', '127.0.0.1'].includes(location.hostname) && localStorage.getItem('quizzle.emulator') === '1';
  if (emulator) {
    auth.useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
    db.useEmulator('127.0.0.1', 8081);
  }

  let user = null;
  const images = new Map(); // "fs:<id>" → data URL
  const ready = new Promise(resolve => auth.onAuthStateChanged(u => {
    user = u;
    if (u) recordVisit(u);
    resolve(u);
  }));

  /* Keeps a small profile per person (name, email, when they joined and were last active),
     for the owner's stats page. Only the person themselves and the owner can read it. */
  function recordVisit(u) {
    db.collection('users').doc(u.uid).set({
      name: u.displayName || '', email: u.email || '', photo: u.photoURL || '',
      joinedAt: Date.parse(u.metadata.creationTime) || Date.now(),
      lastSeen: Date.now(),
    }, { merge: true }).catch(() => { });
  }
  auth.getRedirectResult().catch(() => { });

  const uid = () => {
    if (!user) { const e = new Error(t('auth.needed')); e.code = 'auth/needed'; throw e; }
    return user.uid;
  };
  const randomId = (n = 20) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  const strip = ({ owner, ...rest }) => rest;
  const clean = x => JSON.parse(JSON.stringify(x)); // Firestore rejects undefined values

  return {
    ready,
    emulator,
    auth,
    get user() { return user; },

    async signIn() {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      try {
        await auth.signInWithPopup(provider);
      } catch (e) {
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') return auth.signInWithRedirect(provider);
        if (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request') return null;
        throw e;
      }
    },

    signOut: () => auth.signOut(),

    /* This user's quizzes, newest first. */
    async list() {
      const snap = await db.collection('quizzes').where('owner', '==', uid()).get();
      return snap.docs.map(d => ({ ...strip(d.data()), id: d.id })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    async save(quiz) {
      const data = clean({ ...strip(quiz), owner: uid(), updatedAt: Date.now() });
      delete data.id;
      await db.collection('quizzes').doc(quiz.id).set(data);
      return { ...strip(data), id: quiz.id };
    },

    remove: id => db.collection('quizzes').doc(id).delete(),

    /* Saves a picture (a data: URL) and returns its reference, e.g. "fs:ab12…". */
    async uploadImage(dataUrl) {
      const bytes = new TextEncoder().encode(dataUrl);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', bytes)), b => b.toString(16).padStart(2, '0')).join('').slice(0, 20);
      const id = `${uid().slice(0, 10)}-${hash}`;
      const ref = db.collection('images').doc(id);
      await ref.set({ owner: uid(), data: dataUrl, createdAt: Date.now() });
      images.set(`fs:${id}`, dataUrl);
      return `fs:${id}`;
    },

    async removeImage(path) {
      if (!path?.startsWith('fs:')) return;
      images.delete(path);
      await db.collection('images').doc(path.slice(3)).delete().catch(() => { });
    },

    /* Turns a picture reference into something an <img> can show. */
    async imageUrl(path) {
      if (!path) return '';
      if (/^(https?:|data:|blob:)/.test(path)) return path;
      if (!path.startsWith('fs:')) return '';
      if (!images.has(path)) {
        const doc = await db.collection('images').doc(path.slice(3)).get();
        images.set(path, doc.exists ? doc.data().data : '');
      }
      return images.get(path);
    },

    /* "Share a copy": saves a snapshot of the quiz and returns a link to it. */
    async share(quiz) {
      const id = randomId();
      await db.collection('shares').doc(id).set(clean({ owner: uid(), createdAt: Date.now(), quiz: strip({ ...quiz, id: undefined }) }));
      return new URL(`admin.html?share=${id}`, location.href).href;
    },

    /* Logs a hosted game for the stats page (who hosted what, how many players). */
    recordGame(quiz, players) {
      if (!user) return;
      db.collection('games').add({ owner: user.uid, at: Date.now(), quizId: quiz.id || '', quizTitle: quiz.title || '', players })
        .catch(() => { });
      db.collection('users').doc(user.uid).set({
        gamesHosted: firebase.firestore.FieldValue.increment(1),
        playersHosted: firebase.firestore.FieldValue.increment(players),
        lastGameAt: Date.now(),
      }, { merge: true }).catch(() => { });
    },

    /* True when the signed-in person is the Quizzle owner (the database decides). */
    async isAdmin() {
      if (!user) return false;
      try { await db.collection('users').limit(1).get(); return true; } catch { return false; }
    },

    /* Everything the owner's stats page needs. Fails for anyone else. */
    async adminData() {
      const [users, quizzes, games] = await Promise.all(['users', 'quizzes', 'games'].map(c => db.collection(c).get()));
      return {
        users: users.docs.map(d => ({ ...d.data(), uid: d.id })),
        quizzes: quizzes.docs.map(d => { const q = d.data(); return { id: d.id, owner: q.owner, title: q.title, emoji: q.emoji, questions: (q.questions || []).length, updatedAt: q.updatedAt, lang: q.lang }; }),
        games: games.docs.map(d => ({ ...d.data(), id: d.id })),
      };
    },

    async getShare(id) {
      const doc = await db.collection('shares').doc(id).get();
      return doc.exists ? JSON.parse(JSON.stringify(doc.data().quiz)) : null;
    },
  };
})();
