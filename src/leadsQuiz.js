// ============================================================================
// leadsQuiz.js — conta registros do formulario do quiz em lp_form.leads.
// Somente COUNT(*). Nao le nome/email/telefone. Nao escreve nada.
//
// Regra combinada: linha conta como lead do quiz quando
//   UPPER(TRIM(COALESCE(funil_origem, ''))) = 'QUIZ'
// Contamos preenchimentos/registros (nao dedup por email por enquanto).
// ============================================================================
const { query } = require('./db');

// Regra global de exclusao de testes/internos + filtro de periodo por
// COALESCE(created_at::timestamp, "timestamp"::timestamp). Datas parametrizadas.
// $3 = entrada opcional ('a'|'b'|'c'|NULL): quando setada, aplica EXISTS contra
// funil_quiz.quiz_sessoes casando por session_id OU email (case-insensitive).
const SQL = `
  SELECT COUNT(*)::int AS total
  FROM lp_form.leads
  WHERE UPPER(TRIM(COALESCE(funil_origem, ''))) = 'QUIZ'
    AND COALESCE(email, '')      NOT ILIKE '%teste%'
    AND COALESCE(email, '')      NOT ILIKE '%reconecta%'
    AND COALESCE(first_name, '') NOT ILIKE '%teste%'
    AND COALESCE(instagram, '')  NOT ILIKE '%teste%'
    AND COALESCE(created_at::timestamp, "timestamp"::timestamp) >= $1::date
    AND COALESCE(created_at::timestamp, "timestamp"::timestamp) <  ($2::date + interval '1 day')
    AND (
      $3::text IS NULL
      OR EXISTS (
        SELECT 1
        FROM funil_quiz.quiz_sessoes qs
        WHERE LOWER(TRIM(qs.ab_entrada)) = $3::text
          AND NULLIF(TRIM(qs.email), '') IS NOT NULL
          AND COALESCE(qs.email, '') NOT ILIKE '%teste%'
          AND COALESCE(qs.email, '') NOT ILIKE '%reconecta%'
          AND (
            qs.session_id = lp_form.leads.session_id
            OR LOWER(TRIM(qs.email)) = LOWER(TRIM(lp_form.leads.email))
          )
      )
    )
`;

async function carregarLeads({ inicio, fim, entrada = null } = {}) {
  const { rows } = await query(SQL, [inicio, fim, entrada]);
  return Number(rows[0] && rows[0].total) || 0;
}

module.exports = { carregarLeads };
