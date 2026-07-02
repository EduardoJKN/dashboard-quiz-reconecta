// ============================================================================
// db.js — Pool do Postgres (somente leitura).
// Le DATABASE_URL e DATABASE_SSL do .env. Se DATABASE_URL nao existir, exporta
// pool = null pra quem consome cair no fallback antigo sem quebrar.
// ============================================================================
const { Pool } = require('pg');

const url = process.env.DATABASE_URL;
const sslEnv = String(process.env.DATABASE_SSL || '').toLowerCase();
const useSsl = sslEnv === 'true' || sslEnv === '1' || sslEnv === 'require';

// A senha do Postgres pode ter caracteres nao codificados (ex.: , [ ' % < >) que
// quebram o parser WHATWG do pg. Extraimos user/pass via regex e passamos os
// campos separados; pra host/porta/db, deixamos o URL da parte apos '@'.
function parseUrl(raw) {
  const m = /^(postgres(?:ql)?):\/\/([^:]+):(.*)@([^/:@]+)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/.exec(raw);
  if (!m) throw new Error('DATABASE_URL invalida');
  return {
    user: decodeURIComponent(m[2]),
    password: m[3], // NAO decodifica: usuario colocou literal no .env
    host: m[4],
    port: m[5] ? Number(m[5]) : 5432,
    database: m[6],
  };
}

let pool = null;
if (url) {
  const cfg = parseUrl(url);
  pool = new Pool({
    ...cfg,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => {
    console.error('[db] erro no pool:', err.message);
  });
}

async function query(text, params) {
  if (!pool) throw new Error('DATABASE_URL nao configurada');
  return pool.query(text, params);
}

module.exports = { pool, query };
