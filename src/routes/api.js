const express = require('express');
const router = express.Router();

const sessionStore = require('../services/sessionStore');
const vaultClient = require('../services/vaultClient');
const gradeService = require('../services/gradeService');
const { verifyHook } = require('../services/hookVerifier');
const { asyncHandler } = require('../utils/html');

const noStore = (res) => res.set('Cache-Control', 'no-store');

/**
 * Health check endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'vault-lms-gateway',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Polled by the launch page with its status token (not the QR code). No score and no completion data
 * are stored here any more.
 * INTERIM: this needs to be replaced with the live attempt state read from Vii (api-status block).
 */
router.get('/status/:token', (req, res) => {
  const session = sessionStore.getByStatusToken(req.params.token);
  if (!session || !session.questId) {
    return noStore(res).status(404).json({ error: 'Session not found' });
  }
  noStore(res).json({ available: false });
});

/**
 * The app exchanges the single-use launch code from the QR code for a Vii login of the Canvas user who
 * launched (created on first use), the experience id and the launch reference to attach to the attempt.
 * No separate Vii login for students or instructors. Nothing from Vii's answer is stored here.
 */
router.post(
  '/launch/redeem',
  asyncHandler(async (req, res) => {
    const taken = sessionStore.takeLaunchCode((req.body || {}).code);
    if (!taken) {
      return noStore(res).status(410).json({ error: 'This QR code has expired or was already used. Reload the page in Canvas for a new one.' });
    }
    const { session, restore } = taken;
    const vault = await vaultClient.authenticateUsername(session.vaultUsername, { timeout: 8000 });
    if (!vault) {
      restore(); // not the student's fault: the same QR code can be scanned again
      return noStore(res).status(502).json({ error: 'VAuLT login is unavailable, try again in a moment.' });
    }
    noStore(res).json({
      launchRef: session.id,
      questId: session.questId,
      role: session.role,
      username: session.vaultUsername,
      vault,
    });
  })
);

/** Validates the structure of a Vii attempt event. Returns an error message or null. */
function hookError(h) {
  if (!h || typeof h !== 'object') return 'body must be a JSON object';
  if (!['attempt.started', 'attempt.finished'].includes(h.event)) return 'unknown event';
  if (typeof h.launchRef !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(h.launchRef)) return 'launchRef missing';
  if (typeof h.viiUsername !== 'string' || !h.viiUsername) return 'viiUsername missing';
  if (!Number.isInteger(h.questId)) return 'questId missing';
  if (!h.attempt || !Number.isInteger(h.attempt.id) || !Number.isInteger(h.attempt.number)) return 'attempt id/number missing';
  if (h.event === 'attempt.finished') {
    if (typeof h.score !== 'number' || !(h.score >= 0 && h.score <= 1)) return 'score must be a number from 0 to 1';
    if (!h.content || !Array.isArray(h.content.tasks)) return 'content.tasks missing';
  }
  return null;
}

const inFlight = new Set(); // Tracks attempts being submitted so overlapping requests do not send the same attempt twice.

/**
 * Receives signed attempt events from Vii.
 * Returns 503 for retryable failures and 4xx for permanent errors.
 * The gateway does not store scores when Canvas is unavailable.
 */
router.post(
  '/hooks/vii/attempt',
  asyncHandler(async (req, res) => {
    const check = verifyHook(req.rawBody, req.get('x-vii-timestamp'), req.get('x-vii-signature'));
    if (!check.ok) return res.status(check.status).json({ error: check.error });

    const hook = req.body;
    const invalid = hookError(hook);
    if (invalid) return res.status(400).json({ error: invalid });

    const session = sessionStore.getSession(hook.launchRef);
    if (!session) return res.status(410).json({ error: 'Launch unknown or expired' });
    if (hook.viiUsername !== session.vaultUsername) return res.status(403).json({ error: 'Attempt belongs to another user' });
    if (hook.questId !== session.questId) return res.status(409).json({ error: 'Attempt is for another experience' });
    if (session.role !== 'student' || !session.ags || !session.ags.lineitem) {
      return res.json({ confirmed: true, graded: false, reason: 'no gradable Canvas line item for this launch' });
    }

    if (hook.event === 'attempt.started') {
      if (session.sentAttemptIds.length) return res.json({ confirmed: true, skipped: 'a graded attempt exists' });
      const progress = await gradeService.sendProgress(session, 'Started');
      return progress.ok ? res.json({ confirmed: true }) : res.status(progress.retryable ? 503 : 422).json({ error: 'Canvas did not accept the progress update' });
    }

    if (session.sentAttemptIds.includes(hook.attempt.id)) {
      return res.json({ confirmed: true, duplicate: true });
    }
    if (inFlight.has(hook.attempt.id)) {
      return res.status(503).json({ error: 'This attempt is being sent right now, retry later' });
    }
    inFlight.add(hook.attempt.id);
    try {
      const result = await gradeService.sendAttemptScore(session, hook);
      if (!result.ok) {
        return res.status(result.retryable ? 503 : 422).json({ error: 'Canvas did not accept the score', retryable: Boolean(result.retryable) });
      }
      sessionStore.markAttemptSent(session.id, hook.attempt.id);
      return res.json({ confirmed: true, graded: true });
    } finally {
      inFlight.delete(hook.attempt.id);
    }
  })
);

module.exports = router;
