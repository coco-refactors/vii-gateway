const express = require('express');
const sessionStore = require('../services/sessionStore');
const vaultClient = require('../services/vaultClient');
const { asyncHandler } = require('../utils/html');

const router = express.Router();

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
 * Polling endpoint called by the Canvas iframe
 */
router.get('/status/:token', (req, res) => {
  const { token } = req.params;
  const session = sessionStore.getSession(token);

  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  res.json({
    completed: Boolean(session.isCompleted),
    gradePassedBack: Boolean(session.gradePassedBack),
    vaultPersisted: Boolean(session.vaultPersisted),
    score: session.score,
  });
});

/**
 * Returns a fresh VAuLT login for the Canvas session's user.
 * The mobile app supplies the session token after scanning the QR code.
 */
router.post(
  '/session/:token/vault-login',
  asyncHandler(async (req, res) => {
    const session = sessionStore.getSession(req.params.token);
    if (!session) {
      return res.status(404).json({ error: 'Session not found or expired' });
    }
    const vaultAuth = await vaultClient.authenticateUsername(session.vaultUsername);
    if (!vaultAuth) {
      return res.status(502).json({ error: 'VAuLT login is unavailable, try again' });
    }
    sessionStore.updateSession(session.token, { vaultProvisioned: true });
    res.json({ username: session.vaultUsername, role: session.role, vault: vaultAuth });
  })
);

module.exports = router;