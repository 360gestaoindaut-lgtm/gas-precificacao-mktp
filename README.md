# Motor de Precificação Dinâmica — 360 Gestão Ind & Aut

Motor de precificação top-down para Mercado Livre e Shopee, construído sobre Google Apps Script. Resolve a complexidade tributária brasileira (ICMS, DIFAL, FECOP, IPI, Tese do Século) cruzada com as matrizes de frete dos marketplaces, para operações de autopeças e kits compostos.

## O Problema Resolvido

Modelos tradicionais de precificação (mark-up, "por dentro") falham porque não modelam simultaneamente:

- A variação de frete por peso × faixa de preço × reputação da conta (8 tiers × 29 brackets no ML)
- A diferença entre ICMS destaque (nota fiscal) e ICMS caixa (fluxo real), especialmente em regimes de Estorno
- A exclusão do ICMS da base do PIS/COFINS (Tese do Século, Tema 69 STF)
- A conversão de IPI "por fora" para "por dentro" para integração correta com XML NF-e
- A ponderação fiscal de kits compostos por componentes de origens tributárias distintas

Este motor inverte a lógica: recebe a **margem-alvo** e encontra algebricamente o menor preço de venda que a garante.

## Arquitetura

Dois projetos GAS independentes em padrão SaaS (Thin Client / Fat Server):

```
gas-precificacao-mktp/
├── backend-cofre/          # Web App GAS — motor de cálculo + API OAuth
│   ├── gateway.js          # doGet (OAuth callback) + doPost (roteador de ações)
│   ├── core-pricing.js     # construirBlocoVirtual, calcularPrecoMLB, calcularPrecoSHP
│   └── auth.js             # Gestão de tokens ML (refresh, reputação, normalização)
└── frontend-seller/        # Script container-bound no Google Sheets do seller
    ├── ui-menu.js          # Menu dinâmico (nome + reputação do seller)
    ├── api-client.js       # Orquestrador: lê abas, POST para backend, grava DRE
    ├── config-fiscal.js    # Sidebar backend: salvar/carregar configuração fiscal
    └── sidebar-fiscal.html # UI da sidebar de configuração
```

### Fórmula Central

```
preço = (custo + frete_líquido) / divisor

divisor = 1 − (comissão + margem + ICMS_caixa + DIFAL + federais_ajustados + IPI_efetiva)

IPI_efetiva     = alq_IPI / (1 + alq_IPI)
base_PIS/COFINS = receita − IPI − ICMS_destaque − DIFAL   ← Tese do Século
```

### Modelo de Dados (Abas da Planilha)

| Aba | Função |
|-----|--------|
| `TGFPRO` | Catálogo master: SKU, tipo, origem fiscal, custo, dimensões, IPI, margens, regime ICMS |
| `TGFKIT` | Composição de kits com margens individuais por componente |
| `TGFMLB` | Painel de anúncios MLB → recebe DRE calculada (13 colunas) |
| `TGFSHP` | Painel de anúncios Shopee → recebe DRE calculada (13 colunas) |
| `TGFNFE_MLB` | Staging NF-e MLB: explosão de kits com vUnCom, vProd, vIPI, vFrete |
| `TGFNFE_SHP` | Staging NF-e Shopee |
| `TGFICMS` | Alíquotas ICMS e FECOP por UF |

## Funcionalidades

- **Motor MLB** — 8 faixas de preço × 29 faixas de peso; descontos de frete por reputação (Verde/Amarela/Vermelha); suporte a Frete Rápido forçado abaixo de R$ 79
- **Motor Shopee** — solver de tiers com taxa fixa escalonável (regras Março/2026); suporte a campanhas (+2,5% de comissão)
- **Kits compostos** — ponderação fiscal por custo + lucro-alvo por componente; três táticas de margem (`Do anúncio` / `Do kit` / `Do produto`)
- **Regimes tributários** — Simples Nacional (com imunidade de DIFAL e segregação CSOSN), Lucro Presumido, Lucro Real (com crédito de PIS/COFINS sobre frete e comissões)
- **Validador em cascata** — 3 níveis (anúncio → TGFPRO → TGFKIT); acumula todos os erros antes de retornar; bloqueia combinações inválidas
- **OAuth 2.0 multi-tenant** — padrão Token Parking (sem biblioteca OAuth2, sem iframe); menu dinâmico com nome e reputação do seller
- **Diretório central de tenants** — upsert automático na planilha `CLIENTES` a cada novo vínculo OAuth; sincronização passiva do regime tributário
- **Staging NF-e** — rateio proporcional de preço e frete entre componentes de kits para geração de XML

## Deploy

Pré-requisito: [`clasp`](https://github.com/google/clasp) instalado e autenticado.

```bash
# Autenticar uma vez por máquina
clasp login

# Backend (Web App)
cd backend-cofre
clasp push --force

# Frontend (container-bound no Sheets do seller)
cd frontend-seller
clasp push --force
```

Após qualquer mudança no `appsscript.json` do backend (escopos OAuth), é necessário criar uma nova versão do Web App no editor GAS e re-autorizar executando uma função qualquer pelo editor.

---

Desenvolvido pela **360 Gestão Ind & Aut**.
