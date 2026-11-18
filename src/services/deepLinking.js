const crypto = require('crypto');
const { SignJWT } = require('jose');
const config = require('../config');
const storage = require('./storage');
const keyStore = require('./keyStore');

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

const DL = 'https://purl.imsglobal.org/spec/lti-dl/claim';
const LTI = 'https://purl.imsglobal.org/spec/lti/claim';

/**
 * Signed LtiDeepLinkingResponse with one LTI resource link for the chosen experience. The experience id
 * travels as the custom parameter quest_id (Canvas signs it back into every launch of the link), and the
 * lineItem asks Canvas to create the gradebook column.
 */
async function buildResponseJwt(tx, experience) {
  const { privateKey, kid } = await keyStore.getSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    nonce: crypto.randomBytes(16).toString('hex'),
    [`${LTI}/message_type`]: 'LtiDeepLinkingResponse',
    [`${LTI}/version`]: '1.3.0',
    [`${LTI}/deployment_id`]: tx.deploymentId,
    [`${DL}/content_items`]: [
      {
        type: 'ltiResourceLink',
        title: experience.name,
        text: experience.description,
        url: `${config.gatewayPublicUrl}/lti/launch`,
        custom: { quest_id: String(experience.id) },
        lineItem: {
          scoreMaximum: config.grades.defaultPointsPossible,
          label: experience.name,
          resourceId: `vault-quest-${experience.id}`,
          tag: 'vault',
        },
      },
    ],
    [`${DL}/msg`]: `Added the VAuLT experience "${experience.name}".`,
  };
  if (tx.data !== null && tx.data !== undefined) payload[`${DL}/data`] = tx.data;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid })
    .setIssuer(tx.clientId)
    .setAudience(tx.issuer)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setJti(crypto.randomUUID())
    .sign(privateKey);
}

module.exports = { createTransaction, consumeTransaction, buildResponseJwt, pruneExpired };
