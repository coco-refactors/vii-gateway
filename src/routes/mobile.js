const express = require('express');
const router = express.Router();
const config = require('../config');
const { escapeHtml } = require('../utils/html');

/**
 * GET /launch/m?code=..&quest=..  The QR code on the launch page holds this link. The VAuLT app reads it
 * directly when it scans the code. If the iPhone camera scans it instead, Safari opens this page, whose
 * button hands the same values to the app (vault://launch?...). Viewing the page does not use up the code.
 */
router.get('/m', (req, res) => {
  const code = String(req.query.code || '');
  const quest = parseInt(req.query.quest, 10);
  res.set('Cache-Control', 'no-store');
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(code) || !quest) {
    return res.status(400).type('html').send('<p style="font-family:sans-serif;padding:24px;">This link is not valid. Reload the page in Canvas for a new QR code.</p>');
  }
  const appLink = `vault://launch?gateway=${encodeURIComponent(config.gatewayPublicUrl)}&code=${encodeURIComponent(code)}&quest=${quest}`;
  res.type('html').send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Open in VAuLT</title></head>
<body style="font-family: -apple-system, sans-serif; padding: 32px; text-align: center; color: #0f172a;">
  <h2>Open this experience in the VAuLT app</h2>
  <p><a href="${escapeHtml(appLink)}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:600;">Open in VAuLT</a></p>
  <p style="color:#64748b;font-size:14px;">Don't have the app? Install VAuLT from the App Store, then scan the QR code again.</p>
</body></html>`);
});

module.exports = router;
