// ============================================================================
// investimentoAds.js — soma o spend das campanhas do quiz a partir da tabela
// api_conversoes.anuncios. Somente leitura, apenas SUM(spend). Nao le
// nome de anuncio, ad_id, criativo ou qualquer outro campo individual.
//
// Campanhas consideradas (quiz / diagnostico Purchase):
//   Diagnóstico | Teste | CBO | Purchase
//   Quiz | Teste | CBO | Purchase
//   Quiz | Teste | CBO | Purchase | AB
// ============================================================================
const { query } = require('./db');

const CAMPANHAS = [
  'Diagnóstico | Teste | CBO | Purchase',
  'Quiz | Teste | CBO | Purchase',
  'Quiz | Teste | CBO | Purchase | AB',
];

// Compat: export antigo (primeira campanha da lista).
const CAMPANHA = CAMPANHAS[0];

// $1 = inicio (YYYY-MM-DD), $2 = fim (YYYY-MM-DD).
// Para api_conversoes.anuncios, o campo de janela e date_start; usamos
// intervalo fechado nos dois lados. Investimento NAO filtra por Entrada A/B/C.
const SQL = `
  SELECT COALESCE(SUM(spend), 0)::numeric(12,2) AS investimento
  FROM api_conversoes.anuncios
  WHERE LOWER(TRIM(campaign_name)) = ANY($1::text[])
    AND date_start >= $2::date
    AND date_start <= $3::date
`;

async function carregarInvestimento({ inicio, fim } = {}) {
  const nomes = CAMPANHAS.map((c) => c.toLowerCase());
  const { rows } = await query(SQL, [nomes, inicio, fim]);
  const v = Number(rows[0] && rows[0].investimento) || 0;
  return Math.round(v * 100) / 100;
}

module.exports = { carregarInvestimento, CAMPANHA, CAMPANHAS };
