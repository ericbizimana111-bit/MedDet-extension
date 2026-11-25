const router = require('express').Router();
const { serviceStatus } = require('../config/env');

router.get('/', (_req, res) => res.json({ success: true, data: { status: 'ok', services: serviceStatus() } }));

module.exports = router;
