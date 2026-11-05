const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const router = express.Router();

const config = require('../config');
const sessionStore = require('../services/sessionStore');
const vaultClient = require('../services/vaultClient');
const ltiState = require('../services/ltiState');
const ltiValidator = require('../services/ltiValidator');
const keyStore = require('../services/keyStore');
const { findPlatform, platformKey } = require('../services/platformRegistry');
const { LtiError, renderLtiError } = require('../services/ltiErrors');
const { escapeHtml, fillTemplate, asyncHandler } = require('../utils/html');

const launchTemplate = fs.readFileSync(
  path.join(__dirname, '../views/launch.html'),
  'utf8'
);

const noStore = (res) => res.set('Cache-Control', 'no-store');

/**
 * Tool public key set. Paste this URL into the Canvas developer key as "Public JWK URL".
 */
router.get(
  '/jwks',
  asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'public, max-age=300').json(await keyStore.getPublicJwks());
  })
);

/**
 * Canvas LTI 1.3 tool configuration (replaces the LTI 1.1 /lti/config.xml).
 * In Canvas: Admin > Developer Keys > + Developer Key > + LTI Key > Method "Enter URL" and use this URL.
 * Every URL is built from GATEWAY_PUBLIC_URL, never from request headers.
 */
router.get('/config.json', (req, res) => {
  const base = config.gatewayPublicUrl;
  const launchUrl = `${base}/lti/launch`;
  res.json({
    title: 'VAuLT Quest',
    description: 'Interactive Quests, AR/VR Tasks, and Scavenger Hunts',
    oidc_initiation_url: `${base}/lti/login`,
    target_link_uri: launchUrl,
    public_jwk_url: `${base}/lti/jwks`,
    scopes: [
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly',
      'https://purl.imsglobal.org/spec/lti-ags/scope/result.readonly',
      'https://purl.imsglobal.org/spec/lti-ags/scope/score',
    ],
    extensions: [
      {
        domain: new URL(base).host,
        tool_id: 'vault-quest',
        platform: 'canvas.instructure.com',
        privacy_level: 'public',
        settings: {
          text: 'VAuLT Quest',
          placements: [
            {
              placement: 'course_navigation',
              enabled: true,
              message_type: 'LtiResourceLinkRequest',
              target_link_uri: launchUrl,
              text: 'VAuLT Quests',
              visibility: 'public',
              default: 'enabled',
            },
          ],
        },
      },
    ],
  });
});

/**
 * LTI 1.3 OIDC third-party login initiation. Canvas calls this first (POST, or GET); we answer with a
 * redirect to Canvas's authorization endpoint carrying a fresh state + nonce. Canvas then POSTs the
 * signed id_token to /lti/launch.
 */
const loginInitiation = asyncHandler(async (req, res) => {
  const params = req.method === 'POST' ? req.body || {} : req.query;
  const { iss, login_hint: loginHint, target_link_uri: targetLinkUri } = params;
  const clientId = params.client_id;
  const ltiMessageHint = params.lti_message_hint;
  const deploymentId = params.lti_deployment_id;

  if (!iss || !loginHint || !targetLinkUri) {
    throw new LtiError('LOGIN_PARAMS_MISSING', 'The login request is missing required parameters.', { status: 400 });
  }

  const platform = findPlatform(String(iss), clientId ? String(clientId) : undefined);
  if (!platform) {
    throw new LtiError('PLATFORM_UNKNOWN', 'This Canvas account is not registered with VAuLT.', {
      status: 400,
      detail: `Unregistered issuer/client_id: ${iss} / ${clientId}`,
    });
  }
  if (deploymentId && platform.deploymentId && String(deploymentId) !== platform.deploymentId) {
    throw new LtiError('DEPLOYMENT_INVALID', 'This tool is not deployed for the launching account.', {
      status: 401,
      detail: `lti_deployment_id=${deploymentId}`,
    });
  }

  // Only our own launch URL is a valid target (prevents using the gateway as an open redirector).
  if (new URL(String(targetLinkUri), config.gatewayPublicUrl).origin !== new URL(config.gatewayPublicUrl).origin) {
    throw new LtiError('TARGET_LINK_INVALID', 'The launch target is not this tool.', {
      status: 400,
      detail: `target_link_uri=${targetLinkUri}`,
    });
  }

  const { state, nonce } = ltiState.createLoginTransaction({
    platform,
    targetLinkUri: String(targetLinkUri),
    loginHint: String(loginHint),
    ltiMessageHint: ltiMessageHint ? String(ltiMessageHint) : null,
  });

  const authUrl = new URL(platform.authLoginUrl);
  authUrl.searchParams.set('scope', 'openid');
  authUrl.searchParams.set('response_type', 'id_token');
  authUrl.searchParams.set('response_mode', 'form_post');
  authUrl.searchParams.set('prompt', 'none');
  authUrl.searchParams.set('client_id', platform.clientId);
  authUrl.searchParams.set('redirect_uri', `${config.gatewayPublicUrl}/lti/launch`);
  authUrl.searchParams.set('login_hint', String(loginHint));
  if (ltiMessageHint) authUrl.searchParams.set('lti_message_hint', String(ltiMessageHint));
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('nonce', nonce);

  noStore(res).redirect(302, authUrl.toString());
});

