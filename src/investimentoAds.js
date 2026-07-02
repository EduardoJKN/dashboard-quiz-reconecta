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

// $1 = campanha, $2 = inicio (YYYY-MM-DD), $3 = fim (YYYY-MM-DD).
// Para api_conversoes.anuncios, o campo de janela e date_start; usamos
// intervalo fechado nos dois lados, como especificado.
const SQL = `
  SELECT COALESCE(SUM(spend), 0)::numeric(12,2) AS investimento
  FROM api_conversoes.anuncios
  WHERE LOWER(TRIM(campaign_name)) = LOWER($1)
    AND date_start >= $2::date
    AND date_start <= $3::date
`;

async function carregarInvestimento({ inicio, fim } = {}) {
  const { rows } = await query(SQL, [CAMPANHA, inicio, fim]);
  const v = Number(rows[0] && rows[0].investimento) || 0;
  return Math.round(v * 100) / 100;
}

module.exports = { carregarInvestimento, CAMPANHA };
