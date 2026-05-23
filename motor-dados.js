/**
 * MÓDULO 1: CAMADA DE DADOS E ESTRUTURAÇÃO DO BLOCO VIRTUAL
 * Responsabilidade: Ler o Google Sheets de forma otimizada (In-Memory)
 * e preparar a estrutura de dados (O Bloco Virtual) para o motor matemático.
 */

// 1. CARREGAMENTO DO BANCO DE DADOS PARA A MEMÓRIA
function carregarBancoDeDados() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1.1. Lendo as Configurações Globais (Aba 0)
  var abaConfig = ss.getSheetByName("CONFIG_SELLER");
  var dadosConfig = abaConfig.getDataRange().getValues();
  // Linha 0 é o cabeçalho, Linha 1 são os dados.
  var config = {
    reputacao: dadosConfig[1][0],
    pisCofins: dadosConfig[1][1] || 0,
    irpj: dadosConfig[1][2] || 0,
    csll: dadosConfig[1][3] || 0,
    regimeTributario: dadosConfig[1][4],
    tomarCredito: (String(dadosConfig[1][5]).trim().toUpperCase() === "SIM"),
    baseCredito: dadosConfig[1][6],
    cargaSnNormal: parseFloat(dadosConfig[1][7]) || 0,
    cargaSnSt: parseFloat(dadosConfig[1][8]) || 0
  };

  // 1.2. Mapeando a TGFPRO (Catálogo e Logística Master)
  var abaPro = ss.getSheetByName("TGFPRO");
  var dadosPro = abaPro.getDataRange().getValues();
  var mapPro = {}; // Usaremos um objeto para busca em O(1) pelo SKU

  for (var i = 1; i < dadosPro.length; i++) {
    var sku = dadosPro[i][0];
    if (!sku) continue; // Pula linhas vazias

    mapPro[sku] = {
      tipoProduto: dadosPro[i][1], // Simples ou Kit
      origemProduto: dadosPro[i][5],
      custoAquisicao: parseFloat(dadosPro[i][6]) || 0,
      pesoKg: parseFloat(dadosPro[i][7]) || 0,
      comprimento: parseFloat(dadosPro[i][8]) || 0,
      largura: parseFloat(dadosPro[i][9]) || 0,
      altura: parseFloat(dadosPro[i][10]) || 0,

      margemML: parseFloat(dadosPro[i][11]) || 0,
      margemSHP: parseFloat(dadosPro[i][12]) || 0,
      ipi: parseFloat(dadosPro[i][13]) || 0,
      regimeIcmsSaida: dadosPro[i][14] || "Débito",
      redBcIcms: parseFloat(dadosPro[i][15]) || 0
    };
  }

  // 1.3. Mapeando a TGFKIT (A Receita de Bolo)
  var abaKit = ss.getSheetByName("TGFKIT");
  var dadosKit = abaKit.getDataRange().getValues();
  var mapKit = {}; // Chave será o SKU_KIT, o valor será um Array de Componentes

  for (var j = 1; j < dadosKit.length; j++) {
    var skuKit = dadosKit[j][0];
    if (!skuKit) continue;

    // Se o kit ainda não existe no mapa, cria um array vazio para ele
    if (!mapKit[skuKit]) {
      mapKit[skuKit] = [];
    }

    mapKit[skuKit].push({
      skuComponente: dadosKit[j][1],
      qtdComponente: parseFloat(dadosKit[j][2]) || 1,
      margemKitML: dadosKit[j][3] !== "" ? parseFloat(dadosKit[j][3]) : null,
      margemKitSHP: dadosKit[j][4] !== "" ? parseFloat(dadosKit[j][4]) : null
    });
  }

  return { config: config, produtos: mapPro, kits: mapKit };
}