router.get('/login', loginInitiation);
router.post('/login', loginInitiation);

/**
 * Build the launch page (QR code + live status) for a session.
 */
async function renderLaunchPage(session) {
  const mobileDeepLink = `vault://quest/${session.questId}?token=${session.token}&gateway=${encodeURIComponent(
    config.gatewayPublicUrl
  )}`;

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(mobileDeepLink, {
      width: 220,
      margin: 1,
      color: { dark: '#0f172a', light: '#ffffff' },
    });
  } catch (err) {
    console.error(`[LTI Gateway] QR Code generation error: ${err.message}`);
  }

  const questDetails = await vaultClient.getQuestDetails(session.questId);

  return fillTemplate(launchTemplate, {
    questName: escapeHtml(questDetails.name),
    questDescription: escapeHtml(questDetails.description),
    qrCodeDataUrl: escapeHtml(qrCodeDataUrl),
    mobileDeepLink: escapeHtml(mobileDeepLink),
    statusCheckUrl: `/api/status/${session.token}`,
    isCompleted: String(session.isCompleted),
    isCompletedDisplay: session.isCompleted ? 'block' : 'none',
    isActiveDisplay: session.isCompleted ? 'none' : 'block',
    roleBadge: session.role === 'instructor' ? '<span class="role-badge">Instructor Preview</span>' : '',
  });
}

/**
 * Primary Canvas LTI 1.3 launch endpoint. Canvas POSTs { id_token, state } here after the OIDC login.
 */
router.post(
  '/launch',
  asyncHandler(async (req, res) => {
    const body = req.body || {};

    if (body.error) {
      throw new LtiError('PLATFORM_AUTH_ERROR', 'Canvas could not authorize this launch.', {
        status: 401,
        detail: `${body.error}: ${body.error_description || ''}`,
      });
    }

    const tx = ltiState.consumeState(body.state);
    const platform = findPlatform(tx.issuer, tx.clientId);
    if (!platform) {
      throw new LtiError('PLATFORM_UNKNOWN', 'This Canvas account is not registered with VAuLT.', { status: 400 });
    }

    const payload = await ltiValidator.verifyIdToken(body.id_token, platform);

    ltiState.validateNonce(payload.nonce, tx);

    const launch = ltiValidator.parseLaunch(payload, platform);

    const pKey = platformKey(platform);
    let questId = launch.customQuestId || sessionStore.getQuestForResource(pKey, launch.resourceLinkId);

    // Request a VAuLT guest login using the verified Canvas identity.
    // If login fails, continue and record the failure in the session.
    const vaultKey = launch.legacyUserId || launch.sub;
    const vaultUsername = vaultClient.usernameFor(vaultKey);
    const vaultAuth = await vaultClient.authenticateUser(vaultKey, { timeout: 5000 });

    const sessionBase = {
      platformKey: pKey,
      issuer: platform.issuer,
      clientId: platform.clientId,
      deploymentId: launch.deploymentId,
      sub: launch.sub,
      role: launch.role,
      studentName: launch.name,
      studentEmail: launch.email,
      courseTitle: launch.courseTitle,
      resourceLinkId: launch.resourceLinkId,
      assignmentTitle: launch.assignmentTitle,
      ags: launch.ags,
      vaultUsername,
      vaultProvisioned: Boolean(vaultAuth),
    };

    // Default to the configured quest if still not assigned (students opening an unconfigured assignment)
    if (!questId) {
      questId = config.defaultQuestId;
    }

    // Reuse a completed session for this quest, or create a new session.
    const previous = sessionStore.findLatestSession({
      platformKey: pKey,
      resourceLinkId: launch.resourceLinkId,
      sub: launch.sub,
      role: launch.role,
    });
    const session =
      previous && previous.isCompleted && previous.questId === questId
        ? previous
        : sessionStore.createSession({ ...sessionBase, questId });

    noStore(res).send(await renderLaunchPage(session));
  })
);

/**
 * Any LtiError (or unexpected failure) inside /lti/* renders a generic, non-leaking error page.
 */
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof LtiError) {
    console.warn(`[LTI Gateway] Launch rejected (${err.code}): ${err.detail || err.publicMessage}`);
    return renderLtiError(res, err);
  }
  console.error(`[LTI Gateway] Unexpected error: ${err.stack || err.message}`);
  return renderLtiError(res, new LtiError('SERVER_ERROR', 'Something went wrong on our side.', { status: 500 }));
});

module.exports = router;
