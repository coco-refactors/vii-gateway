const express = require('express');
const cors = require('cors');
const config = require('./config');
const { securityHeaders } = require('./middleware/security');
const { escapeHtml } = require('./utils/html');
const sessionStore = require('./services/sessionStore');
const apiRoutes = require('./routes/api');

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

//Routes
app.use('/api', apiRoutes);

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