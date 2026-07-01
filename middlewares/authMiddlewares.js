const jwt = require("jsonwebtoken");

const getBearerToken = (req) => {
  const authorization = req.headers.authorization || "";
  const [scheme, token] = authorization.split(" ");
  return /^Bearer$/i.test(scheme) ? token : null;
};

const tokenRequired = (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ message: "Token is invalid" });
  }
};

// Public endpoints can still identify a signed-in user when a token is present.
// An invalid supplied token is rejected instead of silently treating it as a guest.
const optionalToken = (req, res, next) => {
  const token = getBearerToken(req);
  if (!token) return next();

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch (err) {
    res.status(403).json({ message: "Token is invalid" });
  }
};

module.exports = tokenRequired;
module.exports.optionalToken = optionalToken;
