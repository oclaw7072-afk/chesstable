/* ============================================================
   Xadrez com Cartas — Motor (lógica pura, sem DOM)
   Peça:  {t:'P'|'N'|'B'|'R'|'Q'|'K', c:'w'|'b',
           st?:{N,B,R,Q},  // estilos (movimentos extras permanentes)
           sh?:1,          // bispo atirador
           bm?:1,          // torre bomba
           ar?:1}          // armadura de espinhos
   Pedra: {t:'X'}   Minas: state.mines = [{at:[r,c], c}]
   Tabuleiro: board[linha][coluna], linha 0 = 8ª fileira (pretas)
   ============================================================ */
"use strict";

const PIECE_PT = { P: "Peão", N: "Cavalo", B: "Bispo", R: "Torre", Q: "Dama", K: "Rei" };

const CARD_INFO = {
  estiloN:    { nome: "Estilo Cavalo",     icone: "♞",  desc: "A peça escolhida ganha, para sempre, o movimento de cavalo além do seu próprio. Não vale para o rei.", hint: "Escolha a peça que vai ganhar o movimento de cavalo." },
  estiloB:    { nome: "Estilo Bispo",      icone: "♝",  desc: "A peça escolhida ganha, para sempre, o movimento de bispo além do seu próprio. Não vale para o rei.", hint: "Escolha a peça que vai ganhar o movimento de bispo." },
  estiloR:    { nome: "Estilo Torre",      icone: "♜",  desc: "A peça escolhida ganha, para sempre, o movimento de torre além do seu próprio. Não vale para o rei.", hint: "Escolha a peça que vai ganhar o movimento de torre." },
  estiloQ:    { nome: "Estilo Dama",       icone: "♛",  desc: "A peça escolhida ganha, para sempre, o movimento de dama além do seu próprio. Não vale para o rei.", hint: "Escolha a peça que vai ganhar o movimento de dama." },
  invocarN:   { nome: "Invocar Cavalo",    icone: "✨", desc: "Invoca um cavalo numa casa vazia da sua primeira fileira.", hint: "Escolha uma casa vazia da sua primeira fileira." },
  invocarB:   { nome: "Invocar Bispo",     icone: "✨", desc: "Invoca um bispo numa casa vazia da sua primeira fileira.", hint: "Escolha uma casa vazia da sua primeira fileira." },
  invocarR:   { nome: "Invocar Torre",     icone: "✨", desc: "Invoca uma torre numa casa vazia da sua primeira fileira.", hint: "Escolha uma casa vazia da sua primeira fileira." },
  invocarQ:   { nome: "Invocar Dama",      icone: "✨", desc: "Invoca uma dama numa casa vazia da sua primeira fileira.", hint: "Escolha uma casa vazia da sua primeira fileira." },
  rock:       { nome: "Pedra Ancestral",   icone: "🪨", desc: "Coloca uma pedra permanente numa casa vazia. Ninguém pode ocupá-la ou atravessá-la.", hint: "Escolha (ou arraste até) uma casa vazia para a pedra." },
  sniper:     { nome: "Golpe à Distância", icone: "🏹", desc: "Captura uma peça inimiga que esteja no raio de ataque de uma peça sua, sem mover ninguém. (Contra armadura, quebra só a armadura.)", hint: "Escolha a peça inimiga para capturar à distância." },
  mudanca:    { nome: "Mudança de Time",   icone: "🔄", desc: "Uma peça inimiga no raio de ataque das suas peças troca de lado e passa a ser sua. Não vale para o rei.", hint: "Escolha a peça inimiga que vai trocar de time." },
  sacrificio: { nome: "Sacrifício",        icone: "💀", desc: "Sacrifica (remove do jogo) uma peça sua à sua escolha. O rei não pode ser sacrificado.", hint: "Escolha a peça sua que será sacrificada." },
  atirador:   { nome: "Bispo Atirador",    icone: "🎯", desc: "Um bispo seu passa a capturar à distância: elimina o alvo sem sair do lugar. (Contra armadura, quebra só a armadura.)", hint: "Escolha o bispo que vai virar atirador." },
  bomba:      { nome: "Torre Bomba",       icone: "💣", desc: "Uma torre sua vira bomba: quando capturar — ou FOR capturada — explode tudo em volta, e a explosão PODE matar reis! Ninguém pode causar essa explosão com o próprio rei no raio. Se ela puder capturar algo ao lado do rei inimigo, é xeque!", hint: "Escolha a torre que vai virar bomba." },
  seguro:     { nome: "Seguro do Rei",     icone: "🛟", desc: "Teletransporta o seu rei para qualquer casa vazia do tabuleiro.", hint: "Escolha a casa para onde o rei vai se teletransportar." },
  mina:       { nome: "Mina Terrestre",    icone: "💥", desc: "Mina visível numa casa vazia: quem parar sobre ela explode com os vizinhos — e ela PODE explodir reis! Ninguém detona uma mina com o próprio rei no raio; rei no alcance de mina detonável pelo inimigo está em xeque.", hint: "Escolha uma casa vazia para a mina." },
  armadura:   { nome: "Armadura de Espinhos", icone: "🛡️", desc: "A peça escolhida não pode ser capturada: quem tentar capturá-la é destruído e a armadura quebra. Golpe à Distância e Bispo Atirador quebram só a armadura — e uma Torre Bomba morta nos espinhos ainda explode! Não vale para o rei.", hint: "Escolha a peça que vai receber a armadura." }
};
const CARD_KEYS = Object.keys(CARD_INFO);

