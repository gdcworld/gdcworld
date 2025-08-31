// netlify/functions/whoami.mjs
export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      },
      body: '',
    };
  }

  const url = process.env.SUPABASE_URL || '';
  const ref = (url.match(/^https:\/\/([^.]+)\.supabase\.co/i) || [])[1] || null;

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify({ ok: true, supabaseUrl: url, projectRef: ref }),
  };
}
