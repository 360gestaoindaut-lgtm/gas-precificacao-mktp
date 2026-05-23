function doGet(e) {
  var params = e.parameter;

  if (params.code && params.state) {
    try {
      procederTrocaDeToken(params.code, params.state);
      return HtmlService.createHtmlOutput(
        '<h2>✅ Mercado Livre conectado com sucesso!</h2>' +
        '<p>Pode fechar esta janela e voltar à planilha.</p>'
      );
    } catch (err) {
      return HtmlService.createHtmlOutput(
        '<h2>❌ Erro na autenticação</h2><p>' + err.message + '</p>'
      );
    }
  }

  if (params.action === 'conectar' && params.id) {
    var url = obterUrlAutorizacao(params.id);
    return HtmlService.createHtmlOutput(
      '<script>window.location.href = "' + url + '";</script>' +
      '<p>Redirecionando para o Mercado Livre...</p>'
    );
  }

  return HtmlService.createHtmlOutput('<p>Endpoint inativo.</p>');
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);

    // 1. Reconstituir db.produtos (ignora cabeçalho)
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

    // 2. Reconstituir db.kits (ignora cabeçalho)
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

    // 3. Reconstituir db.config
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

    var dadosAnuncios = req.dadosAnuncios.slice(1); // ignora o cabeçalho
    var resultadosPreco  = [];
    var resultadosVuncom = [];

    // 4. OAuth: injeta reputação real (apenas MLB requer vínculo)
    if (req.canalAlvo === "MLB") {
      var accessToken = obterAccessTokenValido(req.spreadsheetId);
      if (!accessToken) {
        return ContentService.createTextOutput(JSON.stringify({
          sucesso: false,
          erro:    '403: Conta do Mercado Livre não conectada. Acesse "🔗 Conectar Mercado Livre" no menu da planilha.'
        })).setMimeType(ContentService.MimeType.JSON);
      }
      var repInfo = buscarReputacaoMercadoLivre(accessToken);
      db.config.reputacao = normalizarReputacao(repInfo.levelId, repInfo.powerStatus);
    }

    // 4a. Branch MLB
    // Mapeamento TGFMLB: A=ID, B=SKU, C=QTD, D=TipoMargem, E=MargemCustom,
    //                    F=TaxaCategoria, G=AlqDestino, H=FecopDestino, I=ForcarFrete
    if (req.canalAlvo === "MLB") {
      for (var k = 0; k < dadosAnuncios.length; k++) {
        var l = dadosAnuncios[k];
        var idAnuncio         = l[0];
        var skuAnunciado      = l[1];
        var qtdNoAnuncio      = parseFloat(l[2]) || 1;
        var tipoMargem        = l[3];
        var margemCustomizada = parseFloat(l[4]) || 0;
        var taxaCategoriaML   = parseFloat(l[5]) || 0;
        var alqDestino        = parseFloat(l[6]) || 0;
        var fecopDestino      = parseFloat(l[7]) || 0;
        var forcarFreteRapido = (String(l[8]).trim().toUpperCase() === "SIM");

        if (!skuAnunciado) {
          resultadosPreco.push(["", "", "", "", "", "", "", "", "", "", "", "", ""]);
          continue;
        }

        var bloco = construirBlocoVirtual(skuAnunciado, qtdNoAnuncio, tipoMargem, margemCustomizada, "Mercado Livre", db);
        if (!bloco) {
          resultadosPreco.push(["", "", "", "", "", "", "", "", "", "", "", "", "404: SKU não encontrado na TGFPRO."]);
          continue;
        }

        var d = calcularPrecoMLB(bloco, db.config, taxaCategoriaML, forcarFreteRapido, alqDestino, fecopDestino);
        if (!d.sucesso) {
          resultadosPreco.push(["", "", "", "", "", "", "", "", "", "", "", "", d.feedback]);
          continue;
        }

        resultadosPreco.push([
          d.preco, d.custo, d.comissao, d.frete, d.icms, d.difal,
          d.fecop, d.pisCofins, d.ipi, d.irpj, d.csll, d.margem, d.feedback
        ]);
        _explodirVuncom(idAnuncio, skuAnunciado, bloco, d, resultadosVuncom);
      }

    // 4b. Branch SHP
    // Mapeamento TGFSHP: A=ID, B=SKU, C=QTD, D=TipoMargem, E=MargemCustom,
    //                    F=AlqDestino, G=FecopDestino, H=FlagCampanha
    } else if (req.canalAlvo === "SHP") {
      for (var m = 0; m < dadosAnuncios.length; m++) {
        var s = dadosAnuncios[m];
        var idAnuncioS         = s[0];
        var skuAnunciadoS      = s[1];
        var qtdNoAnuncioS      = parseFloat(s[2]) || 1;
        var tipoMargemS        = s[3];
        var margemCustomizadaS = parseFloat(s[4]) || 0;
        var alqDestinoS        = parseFloat(s[5]) || 0;
        var fecopDestinoS      = parseFloat(s[6]) || 0;
        var taxaCampanha       = (String(s[7]).trim().toUpperCase() === "SIM") ? 0.025 : 0;

        if (!skuAnunciadoS) {
          resultadosPreco.push(["", "", "", "", "", "", "", "", "", "", "", "", ""]);
          continue;
        }

        var blocoS = construirBlocoVirtual(skuAnunciadoS, qtdNoAnuncioS, tipoMargemS, margemCustomizadaS, "Shopee", db);
        if (!blocoS) {
          resultadosPreco.push(["", "", "", "", "", "", "", "", "", "", "", "", "404: SKU não encontrado na TGFPRO."]);
          continue;
        }

        var dS = calcularPrecoSHP(blocoS, db.config, alqDestinoS, fecopDestinoS, taxaCampanha);
        if (!dS.sucesso) {
          resultadosPreco.push(["", "", "", "", "", "", "", "", "", "", "", "", dS.feedback]);
          continue;
        }

        resultadosPreco.push([
          dS.preco, dS.custo, dS.comissao, dS.frete, dS.icms, dS.difal,
          dS.fecop, dS.pisCofins, dS.ipi, dS.irpj, dS.csll, dS.margem, dS.feedback
        ]);
        _explodirVuncom(idAnuncioS, skuAnunciadoS, blocoS, dS, resultadosVuncom);
      }
    }

    return ContentService.createTextOutput(JSON.stringify({
      sucesso: true,
      precoFinal: resultadosPreco,
      vuncom:     resultadosVuncom
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      sucesso: false,
      erro: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function _explodirVuncom(idAnuncio, skuAnunciado, bloco, d, resultadosVuncom) {
  var valorAlvoTotal = 0;
  for (var v = 0; v < bloco.origemICMSArray.length; v++) {
    valorAlvoTotal += bloco.origemICMSArray[v].valorAlvoAbsoluto;
  }
  for (var c = 0; c < bloco.origemICMSArray.length; c++) {
    var comp           = bloco.origemICMSArray[c];
    var proporcao      = comp.valorAlvoAbsoluto / valorAlvoTotal;
    var vlrFreteRateio = d.frete * proporcao;
    var vlrProdRateio  = (d.preco - d.frete) * proporcao;
    var vlrProdReal    = vlrProdRateio / (1 + comp.ipi);
    var vlrIpi         = vlrProdRateio - vlrProdReal;
    var vlrUniNfe      = vlrProdReal / comp.qtdComponente;
    resultadosVuncom.push([
      idAnuncio, skuAnunciado, comp.skuComponente, comp.qtdComponente,
      vlrUniNfe, vlrProdReal, vlrFreteRateio, vlrIpi
    ]);
  }
}
