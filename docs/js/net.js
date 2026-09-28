/* Peer-to-peer networking. The host's browser is the game server: it registers the
   Game PIN on the free public PeerJS relay (no account needed) and phones connect to
   it directly over WebRTC. */

const PING_MS = 2000;
const DEAD_MS = 6000;

/* ── Host side ──────────────────────────────────────────────────────────── */
function startHostPeer(pin, { onMessage, onClose }) {
  return new Promise((resolve, reject) => {
    const peer = new Peer(CONFIG.peerPrefix + pin, { debug: 1 });
    const conns = new Map();
    let opened = false;

    peer.on('open', () => {
      opened = true;
      resolve({
        send(connId, msg) {
          const c = conns.get(connId);
          if (c?.open) try { c.send(msg); } catch { /* connection closing */ }
        },
        broadcast(msg) { for (const c of conns.values()) if (c.open) try { c.send(msg); } catch { } },
        destroy() { peer.destroy(); },
      });
    });

    peer.on('connection', conn => {
      const id = conn.connectionId;
      let lastSeen = Date.now();
      const watchdog = setInterval(() => {
        if (Date.now() - lastSeen > DEAD_MS) conn.close();
      }, PING_MS);
      conn.on('open', () => conns.set(id, conn));
      conn.on('data', msg => {
        lastSeen = Date.now();
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'ping') return conn.send({ t: 'pong' });
        onMessage(id, msg, data => conn.open && conn.send({ t: 'reply', rid: msg.rid, data }));
      });
      const closed = () => {
        clearInterval(watchdog);
        if (conns.delete(id)) onClose(id);
      };
      conn.on('close', closed);
      conn.on('error', closed);
    });

    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', err => {
      if (!opened) { peer.destroy(); reject(err); }
      else console.warn('peer error', err.type);
    });
  });
}

/* ── Player side ────────────────────────────────────────────────────────── */
class PlayerLink {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.peer = null;
    this.conn = null;
    this.pin = null;
    this.pending = new Map();
    this.rid = 0;
    this.lastPong = 0;
    this.onReconnect = null;
    setInterval(() => this.heartbeat(), PING_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.pin) this.heartbeat(true);
    });
  }

  ensurePeer() {
    if (this.peer && !this.peer.destroyed) {
      if (this.peer.disconnected) this.peer.reconnect();
      return this.peer.open ? Promise.resolve(this.peer) : new Promise(r => this.peer.once('open', () => r(this.peer)));
    }
    return new Promise((resolve, reject) => {
      const peer = new Peer({ debug: 1 });
      this.peer = peer;
      peer.once('open', () => resolve(peer));
      peer.on('error', err => {
        if (err.type === 'peer-unavailable') this.failConnect?.(new Error('no-game'));
        else if (!peer.open) reject(err);
      });
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => peer.reconnect(), 1000); });
    });
  }

  /* Opens a connection to the host with this PIN. Rejects with 'no-game' if nobody is hosting it. */
  async connect(pin) {
    if (this.conn?.open && this.pin === pin) return;
    this.pin = pin;
    this.onStatus('connecting');
    const peer = await this.ensurePeer();
    this.conn?.close();
    await new Promise((resolve, reject) => {
      const conn = peer.connect(CONFIG.peerPrefix + pin, { reliable: true });
      this.conn = conn;
      const timer = setTimeout(() => { this.failConnect = null; conn.close(); reject(new Error('timeout')); }, 7000);
      this.failConnect = err => { clearTimeout(timer); this.failConnect = null; reject(err); };
      conn.on('open', () => {
        clearTimeout(timer);
        this.failConnect = null;
        this.lastPong = Date.now();
        this.onStatus('online');
        resolve();
      });
      conn.on('data', msg => {
        this.lastPong = Date.now();
        if (msg?.t === 'pong') return;
        if (msg?.t === 'host-reload') { setTimeout(() => this.lost(), 1500); return; } // host page is refreshing
        if (msg?.t === 'reply') {
          this.pending.get(msg.rid)?.(msg.data);
          this.pending.delete(msg.rid);
          return;
        }
        this.onMessage(msg);
      });
      conn.on('close', () => { if (this.conn === conn) this.lost(); });
    });
  }

  request(msg, timeout = 8000) {
    return new Promise(resolve => {
      if (!this.conn?.open) return resolve({ error: 'Not connected. Check your internet.' });
      const rid = ++this.rid;
      this.pending.set(rid, resolve);
      this.conn.send({ ...msg, rid });
      setTimeout(() => {
        if (this.pending.delete(rid)) resolve({ error: 'The game did not answer. Try again!' });
      }, timeout);
    });
  }

  send(msg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  heartbeat(urgent = false) {
    if (!this.pin || this.reconnecting) return;
    if (!this.conn?.open || Date.now() - this.lastPong > (urgent ? 4000 : DEAD_MS)) return this.lost();
    this.conn.send({ t: 'ping' });
  }

  /* Connection dropped (phone slept, Wi-Fi blip, host refreshed): keep retrying. */
  async lost() {
    if (this.reconnecting || !this.pin) return;
    this.reconnecting = true;
    this.onStatus('reconnecting');
    const pin = this.pin;
    for (let attempt = 0; this.pin === pin; attempt++) {
      try {
        this.conn = null;
        await this.connect(pin);
        this.reconnecting = false;
        await this.onReconnect?.();
        return;
      } catch (err) {
        if (attempt >= 20) { this.reconnecting = false; this.onStatus('gone'); return; }
        await new Promise(r => setTimeout(r, Math.min(1000 + attempt * 500, 4000)));
      }
    }
    this.reconnecting = false;
  }

  disconnect() {
    this.pin = null;
    this.conn?.close();
    this.conn = null;
  }
}
