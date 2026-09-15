const jwt = require("jsonwebtoken");

function requireAuth(req, res, next){
  const token = req.cookies?.convergence_session;
  if(!token) return res.status(401).json({ error: "Not signed in." });
  try{
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { id: payload.sub, email: payload.email };
    next();
  }catch(err){
    return res.status(401).json({ error: "Session expired, please sign in again." });
  }
}

module.exports = { requireAuth };
