const config = require('../config');

/**
 * Registered LTI 1.3 platforms. Today: one Canvas registration from env vars.
 * Shaped as a list so it can later be backed by the `lti_platform` table.
 * The deployment id is required: it is part of the experience mapping key.
 */
function listPlatforms() {
  const p = config.lti;
  if (!p.issuer || !p.clientId || !p.deploymentId || !p.authLoginUrl || !p.jwksUrl) return [];
  return [
    {
      issuer: p.issuer,
      clientId: p.clientId,
      deploymentId: p.deploymentId,
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

/** Experience mapping key: issuer + deployment id + resource link id (project rule). */
const mappingKey = (issuer, deploymentId, resourceLinkId) => `${issuer}|${deploymentId}::${resourceLinkId}`;

module.exports = { listPlatforms, findPlatform, mappingKey };
