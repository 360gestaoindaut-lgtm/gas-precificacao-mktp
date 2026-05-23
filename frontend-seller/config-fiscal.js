function abrirConfigFiscal() {
  var html = HtmlService.createHtmlOutputFromFile('sidebar-fiscal')
    .setTitle('Configurações Fiscais')
    .setWidth(300);
  SpreadsheetApp.getUi().showSidebar(html);
}

function salvarConfigFiscal(dados) {
  var mapa = {};
  for (var chave in dados) {
    if (dados.hasOwnProperty(chave)) {
      mapa[chave] = String(dados[chave]);
    }
  }
  PropertiesService.getUserProperties().setProperties(mapa, true);
  return '✅ Configurações salvas com sucesso!';
}

function carregarConfigFiscal() {
  var props = PropertiesService.getUserProperties().getProperties();
  if (!props || !props.regimeTributario) return null;
  return {
    regimeTributario: props.regimeTributario,
    alqPis:           parseFloat(props.alqPis)         || 0,
    alqCofins:        parseFloat(props.alqCofins)      || 0,
    irpj:             parseFloat(props.irpj)           || 0,
    csll:             parseFloat(props.csll)           || 0,
    cargaSnNormal:    parseFloat(props.cargaSnNormal)  || 0,
    cargaSnSt:        parseFloat(props.cargaSnSt)      || 0,
    tomarCredito:     props.tomarCredito               || 'Não',
    baseCredito:      props.baseCredito                || 'Nenhum'
  };
}

function debugVariaveisInvisiveis() {
  var memoria = PropertiesService.getUserProperties().getProperties();
  console.log("Banco de Dados do Usuário Ativo:");
  console.log(JSON.stringify(memoria, null, 2));
}