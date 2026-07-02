// ============================================================================
// leadsQuiz.js — conta registros do formulario do quiz em lp_form.leads.
// Somente COUNT(*). Nao le nome/email/telefone. Nao escreve nada.
//
// Regra combinada: linha conta como lead do quiz quando
//   UPPER(TRIM(COALESCE(funil_origem, ''))) = 'QUIZ'
// Contamos preenchimentos/registros (nao dedup por email por enquanto).
// ============================================================================
const { query } = require('./db');

// Regra global de exclusao de testes/internos: emails com 'teste' ou 'reconecta'
// nao entram nos calculos do dashboard.
const SQL = `
  SELECT COUNT(*)::int AS total
  FROM lp_form.leads
  WHERE UPPER(TRIM(COALESCE(funil_origem, ''))) = 'QUIZ'
    AND COALESCE(email, '') NOT ILIKE '%teste%'
    AND COALESCE(email, '') NOT ILIKE '%reconecta%'
`;

async function carregarLeads() {
  const { rows } = await query(SQL);
  return Number(rows[0] && rows[0].total) || 0;
}

module.exports = { carregarLeads };
