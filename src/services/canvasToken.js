const crypto = require('crypto');
const axios = require('axios');
const { SignJWT } = require('jose');
const keyStore = require('./keyStore');

const SCOPES = {
  score: 'https://purl.imsglobal.org/spec/lti-ags/scope/score',
  lineItemRead: 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
  lineItem: 'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
  resultRead: 'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
  nrps: 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly',
};

const tokenCache = new Map(); // `${clientId}|${tokenUrl}|${sorted scopes}` -> { accessToken, expiresAt }

/**
 * Canvas service token (OAuth2 client_credentials with a JWT client assertion signed by the tool key,
 * RFC 7523) for any combination of scopes. Each scope set is cached separately until shortly before
 * it expires.
 */
async function getAccessToken(platform, scopes, { force = false } = {}) {
  const scopeList = [...new Set(scopes)].sort();
  const cacheKey = `${platform.clientId}|${platform.authTokenUrl}|${scopeList.join(' ')}`;
  const cached = tokenCache.get(cacheKey);
  if (!force && cached && cached.expiresAt > Date.now() + 30000) return cached.accessToken;

  const { privateKey, kid } = await keyStore.getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
    .setIssuer(platform.clientId)
    .setSubject(platform.clientId)
    .setAudience(platform.tokenAudience || platform.authTokenUrl)
    .setIssuedAt(now)
    .setExpirationTime(now + 60)
    .setJti(crypto.randomUUID())
    .sign(privateKey);

  const form = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    scope: scopeList.join(' '),
  });
  const res = await axios.post(platform.authTokenUrl, form.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 10000,
  });
  if (!res.data || !res.data.access_token) {
    throw new Error('token endpoint returned no access_token');
  }
  tokenCache.set(cacheKey, {
    accessToken: res.data.access_token,
    expiresAt: Date.now() + (parseInt(res.data.expires_in, 10) || 3600) * 1000,
  });
  return res.data.access_token;
}

/**
 * Run `call(token)` with a service token; if Canvas answers 401 (token revoked or expired early), get a
 * fresh token and try once more.
 */
async function withToken(platform, scopes, call) {
  try {
    return await call(await getAccessToken(platform, scopes));
  } catch (err) {
    if (!err.response || err.response.status !== 401) throw err;
    return call(await getAccessToken(platform, scopes, { force: true }));
  }
}

module.exports = { SCOPES, getAccessToken, withToken };
