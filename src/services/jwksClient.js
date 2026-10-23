const axios = require('axios');
const { createLocalJWKSet } = require('jose');
const { LtiError } = require('./ltiErrors');

const CACHE_TTL_MS = 60 * 60 * 1000; // re-fetch at most hourly...
const REFRESH_COOLDOWN_MS = 10 * 1000; // ...or on an unknown `kid`, but never more than every 10s
const cache = new Map(); // jwksUrl -> { keySet, fetchedAt }

async function fetchJwks(jwksUrl) {
  try {
    const res = await axios.get(jwksUrl, {
      timeout: 8000,
      headers: { Accept: 'application/json' },
      validateStatus: (s) => s === 200,
    });
    if (!res.data || !Array.isArray(res.data.keys) || res.data.keys.length === 0) {
      throw new Error('response has no "keys" array');
    }
    return res.data;
  } catch (err) {
    throw new LtiError('JWKS_UNAVAILABLE', 'Could not retrieve the Canvas signing keys. Please try again shortly.', {
      status: 502,
      detail: `JWKS fetch from ${jwksUrl} failed: ${err.message}`,
    });
  }
}

/**
 * Get a key set for a platform's published JWKS (the URL comes from our own registration, never
 * from the incoming token). Cached; `forceRefresh` handles Canvas key rotation.
 */
async function getKeySet(platform, { forceRefresh = false } = {}) {
  const entry = cache.get(platform.jwksUrl);
  const age = entry ? Date.now() - entry.fetchedAt : Infinity;
  const usable = entry && age < CACHE_TTL_MS && !(forceRefresh && age > REFRESH_COOLDOWN_MS);
  if (usable) return entry.keySet;

  const jwks = await fetchJwks(platform.jwksUrl);
  const keySet = createLocalJWKSet(jwks);
  cache.set(platform.jwksUrl, { keySet, fetchedAt: Date.now() });
  return keySet;
}

function clearCache() {
  cache.clear();
}

module.exports = { getKeySet, clearCache };