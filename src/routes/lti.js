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
const deepLinking = require('../services/deepLinking');
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
 * Canvas LTI 1.3 tool configuration. In Canvas: Admin > Developer Keys > + Developer Key > + LTI Key >
 * Method "Enter URL" and use this URL. Every URL is built from GATEWAY_PUBLIC_URL, never from headers.
 *   - assignment_selection / link_selection: Deep Linking (instructor picks the experience)
 *   - course_navigation: resource-link launch (instructor binds an experience, students are told to use an assignment)
 *   - privacy_level anonymous: Canvas sends no names or emails (student data rule)
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
      'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly',
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
              placement: 'assignment_selection',
              enabled: true,
              message_type: 'LtiDeepLinkingRequest',
              target_link_uri: launchUrl,
              text: 'VAuLT Experience',
            },
            {
              placement: 'link_selection',
              enabled: true,
              message_type: 'LtiDeepLinkingRequest',
              target_link_uri: launchUrl,
              text: 'VAuLT Experience',
            },
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

/** One row per Vii experience; `hidden` are the form's hidden fields (already safe values). */
function experienceList(experiences, action, hidden) {
  if (!experiences.length) return '<p>No experiences are available in VAuLT yet.</p>';
  return experiences
    .map(
      (q) => `
      <div class="quest-item">
        <div>
          <h3>${escapeHtml(q.name)}</h3>
          <p>${escapeHtml(q.description)}</p>
        </div>
        <form method="POST" action="${action}">
          ${Object.entries(hidden).map(([k, v]) => `<input type="hidden" name="${k}" value="${escapeHtml(v)}">`).join('')}
          <input type="hidden" name="quest_id" value="${Number(q.id)}">
          <button type="submit" class="btn">Choose</button>
        </form>
      </div>`
    )
    .join('');
}

/** Course-navigation (or other unbound) link: the instructor binds an experience to it. */
function renderQuestSelector(session, experiences, notice = '') {
  return fillTemplate(selectQuestTemplate, {
    heading: 'Choose the VAuLT experience for this link',
    subtitle: 'Students who open this link will play the experience you choose.',
    notice,
    questListHtml: experienceList(experiences, '/lti/select-quest', { token: session.statusToken }),
  });
}

/** Deep Linking: the instructor picks the experience for the new assignment. */
function renderDeepLinkPicker(txId, experiences) {
  return fillTemplate(selectQuestTemplate, {
    heading: 'Add a VAuLT experience',
    subtitle: 'Canvas will create the assignment and its gradebook column for the experience you choose.',
    notice: '',
    questListHtml: experienceList(experiences, '/lti/deep-link/select', { dl: txId }),
  });
}

/** Plain message page (used when a link has no experience, or its experience is gone). */
function renderMessage(title, message) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>VAuLT</title></head>
<body style="font-family: sans-serif; padding: 32px; color: #1e293b; background: #f8fafc;">
  <div style="max-width: 600px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
    <h2 style="margin-top: 0;">${escapeHtml(title)}</h2>
    <p>${escapeHtml(message)}</p>
  </div>
</body></html>`;
}

/** Vii experience list, or a clear "VAuLT unavailable" page if Vii cannot be reached. */
async function experiencesOrFail() {
  try {
    return await vaultClient.getExperiences();
  } catch (err) {
    throw new LtiError('VII_UNAVAILABLE', 'VAuLT is not reachable right now. Please try again in a minute.', { status: 503 });
  }
}

async function experienceOrFail(questId) {
  try {
    return await vaultClient.findExperience(questId);
  } catch (err) {
    throw new LtiError('VII_UNAVAILABLE', 'VAuLT is not reachable right now. Please try again in a minute.', { status: 503 });
  }
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

    // Deep Linking request: keep the return URL on the server and show the experience picker.
    if (launch.messageType === 'LtiDeepLinkingRequest') {
      const txId = deepLinking.createTransaction({
        issuer: platform.issuer,
        clientId: platform.clientId,
        deploymentId: launch.deploymentId,
        returnUrl: launch.deepLinking.returnUrl,
        data: launch.deepLinking.data,
      });
      return noStore(res).send(renderDeepLinkPicker(txId, await experiencesOrFail()));
    }

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

    // Which experience? 1) the link's custom quest_id (set by Deep Linking, signed by Canvas),
    // 2) the experience an instructor bound to this link, 3) none.
    const fromLink = launch.customQuestId;
    const questId = fromLink || sessionStore.getQuestForResource(platform.issuer, launch.deploymentId, launch.resourceLinkId);
    let experience = null;
    if (questId) {
      experience = await experienceOrFail(questId);
      if (!experience) {
        // The experience was deleted or deactivated in Vii (wrong or missing association).
        if (launch.isInstructor && !fromLink) {
          const session = sessionStore.createSession({ ...sessionFields, questId: null });
          const notice = `<p style="color:#b91c1c;">The experience previously chosen for this link (#${Number(questId)}) is no longer available. Choose another.</p>`;
          return noStore(res).send(renderQuestSelector(session, await experiencesOrFail(), notice));
        }
        return noStore(res).send(
          launch.isInstructor
            ? renderMessage('Experience not available', `The VAuLT experience linked to this assignment (#${Number(questId)}) no longer exists or is inactive. Edit the assignment and choose another experience.`)
            : renderMessage('Experience not available', 'The VAuLT experience for this assignment is not available right now. Please tell your instructor.')
        );
      }
    }
    if (!experience) {
      if (launch.isInstructor) {
        const session = sessionStore.createSession({ ...sessionFields, questId: null });
        return noStore(res).send(renderQuestSelector(session, await experiencesOrFail()));
      }
      return noStore(res).send(
        renderMessage('Open this from an assignment', 'This link is not set up with a VAuLT experience. Please open the experience from its assignment in your course.')
      );
    }

    const session = sessionStore.createSession({ ...sessionFields, questId: experience.id });
    const attemptState = await vaultClient.getAttemptState(session.vaultUsername, experience.id);
    noStore(res).send(await renderLaunchPage(session, experience, attemptState));
  })
);

/**
 * Instructor binds an experience to an unbound link (e.g. course navigation). Requires the status token
 * of a verified instructor launch; binds only the link that launch came from.
 */
router.post(
  '/select-quest',
  asyncHandler(async (req, res) => {
    const { token, quest_id: questIdRaw } = req.body || {};
    const session = sessionStore.getByStatusToken(token);
    if (!session || session.role !== 'instructor' || !session.resourceLinkId) {
      throw new LtiError('FORBIDDEN', 'Only an instructor launched from Canvas can choose the experience.', { status: 403 });
    }
    const experience = await experienceOrFail(questIdRaw);
    if (!experience) {
      throw new LtiError('QUEST_INVALID', 'That experience does not exist.', { status: 400 });
    }

    sessionStore.bindQuestToResource(session.issuer, session.deploymentId, session.resourceLinkId, experience.id);
    sessionStore.updateSession(session.id, { questId: experience.id });

    noStore(res).send(`
    <div style="font-family: sans-serif; padding: 32px; text-align: center; color: #166534; background: #f0fdf4; border-radius: 12px; margin: 30px auto; max-width: 600px;">
      <h2>✓ Experience chosen</h2>
      <p>This link now opens <strong>${escapeHtml(experience.name)}</strong>. Reload the page to preview it.</p>
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