// Custos em moedas — base: Invocar Cavalo = 27 (≈ 9 moedas por "peão" de valor material).
// Estilos custam menos que invocar (aprimoram uma peça que já pode ser perdida);
// cartas de captura/roubo valem pelo alvo que podem pegar.
const CARD_COST = {
  estiloN: 22,  estiloB: 22,  estiloR: 36,  estiloQ: 63,
  invocarN: 27, invocarB: 27, invocarR: 45, invocarQ: 81,
  rock: 15,     sniper: 45,   mudanca: 60,  sacrificio: 5,
  atirador: 40, bomba: 35,    seguro: 30,   mina: 20,
  armadura: 25
};
const STYLE_OF = { estiloN: "N", estiloB: "B", estiloR: "R", estiloQ: "Q" };
const SUMMON_OF = { invocarN: "N", invocarB: "B", invocarR: "R", invocarQ: "Q" };

const KNIGHT_D = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const KING_D   = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
const ROOK_D   = [[-1,0],[1,0],[0,-1],[0,1]];
const BISHOP_D = [[-1,-1],[-1,1],[1,-1],[1,1]];

// variant: "padrao" (3 cartas sorteadas p/ cada jogador, sem repetição entre os dois,
// 50 moedas iniciais) ou "treino" (todas as cartas, moedas infinitas)
function initialState(variant) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  const back = ["R","N","B","Q","K","B","N","R"];
  for (let c = 0; c < 8; c++) {
    board[0][c] = { t: back[c], c: "b" };
    board[1][c] = { t: "P", c: "b" };
    board[6][c] = { t: "P", c: "w" };
    board[7][c] = { t: back[c], c: "w" };
  }
  const isTreino = variant === "treino";
  const cardsW = {}, cardsB = {};
  let drawPile = [];
  if (isTreino) {
    for (const k of CARD_KEYS) { cardsW[k] = 1; cardsB[k] = 1; }
  } else {
    const deck = CARD_KEYS.slice();
    for (let i = deck.length - 1; i > 0; i--) { // Fisher–Yates
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = deck[i]; deck[i] = deck[j]; deck[j] = tmp;
    }
    for (let i = 0; i < 3; i++) { cardsW[deck[i]] = 1; cardsB[deck[3 + i]] = 1; }
    drawPile = deck.slice(6); // as 11 restantes formam o monte de compra
  }
  return {
    board,
    turn: "w",
    castling: { w: { k: true, q: true }, b: { k: true, q: true } },
    ep: null,
    cards: { w: cardsW, b: cardsB },
    deck: drawPile,
    coins: { w: 50, b: 50 },
    variant: isTreino ? "treino" : "padrao",
    mines: [],
    fx: [],                          // casas que explodiram na última ação (para animação)
    kingBlast: [],                   // reis apanhados no raio de uma detonação de mina
    over: null,
    lastAction: null,
    moveNum: 1,
    log: []
  };
}

function cloneState(s) {
  return {
    board: s.board.map(row => row.map(p => (p ? Object.assign({}, p, p.st ? { st: Object.assign({}, p.st) } : null) : null))),
    turn: s.turn,
    castling: { w: { k: s.castling.w.k, q: s.castling.w.q }, b: { k: s.castling.b.k, q: s.castling.b.q } },
    ep: s.ep ? s.ep.slice() : null,
    cards: { w: Object.assign({}, s.cards.w), b: Object.assign({}, s.cards.b) },
    deck: s.deck.slice(),
    coins: { w: s.coins.w, b: s.coins.b },
    variant: s.variant,
    mines: s.mines.map(m => ({ at: m.at.slice(), c: m.c })),
    fx: [],
    kingBlast: [],
    over: s.over,
    lastAction: s.lastAction,
    moveNum: s.moveNum,
    log: s.log // sims não mexem no log
  };
}

const inB = (r, c) => r >= 0 && r <= 7 && c >= 0 && c <= 7;
const isRock = (p) => !!p && p.t === "X";
const isPiece = (p) => !!p && p.t !== "X";
const enemy = (col) => (col === "w" ? "b" : "w");
const homeRow = (col) => (col === "w" ? 7 : 0);

