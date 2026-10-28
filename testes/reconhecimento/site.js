// Integração com o site da loja (ponte na nuvem, Cloudflare).
// O Balcão é quem sai para buscar: publica preços e busca pedidos. Nada de fora entra no computador da loja.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- leitura segura do catálogo do site ----------
// O catálogo fica em dados/catalogo.js (window.CATALOGO = {...}). Em vez de executar o arquivo,
// lemos só o que é dado: objetos, listas, textos, números, "+" entre textos e encodeURIComponent('...').
function lerCatalogoSite(fonte) {
  const s = String(fonte);
  let i = s.indexOf('window.CATALOGO');
  if (i < 0) throw new Error('catálogo não encontrado');
  i = s.indexOf('=', i) + 1;
  function espacos() {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (s.startsWith('//', i)) { while (i < s.length && s[i] !== '\n') i++; continue; }
      if (s.startsWith('/*', i)) { const f = s.indexOf('*/', i + 2); i = f < 0 ? s.length : f + 2; continue; }
      break;
    }
  }
  function erro(m) { throw new Error(`${m} (posição ${i})`); }
  function texto() {
    const q = s[i++]; let out = '';
    while (i < s.length && s[i] !== q) {
      if (s[i] === '\\') { i++; const c = s[i++]; out += ({ n: '\n', t: '\t', r: '\r' })[c] ?? (c === 'u' ? String.fromCharCode(parseInt(s.slice(i, (i += 4)), 16)) : c); }
      else out += s[i++];
    }
    if (s[i] !== q) erro('texto sem fim'); i++; return out;
  }
  function nome() { const m = /^[A-Za-z_$][\w$]*/.exec(s.slice(i, i + 64)); if (!m) erro('esperava um nome'); i += m[0].length; return m[0]; }
  function primario() {
    espacos(); const c = s[i];
    if (c === '{') {
      i++; const o = {};
      for (;;) {
        espacos(); if (s[i] === '}') { i++; return o; }
        const k = (s[i] === "'" || s[i] === '"') ? texto() : nome();
        espacos(); if (s[i++] !== ':') erro('esperava ":"');
        o[k] = valor(); espacos();
        if (s[i] === ',') { i++; continue; } if (s[i] === '}') { i++; return o; } erro('esperava "," ou "}"');
      }
    }
    if (c === '[') {
      i++; const a = [];
      for (;;) {
        espacos(); if (s[i] === ']') { i++; return a; }
        a.push(valor()); espacos();
        if (s[i] === ',') { i++; continue; } if (s[i] === ']') { i++; return a; } erro('esperava "," ou "]"');
      }
    }
    if (c === "'" || c === '"') return texto();
    if (/[-\d]/.test(c)) { const m = /^-?\d+(\.\d+)?/.exec(s.slice(i, i + 32)); i += m[0].length; return Number(m[0]); }
    const n = nome();
    if (n === 'true') return true; if (n === 'false') return false; if (n === 'null') return null;
    if (n === 'encodeURIComponent') { espacos(); if (s[i++] !== '(') erro('esperava "("'); const v = valor(); espacos(); if (s[i++] !== ')') erro('esperava ")"'); return encodeURIComponent(String(v)); }
    erro(`expressão não permitida: ${n}`);
  }
  function valor() {
    let v = primario();
    for (;;) { espacos(); if (s[i] === '+') { i++; v = String(v) + String(primario()); } else return v; }
  }
  return valor();
}

const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const chaveSite = p => slug(p.nome) + (p.marca ? '|' + slug(p.marca) : '');

// mesma regra de opções do site (app.js, função extras)
function produtosDaLoja(cat, lojaSite) {
  const vistos = new Set();
  return (cat.base || []).filter(p => p && p.nome && (!p.so || p.so === lojaSite)).map(p => {
    let tipo, opcoes;
    if (p.nome === 'Alho roxo nacional') { tipo = 'op'; opcoes = ['Caixa 10 kg']; }
    else if (p.nome === 'Alho descascado') { tipo = 'op'; opcoes = ['Pacote 1 kg']; }
    else if (p.emb) { tipo = 'op'; opcoes = (p.tamanhos && p.tamanhos.length ? p.tamanhos : ['Unidade']).map(String); }
    else { tipo = 'kg'; opcoes = []; }
    // tamanho do fardo sugerido pelo catálogo (selo "Fardo 25 kg"); o dono confirma no Balcão
    const m = /(\d+)\s*kg/i.exec(tipo === 'kg' ? String(p.selo || '') : ''), fardoSug = m ? Number(m[1]) : null;
    // conservas: o site mostra o peso drenado; "liq" guarda o peso líquido do rótulo para cada tamanho
    const liq = p.liquido && p.emb ? Object.fromEntries(opcoes.map((r, i) => [r, String(p.liquido[i] || '')])) : null;
    return { chave: chaveSite(p), nome: p.nome, marca: p.marca || '', cat: p.cat || '', tipo, opcoes, fardoSug, liq };
  }).filter(p => !vistos.has(p.chave) && vistos.add(p.chave));
}

