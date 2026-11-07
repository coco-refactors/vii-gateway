const crypto = require('crypto');
const config = require('../config');
const storage = require('./storage');
const { mappingKey } = require('./platformRegistry');

const SESSIONS = 'sessions'; // launchRef -> session
const STATUS_TOKENS = 'statusTokens'; // statusToken -> launchRef (the launch page's polling credential)
const LAUNCH_CODES = 'launchCodes'; // code -> { launchRef, expiresAt } (single use, in the QR code)
const RESOURCE_LINKS = 'resourceLinks'; // issuer|deployment::resourceLink -> questId (durable)

const clone = (obj) => (obj ? JSON.parse(JSON.stringify(obj)) : null);
const random = (bytes) => crypto.randomBytes(bytes).toString('base64url');

class SessionStore {
  /**
   * Create a short-lived launch session. It holds only what grade passback and the roster need:
   * opaque Canvas user id (sub), role, the experience, the Vii username derived from sub, the AGS line
   * item and NRPS URL from the launch, and the ids of attempts already sent to Canvas.
   * No names, emails, course or assignment titles, scores or completion flags.
   */
  createSession({ questId, issuer, clientId, deploymentId, resourceLinkId, sub, role, vaultUsername, ags, nrpsUrl }) {
    const now = Date.now();
    const session = {
      id: random(24), // the launch reference Vii stores with the attempt (URL-safe, 32 chars)
      statusToken: random(24),
      questId: questId ? parseInt(questId, 10) : null,
      issuer,
      clientId,
      deploymentId,
      resourceLinkId: resourceLinkId ? String(resourceLinkId) : null,
      sub: String(sub),
      role, // 'student' | 'instructor'
      vaultUsername: vaultUsername || null,
      ags: ags ? { lineitem: ags.lineitem, scopes: ags.scopes || [] } : null,
      nrpsUrl: nrpsUrl || null,
      sentAttemptIds: [],
      createdAt: now,
      expiresAt: now + config.sessionTtlMs,
    };
    storage.set(SESSIONS, session.id, session);
    storage.set(STATUS_TOKENS, session.statusToken, session.id);
    return clone(session);
  }

  /** Session by launch reference (returns a copy). Expired sessions are deleted on sight. */
  getSession(launchRef) {
    if (!launchRef || typeof launchRef !== 'string' || launchRef.length > 64) return null;
    const session = storage.get(SESSIONS, launchRef);
    if (!session) return null;
    if (session.expiresAt < Date.now()) {
      this.deleteSession(session.id);
      return null;
    }
    return clone(session);
  }

  getByStatusToken(token) {
    if (!token || typeof token !== 'string' || token.length > 64) return null;
    const launchRef = storage.get(STATUS_TOKENS, token);
    return launchRef ? this.getSession(launchRef) : null;
  }

  updateSession(launchRef, patch) {
    const session = storage.get(SESSIONS, launchRef);
    if (!session) return null;
    const updated = { ...session, ...patch };
    storage.set(SESSIONS, launchRef, updated);
    return clone(updated);
  }

  /** Remember that this Vii attempt reached Canvas (id only), so a resend is not posted twice. */
  markAttemptSent(launchRef, attemptId) {
    const session = storage.get(SESSIONS, launchRef);
    if (!session) return null;
    const ids = new Set(session.sentAttemptIds || []);
    ids.add(Number(attemptId));
    return this.updateSession(launchRef, { sentAttemptIds: [...ids] });
  }

  deleteSession(launchRef) {
    const session = storage.get(SESSIONS, launchRef);
    if (session) storage.delete(STATUS_TOKENS, session.statusToken);
    storage.delete(SESSIONS, launchRef);
  }

  /** New single-use launch code for the QR code (expires after LAUNCH_CODE_TTL_SEC, default 10 minutes). */
  createLaunchCode(launchRef) {
    const code = random(24);
    storage.set(LAUNCH_CODES, code, { launchRef, expiresAt: Date.now() + config.launchCodeTtlMs });
    return code;
  }

  /**
   * Take a launch code out of the store. Returns { session, restore } or null. The code is deleted
   * immediately (single use); call restore() if the exchange fails afterwards for a reason that is
   * not the student's fault (Vii unreachable), so the same QR code can be scanned again.
   */
  takeLaunchCode(code) {
    if (!code || typeof code !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(code)) return null;
    const record = storage.get(LAUNCH_CODES, code);
    if (!record) return null;
    storage.delete(LAUNCH_CODES, code);
    if (record.expiresAt < Date.now()) return null;
    const session = this.getSession(record.launchRef);
    if (!session) return null;
    return { session, restore: () => storage.set(LAUNCH_CODES, code, record) };
  }

  /** Experience assigned to a Canvas resource link, keyed by issuer + deployment id + resource link id. */
  getQuestForResource(issuer, deploymentId, resourceLinkId) {
    return storage.get(RESOURCE_LINKS, mappingKey(issuer, deploymentId, resourceLinkId)) || null;
  }

  bindQuestToResource(issuer, deploymentId, resourceLinkId, questId) {
    storage.set(RESOURCE_LINKS, mappingKey(issuer, deploymentId, resourceLinkId), parseInt(questId, 10));
  }

  pruneExpired() {
    const now = Date.now();
    const expired = storage.values(SESSIONS).filter((s) => s.expiresAt < now);
    expired.forEach((s) => this.deleteSession(s.id));
    const codes = storage.prune(LAUNCH_CODES, (r) => r.expiresAt < now);
    return expired.length + codes;
  }
}

module.exports = new SessionStore();
