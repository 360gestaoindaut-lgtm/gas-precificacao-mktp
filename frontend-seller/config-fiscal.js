function abrirConfigFiscal() {
  var html = HtmlService.createHtmlOutputFromFile('sidebar-fiscal')
    .setTitle('Configurações Fiscais')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function salvarConfigFiscal(dados) {
  PropertiesService.getDocumentProperties().setProperty('CONFIG_FISCAL_360', JSON.stringify(dados));
  return '✅ Configurações salvas com sucesso!';
}

function carregarConfigFiscal() {
  var jsonString = PropertiesService.getDocumentProperties().getProperty('CONFIG_FISCAL_360');
  return jsonString ? JSON.parse(jsonString) : {};
}

function debugVariaveisInvisiveis() {
  var memoria = PropertiesService.getUserProperties().getProperties();
  console.log("Banco de Dados do Usuário Ativo:");
  console.log(JSON.stringify(memoria, null, 2));
}