/** Escape text for safe insertion into HTML text/attribute context. */
function escapeHtml(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

/**
 * Single-pass {{placeholder}} substitution. Uses a replacer function so "$&"-style
 * sequences in values are never interpreted (String.replace with a string does).
 */
function fillTemplate(template, values) {
  return template.replace(/{{\s*(\w+)\s*}}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match
  );
}

/** Express 4 does not catch rejected promises from async handlers; this does. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { escapeHtml, fillTemplate, asyncHandler };
