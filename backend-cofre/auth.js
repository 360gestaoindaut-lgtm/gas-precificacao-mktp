var ML_AUTH_URL    = 'https://auth.mercadolibre.com.br/authorization';
var ML_TOKEN_URL   = 'https://api.mercadolibre.com/oauth/token';
var ML_USUARIO_URL = 'https://api.mercadolibre.com/users/me';

function obterUrlAutorizacao(spreadsheetId) {
  var props       = PropertiesService.getScriptProperties();
  var clientId    = props.getProperty('ML_CLIENT_ID');
  var redirectUri = ScriptApp.getService().getUrl();

  return ML_AUTH_URL
    + '?response_type=code'
    + '&client_id='    + encodeURIComponent(clientId)
    + '&redirect_uri=' + encodeURIComponent(redirectUri)
    + '&state='        + encodeURIComponent(spreadsheetId);
}

function procederTrocaDeToken(code, spreadsheetId) {
  var props        = PropertiesService.getScriptProperties();
  var clientId     = props.getProperty('ML_CLIENT_ID');
  var clientSecret = props.getProperty('ML_CLIENT_SECRET');
  var redirectUri  = ScriptApp.getService().getUrl();

  var res = UrlFetchApp.fetch(ML_TOKEN_URL, {
    method:             'post',
    contentType:        'application/x-www-form-urlencoded',
    payload: {
      grant_type:    'authorization_code',
      client_id:     clientId,
      client_secret: clientSecret,
      code:          code,
      redirect_uri:  redirectUri
    },
    muteHttpExceptions: true
  });

  var dados = JSON.parse(res.getContentText());
  if (!dados.access_token) throw new Error('Falha na troca de token: ' + JSON.stringify(dados));

  props.setProperty('ML_ACCESS_TOKEN_'  + spreadsheetId, dados.access_token);
  props.setProperty('ML_REFRESH_TOKEN_' + spreadsheetId, dados.refresh_token);
}

function obterAccessTokenValido(spreadsheetId) {
  var props        = PropertiesService.getScriptProperties();
  var refreshToken = props.getProperty('ML_REFRESH_TOKEN_' + spreadsheetId);
  if (!refreshToken) return null;

  var clientId     = props.getProperty('ML_CLIENT_ID');
  var clientSecret = props.getProperty('ML_CLIENT_SECRET');

  var res = UrlFetchApp.fetch(ML_TOKEN_URL, {
    method:             'post',
    contentType:        'application/x-www-form-urlencoded',
    payload: {
      grant_type:    'refresh_token',
      client_id:     clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken
    },
    muteHttpExceptions: true
  });

  var dados = JSON.parse(res.getContentText());
  if (!dados.access_token) return null;

  props.setProperty('ML_ACCESS_TOKEN_'  + spreadsheetId, dados.access_token);
  props.setProperty('ML_REFRESH_TOKEN_' + spreadsheetId, dados.refresh_token);
  return dados.access_token;
}

function buscarReputacaoMercadoLivre(accessToken) {
  var res  = UrlFetchApp.fetch(ML_USUARIO_URL, {
    headers:            { 'Authorization': 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  var user = JSON.parse(res.getContentText());
  var rep  = user.seller_reputation || {};
  return {
    levelId:     rep.level_id            || null,
    powerStatus: rep.power_seller_status || null
  };
}

function normalizarReputacao(levelId, powerStatus) {
  if (levelId === '5_green' || levelId === '4_light_green') return 'Verde';
  if (levelId === '3_yellow') return 'Amarela';
  return 'Sem Reputação';
}
