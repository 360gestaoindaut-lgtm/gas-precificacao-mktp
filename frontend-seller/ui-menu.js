/**
 * FRONT-END: INTEGRAÇÃO 360 GESTÃO IND & AUT
 * Responsabilidade: Desenhar a interface do usuário (Menu).
 * A execução do motor é delegada para api-client.js via UrlFetchApp.
 */

var MASTER_SPREADSHEET_ID = '14DYerTQtDI64C6B17IXB7G1RBnfKrwwPGveibLTUWb4';

function onOpen(e) {
  var ui   = SpreadsheetApp.getUi();
  var menu = ui.createMenu('360 Gestão');

  var nomeSeller = null;
  var repSeller  = null;
  try {
    var docProps = PropertiesService.getDocumentProperties();
    nomeSeller   = docProps.getProperty('seller_name');
    repSeller    = docProps.getProperty('seller_reputation') || '';
  } catch (err) {
    nomeSeller = null;
  }

  if (nomeSeller) {
    var tituloMenu = '✅ ' + nomeSeller + (repSeller ? ' [' + repSeller + ']' : '');
    menu.addItem(tituloMenu, 'mostrarStatusConexao')
        .addItem('❌ Desconectar Conta', 'desconectarML');
  } else {
    menu.addItem('🔗 Conectar Mercado Livre', 'solicitarVinculoML');
  }

  menu.addSeparator()
      .addItem('⚡ Recalcular Preços - Mercado Livre', 'acionarMotorMLB')
      .addItem('⚡ Recalcular Preços - Shopee', 'acionarMotorSHP')
      .addSeparator()
      .addItem('⚙️ Configurações Fiscais', 'abrirConfigFiscal')
      .addItem('ℹ️ Sobre o Motor', 'exibirSobre');

  if (SpreadsheetApp.getActiveSpreadsheet().getId() === MASTER_SPREADSHEET_ID) {
    var subMenuDev = ui.createMenu('🧪 Sandbox de Homologação');
    subMenuDev.addItem('Simular Conta: 🏆 Líder Gold',     'simularLiderGold')
              .addItem('Simular Conta: 💎 Líder Platinum',  'simularLiderPlatinum')
              .addItem('Simular Conta: 🟢 Verde',           'simularVerde')
              .addItem('Simular Conta: 🟢 Verde Claro',     'simularVerdeClaro')
              .addItem('Simular Conta: 🟡 Amarela',         'simularAmarela')
              .addItem('Simular Conta: 🟠 Laranja',         'simularLaranja')
              .addItem('Simular Conta: 🔴 Vermelha',        'simularVermelha')
              .addItem('Simular Conta: ⚪ Cinza',           'simularCinza');
    menu.addSeparator().addSubMenu(subMenuDev);
  }

  menu.addToUi();
}

function exibirSobre() {
  var ui = SpreadsheetApp.getUi();
  ui.alert(
    'Motor de Precificação Dinâmica',
    'Versão 2.1 (SaaS Edition)\nArquitetura Fiscal Top-Down com Deflação de IPI e Tese do Século.\nDesenvolvido pela 360 Gestão Ind & Aut.',
    ui.ButtonSet.OK
  );
}

