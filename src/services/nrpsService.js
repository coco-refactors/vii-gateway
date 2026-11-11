const axios = require('axios');
const { SCOPES, withToken } = require('./canvasToken');
const { findPlatform } = require('./platformRegistry');
const { classifyRole } = require('./ltiValidator');
const { safeDetail } = require('../utils/redact');

const MAX_PAGES = 50;

/** URL of the next page from an HTTP Link header (`<url>; rel="next"`), or null. */
function nextLink(header) {
  if (!header) return null;
  for (const part of String(header).split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

async function fetchPage(platform, url) {
  return withToken(platform, [SCOPES.nrps], (token) =>
    axios.get(url, {
      headers: {
        Accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    })
  );
}

/**
 * Course roster from Canvas (Names and Role Provisioning Service), every page. The result is held in
 * memory for the request that asked for it and contains only the Canvas user id, role and status:
 * names, emails and pictures are dropped as they arrive.
 *
 * @returns {Promise<{ok: true, members: Array}|{ok: false, status: number, error: string}>}
 */
async function fetchRoster(session) {
  const platform = findPlatform(session.issuer, session.clientId);
  if (!platform || !platform.authTokenUrl || !session.nrpsUrl) {
    return { ok: false, status: 404, error: 'This launch has no roster service' };
  }
  const members = [];
  let url = session.nrpsUrl;
  try {
    for (let page = 0; url && page < MAX_PAGES; page += 1) {
      const res = await fetchPage(platform, url);
      for (const m of (res.data && res.data.members) || []) {
        if (!m || !m.user_id) continue;
        members.push({ userId: String(m.user_id), role: classifyRole(m.roles) || 'other', status: m.status || 'Active' });
      }
      url = nextLink(res.headers && res.headers.link);
    }
    return { ok: true, members };
  } catch (err) {
    const status = err.response ? err.response.status : 0;
    console.warn(`[NRPS] Roster request failed: ${status ? `HTTP ${status}` : safeDetail(err.message)}`);
    if (status === 401 || status === 403) return { ok: false, status: 403, error: 'Canvas refused the roster request (scope not granted?)' };
    return { ok: false, status: 502, error: 'Canvas roster service is unavailable' };
  }
}

module.exports = { fetchRoster, nextLink };
