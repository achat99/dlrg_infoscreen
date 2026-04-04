function requireAuth(req, res, next) {
  if (req.session?.isAuthenticated) {
    return next();
  }

  return res.status(401).json({ error: 'Nicht autorisiert' });
}

function requirePageAuth(req, res, next) {
  if (req.session?.isAuthenticated) {
    return next();
  }

  return res.redirect('/admin/login');
}

function login(req, res) {
  const { password } = req.body || {};
  const expectedPassword = process.env.ADMIN_PASSWORD || 'changeme';

  if (!password || password !== expectedPassword) {
    return res.status(401).json({ error: 'Ungültiges Passwort' });
  }

  req.session.isAuthenticated = true;
  req.session.save(() => {
    res.json({ success: true });
  });
}

function logout(req, res) {
  req.session.destroy(() => {
    res.json({ success: true });
  });
}

function authCheck(req, res) {
  res.json({ authenticated: Boolean(req.session?.isAuthenticated) });
}

module.exports = {
  requireAuth,
  requirePageAuth,
  login,
  logout,
  authCheck,
};
