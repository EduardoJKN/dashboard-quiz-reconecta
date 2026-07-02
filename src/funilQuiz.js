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

const SQL_RESUMO = `
  SELECT
    COUNT(*)::int                                          AS abriram,
    COUNT(*) FILTER (WHERE iniciou)::int                   AS iniciaram,
    COUNT(*) FILTER (WHERE max_pergunta >= 15)::int        AS terminaram_quiz,
    COUNT(*) FILTER (WHERE chegou_formulario)::int         AS chegaram_form,
    COUNT(*) FILTER (WHERE virou_lead)::int                AS viraram_lead,
    COUNT(*) FILTER (WHERE clicou_comprar)::int            AS clicaram_comprar
  FROM funil_quiz.quiz_sessoes
`;

const SQL_ABANDONO_PERGUNTA = `
  SELECT
    max_pergunta AS parou_na_pergunta,
    COUNT(*)::int AS sessoes
  FROM funil_quiz.quiz_sessoes
  WHERE NOT virou_lead
  GROUP BY max_pergunta
  ORDER BY max_pergunta
`;

const SQL_ABANDONO_FORM = `
  SELECT COUNT(*)::int AS abandono_formulario
  FROM funil_quiz.quiz_sessoes
  WHERE chegou_formulario AND NOT virou_lead
`;

const SQL_ORIGEM = `
  SELECT
    COALESCE(NULLIF(TRIM(utm_parameters->>'utm_source'), ''), 'Sem origem') AS origem,
    COUNT(*)::int                                       AS sessoes,
    COUNT(*) FILTER (WHERE virou_lead)::int             AS leads,
    COUNT(*) FILTER (WHERE clicou_comprar)::int         AS compras
  FROM funil_quiz.quiz_sessoes
  GROUP BY 1
  ORDER BY sessoes DESC
`;

// Alcance por pergunta: quantas sessoes chegaram >= P1, >= P2, ..., >= P15.
const SQL_PERGUNTAS_ALCANCE = `
  SELECT
    gs.n AS pergunta,
    COUNT(*) FILTER (WHERE q.max_pergunta >= gs.n)::int AS sessoes
  FROM generate_series(1, 15) AS gs(n)
  CROSS JOIN funil_quiz.quiz_sessoes q
  GROUP BY gs.n
  ORDER BY gs.n
`;

async function carregarFunilQuiz() {
  const [resumo, aband, abandForm, origem, perguntas] = await Promise.all([
    query(SQL_RESUMO),
    query(SQL_ABANDONO_PERGUNTA),
    query(SQL_ABANDONO_FORM),
    query(SQL_ORIGEM),
    query(SQL_PERGUNTAS_ALCANCE),
  ]);
  const r = resumo.rows[0] || {};
  const abandonoForm = (abandForm.rows[0] && abandForm.rows[0].abandono_formulario) || 0;
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
  };
}

module.exports = { carregarFunilQuiz };