// 2. O ENGENHEIRO DO BLOCO VIRTUAL (Aglutinador Top-Down)
function construirBlocoVirtual(skuAnunciado, qtdNoAnuncio, tipoMargem, margemCustomizada, canalRequisitado, db) {
  var prodMaster = db.produtos[skuAnunciado];
  if (!prodMaster) return null; // Trava de segurança: SKU não existe na TGFPRO

  var bloco = {
    custoTotal: 0,
    margemPonderada: 0,
    pesoFisicoMaster: prodMaster.pesoKg * qtdNoAnuncio,
    cubagemMaster: ((prodMaster.comprimento * prodMaster.largura * prodMaster.altura) / 6000) * qtdNoAnuncio,
    origemICMSArray: [], // Guardará {valorAlvoAbsoluto, destaque, caixa}
    icmsDestaquePonderado: 0,
    icmsCaixaPonderado: 0,
    ipiPonderado: 0,
    simplesNacionalPonderado: 0
  };

  // 1. Função auxiliar de ICMS (Agora avalia o regime específico da peça)
  var definirImpostos = function(origem, regimeProduto, percReducaoBC) {
    var origemNum = Number(origem);
    var alqOrigemNominal = (origemNum === 1 || origemNum === 2 || origemNum === 3 || origemNum === 8) ? 0.04 : 0.12;

    // A MATEMÁTICA DA CARGA EFETIVA
    var alqEfetiva = alqOrigemNominal * (1 - percReducaoBC);

    var res = { destaque: 0, caixa: 0 };
    var regimeFormatado = String(regimeProduto).trim();

    if (regimeFormatado === "Débito") {
      res.destaque = alqEfetiva; res.caixa = alqEfetiva;
    } else if (regimeFormatado === "Estorno") {
      res.destaque = alqEfetiva; res.caixa = 0; 
    }
    return res;
  };

  // 2. Função auxiliar do Simples Nacional (Segregação de Receita por peça)
  var definirSimples = function(regimeProduto) {
    var regimeFormatado = String(regimeProduto).trim();
    if (regimeFormatado === "Débito") return db.config.cargaSnNormal;
    return db.config.cargaSnSt; // "Estorno" ou "Isento" tem dedução
  };

  // 2.1. CÁLCULO SE FOR PRODUTO SIMPLES
  if (prodMaster.tipoProduto === "Simples") {
    bloco.custoTotal = prodMaster.custoAquisicao * qtdNoAnuncio;

    if (tipoMargem === "Do anúncio") {
      bloco.margemPonderada = margemCustomizada;
    } else {
      // Se não for do anúncio, puxa a padrão atrelada ao canal
      bloco.margemPonderada = (canalRequisitado === "Shopee") ? prodMaster.margemSHP : prodMaster.margemML;
    }

    var impostos = definirImpostos(prodMaster.origemProduto, prodMaster.regimeIcmsSaida, prodMaster.redBcIcms);
    bloco.icmsDestaquePonderado = impostos.destaque;
    bloco.icmsCaixaPonderado = impostos.caixa;
    bloco.ipiPonderado = prodMaster.ipi;
    bloco.simplesNacionalPonderado = definirSimples(prodMaster.regimeIcmsSaida);

    // Guarda a identidade da peça para a TGF_VUNCOM
    bloco.origemICMSArray.push({
      skuComponente: skuAnunciado,
      qtdComponente: qtdNoAnuncio,
      valorAlvoAbsoluto: 1, // Colocamos o valor alvo como 1, pois ele representa 100% da própria nota
      destaque: impostos.destaque,
      caixa: impostos.caixa,
      ipi: prodMaster.ipi
    });
  }

  // 2.2. CÁLCULO SE FOR UM KIT (O liquidificador algébrico)
  else if (prodMaster.tipoProduto === "Kit") {
    var componentes = db.kits[skuAnunciado];
    if (!componentes) return null;

    var lucroAbsolutoTotal = 0;

    for (var k = 0; k < componentes.length; k++) {
      var comp = componentes[k];
      var dadosComp = db.produtos[comp.skuComponente];

      var custoParte = (dadosComp.custoAquisicao * comp.qtdComponente) * qtdNoAnuncio;
      bloco.custoTotal += custoParte;

      var margemDestaParte = 0;

      if (tipoMargem === "Do anúncio") {
        margemDestaParte = margemCustomizada;
      }
      else if (tipoMargem === "Do kit") {
        if (canalRequisitado === "Shopee" && comp.margemKitSHP !== null) {
          margemDestaParte = comp.margemKitSHP;
        } else if (canalRequisitado !== "Shopee" && comp.margemKitML !== null) {
          margemDestaParte = comp.margemKitML;
        } else {
          // Fallback de segurança: Se pediu do kit, mas a célula está vazia, puxa da TGFPRO
          margemDestaParte = (canalRequisitado === "Shopee") ? dadosComp.margemSHP : dadosComp.margemML;
        }
      }
      else {
        // Tática "Do produto": puxa direto da TGFPRO respeitando o canal
        margemDestaParte = (canalRequisitado === "Shopee") ? dadosComp.margemSHP : dadosComp.margemML;
      }

      var lucroParte = custoParte * margemDestaParte;
      lucroAbsolutoTotal += lucroParte;

      // Chama a função passando a origem e o regime DAQUELA PEÇA ESPECÍFICA
      var impostosParte = definirImpostos(dadosComp.origemProduto, dadosComp.regimeIcmsSaida, dadosComp.redBcIcms);
      var simplesParte = definirSimples(dadosComp.regimeIcmsSaida);

      // NOVO: Guarda a identidade e a quantidade multiplicada para a TGF_VUNCOM
      bloco.origemICMSArray.push({
        skuComponente: comp.skuComponente,
        qtdComponente: comp.qtdComponente * qtdNoAnuncio, // Qtd na receita * Qtd do anúncio
        valorAlvoAbsoluto: custoParte + lucroParte,
        destaque: impostosParte.destaque,
        caixa: impostosParte.caixa,
        ipi: dadosComp.ipi,
        simplesNacional: simplesParte
      });
    }

    bloco.margemPonderada = lucroAbsolutoTotal / bloco.custoTotal;
    var valorAlvoTotalDoBloco = bloco.custoTotal + lucroAbsolutoTotal;

    var destaqueSinteticoAcumulado = 0;
    var caixaSinteticoAcumulado = 0;
    var ipiSinteticoAcumulado = 0;
    var simplesSinteticoAcumulado = 0;

    for (var m = 0; m < bloco.origemICMSArray.length; m++) {
      var itemICMS = bloco.origemICMSArray[m];
      var pesoProporcional = itemICMS.valorAlvoAbsoluto / valorAlvoTotalDoBloco;

      destaqueSinteticoAcumulado += (itemICMS.destaque * pesoProporcional);
      caixaSinteticoAcumulado += (itemICMS.caixa * pesoProporcional);
      ipiSinteticoAcumulado += (itemICMS.ipi * pesoProporcional);
      simplesSinteticoAcumulado += (itemICMS.simplesNacional * pesoProporcional); // O DAS Ponderado!
    }

    bloco.icmsDestaquePonderado = destaqueSinteticoAcumulado;
    bloco.icmsCaixaPonderado = caixaSinteticoAcumulado;
    bloco.ipiPonderado = ipiSinteticoAcumulado;
    bloco.simplesNacionalPonderado = simplesSinteticoAcumulado; // Guarda o DAS final do Kit
  }

  return bloco;
}