// ---------- sugestão de ligação por nome ----------
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'´`]/g, ' ').replace(/[^a-z0-9,.]+/g, ' ').trim();
const palavras = s => norm(s).split(' ').filter(w => w && !['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'com', 'para', 'kg', 'granel'].includes(w));
const tamanho = s => norm(s).replace(/\s+/g, '').replace(/litros?/g, 'l').replace(/,/g, '.').replace(/^balde/, '').replace(/\(.*\)/, '');
function sugerirExato(sp, opcao, produtos) {
  const alvo = palavras(sp.nome), marcaW = palavras(sp.marca || '').filter(w => w.length > 1);
  if (!alvo.length) return null;
  let melhor = null, nota = -1;
  for (const pr of produtos) {
    if (pr.ativo === false) continue;
    const pw = palavras(pr.nome), conj = new Set(pw);
    if (!alvo.every(w => conj.has(w))) continue; // todas as palavras do produto do site precisam estar no nome do Balcão
    const daMarca = marcaW.filter(w => conj.has(w)).length; // a marca ajuda a desempatar, mas não é obrigatória
    let n = 100 - (pw.length - alvo.length - daMarca) * 6 + daMarca * 12;
    const compacto = norm(pr.nome).replace(/\s+/g, '').replace(/,/g, '.');
    if (sp.tipo === 'kg') { if (pr.unidade === 'kg') n += 30; else n -= 70; } // a granel só liga sozinho a produto vendido por quilo
    else {
      const t = tamanho(opcao), t2 = sp.liq && sp.liq[opcao] ? tamanho(sp.liq[opcao]) : '';
      const tem = x => x && new RegExp('(^|[^0-9.])' + x.replace(/\./g, '\\.')).test(compacto); // "60g" não casa com "160g"
      if (t && t !== 'unidade') { if (tem(t) || tem(t2)) n += 40; else continue; }
      if (pr.unidade !== 'kg') n += 10;
    }
    if (n > nota) { nota = n; melhor = pr; }
  }
  return melhor && nota >= 40 ? melhor.id : null;
}


// Sugestão nova: o casamento do caixa (casar-produto.js), com o tamanho da opção obrigatório no nome do produto.
// Ordem: a regra antiga (todas as palavras do site no nome do Balcão) quando acha; senão a pontuação, com tentativas cada vez mais soltas
// (sem a marca, "em pó" = "moído", sem palavras de descrição) que baixam a confiança. Nunca grava nada: só preenche para o dono conferir.
let CP = null; try { CP = require('./public/casar-produto.js'); } catch (e) { try { CP = require('./casar-produto.js'); } catch (e2) { CP = null; } }
let AP = null; try { AP = require('./public/aprende-produto.js'); } catch (e) { try { AP = require('./aprende-produto.js'); } catch (e2) { AP = null; } }
/* Núcleo do nome: "Bicarbonato de sódio" e "BICARBONATO" são o mesmo produto quando, tirando as palavras de descrição
   (de, em pó, a granel, desidratado, puro...) dos DOIS lados, sobra a mesma palavra e só um produto do Balcão tem esse núcleo.
   As ligações que o dono já fez ensinam palavras de descrição novas ("sódio" ficou de fora em Bicarbonato -> vale para Percarbonato). */
const QUALIF_PADRAO = ['de', 'da', 'do', 'das', 'dos', 'e', 'em', 'a', 'o', 'para', 'granel', 'agranel', 'puro', 'pura', 'tradicional', 'natural', 'nacional', 'desidratado', 'desidratada', 'desidratados', 'desidratadas', 'seco', 'seca', 'inteiro', 'inteira', 'selecionado', 'selecionada', 'tipo'];
const FORMA = { moido: 'moido', folha: 'folha', folhas: 'folha', grao: 'grao', graos: 'grao', flocos: 'flocos', floco: 'flocos', pau: 'pau', casca: 'pau', ralado: 'ralado', fatiado: 'fatiado' };
function nucleo(nome, qualif) {
  const a = CP._analisar(nome, false), forma = new Set(), core = new Set();
  let fora = 0;
  for (const t of a.toks) { const f = FORMA[t.c]; if (f) { forma.add(f); continue; } if (t.m || t.g) { fora++; continue; } if (qualif.has(t.c) || qualif.has(t.r)) continue; core.add(t.r); }
  return { core, forma, fora, tam: a.tams[0] || null };
}
function sugerirNucleo(sp, cand, ctx) {
  if (!CP || !CP._analisar) return null;
  const q = ctx && ctx.qualif || new Set(QUALIF_PADRAO), alvo = nucleo(sp.nome, q);
  if (!alvo.core.size) return null;
  const iguais = [];
  for (const p of cand) { const n = ctx && ctx.nuc && ctx.nuc.get(p) || nucleo(p.nome, q); if (ctx && ctx.nuc) ctx.nuc.set(p, n);
    if (n.core.size !== alvo.core.size || [...alvo.core].some(w => !n.core.has(w))) continue;
    if (alvo.forma.size && n.forma.size && ![...alvo.forma].some(f => n.forma.has(f))) continue;   // "em folha" não é "moído"
    iguais.push({ p, extra: [...n.forma].filter(f => !alvo.forma.has(f)).length + Math.max(0, n.fora - alvo.fora) * 0.5 }); }
  if (!iguais.length) return null;
  iguais.sort((a, b) => a.extra - b.extra);
  if (iguais.length > 1 && iguais[0].extra === iguais[1].extra) return null;   // mais de um igual: deixa para o casamento normal
  return { pid: iguais[0].p.id, conf: iguais.length === 1 && iguais[0].extra < 1 ? 'alta' : 'media', como: 'nucleo' };
}
function tamanhosOpcao(o) {
  const t = norm(o).replace(/\(.*?\)/g, ' '), out = []; let m; const re = /(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|l|litros?|lt)\b/g;
  while ((m = re.exec(t))) { const n = Number(m[1].replace(',', '.')), u = m[2].startsWith('l') ? 'l' : m[2] === 'gr' ? 'g' : m[2];
    out.push(n + u); const r = Math.round(n); if (r > 0 && r !== n && Math.abs(n - r) <= 0.05 * n) out.push(r + u); // "1,01 kg" também é "1 kg"
    if (u === 'kg') out.push(n * 1000 + 'g'); if (u === 'g' && n >= 1000) out.push(n / 1000 + 'kg'); if (u === 'l') out.push(n * 1000 + 'ml'); if (u === 'ml' && n >= 1000) out.push(n / 1000 + 'l'); }
  return [...new Set(out)];
}
const compactoNome = s => norm(s).replace(/\s+/g, '').replace(/,/g, '.').replace(/(\d)(gr|grs)(?![a-z])/g, '$1g').replace(/(\d)(lt|litros?)(?![a-z])/g, '$1l');
const temTamanho = (nome, ts) => { const c = compactoNome(nome); return ts.some(x => new RegExp('(^|[^0-9.])' + x.replace(/\./g, '\\.') + '(?![0-9])').test(c)); };
const DESCRICAO = /\b(desidratad[oa]s?|tradicional|caseir[oa]|nacional|natural|inteir[oa]s?|em folhas?|selecionad[oa]s?|premium|especial|artesanal)\b/g;
const BAIXA = { alta: 'media', media: 'baixa', baixa: 'baixa' };
function sugerirNovo(sp, opcao, produtos, ctx) {
  if (!CP) return null;
  const marca = sp.marca || '';
  let cand, base, unidade, ts = [];
  if (sp.tipo === 'kg') { cand = produtos.filter(p => p.ativo !== false); base = norm(sp.nome); unidade = 'kg'; }
  else {
    ts = [...tamanhosOpcao(opcao), ...(sp.liq && sp.liq[opcao] ? tamanhosOpcao(sp.liq[opcao]) : [])];
    cand = produtos.filter(p => p.ativo !== false && p.unidade !== 'kg' && (!ts.length || temTamanho(p.nome, ts)));
    const resto = norm(opcao).replace(/\(.*?\)/g, ' ').replace(/(\d+(?:[.,]\d+)?)\s*(kg|g|gr|ml|l|litros?|lt)\b/g, ' ').replace(/\b(pacote|caixa|pote|frasco|vidro|garrafa|balde|saches?|unidade|lata|pct)\b/g, ' ');
    base = norm(sp.nome) + ' ' + resto; unidade = 'un';
  }
  const tenta = (nome, rebaixa, lista) => { lista = lista || cand; if (!lista.length) return null; const it = { nome: nome + (ts[0] && lista === cand ? ' ' + ts[0] : ''), quantidade: 1, unidade }; let r = CP.casar(it, lista, [], { pesagem: sp.tipo === 'kg' });
    if (AP && ctx && ctx.mem && ctx.exemplos.length) r = AP.refinar(it, r, lista, ctx.mem, { pesagem: sp.tipo === 'kg' });   // as ligações que o dono já fez ensinam
    if (ctx) ctx.alts = (r.candidatos || []).map(c => c.p.id);
    return r.p ? { pid: r.p.id, conf: rebaixa ? BAIXA[r.conf] : r.conf } : null; };
  // núcleo do nome (palavras de descrição opcionais dos dois lados), antes das tentativas mais soltas
  const nuc = sp.tipo === 'kg' ? sugerirNucleo(sp, cand.filter(p => p.unidade === 'kg'), ctx) : null;   // só a granel (com marca e tamanho, a regra de embalagem vale)
  if (nuc && nuc.conf === 'alta' && !(marca && tenta(comMarcaDe(base, marca), false))) return nuc;
  const comMarca = comMarcaDe(base, marca);
  // por tamanho, se nenhum produto do Balcão tem o tamanho no nome: os que não dizem tamanho nenhum (confiança menor)
  const semTam = sp.tipo === 'kg' || !ts.length ? [] : produtos.filter(p => p.ativo !== false && p.unidade !== 'kg' && !/\d\s*(kg|g|gr|grs|ml|l|lt|litros?)\b/i.test(norm(p.nome)));
  return (marca && tenta(comMarca, false)) || tenta(base, false)
    || tenta(base.replace(/\bem po\b/g, 'moido'), true) || tenta(base.replace(DESCRICAO, ' ').replace(/\s+/g, ' ').trim() || base, true)
    || tenta(comMarca, true, semTam);
}
const comMarcaDe = (base, marca) => marca ? base + ' ' + norm(marca) : base;
function sugerir(sp, opcao, produtos, ctx) {
  // ligação já ensinada para este mesmo texto (outro tamanho ou loja): vale primeiro
  const exato = sugerirExato(sp, opcao, produtos);
  let g = exato ? { pid: exato, conf: 'alta' } : sugerirNovo(sp, opcao, produtos, ctx);
  if (ctx) { g = g || null; ctx.ultAlts = (ctx.alts || []).filter(id => !g || id !== g.pid).slice(0, 3); ctx.alts = null; }
  // o site diz a marca e o nome do Balcão não tem: pode ser de outra marca -> no máximo média (o dono confere)
  if (g && g.conf === 'alta' && sp.marca) { const pr = produtos.find(p => p.id === g.pid), mw = palavras(sp.marca).filter(w => w.length > 2), nw = new Set(palavras(pr && pr.nome)); if (mw.length && !mw.some(w => nw.has(w) || [...nw].some(x => x.startsWith(w.slice(0, 5))))) g.conf = 'media'; }
  return g;
}
// ---------- módulo ----------
module.exports = function criarSite({ dataDir, abrirCol, enviar, cifrar, decifrar, lojaDoc, json, corpo, semId }) {
  const dir = path.join(dataDir, 'site');
  fs.mkdirSync(dir, { recursive: true });
  const arqSegredo = lid => path.join(dir, String(lid).replace(/[^\w.-]/g, '_') + '.json');
  const lerSegredo = lid => { try { const o = JSON.parse(fs.readFileSync(arqSegredo(lid), 'utf8')); return { url: o.url, token: decifrar(o.token) }; } catch (e) { return null; } };
  const ST_SITE = { novo: 'recebido', separando: 'separando', pronto: 'pronto', concluido: 'entregue', cancelado: 'cancelado' };

  // aceita "dluemporiobras.com.br", "www....", com ou sem https://, com barra ou caminho no fim: fica só https://host
  function urlValida(u) {
    let t = String(u || '').trim().replace(/\s+/g, ''); if (!t) return null;
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) t = (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(t) ? 'http://' : 'https://') + t;
    let x; try { x = new URL(t); } catch (e) { return null; }
    if (!x.hostname || (!x.hostname.includes('.') && x.hostname !== 'localhost')) return null;
    const local = ['localhost', '127.0.0.1'].includes(x.hostname);
    if (x.protocol !== 'https:' && !(local && x.protocol === 'http:')) return null;
    return x.origin;
  }
  const VERSAO = (() => { try { return require('./package.json').version; } catch (e) { return ''; } })();
  const UA = `Mozilla/5.0 (compatible; BalcaoPDV/${VERSAO})`;
  const host = u => { try { return new URL(u).host; } catch (e) { return String(u || ''); } };
  const erroSite = (msg, detalhe, code) => { const e = new Error(msg); e.detalhe = detalhe || ''; if (code) e.code = code; e.classificado = true; return e; };
  // falha de rede: diz o motivo de verdade (nome não existe, recusou, demorou, certificado)
  function erroRede(e, url) {
    const pick = x => x && (typeof x.code === 'string' && x.code ? x.code : x.name && x.name !== 'Error' ? x.name : '');
    const c = String(pick(e && e.cause) || pick(e) || ''), m = String((e && e.cause && e.cause.message) || (e && e.message) || '');
    let motivo = 'sem resposta';
    if (/ENOTFOUND|EAI_AGAIN|EAI_NONAME/.test(c + m)) motivo = 'o nome do domínio não foi encontrado (DNS)';
    else if (/ECONNREFUSED/.test(c + m)) motivo = 'a conexão foi recusada';
    else if (/TimeoutError|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|AbortError|timeout/i.test(c + m)) motivo = 'demorou demais para responder';
    else if (/CERT|SSL|TLS|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO|ERR_TLS|alert/i.test(c + m)) motivo = 'o certificado HTTPS do domínio não é válido ainda';
    else if (/ECONNRESET|UND_ERR_SOCKET|socket/i.test(c + m)) motivo = 'a conexão caiu no meio';
    return erroSite(`O endereço ${host(url)} não respondeu (motivo: ${motivo}). Se o domínio é novo, confira na Cloudflare se ele está "Active" em Custom domains.`, `${c || 'erro'}${m && !m.includes(c) ? ' · ' + m.slice(0, 120) : ''}`, 'rede');
  }
  // resposta HTTP de erro: Cloudflare bloqueando, rota que não existe, erro interno do site
  function erroHttp(r, texto, j, rota, url) {
    const h = k => r.headers.get(k) || '', srv = h('server'), mit = h('cf-mitigated'), ct = h('content-type');
    const det = `HTTP ${r.status}${srv ? ' · server: ' + srv : ''}${mit ? ' · cf-mitigated: ' + mit : ''}${h('cf-ray') ? ' · cf-ray: ' + h('cf-ray') : ''}`;
    const desafio = !!mit || /Just a moment|cf-chl|challenge-platform|Attention Required|cf_chl_opt/i.test(texto) || (/cloudflare/i.test(srv) && /text\/html/i.test(ct) && [403, 503, 429].includes(r.status));
    if ([403, 503, 429].includes(r.status) && desafio) return erroSite('A Cloudflare bloqueou o Balcão (proteção contra robôs). Em Security › Bots desligue o Bot Fight Mode, ou crie uma regra para liberar /api/painel/*.', det, 'cloudflare');
    if (r.status === 404 && /^\/api\/painel\//.test(rota)) return erroSite('Esse endereço não é o do site (a rota do Balcão não existe lá).', det, 'rota');
    if (r.status >= 500) {
      const er = String((j && (j.erro || j.error || j.msg)) || '').slice(0, 200);
      if (/KV|LOJA|binding/i.test(er)) return erroSite(`O site está sem o armazenamento ligado (KV "LOJA"). Na Cloudflare: Pages › o projeto › Settings › Functions › KV namespace bindings, ligue LOJA e publique de novo. (erro do site: ${er})`, det, 'site');
      if (/PAINEL_TOKENS|token/i.test(er)) return erroSite(`A variável PAINEL_TOKENS do site está faltando ou inválida. Na Cloudflare: Pages › o projeto › Settings › Environment variables. (erro do site: ${er})`, det, 'site');
      return erroSite(`O site deu erro interno (${r.status})${er ? ': ' + er : ''}.`, det, 'site');
    }
    if (desafio) return erroSite('A Cloudflare bloqueou o Balcão (proteção contra robôs). Em Security › Bots desligue o Bot Fight Mode, ou crie uma regra para liberar /api/painel/*.', det, 'cloudflare');
    return erroSite(`O site respondeu com erro ${r.status}${j && (j.msg || j.erro) ? ': ' + String(j.msg || j.erro).slice(0, 160) : ''}.`, det, 'http');
  }
  async function chamar(seg, rota, opcoes = {}) {
    let r;
    try {
      r = await fetch(seg.url + rota, { ...opcoes, headers: { Authorization: 'Bearer ' + seg.token, 'Content-Type': 'application/json', Accept: 'application/json', 'User-Agent': UA, ...(opcoes.headers || {}) }, signal: AbortSignal.timeout(opcoes.ms || 15000) });
    } catch (e) { throw erroRede(e, seg.url); }
    let texto = ''; try { texto = await r.text(); } catch (e) {}
    let j = null; try { j = JSON.parse(texto); } catch (e) { j = null; }
    if (r.status === 401) { const e = erroSite('O site recusou o token. Confira o token desta loja.', `HTTP 401${j && j.erro ? ' · ' + j.erro : ''}`, 'token'); throw e; }
    if (!r.ok) throw erroHttp(r, texto, j, rota, seg.url);
    if (j === null && /^\/api\//.test(rota)) { const ce = erroHttp(r, texto, j, rota, seg.url); if (ce.code === 'cloudflare') throw ce; throw erroSite('Esse endereço não é o do site (a resposta não veio do Balcão).', `HTTP ${r.status} · ${(r.headers.get('content-type') || 'sem tipo').slice(0, 40)}`, 'rota'); }
    return j;
  }
  async function marcar(lid, campos) {
    const sets = {}; for (const [k, v] of Object.entries(campos)) sets['site.' + k] = v;
    await abrirCol('lojas').updateAsync({ _id: lid }, { $set: sets }, {}); enviar({ t: 'chg', col: 'lojas' });
  }
  const cacheCat = new Map();
  async function catalogo(seg, lojaSite) {
    const em = cacheCat.get(seg.url); if (em && Date.now() - em.t < 10 * 60e3) return produtosDaLoja(em.cat, lojaSite);
    let r; try { r = await fetch(seg.url + '/dados/catalogo.js', { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': UA } }); } catch (e) { throw erroRede(e, seg.url); }
    const texto = await r.text().catch(() => '');
    if (!r.ok) { const e = erroHttp(r, texto, null, '/dados/catalogo.js', seg.url); if (e.code === 'http') e.message = 'Não consegui ler o catálogo do site (erro ' + r.status + ').'; throw e; }
    const cat = lerCatalogoSite(texto);
    cacheCat.set(seg.url, { t: Date.now(), cat });
    return produtosDaLoja(cat, lojaSite);
  }

  // regra de atacado do site: a granel a partir de X kg do mesmo produto; potes e garrafas a partir de N unidades
  const FARDO = { dlu: 10, vks: 25 };
  function regraAtacado(loja) {
    const st = (loja && loja.site) || {}, a = st.atacado || {};
    const minKg = Number(a.minKg) > 0 ? Number(a.minKg) : 10; // fardo fechado sempre sai no atacado; isto vale para quantidades soltas
    const minUn = Number(a.minUn) > 0 ? Math.round(Number(a.minUn)) : 12;
    return { ativo: a.ativo !== false, minKg, minUn };
  }

  // desconto por forma de pagamento: padrão 5% no Pix ou dinheiro a partir de R$ 100
  function regraDesconto(loja) {
    const d = ((loja && loja.site) || {}).desconto || {};
    const pct = Number(d.pct) > 0 ? Number(d.pct) : 5, min = Number(d.min) >= 0 && d.min != null ? Number(d.min) : 100;
    return { ativo: d.ativo !== false, pct, min: Math.round(min * 100), formas: Array.isArray(d.formas) && d.formas.length ? d.formas : ['pix', 'dinheiro'] };
  }

  // ----- montar o que vai para o site -----
  async function montarPublicacao(lid, loja) {
    const prods = new Map((await abrirCol(`lojas/${lid}/produtos`).findAsync({})).map(p => [p._id, p]));
    const lig = (loja.site && loja.site.ligacoes) || {}, emFalta = !!(loja.site && loja.site.emFalta);
    const itens = {}, indisponivel = [], avisos = [];
    const cent = v => Math.round((Number(v) || 0) * 100);
    const esgotado = p => p.ativo === false || (emFalta && !((Number(p.estoque) || 0) > 0));
    // preço de atacado (campo "Preço de atacado" do produto): só vale se for menor que o de varejo
    const at = p => { const a = cent(p.precoAtacado), v = cent(p.preco); return a > 0 && a < v ? a : 0; };
    for (const [chave, l] of Object.entries(lig)) {
      if (!l) continue;
      if (l.tipo === 'kg') {
        const p = prods.get(l.pid); if (!p) continue;
        if (p.unidade !== 'kg') avisos.push(`${p.nome}: está em unidade no Balcão, mas no site é vendido por quilo.`);
        if (cent(p.preco) > 0) { itens[chave] = { kg: cent(p.preco) }; if (at(p)) itens[chave].kgAt = at(p); if (l.fardo != null) itens[chave].fardo = l.fardo; }
        if (esgotado(p)) indisponivel.push(chave);
      } else if (l.tipo === 'op') {
        const op = {}, opAt = {}; let algum = false, todosFora = true;
        for (const [r, pid] of Object.entries(l.ops || {})) {
          const p = prods.get(pid); if (!p) continue; algum = true;
          if (cent(p.preco) > 0) { op[r] = cent(p.preco); if (at(p)) opAt[r] = at(p); }
          if (!esgotado(p)) todosFora = false;
        }
        if (Object.keys(op).length) { itens[chave] = { op }; if (Object.keys(opAt).length) itens[chave].opAt = opAt; }
        if (algum && todosFora) indisponivel.push(chave);
      }
    }
    return { itens, indisponivel: indisponivel.sort(), avisos, atacado: regraAtacado(loja), desconto: regraDesconto(loja) };
  }

  // ----- trazer pedidos do site para a aba Pedidos -----
  function pedidoDoSite(ps, lig, numero) {
    const itens = (ps.itens || []).map(i => {
      const l = lig[i.chave] || null, g = Number(i.gramas) || 0, n = Number(i.quantidade) || 1;
      const granel = g > 0;
      const pid = l ? (l.tipo === 'kg' ? l.pid : (l.ops || {})[i.opcao]) || null : null;
      const nome = (i.nome + (i.marca ? ' ' + i.marca : '') + (!granel && i.opcao && i.opcao !== 'Unidade' ? ' ' + i.opcao + (i.liquido ? ' drenado (pote de ' + i.liquido + ')' : '') : '')).trim();
      const obs = i.fechado ? `${n} ${n > 1 ? String(i.fechado).replace(/(\S+) (\S+)/, '$1s $2s') : i.fechado} de ${g >= 1000 ? (g / 1000).toLocaleString('pt-BR') + ' kg' : g + ' g'}` : '';
      return {
        nome, codigo: '', pid: pid || undefined,
        quantidade: granel ? Math.round(g * n) / 1000 : n, unidade: granel ? 'kg' : 'un', atacado: !!i.atacado,
        preco: i.preco != null ? Math.round((granel ? i.preco / (g / 1000) : i.preco)) / 100 : null, obs
      };
    });
    const e = ps.entrega || {}, c = ps.cliente || {};
    return {
      _id: 'pd' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), numero,
      origem: 'site', app: 'Site', idSite: ps.id, codigoSite: ps.codigo, lojaSite: ps.loja,
      cliente: { nome: String(c.nome || '').slice(0, 80), telefone: String(c.telefone || '').slice(0, 30), email: '', doc: String(c.doc || '').slice(0, 14), razao: String(c.razao || '').slice(0, 80) },
      nf: !!ps.nf, itens, atacado: itens.some(x => x.atacado), obs: String(ps.obs || '').slice(0, 1000), mensagem: String(ps.mensagem || '').slice(0, 4000),
      entrega: e.tipo === 'entrega' ? { tipo: 'Entrega (' + (e.meio || 'Lalamove ou Uber') + ')', endereco: String(e.endereco || '').slice(0, 300), quando: '' } : { tipo: 'Retirar na loja', endereco: '', quando: '' },
      pagamento: ({ pix: 'Pix', dinheiro: 'Dinheiro', cartao: 'Cartão' })[ps.pagamento] || '', formaPag: ps.pagamento || '',
      descontoPct: Number(ps.descontoPct) || 0, descontoInformado: ps.desconto ? ps.desconto / 100 : 0,
      totalInformado: ps.total != null ? ps.total / 100 : (ps.totalParcial != null ? ps.totalParcial / 100 : null),
      status: 'novo', statusSite: 'recebido', criadoEm: ps.criadoEm || new Date().toISOString()
    };
  }

  const rodando = new Map();
  // uma sincronização por loja de cada vez; quem chega durante uma, espera ela acabar e roda a sua
  async function sincronizar(lid, opcoes = {}) {
    while (rodando.has(lid)) { try { await rodando.get(lid); } catch (e) {} }
    const p = sincronizarJa(lid, opcoes);
    rodando.set(lid, p);
    try { return await p; } finally { if (rodando.get(lid) === p) rodando.delete(lid); }
  }
  async function sincronizarJa(lid, { forcarPublicacao = false } = {}) {
    const res = { publicados: null, novos: 0, situacoes: 0, avisos: [] };
    try {
      const loja = await lojaDoc(lid), seg = lerSegredo(lid);
      if (!loja || !seg || !loja.site) return res;
      // 1) preços: publica quando algo mudou (ou quando pedirem)
      const pub = await montarPublicacao(lid, loja); res.avisos = pub.avisos;
      const assinatura = crypto.createHash('sha1').update(JSON.stringify([pub.itens, pub.indisponivel, pub.atacado, pub.desconto])).digest('hex');
      if (forcarPublicacao || assinatura !== loja.site.assinatura) {
        const r = await chamar(seg, '/api/painel/publicar', { method: 'POST', body: JSON.stringify({ itens: pub.itens, indisponivel: pub.indisponivel, atacado: pub.atacado, desconto: pub.desconto }) });
        res.publicados = r && r.precos;
        await marcar(lid, { assinatura, ultimaPublicacao: new Date().toISOString(), publicados: res.publicados, indisponiveis: pub.indisponivel.length });
      }
      // 2) pedidos novos
      const fila = await chamar(seg, '/api/painel/pedidos');
      const lig = loja.site.ligacoes || {}, col = abrirCol(`lojas/${lid}/pedidos`), confirmar = [];
      for (const ps of (fila && fila.pedidos) || []) {
        const ja = await col.findOneAsync({ idSite: ps.id });
        if (ja) { confirmar.push({ id: ps.id, status: ST_SITE[ja.status] || 'recebido', numeroLoja: ja.numero }); continue; }
        const lj = abrirCol('lojas'); await lj.updateAsync({ _id: lid }, { $inc: { seqPedido: 1 } }, {});
        const seq = ((await lj.findOneAsync({ _id: lid })) || {}).seqPedido || 1;
        const doc = pedidoDoSite(ps, lig, seq);
        await col.insertAsync(doc); res.novos++;
        confirmar.push({ id: ps.id, status: 'recebido', numeroLoja: seq });
      }
      if (res.novos) enviar({ t: 'chg', col: `lojas/${lid}/pedidos` });
      // 3) situação dos pedidos que andaram na loja (separando, pronto, concluído...)
      const limite = new Date(Date.now() - 14 * 86400e3).toISOString();
      for (const d of await col.findAsync({ origem: 'site', idSite: { $exists: true } })) {
        if ((d.criadoEm || '') < limite) continue;
        const alvo = ST_SITE[d.status]; if (alvo && alvo !== d.statusSite && !confirmar.some(x => x.id === d.idSite)) confirmar.push({ id: d.idSite, status: alvo, numeroLoja: d.numero, _doc: d._id });
      }
      if (confirmar.length) {
        await chamar(seg, '/api/painel/status', { method: 'POST', body: JSON.stringify({ lista: confirmar.map(({ _doc, ...x }) => x) }) });
        for (const x of confirmar) { const r = await col.updateAsync({ idSite: x.id }, { $set: { statusSite: x.status } }, {}); if (r.numAffected && x._doc) res.situacoes++; }
      }
      await marcar(lid, { ultimaBusca: new Date().toISOString(), ultimoErro: '', ultimoDetalhe: '' });
      return res;
    } catch (e) {
      try { await marcar(lid, { ultimoErro: e.classificado ? String(e.message).slice(0, 400) + (e.code === 'rede' ? ' O Balcão tenta de novo sozinho.' : '') : String(e.message).slice(0, 200), ultimoDetalhe: String(e.detalhe || '').slice(0, 200), ultimoErroEm: new Date().toISOString() }); } catch (x) {}
      throw e;
    }
  }

  async function ciclo() {
    for (const l of await abrirCol('lojas').findAsync({ 'site.ativo': true })) {
      try { await sincronizar(l._id); } catch (e) {}
    }
  }
  const timer = setInterval(() => ciclo().catch(() => {}), 30000); timer.unref();
  let breve = null;
  function avisarMudanca() { clearTimeout(breve); breve = setTimeout(() => ciclo().catch(() => {}), 1500); breve.unref && breve.unref(); }

  // ----- rotas da tela (sessão de dono/gerente conferida no servidor) -----
  async function rota(req, res, p, url, S) {
    const GESTOR = ['dono', 'gerente'];
    if (!S || !GESTOR.includes(S.papel)) return json(res, S ? 403 : 401, { erro: S ? 'permissao' : 'sessao', msg: 'Só o dono ou o gerente mexe na ligação com o site.' });
    const lidDe = v => { const l = String(v || ''); return l === S.lid ? l : null; };
    if (p === '/api/site/produtos' && req.method === 'GET') {
      const lid = lidDe(url.searchParams.get('l')); if (!lid) return json(res, 403, { erro: 'permissao' });
      const loja = await lojaDoc(lid), seg = lerSegredo(lid);
      if (!seg || !loja.site) return json(res, 400, { erro: 'conectar', msg: 'Conecte o site primeiro.' });
      let lista; try { lista = await catalogo(seg, loja.site.lojaSite); } catch (e) { return json(res, 502, { erro: 'catalogo', msg: e.message }); }
      const prods = (await abrirCol(`lojas/${lid}/produtos`).findAsync({})).map(semId);
      const ctx = contextoLigacoes(lista, loja.site.ligacoes || {}, prods), sug = {};
      for (const sp of lista) {
        if (sp.tipo === 'kg') { const g = sugerir(sp, '', prods, ctx); sug[sp.chave] = { tipo: 'kg', pid: g ? g.pid : null, conf: g ? g.conf : '', alts: ctx.ultAlts }; }
        else { const ops = {}, confs = {}, alts = {}; for (const r of sp.opcoes) { const g = sugerir(sp, r, prods, ctx); ops[r] = g ? g.pid : null; confs[r] = g ? g.conf : ''; alts[r] = ctx.ultAlts; } sug[sp.chave] = { tipo: 'op', ops, confs, alts }; }
      }
      return json(res, 200, { lojaSite: loja.site.lojaSite, fardoPadrao: FARDO[loja.site.lojaSite] || 10, produtos: lista, ligacoes: loja.site.ligacoes || {}, sugestoes: sug });
    }
    if (req.method !== 'POST') return json(res, 405, { erro: 'metodo' });
    const b = await corpo(req, 512 * 1024), lid = lidDe(b.lojaId);
    if (!lid) return json(res, 403, { erro: 'permissao' });
    const dono = S.papel === 'dono';
    if (p === '/api/site/conectar') {
      if (!dono) return json(res, 403, { erro: 'permissao', msg: 'Só o dono conecta o site.' });
      const u = urlValida(b.url), token = String(b.token || '').trim();
      if (!u) return json(res, 400, { erro: 'url', msg: 'Endereço inválido. Escreva o endereço do site, por exemplo: dluemporiobras.com.br' });
      if (token.length < 16) return json(res, 400, { erro: 'token', msg: 'O token parece incompleto.' });
      const seg = { url: u, token };
      let fila; try { fila = await chamar(seg, '/api/painel/pedidos'); } catch (e) { return json(res, 400, { erro: 'teste', msg: e.classificado ? e.message : 'Não consegui falar com o site nesse endereço. Confira o endereço e a internet.', detalhe: e.detalhe || String(e.message || '').slice(0, 160) }); }
      const lojaSite = fila && fila.loja; if (!lojaSite) return json(res, 400, { erro: 'teste', msg: 'Esse endereço não parece ser o site da loja.' });
      try { await catalogo(seg, lojaSite); } catch (e) { return json(res, 400, { erro: 'catalogo', msg: e.message, detalhe: e.detalhe || '' }); }
      fs.writeFileSync(arqSegredo(lid), JSON.stringify({ url: u, token: cifrar(token) }));
      const ant = ((await lojaDoc(lid)) || {}).site || {};
      await abrirCol('lojas').updateAsync({ _id: lid }, { $set: { site: { ...ant, url: u, lojaSite, conectadoEm: new Date().toISOString(), ativo: ant.ativo !== false, ultimoErro: '', ultimoDetalhe: '', assinatura: '' } } }, {});
      enviar({ t: 'chg', col: 'lojas' });
      return json(res, 200, { ok: true, lojaSite });
    }
    if (p === '/api/site/desconectar') {
      if (!dono) return json(res, 403, { erro: 'permissao' });
      try { fs.unlinkSync(arqSegredo(lid)); } catch (e) {}
      await abrirCol('lojas').updateAsync({ _id: lid }, { $unset: { site: true } }, {}); enviar({ t: 'chg', col: 'lojas' });
      return json(res, 200, { ok: true });
    }
    if (p === '/api/site/config') {
      const loja = await lojaDoc(lid); if (!loja || !loja.site) return json(res, 400, { erro: 'conectar' });
      const c = {}; if ('ativo' in b) c.ativo = !!b.ativo; if ('emFalta' in b) c.emFalta = !!b.emFalta;
      if (b.atacado && typeof b.atacado === 'object') {
        const a = b.atacado, kg = Number(String(a.minKg).replace(',', '.')), un = Number(a.minUn);
        if (!(kg > 0 && kg <= 1000) || !(un >= 1 && un <= 10000)) return json(res, 400, { erro: 'atacado', msg: 'Confira as quantidades do atacado (a granel em kg e potes em unidades).' });
        c.atacado = { ativo: a.ativo !== false, minKg: Math.round(kg * 1000) / 1000, minUn: Math.round(un) };
      }
      if (b.desconto && typeof b.desconto === 'object') {
        const d = b.desconto, pct = Number(String(d.pct).replace(',', '.')), min = Number(String(d.min).replace(',', '.'));
        if (!(pct > 0 && pct <= 30) || !(min >= 0 && min <= 100000)) return json(res, 400, { erro: 'desconto', msg: 'Confira o desconto: de 0,1% a 30% e um valor mínimo de compra.' });
        c.desconto = { ativo: d.ativo !== false, pct: Math.round(pct * 10) / 10, min: Math.round(min * 100) / 100, formas: ['pix', 'dinheiro'] };
      }
      await marcar(lid, c); if (c.ativo || c.atacado || c.desconto) avisarMudanca();
      return json(res, 200, { ok: true });
    }
    if (p === '/api/site/ligacoes') {
      const loja = await lojaDoc(lid); if (!loja || !loja.site) return json(res, 400, { erro: 'conectar' });
      const ids = new Set((await abrirCol(`lojas/${lid}/produtos`).findAsync({})).map(x => x._id));
      const limpo = {};
      for (const [k, v] of Object.entries(b.ligacoes && typeof b.ligacoes === 'object' ? b.ligacoes : {})) {
        const ch = String(k).slice(0, 120); if (!v) continue;
        if (v.tipo === 'kg' && ids.has(v.pid)) { limpo[ch] = { tipo: 'kg', pid: v.pid }; const f = Number(v.fardo); if (v.fardo != null && f >= 0 && f <= 100) limpo[ch].fardo = Math.round(f); }
        if (v.tipo === 'op') { const ops = {}; for (const [r, pid] of Object.entries(v.ops || {})) if (ids.has(pid)) ops[String(r).slice(0, 40)] = pid; if (Object.keys(ops).length) limpo[ch] = { tipo: 'op', ops }; }
      }
      await marcar(lid, { ligacoes: limpo }); avisarMudanca();
      return json(res, 200, { ok: true, ligados: Object.keys(limpo).length });
    }
    if (p === '/api/site/sincronizar') {
      try { const r = await sincronizar(lid, { forcarPublicacao: true }); return json(res, 200, { ok: true, ...r }); }
      catch (e) { return json(res, 200, { ok: false, msg: ((await lojaDoc(lid)) || {}).site?.ultimoErro || e.message }); }
    }
    return json(res, 404, { erro: 'rota' });
  }

  return { rota, ciclo, sincronizar, avisarMudanca, _teste: { lerCatalogoSite, produtosDaLoja, sugerir, montarPublicacao, pedidoDoSite } };
};
module.exports.lerCatalogoSite = lerCatalogoSite;
module.exports.produtosDaLoja = produtosDaLoja;
module.exports.sugerir = sugerir;
/* o que as ligações já feitas ensinam: exemplos (texto do site -> produto) para a IA local e as palavras que ficaram de fora */
function contextoLigacoes(lista, lig, prods) {
  const porId = new Map(prods.map(p => [p.id, p])), qualif = new Set(QUALIF_PADRAO), mem = AP ? AP.novaMemoria() : null, fora = new Map(), exemplos = [];
  for (const sp of lista) { const l = lig[sp.chave]; if (!l) continue;
    const pares = l.tipo === 'kg' ? [[sp.nome, porId.get(l.pid)]] : Object.entries(l.ops || {}).map(([o, pid]) => [sp.nome + ' ' + (sp.marca || '') + ' ' + o, porId.get(pid)]);
    for (const [t, p] of pares) { if (!p) continue; exemplos.push([t, p]); if (mem) AP.aprender(mem, t, p, { peso: 2 });
      if (l.tipo === 'kg') { const pw = palavras(p.nome); for (const w of palavras(sp.nome)) if (w.length >= 3 && !FORMA[w] && !/\d/.test(w) && !pw.some(x => x.slice(0, 5) === w.slice(0, 5))) fora.set(w, (fora.get(w) || 0) + 1); } } }
  for (const [w] of fora) qualif.add(w);
  return { mem, qualif, nuc: new Map(), exemplos, aprendidas: [...fora.keys()] };
}
// para os testes (test/medir-ligacoes.js)
module.exports._teste = { sugerir, produtosDaLoja, lerCatalogoSite, contextoLigacoes };