function findKing(s, col) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c];
    if (p && p.t === "K" && p.c === col) return [r, c];
  }
  return null;
}
function mineIdx(s, r, c) {
  return s.mines.findIndex(m => m.at[0] === r && m.at[1] === c);
}

function clearPath(s, r, c, tr, tc) {
  const dr = Math.sign(tr - r), dc = Math.sign(tc - c);
  let cr = r + dr, cc = c + dc;
  while (cr !== tr || cc !== tc) {
    if (s.board[cr][cc] || mineIdx(s, cr, cc) >= 0) return false; // peças, pedras e minas bloqueiam
    cr += dr; cc += dc;
  }
  return true;
}

function typeAttacks(s, r, c, color, t, tr, tc) {
  const dr = tr - r, dc = tc - c;
  const adr = Math.abs(dr), adc = Math.abs(dc);
  if (dr === 0 && dc === 0) return false;
  switch (t) {
    case "P": return dr === (color === "w" ? -1 : 1) && adc === 1;
    case "N": return (adr === 1 && adc === 2) || (adr === 2 && adc === 1);
    case "K": return Math.max(adr, adc) === 1;
    case "B": return adr === adc && clearPath(s, r, c, tr, tc);
    case "R": return (dr === 0 || dc === 0) && clearPath(s, r, c, tr, tc);
    case "Q": return (dr === 0 || dc === 0 || adr === adc) && clearPath(s, r, c, tr, tc);
  }
  return false;
}

function canAttack(s, r, c, p, tr, tc) {
  if (typeAttacks(s, r, c, p.c, p.t, tr, tc)) return true;
  if (p.st) for (const t in p.st) if (p.st[t] && t !== p.t && typeAttacks(s, r, c, p.c, t, tr, tc)) return true;
  return false;
}

function attacksSquare(s, col, tr, tc) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c];
    if (isPiece(p) && p.c === col && canAttack(s, r, c, p, tr, tc)) return true;
  }
  return false;
}

// Alguma peça de `col` pode PARAR na casa vazia (tr,tc)?
// (padrões de movimento puros, sem roque — usado para saber se uma mina pode ser detonada)
function canLandOn(s, col, tr, tc) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c];
    if (!isPiece(p) || p.c !== col) continue;
    const types = [p.t];
    if (p.st) for (const t in p.st) if (p.st[t] && t !== p.t) types.push(t);
    for (const t of types) {
      if (t === "P") {
        const dir = col === "w" ? -1 : 1;
        const startRow = col === "w" ? 6 : 1;
        if (c === tc) {
          if (tr - r === dir) return true;
          if (r === startRow && tr - r === 2 * dir && !s.board[r + dir][c] && mineIdx(s, r + dir, c) < 0) return true;
        } else if (s.ep && s.ep[0] === tr && s.ep[1] === tc && tr - r === dir && Math.abs(tc - c) === 1) {
          return true; // en passant terminando na mina
        }
      } else if (typeAttacks(s, r, c, col, t, tr, tc)) {
        return true; // casa vazia: "atacar" = poder pousar
      }
    }
  }
  return false;
}

// Ameaça de explosão:
// 1) mina no alcance do rei QUE uma peça inimiga possa detonar (pisando nela);
// 2) torre bomba inimiga que pode capturar uma peça numa casa vizinha do rei;
// 3) torre bomba do próprio lado, vizinha do rei, que o inimigo pode capturar
//    (a bomba explode ao ser capturada).
function blastThreat(s, col, k) {
  const opp = enemy(col);
  // o inimigo só pode causar uma explosão se ela não apanhar o REI DELE no raio
  const oppK = findKing(s, opp);
  const safeForOpp = (r, c) => !oppK || Math.abs(oppK[0] - r) > 1 || Math.abs(oppK[1] - c) > 1;
  for (const m of s.mines) {
    if (Math.abs(m.at[0] - k[0]) <= 1 && Math.abs(m.at[1] - k[1]) <= 1 &&
        safeForOpp(m.at[0], m.at[1]) &&
        canLandOn(s, opp, m.at[0], m.at[1])) return true;
  }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const xr = k[0] + dr, xc = k[1] + dc;
    if (!inB(xr, xc)) continue;
    const q = s.board[xr][xc];
    if (isPiece(q) && q.c === col && q.bm && !q.ar && safeForOpp(xr, xc) && attacksSquare(s, opp, xr, xc)) return true;
  }
  let hasBomba = false;
  for (let r = 0; r < 8 && !hasBomba; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c];
    if (isPiece(p) && p.c === opp && p.bm) { hasBomba = true; break; }
  }
  if (!hasBomba) return false;
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const xr = k[0] + dr, xc = k[1] + dc;
    if (!inB(xr, xc)) continue;
    const q = s.board[xr][xc];
    // armadura NÃO remove a ameaça: a bomba morre nos espinhos, mas explode mesmo assim
    if (!isPiece(q) || q.c !== col || q.t === "K") continue;
    if (!safeForOpp(xr, xc)) continue; // a captura explodiria o rei do próprio atacante — ilegal p/ ele
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = s.board[r][c];
      if (isPiece(p) && p.c === opp && p.bm && canAttack(s, r, c, p, xr, xc)) return true;
    }
  }
  return false;
}

