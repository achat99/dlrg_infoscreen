const express = require('express');
const { getDashboardStats, getPublicScreenData, getScreenClients } = require('../db');
const { getScreenClientCount } = require('../socket');

module.exports = function createPublicRouter() {
  const router = express.Router();

  router.get('/screen-data', (req, res) => {
    const includeStreams = req.query.streams !== 'false';
    res.json(getPublicScreenData({ includeStreams }));
  });

  router.get('/dashboard', (_req, res) => {
    res.json({
      ...getDashboardStats(),
      connectedScreens: getScreenClientCount(),
    });
  });

  router.get('/clients', (_req, res) => {
    res.json(getScreenClients());
  });

  return router;
};
