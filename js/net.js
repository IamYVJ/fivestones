// PeerJS (WebRTC) transport. Star topology: the host's browser is the server.
// Room code maps directly to the host's Peer ID so no lookup service is needed.
const PREFIX = 'localfivestones-v1-';
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Default: PeerJS public signalling cloud. Set host/port/path here for a self-hosted broker.
export const BROKER_CONFIG = {};

export const normCode = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
export function genCode() {
  let c = '';
  const r = crypto.getRandomValues(new Uint8Array(4));
  for (const b of r) c += ALPHABET[b % ALPHABET.length];
  return c;
}

const mkPeer = id => new window.Peer(id, { ...BROKER_CONFIG, debug: 0 });

export class HostNet {
  constructor() { this.peer = null; this.conns = new Map(); }

  open(code, { onMessage, onDisconnect }) {
    return new Promise((resolve, reject) => {
      const peer = mkPeer(PREFIX + code);
      this.peer = peer;
      const timer = setTimeout(() => { peer.destroy(); reject(new Error('timeout')); }, 10000);
      peer.on('open', () => { clearTimeout(timer); resolve(); });
      peer.on('error', e => { clearTimeout(timer); reject(e); });
      peer.on('connection', conn => {
        conn.on('open', () => this.conns.set(conn.peer, conn));
        conn.on('data', d => onMessage(conn.peer, d));
        const gone = () => { if (this.conns.get(conn.peer) === conn) this.conns.delete(conn.peer); onDisconnect(conn.peer); };
        conn.on('close', gone);
        conn.on('error', gone);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* ignore */ } });
    });
  }
  send(id, msg) {
    const c = this.conns.get(id);
    if (c && c.open) c.send(msg);
  }
  close() { try { this.peer && this.peer.destroy(); } catch { /* ignore */ } this.peer = null; this.conns.clear(); }
}

export class ClientNet {
  constructor() { this.peer = null; this.conn = null; }

  join(code, { onMessage, onClose }) {
    return new Promise((resolve, reject) => {
      const peer = mkPeer();
      this.peer = peer;
      let done = false;
      const fail = e => { if (done) return; done = true; clearTimeout(timer); this.close(); reject(e); };
      const timer = setTimeout(() => fail(new Error('timeout')), 12000);
      peer.on('error', fail);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code, { reliable: true });
        this.conn = conn;
        conn.on('open', () => { if (done) return; done = true; clearTimeout(timer); resolve(); });
        conn.on('data', onMessage);
        conn.on('close', () => { if (done) onClose(); else fail(new Error('closed')); });
        conn.on('error', () => { if (done) onClose(); else fail(new Error('closed')); });
      });
    });
  }
  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }
  close() {
    try { this.conn && this.conn.close(); } catch { /* ignore */ }
    try { this.peer && this.peer.destroy(); } catch { /* ignore */ }
    this.conn = null; this.peer = null;
  }
}
