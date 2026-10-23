const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const router = express.Router();

const config = require('../config');
const sessionStore = require('../services/sessionStore');
const ltiState = require('../services/ltiState');

const keyStore = require('../services/keyStore');
const { LtiError, renderLtiError } = require('../services/ltiErrors');


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