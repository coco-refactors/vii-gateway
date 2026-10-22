const crypto = require('crypto');
const config = require('../config');
const storage = require('./storage');

const SESSIONS = 'sessions';
const RESOURCE_LINKS = 'resourceLinks'; // `${platformKey}::${resourceLinkId}` -> questId

const linkKey = (platformKey, resourceLinkId) => `${platformKey}::${resourceLinkId}`;
const clone = (obj) => (obj ? JSON.parse(JSON.stringify(obj)) : null);

class SessionStore {
  /**
   * Create and persist a new launch session (student or instructor).
   */
  createSession({
    questId,
    platformKey,
    issuer,
    clientId,
    deploymentId,
    sub,
    role, // 'student' | 'instructor'
    studentName,
    studentEmail,
    courseTitle,
    resourceLinkId,
    assignmentTitle,
    ags, // { lineitem, lineitems, scopes } | null
    vaultUsername,
    vaultProvisioned,
  }) {
    const token = crypto.randomBytes(24).toString('hex');
    const now = Date.now();
    const session = {
      id: crypto.randomUUID(),
      token,
      questId: questId ? parseInt(questId, 10) : null,
      platformKey,
      issuer,
      clientId,
      deploymentId: deploymentId || null,
      sub: String(sub),
      canvasUserId: String(sub),
      role,
      studentName: studentName || 'Student',
      studentEmail: studentEmail || '',
      courseTitle: courseTitle || 'Canvas Course',
      resourceLinkId: String(resourceLinkId),
      assignmentTitle: assignmentTitle || 'Quest Assignment',
      ags: ags || null,
      vaultUsername: vaultUsername || null,
      vaultProvisioned: Boolean(vaultProvisioned),
      isCompleted: false,
      vaultPersisted: false,
      gradePassedBack: false,
      score: null,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + config.sessionTtlMs,
      completedAt: null,
    };

    storage.set(SESSIONS, token, session);
    return clone(session);
  }

  /** Look up a session by token (returns a copy; use updateSession to change it). */
  getSession(token) {
    if (!token || typeof token !== 'string') return null;
    const session = storage.get(SESSIONS, token);
    if (!session) return null;
    if (session.expiresAt && session.expiresAt < Date.now()) {
      storage.delete(SESSIONS, token);
      return null;
    }
    return clone(session);
  }

  /** Merge `patch` into a stored session and persist. */
  updateSession(token, patch) {
    const session = storage.get(SESSIONS, token);
    if (!session) return null;
    const updated = { ...session, ...patch };
    storage.set(SESSIONS, token, updated);
    return clone(updated);
  }

  /** Mark a session completed (idempotent: a completed session keeps its original score). */
  completeSession(token, score = 1.0, extra = {}) {
    const session = storage.get(SESSIONS, token);
    if (!session) return null;
    if (session.isCompleted) return clone(session);
    return this.updateSession(token, {
      isCompleted: true,
      score: parseFloat(score),
      completedAt: new Date().toISOString(),
      ...extra,
    });
  }

  /** Newest session for this user + assignment (used to show "completed" on relaunch). */
  findLatestSession({ platformKey, resourceLinkId, sub, role }) {
    const matches = storage
      .values(SESSIONS)
      .filter(
        (s) =>
          s.platformKey === platformKey &&
          s.resourceLinkId === String(resourceLinkId) &&
          s.sub === String(sub) &&
          s.role === role &&
          (!s.expiresAt || s.expiresAt >= Date.now())
      )
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return clone(matches[0]);
  }

  /** Assigned quest ID for a Canvas assignment (resource link), scoped to the platform. */
  getQuestForResource(platformKey, resourceLinkId) {
    return storage.get(RESOURCE_LINKS, linkKey(platformKey, resourceLinkId)) || null;
  }

  /** Bind a quest ID to a Canvas assignment (survives restarts). */
  bindQuestToResource(platformKey, resourceLinkId, questId) {
    storage.set(RESOURCE_LINKS, linkKey(platformKey, resourceLinkId), parseInt(questId, 10));
  }

  pruneExpired() {
    return storage.prune(SESSIONS, (s) => s.expiresAt && s.expiresAt < Date.now());
  }
}

module.exports = new SessionStore();
