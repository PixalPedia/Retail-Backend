const { supabase } = require('../supabaseClient'); // Adjust the path as needed

/**
 * Inserts a new session record into the sessions table.
 *
 * The sessions table has the following schema:
 *
 * CREATE TABLE sessions (
 *   id SERIAL PRIMARY KEY,
 *   session_id VARCHAR(128) NOT NULL,
 *   session_point VARCHAR(128) NOT NULL UNIQUE,
 *   user_agent TEXT,
 *   language VARCHAR(32),
 *   platform VARCHAR(64),
 *   screen_resolution VARCHAR(32),
 *   timezone_offset INTEGER,
 *   generated_at BIGINT NOT NULL,         -- Timestamp when the token was generated (in ms)
 *   last_access BIGINT,                   -- Optional: Last time the session was active (in ms)
 *   created_at TIMESTAMP DEFAULT NOW()    -- Record creation timestamp
 * );
 *
 * @param {Object} sessionData - Object containing session details:
 *   {
 *     sessionId,         // Unique identifier for the session
 *     sessionPoint,      // Unique identifier per active session (e.g. per tab)
 *     userAgent,         // Browser's user agent string
 *     language,          // Browser language
 *     platform,          // Operating system/platform
 *     screenResolution,  // Screen dimensions as a formatted string (e.g., "1920x1080")
 *     timezoneOffset,    // Time zone offset in minutes
 *     generatedAt,       // Timestamp in ms when the session token was generated
 *     lastAccess         // (Optional) Time in ms of the last access; defaults to generatedAt if not provided
 *   }
 *
 * @returns {Promise<Object>} The inserted session record.
 */
async function saveSessionRecord(sessionData) {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .insert([
        {
          session_id: sessionData.sessionId,
          session_point: sessionData.sessionPoint,
          user_agent: sessionData.userAgent,
          language: sessionData.language,
          platform: sessionData.platform,
          screen_resolution: sessionData.screenResolution,
          timezone_offset: sessionData.timezoneOffset,
          generated_at: sessionData.generatedAt, // Stored as BIGINT
          last_access: sessionData.lastAccess || sessionData.generatedAt, // Stored as BIGINT
        }
      ]);

    if (error) {
      console.error("Error inserting session record:", error);
      throw error;
    }
    return data;
  } catch (err) {
    console.error("Error in saveSessionRecord:", err);
    throw err;
  }
}

module.exports = { saveSessionRecord };