function inCheck(s, col) {
  const k = findKing(s, col);
  if (!k) return false;
  if (attacksSquare(s, enemy(col), k[0], k[1])) return true;
  return blastThreat(s, col, k);
}

// Cada peça pode carregar no máximo UM efeito (estilo, atirador, bomba ou armadura)
function hasEffect(p) {
  if (p.sh || p.bm || p.ar) return true;
  if (p.st) for (const t in p.st) if (p.st[t]) return true;
  return false;
}

/* ---------- remoção de peças (direitos de roque) ---------- */
function pieceRemoved(s, r, c, p) {
  if (!p || p.t !== "R") return;
  const row = homeRow(p.c);
  if (r === row && c === 0) s.castling[p.c].q = false;
  if (r === row && c === 7) s.castling[p.c].k = false;
}

/* ---------- explosões ---------- */
// Explode a casa (cr,cc) e as 8 vizinhas. Pedras sobrevivem.
// Peças com armadura perdem só a armadura. Minas na área são destruídas.
// Explosões (mina E torre bomba) têm o poder de explodir REIS: reis no raio
// são registrados em s.kingBlast — uma jogada que deixe o PRÓPRIO rei no raio é ilegal
// (fisicamente o rei permanece no tabuleiro; a camada de legalidade impede o caso).
function explode(s, cr, cc) {
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    const r = cr + dr, c = cc + dc;
    if (!inB(r, c)) continue;
    s.fx.push([r, c]);
    const p = s.board[r][c];
    if (isPiece(p)) {
      if (p.t === "K") {
        if (s.kingBlast.indexOf(p.c) < 0) s.kingBlast.push(p.c);
        continue;
      }
      if (p.ar) { delete p.ar; continue; }
      pieceRemoved(s, r, c, p);
      s.board[r][c] = null;
    }
    const mi = mineIdx(s, r, c);
    if (mi >= 0) s.mines.splice(mi, 1);
  }
}

// Uma peça acabou de PARAR em (r,c): detona mina se houver.
// (o registro de reis no raio é feito dentro de explode())
function landingResolve(s, r, c) {
  const mi = mineIdx(s, r, c);
  if (mi < 0) return;
  s.mines.splice(mi, 1);
  explode(s, r, c);
}

/* ---------- geração de movimentos ---------- */
function movesAsType(s, r, c, p, t, out) {
  const seen = (tr, tc) => out.some(m => m.to[0] === tr && m.to[1] === tc);
  const okDest = (q) => !q || (isPiece(q) && q.c !== p.c && q.t !== "K");
  if (t === "N" || t === "K") {
    for (const [dr, dc] of (t === "N" ? KNIGHT_D : KING_D)) {
      const tr = r + dr, tc = c + dc;
      if (!inB(tr, tc) || seen(tr, tc)) continue;
      const q = s.board[tr][tc];
      if (!okDest(q)) continue;
      if (p.t === "K" && isPiece(q) && q.ar) continue; // rei não pode capturar armadura (morreria)
      out.push({ from: [r, c], to: [tr, tc] });
    }
    return;
  }
  const dirs = t === "R" ? ROOK_D : t === "B" ? BISHOP_D : ROOK_D.concat(BISHOP_D);
  for (const [dr, dc] of dirs) {
    let tr = r + dr, tc = c + dc;
    while (inB(tr, tc)) {
      const q = s.board[tr][tc];
      if (!q) {
        if (!seen(tr, tc)) out.push({ from: [r, c], to: [tr, tc] });
        if (mineIdx(s, tr, tc) >= 0) break; // pode PARAR na mina, mas não atravessá-la
      } else {
        if (isPiece(q) && q.c !== p.c && q.t !== "K" && !seen(tr, tc)) out.push({ from: [r, c], to: [tr, tc] });
        break;
      }
      tr += dr; tc += dc;
    }
  }
}

