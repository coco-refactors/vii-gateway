const crypto = require('crypto');
const axios = require('axios');
const config = require('../config');
const { hashId, safeDetail } = require('../utils/redact');

/** Raised when Vii cannot be reached or refuses the gateway; routes turn it into a clear message. */
class ViiUnavailableError extends Error {}

class VaultClient {
  constructor() {
    this.baseUrl = config.vaultApiUrl;
    this.client = axios.create({ baseURL: this.baseUrl, timeout: 8000 });
    this.catalog = null; // { experiences, fetchedAt }
  }

  /** Server-to-server headers for the Vii /gateway/* endpoints. */
  gatewayHeaders() {
    return { 'X-Gateway-Key': config.vii.apiKey, Accept: 'application/json' };
  }

  /**
   * All active experiences from Vii (GET /gateway/experiences), cached in memory for
   * VII_CATALOG_CACHE_SEC (default 60 s). Throws ViiUnavailableError if Vii cannot be reached.
   */
  async getExperiences({ fresh = false } = {}) {
    if (!fresh && this.catalog && Date.now() - this.catalog.fetchedAt < config.vii.catalogCacheMs) {
      return this.catalog.experiences.map((e) => ({ ...e }));
    }
    try {
      const res = await this.client.get('/gateway/experiences', { headers: this.gatewayHeaders() });
      const list = res.data && res.data.returnCode === 0 && res.data.data && res.data.data.experiences;
      if (!Array.isArray(list)) throw new Error('unexpected response');
      const experiences = list.map((e) => ({ id: parseInt(e.id, 10), name: String(e.name || ''), description: String(e.description || '') }));
      this.catalog = { experiences, fetchedAt: Date.now() };
      return experiences.map((e) => ({ ...e }));
    } catch (err) {
      console.warn(`[VaultClient] Could not load experiences from Vii: ${err.response ? `HTTP ${err.response.status}` : safeDetail(err.message)}`);
      throw new ViiUnavailableError('Vii is unavailable');
    }
  }

  /** Experience by id, or null if Vii does not list it (deleted or inactive). */
  async findExperience(questId) {
    const id = parseInt(questId, 10);
    if (!id) return null;
    const experiences = await this.getExperiences();
    return experiences.find((e) => e.id === id) || null;
  }

  /**
   * The user's attempts at an experience, read live from Vii (GET /gateway/attempt-state). The gateway
   * keeps no completion data of its own. Returns { attempts, latest } or null if Vii is unreachable.
   */
  async getAttemptState(username, questId) {
    try {
      const res = await this.client.get('/gateway/attempt-state', {
        headers: this.gatewayHeaders(),
        params: { username, quest_id: questId },
        timeout: 5000,
      });
      if (!res.data || res.data.returnCode !== 0 || !res.data.data) throw new Error('unexpected response');
      const { attempts, latest } = res.data.data;
      return {
        attempts: parseInt(attempts, 10) || 0,
        latest: latest
          ? { id: latest.id, number: latest.number, status: latest.status, finishedAt: latest.finishedAt || null }
          : null,
      };
    } catch (err) {
      console.warn(`[VaultClient] Attempt state unavailable for ${hashId(username)}: ${err.response ? `HTTP ${err.response.status}` : safeDetail(err.message)}`);
      return null;
    }
  }

  /**
   * Deterministic VAuLT username for a Canvas user. If sanitising had to strip characters, a short
   * hash of the original id is appended so two different Canvas ids can never map to one account.
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
}

const vaultClient = new VaultClient();
vaultClient.ViiUnavailableError = ViiUnavailableError;
module.exports = vaultClient;
