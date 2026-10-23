const crypto = require('crypto');
const config = require('../config');
const storage = require('./storage');
const { LtiError } = require('./ltiErrors');

const LOGIN_STATES = 'loginStates';

const randomValue = (bytes = 32) => crypto.randomBytes(bytes).toString('hex');

/**
 * Generate an unguessable `state` value for the OIDC login and store the transaction
 * (state -> nonce + platform + target) so the launch can be matched to the login that started it.
 */
function generateState() {
  return randomValue(32);
}

/** Generate the `nonce` that Canvas must echo inside the signed id_token. */
function generateNonce() {
  return randomValue(32);
}

function createLoginTransaction({ platform, targetLinkUri, loginHint, ltiMessageHint }) {
  const state = generateState();
  const nonce = generateNonce();
  const now = Date.now();
  storage.set(LOGIN_STATES, state, {
    state,
    nonce,
    issuer: platform.issuer,
    clientId: platform.clientId,
    targetLinkUri,
    loginHint,
    ltiMessageHint: ltiMessageHint || null,
    createdAt: now,
    expiresAt: now + config.loginStateTtlMs,
  });
  return { state, nonce };
}