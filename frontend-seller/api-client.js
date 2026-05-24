const COFRE_API_URL = "https://script.google.com/macros/s/AKfycbx4jdB_pz1b6sm6qei90SrcTHMgV3rPguphsw_OSrsZqz6FD2T83XSCPapNiywR35QnIQ/exec";

function acionarMotorMLB() { _orquestrarMotor("MLB"); }
function acionarMotorSHP() { _orquestrarMotor("SHP"); }

function solicitarVinculoML() {
  var ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var uuid = Utilities.getUuid();

  // Registra o par uuid → spreadsheetId no backend para validação CSRF
  UrlFetchApp.fetch(COFRE_API_URL, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ action: 'registerCsrfState', uuid: uuid, spreadsheetId: ssId }),
    muteHttpExceptions: true
  });

  // Busca o clientId do backend (fonte única de verdade — ScriptProperties)
  var configRes = UrlFetchApp.fetch(COFRE_API_URL, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ action: 'getConfig' }),
    muteHttpExceptions: true
  });
  var clientId    = JSON.parse(configRes.getContentText()).clientId;
  var redirectUri = encodeURIComponent(COFRE_API_URL);
  var url = 'https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=' + clientId + '&redirect_uri=' + redirectUri + '&state=' + uuid;

  var htmlContent =
    '<div style="font-family:sans-serif;text-align:center;padding:20px;">' +
    '<h3>Conexão 360 Gestão</h3>' +
    '<p>Autorize o acesso no Mercado Livre</p>' +
    '<a id="btnML" href="' + url + '" target="_blank" onclick="iniciarPolling()" ' +
      'style="background:#FFE600;color:#333;padding:10px 20px;text-decoration:none;border-radius:5px;font-weight:bold;display:inline-block;">' +
      'ABRIR MERCADO LIVRE' +
    '</a>' +
    '<p id="statusMsg" style="margin-top:20px;color:#888;">Aguardando ação...</p>' +
    '<script>' +
      'var _interval;' +
      'function iniciarPolling() {' +
        'document.getElementById("statusMsg").innerText = "🔄 Aguardando retorno do servidor...";' +
        'document.getElementById("btnML").style.pointerEvents = "none";' +
        'document.getElementById("btnML").style.opacity = "0.5";' +
        '_interval = setInterval(function() {' +
          'google.script.run.withSuccessHandler(function(res) {' +
            'if (res === "OK") {' +
              'clearInterval(_interval);' +
              'document.getElementById("statusMsg").innerHTML = "✅ <b>Conectado!</b> Fechando...";' +
              'setTimeout(function() { google.script.host.close(); }, 1500);' +
            '}' +
          '}).tentarCapturarToken();' +
        '}, 3000);' +
      '}' +
    '</script>' +
    '</div>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(htmlContent).setHeight(250),
    'Autorização'
  );
}

function tentarCapturarToken() {
  var ssId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var res  = UrlFetchApp.fetch(COFRE_API_URL, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ action: 'fetchToken', spreadsheetId: ssId }),
    muteHttpExceptions: true
  });
  var data = JSON.parse(res.getContentText());
  if (data.access_token) {
    PropertiesService.getUserProperties().deleteAllProperties();
    PropertiesService.getDocumentProperties().setProperties({
      access_token:      data.access_token,
      refresh_token:     data.refresh_token || '',
      seller_name:       data.nickname    || 'Vendedor',
      seller_reputation: data.reputacao   || '⚪ S/ Reputação'
    });
    return 'OK';
  }
  return 'WAIT';
}

function desconectarML() {
  var ui = SpreadsheetApp.getUi();
  var resposta = ui.alert('Desconectar Conta', 'Tem certeza que deseja desvincular a conta atual do Mercado Livre desta planilha?', ui.ButtonSet.YES_NO);
  if (resposta === ui.Button.YES) {
    var props = PropertiesService.getDocumentProperties();
    props.deleteProperty('access_token');
    props.deleteProperty('refresh_token');
    props.deleteProperty('seller_name');
    props.deleteProperty('seller_reputation');
    ui.alert('Conta Desconectada', 'Aperte F5 para atualizar a página e resetar o menu.', ui.ButtonSet.OK);
  }
}

