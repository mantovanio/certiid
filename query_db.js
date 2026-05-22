import fs from 'fs';

// Load .env variables
const envText = fs.readFileSync('.env', 'utf-8');
const env = {};
for (const line of envText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  env[key] = val;
}

const supabaseUrl = env.VITE_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error("Missing credentials in .env");
  process.exit(1);
}

const headers = {
  'apikey': serviceKey,
  'Authorization': `Bearer ${serviceKey}`,
  'Content-Type': 'application/json'
};

async function checkIntegrations() {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/external_integrations?select=*`, { headers });
    if (!res.ok) {
      console.error(`HTTP Error: ${res.status}`);
      const text = await res.text();
      console.error(text);
      return;
    }
    const data = await res.json();
    console.log("=== external_integrations ===");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Error fetching integrations:", err);
  }
}

checkIntegrations();
