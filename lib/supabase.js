const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
    console.warn('[Supabase] SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for database and auth callbacks.');
}

const supabase = createClient(supabaseUrl || 'http://localhost:54321', supabaseServiceRoleKey || 'missing-key', {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

module.exports = supabase;
