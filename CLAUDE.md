# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deploy

This is a Google Apps Script project managed via `clasp`. Two independent GAS projects — push each separately.

```bash
# Push backend (Web App)
cd backend-cofre && clasp push --force

# Push frontend (container-bound to Google Sheets)
cd frontend-seller && clasp push --force
```

No build step, no test runner, no linter. Validate by pushing and running functions directly in the GAS Editor.

## Architecture: Two-Project SaaS (Thin Client / Fat Server)

### 1. Backend — `backend-cofre/`

Deployed as a GAS **Web App** (`ANYONE_ANONYMOUS`, `executeAs: USER_DEPLOYING`). Files:

- **`gateway.js`** — entry point. `doGet()` handles the OAuth callback (exchanges ML auth code server-side). `doPost()` routes actions:
  - `registerCsrfState` — stores UUID → spreadsheetId for CSRF validation
  - `fetchToken` — polling endpoint; returns temp token once OAuth completes
  - `getConfig` — returns `ML_CLIENT_ID` to frontend
  - `setMockEnv` — sandbox: writes `MOCK_<tier>` as access token with 24h TTL; no real ML token involved
  - _(no action field)_ — pricing engine: validates payload, builds `db`, runs `_validarContrato`, calls `construirBlocoVirtual` + `calcularPrecoMLB`/`calcularPrecoSHP`, returns DRE + NF-e staging data
  - `_validarContrato(anuncio, canal, db)` — 3-level cascading validator (announcement → TGFPRO → TGFKIT); accumulates **all** errors before returning, never stops at the first failure
  - `_registrarTenant` / `_atualizarRegimeTenant` — upserts tenant directory in central `CLIENTES` spreadsheet
  - `_explodirVuncom` — proportional cost split for NF-e per kit component

- **`core-pricing.js`** — pure pricing functions:
  - `construirBlocoVirtual(sku, qtd, tipoMargem, margem, canal, db)` — builds weighted fiscal "bloco" for simple products and kits
  - `calcularPrecoMLB(bloco, config, taxaCategoria, forcarFrete, alqDestino, fecopDestino)` — 8-tier × 29-bracket freight matrix loop
  - `calcularPrecoSHP(bloco, config, alqDestino, fecopDestino, taxaCampanha)` — Shopee tier solver (fixed-fee paradox, Março/2026 rules)

- **`auth.js`** — OAuth token management (no library):
  - `obterAccessTokenValido(spreadsheetId)` — reads/refreshes ML token from ScriptProperties
  - `buscarReputacaoMercadoLivre(accessToken)` — returns `{levelId, powerStatus}` from `/users/me`
  - `normalizarReputacao(levelId, powerStatus)` — maps to `'Verde'` / `'Amarela'` / `'Sem Reputação'`

### 2. Frontend — `frontend-seller/`

Container-bound script in Google Sheets. Files:

- **`ui-menu.js`** — `onOpen()` builds dynamic menu showing seller name + reputation (read from DocumentProperties). Menu items: connect/disconnect ML, recalculate MLB/SHP, fiscal config, about. Conditionally adds `🧪 Sandbox de Homologação` submenu only when `SpreadsheetApp.getActiveSpreadsheet().getId() === MASTER_SPREADSHEET_ID`; copies of the spreadsheet never see it.
- **`api-client.js`** — `_orquestrarMotor(canal)` reads sheets, POSTs payload to backend, writes DRE back to `TGFMLB`/`TGFSHP` and NF-e data to `TGFNFE_MLB`/`TGFNFE_SHP`. Also handles OAuth flow (Token Parking pattern). Contains sandbox helpers: `ativarSandboxLocal(tier, nomeVisual, emojiVisual)` + 8 `simular*()` wrappers (one per ML reputation level).
- **`config-fiscal.js`** — `salvarConfigFiscal` / `carregarConfigFiscal` persist fiscal config as a single JSON blob under key `CONFIG_FISCAL_360` in DocumentProperties.
- **`sidebar-fiscal.html`** — self-contained sidebar UI for fiscal configuration.

## OAuth Flow (Token Parking Pattern)

