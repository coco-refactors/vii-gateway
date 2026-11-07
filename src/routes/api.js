const express = require('express');
const router = express.Router();

const sessionStore = require('../services/sessionStore');
const vaultClient = require('../services/vaultClient');
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

module.exports = router;
