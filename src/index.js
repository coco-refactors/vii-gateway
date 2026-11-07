const express = require('express');
const cors = require('cors');
const config = require('./config');
const { securityHeaders } = require('./middleware/security');
const { escapeHtml } = require('./utils/html');
const { listPlatforms } = require('./services/platformRegistry');
const sessionStore = require('./services/sessionStore');
const ltiState = require('./services/ltiState');

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
app.use(express.urlencoded({ extended: true }));
// Parse application/json
app.use(express.json());

// Routes
app.use('/lti', ltiRoutes);
app.use('/api', apiRoutes);
app.use('/launch', mobileRoutes);

// Last-resort handlers: unknown routes and unexpected errors (JSON for non-LTI routes).
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(`[Gateway] Unhandled error on ${req.method} ${req.originalUrl}: ${err.stack || err.message}`);
    res.status(err.status || 500).json({ error: 'Internal server error' });
});

// Start server
app.listen(config.port, () => {
    // Housekeeping: drop expired sessions / login states now and hourly
    const prune = () => {
        sessionStore.pruneExpired();
        ltiState.pruneExpiredStates();
    };
    prune();
    setInterval(prune, 60 * 60 * 1000).unref();

    
    console.log(`====================================================`);
    console.log(`🚀 VAuLT LMS Gateway (LTI 1.3) running on port ${config.port}`);
    console.log(`📡 VAuLT Backend API Target: ${config.vaultApiUrl}`);
    console.log(`🌐 Public URL: ${config.gatewayPublicUrl}`);
    console.log(`🎓 Canvas platform registered: ${listPlatforms().length > 0 ? 'yes' : 'NO (set LTI_* env vars)'}`);
    console.log(`====================================================`);
});