const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const clean = (v) => String(v === undefined || v === null ? '' : v).trim();
const stripSlash = (u) => clean(u).replace(/\/+$/, '');
const list = (v) => clean(v).split(/[\s,]+/).filter(Boolean);

const port = parseInt(process.env.PORT, 10) || 3000;

module.exports = {
  port,
  vaultApiUrl: stripSlash(process.env.VAULT_API_URL || 'http://localhost:80'),
  gatewayPublicUrl: stripSlash(process.env.GATEWAY_PUBLIC_URL || `http://localhost:${port}`),
  defaultQuestId: parseInt(process.env.DEFAULT_QUEST_ID, 10) || 1,

  // Durable storage (sessions, quest bindings, login state, tool key pair)
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '../data')),
  sessionTtlMs: (parseInt(process.env.SESSION_TTL_HOURS, 10) || 168) * 60 * 60 * 1000,
  loginStateTtlMs: (parseInt(process.env.LOGIN_STATE_TTL_SEC, 10) || 600) * 1000,

  // LTI 1.3 platform (Canvas) registration. No shared secret exists in LTI 1.3.
  lti: {
    issuer: stripSlash(process.env.LTI_ISSUER),
    clientId: clean(process.env.LTI_CLIENT_ID),
    deploymentId: clean(process.env.LTI_DEPLOYMENT_ID), // optional but recommended
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
  },

  // Who may embed the gateway pages in an iframe (Canvas origins). Space/comma separated.
  frameAncestors: list(process.env.FRAME_ANCESTORS),
  // Browsers never call the gateway cross-origin (the iframe is same-origin); keep CORS closed by default.
  corsOrigins: list(process.env.CORS_ORIGINS),

  // Optional shared key required on POST /api/complete-session (x-api-key header)
  apiKey: clean(process.env.GATEWAY_API_KEY),
  // VAuLT endpoint that persists a completed quest. Empty = persistence disabled (gateway-only record).
  vaultCompletePath: clean(process.env.VAULT_COMPLETE_PATH),
};
