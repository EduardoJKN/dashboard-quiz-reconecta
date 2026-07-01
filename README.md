# Reconecta Dashboard (serviço paralelo)

Dashboard de analytics do funil de quiz da Reconecta. **É um serviço separado do funil** — sobe sozinho no Render, em paralelo, sem tocar no projeto do funil. A "ligação" entre os dois é feita pelo time (ver abaixo).

## O que ele mostra
- **Desenho do funil**: abriu → começou → formulário → lead → diagnóstico → clicou comprar → PDF → **pagou (Pix / cartão)**.
- **Funil por pergunta (P1 → P15)**: em qual pergunta o quiz mais perde gente.
- **Pagamento (Guru)**: pagos no Pix, pagos no cartão, total pago, **reembolsos**, **taxa de reembolso**, faturamento e ticket médio.
- **Conversão**, **distribuição por perfil** e **onde as pessoas pararam**.

## Como roda
```
npm install
npm start          # http://localhost:3000/dashboard?token=reconecta
```
Sem variáveis de ambiente, o token padrão é `reconecta`.

## Endpoints
| Método | Rota | Pra quê |
|---|---|---|
| POST | `/api/track` | Recebe os eventos do funil (`{ tipo, sessao, dados }`) |
| POST | `/api/webhook/pagamento` | Recebe os pagamentos do checkout Guru |
| GET | `/dashboard?token=XXX` | O painel |
| GET | `/api/stats?token=XXX` | O JSON das métricas |
| GET | `/api/health` | Health check do Render |

## Variáveis de ambiente (Render)
- `DASHBOARD_TOKEN` — senha pra abrir o dashboard.
- `GURU_WEBHOOK_TOKEN` — (opcional) segredo pra validar o webhook do Guru (`?token=...`).
- `CORS_ORIGIN` — (opcional) trava o CORS na origem do funil (ex.: `https://seu-funil.com`). Default: `*`.

## A LIGAÇÃO (o que o time faz depois)
Este serviço nasce **zerado**. Pra encher de dados:

**1) Funil → manda os eventos pra cá**
No funil, hoje o `track()` (em `public/quiz.js`) posta pra `/api/track` do **próprio** funil. Basta apontar pra este serviço:
```js
// public/quiz.js do FUNIL
fetch('https://SEU-DASHBOARD.onrender.com/api/track', { ... })
```
(pode-se mandar pros dois: o funil continua registrando local e também manda pra cá.)

**2) Guru → manda os pagamentos pra cá**
No painel do Guru, cadastrar o webhook apontando pra:
```
https://SEU-DASHBOARD.onrender.com/api/webhook/pagamento
```
(se usar `GURU_WEBHOOK_TOKEN`, incluir `?token=SEGREDO` na URL). O serviço entende os status do Guru (approved/paid → pago, refunded/chargeback → reembolso) e os métodos (pix, credit_card → cartão, billet → boleto).

**Correlação por sessão (opcional):** pra casar o pagamento com a jornada da pessoa no funil, o time repassa o `sessao` do funil como parâmetro/custom field no checkout; o webhook lê `sessao` / `session` do corpo.

## Deploy no Render (paralelo)
1. Suba este repositório no GitHub (separado do funil).
2. No Render: **New → Blueprint** (usa o `render.yaml`) ou **New → Web Service** apontando pra este repo (Node, build `npm install`, start `node server.js`).
3. Definir `DASHBOARD_TOKEN` (e, se quiser, `GURU_WEBHOOK_TOKEN` / `CORS_ORIGIN`).

> Obs: no plano Free do Render o disco é efêmero — os eventos zeram a cada redeploy/hibernação. Pra histórico permanente de faturamento/reembolso, plugar um Postgres depois.
