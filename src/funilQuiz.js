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

// Regra global de exclusao de testes/internos + filtro de periodo + filtro
// opcional de entrada A/B/C aplicados em UMA CTE 'base' que serve pra todas
// as queries. Assim ninguem escapa.
// Parametros: $1 = inicio, $2 = fim, $3 = entrada ('a'|'b'|'c'|NULL=todas).
const BASE_CTE = `
  WITH base AS (
    SELECT *
    FROM funil_quiz.quiz_sessoes
    WHERE NULLIF(TRIM(email), '') IS NOT NULL
      AND COALESCE(email, '') NOT ILIKE '%teste%'
      AND COALESCE(email, '') NOT ILIKE '%reconecta%'
      AND COALESCE(primeiro_evento, ultimo_evento) >= $1::date
      AND COALESCE(primeiro_evento, ultimo_evento) <  ($2::date + interval '1 day')
      AND (
        $3::text IS NULL
        OR LOWER(TRIM(ab_entrada)) = $3::text
      )
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

// Compras aprovadas no Guru (nao confundir com clicou_comprar).
const SQL_ORIGEM = `
  WITH base AS (
    SELECT *
    FROM funil_quiz.quiz_sessoes
    WHERE NULLIF(TRIM(email), '') IS NOT NULL
      AND COALESCE(email, '') NOT ILIKE '%teste%'
      AND COALESCE(email, '') NOT ILIKE '%reconecta%'
      AND COALESCE(primeiro_evento, ultimo_evento) >= $1::date
      AND COALESCE(primeiro_evento, ultimo_evento) <  ($2::date + interval '1 day')
      AND (
        $3::text IS NULL
        OR LOWER(TRIM(ab_entrada)) = $3::text
      )
  ),
  compras_aprovadas AS (
    SELECT DISTINCT LOWER(TRIM(g.customer_email)) AS email_norm
    FROM financeiro.guru_log_quiz g
    WHERE LOWER(TRIM(g.status)) = 'approved'
      AND NULLIF(TRIM(g.customer_email), '') IS NOT NULL
      AND COALESCE(g.customer_email, '') NOT ILIKE '%teste%'
      AND COALESCE(g.customer_email, '') NOT ILIKE '%reconecta%'
      AND COALESCE(g.guru_confirmed_at, g.guru_created_at, g.received_at) >= $1::date
      AND COALESCE(g.guru_confirmed_at, g.guru_created_at, g.received_at) <  ($2::date + interval '1 day')
  )
  SELECT
    COALESCE(NULLIF(TRIM(utm_parameters->>'utm_source'), ''), 'Sem origem') AS origem,
    COUNT(*)::int                                                         AS sessoes,
    COUNT(*) FILTER (WHERE virou_lead)::int                               AS leads,
    COUNT(*) FILTER (WHERE clicou_comprar)::int                           AS cliques_comprar,
    COUNT(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM compras_aprovadas ca
      WHERE ca.email_norm = LOWER(TRIM(base.email))
    ))::int                                                               AS compras_aprovadas
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

// Visitas na pagina — vem de funil_quiz.quiz_eventos (event='visita').
// Nao usa BASE_CTE porque visita acontece ANTES do email ser preenchido.
//
// Entrada canonica por sessao: cada session_id vale exatamente por UMA entrada
// A/B/C (a primeira valida por criado_em ASC). Sem isso a mesma sessao entrava
// em mais de um bucket A/B/C e o total ficava > soma das partes.
// Parametros: $1=inicio, $2=fim, $3=entrada ('a'|'b'|'c'|NULL=todas).
const SQL_VISITAS_PAGINA = `
  WITH visitas_canonicas AS (
    SELECT DISTINCT ON (session_id)
      session_id,
      LOWER(TRIM(ab_entrada)) AS entrada
    FROM funil_quiz.quiz_eventos
    WHERE LOWER(TRIM(event)) = 'visita'
      AND NULLIF(TRIM(session_id), '') IS NOT NULL
      AND LOWER(TRIM(ab_entrada)) IN ('a','b','c')
      AND criado_em >= $1::date
      AND criado_em <  ($2::date + interval '1 day')
    ORDER BY session_id, criado_em ASC
  )
  SELECT COUNT(*)::int AS visitas
  FROM visitas_canonicas
  WHERE ($3::text IS NULL OR entrada = $3::text)
`;

