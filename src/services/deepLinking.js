const crypto = require('crypto');
const config = require('../config');
const storage = require('./storage');

const DL_TX = 'deepLinkTx';

/**
 * Server-side Deep Linking transaction: the return URL and opaque `data` from the verified instructor
 * request, kept for a few minutes (DEEP_LINK_TTL_SEC) under a random id that the picker form carries.
 * No cookies are needed, so it works inside the Canvas iframe. Single use.
 */
function createTransaction({ issuer, clientId, deploymentId, returnUrl, data }) {
  const id = crypto.randomBytes(24).toString('base64url');
  storage.set(DL_TX, id, { issuer, clientId, deploymentId, returnUrl, data, expiresAt: Date.now() + config.deepLinkTtlMs });
  return id;
}

function consumeTransaction(id) {
  if (!id || typeof id !== 'string' || id.length > 64) return null;
  const tx = storage.get(DL_TX, id);
  if (!tx) return null;
  storage.delete(DL_TX, id);
  return tx.expiresAt < Date.now() ? null : tx;
}

function pruneExpired() {
  return storage.prune(DL_TX, (tx) => tx.expiresAt < Date.now());
}

module.exports = { createTransaction, consumeTransaction, pruneExpired };
