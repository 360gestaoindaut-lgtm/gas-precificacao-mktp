const COFRE_API_URL = "COLE_AQUI_A_URL_DO_WEBAPP";

function acionarMotorRemoto() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  // 1. Valida configurações fiscais
  var configFiscal = PropertiesService.getUserProperties().getProperties();
  if (!configFiscal || !configFiscal.regimeTributario) {
    ui.alert(
      '⚠️ Configuração Ausente',
      'As configurações fiscais não foram definidas.\nAbra ⚙️ Configurações Fiscais no menu, preencha os dados e salve antes de recalcular.',
      ui.ButtonSet.OK
    );
    return;
  }

  // 2. Captura as abas obrigatórias
  var abaPro  = ss.getSheetByName('TGFPRO');
  var abaKit  = ss.getSheetByName('TGFKIT');
  var abaAds  = ss.getSheetByName('TGFADS');

  if (!abaPro) { ui.alert('Erro', 'Aba TGFPRO não encontrada na planilha.', ui.ButtonSet.OK); return; }
  if (!abaKit) { ui.alert('Erro', 'Aba TGFKIT não encontrada na planilha.', ui.ButtonSet.OK); return; }
  if (!abaAds) { ui.alert('Erro', 'Aba TGFADS não encontrada na planilha.', ui.ButtonSet.OK); return; }

  // 3. Lê os dados em memória (batch read)
  var payload = {
    config:    configFiscal,
    dadosPro:  abaPro.getDataRange().getValues(),
    dadosKit:  abaKit.getDataRange().getValues(),
    dadosAds:  abaAds.getDataRange().getValues()
  };

  // 4. Disparo HTTP POST para o Cofre
  var res = UrlFetchApp.fetch(COFRE_API_URL, {
    method:      'post',
    contentType: 'application/json',
    payload:     JSON.stringify(payload)
  });

  // 5. Parse e validação da resposta
  var resposta = JSON.parse(res.getContentText());

  if (!resposta.sucesso) {
    ui.alert('❌ Erro no Cofre', resposta.erro || 'Falha desconhecida na API.', ui.ButtonSet.OK);
    return;
  }

  // 6. Gravação da DRE na TGFADS (coluna N = 14, a partir da linha 2)
  if (resposta.precoFinal && resposta.precoFinal.length > 0) {
    abaAds.getRange(2, 14, resposta.precoFinal.length, 13).setValues(resposta.precoFinal);
  }

  // 7. Gravação na TGF_VUNCOM (limpa e regrava)
  var abaVuncom = ss.getSheetByName('TGF_VUNCOM');
  if (abaVuncom) {
    var ultimaLinhaVuncom = abaVuncom.getLastRow();
    if (ultimaLinhaVuncom > 1) {
      abaVuncom.getRange(2, 1, ultimaLinhaVuncom - 1, 8).clearContent();
    }
    if (resposta.vuncom && resposta.vuncom.length > 0) {
      abaVuncom.getRange(2, 1, resposta.vuncom.length, 8).setValues(resposta.vuncom);
    }
  }

  ss.toast('✅ Precificação concluída com sucesso. DRE atualizada.', '360 Gestão', 5);
}
