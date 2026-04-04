const express = require('express');
const { getDashboardStats, getPublicScreenData } = require('../db');
const { getScreenClientCount } = require('../socket');

module.exports = function createPublicRouter() {
  const router = express.Router();

  router.get('/screen-data', (_req, res) => {
    res.json(getPublicScreenData());
  });

  router.get('/dashboard', (_req, res) => {
    res.json({
      ...getDashboardStats(),
      connectedScreens: getScreenClientCount(),
    });
  });

  return router;
};
