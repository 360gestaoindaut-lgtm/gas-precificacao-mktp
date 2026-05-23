function getMercadoLivreService(spreadsheetId) {
  return OAuth2.createService('ML_' + spreadsheetId)
    .setAuthorizationBaseUrl('https://auth.mercadolivre.com.br/authorization')
    .setTokenUrl('https://api.mercadolibre.com/oauth/token')
    .setClientId(PropertiesService.getScriptProperties().getProperty('ML_CLIENT_ID'))
    .setClientSecret(PropertiesService.getScriptProperties().getProperty('ML_CLIENT_SECRET'))
    .setCallbackFunction('authCallback')
    .setPropertyStore(PropertiesService.getScriptProperties())
    .setParam('response_type', 'code');
}

function obterUrlAutorizacao(spreadsheetId) {
  return getMercadoLivreService(spreadsheetId).getAuthorizationUrl();
}

function authCallback(request) {
  var serviceName   = OAuth2.getServiceName(request);          // ex: 'ML_1BxQz...'
  var spreadsheetId = serviceName.substring('ML_'.length);
  var service       = getMercadoLivreService(spreadsheetId);
  var authorized    = service.handleCallback(request);

  if (authorized) {
    return HtmlService.createHtmlOutput(
      '<h1 style="font-family:sans-serif; color:#2E7D32;">Conexão Concluída!</h1>' +
      '<p style="font-family:sans-serif;">A 360 Gestão autenticou sua conta. Pode fechar esta aba e retornar à planilha.</p>'
    );
  } else {
    return HtmlService.createHtmlOutput(
      '<h1 style="font-family:sans-serif; color:#D32F2F;">Acesso Negado</h1>' +
      '<p style="font-family:sans-serif;">Falha na autorização do Mercado Livre.</p>'
    );
  }
}

function obterAccessTokenValido(spreadsheetId) {
  var service = getMercadoLivreService(spreadsheetId);
  if (service.hasAccess()) {
    return service.getAccessToken();
  }
  return null;
}

function buscarReputacaoMercadoLivre(accessToken) {
  var options  = { headers: { Authorization: 'Bearer ' + accessToken }, muteHttpExceptions: true };
  var response = UrlFetchApp.fetch('https://api.mercadolibre.com/users/me', options);
  if (response.getResponseCode() === 200) {
    var data = JSON.parse(response.getContentText());
    return normalizarReputacao(data.seller_reputation.level_id, data.seller_reputation.power_seller_status);
  }
  return 'Sem Reputação';
}

function normalizarReputacao(levelId, powerStatus) {
  if (levelId === '5_green' || levelId === '4_light_green' || powerStatus) return 'Verde';
  if (levelId === '3_yellow') return 'Amarela';
  return 'Sem Reputação';
}

// Utilitário de manutenção: limpa tokens de sessão OAuth2 sem tocar nas credenciais.
// Execute manualmente pelo editor GAS em caso de estado corrompido ou expirado.
function resetarConexaoML() {
  var props    = PropertiesService.getScriptProperties();
  var todas    = props.getProperties();
  var removidas = [];

  for (var chave in todas) {
    var ehEstadoOAuth  = chave.indexOf('oauth2.') === 0;
    var ehTokenSessao  = chave.indexOf('ML_ACCESS_TOKEN_') === 0 || chave.indexOf('ML_REFRESH_TOKEN_') === 0;
    if (ehEstadoOAuth || ehTokenSessao) {
      props.deleteProperty(chave);
      removidas.push(chave);
    }
  }

  Logger.log(removidas.length > 0
    ? 'Resetadas ' + removidas.length + ' chave(s): ' + removidas.join(', ')
    : 'Nenhuma chave de sessão encontrada. Nada foi removido.');
}