// Visitas por entrada A/B/C do periodo INTEIRO (sempre, sem filtro), pra o
// front conseguir mostrar comparativo mesmo com filtro ativo. Usa a MESMA
// base canonica pra garantir que A + B + C = total 'Todas'.
const SQL_VISITAS_AB = `
  WITH visitas_canonicas AS (
    SELECT DISTINCT ON (session_id)
      session_id,
      LOWER(TRIM(ab_entrada)) AS entrada
    FROM funil_quiz.quiz_eventos
    WHERE LOWER(TRIM(event)) = 'visita'
      AND NULLIF(TRIM(session_id), '') IS NOT NULL
      AND LOWER(TRIM(ab_entrada)) IN ('a','b','c')
      AND criado_em >= $1::date
      AND criado_em <  ($2::date + interval '1 day')
    ORDER BY session_id, criado_em ASC
  )
  SELECT entrada, COUNT(*)::int AS visitas
  FROM visitas_canonicas
  GROUP BY entrada
  ORDER BY entrada
`;

// Metricas por entrada A/B/C do periodo INTEIRO (independente do filtro
// selecionado), pra os cards do topo servirem de comparativo. As taxas
// (inicio/termino/conversao) sao calculadas em JS a partir desses agregados.
const SQL_AB_METRICAS = `
  SELECT
    LOWER(TRIM(ab_entrada)) AS entrada,
    COUNT(*)::int                                    AS abriram,
    COUNT(*) FILTER (WHERE iniciou)::int             AS iniciaram,
    COUNT(*) FILTER (WHERE max_pergunta >= 15)::int  AS terminaram,
    COUNT(*) FILTER (WHERE virou_lead)::int          AS converteram
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

async function carregarFunilQuiz({ inicio, fim, entrada = null } = {}) {
  // BASE_CTE recebe entrada via $3. Queries A/B/C (SQL_AB_*) NAO usam BASE_CTE
  // — sao sempre calculadas pro periodo inteiro pra servirem de comparativo.
  const paramsBase = [inicio, fim, entrada];
  const paramsAB = [inicio, fim];
  const paramsVisitas = [inicio, fim, entrada];
  const [
    resumo, aband, abandForm, origem, perguntas, perfis,
    abResumo, abPerguntas, abMetricas,
    visitasPag, visitasAB,
  ] = await Promise.all([
    query(SQL_RESUMO, paramsBase),
    query(SQL_ABANDONO_PERGUNTA, paramsBase),
    query(SQL_ABANDONO_FORM, paramsBase),
    query(SQL_ORIGEM, paramsBase),
    query(SQL_PERGUNTAS_ALCANCE, paramsBase),
    query(SQL_PERFIS, paramsBase),
    query(SQL_AB_RESUMO, paramsAB),
    query(SQL_AB_PERGUNTAS, paramsAB),
    query(SQL_AB_METRICAS, paramsAB),
    query(SQL_VISITAS_PAGINA, paramsVisitas),
    query(SQL_VISITAS_AB, paramsAB),
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

  const pct1 = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const zeroMet = () => ({
    abriram: 0, iniciaram: 0, terminaram: 0, converteram: 0,
    taxa_inicio: 0, taxa_termino: 0, taxa_conversao: 0,
  });
  const ab_metricas = { a: zeroMet(), b: zeroMet(), c: zeroMet() };
  for (const row of abMetricas.rows) {
    const k = row.entrada;
    if (k !== 'a' && k !== 'b' && k !== 'c') continue;
    const abriram = row.abriram || 0;
    const iniciaram = row.iniciaram || 0;
    const terminaram = row.terminaram || 0;
    const converteram = row.converteram || 0;
    ab_metricas[k] = {
      abriram,
      iniciaram,
      terminaram,
      converteram,
      taxa_inicio: pct1(iniciaram, abriram),
      taxa_termino: pct1(terminaram, abriram),
      taxa_conversao: pct1(converteram, abriram),
    };
  }

  const visitas_pagina = (visitasPag.rows[0] && visitasPag.rows[0].visitas) || 0;
  const visitas_por_entrada = { a: 0, b: 0, c: 0 };
  for (const row of visitasAB.rows) {
    if (row.entrada === 'a' || row.entrada === 'b' || row.entrada === 'c') {
      visitas_por_entrada[row.entrada] = row.visitas || 0;
    }
  }

  return {
    total_sessoes: r.abriram || 0,
    visitas_pagina,
    visitas_por_entrada,
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
    origens: origem.rows,           // [{ origem, sessoes, leads, cliques_comprar, compras_aprovadas }]
    perfis: perfis.rows,            // [{ nome, count }] — so agregado
    ab_entradas,                    // { a, b, c } — sessoes com email valido
    perguntas_ab,                   // [{ pergunta, a, b, c }] para P1..P15
    ab_metricas,                    // { a: {abriram,iniciaram,terminaram,converteram,taxa_*}, b, c }
  };
}

module.exports = { carregarFunilQuiz };
