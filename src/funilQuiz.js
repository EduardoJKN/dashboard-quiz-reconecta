// ============================================================================
// funilQuiz.js — metricas de jornada por session_id a partir de
// funil_quiz.quiz_eventos (etapas P1→P15), enriquecidas com quiz_sessoes e
// lp_form.leads. Somente agregados — sem PII individual.
//
// Unidade: DISTINCT session_id por etapa.
// data_ref: data do lead se houver lead; senao ultimo_evento da sessao.
// Performance: 2 queries (base filtrada + A/B/C).
// ============================================================================
const { query } = require('./db');
const { sqlCteJornadaSessao } = require('./filtroTesteLeadsSql');

const CORE_CTES = sqlCteJornadaSessao();

const P_ALCANCE_COLS = Array.from({ length: 15 }, (_, i) => (
  `COUNT(*) FILTER (WHERE max_passo >= ${i + 1})::int AS p${i + 1}`
)).join(',\n      ');

// Query 1: resumo + P1..P15 + abandono + perfis (1 scan materializado).
const SQL_FUNIL_FILTRADO = `
  WITH ${CORE_CTES},
  base AS MATERIALIZED (
    SELECT * FROM sessoes_enriquecidas
    WHERE $3::text IS NULL OR entrada_resolvida = $3::text
  ),
  agg AS (
    SELECT
      COUNT(*) FILTER (WHERE visitou)::int AS visitas_pagina,
      COUNT(*) FILTER (WHERE entrou_quiz OR iniciou OR max_passo > 0 OR tem_lead)::int AS abriram,
      COUNT(*) FILTER (WHERE iniciou)::int AS iniciaram,
      COUNT(*) FILTER (WHERE max_passo >= 15)::int AS terminaram_quiz,
      COUNT(*) FILTER (WHERE chegou_formulario)::int AS chegaram_form,
      COUNT(*) FILTER (WHERE tem_lead)::int AS viraram_lead,
      COUNT(*) FILTER (WHERE clicou_comprar)::int AS clicaram_comprar,
      COUNT(*) FILTER (
        WHERE NOT tem_lead
          AND (chegou_formulario OR max_passo >= 15)
      )::int AS abandono_formulario,
      COUNT(*) FILTER (WHERE tem_lead)::int AS com_lead,
      COUNT(*) FILTER (WHERE NOT tem_lead)::int AS sem_lead,
      ${P_ALCANCE_COLS}
    FROM base
  )
  SELECT
    agg.*,
    (
      SELECT COALESCE(json_agg(json_build_object(
        'parou_na_pergunta', t.parou_na_pergunta,
        'sessoes', t.sessoes
      ) ORDER BY t.parou_na_pergunta), '[]'::json)
      FROM (
        SELECT
          CASE
            WHEN max_passo IS NULL OR max_passo <= 0 THEN 0
            ELSE max_passo
          END AS parou_na_pergunta,
          COUNT(*)::int AS sessoes
        FROM base
        WHERE NOT tem_lead
          AND (entrou_quiz OR iniciou OR max_passo > 0)
          AND max_passo > 0
          AND max_passo < 15
        GROUP BY 1
      ) t
    ) AS abandono_json,
    (
      SELECT COALESCE(json_agg(json_build_object(
        'nome', t.nome,
        'count', t.count
      ) ORDER BY t.count DESC), '[]'::json)
      FROM (
        SELECT TRIM(perfil) AS nome, COUNT(*)::int AS count
        FROM base
        WHERE max_passo >= 15
          AND NULLIF(TRIM(perfil), '') IS NOT NULL
        GROUP BY TRIM(perfil)
      ) t
    ) AS perfis_json
  FROM agg
`;

