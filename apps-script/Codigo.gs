// chesstable — serviço do Google que faz duas coisas para o jogo:
//   1. envia o e-mail de confirmação de conta pelo Gmail desta conta;
//   2. guarda as contas e ratings (banco persistente, grátis) nas propriedades
//      do próprio script, divididas em pedaços para caber no limite do Google.
// As ações de banco exigem a chave DB_KEY configurada no Render.

var BASE = 'https://chesstable.onrender.com/confirmar?t=';
var PEDACO = 8000;   // limite por propriedade é 9 KB

function props() { return PropertiesService.getScriptProperties(); }

// A chave é definida na primeira vez que o jogo chama o script: o valor enviado
// (o DB_KEY configurado no Render) fica guardado e vira a senha dessas ações.
function conferirChave(enviada) {
  enviada = String(enviada || '');
  if (enviada.length < 12) return false;
  var p = props(), atual = p.getProperty('CHAVE');
  if (!atual) { p.setProperty('CHAVE', enviada); return true; }
  return enviada === atual;
}

function lerDados() {
  var p = props(), n = Number(p.getProperty('N') || 0);
  if (!n) return null;
  var s = '';
  for (var i = 0; i < n; i++) s += (p.getProperty('D' + i) || '');
  try { return JSON.parse(s); } catch (e) { return null; }
}

function gravarDados(obj) {
  var s = JSON.stringify(obj), p = props();
  var n = Math.ceil(s.length / PEDACO), novos = { N: String(n) };
  for (var i = 0; i < n; i++) novos['D' + i] = s.substr(i * PEDACO, PEDACO);
  var antigo = Number(p.getProperty('N') || 0);
  p.setProperties(novos, false);
  for (var j = n; j < antigo; j++) p.deleteProperty('D' + j);
  return n;
}

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);

    if (d.acao === 'ler' || d.acao === 'gravar') {
      if (!conferirChave(d.chave)) return resposta({ ok: false, erro: 'chave invalida' });
      var lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try {
        if (d.acao === 'ler') return resposta({ ok: true, dados: lerDados() });
        var pedacos = gravarDados(d.dados || {});
        return resposta({ ok: true, pedacos: pedacos });
      } finally { lock.releaseLock(); }
    }

    // envio do e-mail de confirmação (texto fixo, só com links do chesstable)
    var to = String(d.to || '');
    var nome = String(d.nome || '');
    var link = String(d.link || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw 'e-mail invalido';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nome)) throw 'nome invalido';
    if (link.indexOf(BASE) !== 0 || !/^[0-9a-f]{48}$/.test(link.slice(BASE.length))) throw 'link invalido';
    MailApp.sendEmail({
      to: to,
      name: 'chesstable',
      subject: 'chesstable — confirme sua conta',
      body: 'Olá, ' + nome + '!\n\nClique no link para confirmar sua conta no chesstable:\n' + link +
            '\n\nSe você não criou esta conta, ignore este e-mail.'
    });
    return resposta({ ok: true });
  } catch (err) {
    return resposta({ ok: false, erro: String(err) });
  }
}

function doGet() {
  return resposta({ ok: false, erro: 'use POST', cotaRestante: MailApp.getRemainingDailyQuota() });
}

function resposta(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
