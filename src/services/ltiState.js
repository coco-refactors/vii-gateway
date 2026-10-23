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

/**
 * Validate the `state` returned with the launch. A state is single-use: it is deleted the first
 * time it is presented, so a replayed launch is rejected. Returns the stored login transaction.
 */
function consumeState(state) {
  if (!state || typeof state !== 'string' || state.length > 256) {
    throw new LtiError('STATE_MISSING', 'The launch is missing its security state. Please relaunch from Canvas.', {
      status: 400,
    });
  }

  const tx = storage.get(LOGIN_STATES, state);
  if (!tx) {
    throw new LtiError(
      'STATE_INVALID',
      'The launch state is unknown or was already used. Please relaunch from Canvas.',
      { status: 401 }
    );
  }

  storage.delete(LOGIN_STATES, state); // one-time use

  if (tx.expiresAt < Date.now()) {
    throw new LtiError('STATE_EXPIRED', 'The launch took too long to complete. Please relaunch from Canvas.', {
      status: 401,
    });
  }
  return tx;
}