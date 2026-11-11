const axios = require('axios');
const config = require('../config');
const { SCOPES, withToken } = require('./canvasToken');
const { findPlatform } = require('./platformRegistry');
const { renderSubmission } = require('./submissionRenderer');
const { hashId, safeDetail } = require('../utils/redact');

const lineItemCache = new Map(); // lineitem URL -> { scoreMaximum, fetchedAt }

/**
 * Points possible of the assignment, read from its AGS line item (needs the lineitem.readonly scope).
 * Cached for 10 minutes. If it cannot be read, 1 is used and the score is sent as a fraction.
 */
async function getScoreMaximum(platform, lineitem) {
  const cached = lineItemCache.get(lineitem);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) return cached.scoreMaximum;
  try {
    const res = await withToken(platform, [SCOPES.score, SCOPES.lineItemRead], (token) =>
      axios.get(lineitem, {
        headers: { Accept: 'application/vnd.ims.lis.v2.lineitem+json', Authorization: `Bearer ${token}` },
        timeout: 10000,
      })
    );
    const max = Number(res.data && res.data.scoreMaximum);
    const scoreMaximum = Number.isFinite(max) && max > 0 ? max : 1;
    lineItemCache.set(lineitem, { scoreMaximum, fetchedAt: Date.now() });
    return scoreMaximum;
  } catch (err) {
    console.warn(`[GradeService] Could not read the line item (${err.response ? `HTTP ${err.response.status}` : safeDetail(err.message)}); sending the score out of 1.`);
    return 1;
  }
}

/** `<lineitem>/scores`, keeping any query string on the line item URL intact. */
function scoresUrl(lineitem) {
  const url = new URL(lineitem);
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/scores`;
  return url.toString();
}

/** Canvas 5xx, 429 and network errors are worth retrying later; other 4xx are not. */
const isRetryable = (err) => !err.response || err.response.status >= 500 || err.response.status === 429;

async function postScore(session, body) {
  const platform = findPlatform(session.issuer, session.clientId);
  if (!platform || !platform.authTokenUrl) {
    return { ok: false, retryable: false, error: 'platform has no token endpoint configured' };
  }
  try {
    await withToken(platform, [SCOPES.score, SCOPES.lineItemRead], (token) =>
      axios.post(scoresUrl(session.ags.lineitem), body, {
        headers: { 'Content-Type': 'application/vnd.ims.lis.v1.score+json', Authorization: `Bearer ${token}` },
        timeout: 10000,
      })
    );
    return { ok: true };
  } catch (err) {
    const detail = err.response ? `HTTP ${err.response.status}` : safeDetail(err.message);
    console.error(`[GradeService] Canvas did not accept the score for ${hashId(session.sub)}: ${detail}`);
    return { ok: false, retryable: isRetryable(err), error: detail };
  }
}

/**
 * Send one finished attempt to Canvas: the score scaled to the assignment's points possible, and (by
 * SUBMISSION_FORMAT) the readable work as a NEW submission for this attempt. Each attempt posts to the
 * same line item, so the gradebook keeps one entry per student with the latest attempt's score
 * (timestamp = when the attempt finished; Canvas does not let an older timestamp replace a newer one).
 * With PRESERVE_INSTRUCTOR_GRADE a grade the instructor set by hand is kept and the attempt is only
 * added as a submission.
 *
 * @returns {Promise<{ok: boolean, retryable?: boolean, error?: string}>}
 */
async function sendAttemptScore(session, hook) {
  const platform = findPlatform(session.issuer, session.clientId);
  const scoreMaximum = platform ? await getScoreMaximum(platform, session.ags.lineitem) : 1;
  const share = Math.max(0, Math.min(1, Number(hook.score)));
  const finishedAt = hook.attempt.finishedAt && !Number.isNaN(Date.parse(hook.attempt.finishedAt))
    ? new Date(hook.attempt.finishedAt).toISOString()
    : new Date().toISOString();

  const body = {
    userId: session.sub,
    scoreGiven: Math.round(share * scoreMaximum * 10000) / 10000,
    scoreMaximum,
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded', // all VAuLT results are final (no manual review step)
    timestamp: finishedAt,
  };

  const { html, text } = renderSubmission(hook);
  const canvasSubmission = {
    new_submission: true,
    submitted_at: finishedAt,
    prioritize_non_tool_grade: config.grades.preserveInstructorGrade,
  };
  if (config.grades.submissionFormat === 'text') {
    canvasSubmission.submission_type = 'online_text_entry';
    canvasSubmission.submission_data = html;
  } else if (config.grades.submissionFormat === 'comment') {
    body.comment = text;
  }
  body['https://canvas.instructure.com/lti/submission'] = canvasSubmission;

  const result = await postScore(session, body);
  if (result.ok) {
    console.log(`[GradeService] Attempt ${hook.attempt.number} sent to Canvas for ${hashId(session.sub)}.`);
  }
  return result;
}

/**
 * Activity progress only (no score), e.g. "Started" for a first attempt. A score without scoreGiven
 * clears an existing grade in Canvas, so the caller only sends this before any attempt was graded.
 */
async function sendProgress(session, activityProgress) {
  return postScore(session, {
    userId: session.sub,
    activityProgress,
    gradingProgress: 'NotReady',
    timestamp: new Date().toISOString(),
  });
}

module.exports = { sendAttemptScore, sendProgress, getScoreMaximum, scoresUrl };
