const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');
const { hashId, safeDetail } = require('../utils/redact');

class VaultClient {
  constructor() {
    this.baseUrl = config.vaultApiUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 8000,
    });
  }

  /**
   * Builds a consistent VAuLT username from a Canvas user ID.
   * Adds a short hash when removing special characters to reduce username collisions.
   */
  usernameFor(canvasUserId) {
    const raw = String(canvasUserId);
    const safe = raw.replace(/[^a-zA-Z0-9_-]/g, '');
    if (safe === raw && safe.length > 0) return `canvas_${safe}`;
    const hash = crypto.createHash('sha1').update(raw).digest('hex').slice(0, 8);
    return `canvas_${safe}_${hash}`;
  }

  /**
   * Log in (creating on first use) the Vii account of a Canvas user through the existing
   * /api/authenticate guest flow. Returns Vii's { user, oauth } or null if Vii refused or is down.
   * Called when the app exchanges a launch code; nothing from the answer is stored by the gateway.
   */
  async authenticateUsername(username, { timeout } = {}) {
    try {
      const form = new URLSearchParams();
      form.append('type', 'guest');
      form.append('username', username);

      const res = await this.client.post('/api/authenticate', form.toString(), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        ...(timeout ? { timeout } : {}),
      });

      if (res.data && res.data.returnCode === 0) {
        return res.data.data;
      }
      return null;
    } catch (err) {
      console.warn(`[VaultClient] Vii login failed for ${hashId(username)}: ${safeDetail(err.message)}`);
      return null;
    }
  }

  /**
   * Fetch attempt state for a user and quest from Vii's attempt-state endpoint.
   * Requires X-Gateway-Key header matching config.lti.vii.apiKey.
   *
   * @param {string} username
   * @param {number|string} questId
   * @returns {Promise<{attempts: number, latest: object|null}|null>}
   */
  async getAttemptState(username, questId) {
    const apiKey = (config.lti && config.lti.vii && config.lti.vii.apiKey) || process.env.VII_GATEWAY_KEY || process.env.GATEWAY_API_KEY || '';
    try {
      const headers = {};
      if (apiKey) {
        headers['X-Gateway-Key'] = apiKey;
      }
      const res = await this.client.get('/gateway/attempt-state', {
        params: { username, quest_id: questId },
        headers,
      });
      if (res.data && res.data.returnCode === 0 && res.data.data) {
        return res.data.data;
      }
      return null;
    } catch (err) {
      console.warn(`[VaultClient] Failed to fetch attempt state for ${hashId(username)} (quest ${questId}): ${safeDetail(err.message)}`);
      return null;
    }
  }

  getQuestCatalog() {
    return [
      { id: 1, name: 'Campus Explorer Quest', description: 'Interactive campus exploration with location puzzles.' },
      { id: 2, name: 'STEM AR Quest: Chemistry Lab', description: 'Scan laboratory targets to solve chemistry challenges.' },
      { id: 3, name: 'Language & Culture Quest', description: 'Language practice and cultural discovery scavenger hunt.' },
    ];
  }

  findQuest(questId) {
    const id = parseInt(questId, 10);
    const catalog = this.getQuestCatalog();
    const q = catalog.find((item) => item.id === id);
    return q ? { ...q } : null;
  }

  async getQuestDetails(questId) {
    const found = this.findQuest(questId);
    if (found) return found;
    return {
      id: parseInt(questId, 10),
      name: `Quest #${questId}`,
      description: 'Explore, solve interactive puzzles, and complete location and AR challenges in the VAuLT mobile app.',
    };
  }
}

module.exports = new VaultClient();
