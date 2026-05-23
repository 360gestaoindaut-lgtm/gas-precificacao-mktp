function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);

    // 1. Reconstituir db.produtos a partir da matriz 2D da TGFPRO (ignora cabeçalho)
    var mapPro = {};
    for (var i = 1; i < req.dadosPro.length; i++) {
      var row = req.dadosPro[i];
      var sku = row[0];
      if (!sku) continue;
      mapPro[sku] = {
        tipoProduto:     row[1],
        origemProduto:   row[5],
        custoAquisicao:  parseFloat(row[6])  || 0,
        pesoKg:          parseFloat(row[7])  || 0,
        comprimento:     parseFloat(row[8])  || 0,
        largura:         parseFloat(row[9])  || 0,
        altura:          parseFloat(row[10]) || 0,
        margemML:        parseFloat(row[11]) || 0,
        margemSHP:       parseFloat(row[12]) || 0,
        ipi:             parseFloat(row[13]) || 0,
        regimeIcmsSaida: row[14] || "Débito",
        redBcIcms:       parseFloat(row[15]) || 0
      };
    }

    // 2. Reconstituir db.kits a partir da matriz 2D da TGFKIT (ignora cabeçalho)
    var mapKit = {};
    for (var j = 1; j < req.dadosKit.length; j++) {
      var rowKit = req.dadosKit[j];
      var skuKit = rowKit[0];
      if (!skuKit) continue;
      if (!mapKit[skuKit]) mapKit[skuKit] = [];
      mapKit[skuKit].push({
        skuComponente: rowKit[1],
        qtdComponente: parseFloat(rowKit[2]) || 1,
        margemKitML:   rowKit[3] !== "" ? parseFloat(rowKit[3]) : null,
        margemKitSHP:  rowKit[4] !== "" ? parseFloat(rowKit[4]) : null
      });
    }

    // 3. Reconstituir db.config a partir do JSON fiscal do UserProperties
    // pisCofins é a soma das alíquotas granulares; tomarCredito é convertido para boolean
    var db = {
      config: {
        reputacao:        req.config.reputacao || 'Verde',
        pisCofins:        (parseFloat(req.config.alqPis) || 0) + (parseFloat(req.config.alqCofins) || 0),
        irpj:             parseFloat(req.config.irpj)          || 0,
        csll:             parseFloat(req.config.csll)          || 0,
        regimeTributario: req.config.regimeTributario,
        tomarCredito:     (String(req.config.tomarCredito || '').trim().toUpperCase() === 'SIM'),
        baseCredito:      req.config.baseCredito               || 'Nenhum',
        cargaSnNormal:    parseFloat(req.config.cargaSnNormal) || 0,
        cargaSnSt:        parseFloat(req.config.cargaSnSt)     || 0
      },
      produtos: mapPro,
      kits:     mapKit
    };

    // 4. Loop de Orquestração (replica processarPrecificacaoEmMassa sem SpreadsheetApp)
    var dadosAds = req.dadosAds.slice(1); // ignora o cabeçalho
    var resultadosPrecoFinal = [];
    var resultadosVuncom = [];

    for (var k = 0; k < dadosAds.length; k++) {
      var linha = dadosAds[k];

      var skuAnunciado    = linha[1];
      var qtdNoAnuncio    = parseFloat(linha[2]) || 1;
      var taxaCategoriaML = parseFloat(linha[4]) || 0;
      var tipoMargem      = linha[5];
      var margemCustomizada = parseFloat(linha[6]) || 0;
      var alqDestino      = parseFloat(linha[7]) || 0;
      var fecopDestino    = parseFloat(linha[8]) || 0;
      var forcarFreteRapido = (String(linha[9]).trim().toUpperCase() === "SIM");
      var canalVenda      = String(linha[10]).trim();
      var flagCampanha    = String(linha[11]).trim().toUpperCase();
      var taxaCampanhaShopee = (flagCampanha === "SIM") ? 0.025 : 0;

      if (!skuAnunciado) {
        resultadosPrecoFinal.push(["", "", "", "", "", "", "", "", "", "", "", "", ""]);
        continue;
      }

      var bloco = construirBlocoVirtual(skuAnunciado, qtdNoAnuncio, tipoMargem, margemCustomizada, canalVenda, db);

      if (!bloco) {
        resultadosPrecoFinal.push(["", "", "", "", "", "", "", "", "", "", "", "", "404: SKU componente não encontrado no catálogo (TGFPRO)."]);
        continue;
      }

      var d;
      if (canalVenda === "Shopee") {
        d = calcularPrecoSHP(bloco, db.config, alqDestino, fecopDestino, taxaCampanhaShopee);
      } else {
        d = calcularPrecoMLB(bloco, db.config, taxaCategoriaML, forcarFreteRapido, alqDestino, fecopDestino);
      }

      if (!d.sucesso) {
        resultadosPrecoFinal.push(["", "", "", "", "", "", "", "", "", "", "", "", d.feedback]);
        continue;
      }

      resultadosPrecoFinal.push([
        d.preco, d.custo, d.comissao, d.frete, d.icms, d.difal,
        d.fecop, d.pisCofins, d.ipi, d.irpj, d.csll, d.margem, d.feedback
      ]);

      // Rateio e explosão para TGF_VUNCOM
      var idAnuncio = linha[0];
      var valorAlvoTotal = 0;
      for (var v = 0; v < bloco.origemICMSArray.length; v++) {
        valorAlvoTotal += bloco.origemICMSArray[v].valorAlvoAbsoluto;
      }

      for (var c = 0; c < bloco.origemICMSArray.length; c++) {
        var comp = bloco.origemICMSArray[c];
        var proporcao    = comp.valorAlvoAbsoluto / valorAlvoTotal;
        var vlrFreteRateio = d.frete * proporcao;
        var vlrProdRateio  = (d.preco - d.frete) * proporcao;
        var vlrProdReal    = vlrProdRateio / (1 + comp.ipi);
        var vlrIpi         = vlrProdRateio - vlrProdReal;
        var vlrUniNfe      = vlrProdReal / comp.qtdComponente;

        resultadosVuncom.push([
          idAnuncio,
          skuAnunciado,
          comp.skuComponente,
          comp.qtdComponente,
          vlrUniNfe,
          vlrProdReal,
          vlrFreteRateio,
          vlrIpi
        ]);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      sucesso: true,
      precoFinal: resultadosPrecoFinal,
      vuncom: resultadosVuncom
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      sucesso: false,
      erro: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
