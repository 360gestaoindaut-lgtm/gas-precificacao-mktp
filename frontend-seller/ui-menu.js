/**
 * FRONT-END: INTEGRAÇÃO 360 GESTÃO IND & AUT
 * Responsabilidade: Desenhar a interface do usuário (Menu).
 * A execução do motor é delegada para api-client.js via UrlFetchApp.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('360 Gestão')
    .addItem('⚡ Recalcular Preços', 'acionarMotorRemoto')
    .addItem('⚙️ Configurações Fiscais', 'abrirConfigFiscal')
    .addSeparator()
    .addItem('ℹ️ Sobre o Motor', 'exibirSobre')
    .addToUi();
}

function exibirSobre() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    'Motor de Precificação Dinâmica',
    'Versão 2.1 (SaaS Edition)\nArquitetura Fiscal Top-Down com Deflação de IPI e Tese do Século.\nDesenvolvido pela 360 Gestão Ind & Aut.',
    ui.ButtonSet.OK
  );
}

