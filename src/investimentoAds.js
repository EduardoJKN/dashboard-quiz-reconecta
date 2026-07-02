// ============================================================================
// investimentoAds.js — soma o spend da campanha do quiz a partir da tabela
// api_conversoes.anuncios. Somente leitura, apenas SUM(spend). Nao le
// nome de anuncio, ad_id, criativo ou qualquer outro campo individual.
//
// Campanha considerada (fixo por enquanto):
//   Diagnóstico | Teste | CBO | Purchase
// ============================================================================
const { query } = require('./db');

const CAMPANHA = 'Diagnóstico | Teste | CBO | Purchase';

const SQL = `
  SELECT COALESCE(SUM(spend), 0)::numeric(12,2) AS investimento
  FROM api_conversoes.anuncios
  WHERE LOWER(TRIM(campaign_name)) = LOWER($1)
`;

async function carregarInvestimento() {
  const { rows } = await query(SQL, [CAMPANHA]);
  const v = Number(rows[0] && rows[0].investimento) || 0;
  return Math.round(v * 100) / 100;
}

module.exports = { carregarInvestimento, CAMPANHA };
