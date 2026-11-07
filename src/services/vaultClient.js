const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');
const { hashId, safeDetail } = require('../utils/redact');

// Single quest catalog, hard-coded
const QUESTS = [
  { id: 1, name: 'Campus Explorer Quest', description: 'Interactive campus exploration with location puzzles.' },
  { id: 2, name: 'STEM AR Quest: Chemistry Lab', description: 'Scan laboratory targets to solve chemistry challenges.' },
  { id: 3, name: 'Language & Culture Quest', description: 'Language practice and cultural discovery scavenger hunt.' },
];

class VaultClient {
  constructor() {
    this.baseUrl = config.vaultApiUrl;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: 8000,
    });
  }

  getQuestCatalog() {
    return QUESTS.map((q) => ({ ...q }));
  }

  /** Quest from the catalog, or null if the id is not a known quest. */
  findQuest(questId) {
    const id = parseInt(questId, 10);
    const quest = QUESTS.find((q) => q.id === id);
    return quest ? { ...quest } : null;
  }

  /** Quest details for display; unknown ids fall back to a generic description. */
  async getQuestDetails(questId) {
    const quest = this.findQuest(questId);
    if (quest) return quest;
    return {
      id: parseInt(questId, 10),
      name: `Quest #${questId}`,
      description:
        'Explore, solve interactive puzzles, and complete location and AR challenges in the VAuLT mobile app.',
    };
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
   * Builds the Canvas user's VAuLT username and requests a guest login.
   * Returns the login data, or null if authentication fails.
   */
  async authenticateUser(canvasUserId, { timeout } = {}) {
    return this.authenticateUsername(this.usernameFor(canvasUserId), { timeout });
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
}

module.exports = new VaultClient();
