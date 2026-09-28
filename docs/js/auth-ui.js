/* The "Sign in with Google" screen shared by the host and admin pages, and the small
   "signed in as" chip with a sign-out button. */
const GOOGLE_G = '<svg viewBox="0 0 48 48" width="22" height="22" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.1 5.3-4.6 7l7.2 5.6c4.2-3.9 7.1-9.6 7.1-17z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.3.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.2-5.6c-2.2 1.5-5.1 2.4-8.7 2.4-6.3 0-11.6-4.2-13.5-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>';

function showSignIn(container, { title, intro, onSignedIn, backLink = '' }) {
  container.innerHTML = `
    <div class="join">
      ${logoHtml('xl')}
      <div class="join-card pop-in signin-card">
        <div class="join-title">${title}</div>
        <p class="gh-status">${intro}</p>
        <button class="google-btn" id="google">${GOOGLE_G}<span>${t('auth.google')}</span></button>
        <div class="form-error" role="alert"></div>
      </div>
      ${langButton('link-btn')}
      ${backLink}
    </div>`;
  const btn = container.querySelector('#google');
  btn.onclick = async () => {
    btn.disabled = true;
    container.querySelector('.form-error').textContent = '';
    try {
      await Store.signIn();
      if (Store.user) onSignedIn();
    } catch (err) {
      console.error(err);
      container.querySelector('.form-error').textContent = t('auth.failed');
    } finally {
      btn.disabled = false;
    }
  };
}

function userChip() {
  const u = Store.user;
  if (!u) return '';
  const name = u.displayName || u.email || '';
  return `<span class="user-chip" title="${esc(u.email || '')}">
    ${u.photoURL ? `<img src="${esc(u.photoURL)}" alt="" referrerpolicy="no-referrer">` : '<span class="user-dot">👤</span>'}
    <span class="user-name" dir="auto">${esc(name.split(' ')[0])}</span>
    <button class="user-out" onclick="Store.signOut().then(() => location.reload())">${t('auth.signOut')}</button>
  </span>`;
}
