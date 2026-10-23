const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jose = require('jose');
const config = require('../config');

let cached = null;

/**
 * The tool's own RSA key pair. Used to sign the client assertion when requesting an AGS access
 * token, and published as a JWKS at /lti/jwks (Canvas "Public JWK URL").
 * Persisted so the published key does not change on restart.
 */
async function load() {
  if (cached) return cached;

  let pem = config.lti.privateKeyPem;
  const file = path.join(config.dataDir, 'keys', 'lti-private.pem');

  if (!pem) {
    if (fs.existsSync(file)) {
      pem = fs.readFileSync(file, 'utf8');
    } else {
      const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, pem, { mode: 0o600 });
      console.log(`[KeyStore] Generated new LTI tool key pair at ${file}`);
    }
  }

  const privateKey = crypto.createPrivateKey(pem);
  const publicJwk = await jose.exportJWK(crypto.createPublicKey(privateKey));
  cached = {
    privateKey,
    kid: config.lti.keyId,
    publicJwk: { ...publicJwk, kid: config.lti.keyId, alg: 'RS256', use: 'sig' },
  };
  return cached;
}

async function getSigningKey() {
  const { privateKey, kid } = await load();
  return { privateKey, kid };
}

/** JWKS document served at /lti/jwks (public key only). */
async function getPublicJwks() {
  const { publicJwk } = await load();
  return { keys: [publicJwk] };
}

module.exports = { getSigningKey, getPublicJwks };
