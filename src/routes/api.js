const express = require('express');
const sessionStore = require('../services/sessionStore');

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

module.exports = router;