const express = require('express');
const cors = require('cors');
const config = require('./config');
const { securityHeaders } = require('./middleware/security');
const { escapeHtml } = require('./utils/html');
const { listPlatforms } = require('./services/platformRegistry');
const sessionStore = require('./services/sessionStore');
const ltiState = require('./services/ltiState');
const deepLinking = require('./services/deepLinking');

const ltiRoutes = require('./routes/lti');
const apiRoutes = require('./routes/api');
const mobileRoutes = require('./routes/mobile');

const app = express();

// Trust reverse proxies (ngrok, Cloudflare Tunnel, Caddy, AWS ALB, etc.)
// (LTI URLs are built from GATEWAY_PUBLIC_URL, never from forwarded headers.)
app.set('trust proxy', true);
app.disable('x-powered-by');

// Middlewares
app.use(securityHeaders);
app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : false }));
// Parse application/x-www-form-urlencoded (used by Canvas LTI launches)
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
// Parse application/json, keeping the exact bytes for Vii hook signature verification.
app.use(
  express.json({
    limit: '512kb',
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// Routes
app.use('/lti', ltiRoutes);
app.use('/api', apiRoutes);
app.use('/launch', mobileRoutes);

// Compatibility aliases for attempt hooks without /api prefix (e.g. GATEWAY_HOOK_URL="https://gateway.example/hooks/vii")
app.use(['/hooks/vii/attempt', '/hooks/vii', '/hooks/attempts'], (req, res, next) => {
  req.url = '/hooks/vii/attempt';
  apiRoutes(req, res, next);
});

// Root landing / dashboard (public information only: no credentials are ever shown)
app.get('/', (req, res) => {
  const configured = listPlatforms().length > 0;
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>VAuLT LMS Gateway</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 40px; background: #f8fafc; color: #1e293b; }
        .card { max-width: 640px; margin: 0 auto; background: white; padding: 32px; border-radius: 12px; border: 1px solid #e2e8f0; }
        h1 { color: #0f172a; margin-top: 0; }
        code { background: #f1f5f9; padding: 3px 6px; border-radius: 4px; font-size: 13px; }
        ul { line-height: 1.8; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>VAuLT LMS Integration Gateway</h1>
        <p>This standalone microservice acts as the bridge between <strong>Canvas LMS (LTI 1.3)</strong> and the <strong>VAuLT Backend</strong>.</p>
        <h3>Endpoints:</h3>
        <ul>
          <li><strong>OIDC Login Initiation:</strong> <code>/lti/login</code></li>
          <li><strong>LTI Launch (Redirect URI):</strong> <code>/lti/launch</code></li>
          <li><strong>Public JWK URL:</strong> <code>/lti/jwks</code></li>
          <li><strong>Canvas Tool Config (JSON):</strong> <code>/lti/config.json</code></li>
          <li><strong>Health Check:</strong> <code>/api/health</code></li>
        </ul>
        <h3>Status:</h3>
        <ul>
          <li><strong>Canvas platform registered:</strong> ${configured ? 'yes' : 'NO - set the LTI_* variables'}</li>
          <li><strong>VAuLT Backend API:</strong> <code>${escapeHtml(config.vaultApiUrl)}</code></li>
        </ul>
      </div>
    </body>
    </html>
  `);
});

// Last-resort handlers: unknown routes and unexpected errors (JSON for non-LTI routes).
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(`[Gateway] Unhandled error on ${req.method} ${req.originalUrl}: ${err.stack || err.message}`);
    res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
    // Housekeeping: drop expired sessions, launch codes, login states and Deep Linking selections
    const prune = () => {
        sessionStore.pruneExpired();
        ltiState.pruneExpiredStates();
        deepLinking.pruneExpired();
    };
    prune();
    setInterval(prune, 10 * 60 * 1000).unref();

    
    console.log(`====================================================`);
    console.log(`🚀 VAuLT LMS Gateway (LTI 1.3) running on port ${config.port}`);
    console.log(`📡 VAuLT Backend API Target: ${config.vaultApiUrl}`);
    console.log(`🌐 Public URL: ${config.gatewayPublicUrl}`);
    console.log(`🎓 Canvas platform registered: ${listPlatforms().length > 0 ? 'yes' : 'NO (set LTI_* env vars)'}`);
    console.log(`====================================================`);
});