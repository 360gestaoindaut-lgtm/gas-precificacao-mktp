function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var code  = e.parameter.code;
  var uuid  = e.parameter.state;

  if (!code || !uuid) return HtmlService.createHtmlOutput('Parâmetros ausentes.');

  var ssId = props.getProperty('CSRF_' + uuid);
  if (ssId) props.deleteProperty('CSRF_' + uuid);

  var payload = {
    grant_type:    'authorization_code',
    client_id:     props.getProperty('ML_CLIENT_ID'),
    client_secret: props.getProperty('ML_CLIENT_SECRET'),
    code:          code,
    redirect_uri:  ScriptApp.getService().getUrl()
  };

  var response = UrlFetchApp.fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'post', payload: payload, muteHttpExceptions: true
  });

  var resObj = JSON.parse(response.getContentText());

  if (resObj.access_token && ssId) {
    var meRes = UrlFetchApp.fetch('https://api.mercadolibre.com/users/me', {
      headers: { 'Authorization': 'Bearer ' + resObj.access_token },
      muteHttpExceptions: true
    });
    if (meRes.getResponseCode() === 200) {
      var meData      = JSON.parse(meRes.getContentText());
      resObj.nickname = meData.nickname;
      resObj.ml_id    = meData.id;

      var levelId = meData.seller_reputation ? meData.seller_reputation.level_id : null;
      if      (levelId === '5_green')       resObj.reputacao = '🟢 Verde';
      else if (levelId === '4_light_green') resObj.reputacao = '🍏 Verde Claro';
      else if (levelId === '3_yellow')      resObj.reputacao = '🟡 Amarela';
      else if (levelId === '2_orange')      resObj.reputacao = '🟠 Laranja';
      else if (levelId === '1_red')         resObj.reputacao = '🔴 Vermelha';
      else                                  resObj.reputacao = '⚪ Cinza';
    } else {
      resObj.nickname  = 'Conta ML';
      resObj.ml_id     = 'Desconhecido';
      resObj.reputacao = '⚪ Cinza';
    }

    _registrarTenant(ssId, resObj.ml_id, resObj.nickname);

    var agora = Math.floor(Date.now() / 1000);
    props.setProperty('TEMP_TOKEN_'       + ssId, JSON.stringify(resObj));
    props.setProperty('ML_ACCESS_TOKEN_'  + ssId, resObj.access_token);
    props.setProperty('ML_REFRESH_TOKEN_' + ssId, resObj.refresh_token || '');
    props.setProperty('ML_EXPIRES_AT_'    + ssId, String(agora + (resObj.expires_in || 21600)));
    return HtmlService.createHtmlOutput(
      '<div style="font-family:sans-serif;text-align:center;padding-top:50px;">' +
      '<h2 style="color:#2e7d32;">✅ Autorização Concluída!</h2>' +
      '<p>Pode fechar esta aba. Sua planilha será atualizada automaticamente.</p>' +
      '<script>setTimeout(function(){window.close();},2000);</script>' +
      '</div>'
    );
  }

  return HtmlService.createHtmlOutput('Erro ao gerar token: ' + JSON.stringify(resObj));
}

function doPost(e) {
  try {
    var req   = JSON.parse(e.postData.contents);
    var props = PropertiesService.getScriptProperties();

    if (req.action === 'registerCsrfState') {
      props.setProperty('CSRF_' + req.uuid, req.spreadsheetId);
      return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
    }

    if (req.action === 'fetchToken') {
      var key       = 'TEMP_TOKEN_' + req.spreadsheetId;
      var tokenData = props.getProperty(key);
      if (tokenData) {
        props.deleteProperty(key);
        return ContentService.createTextOutput(tokenData).setMimeType(ContentService.MimeType.JSON);
      }
      return ContentService.createTextOutput(JSON.stringify({ status: 'WAIT' })).setMimeType(ContentService.MimeType.JSON);
    }

    if (req.action === 'getConfig') {
      return ContentService.createTextOutput(JSON.stringify({
        clientId: props.getProperty('ML_CLIENT_ID')
      })).setMimeType(ContentService.MimeType.JSON);
    }

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

    // Sincronização passiva: grava o regime tributário no Diretório Central
    if (req.spreadsheetId && req.config && req.config.regimeTributario) {
      _atualizarRegimeTenant(req.spreadsheetId, req.config.regimeTributario);
    }

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

function _atualizarRegimeTenant(spreadsheetId, regime) {
  var props   = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('CENTRAL_DIR_SHEET_ID');
  if (!sheetId || !regime) return;

  try {
    var ss    = SpreadsheetApp.openById(sheetId);
    var sheet = ss.getSheetByName('CLIENTES');
    if (!sheet) return;

    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return;

    var dadosG = sheet.getRange(2, 7, lastRow - 1, 1).getValues();
    for (var i = 0; i < dadosG.length; i++) {
      if (String(dadosG[i][0]) === String(spreadsheetId)) {
        sheet.getRange(i + 2, 10).setValue(regime);
        break;
      }
    }
  } catch (err) {
    Logger.log('_atualizarRegimeTenant: ' + err.message);
  }
}

function _registrarTenant(spreadsheetId, mlId, mlNickname) {
  try {
    var props      = PropertiesService.getScriptProperties();
    var dirSheetId = props.getProperty('CENTRAL_DIR_SHEET_ID');
    if (!dirSheetId) return;

    var ss  = SpreadsheetApp.openById(dirSheetId);
    var aba = ss.getSheetByName('CLIENTES');
    if (!aba) return;

    var ultimaLinha     = aba.getLastRow();
    var linhaEncontrada = -1;

    if (ultimaLinha >= 2) {
      var dados = aba.getRange(2, 1, ultimaLinha - 1, 11).getValues();
      for (var i = 0; i < dados.length; i++) {
        if (String(dados[i][6]).trim() === String(spreadsheetId).trim()) {
          linhaEncontrada = i + 2; // +2: offset cabeçalho (linha 1) + base 1 do getRange
          break;
        }
      }
    }

    if (linhaEncontrada > 0) {
      // UPDATE: atualiza ML ID (col C=3), Nickname (col D=4) e Status (col I=9)
      aba.getRange(linhaEncontrada, 3).setValue(String(mlId));
      aba.getRange(linhaEncontrada, 4).setValue(mlNickname);
      aba.getRange(linhaEncontrada, 9).setValue('Ativo');
    } else {
      // INSERT: calcula próximo SELLER_ID_360
      var maiorId = 0;
      if (ultimaLinha >= 2) {
        var colB = aba.getRange(2, 2, ultimaLinha - 1, 1).getValues();
        for (var j = 0; j < colB.length; j++) {
          var num = parseInt(String(colB[j][0]).replace(/\D/g, ''), 10);
          if (!isNaN(num) && num > maiorId) maiorId = num;
        }
      }
      var novoId    = String(maiorId + 1).padStart(6, '0');
      var novaLinha = ultimaLinha + 1;
      var agora     = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss');

      aba.getRange(novaLinha, 2).setNumberFormat('@'); // força texto puro para preservar zeros à esquerda
      aba.getRange(novaLinha, 1, 1, 11).setValues([[
        agora,
        novoId,
        String(mlId),
        mlNickname,
        '',
        '',
        spreadsheetId,
        'https://docs.google.com/spreadsheets/d/' + spreadsheetId,
        'Ativo',
        '',
        'V2.1'
      ]]);
    }
  } catch (err) {
    Logger.log('_registrarTenant falhou: ' + err.message);
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
