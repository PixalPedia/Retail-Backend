const { Buffer } = require('buffer');
const { saveSessionRecord } = require('./sessionTable'); // Adjust path as needed
const { supabase } = require('../supabaseClient'); // Adjust path as needed
const crypto = require('crypto');

// --------------------------
// Rate Limiter Setup (In-Memory)
// --------------------------
const rateLimitMap = new Map(); // Track IP details

// Configuration constants
const BLOCK_INCREMENT = 5 * 60 * 1000;         // 5 minutes (initial block duration)
const REQUEST_LIMIT = 50;                      // Maximum allowed requests in time window
const TIME_WINDOW = 15 * 1000;                 // 15 seconds time window

// Helper function to detect socket requests
function isSocketRequest(req) {
  return req.headers.upgrade && req.headers.upgrade.toLowerCase() === 'websocket';
}

// Helper function to persist block info in the database
async function recordBlockedIp(ip, route, blockStart, blockEnd, requestCount) {
  try {
    const { data, error } = await supabase
      .from('blocked_ips')
      .insert([{
        ip,
        route,
        block_start: new Date(blockStart).toISOString(),
        block_end: new Date(blockEnd).toISOString(),
        request_count: requestCount,
        first_request: new Date(),
        last_request: new Date()
      }]);
    if (error) {
      console.error('Error storing blocked IP info:', error);
    }
    return data;
  } catch (err) {
    console.error('Exception recording blocked IP:', err);
  }
}

// --------------------------
// Authentication and Rate Limiting Middleware
// --------------------------
async function authenticateRequest(req, res, next) {
  // Exclude socket requests from rate limiting and session validation.
  if (isSocketRequest(req)) {
    return next();
  }

  // --------- RATE LIMITING ---------
  const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
  const currentTime = Date.now();
  let record = rateLimitMap.get(ip);

  if (!record) {
    record = { count: 1, start: currentTime, blockUntil: null, blockDuration: BLOCK_INCREMENT };
  } else {
    if (record.blockUntil && record.blockUntil > currentTime) {
      const waitTime = Math.ceil((record.blockUntil - currentTime) / 1000);
      return res.status(429).json({ error: `Too many requests. Please try again in ${waitTime} seconds.` });
    } else if (currentTime - record.start < TIME_WINDOW) {
      record.count++;
      if (record.count > REQUEST_LIMIT) {
        // IP exceeded the allowed limit: block and double block duration.
        record.blockUntil = currentTime + record.blockDuration;
        const waitTime = Math.ceil(record.blockDuration / 1000);
        record.blockDuration *= 2;
        // Record the block event (store IP, route, block start & end)
        const route = req.originalUrl || req.url;
        recordBlockedIp(ip, route, currentTime, record.blockUntil, record.count);
        rateLimitMap.set(ip, record);
        return res.status(429).json({ error: `Too many requests. Blocked for ${waitTime} seconds.` });
      }
    } else {
      // Reset rate limit record if time window has passed.
      record.count = 1;
      record.start = currentTime;
      record.blockUntil = null;
      record.blockDuration = BLOCK_INCREMENT;
    }
  }
  rateLimitMap.set(ip, record);
  // --------- END RATE LIMITING ---------

  // --------- SESSION TOKEN VALIDATION ---------
  const tsToken = req.headers.ts;
  if (!tsToken) {
    return res.status(401).json({ error: 'Unauthorized Request: Missing session token (ts)' });
  }

  let sessionData;
  try {
    const decoded = Buffer.from(tsToken, 'base64').toString('utf-8');
    sessionData = JSON.parse(decoded);
  } catch (err) {
    return res.status(400).json({ error: 'Invalid session token format' });
  }

  if (!sessionData.generatedAt || !sessionData.sessionId || !sessionData.sessionPoint) {
    return res.status(400).json({ error: 'Invalid session token: Missing required session details' });
  }

  if (currentTime - sessionData.generatedAt > 30000) { // 30 seconds limit
    return res.status(403).json({ error: 'Session token expired' });
  }

  req.sessionData = sessionData;

  try {
    await saveSessionRecord({
      sessionId: sessionData.sessionId,
      sessionPoint: sessionData.sessionPoint,
      userAgent: sessionData.userAgent,
      language: sessionData.language,
      platform: sessionData.platform,
      screenResolution: sessionData.screenResolution,
      timezoneOffset: sessionData.timezoneOffset,
      generatedAt: sessionData.generatedAt,
    });
  } catch (error) {
    console.error('Failed storing session info:', error);
    return res.status(500).json({ error: 'Internal server error: Unable to store session info.' });
  }
  // --------- END SESSION VALIDATION ---------

  // --------- AUTHORIZATION TOKEN VALIDATION ---------
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'Missing authentication token' });
  }

  const loginStatus = req.headers.login;
  if (loginStatus === "true") {
    const prefixLength = 20;
    const suffixLength = 16;

    if (authHeader.length <= (prefixLength + suffixLength)) {
      return res.status(401).json({ error: 'Invalid token length' });
    }
    
    const encodedMerged = authHeader.slice(prefixLength, authHeader.length - suffixLength);
    let merged;
    try {
      merged = Buffer.from(encodedMerged, 'base64').toString('utf-8');
    } catch (e) {
      return res.status(401).json({ error: 'Invalid token encoding' });
    }

    const secret = process.env.USER_TOKEN_SECRET;
    if (!secret) {
      return res.status(500).json({ error: 'Server configuration error: Secret missing' });
    }
    const splitIndex = Math.floor(secret.length / 2);
    const secretFirst = secret.slice(0, splitIndex);
    const secretSecond = secret.slice(splitIndex);

    if (!merged.startsWith(secretFirst) || !merged.endsWith(secretSecond)) {
      return res.status(403).json({ error: 'Invalid token structure' });
    }
    const embeddedUserId = merged.slice(secretFirst.length, merged.length - secretSecond.length);
    req.user = { id: embeddedUserId };
  }
  // --------- END AUTHORIZATION VALIDATION ---------

  next();
}

module.exports = authenticateRequest;
