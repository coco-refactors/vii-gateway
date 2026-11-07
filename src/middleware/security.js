const config = require('../config');
const { listPlatforms } = require('../services/platformRegistry');

/** Origin (scheme + host + port) of a URL, or null if it is not a valid URL. */
function origin(url) {
  try {
    return new URL(url).origin;
  } catch (err) {
    return null;
  }
}

/**
 * Allow the gateway pages to be embedded in the Canvas iframe (and only there).
 * Uses CSP frame-ancestors; X-Frame-Options is deliberately NOT set, because it cannot allow a
 * specific other origin and would block the Canvas iframe.
 *
 * Default allow-list: this gateway, Canvas cloud, and the origins of every registered platform
 * (issuer + login URL, which covers self-hosted Canvas). Override with FRAME_ANCESTORS.
 */
function frameAncestors() {
  if (config.frameAncestors.length) return ["'self'", ...config.frameAncestors];
  const origins = new Set(["'self'", 'https://*.instructure.com', 'https://*.canvaslms.com']);
  for (const p of listPlatforms()) {
    [origin(p.issuer), origin(p.authLoginUrl)].filter(Boolean).forEach((o) => origins.add(o));
  }
  return [...origins];
}

function securityHeaders(req, res, next) {
  res.set('Content-Security-Policy', `frame-ancestors ${frameAncestors().join(' ')}`);
  res.removeHeader('X-Frame-Options');
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('Referrer-Policy', 'no-referrer');
  next();
}

module.exports = { securityHeaders };
