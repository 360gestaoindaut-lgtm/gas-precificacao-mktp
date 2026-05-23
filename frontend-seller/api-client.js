const COFRE_API_URL = "https://script.google.com/macros/s/AKfycbx4jdB_pz1b6sm6qei90SrcTHMgV3rPguphsw_OSrsZqz6FD2T83XSCPapNiywR35QnIQ/exec";

function acionarMotorMLB() { _orquestrarMotor("MLB"); }
function acionarMotorSHP() { _orquestrarMotor("SHP"); }

function _orquestrarMotor(canal) {
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
