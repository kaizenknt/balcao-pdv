/* Casar cada linha de pedido (Ficha de Pesagem, WhatsApp, site, nota de entrada) com um produto da loja.
   Ordem: nome já corrigido antes nesta loja (apelido aprendido/cadastrado) > apelido padrão > código enviado pelo app > pontuação.
   Pontuação: cada palavra vale pelo quanto ela distingue um produto dos outros na lista da loja (palavra rara vale mais,
   "tempero" e "pimenta" valem pouco). Aceita sinônimos (colorau = colorífico = coloral), erros de digitação com som parecido
   (ç/c, ss/s, ch/x, l/u no fim), plural, qualquer ordem das palavras e o tamanho da embalagem (500 g, 1 kg, 200 ml).
   Regras: linha com peso só casa com produto vendido por quilo (a não ser que o peso seja o tamanho de um pacote igual);
   palavra da linha que não está no produto pesa contra; produto com marca, embalagem ou tamanho que a linha não pediu perde para o simples.
   Confiança: "alta" só quando a linha cobre o produto e nenhum outro produto serve igual; com dúvida devolve "media"/"baixa"
   (a tela pede para conferir) ou nada (a tela pede para escolher). Errar com certeza é o pior caso: na dúvida, pergunta. */
(function (raiz) {
  'use strict';
  const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ---------- texto ---------- */
  // abreviações comuns nas fichas, no WhatsApp e nos nomes de produto
  const ABREV = [[/\bpim\.?(?=\s|$)/g, 'pimenta'], [/\btemp\.?(?=\s|$)/g, 'tempero'], [/(^|\s)t\.\s*(?=[a-z])/g, '$1tempero '], [/\bc\//g, 'com '], [/\bs\//g, 'sem '], [/\bp\//g, 'para '], [/\bp\.?(?=\s)/g, 'para'],
    [/\bdesid\.?(?=\s|$)/g, 'desidratado'], [/\bdef\.?(?=\s|$)/g, 'defumada'], [/\bmoid\.?(?=\s|$)/g, 'moida'], [/\bnat\.?(?=\s|$)/g, 'natural'], [/\bchimi(?=\s|$)/g, 'chimichurri'], [/\bcond\.?(?=\s|$)/g, 'condimento'],
    [/\bsbr\.?(?=\s|$)/g, 'sabor'], [/\bgr\.?(?=\s|$)/g, 'g']];
  // nomes diferentes da mesma coisa (frases inteiras primeiro, depois palavra por palavra)
  const FRASES = [[/\bacafrao da terra\b/g, 'curcuma'], [/\bcravo da india\b/g, 'cravo'], [/\bbicarbonato de sodio\b/g, 'bicarbonato'], [/\bdu bom\b/g, 'dubom'], [/\bsal (rosa )?do himalaia\b/g, 'sal rosa'],
    [/\bsal himalaia\b/g, 'sal rosa'], [/\bpimenta da jamaica\b/g, 'pimenta jamaica'], [/\bpimenta do reino preta\b/g, 'pimenta do reino'], [/\bpimenta[- ]?do[- ]?reino\b/g, 'pimenta do reino'],
    [/\bcanela em pau\b/g, 'canela pau'], [/\bnoz[- ]moscada\b/g, 'noz moscada'], [/\bem po\b/g, 'po'], [/\bpimenta do reino (em )?grao\b/g, 'pimenta preta grao'], [/\bmix de nuts?\b/g, 'mix nut'], [/\bmix nuts\b/g, 'mix nut']];
  const FRASES_LINHA = [[/^lemon$/, 'lemon pepper'], [/^pipoca$/, 'milho pipoca'], [/^chimichurri tradicional$/, 'chimichurri']];   // só na linha inteira do pedido
  const SINONIMOS = { colorau: 'coloral', colorao: 'coloral', colorifico: 'coloral', colorificos: 'coloral', urucum: 'coloral', paprika: 'paprica', papricas: 'paprica', cayenne: 'caiena', cayena: 'caiena', caienna: 'caiena',
    chimichurry: 'chimichurri', chimichuri: 'chimichurri', salsinha: 'salsa', cravinho: 'cravo', cravinhos: 'cravo', polvilho: 'povilho', ajinomoto: 'glutamato', caril: 'curry', zaatar: 'zathar', zatar: 'zathar', zahtar: 'zathar',
    po: 'moido', moida: 'moido', moidas: 'moido', moidos: 'moido', triturada: 'moido', graos: 'grao', kilo: 'kg', quilo: 'kg', kilos: 'kg', quilos: 'kg', nuts: 'nut', capsulas: 'caps', capsula: 'caps', cps: 'caps',
    pacote: 'pct', pacotes: 'pct', pcts: 'pct', pacotinho: 'pct', caixa: 'cx', caixas: 'cx', frascos: 'frasco', potes: 'pote', latas: 'lata', unidade: 'un', unidades: 'un', und: 'un', unid: 'un',
    chef: 'chefe', defumado: 'defumada', defumados: 'defumada', defumadas: 'defumada', apimentado: 'pimenta', apimentada: 'pimenta', picante: 'picante' };
  const PARADA = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'e', 'o', 'a', 'os', 'as', 'para', 'tipo', 'cod', 'no', 'na', 'ao', 'pra', 'pro', 'um', 'uma', 'n']);
  const UNID = new Set(['kg', 'g', 'gr', 'grs', 'grama', 'gramas', 'kilo', 'kilos', 'quilo', 'quilos', 'k', 'un', 'und', 'unid', 'unidade', 'unidades', 'ml', 'l', 'lt', 'litro', 'litros', 'mg', 'cps', 'caps', 'pct', 'cx', 'meio']);
  // palavras de embalagem e marcas comuns em loja de temperos (o nome do granel não tem)
  const EMBALAGEM = new Set(['frasco', 'vidro', 'pct', 'pacote', 'pote', 'sache', 'sachet', 'lata', 'caixa', 'cx', 'balde', 'garrafa', 'pet', 'spray', 'sprey', 'refil', 'kit', 'display', 'blister', 'bisnaga', 'agranel', 'granel']);
  const MARCAS = new Set(['almaromi', 'almori', 'nativa', 'nativas', 'tempera', 'jomil', 'penina', 'capsum', 'kidende', 'satelite', 'lisboa', 'interessa', 'jgm', 'fortaleza', 'aroma', 'talisca', 'taliscca', 'viccino', 'castelo', 'apisnutri',
    'canaa', 'natunectar', 'tia', 'benta', 'savana', 'dna', 'topnatus', 'miragina', 'pelicula', 'poush', 'copra', 'bonadio', 'prodapys', 'hanner', 'fogo', 'mineiro', 'bella', 'minas', 'ana', 'foods', 'santo', 'gota', 'villa', 'rica',
    'serra', 'gaucha', 'sao', 'roque', 'dlu', 'gold', 'tani', 'dubom', 'muniz', 'lopes', 'pantanal', 'itaguacu', 'dhorta', 'sanper', 'belacor', 'big', 'qualicoco', 'minamel', 'miromel', 'unilife', 'euroflora', 'apinil', 'vitty', 'akio',
    'foco', 'king', 'emporio', 'bem', 'ba', 'kamar', 'ouromar', 'sertao', 'casa']);
  // palavras que quase todo nome tem: valem pouco (na linha um pouco mais, para "chá preto" não virar "pimenta preta")
  const GENERICO = new Set(['tempero', 'pimenta', 'condimento', 'condimentado', 'condimentada', 'semente', 'folha', 'folhas', 'cha', 'desidratado', 'desidratada', 'natural', 'especiaria', 'dente', 'tradicional', 'grande', 'extrato']);
  // palavras de conversa (não são produto)
  // (na linha valem quase nada; "bom dia", "tudo", "casa" e "são" também são nome de produto, por isso não são apagadas)
  const CONVERSA = new Set(['quero', 'qero', 'queria', 'kero', 'preciso', 'gostaria', 'manda', 'mande', 'mandar', 'me', 've', 'tbm', 'tb', 'tambem', 'favor', 'pfv', 'pf', 'obg', 'obrigado', 'obrigada', 'ai', 'mais', 'so', 'isso',
    'oi', 'ola', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem', 'por', 'pode', 'ser', 'ate', 'vou', 'vai', 'reais', 'real', 'total', 'troco', 'pix', 'cartao', 'vezes', 'entrega', 'entregar', 'retiro', 'retirar', 'buscar',
    'busco', 'passo', 'chego', 'minutos', 'minuto', 'hora', 'horas', 'amanha', 'hoje', 'rua', 'ap', 'apto', 'apartamento', 'numero', 'casa', 'sacola', 'sacolas', 'pedido', 'pedidos', 'moro', 'sao', 'dias', 'cedo', 'depois', 'pegar', 'levar', 'separar', 'reservar', 'deixar', 'trazer', 'mandar', 'enviar']);
  const CONVERSA_FORTE = new Set(['quero', 'qero', 'queria', 'kero', 'preciso', 'gostaria', 'manda', 'mande', 'mandar', 'me', 've', 'tbm', 'tb', 'tambem', 'favor', 'pfv', 'pf', 'obg', 'obrigado', 'obrigada', 'ai', 'isso', 'oi', 'ola', 'pode', 'ser', 'vou', 'vai']);
  const ehNum = w => /^\d+([.,]\d+)?%?$/.test(w);
  const TAM_RE = /^(\d+(?:[.,]\d+)?)(kg|k|g|gr|grs|mg|ml|l|lt|litro|litros|caps|cps|un|und)$/;
  const temNumUnid = w => TAM_RE.test(w) || /^\d+([.,]\d+)?(cm|mm)$/.test(w);
  const raizP = w => { if (w.length <= 3 || /\d/.test(w)) return w; let r = w.replace(/(oes|aes)$/, 'ao').replace(/(ais|eis|ois)$/, '').replace(/ns$/, 'm').replace(/(es|s)$/, ''); if (r.length > 3) r = r.replace(/[aoe]$/, ''); return r.length >= 3 ? r : w; };
  function limpar(s) {
    let t = norm(s); for (const [re, v] of ABREV) t = t.replace(re, v);
    return t.replace(/(\d)\s+(ml|l|lt|g|gr|grs|kg|mg|mm|cm|caps|cps)\b/g, '$1$2').replace(/(\d),(?=\d)/g, '$1.').replace(/[^a-z0-9.%]+/g, ' ').replace(/(^|\s)\.+|\.+(\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // chave para lembrar a correção: "Limão  Siciliano!" -> "limao siciliano" (não mudar: os apelidos guardados usam esta chave)
  function limparV1(s) { let t = norm(s); for (const [re, v] of ABREV.slice(0, 10)) t = t.replace(re, v); return t.replace(/(\d)\s+(ml|l|lt|g|gr|kg|mg)\b/g, '$1$2').replace(/[^a-z0-9.,]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  const PARADA1 = new Set(['de', 'da', 'do', 'das', 'dos', 'em', 'e', 'o', 'a', 'os', 'as', 'para', 'tipo', 'cod']);
  const UNID1 = new Set(['kg', 'g', 'gr', 'grs', 'grama', 'gramas', 'kilo', 'kilos', 'quilo', 'quilos', 'k', 'un', 'und', 'unid', 'unidade', 'unidades', 'ml', 'l', 'lt', 'litro', 'litros', 'mg', 'cps', 'caps']);
  const temNumUnid1 = w => /^\d+([.,]\d+)?(ml|l|lt|g|gr|kg|mg|cm|cps|caps|un)$/.test(w);
  function chave(s) { return limparV1(s).split(' ').filter(w => w && !PARADA1.has(w) && !UNID1.has(w) && !/^\d+([.,]\d+)?$/.test(w) && !temNumUnid1(w)).join(' '); }

  // som parecido: "chimichurry" ~ "ximixuri", "colorau" ~ "coloral", "psilium" ~ "psyllium", "nós" ~ "noz"
  function fon(w) {
    if (/\d/.test(w)) return w;
    return w.replace(/ph/g, 'f').replace(/y/g, 'i').replace(/w/g, 'v').replace(/sch|ch|sh/g, 'x').replace(/lh/g, 'l').replace(/nh/g, 'n').replace(/h/g, '')
      .replace(/qu(?=[ei])/g, 'k').replace(/qu/g, 'kw').replace(/gu(?=[ei])/g, 'G').replace(/g(?=[ei])/g, 'j').replace(/G/g, 'g').replace(/sc(?=[ei])/g, 's').replace(/xc(?=[ei])/g, 's').replace(/c(?=[ei])/g, 's').replace(/c/g, 'k')
      .replace(/z/g, 's').replace(/(.)\1+/g, '$1').replace(/l$/, 'u').replace(/m$/, 'n').replace(/e$/, 'i').replace(/o$/, 'u').replace(/n(?=[pb])/g, 'm');
  }
  // distância de edição com troca de letras vizinhas ("papirca" ~ "paprica" = 1)
  function dl(a, b, max) {
    const m = a.length, n = b.length; if (Math.abs(m - n) > max) return max + 1;
    let p2 = null, p = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const c = [i]; let menor = i;
      for (let j = 1; j <= n; j++) {
        let v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (p2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, p2[j - 2] + 1);
        c[j] = v; if (v < menor) menor = v;
      }
      if (menor > max) return max + 1; p2 = p; p = c;
    }
    return p[n];
  }
  // tamanho escrito no nome: 500g, 1kg, 1,1k, 200ml, 1l, 60caps -> {v, d}
  function tamanhoDe(w) {
    const m = TAM_RE.exec(w); if (!m) return null; const v = parseFloat(m[1]), u = m[2];
    if (u === 'kg' || u === 'k') return { v: v * 1000, d: 'g' }; if (/^(g|gr|grs)$/.test(u)) return { v, d: 'g' }; if (u === 'mg') return null;
    if (u === 'ml') return { v, d: 'ml' }; if (/^(l|lt|litro|litros)$/.test(u)) return { v: v * 1000, d: 'ml' }; if (/^(caps|cps)$/.test(u)) return { v, d: 'caps' }; return null;
  }
  const mesmoTam = (a, b) => a && b && a.d === b.d && Math.abs(a.v - b.v) <= Math.max(2, a.v * 0.02);

  /* tokens de um texto: [{c: canônico, f: som, r: raiz}], tamanhos, embalagens */
  function analisar(texto, linha) {
    let t = limpar(texto).replace(/(\d)\s+(?=(litro|litros|kg|kilo|quilo)\b)/g, '$1').replace(/(\d+(?:\.\d+)?)(kilo|quilo|kilos|quilos)\b/g, '$1kg');
    for (const [re, v] of FRASES) t = t.replace(re, v);
    if (linha) { const so = t.split(' ').filter(w => w && !PARADA.has(w) && !CONVERSA.has(w) && !ehNum(w) && !TAM_RE.test(w) && !UNID.has(w)).join(' '); for (const [re, v] of FRASES_LINHA) if (re.test(so)) t = t.replace(so, v); }
    const toks = [], tams = [], emb = new Set();
    for (let w of t.split(' ')) {
      if (!w) continue;
      const tm = tamanhoDe(w); if (tm) { tams.push(tm); continue; }
      if (ehNum(w) || TAM_RE.test(w)) continue;
      w = SINONIMOS[w] || w;
      if (EMBALAGEM.has(w)) { emb.add(w === 'pacote' ? 'pct' : w === 'caixa' ? 'cx' : w); continue; }
      if (w === 'caps') { emb.add('caps'); continue; }
      if (w.length < 2 || PARADA.has(w) || UNID.has(w)) continue;
      if (linha && CONVERSA_FORTE.has(w)) continue;
      const ant = toks[toks.length - 1], depoisDeCom = ant && (ant.c === 'com' || ant.c === 'sem');   // "c/ pimenta" é variação, não palavra genérica
      toks.push({ c: w, f: fon(w), r: fon(raizP(w)), g: GENERICO.has(w) && !depoisDeCom, m: MARCAS.has(w), conversa: linha && CONVERSA.has(w) });
    }
    return { toks, tams, emb };
  }

  /* ---------- índice da lista de produtos (feito uma vez por lista) ---------- */
  let IDX = null;
  function indice(produtos) {
    let ass = produtos.length; for (const p of produtos) { const n = p && p.nome ? String(p.nome) : ''; ass = (ass * 31 + n.length * 7 + (n.charCodeAt(0) | 0) + (n.charCodeAt(n.length >> 1) | 0) * 3 + (p && p.unidade === 'kg' ? 1 : 2) + (p && p.ativo === false ? 5 : 0)) % 2147483647; }
    if (IDX && IDX.ref === produtos && IDX.ass === ass) return IDX;   // lista mudou (nome, unidade, ativo): refaz
    const df = new Map(), info = new Map(), vocab = new Map(), lista = new Map();
    for (const p of produtos) {
      if (!p || p.ativo === false || !p.nome) continue;
      const a = analisar(p.nome, false), vistos = new Set();
      const base = String(p.nome).replace(/\s*\(c[oó]d\.?\s*\d+\)\s*$/i, '').trim();
      info.set(p, { ...a, base: norm(base), dup: base !== String(p.nome).trim(), tam: a.tams[0] || null, chave: a.toks.map(x => x.r).sort().join(' ') });
      for (const x of a.toks) { if (!vistos.has(x.r)) { vistos.add(x.r); df.set(x.r, (df.get(x.r) || 0) + 1); } if (!vocab.has(x.c)) { vocab.set(x.c, x); lista.set(x.c, []); } const l = lista.get(x.c); if (l[l.length - 1] !== p) l.push(p); }
    }
    const N = produtos.length;
    IDX = { ref: produtos, ass, n: produtos.length, df, info, vocab: [...vocab.values()], lista, viz: new Map(), N, idf: r => 1 + Math.log((N + 1) / ((df.get(r) || 0) + 0.5)), idfMax: 1 + Math.log((N + 1) / 0.5) };   // o +1 segura listas pequenas
    return IDX;
  }
  // quanto uma palavra da linha (a) parece com uma do produto (b): 1 igual, .97 mesmo som, .93 plural/gênero, .85 erro de digitação, .75 abreviação ou erro em palavra curta
  function parece(a, b) {
    if (a.c === b.c) return [1, 0];
    if (a.f === b.f) return [0.97, 0];
    if (a.r === b.r && a.r.length >= 3) return [0.93, 0];
    const la = a.f.length, lb = b.f.length, min = Math.min(la, lb);
    if (min >= 5) { const d = dl(a.f, b.f, 2); if (d === 1) return [0.86, min >= 6 ? 1 : 2]; if (d === 2 && min >= 8) return [0.76, 2]; }
    else if (min === 4 && a.f[0] === b.f[0] && dl(a.f, b.f, 1) === 1) return [0.72, 2];
    if (la >= 4 && lb > la + 1 && b.f.startsWith(a.f)) return [0.78, 2];   // "calab" -> calabresa
    return [0, 0];
  }

  /* ---------- leitura de uma linha de pedido: "2 pct cominho 500g", "meio kilo de colorau", "ana maria 500" ---------- */
  const NUM = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10 };
  const U_RE = '(kg|kgs|k|kilos?|quilos?|g|gr|grs|gramas?|mg|ml|l|lt|litros?|pacotes?|pcts?|pct|pacotinhos?|potes?|un|und|unid|unidades?|cx|caixas?|frascos?|latas?|vidros?|sache?s?|saquinhos?|caps|cps|capsulas)';
  function unidadeCurta(u) {
    u = norm(u || ''); if (!u) return '';
    if (/^(kg|kgs|k$|kilo|quilo)/.test(u)) return 'kg'; if (/^(g|gr|grs|grama)/.test(u)) return 'g'; if (u === 'ml') return 'ml'; if (/^(l|lt|litro)/.test(u)) return 'l';
    if (/^(pac|pct)/.test(u)) return 'pct'; if (/^pot/.test(u)) return 'pote'; if (/^(cx|caixa)/.test(u)) return 'cx'; if (/^(frasco|vidro)/.test(u)) return 'frasco'; if (/^lata/.test(u)) return 'lata';
    if (/^(caps|cps|capsula)/.test(u)) return 'caps'; if (/^(sach|saquinho)/.test(u)) return 'sache'; return 'un';
  }
  function lerLinha(texto, opc) {
    opc = opc || {};
    let t = ' ' + norm(texto).replace(/[*_~]/g, ' ').replace(/\s+/g, ' ') + ' ';
    t = t.replace(/\b\d{1,2}h\d{2}\b/g, ' ').replace(/\b(\d{1,2})\s*(h|hs|hrs|horas?)\b/g, ' ').replace(/\b\d{1,2}:\d{2}\b/g, ' ').replace(/r\$\s*\d+([.,]\d+)?/g, ' ');   // horário e dinheiro não são quantidade
    t = t.replace(/\b(\d+)\s*(kg|kilos?|quilos?)\s+e\s+meio\b/g, (_, n) => ` ${+n * 1000 + 500}g `).replace(/\bum\s+(kg|kilo|quilo)\s+e\s+meio\b/g, ' 1500g ')
      .replace(/\b(meio|1\/2)\s*(kg|kilo|quilo)\b/g, ' 500g ').replace(/\b(1\/4)\s*(de\s+)?(kg|kilo|quilo)\b/g, ' 250g ').replace(/\bmeia\s+duzia\b/g, ' 6 ').replace(/\b(meio|1\/2)\s+pacote\b/g, ' 1 pct ')
      .replace(/\b(um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+(?=(kg|kilos?|quilos?|pacotes?|pcts?|potes?|unidades?|gramas?|caixas?|frascos?|latas?)\b)/g, (_, w) => ' ' + NUM[w] + ' ')
      .replace(/(\d),(\d)/g, '$1.$2').replace(/\s+/g, ' ');
    let nome = t.trim(), quantidade = null, unidade = '', tamanho = null, m, escrita = false;
    // na frente: "2 ", "2 pct de ", "1kg de ", "500 gr de "
    if ((m = nome.match(new RegExp('^(\\d+(?:\\.\\d+)?)\\s*' + U_RE + '?\\.?\\s+(?:de\\s+|d[aoe]s?\\s+)?(?=[a-z])')))) { quantidade = +m[1]; unidade = unidadeCurta(m[2]); escrita = !!m[2]; nome = nome.slice(m[0].length); }
    else if ((m = nome.match(/^(um|uma|dois|duas|tres|quatro|cinco)\s+(?=[a-z])/))) { quantidade = NUM[m[1]]; unidade = ''; nome = nome.slice(m[0].length); }
    // no fim: "cominho 500g", "cominho - 250 gramas", "ana maria 500", "colorau 1 kg."
    if ((m = nome.match(new RegExp('\\s*[-:=x]?\\s*(\\d+(?:\\.\\d+)?)\\s*' + U_RE + '?\\.?\\s*$')))) {
      const q = +m[1], u = unidadeCurta(m[2]);
      const ehTam = ['g', 'kg', 'ml', 'l', 'caps'].includes(u);
      if (quantidade != null && ehTam && !['g', 'kg'].includes(unidade)) { tamanho = tamanhoDe(String(q) + (u === 'l' ? 'l' : u)); if (!unidade) unidade = 'un'; nome = nome.slice(0, m.index); }
      else if (quantidade == null) {
        quantidade = q; unidade = u; escrita = !!m[2]; nome = nome.slice(0, m.index);
        if (!u && opc.pesagem) unidade = q >= 50 ? 'g' : 'kg';                      // "ana maria 500" na pesagem = 500 g
        if (ehTam && !opc.pesagem) tamanho = tamanhoDe(String(q) + (u === 'l' ? 'l' : u));   // no balcão "mel 500g" pode ser o pote de 500 g
      }
    }
    // no meio: "cominho 500g moído"
    // (no balcão o peso no meio é o tamanho do pacote: "cominho grão 2kg pacote")
    if (quantidade == null && opc.pesagem && (m = nome.match(/(^|\s)(\d+(?:\.\d+)?)\s*(kg|kilos?|quilos?|g|gr|grs|gramas?)(?=\s|$)/))) { quantidade = +m[2]; unidade = unidadeCurta(m[3]); escrita = true; nome = (nome.slice(0, m.index) + ' ' + nome.slice(m.index + m[0].length)).replace(/\s+/g, ' ').trim(); }
    if (quantidade != null && !unidade) unidade = opc.pesagem ? (quantidade >= 50 ? 'g' : 'kg') : 'un';
    nome = nome.replace(/\s*[-:=]\s*$/, '').replace(/^(de|d[aoe]s?)\s+/, '').trim();
    return { nome, quantidade, unidade, tamanho, unidadeEscrita: escrita };
  }
  // o texto é só conversa ("retiro as", "troco pra", "obrigada")? então não é item
  function ehConversa(texto) { const a = analisar(texto, true); return !a.toks.length || a.toks.every(x => x.conversa); }

  // a linha é de peso? (kg, g, número quebrado) ou de contagem (un, pacote, frasco, ml)?
  function tipoQtd(it) {
    const u = norm(it.unidade || ''), q = Number(String(it.quantidade == null ? '' : it.quantidade).replace(',', '.'));
    if (/^(kg|k|kilo|quilo|g|gr|grs|grama)/.test(u)) return 'peso';
    if (/^(un|unid|pac|pct|pote|frasco|vidro|garraf|lata|caixa|cx|ml|l$|lt|litro|sache|balde|caps)/.test(u)) return 'conta';
    if (isFinite(q) && q > 0 && Math.round(q) !== q) return 'peso';
    const n = norm(it.nome || ''); if (/\b\d+([.,]\d+)?\s*(kg|g|gr)\b/.test(n)) return 'peso'; if (/\b\d+\s*(un|unid|pct|pacotes?|frascos?|potes?|ml)\b/.test(n)) return 'conta';
    return it.pesagem ? 'peso' : '';
  }
  const PADRAO_APELIDOS = [{ texto: 'limao siciliano', alvo: 'limao natural' }];

  /* it: {nome, codigo, quantidade, unidade, tamanho?}; produtos: [{id, nome, codigo, unidade, ativo}]; apelidos: [{texto, pid}]; opc: {pesagem}
     devolve {p, conf: 'alta'|'media'|'baixa'|'', motivo, score, alternativas, candidatos (até 10, para a IA), sugestao} */
  function casar(it, produtos, apelidos, opc) {
    opc = opc || {};
    const P = (produtos || []).filter(p => p && p.ativo !== false), tq = tipoQtd({ ...it, pesagem: opc.pesagem });
    const k = chave(it.nome);
    const coerente0 = p => !(tq === 'peso' && p.unidade !== 'kg');
    // 1) correção lembrada nesta loja
    const ap = (apelidos || []).find(a => a.texto === k && a.pid);
    if (ap) { const p = P.find(x => x.id === ap.pid); if (p && coerente0(p)) return { p, conf: 'alta', motivo: 'lembrado', score: 1 }; }
    // 2) apelido padrão (texto -> nome do produto)
    const pd = PADRAO_APELIDOS.find(a => a.texto === k);
    if (pd && tq !== 'conta') { const c = P.filter(x => coerente0(x) && chave(x.nome).startsWith(pd.alvo)); if (c.length) return { p: c.sort((a, b) => a.nome.length - b.nome.length)[0], conf: 'alta', motivo: 'apelido', score: 1 }; }
    // 3) código enviado pelo app, se a unidade bate
    if (it.codigo) { const p = P.find(x => String(x.codigo) === String(it.codigo)); if (p && coerente0(p)) return { p, conf: 'alta', motivo: 'codigo', score: 1 }; }
    // 4) pontuação
    const X = indice(produtos || []), L = analisar(it.nome, true);
    const tamL = it.tamanho || L.tams[0] || null;
    const coerente = (p, inf) => coerente0(p) || (!opc.pesagem && tamL && mesmoTam(tamL, inf.tam));   // "mel 500g" no balcão: o pote de 500 g serve
    if (!L.toks.length) return { p: null, conf: '', motivo: 'vazio', score: 0 };
    const pesoL = L.toks.map(x => X.df.has(x.r) ? X.idf(x.r) : X.idfMax * 0.8);
    if (!L.toks.some(x => !x.conversa)) return { p: null, conf: '', motivo: 'vazio', score: 0 };
    const wL = L.toks.map((x, i) => x.conversa ? 0.15 : x.c === 'com' || x.c === 'sem' ? 1.5 : pesoL[i] * (x.g ? 0.5 : x.m ? 0.6 : 1)), somaL = wL.reduce((a, b) => a + b, 0);
    // palavras do vocabulário parecidas com cada palavra da linha
    const viz = L.toks.map(a => {
      let m = X.viz.get(a.c); if (m) return m;
      m = new Map(); for (const b of X.vocab) { const s = parece(a, b); if (s[0]) m.set(b.c, s); }
      if (X.viz.size > 20000) X.viz.clear(); X.viz.set(a.c, m); return m;
    });
    const talvez = new Set(); for (const m of viz) for (const c of m.keys()) for (const p of X.lista.get(c)) talvez.add(p);   // só os produtos que têm alguma palavra parecida
    const embL = new Set([...L.emb, ...(['pct', 'cx', 'pote', 'frasco', 'lata'].includes(unidadeCurta(it.unidade)) ? [unidadeCurta(it.unidade)] : [])]);
    const temSem = L.toks.some(x => x.c === 'sem'), temCom = L.toks.some(x => x.c === 'com');
    const cands = [];
    for (const p of talvez) {
      const inf = X.info.get(p); if (!inf || !inf.toks.length) continue;
      // casamento palavra a palavra (cada palavra do produto serve uma vez)
      const usados = new Array(inf.toks.length).fill(0); let cobre = 0, fraco = 0, achou = 0, fuzzyBom = 0;
      L.toks.forEach((a, i) => {
        let b = 0, q = -1, tipo = 0;
        inf.toks.forEach((x, j) => { if (usados[j]) return; const s = viz[i].get(x.c); if (s && s[0] > b) { b = s[0]; q = j; tipo = s[1]; } });
        if (q >= 0) { usados[q] = b; cobre += wL[i] * b; achou++; if (tipo === 2 && !a.g) fraco++; if (tipo === 1) fuzzyBom++; }
      });
      if (!achou) continue;
      const wP = inf.toks.map(x => x.c === 'com' || x.c === 'sem' ? 1.5 : X.idf(x.r) * (x.g ? 0.3 : x.m ? 0.5 : 1)), somaP = wP.reduce((a, b) => a + b, 0);
      const cobreP = inf.toks.reduce((s, x, j) => s + wP[j] * usados[j], 0) / (somaP || 1);
      const cobreL = cobre / (somaL || 1);
      let sc = 0.62 * cobreL + 0.38 * cobreP;
      const sobra = inf.toks.filter((x, j) => !usados[j]);
      // palavra principal do produto (a primeira que não é genérica) ficou de fora: "arroz" não é "sazon de arroz"
      const cab = inf.toks.findIndex(x => !x.g && !x.m && x.c !== 'com' && x.c !== 'sem');
      const semCabeca = cab >= 0 && !usados[cab];
      if (semCabeca) sc -= 0.2;
      if ((temSem && inf.toks.some(x => x.c === 'com')) || (temCom && inf.toks.some(x => x.c === 'sem'))) sc -= 0.3;
      // marca e embalagem que a linha não pediu: prefere o produto simples
      sc -= Math.min(0.08, sobra.filter(x => x.m).length * 0.04);
      if (sobra.some(x => x.c === 'com' || x.c === 'sem')) sc -= 0.05;   // "cominho" é o cominho simples, não o "com pimenta"
      for (const e of inf.emb) if (!embL.has(e)) sc -= tq === 'peso' || opc.pesagem ? 0.05 : 0.02;
      for (const e of embL) if (e !== 'caps' && inf.emb.has(e)) sc += 0.04; else if (e !== 'caps' && inf.emb.size && !inf.emb.has(e)) sc -= 0.04;
      // tamanho da embalagem
      if (tamL && inf.tam) sc += mesmoTam(tamL, inf.tam) ? 0.12 : -0.35;
      else if (inf.tam && !tamL) sc -= 0.04;
      else if (tamL && !inf.tam && p.unidade !== 'kg') sc -= 0.05;
      // unidade: contagem vai para produto por unidade; ficha de pesagem: empate vai para o granel
      if (tq === 'conta' && p.unidade === 'kg') sc -= 0.15;
      if (tq === '' && opc.pesagem !== false && p.unidade === 'kg') sc += 0.02;
      if (inf.dup) sc -= 0.005;   // nome repetido com "(cód ...)": prefere o original
      cands.push({ p, inf, sc, cobreL, cobreP, fraco, fuzzyBom, semCabeca, sobra: sobra.filter(x => !x.g), ok: coerente(p, inf) });
    }
    cands.sort((a, b) => b.sc - a.sc || a.p.nome.length - b.p.nome.length);
    const bons = cands.filter(c => c.ok), b1 = bons[0];
    const candidatos = bons.slice(0, 10).map(c => ({ p: c.p, score: Math.round(c.sc * 1000) / 1000 }));
    if (!b1 || b1.sc < 0.5 || b1.cobreL < 0.6) {
      const soUn = cands[0] && !cands[0].ok && cands[0].sc >= 0.6 && cands[0].cobreL >= 0.75;
      return { p: null, conf: '', motivo: soUn ? 'so-unidade' : 'nao-achou', score: b1 ? Math.round(b1.sc * 100) / 100 : 0, sugestao: soUn ? cands[0].p : null, candidatos };
    }
    // segundo colocado de outro nome (os repetidos com "(cód ...)" contam como o mesmo)
    const b2 = bons.find(c => c !== b1 && c.inf.base !== b1.inf.base);
    const folga = b2 ? b1.sc - b2.sc : 1;
    // ambíguo: o produto tem palavras que a linha não disse (variação: caseiro, defumado, grão) e outro produto também cobre a linha toda
    const ambiguo = b1.sobra.length > 0 && !!b2 && b2.cobreL >= b1.cobreL - 0.02 && b2.sc >= b1.sc - 0.25;
    const repetido = bons.filter(c => c !== b1 && c.inf.chave === b1.inf.chave && c.inf.base !== b1.inf.base && c.inf.tam === b1.inf.tam).length > 0;   // dois produtos com o mesmo nome
    let conf;
    if (b1.sc >= 0.8 && folga >= 0.06 && b1.cobreL >= 0.9 && !b1.fraco && !ambiguo && !repetido && !b1.semCabeca) conf = 'alta';
    else if (b1.sc >= 0.62 && b1.cobreL >= 0.75 && !b1.semCabeca && !b1.fraco) conf = 'media';
    else conf = 'baixa';
    return { p: b1.p, conf, motivo: ambiguo ? 'ambiguo' : 'nome', score: Math.round(b1.sc * 100) / 100, alternativas: bons.filter(c => c !== b1).slice(0, 2).map(c => c.p), candidatos };
  }
  const api = { casar, chave, tipoQtd, limpar, lerLinha, ehConversa, unidadeCurta, PADRAO_APELIDOS, _analisar: analisar, _fon: fon };
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.CasarProduto = api;
})(typeof window !== 'undefined' ? window : this);