1. Frontend generates UUID, POSTs `registerCsrfState` to backend (stores `CSRF_{uuid}` → `spreadsheetId`)
2. Frontend opens ML auth URL with UUID as `state`, opens modal with polling JS
3. ML redirects to backend `doGet` → backend exchanges code → stores result in `TEMP_TOKEN_{ssId}`
4. Frontend polls `fetchToken` every 3s → on success, writes ML tokens + seller info to DocumentProperties

## Sandbox de Homologação

Allows testing the full MLB pricing flow against any reputation tier without a real ML account connected and without risk of token revocation.

**How it works:**
1. Frontend calls `setMockEnv` on the backend → backend writes `MOCK_<tier>` (e.g. `MOCK_Verde`) as `ML_ACCESS_TOKEN_<ssId>` with a 24h TTL in ScriptProperties
2. Frontend writes matching state to DocumentProperties (`seller_name`, `seller_reputation`) so the menu reflects the simulated account
3. On the next MLB calculation, `obterAccessTokenValido` returns the `MOCK_` string; the detector in `doPost` bypasses `buscarReputacaoMercadoLivre` and injects the tier directly into `db.config.reputacao`

**Feature flag — visibility trava:**
`MASTER_SPREADSHEET_ID` in `ui-menu.js` is the sole gate. The sandbox submenu only renders when the active spreadsheet ID matches this constant. Copies of the spreadsheet made after this feature was added have the code but a different ID, so the submenu never appears. Copies made before the feature was added don't have the code at all.

**Simulated tiers (8 options, covering all ML reputation levels):**

| Function | `tier` injected | Display label |
|---|---|---|
| `simularLiderGold()` | `'Verde'` | `🏆 Líder Gold` |
| `simularLiderPlatinum()` | `'Verde'` | `💎 Líder Platinum` |
| `simularVerde()` | `'Verde'` | `🟢 Verde` |
| `simularVerdeClaro()` | `'Verde'` | `🟢 Verde Claro` |
| `simularAmarela()` | `'Amarela'` | `🟡 Amarela` |
| `simularLaranja()` | `'Sem Reputação'` | `🟠 Laranja` |
| `simularVermelha()` | `'Sem Reputação'` | `🔴 Vermelha` |
| `simularCinza()` | `'Verde'` | `⚪ Cinza` |

**Key invariant:** `MOCK_` tokens are never refreshed by `obterAccessTokenValido` — they pass through the `agora < expiresAt - 300` check (24h TTL) and have no `refresh_token` path. To exit sandbox mode, connect a real ML account via `solicitarVinculoML`.

## Reputation Mapping (Two-Layer Design)

Seller reputation flows through two independent layers that must never be conflated.

### Display layer — `doGet` in `gateway.js`

Reads `power_seller_status` **and** `level_id` from `/users/me` at OAuth time. `power_seller_status` is evaluated first — a Líder Gold also has `5_green`, but should be identified by title, not color.

| `power_seller_status` | `level_id` | Label stored in DocumentProperties |
|---|---|---|
| `'gold'` | — | `🏆 Líder Gold` |
| `'platinum'` | — | `💎 Líder Platinum` |
| (outro truthy) | — | `🏆 MercadoLíder` ← fallback para tiers futuros |
| null | `'5_green'` | `🟢 Verde` |
| null | `'4_light_green'` | `🟢 Verde Claro` |
| null | `'3_yellow'` | `🟡 Amarela` |
| null | `'2_orange'` | `🟠 Laranja` |
| null | `'1_red'` | `🔴 Vermelha` |
| null | null | `⚪ Cinza` |

Label flows: `TEMP_TOKEN_` → `tentarCapturarToken` → `DocumentProperties.seller_reputation` → menu `ui-menu.js`. Nunca chega ao motor de preço.

### Pricing layer — `normalizarReputacao` in `auth.js`

Chamada a cada cálculo MLB (API call ao vivo). Retorna um dos três tiers de desconto de frete. As strings de exibição acima nunca entram aqui.

| Condição | Retorno | Desconto de frete |
|---|---|---|
| `powerStatus` truthy, `5_green`, `4_light_green`, ou `null` | `'Verde'` | 30% sub-R$79 / 50% acima |
| `3_yellow` | `'Amarela'` | 20% sub-R$79 / 40% acima |
| `2_orange`, `1_red` | `'Sem Reputação'` | 0% — frete cheio |

