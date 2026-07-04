// ============================================================================
// funilQuiz.js — metricas de sessao/funil, abandono e origem a partir de
// funil_quiz.quiz_sessoes. Somente queries agregadas (COUNT/FILTER). Nao le
// email, session_id ou qualquer PII individual.
//
// IMPORTANTE:
//   - A contagem oficial de "Leads (formulario)" NAO vem daqui — ela vem de
//     lp_form.leads via carregarLeads(). Este helper serve apenas para o
//     bloco de sessao/funil/abandono/origem.
// ============================================================================
const { query } = require('./db');

// Regra global de exclusao de testes/internos + filtro de periodo aplicados
// em UMA CTE 'base' que serve pra todas as queries. Assim ninguem escapa.
// Datas parametrizadas ($1 = inicio, $2 = fim).
const BASE_CTE = `
  WITH base AS (
    SELECT *
    FROM funil_quiz.quiz_sessoes
    WHERE NULLIF(TRIM(email), '') IS NOT NULL
      AND COALESCE(email, '') NOT ILIKE '%teste%'
      AND COALESCE(email, '') NOT ILIKE '%reconecta%'
      AND COALESCE(primeiro_evento, ultimo_evento) >= $1::date
      AND COALESCE(primeiro_evento, ultimo_evento) <  ($2::date + interval '1 day')
  )
`;

const SQL_RESUMO = `
  ${BASE_CTE}
  SELECT
    COUNT(*)::int                                          AS abriram,
    COUNT(*) FILTER (WHERE iniciou)::int                   AS iniciaram,
    COUNT(*) FILTER (WHERE max_pergunta >= 15)::int        AS terminaram_quiz,
    COUNT(*) FILTER (WHERE chegou_formulario)::int         AS chegaram_form,
    COUNT(*) FILTER (WHERE virou_lead)::int                AS viraram_lead,
    COUNT(*) FILTER (WHERE clicou_comprar)::int            AS clicaram_comprar
  FROM base
`;

const SQL_ABANDONO_PERGUNTA = `
  ${BASE_CTE}
  SELECT
    max_pergunta AS parou_na_pergunta,
    COUNT(*)::int AS sessoes
  FROM base
  WHERE NOT virou_lead
  GROUP BY max_pergunta
  ORDER BY max_pergunta
`;

const SQL_ABANDONO_FORM = `
  ${BASE_CTE}
  SELECT COUNT(*)::int AS abandono_formulario
  FROM base
  WHERE chegou_formulario AND NOT virou_lead
`;

const SQL_ORIGEM = `
  ${BASE_CTE}
  SELECT
    COALESCE(NULLIF(TRIM(utm_parameters->>'utm_source'), ''), 'Sem origem') AS origem,
    COUNT(*)::int                                       AS sessoes,
    COUNT(*) FILTER (WHERE virou_lead)::int             AS leads,
    COUNT(*) FILTER (WHERE clicou_comprar)::int         AS compras
  FROM base
  GROUP BY 1
  ORDER BY sessoes DESC
`;

// Alcance por pergunta: quantas sessoes chegaram >= P1, >= P2, ..., >= P15.
const SQL_PERGUNTAS_ALCANCE = `
  ${BASE_CTE}
  SELECT
    gs.n AS pergunta,
    COUNT(*) FILTER (WHERE q.max_pergunta >= gs.n)::int AS sessoes
  FROM generate_series(1, 15) AS gs(n)
  CROSS JOIN base q
  GROUP BY gs.n
  ORDER BY gs.n
`;

// Distribuicao por perfil entre quem chegou ao diagnostico (max_pergunta >= 15)
// e tem perfil preenchido. So agregado — nunca linha individual.
const SQL_PERFIS = `
  ${BASE_CTE}
  SELECT
    TRIM(perfil) AS nome,
    COUNT(*)::int AS count
  FROM base
  WHERE max_pergunta >= 15
    AND NULLIF(TRIM(perfil), '') IS NOT NULL
  GROUP BY TRIM(perfil)
  ORDER BY count DESC
`;

