const { createClient } = require("@supabase/supabase-js");

function createUserSupabaseClient(accessToken) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        const error = new Error("Server Supabase configuration is missing.");
        error.code = "SUPABASE_CONFIG_MISSING";
        throw error;
    }

    return createClient(supabaseUrl, supabaseAnonKey, {
        global: {
            headers: {
                Authorization: `Bearer ${accessToken}`
            }
        },
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false
        }
    });
}

function createServiceSupabaseClient() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
        const error = new Error("Server recovery requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
        error.code = "SUPABASE_RECOVERY_CONFIG_MISSING";
        throw error;
    }
    return createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
}

module.exports = { createServiceSupabaseClient, createUserSupabaseClient };
