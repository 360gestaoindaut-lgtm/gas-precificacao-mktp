var ML_TOKEN_URL   = 'https://api.mercadolibre.com/oauth/token';
var ML_USUARIO_URL = 'https://api.mercadolibre.com/users/me';

function obterAccessTokenValido(spreadsheetId) {
  var props        = PropertiesService.getScriptProperties();
  var accessToken  = props.getProperty('ML_ACCESS_TOKEN_'  + spreadsheetId);
  var refreshToken = props.getProperty('ML_REFRESH_TOKEN_' + spreadsheetId);
  var expiresAt    = parseInt(props.getProperty('ML_EXPIRES_AT_' + spreadsheetId) || '0', 10);

  if (!accessToken && !refreshToken) return null;

  var agora = Math.floor(Date.now() / 1000);
  if (accessToken && agora < expiresAt - 300) return accessToken; // token ainda válido (margem 5min)

  if (!refreshToken) return accessToken; // sem refresh disponível, tenta com o que há

  var clientId     = props.getProperty('ML_CLIENT_ID');
  var clientSecret = props.getProperty('ML_CLIENT_SECRET');

  var res = UrlFetchApp.fetch(ML_TOKEN_URL, {
    method:             'post',
    payload: {
      grant_type:    'refresh_token',
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    },
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) return accessToken; // falha no refresh, usa token atual

  var dados = JSON.parse(res.getContentText());
  if (!dados.access_token) return accessToken;

  agora = Math.floor(Date.now() / 1000);
  props.setProperty('ML_ACCESS_TOKEN_'  + spreadsheetId, dados.access_token);
  props.setProperty('ML_REFRESH_TOKEN_' + spreadsheetId, dados.refresh_token || refreshToken);
  props.setProperty('ML_EXPIRES_AT_'    + spreadsheetId, String(agora + (dados.expires_in || 21600)));

  return dados.access_token;
}

function buscarReputacaoMercadoLivre(accessToken) {
  var options  = { headers: { Authorization: 'Bearer ' + accessToken }, muteHttpExceptions: true };
  var response = UrlFetchApp.fetch(ML_USUARIO_URL, options);
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

// Utilitário de manutenção: limpa todos os tokens e estados OAuth sem tocar nas credenciais.
// Execute manualmente pelo editor GAS em caso de estado corrompido ou expirado.
function resetarConexaoML() {
  var props     = PropertiesService.getScriptProperties();
  var todas     = props.getProperties();
  var removidas = [];

  var prefixosRemover = ['oauth2.', 'ML_ACCESS_TOKEN_', 'ML_REFRESH_TOKEN_', 'ML_EXPIRES_AT_', 'CSRF_', 'TEMP_TOKEN_', 'STATE_MAP_'];

  for (var chave in todas) {
    for (var i = 0; i < prefixosRemover.length; i++) {
      if (chave.indexOf(prefixosRemover[i]) === 0) {
        props.deleteProperty(chave);
        removidas.push(chave);
        break;
      }
    }
  }

  Logger.log(removidas.length > 0
    ? 'Resetadas ' + removidas.length + ' chave(s): ' + removidas.join(', ')
    : 'Nenhuma chave de sessão encontrada. Nada foi removido.');
}
