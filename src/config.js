const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const clean = (v) => String(v === undefined || v === null ? '' : v).trim();
const stripSlash = (u) => clean(u).replace(/\/+$/, '');
const list = (v) => clean(v).split(/[\s,]+/).filter(Boolean);
const int = (v, fallback) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const port = parseInt(process.env.PORT, 10) || 3000;

module.exports = {
  port,
  vaultApiUrl: stripSlash(process.env.VAULT_API_URL || 'http://localhost:80'),
  gatewayPublicUrl: stripSlash(process.env.GATEWAY_PUBLIC_URL || `http://localhost:${port}`),

  // Durable storage: experience mappings, short-lived launch sessions, login state, tool key pair.
  // Nothing in it is a name, email, title or score (see the privacy rules in the README).
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '../data')),
  sessionTtlMs: int(process.env.SESSION_TTL_HOURS, 24) * 60 * 60 * 1000,
  loginStateTtlMs: int(process.env.LOGIN_STATE_TTL_SEC, 600) * 1000,
  launchCodeTtlMs: int(process.env.LAUNCH_CODE_TTL_SEC, 600) * 1000,
  deepLinkTtlMs: int(process.env.DEEP_LINK_TTL_SEC, 600) * 1000,

  // LTI 1.3 platform (Canvas) registration. No shared secret exists in LTI 1.3.
  lti: {
    issuer: stripSlash(process.env.LTI_ISSUER),
    clientId: clean(process.env.LTI_CLIENT_ID),
    deploymentId: clean(process.env.LTI_DEPLOYMENT_ID), // required: part of the experience mapping key
    authLoginUrl: clean(process.env.LTI_AUTH_LOGIN_URL),
    authTokenUrl: clean(process.env.LTI_AUTH_TOKEN_URL),
    tokenAudience: clean(process.env.LTI_TOKEN_AUDIENCE), // defaults to authTokenUrl
    jwksUrl: clean(process.env.LTI_JWKS_URL),
    keyId: clean(process.env.LTI_KEY_ID) || 'vault-lti-key-1',
    // Optional: PEM private key (PKCS#8). "\n" sequences are expanded. If unset, a key is generated
    // once and stored under DATA_DIR/keys so the published JWKS stays stable across restarts.
    privateKeyPem: clean(process.env.LTI_PRIVATE_KEY).replace(/\\n/g, '\n'),
    clockToleranceSec: parseInt(process.env.LTI_CLOCK_TOLERANCE_SEC, 10) || 10,
    maxTokenAgeSec: parseInt(process.env.LTI_MAX_TOKEN_AGE_SEC, 10) || 300,
    // Server-to-server configuration for the VAuLT backend.
    vii: {
      apiKey: clean(process.env.VII_GATEWAY_KEY),
      hookSecret: clean(process.env.VII_HOOK_SECRET),
      catalogCacheMs: int(process.env.VII_CATALOG_CACHE_SEC, 60) * 1000,
    },
  },

  grades: {
    // How each attempt's readable work reaches Canvas (decided by the submission spike):
    //   text    = a new text submission per attempt (Canvas submission extension) - default
    //   comment = the score's comment only
    //   none    = score only
    submissionFormat: ['text', 'comment', 'none'].includes(clean(process.env.SUBMISSION_FORMAT))
      ? clean(process.env.SUBMISSION_FORMAT)
      : 'text',
    // Ask Canvas not to overwrite a grade the instructor set by hand (prioritize_non_tool_grade).
    preserveInstructorGrade: clean(process.env.PRESERVE_INSTRUCTOR_GRADE) !== 'false',
    // Points possible of the gradebook column created through Deep Linking.
    defaultPointsPossible: int(process.env.DEFAULT_POINTS_POSSIBLE, 100),
    maxSubmissionChars: int(process.env.MAX_SUBMISSION_CHARS, 20000),
  },

  // Who may embed the gateway pages in an iframe (Canvas origins). Space/comma separated.
  frameAncestors: list(process.env.FRAME_ANCESTORS),
  // Browsers never call the gateway cross-origin (the iframe is same-origin); keep CORS closed by default.
  corsOrigins: list(process.env.CORS_ORIGINS),

};
