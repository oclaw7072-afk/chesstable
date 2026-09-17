// ChessTable — envia o e-mail de confirmação de conta pelo Gmail desta conta.
// Só envia o texto fixo abaixo, e só com links de confirmação do ChessTable.
var BASE = 'https://chesstable.onrender.com/confirmar?t=';

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var to = String(d.to || '');
    var nome = String(d.nome || '');
    var link = String(d.link || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw 'e-mail invalido';
    if (!/^[A-Za-z0-9_]{3,16}$/.test(nome)) throw 'nome invalido';
    if (link.indexOf(BASE) !== 0 || !/^[0-9a-f]{48}$/.test(link.slice(BASE.length))) throw 'link invalido';
    MailApp.sendEmail({
      to: to,
      name: 'ChessTable',
      subject: 'ChessTable — confirme sua conta',
      body: 'Olá, ' + nome + '!\n\nClique no link para confirmar sua conta no ChessTable:\n' + link +
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
