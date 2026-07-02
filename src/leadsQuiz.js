// ============================================================================
// leadsQuiz.js — conta registros do formulario do quiz em lp_form.leads.
// Somente COUNT(*). Nao le nome/email/telefone. Nao escreve nada.
//
// Regra combinada: linha conta como lead do quiz quando
//   UPPER(TRIM(COALESCE(funil_origem, ''))) = 'QUIZ'
// Contamos preenchimentos/registros (nao dedup por email por enquanto).
// ============================================================================
const { query } = require('./db');

// Regra global de exclusao de testes/internos: alem de email com 'teste' ou
// 'reconecta', tambem exclui leads com first_name ou instagram contendo
// 'teste' — sao registros internos que nao usam email de teste.
const SQL = `
  SELECT COUNT(*)::int AS total
  FROM lp_form.leads
  WHERE UPPER(TRIM(COALESCE(funil_origem, ''))) = 'QUIZ'
    AND COALESCE(email, '')      NOT ILIKE '%teste%'
    AND COALESCE(email, '')      NOT ILIKE '%reconecta%'
    AND COALESCE(first_name, '') NOT ILIKE '%teste%'
    AND COALESCE(instagram, '')  NOT ILIKE '%teste%'
`;

async function carregarLeads() {
  const { rows } = await query(SQL);
  return Number(rows[0] && rows[0].total) || 0;
}

module.exports = { carregarLeads };