function mostrarStatusConexao() {
  var nome = PropertiesService.getDocumentProperties().getProperty('seller_name');
  SpreadsheetApp.getUi().alert('Status Ativo', 'Operando as requisições sob a conta Mercado Livre: ' + nome, SpreadsheetApp.getUi().ButtonSet.OK);
}

function _orquestrarMotor(canal) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Valida configurações fiscais
  var configFiscal = carregarConfigFiscal();
  if (!configFiscal || Object.keys(configFiscal).length === 0 || !configFiscal.regimeTributario) {
    ui.alert('⚠️ Configuração Ausente', 'As configurações fiscais não foram definidas.\nAbra ⚙️ Configurações Fiscais no menu, preencha os dados e salve antes de recalcular.', ui.ButtonSet.OK);
    return;
  }

  // 2. Captura abas obrigatórias comuns
  var abaPro = ss.getSheetByName('TGFPRO');
  var abaKit = ss.getSheetByName('TGFKIT');
  if (!abaPro) { ui.alert('Erro', 'Aba TGFPRO não encontrada na planilha.', ui.ButtonSet.OK); return; }
  if (!abaKit) { ui.alert('Erro', 'Aba TGFKIT não encontrada na planilha.', ui.ButtonSet.OK); return; }

  // 3. Leitura condicional da aba de anúncios do canal
  var nomeAbaCanal = (canal === "MLB") ? "TGFMLB" : "TGFSHP";
  var abaCanal = ss.getSheetByName(nomeAbaCanal);
  if (!abaCanal) { ui.alert('Erro', 'Aba ' + nomeAbaCanal + ' não encontrada na planilha.', ui.ButtonSet.OK); return; }

  // 4. Monta o payload otimizado (apenas a aba do canal selecionado)
  var payload = {
    canalAlvo:     canal,
    config:        configFiscal,
    spreadsheetId: ss.getId(),
    dadosPro:      abaPro.getDataRange().getValues(),
    dadosKit:      abaKit.getDataRange().getValues(),
    dadosAnuncios: abaCanal.getDataRange().getValues()
  };

  // 5. Disparo HTTP POST para o Cofre
  var res = UrlFetchApp.fetch(COFRE_API_URL, {
    method:      'post',
    contentType: 'application/json',
    payload:     JSON.stringify(payload)
  });

  var resposta = JSON.parse(res.getContentText());

  if (!resposta.sucesso) {
    ui.alert('❌ Erro no Cofre', resposta.erro || 'Falha desconhecida na API.', ui.ButtonSet.OK);
    return;
  }

  // 6. Gravação da DRE na aba do canal (col J=10 para MLB, col I=9 para SHP)
  if (resposta.precoFinal && resposta.precoFinal.length > 0) {
    var colunaInicio = (canal === "MLB") ? 10 : 9;
    abaCanal.getRange(2, colunaInicio, resposta.precoFinal.length, 13).setValues(resposta.precoFinal);
  }

  // 7. Gravação na esteira NF-e isolada por canal (limpa sempre, grava se houver dados)
  var nomeAbaNfe = (canal === "MLB") ? "TGFNFE_MLB" : "TGFNFE_SHP";
  var abaNfe = ss.getSheetByName(nomeAbaNfe);
  if (abaNfe) {
    var ultimaNfe = abaNfe.getLastRow();
    if (ultimaNfe > 1) abaNfe.getRange(2, 1, ultimaNfe - 1, 8).clearContent();
    if (resposta.vuncom && resposta.vuncom.length > 0) {
      abaNfe.getRange(2, 1, resposta.vuncom.length, 8).setValues(resposta.vuncom);
    }
  }

  var nomeCanal = (canal === "MLB") ? "Mercado Livre" : "Shopee";
  ss.toast('✅ Precificação ' + nomeCanal + ' concluída. DRE atualizada.', '360 Gestão', 5);
}
