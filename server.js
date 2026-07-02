// ============================================================================
// server.js — Reconecta Dashboard (servico PARALELO, separado do funil).
//
// Este servico NAO faz parte do funil. Ele so:
//   1) recebe eventos do funil            -> POST /api/track
//   2) recebe pagamentos do checkout Guru -> POST /api/webhook/pagamento
//   3) mostra o dashboard                 -> GET  /dashboard?token=XXX
//
// O time faz a "ligacao" depois (ver README.md):
//   - aponta o track() do funil pra <dominio>/api/track
//   - aponta o webhook do Guru pra <dominio>/api/webhook/pagamento
// Enquanto ninguem conecta, o dashboard aparece zerado (sem risco pro funil).
// ============================================================================
require('dotenv').config();
const express = require('express');
const path = require('path');
const { registrar, metricas } = require('./src/analytics');
const { pool } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;
const DASHBOARD_TOKEN = process.env.DASHBOARD_TOKEN || 'reconecta';

app.use(express.json());

// CORS: o funil roda em outra origem e vai POSTar eventos pra ca. Libera POST
// cross-origin. Em producao, da pra travar em CORS_ORIGIN=https://dominio-do-funil.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

// Health check (Render usa pra saber se subiu)
app.get('/api/health', (req, res) => res.json({ ok: true, servico: 'reconecta-dashboard' }));

// Health check do Postgres (SELECT NOW()). Devolve { ok, now } ou { ok:false, erro }.
app.get('/api/health/db', async (req, res) => {
  if (!pool) return res.status(503).json({ ok: false, erro: 'DATABASE_URL nao configurada' });
  try {
    const { rows } = await pool.query('SELECT NOW() AS now');
    res.json({ ok: true, now: rows[0].now });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// --- 1) Ingestao de eventos do funil ----------------------------------------
// O funil manda: { tipo, sessao, dados }. tipo = visita | iniciou | passo |
// captura | lead | resultado | compra | pdf.
app.post('/api/track', (req, res) => {
  const { tipo, sessao, dados } = req.body || {};
  if (tipo) registrar(tipo, sessao, dados || {});
  res.json({ ok: true });
});

// --- 2) Webhook do checkout GURU --------------------------------------------
// O time aponta o webhook do Guru pra: POST <dominio>/api/webhook/pagamento
// (opcional: ?token=SEGREDO, casando com GURU_WEBHOOK_TOKEN no .env).
// Normaliza status + metodo + valor e registra 'pago'/'reembolso'.
app.post('/api/webhook/pagamento', (req, res) => {
  try {
    const segredo = process.env.GURU_WEBHOOK_TOKEN;
    const b = req.body || {};
    if (segredo) {
      const tok = req.query.token || b.token || b.api_token;
      if (tok !== segredo) return res.status(401).json({ ok: false, erro: 'token' });
    }
    const pick = (...vs) => vs.find((v) => v != null && v !== '');
    const status = String(
      pick(b.status, b.last_status, b.transaction && b.transaction.status, b.sale && b.sale.status, b.data && b.data.status, '')
    ).toLowerCase();
    const rawMetodo = String(
      pick(b.payment_method, b.payment && b.payment.method, b.transaction && b.transaction.payment && b.transaction.payment.method, b.method, '')
    ).toLowerCase();
    const valor = Number(
      pick(b.value, b.total, b.payment && b.payment.total, b.transaction && b.transaction.amount, b.sale && b.sale.total, 0)
    ) || 0;
    const id = pick(b.id, b.transaction_id, b.transaction && b.transaction.id, b.order && b.order.id, b.code) || null;
    const sessao = pick(b.sessao, b.session, b.utm && b.utm.sessao);

    let metodo = 'outro';
    if (/pix/.test(rawMetodo)) metodo = 'pix';
    else if (/card|cart|credit/.test(rawMetodo)) metodo = 'cartao';
    else if (/bole|billet|slip|bank/.test(rawMetodo)) metodo = 'boleto';

    const pago = /approv|paid|complet|aprov|pago/.test(status);
    const reembolso = /refund|reembol|charge|estorn|devolv/.test(status);

    if (reembolso) registrar('reembolso', sessao, { valor, metodo, status, id, provedor: 'guru' });
    else if (pago) registrar('pago', sessao, { valor, metodo, status, id, provedor: 'guru' });
    else registrar('checkout_evento', sessao, { status, metodo, id, provedor: 'guru' });

    res.json({ ok: true, classificado: reembolso ? 'reembolso' : pago ? 'pago' : 'outro_status', metodo });
  } catch (e) {
    console.error('[webhook pagamento] erro:', e.message);
    res.status(200).json({ ok: false }); // 200 pro Guru nao ficar reenviando
  }
});

// --- 3) Dashboard ------------------------------------------------------------
app.get('/', (req, res) => res.redirect('/dashboard'));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/api/stats', async (req, res) => {
  if ((req.query.token || '') !== DASHBOARD_TOKEN) {
    return res.status(401).json({ erro: 'token invalido' });
  }
  try {
    const dados = await metricas();
    res.json(dados);
  } catch (e) {
    console.error('[api/stats] erro:', e.message);
    res.status(500).json({ erro: 'falha ao gerar metricas' });
  }
});

// --- Investimento em anúncios: puxa o gasto do Meta Ads (se configurado) -----
// O time configura no Render: META_ACCESS_TOKEN e META_AD_ACCOUNT_ID (só os
// números, com ou sem 'act_'). Opcional: META_DATE_PRESET (default 'this_month').
// Sem essas variáveis, devolve 'nao_configurado' e o dashboard cai no campo manual.
app.get('/api/investimento', async (req, res) => {
  if ((req.query.token || '') !== DASHBOARD_TOKEN) {
    return res.status(401).json({ erro: 'token invalido' });
  }
  const tokenMeta = process.env.META_ACCESS_TOKEN;
  const conta = process.env.META_AD_ACCOUNT_ID;
  if (!tokenMeta || !conta) return res.json({ investimento: null, fonte: 'nao_configurado' });

  const preset = req.query.preset || process.env.META_DATE_PRESET || 'this_month';
  const contaId = String(conta).startsWith('act_') ? conta : 'act_' + conta;
  const url = `https://graph.facebook.com/v20.0/${contaId}/insights?fields=spend&date_preset=${encodeURIComponent(preset)}&access_token=${encodeURIComponent(tokenMeta)}`;
  try {
    const r = await fetch(url);
    const j = await r.json();
    if (j.error) return res.json({ investimento: null, fonte: 'erro', erro: j.error.message });
    const spend = j.data && j.data[0] ? Number(j.data[0].spend) : 0;
    return res.json({
      investimento: isNaN(spend) ? 0 : Math.round(spend * 100) / 100,
      fonte: 'meta',
      periodo: preset,
    });
  } catch (e) {
    return res.json({ investimento: null, fonte: 'erro', erro: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n  Reconecta Dashboard (paralelo) rodando em  http://localhost:${PORT}\n`);
});
