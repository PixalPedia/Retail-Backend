const { createClient } = require('@supabase/supabase-js');
require('dotenv').config(); // Load environment variables from .env file

// Initialize Supabase client (regular client for standard operations)
const supabase = createClient(
    process.env.SUPABASE_URL,  // The Supabase Project URL
    process.env.SUPABASE_KEY   // Public or anonymous API key
);

// Initialize Supabase admin client (for privileged operations using Service Role Key)
const supabaseAdmin = createClient(
    process.env.SUPABASE_URL,  // The Supabase Project URL
    process.env.SUPABASE_SERVICE_ROLE  // Service Role Key for admin operations
);

// Optional: Log to verify client creation (for debugging only, remove in production)
console.log('Supabase clients initialized');

// Export both Supabase clients
module.exports = { supabase, supabaseAdmin };
