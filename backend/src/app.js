const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { env } = require('./config/env');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const app = express();
app.set('trust proxy', 1); // behind Render's proxy: real client IP for rate limiting
app.use(helmet());
app.use(
  cors({
    origin(origin, cb) {
      // Extension service workers send chrome-extension://<id>. No-origin = curl/health checks.
      if (!origin || origin.startsWith('chrome-extension://') || env.corsExtraOrigins.includes(origin)) return cb(null, true);
      cb(null, false);
    },
  })
);
app.use(express.json({ limit: '12mb' }));

app.use('/api/v1/health', require('./routes/health.routes'));
app.use('/api/v1/identify', require('./routes/identify.routes'));

app.use(notFound);
app.use(errorHandler);

module.exports = app;