function pseudoMoves(s, r, c) {
  const p = s.board[r][c];
  if (!isPiece(p)) return [];
  const out = [];
  const push = (tr, tc, flags) => out.push(Object.assign({ from: [r, c], to: [tr, tc] }, flags || {}));

  if (p.t === "P") {
    const dir = p.c === "w" ? -1 : 1;
    const startRow = p.c === "w" ? 6 : 1;
    if (inB(r + dir, c) && !s.board[r + dir][c]) {
      push(r + dir, c);
      if (r === startRow && !s.board[r + 2 * dir][c] && mineIdx(s, r + dir, c) < 0) push(r + 2 * dir, c, { double: true });
    }
    for (const dc of [-1, 1]) {
      const tr = r + dir, tc = c + dc;
      if (!inB(tr, tc)) continue;
      const q = s.board[tr][tc];
      if (isPiece(q) && q.c !== p.c && q.t !== "K") push(tr, tc);
      else if (!q && s.ep && s.ep[0] === tr && s.ep[1] === tc) push(tr, tc, { ep: true });
    }
  } else if (p.t === "K") {
    movesAsType(s, r, c, p, "K", out);
    const rights = s.castling[p.c];
    const row = homeRow(p.c);
    if (r === row && c === 4 && !inCheck(s, p.c)) {
      const opp = enemy(p.c);
      if (rights.k) {
        const rk = s.board[row][7];
        if (isPiece(rk) && rk.t === "R" && rk.c === p.c &&
            !s.board[row][5] && !s.board[row][6] &&
            !attacksSquare(s, opp, row, 5) && !attacksSquare(s, opp, row, 6)) {
          push(row, 6, { castle: "k" });
        }
      }
      if (rights.q) {
        const rk = s.board[row][0];
        if (isPiece(rk) && rk.t === "R" && rk.c === p.c &&
            !s.board[row][1] && !s.board[row][2] && !s.board[row][3] &&
            !attacksSquare(s, opp, row, 2) && !attacksSquare(s, opp, row, 3)) {
          push(row, 2, { castle: "q" });
        }
      }
    }
  } else {
    movesAsType(s, r, c, p, p.t, out);
  }

  // estilos extras
  if (p.st) for (const t in p.st) if (p.st[t] && t !== p.t) movesAsType(s, r, c, p, t, out);

  // marca promoção de peão
  if (p.t === "P") {
    const lastRow = p.c === "w" ? 0 : 7;
    for (const m of out) if (m.to[0] === lastRow) m.promo = true;
  }

  // bispo atirador: capturas viram tiros (sem se mover)
  if (p.sh) {
    for (const m of out) {
      if (m.castle) continue;
      const q = s.board[m.to[0]][m.to[1]];
      if (isPiece(q) && q.c !== p.c) { m.shoot = true; delete m.promo; }
    }
  }
  return out;
}

function execMove(s, m, promoPiece) {
  const [r, c] = m.from, [tr, tc] = m.to;
  const p = s.board[r][c];

  // tiro do bispo atirador: alvo removido, atirador não se move
  if (m.shoot) {
    const q = s.board[tr][tc];
    if (q.ar) { delete q.ar; }
    else {
      pieceRemoved(s, tr, tc, q);
      s.board[tr][tc] = null;
      if (q.bm) explode(s, tr, tc); // torre bomba capturada explode
    }
    s.ep = null;
    return;
  }

  // captura de peça com armadura de espinhos: o atacante morre, a armadura quebra.
  // Se o atacante for uma TORRE BOMBA, ela explode ao ser destruída — a explosão
  // acontece na casa do alvo (a armadura absorve a explosão; vizinhos e reis não).
  const capSq = m.ep ? [r, tc] : [tr, tc];
  const target = s.board[capSq[0]][capSq[1]];
  if (isPiece(target) && target.c !== p.c && target.ar) {
    pieceRemoved(s, r, c, p);
    if (p.t === "K") { s.castling[p.c].k = false; s.castling[p.c].q = false; } // não deve ocorrer (bloqueado na geração)
    s.board[r][c] = null;
    if (p.bm) explode(s, capSq[0], capSq[1]); // a explosão consome a armadura (peça sobrevive)
    else delete target.ar;
    s.ep = null;
    return;
  }

  const wasCapture = m.ep ? true : isPiece(s.board[tr][tc]);
  const targetHadBm = isPiece(target) && target.c !== p.c && !!target.bm;
  s.ep = null;
  if (m.double) s.ep = [(r + tr) / 2, c];
  if (m.ep) { pieceRemoved(s, r, tc, s.board[r][tc]); s.board[r][tc] = null; }
  if (wasCapture && !m.ep) pieceRemoved(s, tr, tc, s.board[tr][tc]);
  if (m.castle) {
    const row = r;
    if (m.castle === "k") { s.board[row][5] = s.board[row][7]; s.board[row][7] = null; }
    else { s.board[row][3] = s.board[row][0]; s.board[row][0] = null; }
  }
  s.board[tr][tc] = p;
  s.board[r][c] = null;
  if (m.promo || (p.t === "P" && (tr === 0 || tr === 7))) {
    const np = { t: promoPiece || "Q", c: p.c };
    if (p.st) np.st = p.st;
    if (p.ar) np.ar = p.ar;
    s.board[tr][tc] = np;
  }
  // direitos de roque (movimentos do rei/torre)
  const row0 = homeRow(p.c);
  if (p.t === "K") { s.castling[p.c].k = false; s.castling[p.c].q = false; }
  if (p.t === "R" && r === row0 && c === 0) s.castling[p.c].q = false;
  if (p.t === "R" && r === row0 && c === 7) s.castling[p.c].k = false;

  // pós-efeitos: torre bomba e minas
  if (m.castle) {
    const row = r;
    landingResolve(s, row, m.castle === "k" ? 6 : 2);
    landingResolve(s, row, m.castle === "k" ? 5 : 3);
  } else {
    const moved = s.board[tr][tc];
    // explode se a torre bomba capturou OU se uma torre bomba foi capturada
    if (wasCapture && ((moved && moved.bm) || targetHadBm)) explode(s, tr, tc);
    landingResolve(s, tr, tc);
  }
  if (m.double && !s.board[tr][tc]) s.ep = null; // peão morreu na mina: sem en passant
}