/**
 * MÓDULO 2 (V2.0): O MOTOR FINANCEIRO (CORE PRICING - FRETE PADRÃO ML)
 * Responsabilidade: Aplicar a carga tributária, varrer as matrizes tridimensionais
 * de envio do ML (Peso x Preço x Reputação) e encontrar o Preço de Venda Final.
 */

function calcularPrecoMLB(blocoVirtual, config, taxaCategoriaML, forcarFreteRapidoSub79, alqDestino, fecopDestino) {
  if (!blocoVirtual) return "ERRO: Bloco Vazio";

  // --- 1. CARGA TRIBUTÁRIA E DIVISOR (Tese do Século, DIFAL e Lucro Real) ---
  var cargaIcmsDestaque = blocoVirtual.icmsDestaquePonderado;
  var cargaIcmsCaixa = blocoVirtual.icmsCaixaPonderado;
  var cargaIpiNominal = blocoVirtual.ipiPonderado;

  // CONVERSÃO DO IPI (Por Fora -> Por Dentro)
  var cargaIpiEfetiva = cargaIpiNominal / (1 + cargaIpiNominal);

  // Cálculo do DIFAL: Diferença positiva entre a Carga de Destino e o Destaque da Operação Própria
  var difal = 0;
  var fatorFederaisAjustado = 0;

  if (config.regimeTributario === "Simples Nacional") {
    // LÓGICA EXCLUSIVA: SIMPLES NACIONAL
    // 1. Imunidade de DIFAL (Tema 517 STF)
    difal = 0;

    // 2. O ICMS próprio já está embutido no DAS, então zeramos o caixa para evitar bitributação
    cargaIcmsCaixa = 0;

    // 3. Segregação de Receitas (CSOSN)
    var regimeFormatado = String(regimeIcmsSaida).trim();
    if (regimeFormatado === "Débito") {
      fatorFederaisAjustado = config.cargaSnNormal;
    } else { // "Estorno" ou "Isento"
      fatorFederaisAjustado = config.cargaSnSt;
    }

  } else {
    // LÓGICA DO REGIME NORMAL (Presumido ou Real)
    var cargaDestinoTotal = alqDestino + fecopDestino;
    if (cargaDestinoTotal > 0) {
      difal = Math.max(0, cargaDestinoTotal - cargaIcmsDestaque);
    }

    // A Receita Bruta tributável exclui o valor do IPI destacado na nota
    var baseReceitaBruta = 1 - cargaIpiEfetiva;

    // A Tese do Século (Base do PIS/COFINS excluindo o ICMS Destaque)
    // Nota: Se for Lucro Real, a Macro da planilha já zerou o config.irpj e config.csll
    // O PIS/COFINS incide sobre (Preço - IPI - ICMS Destaque - DIFAL)
    // O IRPJ/CSLL incide sobre (Preço - IPI)
    fatorFederaisAjustado = (config.pisCofins * (baseReceitaBruta - cargaIcmsDestaque - difal)) + ((config.irpj + config.csll) * baseReceitaBruta);
  }

  // LÓGICA DO CRÉDITO SOBRE A COMISSÃO (Lucro Real)
  var taxaEfetivaML = taxaCategoriaML;
  if (config.regimeTributario === "Lucro Real" && config.tomarCredito && config.baseCredito === "Frete + Comissões") {
    taxaEfetivaML = taxaCategoriaML * (1 - config.pisCofins);
  }

  var divisor = 1 - (taxaEfetivaML + blocoVirtual.margemPonderada + cargaIcmsCaixa + difal + fatorFederaisAjustado + cargaIpiEfetiva);

  // --- 1. CARGA TRIBUTÁRIA E DIVISOR ---
  // ... [cálculos de impostos, difal e Tese do Século] ...

  var somaCustosVariaveis = taxaEfetivaML + cargaIcmsCaixa + difal + fatorFederaisAjustado + cargaIpiEfetiva;
  var divisor = 1 - (somaCustosVariaveis + blocoVirtual.margemPonderada);

  // A NOVA TRAVA DE API (HTTP 400 - Bad Request)
  if (divisor <= 0) {
    var margemMaxTeorica = 1 - somaCustosVariaveis; // O limite da física tributária

    // Formatação para exibição amigável
    var maxStr = (margemMaxTeorica * 100).toFixed(2) + "%";
    var divStr = (divisor * 100).toFixed(2) + "%";

    return {
      sucesso: false,
      feedback: "400: Margem inviável. A soma de impostos e taxas já consome " + (somaCustosVariaveis * 100).toFixed(2) + "% do preço. Margem máxima teórica: " + maxStr + ". Divisor atual: " + divStr
    };
  }

  // --- 2. CONFIGURAÇÃO DAS FAIXAS DE PREÇO E COLUNAS DA MATRIZ ---
  // A propriedade 'col' indica qual coluna da Tabela Cheia o algoritmo deve ler
  var faixasDePreco = [
    { min: 0.01,   max: 18.99,  col: 0 }, // Regra especial: Frete máx 50% do preço
    { min: 19.00,  max: 48.99,  col: 1 },
    { min: 49.00,  max: 78.99,  col: 2 },
    { min: 79.00,  max: 99.99,  col: 3 }, // Barreira do Frete Rápido
    { min: 100.00, max: 119.99, col: 4 },
    { min: 120.00, max: 149.99, col: 5 },
    { min: 150.00, max: 199.99, col: 6 },
    { min: 200.00, max: 999999, col: 7 }
  ];

  // --- 3. PESAGEM E BUSCA DO FRETE BASE (TABELA CHEIA VERMELHA) ---
  var pesoCobrado = Math.max(blocoVirtual.pesoFisicoMaster, blocoVirtual.cubagemMaster);

  // Função auxiliar que lê a matriz baseada no peso e na coluna
  var buscarFreteTabelaCheia = function(peso, colunaIndex) {
    // Array com os limites de peso em kg (Cada posição corresponde a uma linha da matriz abaixo)
    var limitesPeso = [0.3, 0.5, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 11.0, 13.0, 15.0, 17.0, 20.0, 25.0, 30.0, 40.0, 50.0, 60.0, 70.0, 80.0, 90.0, 100.0, 125.0, 150.0, 9999];

    // A Tabela Cheia (Validada no Excel)
    var matrizFrete = [
      [8.07, 9.36, 11.07, 24.70, 28.70, 32.90, 36.90, 41.90], // <= 0.3
      [8.50, 9.50, 11.21, 26.50, 30.90, 35.30, 39.70, 45.10], // <= 0.5
      [8.64, 9.64, 11.36, 27.70, 32.30, 36.90, 41.50, 47.30], // <= 1.0
      [8.79, 9.79, 11.50, 28.30, 32.90, 37.70, 42.30, 49.30], // <= 1.5
      [8.93, 9.93, 11.64, 28.90, 33.70, 38.50, 43.30, 49.30], // <= 2.0
      [9.07, 11.36, 12.21, 31.50, 36.70, 42.10, 47.30, 52.50], // <= 3.0
      [9.21, 11.64, 12.79, 34.10, 39.70, 45.30, 51.10, 56.70], // <= 4.0
      [9.36, 11.93, 13.93, 36.90, 43.10, 49.30, 55.50, 61.50], // <= 5.0
      [9.50, 12.21, 14.21, 50.90, 57.10, 65.30, 71.50, 79.50], // <= 6.0
      [9.64, 12.50, 14.50, 54.10, 62.10, 72.10, 80.10, 88.10], // <= 7.0
      [9.79, 12.79, 14.79, 57.70, 67.30, 76.90, 86.50, 96.10], // <= 8.0
      [9.93, 13.07, 15.07, 59.30, 69.10, 79.10, 88.90, 98.70], // <= 9.0
      [10.07, 13.64, 15.64, 82.50, 96.10, 109.90, 123.50, 137.30], // <= 11.0
      [10.21, 14.21, 16.21, 84.30, 98.50, 112.50, 126.50, 140.50], // <= 13.0
      [10.36, 14.50, 16.50, 90.10, 104.90, 119.90, 134.90, 149.90], // <= 15.0
      [10.50, 14.79, 16.79, 97.10, 112.10, 127.10, 141.50, 157.30], // <= 17.0
      [10.64, 15.07, 17.07, 109.50, 127.70, 145.90, 164.10, 182.30], // <= 20.0
      [10.93, 15.64, 17.36, 128.10, 150.10, 169.50, 190.70, 211.90], // <= 25.0
      [11.07, 15.93, 17.64, 131.90, 150.90, 171.10, 192.50, 213.90], // <= 30.0
      [11.21, 16.21, 17.93, 135.50, 157.90, 177.90, 198.30, 214.10], // <= 40.0
      [11.36, 16.50, 18.21, 140.50, 162.10, 184.10, 205.10, 221.50], // <= 50.0
      [11.50, 16.79, 18.50, 149.90, 172.90, 196.30, 218.70, 236.30], // <= 60.0
      [11.64, 17.07, 18.79, 160.50, 185.90, 210.10, 234.30, 253.10], // <= 70.0
      [11.79, 17.36, 19.07, 167.90, 194.10, 219.70, 244.90, 264.50], // <= 80.0
      [11.93, 17.64, 19.36, 186.50, 214.90, 244.10, 272.10, 293.90], // <= 90.0
      [12.07, 17.93, 19.64, 213.10, 247.90, 279.10, 311.10, 335.90], // <= 100.0
      [12.21, 18.21, 19.93, 238.50, 276.10, 312.10, 347.90, 375.90], // <= 125.0
      [12.36, 18.21, 20.21, 253.10, 292.30, 331.30, 369.30, 398.90], // <= 150.0
      [12.50, 18.21, 20.50, 332.30, 384.90, 435.10, 485.10, 523.90]  // > 150.0
    ];

    // Encontra a linha correspondente ao peso
    var linhaIndex = limitesPeso.length - 1; // Fallback para o mais pesado
    for (var p = 0; p < limitesPeso.length; p++) {
      if (peso <= limitesPeso[p]) {
        linhaIndex = p;
        break;
      }
    }
    return matrizFrete[linhaIndex][colunaIndex];
  };

  // --- 4. APLICAÇÃO DOS DESCONTOS AUDITADOS (VERDE VS AMARELA) ---
  var repFormatada = String(config.reputacao).trim().toUpperCase();
  var isVerdeOuLider = (repFormatada === "VERDE" || repFormatada === "LÍDER" || repFormatada === "LIDER" || repFormatada === "CINZA");
  var isAmarela = (repFormatada === "AMARELA");

  // --- 5. MOTOR DE BUSCA DO MELHOR PREÇO (O Loop de Tiers) ---
  var melhorPreco = 999999;
  var freteDoMelhorPreco = 0;

  for (var i = 0; i < faixasDePreco.length; i++) {
    var tier = faixasDePreco[i];
    var precoCalculado = 0;

    // 5.1. Busca o frete na Tabela Cheia para a coluna que estamos testando
    var freteCheio = buscarFreteTabelaCheia(pesoCobrado, tier.col);

    // 5.2. Aplica o multiplicador de desconto conforme a faixa (Abaixo ou Acima de R$ 79)
    var isAbaixo79 = (tier.col <= 2);
    var desconto = 0;

    if (isAbaixo79 && forcarFreteRapidoSub79) {
      // O seller quer rankear melhor! Pegamos o custo da Coluna 3 (Tabela de R$ 79)
      freteCheio = buscarFreteTabelaCheia(pesoCobrado, 3);
      // E aplicamos os descontos premium
      if (isVerdeOuLider) desconto = 0.50;
      else if (isAmarela) desconto = 0.40;
    }
    else if (isAbaixo79) {
      // Fluxo Padrão Normal (< 79)
      if (isVerdeOuLider) desconto = 0.30;
      else if (isAmarela) desconto = 0.20;
    }
    else {
      // Fluxo Padrão Normal (>= 79)
      if (isVerdeOuLider) desconto = 0.50;
      else if (isAmarela) desconto = 0.40;
    }

    var freteFinalSendoTestado = freteCheio * (1 - desconto);

    // LÓGICA DO CRÉDITO SOBRE O FRETE (CT-e para Lucro Real)
    if (config.regimeTributario === "Lucro Real" && config.tomarCredito && (config.baseCredito === "Frete" || config.baseCredito === "Frete + Comissões")) {
      freteFinalSendoTestado = freteFinalSendoTestado * (1 - config.pisCofins);
    }

    // O Ajuste do Numerador calculado AQUI, onde o frete já existe
    var ajusteImpostoSobreFrete = (config.pisCofins + config.irpj + config.csll) * (freteFinalSendoTestado * cargaIpiEfetiva);

    // 5.3. A Álgebra do Preço
    if (tier.col === 0) {
      // REGRA ESPECIAL: Anúncios até 18.99 pagam no máx 50% do valor do produto em frete.
      var precoSemTrava = (blocoVirtual.custoTotal + (freteFinalSendoTestado * (1 - cargaIpiEfetiva)) + ajusteImpostoSobreFrete) / divisor;

      // Se o frete calculado representa mais de 50% do preço de venda, a trava do ML é acionada.
      if (freteFinalSendoTestado > (precoSemTrava * 0.5)) {
        // Recalculando o preço com a trava de 50%:
        // Precisamos ajustar o divisor para compensar a isenção do IPI e a carga extra de federais
        var multiplicadorFrete = (1 - cargaIpiEfetiva) + ((config.pisCofins + config.irpj + config.csll) * cargaIpiEfetiva);
        var novoDivisorMicro = divisor - (0.5 * multiplicadorFrete);

        if (novoDivisorMicro > 0) {
          precoCalculado = blocoVirtual.custoTotal / novoDivisorMicro;
        } else {
          precoCalculado = 999999; // Margem inviável para itens muito baratos
        }

      } else {
        precoCalculado = precoSemTrava; // Passou liso, o frete não atingiu 50%
      }
    } else {
      // REGRA PADRÃO PARA AS DEMAIS FAIXAS
      // A fórmula absoluta ganha o ajuste no numerador
      precoCalculado = (blocoVirtual.custoTotal + (freteFinalSendoTestado * (1 - cargaIpiEfetiva)) + ajusteImpostoSobreFrete) / divisor;
    }

    // 5.4. Blindagem Decimal e Teste de Validação
    var precoArredondado = Math.round(precoCalculado * 100) / 100;

    // Se o preço calculado "couber" matematicamente dentro da faixa que ditou o custo do frete, achamos o candidato perfeito!
    if (precoArredondado >= tier.min && precoArredondado <= tier.max) {
      if (precoCalculado < melhorPreco) {
        melhorPreco = precoCalculado;
        freteDoMelhorPreco = freteFinalSendoTestado;
      }
    }
  }

  if (melhorPreco === 999999) {
    var freteCheioFallback = buscarFreteTabelaCheia(pesoCobrado, 7);
    var descFallback = isVerdeOuLider ? 0.50 : (isAmarela ? 0.40 : 0);
    var freteFallbackFinal = freteCheioFallback * (1 - descFallback);

    if (config.regimeTributario === "Lucro Real" && config.tomarCredito && (config.baseCredito === "Frete" || config.baseCredito === "Frete + Comissões")) {
      freteFallbackFinal = freteFallbackFinal * (1 - config.pisCofins);
    }

    // NOVO: Aplica a mesma compensação de impostos federais para o frete fallback
    var ajusteFallback = (config.pisCofins + config.irpj + config.csll) * (freteFallbackFinal * cargaIpiEfetiva);
    melhorPreco = (blocoVirtual.custoTotal + (freteFallbackFinal * (1 - cargaIpiEfetiva)) + ajusteFallback) / divisor;
    freteDoMelhorPreco = freteFallbackFinal;
  }

  // --- 7. MONTAGEM DA AUDITORIA FISCAL (DRE DA VENDA) ---
  var pFinal = Math.round(melhorPreco * 100) / 100;

  // Recalculando os valores absolutos em R$ baseados no preço final cravado
  var calcComissao = pFinal * taxaEfetivaML;
  var calcIcmsCaixa = pFinal * cargaIcmsCaixa;
  var calcIpi = (pFinal - freteDoMelhorPreco) * cargaIpiEfetiva;

  var calcDifal = 0;
  var calcFecop = 0;
  var calcPisCofins = 0;
  var calcIrpj = 0;
  var calcCsll = 0;

  if (config.regimeTributario === "Simples Nacional") {
    calcPisCofins = pFinal * fatorFederaisAjustado; // O DAS inteiro fica aqui
  } else {
    // Desmembrando DIFAL e FECOP para a auditoria
    if ((alqDestino + fecopDestino) > 0) {
      var difalTotalMath = Math.max(0, (alqDestino + fecopDestino) - cargaIcmsDestaque);
      calcFecop = Math.min(difalTotalMath, fecopDestino) * pFinal;
      calcDifal = (difalTotalMath * pFinal) - calcFecop;
    }
    // A RECEITA LÍQUIDA DE IPI: Preço Total menos o valor real absoluto do IPI
    var receitaLivreDeIpi = pFinal - calcIpi;

    // Tributos Federais calculados estritamente sobre a base purificada
    calcPisCofins = (receitaLivreDeIpi - (pFinal * cargaIcmsDestaque) - calcDifal - calcFecop) * config.pisCofins;
    calcIrpj = receitaLivreDeIpi * config.irpj;
    calcCsll = receitaLivreDeIpi * config.csll;
  }

  // A Margem Líquida calculada por resíduo garante que a soma das colunas bata 100% com o Preço
  var calcMargem = pFinal - blocoVirtual.custoTotal - calcComissao - freteDoMelhorPreco - calcIcmsCaixa - calcDifal - calcFecop - calcPisCofins - calcIpi - calcIrpj - calcCsll;

  // Devolve o Objeto Completo!
  return {
    sucesso: true,
    feedback: "200: Cálculo realizado com sucesso.",
    preco: pFinal,
    custo: blocoVirtual.custoTotal,
    comissao: calcComissao,
    frete: freteDoMelhorPreco,
    icms: calcIcmsCaixa,
    difal: calcDifal,
    fecop: calcFecop,
    pisCofins: calcPisCofins,
    ipi: calcIpi,
    irpj: calcIrpj,
    csll: calcCsll,
    margem: calcMargem
  };
}


