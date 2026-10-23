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