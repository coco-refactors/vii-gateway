const fs = require('fs');
const path = require('path');
const config = require('../config');

/**
 * Minimal durable key-value store (JSON snapshot, atomic write). Survives gateway restarts.
 * Single-process only. To scale out, replace this module with a MariaDB-backed one exposing the same
 * methods (see schema.sql).
 */
class Storage {
  constructor(file) {
    this.file = file;
    this.data = {};
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    if (!fs.existsSync(this.file)) return;
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')) || {};
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      fs.renameSync(this.file, backup);
      console.error(`[Storage] Corrupt store moved to ${backup}: ${err.message}`);
      this.data = {};
    }
  }

  flush() {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get(collection, key) {
    const col = this.data[collection];
    return col && Object.prototype.hasOwnProperty.call(col, key) ? col[key] : null;
  }

  set(collection, key, value) {
    if (!this.data[collection]) this.data[collection] = {};
    this.data[collection][key] = value;
    this.flush();
    return value;
  }

  delete(collection, key) {
    const col = this.data[collection];
    if (col && Object.prototype.hasOwnProperty.call(col, key)) {
      delete col[key];
      this.flush();
    }
  }

  values(collection) {
    return Object.values(this.data[collection] || {});
  }

  /** Delete every record in `collection` for which `shouldDelete(record)` is true. */
  prune(collection, shouldDelete) {
    const col = this.data[collection];
    if (!col) return 0;
    let removed = 0;
    for (const [key, record] of Object.entries(col)) {
      if (shouldDelete(record)) {
        delete col[key];
        removed += 1;
      }
    }
    if (removed) this.flush();
    return removed;
  }
}

module.exports = new Storage(path.join(config.dataDir, 'gateway-store.json'));