/**
 * MÓDULO 2B: O MOTOR FINANCEIRO DA SHOPEE
 * Responsabilidade: Aplicar a carga tributária, resolver o paradoxo das taxas fixas escalonáveis
 * (Regras de Março/2026) e devolver a DRE compatível com o Módulo 3.
 */

function calcularPrecoSHP(blocoVirtual, config, alqDestino, fecopDestino, taxaCampanhaExtra = 0) {
  if (!blocoVirtual) return { sucesso: false, feedback: "400: Bloco Virtual Vazio" };

  // --- 1. CARGA TRIBUTÁRIA (A Tese do Século é universal) ---
  var cargaIcmsDestaque = blocoVirtual.icmsDestaquePonderado;
  var cargaIcmsCaixa = blocoVirtual.icmsCaixaPonderado;
  var cargaIpiNominal = blocoVirtual.ipiPonderado;
  var cargaIpiEfetiva = cargaIpiNominal / (1 + cargaIpiNominal);

  var difal = 0;
  var fatorFederaisAjustado = 0;

  if (config.regimeTributario === "Simples Nacional") {
    difal = 0;
    cargaIcmsCaixa = 0;
    fatorFederaisAjustado = blocoVirtual.simplesNacionalPonderado;
  } else {
    var cargaDestinoTotal = alqDestino + fecopDestino;
    if (cargaDestinoTotal > 0) {
      difal = Math.max(0, cargaDestinoTotal - cargaIcmsDestaque);
    }
    var baseReceitaBruta = 1 - cargaIpiEfetiva;
    fatorFederaisAjustado = config.pisCofins * (baseReceitaBruta - cargaIcmsDestaque - difal) + (config.irpj * baseReceitaBruta) + (config.csll * baseReceitaBruta);
  }

  var somaImpostosEMargem = cargaIcmsCaixa + difal + fatorFederaisAjustado + cargaIpiEfetiva + blocoVirtual.margemPonderada;

  // --- 2. O SOLVER DE TIERS DA SHOPEE (Regras Março/2026) ---
  var faixasShopee = [
    { min: 0.01,   max: 7.99,   comissaoBase: 0.20, taxaFixa: "50%" }, // Regra de micro-valor
    { min: 8.00,   max: 79.99,  comissaoBase: 0.20, taxaFixa: 4.00 },
    { min: 80.00,  max: 99.99,  comissaoBase: 0.14, taxaFixa: 16.00 },
    { min: 100.00, max: 199.99, comissaoBase: 0.14, taxaFixa: 20.00 },
    { min: 200.00, max: 999999, comissaoBase: 0.14, taxaFixa: 26.00 }
  ];

  var melhorPreco = 999999;
  var comissaoAplicada = 0;
  var taxaFixaAplicada = 0;
  var comissaoPercentualFinal = 0;

  for (var i = 0; i < faixasShopee.length; i++) {
    var tier = faixasShopee[i];
    var comissaoTotalTier = tier.comissaoBase + taxaCampanhaExtra; // Ex: 20% + 2.5% = 22.5%
    var divisorTier = 1 - (somaImpostosEMargem + comissaoTotalTier);

    // Trava de física tributária para esta faixa específica
    if (divisorTier <= 0) continue; 

    var precoCalculado = 0;
    var taxaFixaDestaFaixa = 0;

    // A Álgebra do Preço
    if (tier.taxaFixa === "50%") {
      // REGRA DE MICRO-VALOR: A taxa fixa é 50% do próprio preço. 
      // Isso significa que ela entra no divisor, achatando-o absurdamente.
      var divisorMicro = divisorTier - 0.50;
      if (divisorMicro > 0) {
        precoCalculado = (blocoVirtual.custoTotal) / divisorMicro;
        taxaFixaDestaFaixa = precoCalculado * 0.50;
      } else {
        precoCalculado = 999999; // Margem inviável
      }
    } else {
      // REGRA PADRÃO DOS DEGRAUS
      taxaFixaDestaFaixa = tier.taxaFixa;
      precoCalculado = (blocoVirtual.custoTotal + taxaFixaDestaFaixa) / divisorTier;
    }

    // Blindagem Decimal
    var precoArredondado = Math.round(precoCalculado * 100) / 100;

    // Se o preço calculado "couber" matematicamente dentro da faixa que ditou a regra, achamos o candidato!
    if (precoArredondado >= tier.min && precoArredondado <= tier.max) {
      if (precoCalculado < melhorPreco) {
        melhorPreco = precoCalculado;
        comissaoPercentualFinal = comissaoTotalTier;
        taxaFixaAplicada = taxaFixaDestaFaixa;
      }
    }
  }

  // Se o loop terminou e o preço continua 999999, significa que o produto caiu no "Vale da Morte"
  // ou a margem exigida estourou a física de todas as faixas.
  if (melhorPreco === 999999) {
    return {
      sucesso: false,
      feedback: "400: Margem inviável ou produto preso em Zona Morta (saltos da taxa fixa impossibilitam o preço)."
    };
  }

  // --- 3. MONTAGEM DA AUDITORIA FISCAL (DRE DA SHOPEE) ---
  var pFinal = Math.round(melhorPreco * 100) / 100;

  // Custo de Plataforma desmembrado (Comissão % + Taxa Fixa R$ + Penalidades)
  var calcComissaoTotal = (pFinal * comissaoPercentualFinal) + taxaFixaAplicada;

  var calcIcmsCaixa = pFinal * cargaIcmsCaixa;
  var calcIpi = pFinal * cargaIpiEfetiva;

  var calcDifal = 0; var calcFecop = 0; var calcPisCofins = 0; var calcIrpj = 0; var calcCsll = 0;

  if (config.regimeTributario === "Simples Nacional") {
    calcPisCofins = pFinal * fatorFederaisAjustado;
  } else {
    if ((alqDestino + fecopDestino) > 0) {
      var difalTotalMath = Math.max(0, (alqDestino + fecopDestino) - cargaIcmsDestaque);
      calcFecop = Math.min(difalTotalMath, fecopDestino) * pFinal;
      calcDifal = (difalTotalMath * pFinal) - calcFecop;
    }
    // (NOVO TRECHO PURIFICADO - APENAS GRANDEZAS EM R$)
    // A RECEITA LÍQUIDA DE IPI: Preço Total menos o valor real absoluto do IPI
    var receitaLivreDeIpi = pFinal - calcIpi;

    // Tributos Federais calculados estritamente sobre a base purificada em REAIS
    calcPisCofins = (receitaLivreDeIpi - (pFinal * cargaIcmsDestaque) - calcDifal - calcFecop) * config.pisCofins;
    calcIrpj = receitaLivreDeIpi * config.irpj;
    calcCsll = receitaLivreDeIpi * config.csll;
  }

  // Na DRE, alocaremos a Comissão % na coluna 'Comissão' (Coluna O) e a Taxa Fixa na coluna 'Frete/Envios' (Coluna P)
  // para manter a simetria com a estrutura atual da planilha.
  var calcMargem = pFinal - blocoVirtual.custoTotal - calcComissaoTotal - calcIcmsCaixa - calcDifal - calcFecop - calcPisCofins - calcIpi - calcIrpj - calcCsll;

  return {
    sucesso: true,
    feedback: "200: Cálculo Shopee realizado com sucesso.",
    preco: pFinal,
    custo: blocoVirtual.custoTotal,
    comissao: calcComissaoTotal,
    frete: 0, 
    icms: calcIcmsCaixa,
    difal: calcDifal,
    fecop: calcFecop,
    pisCofins: calcPisCofins,
    ipi: calcIpi,
    irpj: calcIrpj,
    csll: calcCsll,
    margem: calcMargem
  };
}