// legal = não deixa o próprio rei em xeque NEM no raio de uma detonação de mina
function simOk(t, col) {
  return t.kingBlast.indexOf(col) < 0 && !inCheck(t, col);
}

function legalMovesFor(s, r, c) {
  const p = s.board[r][c];
  if (!isPiece(p) || p.c !== s.turn || s.over) return [];
  return pseudoMoves(s, r, c).filter((m) => {
    const t = cloneState(s);
    execMove(t, m);
    return simOk(t, p.c);
  });
}

function hasLegalBoardMove(s, col) {
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = s.board[r][c];
    if (!isPiece(p) || p.c !== col) continue;
    for (const m of pseudoMoves(s, r, c)) {
      const t = cloneState(s);
      execMove(t, m);
      if (simOk(t, col)) return true;
    }
  }
  return false;
}

/* ---------- cartas ---------- */

// alvos "crus" (antes do filtro de xeque)
function cardTargetsRaw(s, key) {
  const me = s.turn;
  const out = [];
  const eachSq = (fn) => { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) fn(r, c, s.board[r][c]); };

  if (STYLE_OF[key]) {
    const st = STYLE_OF[key];
    eachSq((r, c, p) => {
      if (isPiece(p) && p.c === me && p.t !== "K" && p.t !== st && !hasEffect(p)) out.push([r, c]);
    });
  } else if (SUMMON_OF[key]) {
    const row = homeRow(me);
    for (let c = 0; c < 8; c++) if (!s.board[row][c]) out.push([row, c]);
  } else if (key === "rock" || key === "mina") {
    eachSq((r, c, p) => { if (!p && mineIdx(s, r, c) < 0) out.push([r, c]); });
  } else if (key === "sniper" || key === "mudanca") {
    eachSq((r, c, p) => {
      if (isPiece(p) && p.c === enemy(me) && p.t !== "K" && attacksSquare(s, me, r, c)) out.push([r, c]);
    });
  } else if (key === "sacrificio") {
    eachSq((r, c, p) => { if (isPiece(p) && p.c === me && p.t !== "K") out.push([r, c]); });
  } else if (key === "atirador") {
    eachSq((r, c, p) => { if (isPiece(p) && p.c === me && p.t === "B" && !hasEffect(p)) out.push([r, c]); });
  } else if (key === "bomba") {
    eachSq((r, c, p) => { if (isPiece(p) && p.c === me && p.t === "R" && !hasEffect(p)) out.push([r, c]); });
  } else if (key === "seguro") {
    eachSq((r, c, p) => { if (!p) out.push([r, c]); });
  } else if (key === "armadura") {
    eachSq((r, c, p) => { if (isPiece(p) && p.c === me && p.t !== "K" && !hasEffect(p)) out.push([r, c]); });
  }
  return out;
}

// efeito da carta (mutação; sem lógica de turno)
function applyCardEffect(s, key, at) {
  const me = s.turn;
  const [r, c] = at;
  const p = s.board[r][c];
  if (STYLE_OF[key]) {
    p.st = p.st || {};
    p.st[STYLE_OF[key]] = 1;
  } else if (SUMMON_OF[key]) {
    s.board[r][c] = { t: SUMMON_OF[key], c: me };
    landingResolve(s, r, c);
  } else if (key === "rock") {
    s.board[r][c] = { t: "X" };
  } else if (key === "sniper") {
    if (p.ar) delete p.ar;
    else {
      pieceRemoved(s, r, c, p);
      s.board[r][c] = null;
      if (p.bm) explode(s, r, c); // torre bomba capturada explode
    }
  } else if (key === "mudanca") {
    pieceRemoved(s, r, c, p); // inimigo perde direitos de roque se for torre em casa
    p.c = me;
  } else if (key === "sacrificio") {
    pieceRemoved(s, r, c, p);
    s.board[r][c] = null;
  } else if (key === "atirador") {
    p.sh = 1;
  } else if (key === "bomba") {
    p.bm = 1;
  } else if (key === "seguro") {
    const k = findKing(s, me);
    s.board[r][c] = s.board[k[0]][k[1]];
    s.board[k[0]][k[1]] = null;
    s.castling[me].k = false; s.castling[me].q = false;
    landingResolve(s, r, c);
  } else if (key === "mina") {
    s.mines.push({ at: [r, c], c: me });
  } else if (key === "armadura") {
    p.ar = 1;
  }
  s.ep = null;
}

