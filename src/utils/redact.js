const crypto = require('crypto');

/**
 * Log redaction. Log lines may say WHAT happened, never WHO it happened to or WHAT they answered.
 *   hashId(value)  -> short, stable, non-reversible tag ("u:3f9a1c0b2d") so related lines can be matched
 *   safeDetail(s)  -> drops token claims, emails, URLs with ids and long numbers from a detail string
 * Use these in every console.* call that touches launch, user, roster or grade data.
 */
function hashId(value) {
  if (value === undefined || value === null || value === '') return 'u:-';
  return `u:${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 10)}`;
}

function safeDetail(detail) {
  return String(detail === undefined || detail === null ? '' : detail)
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/https?:\/\/[^\s"']+/g, (u) => {
      try {
        return `${new URL(u).origin}/[path]`;
      } catch (err) {
        return '[url]';
      }
    })
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]*/g, '[jwt]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
    .replace(/\b\d{6,}\b/g, '[id]')
    .slice(0, 300);
}

module.exports = { hashId, safeDetail };
