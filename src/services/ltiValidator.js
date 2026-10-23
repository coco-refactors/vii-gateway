const { jwtVerify, decodeProtectedHeader, errors } = require('jose');
const config = require('../config');
const { getKeySet } = require('./jwksClient');

/**
 * Expiry rules: `exp` must be in the future, and `iat` no older than maxTokenAge, with a small
 * clock-skew allowance. (LTI 1.1 never checked oauth_timestamp, so old launches could be replayed.)
 */
function expiryOptions() {
  return {
    clockTolerance: config.lti.clockToleranceSec,
    maxTokenAge: config.lti.maxTokenAgeSec,
    requiredClaims: ['iss', 'sub', 'aud', 'exp', 'iat', 'nonce'],
  };
}

function mapExpiryError(err) {
  if (err instanceof errors.JWTExpired) {
    if (err.claim === 'iat') {
      return new LtiError('TOKEN_TOO_OLD', 'The launch token is too old. Please relaunch from Canvas.', {
        status: 401,
        detail: err.message,
      });
    }
    return new LtiError('TOKEN_EXPIRED', 'The launch token has expired. Please relaunch from Canvas.', {
      status: 401,
      detail: err.message,
    });
  }
  return null;
}

/**
 * Verify the Canvas id_token: RS256 signature against Canvas's published JWKS, plus issuer and
 * audience (our client_id). On an unknown `kid` the JWKS is re-fetched once (key rotation).
 */
async function verifyIdToken(idToken, platform) {
  if (!idToken || typeof idToken !== 'string' || idToken.length > 16384 || idToken.split('.').length !== 3) {
    throw new LtiError('ID_TOKEN_MISSING', 'The launch did not include a valid identity token.', { status: 400 });
  }

  try {
    decodeProtectedHeader(idToken);
  } catch (err) {
    throw new LtiError('ID_TOKEN_MALFORMED', 'The launch identity token is malformed.', {
      status: 400,
      detail: err.message,
    });
  }

  const options = {
    issuer: platform.issuer,
    audience: platform.clientId,
    algorithms: ['RS256'], // rejects alg=none and HS256 "key confusion" attacks
    ...expiryOptions(),
  };

  try {
    let keySet = await getKeySet(platform);
    try {
      return (await jwtVerify(idToken, keySet, options)).payload;
    } catch (err) {
      if (!(err instanceof errors.JWKSNoMatchingKey)) throw err;
      keySet = await getKeySet(platform, { forceRefresh: true });
      return (await jwtVerify(idToken, keySet, options)).payload;
    }
  } catch (err) {
    if (err instanceof LtiError) throw err;
    const expiry = mapExpiryError(err);
    if (expiry) throw expiry;
    if (err instanceof errors.JWSSignatureVerificationFailed) {
      throw new LtiError('SIGNATURE_INVALID', 'The launch token signature could not be verified.', {
        status: 401,
        detail: err.message,
      });
    }
    if (err instanceof errors.JWKSNoMatchingKey) {
      throw new LtiError('KEY_NOT_FOUND', 'The launch token was signed with an unknown key.', {
        status: 401,
        detail: err.message,
      });
    }
    if (err instanceof errors.JWTClaimValidationFailed) {
      throw new LtiError('CLAIM_INVALID', 'The launch token has an invalid issuer, audience or claim.', {
        status: 401,
        detail: `${err.claim}: ${err.reason}`,
      });
    }
    throw new LtiError('ID_TOKEN_INVALID', 'The launch token could not be verified.', {
      status: 401,
      detail: `${err.code || err.name}: ${err.message}`,
    });
  }
}