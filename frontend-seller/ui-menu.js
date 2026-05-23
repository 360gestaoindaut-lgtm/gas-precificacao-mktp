/**
 * FRONT-END: INTEGRAÇÃO 360 GESTÃO IND & AUT
 * Responsabilidade: Desenhar a interface do usuário (Menu).
 * A execução do motor é delegada para api-client.js via UrlFetchApp.
 */

function onOpen(e) {
  var ui         = SpreadsheetApp.getUi();
  var menu       = ui.createMenu('360 Gestão');
  var nomeSeller = PropertiesService.getUserProperties().getProperty('seller_name');

  if (nomeSeller) {
    menu.addItem('✅ Logado: ' + nomeSeller, 'mostrarStatusConexao')
        .addItem('❌ Desconectar Conta', 'desconectarML');
  } else {
    menu.addItem('🔗 Conectar Mercado Livre', 'solicitarVinculoML');
  }

  menu.addSeparator()
      .addItem('⚡ Recalcular Preços - Mercado Livre', 'acionarMotorMLB')
      .addItem('⚡ Recalcular Preços - Shopee', 'acionarMotorSHP')
      .addSeparator()
      .addItem('⚙️ Configurações Fiscais', 'abrirConfigFiscal')
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

