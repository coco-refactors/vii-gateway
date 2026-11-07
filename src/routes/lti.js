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
const { findPlatform } = require('../services/platformRegistry');
const { LtiError, renderLtiError } = require('../services/ltiErrors');
const { escapeHtml, fillTemplate, asyncHandler } = require('../utils/html');
const { safeDetail } = require('../utils/redact');

const launchTemplate = fs.readFileSync(
  path.join(__dirname, '../views/launch.html'),
  'utf8'
);

const selectQuestTemplate = fs.readFileSync(
  path.join(__dirname, '../views/selectQuest.html'),
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
        privacy_level: 'anonymous', // Canvas sends no names or emails (student data rule)
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
      detail: 'unregistered issuer/client_id',
    });
  }
  if (deploymentId && String(deploymentId) !== platform.deploymentId) {
    throw new LtiError('DEPLOYMENT_INVALID', 'This tool is not deployed for the launching account.', {
      status: 401,
      detail: 'lti_deployment_id does not match the registration',
    });
  }

  // Only our own launch URL is a valid target (prevents using the gateway as an open redirector).
  if (new URL(String(targetLinkUri), config.gatewayPublicUrl).origin !== new URL(config.gatewayPublicUrl).origin) {
    throw new LtiError('TARGET_LINK_INVALID', 'The launch target is not this tool.', {
      status: 400,
      detail: 'target_link_uri is not this gateway',
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
 * Build the launch page for a session. The QR code holds an https link with a fresh single-use launch
 * code and the experience id; the app exchanges the code at /api/launch/redeem (no Vii login screen).
 * The latest attempt comes live from Vii; a finished experience can always be started again.
 */
async function renderLaunchPage(session, experience, attemptState) {
  const code = sessionStore.createLaunchCode(session.id);
  const launchLink = `${config.gatewayPublicUrl}/launch/m?code=${encodeURIComponent(code)}&quest=${session.questId}`;
  const appLink = `vault://launch?gateway=${encodeURIComponent(config.gatewayPublicUrl)}&code=${encodeURIComponent(code)}&quest=${session.questId}`;

  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(launchLink, { width: 220, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } });
  } catch (err) {
    console.error(`[LTI Gateway] QR code generation error: ${safeDetail(err.message)}`);
  }

  const latest = attemptState && attemptState.latest;
  const finished = latest && latest.status === 'finished';
  const sent = finished && session.sentAttemptIds.includes(Number(latest.id));
  const rosterSection =
    session.role === 'instructor' && session.nrpsUrl
      ? `<div class="roster"><button id="roster-btn" class="secondary-btn" data-url="/api/roster/${escapeHtml(session.statusToken)}">Show course roster</button><div id="roster-out" class="note"></div></div>`
      : '';

  return fillTemplate(launchTemplate, {
    questName: escapeHtml(experience.name),
    questDescription: escapeHtml(experience.description),
    qrCodeDataUrl: escapeHtml(qrCodeDataUrl),
    appLink: escapeHtml(appLink),
    codeTtlMinutes: String(Math.round(config.launchCodeTtlMs / 60000)),
    statusCheckUrl: `/api/status/${session.statusToken}`,
    attemptDisplay: finished ? 'block' : 'none',
    attemptText: finished ? escapeHtml(`Attempt ${latest.number} finished.${sent ? ' Your result was sent to Canvas.' : ''} You can play again.`) : '',
    lastFinishedNumber: String(finished ? Number(latest.number) || 0 : 0),
    roleBadge: session.role === 'instructor' ? '<span class="role-badge">Instructor Preview</span>' : '',
    rosterSection,
  });
}

/**
 * Builds the instructor quest picker.
 * Each form includes the instructor's session token to authorize the selection.
 */
function renderQuestSelector(session) { // INTERIM: replaced by the Vii-backed picker
  const listHtml = vaultClient
    .getQuestCatalog()
    .map(
      (q) => `
      <div class="quest-item">
        <div>
          <h3>${escapeHtml(q.name)}</h3>
          <p>${escapeHtml(q.description)}</p>
        </div>
        <form method="POST" action="/lti/select-quest">
          <input type="hidden" name="token" value="${escapeHtml(session.statusToken)}">
          <input type="hidden" name="quest_id" value="${q.id}">
          <button type="submit" class="btn">Assign Quest</button>
        </form>
      </div>
    `
    )
    .join('');

  return fillTemplate(selectQuestTemplate, {
    assignmentTitle: 'this link', // no assignment titles are read or stored
    questListHtml: listHtml,
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
        detail: `${String(body.error).slice(0, 60)}`,
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

    const sessionFields = {
      issuer: platform.issuer,
      clientId: platform.clientId,
      deploymentId: launch.deploymentId,
      resourceLinkId: launch.resourceLinkId,
      sub: launch.sub,
      role: launch.role,
      vaultUsername: vaultClient.usernameFor(launch.legacyUserId || launch.sub),
      ags: launch.ags,
      nrpsUrl: launch.nrpsUrl,
    };

    // INTERIM: which experience comes from the link's custom quest_id, else
    // the experience bound to this link; the Vii lookup, "no experience" handling and attempt state land later.
    let questId =
      launch.customQuestId ||
      sessionStore.getQuestForResource(platform.issuer, launch.deploymentId, launch.resourceLinkId);

    // Show the quest picker when an instructor launches an unassigned quest.
    if (!questId && launch.isInstructor) {
      const instructorSession = sessionStore.createSession({ ...sessionFields, questId: null });
      return noStore(res).send(renderQuestSelector(instructorSession));
    }

    // Still unassigned (students): default quest until it gets replaced with a clear message.
    if (!questId) {
      questId = config.defaultQuestId;
    }

    const session = sessionStore.createSession({ ...sessionFields, questId });
    const experience = await vaultClient.getQuestDetails(questId);
    noStore(res).send(await renderLaunchPage(session, experience, null));
  })
);

/**
 * Validates the instructor session and selected quest,
 * then saves the quest choice for that Canvas assignment.
 */
router.post(
  '/select-quest',
  asyncHandler(async (req, res) => {
    const { token, quest_id: questIdRaw } = req.body || {};
    const session = sessionStore.getByStatusToken(token);
    if (!session || session.role !== 'instructor' || !session.resourceLinkId) {
      throw new LtiError('FORBIDDEN', 'Only an instructor launched from Canvas can assign a quest.', { status: 403 });
    }
    const quest = vaultClient.findQuest(questIdRaw);
    if (!quest) {
      throw new LtiError('QUEST_INVALID', 'That quest does not exist.', { status: 400 });
    }

    sessionStore.bindQuestToResource(session.issuer, session.deploymentId, session.resourceLinkId, quest.id);
    sessionStore.updateSession(session.id, { questId: quest.id });

    noStore(res).send(`
    <div style="font-family: sans-serif; padding: 32px; text-align: center; color: #166534; background: #f0fdf4; border-radius: 12px; margin: 30px auto; max-width: 600px;">
      <h2>✓ Quest Assigned Successfully!</h2>
      <p>This Canvas assignment has been linked to <strong>${escapeHtml(quest.name)}</strong>. Please refresh or reopen the assignment.</p>
    </div>
  `);
  })
);

/**
 * Any LtiError (or unexpected failure) inside /lti/* renders a generic, non-leaking error page.
 * Only the error code and a redacted detail are logged.
 */
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err instanceof LtiError) {
    console.warn(`[LTI Gateway] Launch rejected (${err.code}): ${safeDetail(err.detail || err.publicMessage)}`);
    return renderLtiError(res, err);
  }
  console.error(`[LTI Gateway] Unexpected error: ${safeDetail(err.message)}`);
  return renderLtiError(res, new LtiError('SERVER_ERROR', 'Something went wrong on our side.', { status: 500 }));
});

module.exports = router;