// alvos legais (ação não pode terminar com o próprio rei em xeque)
// tem moedas para pagar a carta? (modo treino: sempre)
function canAfford(s, key) {
  return s.variant === "treino" || s.coins[s.turn] >= CARD_COST[key];
}

const HAND_LIMIT = 5;
function handSize(s, col) {
  let n = 0;
  for (const k in s.cards[col]) if (s.cards[col][k] > 0) n++;
  return n;
}
// Comprar do monte: grátis, gasta o turno; máx. 5 cartas na mão;
// proibido em xeque (não resolve nada) e indisponível no modo treino.
function canDraw(s) {
  return !s.over && s.variant !== "treino" && s.deck.length > 0 &&
         handSize(s, s.turn) < HAND_LIMIT && !inCheck(s, s.turn);
}

function cardTargets(s, key) {
  if (s.over || !s.cards[s.turn][key] || !canAfford(s, key)) return [];
  return cardTargetsRaw(s, key).filter((at) => {
    const t = cloneState(s);
    applyCardEffect(t, key, at);
    return simOk(t, s.turn);
  });
}
function hasCardAction(s, key) {
  if (s.over || !s.cards[s.turn][key] || !canAfford(s, key)) return false;
  return cardTargetsRaw(s, key).some((at) => {
    const t = cloneState(s);
    applyCardEffect(t, key, at);
    return simOk(t, s.turn);
  });
}

function playerHasAnyAction(s, col) {
  const view = s.turn === col ? s : Object.assign(cloneState(s), { turn: col });
  if (hasLegalBoardMove(view, col)) return true;
  if (canDraw(view)) return true; // comprar do monte também é uma ação
  for (const key of CARD_KEYS) if (hasCardAction(view, key)) return true;
  return false;
}

/* ---------- aplicação de ações ---------- */

const FILES = "abcdefgh";
const sqName = (r, c) => FILES[c] + (8 - r);