/**
 * MÓDULO 3: O GATILHO DE EXECUÇÃO (CONTROLLER)
 * Responsabilidade: Varrer a aba TGFADS, orquestrar os cálculos
 * e gravar os resultados em lote (batch) para máxima performance.
 */

function processarPrecificacaoEmMassa() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var abaAds = ss.getSheetByName("TGFADS");

  // 1. Inicia o cronômetro mental e carrega o banco de dados
  var db = carregarBancoDeDados();

  // 2. Lê todos os anúncios de uma vez só
  // Assumindo que os dados começam na linha 2 e vão até a última linha preenchida
  var ultimaLinha = abaAds.getLastRow();
  if (ultimaLinha < 2) return; // Se só tiver cabeçalho, aborta.

  var rangeAds = abaAds.getRange(2, 1, ultimaLinha - 1, abaAds.getLastColumn());
  var dadosAds = rangeAds.getValues();

  // 3. Prepara um Array vazio para guardar os preços calculados
  // Gravar célula por célula é lento. Vamos guardar tudo aqui e cuspir de uma vez.
  var resultadosPrecoFinal = [];
  var resultadosVuncom = [];

  // 4. O Loop de Orquestração
  for (var i = 0; i < dadosAds.length; i++) {
    var linha = dadosAds[i];

    // Mapeamento das colunas da TGFADS (Lembrando: Índice começa no ZERO)
    var skuAnunciado = linha[1];                        // Coluna B
    var qtdNoAnuncio = parseFloat(linha[2]) || 1;       // Coluna C
    var taxaCategoriaML = parseFloat(linha[4]) || 0;    // Coluna E
    var tipoMargem = linha[5];                          // Coluna F
    var margemCustomizada = parseFloat(linha[6]) || 0;  // Coluna G

    // VARIÁVEIS FISCAIS E TÁTICAS
    var alqDestino = parseFloat(linha[7]) || 0;     // Coluna H
    var fecopDestino = parseFloat(linha[8]) || 0;   // Coluna I

    // Força Frete Grátis Rápido mesmo se o preço do anúncio for menor do que R$79
    var forcarFreteRapido = (String(linha[9]).trim().toUpperCase() === "SIM"); // Coluna J

    // Captura do canal de venda
    var canalVenda = String(linha[10]).trim();  // Coluna K

    // Captura a coluna L (Índice 11) e já converte para o percentual matemático
    var flagCampanha = String(linha[11]).trim().toUpperCase();
    var taxaCampanhaShopee = (flagCampanha === "SIM") ? 0.025 : 0;

    // Ignora linhas vazias mantendo o alinhamento de 13 colunas
    if (!skuAnunciado) {
      resultadosPrecoFinal.push(["", "", "", "", "", "", "", "", "", "", "", "", ""]);
      continue;
    }

    // 5. Aciona o Engenheiro do Bloco Virtual (Módulo 1)
    var bloco = construirBlocoVirtual(skuAnunciado, qtdNoAnuncio, tipoMargem, margemCustomizada, canalVenda, db);

    if (!bloco) {
      // HTTP 404 - Not Found
      resultadosPrecoFinal.push(["", "", "", "", "", "", "", "", "", "", "", "", "404: SKU componente não encontrado no catálogo (TGFPRO)."]);
      continue;
    }

    // 6. Aciona o Motor Financeiro (Módulo 2)
    // ----------------------------------------------------------------
    // O ROTEADOR OMNICHANNEL (A Chave de Trilhos)
    // ----------------------------------------------------------------
    var d; // Variável que receberá o objeto de resposta, independente do canal

    if (canalVenda === "Shopee") {
      // Como o Módulo 2B ainda não foi escrito, disparamos um HTTP 501 (Not Implemented)
      // Passamos 0 e 0 para Campanha e Penalidade CPF por enquanto
      d = calcularPrecoSHP(bloco, db.config, alqDestino, fecopDestino, taxaCampanhaShopee);
    } else {
      // Fallback de segurança e padrão: Mercado Livre
      d = calcularPrecoMLB(bloco, db.config, taxaCategoriaML, forcarFreteRapido, alqDestino, fecopDestino);
    }

    // TRAVA DE SUCESSO E INJEÇÃO NA DRE
    if (!d.sucesso) {
      // Falhou no motor (ex: Margem de 100%). Imprime colunas vazias e o erro na coluna Y
      resultadosPrecoFinal.push(["", "", "", "", "", "", "", "", "", "", "", "", d.feedback]);
      continue; // Pula a explosão da TGF_VUNCOM (Isso limpa os erros #NUM!)
    }

    // Sucesso! Empurra a matriz de 13 colunas da auditoria
    resultadosPrecoFinal.push([
      d.preco, d.custo, d.comissao, d.frete, d.icms, d.difal,
      d.fecop, d.pisCofins, d.ipi, d.irpj, d.csll, d.margem, d.feedback
    ]);

    // --- NOVA LÓGICA: RATEIO E EXPLOSÃO PARA TGF_VUNCOM ---
    var idAnuncio = linha[0]; // Captura o ID da Coluna A
    var valorAlvoTotal = 0;

    // Acha a base total de 100% para fazer a proporção do Kit
    for (var v = 0; v < bloco.origemICMSArray.length; v++) {
      valorAlvoTotal += bloco.origemICMSArray[v].valorAlvoAbsoluto;
    }

    // Explode os componentes gerando as 7 colunas
    for (var c = 0; c < bloco.origemICMSArray.length; c++) {
      var comp = bloco.origemICMSArray[c];
      var proporcao = comp.valorAlvoAbsoluto / valorAlvoTotal;

      var vlrFreteRateio = d.frete * proporcao;
      var vlrProdRateio = (d.preco - d.frete) * proporcao;

      // A MÁGICA DA DEFLAÇÃO: Extraindo o IPI do vProd
      var vlrProdReal = vlrProdRateio / (1 + comp.ipi);
      var vlrIpi = vlrProdRateio - vlrProdReal;

      var vlrUniNfe = vlrProdReal / comp.qtdComponente; // Isolando o unitário

      resultadosVuncom.push([
        idAnuncio,            // 1. ID_ANUNCIO
        skuAnunciado,         // 2. SKU_ANUNCIO
        comp.skuComponente,   // 3. <cProd>
        comp.qtdComponente,   // 4. <qCom>
        vlrUniNfe,            // 5. <vUnCom>
        vlrProdReal,          // 6. <vProd>
        vlrFreteRateio,       // 7. <vFrete>
        vlrIpi                // 8. <vIPI>
      ]);
    }
  }

  // 7. A Injeção Final em Lote (Batch Write)
  // Coluna M é a 13ª. O tamanho (width) agora não é mais 1, são 12 colunas simultâneas!
  var rangeSaida = abaAds.getRange(2, 14, resultadosPrecoFinal.length, 13);
  rangeSaida.setValues(resultadosPrecoFinal);

  // 8. A INJEÇÃO NA STAGING TABLE (TGF_VUNCOM)
  var abaVuncom = ss.getSheetByName("TGF_VUNCOM");
  var ultimaLinhaVuncom = abaVuncom.getLastRow();

  // Limpa o lixo da rodada anterior (se houver dados da linha 2 em diante)
  if (ultimaLinhaVuncom > 1) {
    abaVuncom.getRange(2, 1, ultimaLinhaVuncom - 1, 8).clearContent();
  }

  // Injeta a nova explosão de Kits com 7 colunas
  if (resultadosVuncom.length > 0) {
    abaVuncom.getRange(2, 1, resultadosVuncom.length, 8).setValues(resultadosVuncom);
  }
}
