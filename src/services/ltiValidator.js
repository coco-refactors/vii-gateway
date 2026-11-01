const { jwtVerify, decodeProtectedHeader, errors } = require('jose');
const config = require('../config');
const { getKeySet } = require('./jwksClient');
const { LtiError } = require('./ltiErrors');

const CLAIM = {
  messageType: 'https://purl.imsglobal.org/spec/lti/claim/message_type',
  version: 'https://purl.imsglobal.org/spec/lti/claim/version',
  deploymentId: 'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  resourceLink: 'https://purl.imsglobal.org/spec/lti/claim/resource_link',
  context: 'https://purl.imsglobal.org/spec/lti/claim/context',
  roles: 'https://purl.imsglobal.org/spec/lti/claim/roles',
  custom: 'https://purl.imsglobal.org/spec/lti/claim/custom',
  lti11Legacy: 'https://purl.imsglobal.org/spec/lti/claim/lti1p1',
  ags: 'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
};

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

/**
 * Role detection. LTI 1.3 sends full role URIs, e.g.
 *   http://purl.imsglobal.org/vocab/lis/v2/membership#Learner
 *   http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor
 *   http://purl.imsglobal.org/vocab/lis/v2/membership/Instructor#TeachingAssistant
 *   http://purl.imsglobal.org/vocab/lis/v2/institution/person#Administrator
 */
function roleName(uri) {
  const value = String(uri || '');
  const hash = value.lastIndexOf('#');
  const tail = hash >= 0 ? value.slice(hash + 1) : value.split('/').pop();
  return tail.toLowerCase();
}

const STUDENT_ROLES = new Set(['learner', 'student']);

function isStudentRole(roles) {
  return (roles || []).some((r) => STUDENT_ROLES.has(roleName(r)));
}

const INSTRUCTOR_ROLES = new Set([
  'instructor',
  'teacher',
  'teachingassistant',
  'grader',
  'contentdeveloper',
  'administrator',
]);

function isInstructorRole(roles) {
  return (roles || []).some((r) => INSTRUCTOR_ROLES.has(roleName(r)));
}

/** 'instructor' wins over 'student' (an instructor viewing as a student keeps instructor rights). */
function classifyRole(roles) {
  if (isInstructorRole(roles)) return 'instructor';
  if (isStudentRole(roles)) return 'student';
  return null;
}

/**
 * Canvas user identity from a verified launch. `sub` is the stable Canvas user id for this platform.
 * Canvas can also send the LTI 1.1 user id (lti1p1 claim) for tools migrated from 1.1; when present
 * it is used as the VAuLT account key so existing `canvas_<id>` accounts keep working.
 */
function extractIdentity(payload) {
  const legacy = payload[CLAIM.lti11Legacy];
  return {
    sub: String(payload.sub),
    legacyUserId: legacy && legacy.user_id ? String(legacy.user_id) : null,
    name: payload.name || [payload.given_name, payload.family_name].filter(Boolean).join(' ') || '',
    email: payload.email || '',
  };
}

/**
 * Validate the LTI-specific claims of a signature-verified id_token and normalise them.
 */
function parseLaunch(payload, platform) {
  const messageType = payload[CLAIM.messageType];
  if (messageType !== 'LtiResourceLinkRequest') {
    throw new LtiError('MESSAGE_TYPE_UNSUPPORTED', 'This launch type is not supported by VAuLT.', {
      status: 400,
      detail: `message_type=${messageType}`,
    });
  }
  if (payload[CLAIM.version] !== '1.3.0') {
    throw new LtiError('VERSION_UNSUPPORTED', 'Only LTI 1.3 launches are supported.', { status: 400 });
  }

  const deploymentId = payload[CLAIM.deploymentId];
  if (!deploymentId || (platform.deploymentId && deploymentId !== platform.deploymentId)) {
    throw new LtiError('DEPLOYMENT_INVALID', 'This tool is not deployed for the launching account.', {
      status: 401,
      detail: `deployment_id=${deploymentId}`,
    });
  }

  const resourceLink = payload[CLAIM.resourceLink] || {};
  if (!resourceLink.id) {
    throw new LtiError('RESOURCE_LINK_MISSING', 'The launch did not identify an assignment.', { status: 400 });
  }

  const roles = Array.isArray(payload[CLAIM.roles]) ? payload[CLAIM.roles] : [];
  const role = classifyRole(roles);
  if (!role) {
    throw new LtiError('ROLE_UNSUPPORTED', 'Your Canvas role cannot open this activity.', {
      status: 403,
      detail: `roles=${roles.join(',')}`,
    });
  }

  const identity = extractIdentity(payload);
  const context = payload[CLAIM.context] || {};
  const custom = payload[CLAIM.custom] || {};
  const agsClaim = payload[CLAIM.ags];

  return {
    ...identity,
    role,
    isInstructor: role === 'instructor',
    roles,
    deploymentId,
    resourceLinkId: String(resourceLink.id),
    assignmentTitle: resourceLink.title || 'VAuLT Assignment',
    courseTitle: context.title || 'Canvas Course',
    customQuestId: parseInt(custom.quest_id, 10) || null,
    ags:
      agsClaim && agsClaim.lineitem
        ? { lineitem: agsClaim.lineitem, lineitems: agsClaim.lineitems || null, scopes: agsClaim.scope || [] }
        : null,
  };
}

module.exports = {
  CLAIM,
  verifyIdToken,
  parseLaunch,
  isStudentRole,
  isInstructorRole,
  classifyRole,
  extractIdentity,
};