// Query 2: cards A/B/C + metricas por entrada + alcance P1..P15 por entrada.
const SQL_FUNIL_AB = `
  WITH ${CORE_CTES},
  base_ab AS MATERIALIZED (
    SELECT * FROM sessoes_enriquecidas
    WHERE entrada_resolvida IN ('a', 'b', 'c')
  )
  SELECT
    entrada_resolvida AS entrada,
    COUNT(*) FILTER (WHERE visitou)::int AS visitas,
    COUNT(*) FILTER (WHERE entrou_quiz OR iniciou OR max_passo > 0 OR tem_lead)::int AS abriram,
    COUNT(*) FILTER (WHERE iniciou)::int AS iniciaram,
    COUNT(*) FILTER (WHERE max_passo >= 15)::int AS terminaram,
    COUNT(*) FILTER (WHERE tem_lead)::int AS converteram,
    ${P_ALCANCE_COLS}
  FROM base_ab
  GROUP BY entrada_resolvida
  ORDER BY entrada_resolvida
`;

function parsePerguntasAlcance(row) {
  const out = [];
  for (let n = 1; n <= 15; n++) {
    out.push({ pergunta: n, sessoes: row[`p${n}`] || 0 });
  }
  return out;
}

function parsePerguntasAb(rows) {
  const perguntas_ab = [];
  for (let n = 1; n <= 15; n++) perguntas_ab.push({ pergunta: n, a: 0, b: 0, c: 0 });
  for (const row of rows) {
    const k = row.entrada;
    if (k !== 'a' && k !== 'b' && k !== 'c') continue;
    for (let n = 1; n <= 15; n++) {
      perguntas_ab[n - 1][k] = row[`p${n}`] || 0;
    }
  }
  return perguntas_ab;
}

async function carregarFunilQuiz({ inicio, fim, entrada = null } = {}) {
  const paramsBase = [inicio, fim, entrada];

  const [filtrado, abRows] = await Promise.all([
    query(SQL_FUNIL_FILTRADO, paramsBase),
    query(SQL_FUNIL_AB, [inicio, fim]),
  ]);

  const r = filtrado.rows[0] || {};
  const abandono = Array.isArray(r.abandono_json) ? r.abandono_json : [];
  const perfis = Array.isArray(r.perfis_json) ? r.perfis_json : [];

  const ab_entradas = { a: 0, b: 0, c: 0 };
  const pct1 = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const zeroMet = () => ({
    abriram: 0, iniciaram: 0, terminaram: 0, converteram: 0,
    taxa_inicio: 0, taxa_termino: 0, taxa_conversao: 0,
  });
  const ab_metricas = { a: zeroMet(), b: zeroMet(), c: zeroMet() };

  for (const row of abRows.rows) {
    const k = row.entrada;
    if (k === 'a' || k === 'b' || k === 'c') {
      ab_entradas[k] = row.abriram || 0;
      ab_metricas[k] = {
        abriram: row.abriram || 0,
        iniciaram: row.iniciaram || 0,
        terminaram: row.terminaram || 0,
        converteram: row.converteram || 0,
        taxa_inicio: pct1(row.iniciaram, row.abriram),
        taxa_termino: pct1(row.terminaram, row.abriram),
        taxa_conversao: pct1(row.converteram, row.abriram),
      };
    }
  }

  const visitas_por_entrada = { a: 0, b: 0, c: 0 };
  for (const row of abRows.rows) {
    const k = row.entrada;
    if (k === 'a' || k === 'b' || k === 'c') {
      visitas_por_entrada[k] = row.visitas || 0;
    }
  }

  return {
    total_sessoes: r.abriram || 0,
    visitas_pagina: r.visitas_pagina || 0,
    visitas_por_entrada,
    totais: {
      visitas: r.abriram || 0,
      iniciaram: r.iniciaram || 0,
      resultados: r.terminaram_quiz || 0,
      compras: r.clicaram_comprar || 0,
    },
    chegaram_form: r.chegaram_form || 0,
    viraram_lead: r.viraram_lead || 0,
    perguntas_abandono: abandono,
    perguntas_alcance: parsePerguntasAlcance(r),
    abandono_formulario: r.abandono_formulario || 0,
    perfis,
    ab_entradas,
    perguntas_ab: parsePerguntasAb(abRows.rows),
    ab_metricas,
    diag: {
      com_lead: r.com_lead || 0,
      sem_lead: r.sem_lead || 0,
    },
  };
}

module.exports = { carregarFunilQuiz };
