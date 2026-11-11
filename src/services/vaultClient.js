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
}

module.exports = new VaultClient();
