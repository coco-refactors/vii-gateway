const crypto = require('crypto');
const config = require('../config');

const TOLERANCE_SEC = 300;
const seenSignatures = new Map(); // signature -> expiry (ms); blocks a captured request being replayed

/**
 * Verify a signed hook from Vii (contract: X-Vii-Timestamp, X-Vii-Signature: v1=<hex HMAC-SHA256 of
 * "<timestamp>.<raw body>">). The HMAC is recomputed over the exact bytes received and compared in
 * constant time; timestamps more than 5 minutes off are refused, and each signature is accepted once.
 *
 * @returns {{ ok: true } | { ok: false, status: number, error: string }}
 */
function verifyHook(rawBody, timestampHeader, signatureHeader, now = Date.now()) {
  if (!config.vii.hookSecret || config.vii.hookSecret.length < 32) {
    return { ok: false, status: 503, error: 'Hook secret is not configured' };
  }
  const timestamp = String(timestampHeader || '');
  const signature = String(signatureHeader || '');
  if (!/^\d{1,12}$/.test(timestamp) || !/^v1=[0-9a-f]{64}$/.test(signature) || !Buffer.isBuffer(rawBody)) {
    return { ok: false, status: 401, error: 'Missing or malformed signature' };
  }
  if (Math.abs(now / 1000 - Number(timestamp)) > TOLERANCE_SEC) {
    return { ok: false, status: 401, error: 'Signature timestamp is too old or in the future' };
  }

  const expected = `v1=${crypto
    .createHmac('sha256', config.vii.hookSecret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest('hex')}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, status: 401, error: 'Invalid signature' };
  }

  for (const [sig, expiry] of seenSignatures) if (expiry < now) seenSignatures.delete(sig);
  if (seenSignatures.has(signature)) {
    return { ok: false, status: 401, error: 'Replayed request' };
  }
  seenSignatures.set(signature, now + TOLERANCE_SEC * 2 * 1000);
  return { ok: true };
}

module.exports = { verifyHook };