// Ação: {kind:'move', from, to, promo?} | {kind:'card', card, at}
function applyAction(s, a) {
  if (s.over) return { ok: false, error: "Partida encerrada." };
  const me = s.turn;
  s.fx = [];
  s.kingBlast = [];
  let logTxt = "";

  if (a.kind === "move") {
    const legal = legalMovesFor(s, a.from[0], a.from[1]);
    const m = legal.find((x) => x.to[0] === a.to[0] && x.to[1] === a.to[1]);
    if (!m) return { ok: false, error: "Movimento ilegal." };
    const p = s.board[a.from[0]][a.from[1]];
    const targetBefore = m.ep ? s.board[a.from[0]][a.to[1]] : s.board[a.to[0]][a.to[1]];
    const targetArmored = isPiece(targetBefore) && !!targetBefore.ar;
    const promo = ["Q", "R", "B", "N"].indexOf(a.promo) >= 0 ? a.promo : "Q";
    execMove(s, m, promo);
    if (m.shoot) {
      logTxt = `🎯 ${PIECE_PT[p.t]} ${sqName(a.from[0], a.from[1])} atira em ${sqName(a.to[0], a.to[1])}` +
        (targetArmored ? " (armadura quebrada)" : ` (${PIECE_PT[targetBefore.t]} capturado)`);
    } else if (targetArmored) {
      // armadura refletiu: alvo continua lá, atacante morreu
      logTxt = `🛡️ ${PIECE_PT[p.t]} ${sqName(a.from[0], a.from[1])} morre nos espinhos de ${sqName(a.to[0], a.to[1])}`;
      if (s.fx.length) logTxt += " 💥"; // era uma torre bomba: explodiu mesmo assim
    } else {
      const captured = m.ep ? true : isPiece(targetBefore);
      logTxt = `${PIECE_PT[p.t]} ${sqName(a.from[0], a.from[1])}${captured ? "×" : "→"}${sqName(a.to[0], a.to[1])}`;
      if (m.castle) logTxt = m.castle === "k" ? "Roque curto (O-O)" : "Roque longo (O-O-O)";
      else if (m.promo) logTxt += " =" + ({ Q: "D", R: "T", B: "B", N: "C" })[promo];
      if (s.fx.length) logTxt += " 💥";
    }
  } else if (a.kind === "card") {
    const key = a.card;
    if (!CARD_INFO[key]) return { ok: false, error: "Carta desconhecida." };
    if (!s.cards[me][key]) return { ok: false, error: "Você não tem essa carta." };
    if (!canAfford(s, key)) return { ok: false, error: "Moedas insuficientes: custa " + CARD_COST[key] + " 🪙 e você tem " + s.coins[me] + "." };
    const tgts = cardTargets(s, key);
    if (!tgts.some((d) => d[0] === a.at[0] && d[1] === a.at[1])) return { ok: false, error: "Alvo inválido para a carta." };
    const p = s.board[a.at[0]][a.at[1]];
    const info = CARD_INFO[key];
    applyCardEffect(s, key, a.at);
    delete s.cards[me][key]; // a carta jogada sai da mão
    if (s.variant !== "treino") s.coins[me] -= CARD_COST[key];
    const at = sqName(a.at[0], a.at[1]);
    if (STYLE_OF[key]) logTxt = `${info.icone} Carta: ${PIECE_PT[p.t]} em ${at} ganha o ${info.nome}`;
    else if (SUMMON_OF[key]) logTxt = `${info.icone} Carta: ${PIECE_PT[SUMMON_OF[key]]} invocado em ${at}` + (s.fx.length ? " 💥" : "");
    else if (key === "rock") logTxt = `${info.icone} Carta: pedra em ${at}`;
    else if (key === "sniper") logTxt = `${info.icone} Carta: golpe à distância em ${at}` + (isPiece(s.board[a.at[0]][a.at[1]]) ? " (armadura quebrada)" : ` (${PIECE_PT[p.t]} capturado)`);
    else if (key === "mudanca") logTxt = `${info.icone} Carta: ${PIECE_PT[p.t]} em ${at} troca de time!`;
    else if (key === "sacrificio") logTxt = `${info.icone} Carta: ${PIECE_PT[p.t]} em ${at} é sacrificado`;
    else if (key === "atirador") logTxt = `${info.icone} Carta: Bispo em ${at} vira atirador`;
    else if (key === "bomba") logTxt = `${info.icone} Carta: Torre em ${at} vira bomba`;
    else if (key === "seguro") logTxt = `${info.icone} Carta: Rei se teletransporta para ${at}` + (s.fx.length ? " 💥" : "");
    else if (key === "mina") logTxt = `${info.icone} Carta: mina em ${at}`;
    else if (key === "armadura") logTxt = `${info.icone} Carta: ${PIECE_PT[p.t]} em ${at} ganha armadura de espinhos`;
    if (s.variant !== "treino") logTxt += ` (−${CARD_COST[key]} 🪙)`;
  } else if (a.kind === "draw") {
    if (s.variant === "treino") return { ok: false, error: "No modo treino você já tem todas as cartas." };
    if (s.deck.length === 0) return { ok: false, error: "O monte acabou." };
    if (handSize(s, me) >= HAND_LIMIT) return { ok: false, error: "Mão cheia: máximo de " + HAND_LIMIT + " cartas." };
    if (inCheck(s, me)) return { ok: false, error: "Em xeque você não pode comprar carta." };
    const drawn = s.deck.shift();
    s.cards[me][drawn] = 1;
    s.ep = null;
    logTxt = `🂠 Compra uma carta do monte (${s.deck.length} restante${s.deck.length === 1 ? "" : "s"})`;
  } else {
    return { ok: false, error: "Ação desconhecida." };
  }

  // cada lance rende +5 moedas a quem jogou
  if (s.variant !== "treino") s.coins[me] += 5;

  s.lastAction = a;
  s.log.push({ n: s.moveNum, c: me, txt: logTxt });
  if (me === "b") s.moveNum++;

  s.turn = enemy(me);
  const oppChecked = inCheck(s, s.turn);
  if (!playerHasAnyAction(s, s.turn)) {
    if (oppChecked) {
      s.over = { result: "mate", winner: me };
      s.log.push({ n: s.moveNum, c: me, txt: "Xeque-mate!" });
    } else {
      s.over = { result: "stalemate", winner: null };
      s.log.push({ n: s.moveNum, c: me, txt: "Empate por afogamento." });
    }
  } else if (oppChecked) {
    s.log[s.log.length - 1].txt += " +";
  }
  return { ok: true, check: oppChecked };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CARD_INFO, CARD_KEYS, CARD_COST, STYLE_OF, SUMMON_OF, canAfford, canDraw, handSize, HAND_LIMIT,
    initialState, cloneState, inCheck, attacksSquare,
    legalMovesFor, cardTargets, cardTargetsRaw, applyAction,
    hasLegalBoardMove, playerHasAnyAction, sqName, PIECE_PT,
    isRock, isPiece, mineIdx, canLandOn, hasEffect
  };
}
