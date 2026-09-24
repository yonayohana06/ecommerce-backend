require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "SUPABASE_URL dan SUPABASE_PUBLISHABLE_KEY wajib ada di .env",
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

module.exports = supabase;
