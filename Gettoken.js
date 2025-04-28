function generateToken(length) {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._=/';
    let token = '';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * characters.length);
        token += characters[randomIndex];
    }
    return token;
}

const myToken = generateToken(256);
console.log(myToken);


// authMiddleware.js

const { Buffer } = require('buffer');

/**
 * Middleware that ensures every incoming request contains:
 * - A "ts" header with a Base64-encoded JSON string containing session details.
 * - An "authorization" header.
 *
 * If the "login" header is "true":
 *   The "authorization" header must be formatted as <USER_TOKEN_SECRET>::<userId>
 *   and the base part must match the secret stored on the backend.
 * 
 * Regardless of login status, the "ts" header is validated for both presence
 * and freshness (it must not be older than 30 seconds).
 */
function authenticateRequest(req, res, next) {
  // Check for the "ts" (session token) header in every request.
  const tsToken = req.headers.ts;
  if (!tsToken) {
    return res.status(401).json({ error: 'Unauthorized Request' });
  }

  // Validate and decode the session token.
  let sessionData;
  try {
    const decoded = Buffer.from(tsToken, 'base64').toString('utf-8');
    sessionData = JSON.parse(decoded);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid session token format' });
  }
  
  // Ensure the session token is fresh; here we enforce a 30-second validity period.
  const currentTime = Date.now();
  if (currentTime - sessionData.generatedAt > 30000) { // 30 seconds tolerance
    return res.status(403).json({ error: 'Session token expired' });
  }
  
  // Attach the session details to the request for downstream use.
  req.sessionData = sessionData;
  
  // Now ensure every request also includes an "authorization" header.
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }
  
  // Process the authentication token further if the request is from a logged-in user.
  const loginStatus = req.headers.login;
  if (loginStatus === "true") {
    // Expect the auth header to be in the format "<baseToken>::<embeddedUserId>"
    const parts = authHeader.split("::");
    if (parts.length !== 2) {
      return res.status(401).json({ error: 'Invalid token structure' });
    }
    
    const [baseToken, embeddedUserId] = parts;
    
    // Verify that the base token (our shared secret) matches the secret stored on the backend.
    if (baseToken !== process.env.USER_TOKEN_SECRET) {
      return res.status(403).json({ error: 'Invalid base token' });
    }
    
    // Attach the userId from the token to the request object.
    req.user = { id: embeddedUserId };
  }
  
  // For non-logged-in users (login != "true"), we assume that the provided "authorization"
  // header is some public token. Depending on your application's needs, you might validate
  // the format or contents of that token as well.
  
  // If all required headers are valid, proceed to the next middleware/route handler.
  next();
}

module.exports = authenticateRequest;
