const { escapeHtml } = require('../utils/html');

/**
 * An LTI launch failure. `publicMessage` is safe to show the user; `detail` is logged only.
 */
class LtiError extends Error {
  constructor(code, publicMessage, { status = 401, detail } = {}) {
    super(publicMessage);
    this.name = 'LtiError';
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.detail = detail;
  }
}

/**
 * Render a generic error page for a rejected launch. Never echoes request input and never
 * reveals expected keys/secrets.
 */
function renderLtiError(res, err) {
  const status = err.status || 500;
  res
    .status(status)
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Launch failed - VAuLT</title></head>
<body style="font-family: sans-serif; padding: 24px; color: #b91c1c;">
  <h2>${status} ${status === 403 ? 'Forbidden' : 'Launch could not be verified'}</h2>
  <p>${escapeHtml(err.publicMessage || 'The launch request was rejected.')}</p>
  <p style="color:#64748b;font-size:13px;">Error code: <code>${escapeHtml(err.code || 'UNKNOWN')}</code>. Please close this window and relaunch from Canvas. If it keeps happening, contact your instructor or administrator.</p>
</body></html>`);
}

module.exports = { LtiError, renderLtiError };
