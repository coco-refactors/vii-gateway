const config = require('../config');
const { escapeHtml } = require('../utils/html');

const clip = (s, n) => {
  const str = String(s === undefined || s === null ? '' : s);
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

/**
 * Readable record of one attempt for the instructor in SpeedGrader, built from the hook content:
 * every task with the student's response and whether it was completed, plus how the score was worked
 * out. All text is escaped (it is student input) and the result is size-limited. Returned to the
 * caller only: never stored or logged.
 *
 * @returns {{ html: string, text: string }}
 */
function renderSubmission(hook) {
  const content = hook.content || {};
  const tasks = Array.isArray(content.tasks) ? content.tasks.slice(0, 200) : [];
  const percent = Math.round(Number(hook.score) * 1000) / 10;
  const summary = `Attempt ${hook.attempt.number}: ${content.tasksCompleted} of ${content.tasksTotal} tasks completed (score ${percent}%).`;

  const rows = tasks.map((t, i) => {
    const response = t.response === null || t.response === undefined || t.response === '' ? '(no response)' : clip(t.response, 2000);
    return (
      `<li><p><strong>${i + 1}. ${escapeHtml(clip(t.title, 200))}</strong>` +
      `${t.type ? ` <em>(${escapeHtml(clip(t.type, 40))})</em>` : ''} - ${t.completed ? 'completed' : 'not completed'}</p>` +
      `${t.prompt ? `<p>Prompt: ${escapeHtml(clip(t.prompt, 1000))}</p>` : ''}` +
      `<p>Response: ${escapeHtml(response)}</p></li>`
    );
  });
  const lines = tasks.map((t, i) => {
    const response = t.response === null || t.response === undefined || t.response === '' ? '(no response)' : clip(t.response, 500);
    return `${i + 1}. ${clip(t.title, 120)} - ${t.completed ? 'completed' : 'not completed'} - Response: ${response}`;
  });

  const max = config.grades.maxSubmissionChars;
  let html =
    `<h3>${escapeHtml(clip(content.questName || 'VAuLT experience', 200))}</h3>` +
    `<p>${escapeHtml(summary)}</p><ol>${rows.join('')}</ol>`;
  if (html.length > max) html = `${html.slice(0, max - 60)}</li></ol><p>(truncated)</p>`;
  const text = clip([summary, ...lines].join('\n'), Math.min(max, 4000));
  return { html, text };
}

module.exports = { renderSubmission };