// A/B/C: queries independentes da BASE_CTE porque exigem email preenchido
// (regra de negocio das metricas A/B/C — se aplicasse na BASE_CTE, cortaria
// tambem "Abriram o quiz", "Comecaram", etc.).
const SQL_AB_RESUMO = `
  SELECT
    LOWER(TRIM(ab_entrada)) AS entrada,
    COUNT(*)::int AS sessoes
  FROM funil_quiz.quiz_sessoes
  WHERE NULLIF(TRIM(ab_entrada), '') IS NOT NULL
    AND LOWER(TRIM(ab_entrada)) IN ('a', 'b', 'c')
    AND NULLIF(TRIM(email), '') IS NOT NULL
    AND COALESCE(email, '') NOT ILIKE '%teste%'
    AND COALESCE(email, '') NOT ILIKE '%reconecta%'
    AND COALESCE(primeiro_evento, ultimo_evento) >= $1::date
    AND COALESCE(primeiro_evento, ultimo_evento) <  ($2::date + interval '1 day')
  GROUP BY 1
  ORDER BY 1
`;

const SQL_AB_PERGUNTAS = `
  SELECT
    gs.n AS pergunta,
    LOWER(TRIM(q.ab_entrada)) AS entrada,
    COUNT(*) FILTER (WHERE q.max_pergunta >= gs.n)::int AS sessoes
  FROM generate_series(1, 15) AS gs(n)
  CROSS JOIN funil_quiz.quiz_sessoes q
  WHERE NULLIF(TRIM(q.ab_entrada), '') IS NOT NULL
    AND LOWER(TRIM(q.ab_entrada)) IN ('a', 'b', 'c')
    AND NULLIF(TRIM(q.email), '') IS NOT NULL
    AND COALESCE(q.email, '') NOT ILIKE '%teste%'
    AND COALESCE(q.email, '') NOT ILIKE '%reconecta%'
    AND COALESCE(q.primeiro_evento, q.ultimo_evento) >= $1::date
    AND COALESCE(q.primeiro_evento, q.ultimo_evento) <  ($2::date + interval '1 day')
  GROUP BY gs.n, LOWER(TRIM(q.ab_entrada))
  ORDER BY gs.n, entrada
`;

async function carregarFunilQuiz({ inicio, fim } = {}) {
  const params = [inicio, fim];
  const [resumo, aband, abandForm, origem, perguntas, perfis, abResumo, abPerguntas] = await Promise.all([
    query(SQL_RESUMO, params),
    query(SQL_ABANDONO_PERGUNTA, params),
    query(SQL_ABANDONO_FORM, params),
    query(SQL_ORIGEM, params),
    query(SQL_PERGUNTAS_ALCANCE, params),
    query(SQL_PERFIS, params),
    query(SQL_AB_RESUMO, params),
    query(SQL_AB_PERGUNTAS, params),
  ]);
  const r = resumo.rows[0] || {};
  const abandonoForm = (abandForm.rows[0] && abandForm.rows[0].abandono_formulario) || 0;

  const ab_entradas = { a: 0, b: 0, c: 0 };
  for (const row of abResumo.rows) {
    if (row.entrada === 'a' || row.entrada === 'b' || row.entrada === 'c') {
      ab_entradas[row.entrada] = row.sessoes || 0;
    }
  }

  const perguntas_ab = [];
  for (let n = 1; n <= 15; n++) perguntas_ab.push({ pergunta: n, a: 0, b: 0, c: 0 });
  for (const row of abPerguntas.rows) {
    const idx = (row.pergunta || 0) - 1;
    if (idx < 0 || idx >= 15) continue;
    if (row.entrada === 'a' || row.entrada === 'b' || row.entrada === 'c') {
      perguntas_ab[idx][row.entrada] = row.sessoes || 0;
    }
  }

  return {
    total_sessoes: r.abriram || 0,
    totais: {
      visitas: r.abriram || 0,
      iniciaram: r.iniciaram || 0,
      resultados: r.terminaram_quiz || 0,
      compras: r.clicaram_comprar || 0,
    },
    // Para o array 'funil': quantas sessoes chegaram na etapa 'lead'/'captura'
    // (usado no desenho do funil — nao substitui totais.leads oficial).
    chegaram_form: r.chegaram_form || 0,
    viraram_lead: r.viraram_lead || 0,
    perguntas_abandono: aband.rows, // [{ parou_na_pergunta, sessoes }]
    perguntas_alcance: perguntas.rows, // [{ pergunta, sessoes }]
    abandono_formulario: abandonoForm,
    origens: origem.rows,           // [{ origem, sessoes, leads, compras }]
    perfis: perfis.rows,            // [{ nome, count }] — so agregado
    ab_entradas,                    // { a, b, c } — so quem tem email valido
    perguntas_ab,                   // [{ pergunta, a, b, c }] para P1..P15
  };
}

module.exports = { carregarFunilQuiz };