`4_light_green` e `null` (seller novo) são agrupados no tier Verde por política de fretes do ML.

## Core Pricing Formula

```
preço = (custo + frete_líquido) / divisor
divisor = 1 − (comissão + margem + ICMS_caixa + DIFAL + federais_ajustados + IPI_efetiva)
IPI_efetiva = alq / (1 + alq)                        // "por fora" → "por dentro"
base_PIS_COFINS = receita − IPI − ICMS_destaque − DIFAL  // Tese do Século
```

## Spreadsheet Data Model

| Aba | Canal | Função |
|-----|-------|--------|
| `TGFPRO` | — | Catálogo master: SKU, tipoProduto, origem, custo, peso, dimensões, margens, IPI, regime ICMS, redução BC |
| `TGFKIT` | — | Composição de kits: SKU_KIT → componentes com qtd e margens individuais (margemKitML col D, margemKitSHP col E) |
| `TGFMLB` | MLB | Anúncios: ID, SKU, QTD, TipoMargem, MargemCustom, TaxaCategoria, AlqDestino, FecopDestino, ForcarFrete → recebe DRE (13 colunas) |
| `TGFSHP` | SHP | Anúncios: ID, SKU, QTD, TipoMargem, MargemCustom, AlqDestino, FecopDestino, FlagCampanha → recebe DRE (13 colunas) |
| `TGFNFE_MLB` | MLB | Staging NF-e: explosão de kits com vUnCom, vProd, vIPI, vFrete por componente (8 colunas) |
| `TGFNFE_SHP` | SHP | Idem para Shopee |
| `TGFICMS` | — | Alíquotas ICMS e FECOP por UF |

## Margin Tactics (`tipoMargem`)

| Valor | Fonte | Comportamento |
|-------|-------|---------------|
| `"Do anúncio"` | Col E da TGFMLB/TGFSHP | Valor único propagado a todos os componentes do kit |
| `"Do kit"` | Cols D/E da TGFKIT por componente | Margem individual por componente (apenas para kits) |
| `"Do produto"` | Cols L/M do **kit** na TGFPRO | Valor único do kit propagado a todos os componentes |

`"Do kit"` em produto Simples é bloqueado pelo validador. `margemML`/`margemSHP` vazias (≠ zero explícito) falham `isPerc()` e são rejeitadas pelo validador.

## Key Conventions

- **Filenames**: kebab-case. **Functions**: camelCase.
- **No `onEdit` handlers** — never reintroduce reactive sheet logic.
- **DocumentProperties** for all session/config state (ML tokens + fiscal config). Never UserProperties — causa instabilidade em contas multi-perfil.
- Fiscal config stored as single JSON blob under key `CONFIG_FISCAL_360` (namespaced to avoid collision with OAuth keys).
- `margemML` / `margemSHP` carregados sem `|| 0` — preservar `NaN` para células vazias; o validador distingue vazio (erro) de zero explícito (aviso de margem 0% no feedback).
- Campos booleanos `FRETE_RAPIDO_SUB_79` (col I TGFMLB) e `CAMPANHA_SHOPEE` (col H TGFSHP) sem coerção — o raw string é passado ao validador; apenas `"SIM"` / `"NÃO"` são aceitos. Célula vazia gera erro.
- Regime ICMS saída: valores válidos são `"Débito"`, `"Isento"`, `"Estorno"` (nunca `"ST"`).
- Origem ICMS: inteiro `0–8`; célula vazia falha `isOrigemValida()` explicitamente.
- Kit pricing: ponderação fiscal por `valorAlvoAbsoluto` (custo + lucro alvo por componente), não por quantidade.
- `ML_ACCESS_TOKEN_<ssId>` prefixado com `MOCK_` sinaliza modo sandbox — nunca tratar como token real nem tentar refresh. O sufixo após `MOCK_` é o tier de reputação a injetar.
- `MASTER_SPREADSHEET_ID` em `ui-menu.js` — atualizar esta constante se a planilha MASTER for recriada.
