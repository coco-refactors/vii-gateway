const config = require('../config');

/**
 * Registered LTI 1.3 platforms. Today: one Canvas registration from env vars.
 * Shaped as a list so it can later be backed by the `lti_platform` table.
 */
function listPlatforms() {
  const p = config.lti;
  if (!p.issuer || !p.clientId || !p.authLoginUrl || !p.jwksUrl) return [];
  return [
    {
      issuer: p.issuer,
      clientId: p.clientId,
      deploymentId: p.deploymentId || null,
      authLoginUrl: p.authLoginUrl,
      authTokenUrl: p.authTokenUrl,
      tokenAudience: p.tokenAudience || p.authTokenUrl,
      jwksUrl: p.jwksUrl,
    },
  ];
}

/** Find a registration by issuer (and client_id when the platform sends one). */
function findPlatform(issuer, clientId) {
  if (!issuer) return null;
  return (
    listPlatforms().find((p) => p.issuer === issuer && (!clientId || p.clientId === clientId)) || null
  );
}

const platformKey = (platform) => `${platform.issuer}|${platform.clientId}`;

module.exports = { listPlatforms, findPlatform, platformKey };
