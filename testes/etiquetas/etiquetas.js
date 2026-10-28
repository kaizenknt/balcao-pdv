/* Etiquetas de preço (gôndola): código de barras, desenho da etiqueta em SVG (tamanho real, em mm) e comandos
   diretos para impressoras térmicas (Argox PPLA, Zebra ZPL, EPL2/PPLB). Usado no app (navegador) e nos testes (Node). */
(function (raiz, fab) { if (typeof module === 'object' && module.exports) module.exports = fab(); else raiz.Etiquetas = fab(); })(this, function () {
  'use strict';
  const soDig = s => String(s == null ? '' : s).replace(/\D/g, '');
  const pad = (s, n) => String(s).padStart(n, '0');
  // ---------- dígito verificador ----------
  function dvEan(d) { // d sem o dígito (7 para EAN-8, 12 para EAN-13): pesos 3,1,3... a partir da direita
    let t = 0; for (let i = d.length - 1, k = 0; i >= 0; i--, k++) t += Number(d[i]) * (k % 2 ? 1 : 3); return (10 - t % 10) % 10; }
  const eanValido = d => /^\d{8}$|^\d{12,14}$/.test(d) && dvEan(d.slice(0, -1)) === Number(d.slice(-1));
  // ---------- barras (1 = barra, 0 = espaço) ----------
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = L.map(s => s.split('').map(c => c === '1' ? '0' : '1').reverse().join('')), R = L.map(s => s.split('').map(c => c === '1' ? '0' : '1').join(''));
  const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  function barrasEan13(d) { // 13 dígitos (aceita o verificador que vier: o esquema "igual às etiquetas antigas" não tem verificador certo)
    const p = PAR[Number(d[0])]; let b = '101'; for (let i = 1; i <= 6; i++) b += (p[i - 1] === 'L' ? L : G)[Number(d[i])]; b += '01010';
    for (let i = 7; i <= 12; i++) b += R[Number(d[i])]; return b + '101'; }
  function barrasEan8(d) { let b = '101'; for (let i = 0; i < 4; i++) b += L[Number(d[i])]; b += '01010'; for (let i = 4; i < 8; i++) b += R[Number(d[i])]; return b + '101'; }
  const C128 = ['212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111', '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112'];
  function barrasCode128(t) { // conjunto C para números pares, B para o resto
    t = String(t); const cods = []; const soNum = /^\d+$/.test(t) && t.length % 2 === 0;
    if (soNum) { cods.push(105); for (let i = 0; i < t.length; i += 2) cods.push(Number(t.slice(i, i + 2))); }
    else { cods.push(104); for (const ch of t) { const c = ch.charCodeAt(0); cods.push(c >= 32 && c < 128 ? c - 32 : 0); } }
    let s = cods[0]; for (let i = 1; i < cods.length; i++) s += cods[i] * i; cods.push(s % 103); cods.push(106);
    let b = ''; for (const c of cods) { const w = C128[c]; for (let i = 0; i < w.length; i++) b += (i % 2 ? '0' : '1').repeat(Number(w[i])); } return b; }

  // ---------- qual código vai na etiqueta ----------
  // produto com EAN de verdade (fabricante): o próprio EAN. Produto da casa (granel): código interno 2 + código curto com 6 dígitos
  // (17 -> 2000017, como o sistema antigo), em um destes esquemas:
  //   ean13  (padrão) 0000020000172: EAN-13 com verificador certo, qualquer leitor lê; o caixa entende como 2000017
  //   ean8   20000172: EAN-8, mais curto (etiqueta pequena)
  //   antigo 0000002000017: igual às etiquetas antigas (o último dígito não é verificador; só leitor com a conferência desligada lê)
  const ESQUEMAS = { ean13: 'EAN-13 (recomendado)', ean8: 'EAN-8 (mais curto)', antigo: 'Igual às etiquetas antigas', nenhum: 'Sem código de barras' };
  function eanDoProduto(p) {
    for (const c of [p.codigoBarras, p.codigo, p.codigoOrigem]) { const d = soDig(c); if (String(c || '').trim() !== d) continue;
      if ((d.length === 13 || d.length === 8) && eanValido(d) && !/^2/.test(d) && !/^0{5}2/.test(d)) return d;
      if (d.length === 12 && eanValido(d)) return '0' + d;                        // UPC-A
      if (d.length === 14 && eanValido(d) && d[0] === '0') return d.slice(1); }
    return ''; }
  function internoDe(curto) { const z = String(curto || '').replace(/^0+/, ''); return /^\d{1,6}$/.test(z) ? '2' + pad(z, 6) : ''; }
  /* codigo(p, {esquema, curto}) -> {tipo:'ean13'|'ean8'|'code128', dados, texto, interno}
     curto: o código curto do produto (o app passa só quando ele leva de volta ao mesmo produto no caixa) */
  function codigo(p, o) {
    o = o || {}; const esq = o.esquema || 'ean13'; if (esq === 'nenhum') return null;
    const ean = eanDoProduto(p);
    if (ean) return ean.length === 8 ? { tipo: 'ean8', dados: ean, texto: ean } : { tipo: 'ean13', dados: ean, texto: ean[0] + ' ' + ean.slice(1, 7) + ' ' + ean.slice(7) };
    const it = internoDe(o.curto);
    if (it) {
      if (esq === 'ean8') { const d = it + dvEan(it); return { tipo: 'ean8', dados: d, texto: d, interno: it }; }
      if (esq === 'antigo') { const d = pad(it, 13); return { tipo: 'ean13', dados: d, texto: d[0] + ' ' + d.slice(1, 7) + ' ' + d.slice(7), interno: it, semVerificador: true }; }
      const b = pad(it, 12), d = b + dvEan(b); return { tipo: 'ean13', dados: d, texto: d[0] + ' ' + d.slice(1, 7) + ' ' + d.slice(7), interno: it }; }
    const c = String(p.codigo || '').trim(); if (c && /^[\x20-\x7e]{1,20}$/.test(c)) return { tipo: 'code128', dados: c, texto: c };
    return null; }
  /* o que o leitor mandou -> código interno 2xxxxxx (ou ''): entende os três esquemas, com ou sem os zeros da frente
     (leitor que manda EAN-13 como UPC-A de 12 dígitos tira o 0 da frente) */
  function lerInterno(cod) {
    const d = soDig(cod); if (d !== String(cod || '').trim() || ![7, 8, 12, 13].includes(d.length)) return '';
    const z = d.replace(/^0+/, '');
    if (/^2\d{7}$/.test(z) && (d.length === 8 || /^0+$/.test(d.slice(0, d.length - 8))) && dvEan(z.slice(0, 7)) === Number(z[7])) return z.slice(0, 7); // ean13 / ean8
    if (/^2\d{6}$/.test(z) && d.length >= 12) return z;                                                                                         // antigo
    if (d.length === 7 && /^2\d{6}$/.test(d)) return d;
    return ''; }
  const barras = c => c.tipo === 'ean8' ? barrasEan8(c.dados) : c.tipo === 'ean13' ? barrasEan13(c.dados) : barrasCode128(c.dados);

  // ---------- tamanhos ----------
  const PRESETS = [
    { id: '60x30', w: 60, h: 30, nome: '60 × 30 mm' }, { id: '50x30', w: 50, h: 30, nome: '50 × 30 mm' }, { id: '40x25', w: 40, h: 25, nome: '40 × 25 mm' },
    { id: '100x30', w: 100, h: 30, nome: '100 × 30 mm' }, { id: '100x25', w: 100, h: 25, nome: '100 × 25 mm (faixa de gôndola)' }, { id: '35x22', w: 35, h: 22, nome: '35 × 22 mm' }];
  const PADRAO = { tam: '60x30', w: 60, h: 30, gap: 3, colunas: 1, gapCol: 2, maiusculas: true, nomeFormatado: false, codigoCurto: true, esquema: 'ean13',
    atacado: false, data: false, unidade: true, dpi: 203 };
  function config(c) { const o = Object.assign({}, PADRAO, c || {}); const pr = PRESETS.find(p => p.id === o.tam); if (pr) { o.w = pr.w; o.h = pr.h; }
    o.w = Math.min(Math.max(Number(o.w) || 60, 15), 120); o.h = Math.min(Math.max(Number(o.h) || 30, 10), 120); o.colunas = Math.min(Math.max(Math.round(o.colunas) || 1, 1), 3);
    o.gap = Math.min(Math.max(Number(o.gap) || 0, 0), 20); o.gapCol = Math.min(Math.max(Number(o.gapCol) || 0, 0), 20); o.dpi = Number(o.dpi) === 300 ? 300 : 203; return o; }

  // ---------- texto ----------
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brl = v => (Math.round((Number(v) || 0) * 100) / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const FONTE = 'Arial, "Liberation Sans", Helvetica, sans-serif';
  // largura aproximada (em "em") quando não há canvas para medir: Arial negrito
  const LARG = { ' ': .28, ',': .28, '.': .28, '1': .556, I: .28, J: .556, M: .833, W: .944, m: .889, w: .778, i: .278, l: .278, j: .278, f: .333, t: .333, r: .389 };
  function larguraAprox(t, px) { let s = 0; for (const ch of String(t)) s += LARG[ch] != null ? LARG[ch] : /[A-ZÀ-Ý]/.test(ch) ? .72 : /\d/.test(ch) ? .556 : .58; return s * px; }
  let medidor = null;
  function medir(t, mm) { // largura em mm de um texto em negrito com altura de fonte mm
    if (medidor === null) { try { const cv = typeof document !== 'undefined' && document.createElement('canvas'); medidor = cv ? cv.getContext('2d') : false; } catch (e) { medidor = false; } }
    if (medidor) { medidor.font = `700 100px ${FONTE}`; return medidor.measureText(String(t)).width / 100 * mm; }
    return larguraAprox(t, mm); }
  // quebra o nome em até 2 linhas e acha a maior fonte que cabe
  function caberNome(nome, larg, alt) {
    const pal = String(nome).trim().split(/\s+/); let melhor = { f: 0, linhas: [nome] };
    for (const n of [1, 2]) {
      let linhas = [pal.join(' ')];
      if (n === 2 && pal.length > 1) { let bom = null; for (let k = 1; k < pal.length; k++) { const a = pal.slice(0, k).join(' '), b = pal.slice(k).join(' '), m = Math.max(medir(a, 1), medir(b, 1)); if (!bom || m < bom.m) bom = { m, l: [a, b] }; } linhas = bom.l; }
      else if (n === 2) continue;
      const fw = larg / Math.max(...linhas.map(l => medir(l, 1))), fh = alt / (n * 1.12); const f = Math.min(fw, fh);
      if (f > melhor.f * 1.12 || (n === 1 && f >= melhor.f)) melhor = { f, linhas }; }
    return melhor; }

  /* desenho de uma etiqueta (SVG em mm). p: {nome, preco, precoAtacado, unidade}; c: config; o: {codigo, data, nomeMostrado} */
  function svg(p, c, o) {
    c = config(c); o = o || {}; const W = c.w, H = c.h, m = Math.max(1.2, Math.min(W, H) * 0.05), kg = p.unidade === 'kg';
    let nome = String(o.nomeMostrado || p.nome || ''); if (c.maiusculas) nome = nome.toLocaleUpperCase('pt-BR');
    const cod = o.codigo === undefined ? null : o.codigo, bits = cod ? barras(cod) : '', modulos = bits.length;
    const dot = 25.4 / c.dpi, partes = [];
    const T = (x, y, t, f, peso, anc) => partes.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" font-size="${f.toFixed(2)}" font-weight="${peso || 700}"${anc ? ` text-anchor="${anc}"` : ''}>${esc(t)}</text>`);
    // faixa do nome
    const altNome = H * (H >= 28 ? 0.27 : 0.3), fit = caberNome(nome, W - 2 * m, altNome), fN = Math.min(fit.f, H * 0.16);
    fit.linhas.forEach((l, i) => T(m, m + fN * 0.9 + i * fN * 1.12, l, fN));
    const topo = m + fN * 1.12 * fit.linhas.length + H * 0.02, baixo = H - m;
    // preço: "R$" pequeno, valor grande, unidade embaixo do valor
    const preco = brl(p.preco), un = c.unidade ? (kg ? 'kg' : 'un.') : '';
    const linhaExtra = [c.atacado && Number(p.precoAtacado) > 0 ? `Atacado R$ ${brl(p.precoAtacado)}${kg ? '/kg' : ''}` : '', c.data && o.data ? o.data : ''].filter(Boolean).join('  ·  ');
    const lado = W / H >= 1.7 && !!bits;                           // código à esquerda e preço à direita (como a etiqueta da loja); senão um embaixo do outro
    let px0, px1, py0, py1;                                         // caixa do preço
    const fExtra = Math.max(1.6, Math.min(H * 0.075, 2.6)), altExtra = linhaExtra ? fExtra * 1.25 : 0;
    if (lado) {
      // código: módulo com número inteiro de pontos da cabeça (fica nítido); quer ~45% da largura
      const zona = 2 * 7, larg = W * 0.48 - m;
      let k = Math.max(2, Math.floor(larg / ((modulos + zona) * dot))); const mod = k * dot;
      const bw = modulos * mod, bx = m + 6 * mod;   // zona livre à esquerda (o primeiro dígito do EAN fica nela)
      const fCod = Math.max(1.5, Math.min(2.4, H * 0.075));
      const hb = Math.max(4, (baixo - topo) - (c.codigoCurto && o.curto ? fCod * 1.1 : 0) - fCod * 1.15);
      let y = topo;
      if (c.codigoCurto && o.curto) { T(bx + bw / 2, y + fCod * 0.85, pad(o.curto, 8), fCod, 700, 'middle'); y += fCod * 1.1; }
      barrasSvg(partes, bits, bx, y, mod, hb, cod.tipo);
      textoBarras(T, cod, bx, y + hb + fCod * 0.98, mod, fCod);
      px0 = bx + bw + 3.5 * mod + 1; px1 = W - m; py0 = topo; py1 = baixo - altExtra;
    } else {
      px0 = m; px1 = W - m; py0 = topo;
      let hb = 0;
      if (bits) {
        const fCod = Math.max(1.4, Math.min(2.2, H * 0.07)), larg0 = W - 2 * m, lCurto = c.codigoCurto && o.curto ? medir(pad(o.curto, 8), fCod) + 1.5 : 0;
        // módulo de 2 pontos no mínimo (1 ponto não lê bem); se o código curto não couber do lado, ele fica de fora
        let k = Math.min(4, Math.floor((larg0 - lCurto) / ((modulos + 9) * dot))); const cabeCurto = k >= 2; if (!cabeCurto) k = Math.max(2, Math.floor(larg0 / ((modulos + 9) * dot)));
        const mod = k * dot, bw = modulos * mod;
        hb = Math.max(3.5, Math.min((baixo - topo) * 0.42, 10)); const by = baixo - hb - fCod * 1.05;
        barrasSvg(partes, bits, m + 6 * mod, by, mod, hb, cod.tipo); textoBarras(T, cod, m + 6 * mod, baixo - fCod * 0.12, mod, fCod);
        if (c.codigoCurto && o.curto && cabeCurto) T(W - m, baixo - fCod * 0.12, pad(o.curto, 8), fCod, 700, 'end');
        py1 = by - 0.8 - altExtra; hb += fCod * 1.05;
      } else py1 = baixo - altExtra;
      if (!bits && c.codigoCurto && o.curto) { const f = Math.max(1.5, H * 0.07); T(m, baixo - 0.2, pad(o.curto, 8), f, 700); }
    }
    // valor grande cabendo na caixa (deixa lugar para R$ à esquerda e a unidade embaixo à direita)
    const bxW = px1 - px0, bxH = py1 - py0, fRs = Math.max(1.6, Math.min(bxH * 0.26, 3.4)), fUn = un ? Math.max(1.8, Math.min(bxH * 0.26, 3.6)) : 0;
    let fP = Math.min((bxH - fUn * 0.9) / 0.78, (bxW - medir('R$', fRs) - 0.8) / (medir(preco, 1) || 1));
    fP = Math.max(3, fP);
    const capP = fP * 0.72, yBase = py0 + (bxH - fUn * 0.95 - capP) / 2 + capP;
    const xFim = px1, wP = medir(preco, fP);
    T(xFim, yBase, preco, fP, 700, 'end');
    T(xFim - wP - 0.6, yBase, 'R$', fRs, 700, 'end');
    if (un) T(xFim, Math.min(py1, yBase + fUn * 1.05), un, fUn, 700, 'end');
    if (linhaExtra) T(W - m, baixo - (lado ? 0.2 : 0) - (lado ? 0 : 0), linhaExtra, fExtra, 400, 'end');
    if (!lado && linhaExtra && bits) { /* no modo empilhado a linha extra fica logo acima do código */
      partes.pop(); T(W - m, py1 + altExtra * 0.85, linhaExtra, fExtra, 400, 'end'); }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family='${FONTE}' fill="#000" shape-rendering="crispEdges" text-rendering="geometricPrecision">${partes.join('')}</svg>`; }
  // números embaixo das barras como no EAN impresso: 1º dígito fora, 6 + 6 entre as guardas (EAN-8: 4 + 4)
  function textoBarras(T, cod, x, y, mod, f) {
    const d = cod.dados, g = (txt, de, ate) => { const larg = (ate - de) * mod, fe = Math.min(f, larg / (txt.length * 0.62)); T(x + (de + ate) / 2 * mod, y, txt, fe, 400, 'middle'); };
    if (cod.tipo === 'ean13') { T(x - mod, y, d[0], Math.min(f, 6.5 * mod / 0.62), 400, 'end'); g(d.slice(1, 7), 3, 45); g(d.slice(7), 50, 92); }
    else if (cod.tipo === 'ean8') { g(d.slice(0, 4), 3, 31); g(d.slice(4), 36, 64); }
    else g(cod.texto, 0, barrasCode128(d).length); }
  function barrasSvg(partes, bits, x, y, mod, h, tipo) {
    // EAN: as barras de guarda descem um pouco (como no impresso); código 128 é todo da mesma altura
    const guarda = tipo === 'ean13' ? [0, 1, 2, 45, 46, 47, 48, 49, 92, 93, 94] : tipo === 'ean8' ? [0, 1, 2, 31, 32, 33, 34, 35, 64, 65, 66] : [];
    let d = ''; for (let i = 0; i < bits.length;) { if (bits[i] !== '1') { i++; continue; } let j = i; while (j < bits.length && bits[j] === '1' && guarda.includes(j) === guarda.includes(i)) j++;
      const hh = guarda.includes(i) ? h + mod * 4 : h; d += `M${(x + i * mod).toFixed(3)} ${y.toFixed(3)}h${((j - i) * mod).toFixed(3)}v${hh.toFixed(3)}h${(-(j - i) * mod).toFixed(3)}z`; i = j; }
    partes.push(`<path d="${d}"/>`); }

  /* folha para imprimir pelo driver do Windows: uma página por fileira (1 a 3 etiquetas lado a lado) */
  function pagina(c, cal) { c = config(c); cal = cal || {}; return { w: +(c.w * c.colunas + c.gapCol * (c.colunas - 1)).toFixed(2), h: c.h }; }
  function folha(lista, c, cal) { // lista: [{svg}] já repetida pela quantidade
    c = config(c); cal = cal || {}; const pg = pagina(c), dx = Number(cal.x) || 0, dy = Number(cal.y) || 0;
    const fileiras = []; for (let i = 0; i < lista.length; i += c.colunas) fileiras.push(lista.slice(i, i + c.colunas));
    const corpo = fileiras.map(f => `<div class="pg">${f.map((e, k) => `<div class="et" style="left:${(k * (c.w + c.gapCol) + dx).toFixed(2)}mm;top:${dy.toFixed(2)}mm">${e.svg}</div>`).join('')}</div>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>@page{size:${pg.w}mm ${pg.h}mm;margin:0}html,body{margin:0;padding:0;background:#fff}
.pg{position:relative;width:${pg.w}mm;height:${pg.h}mm;overflow:hidden;page-break-after:always;break-after:page}.pg:last-child{page-break-after:auto;break-after:auto}.et{position:absolute;width:${c.w}mm;height:${c.h}mm}.et svg{display:block}</style></head><body>${corpo}</body></html>`; }
  /* etiqueta de teste para descobrir o tamanho: borda, régua a cada 5 mm, medida escrita e seta da saída */
  function svgTeste(c) {
    c = config(c); const W = c.w, H = c.h, p = [];
    p.push(`<rect x="0.4" y="0.4" width="${W - 0.8}" height="${H - 0.8}" fill="none" stroke="#000" stroke-width="0.35"/>`);
    for (let x = 5; x < W; x += 5) { const g = x % 10 === 0 ? 2.6 : 1.4; p.push(`<path d="M${x} 0.4v${g}M${x} ${H - 0.4}v${-g}" stroke="#000" stroke-width="0.25"/>`); if (x % 10 === 0 && x < W - 3) p.push(`<text x="${x}" y="${4.6}" font-size="1.8" text-anchor="middle">${x}</text>`); }
    for (let y = 5; y < H; y += 5) { const g = y % 10 === 0 ? 2.6 : 1.4; p.push(`<path d="M0.4 ${y}h${g}M${W - 0.4} ${y}h${-g}" stroke="#000" stroke-width="0.25"/>`); if (y % 10 === 0 && y < H - 2) p.push(`<text x="3.4" y="${y + 0.6}" font-size="1.8">${y}</text>`); }
    const f = Math.min(H * 0.2, W * 0.12); p.push(`<text x="${W / 2}" y="${H / 2 + f * 0.35}" font-size="${f.toFixed(2)}" font-weight="700" text-anchor="middle">${String(W).replace('.', ',')} × ${String(H).replace('.', ',')} mm</text>`);
    p.push(`<text x="${W / 2}" y="${H / 2 + f * 0.35 + 3}" font-size="2" text-anchor="middle">a borda deve ficar inteira dentro da etiqueta</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family='${FONTE}' fill="#000">${p.join('')}</svg>`; }

  // ---------- comandos diretos (a impressora desenha sozinha; não passa pelo driver) ----------
  const ascii = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '');
  // ----- desenho comum aos três idiomas (mm, origem no canto de cima à esquerda) -----
  // métricas das fontes internas a 203 dpi (Argox PPLA/DPL): fonte 2 = 8x18 pontos, 3 = 10x27, 4 = 14x36 (+2 pontos entre letras)
  const FT = { 2: { w: 10, h: 18 }, 3: { w: 12, h: 27 }, 4: { w: 16, h: 36 } }, PT = 25.4 / 203;
  const lw = (f, n, mult) => n * FT[f].w * PT * (mult || 1), lh = (f, mult) => FT[f].h * PT * (mult || 1);
  function plano(p, c, o) {
    c = config(c); o = o || {}; const W = c.w, H = c.h, m = Math.max(1.2, Math.min(W, H) * 0.05);
    const nome = ascii(c.maiusculas ? String(o.nomeMostrado || p.nome).toUpperCase() : (o.nomeMostrado || p.nome));
    const cpl = Math.max(6, Math.floor((W - 2 * m) / lw(3, 1))), linhas = []; let atual = '';
    for (const w of nome.split(/\s+/)) { if ((atual + ' ' + w).trim().length > cpl && atual) { linhas.push(atual); atual = w; } else atual = (atual + ' ' + w).trim(); } if (atual) linhas.push(atual);
    const nl = Math.min(linhas.length, H >= 24 ? 2 : 1), L = { W, H, m, dpi: c.dpi, itens: [] }, add = x => L.itens.push(x);
    linhas.slice(0, nl).forEach((l, i) => add({ t: 'txt', f: 3, x: m, y: m + i * (lh(3) + 0.4), s: l.slice(0, cpl) }));
    const topo = m + nl * (lh(3) + 0.4) + 0.4, baixo = H - m, cod = o.codigo || null, md = c.dpi === 300 ? 3 : 2, dotmm = 25.4 / c.dpi, HR = 2.8;
    const preco = brl(p.preco), un = c.unidade ? (p.unidade === 'kg' ? 'KG' : 'UN') : '', curto = c.codigoCurto && o.curto ? pad(o.curto, 8) : '';
    const extra = ascii([c.atacado && Number(p.precoAtacado) > 0 ? `Atacado R$ ${brl(p.precoAtacado)}` : '', c.data && o.data ? o.data : ''].filter(Boolean).join(' - '));
    const nmod = cod ? (cod.tipo === 'ean8' ? 67 : cod.tipo === 'ean13' ? 95 : barrasCode128(cod.dados).length) : 0, bw = nmod * md * dotmm;
    const lado = !!cod && W / H >= 1.7 && bw + 2 * m + 18 <= W;
    let px0 = m, py0 = topo, py1 = baixo, unLado = false;
    if (cod && lado) {
      let y = topo; if (curto) { add({ t: 'txt', f: 2, x: m + 1 + (bw - lw(2, 8)) / 2, y, s: curto }); y += lh(2) + 0.3; }
      add({ t: 'bar', x: m + 1, y, h: Math.max(4, baixo - y - HR), md, cod }); px0 = m + 1 + bw + 2;
    } else if (cod) {
      const hh = Math.max(4, Math.min(8, (baixo - topo) * 0.42)), y = baixo - HR - hh; add({ t: 'bar', x: m + 1, y, h: hh, md, cod }); py1 = y - 0.6; unLado = true;
      if (curto && m + 1 + bw + 1.5 + lw(2, 8) <= W - m) add({ t: 'txt', f: 2, x: W - m - lw(2, 8), y: baixo - lh(2), s: curto });
    } else unLado = (baixo - topo) < 9;
    // linha extra (atacado / data) embaixo, à direita do código
    if (extra) { const n = Math.min(extra.length, Math.floor((W - m - px0) / lw(2, 1))); if (n >= 8 && py1 - py0 - lh(2) - 0.4 >= lh(4) + (unLado ? 0 : lh(3) + 0.3)) { const s = extra.slice(0, n); if (lado || !cod) { add({ t: 'txt', f: 2, x: W - m - lw(2, s.length), y: baixo - lh(2), s }); py1 -= lh(2) + 0.4; } else { add({ t: 'txt', f: 2, x: W - m - lw(2, s.length), y: py1 - lh(2), s }); py1 -= lh(2) + 0.4; } } }
    // valor: fonte 4 aumentada até caber; R$ (fonte 2) antes do valor; unidade (fonte 3) embaixo à direita, ou do lado quando falta altura
    const altU = un && !unLado ? lh(3) + 0.3 : 0, larU = un && unLado ? lw(3, un.length) + 1 : 0, larRs = lw(2, 2) + 0.8;
    let mult = Math.floor(Math.min((py1 - py0 - altU) / lh(4), (W - m - px0 - larRs - larU) / lw(4, preco.length)));
    mult = Math.max(1, Math.min(6, mult));
    const pw = lw(4, preco.length, mult), ph = lh(4, mult), px = W - m - larU - pw, py = py0 + Math.max(0, (py1 - py0 - altU - ph) / 2);
    add({ t: 'txt', f: 4, mult, x: px, y: py, s: preco }); add({ t: 'txt', f: 2, x: px - larRs, y: py + ph - lh(2), s: 'R$' });
    if (un) add(unLado ? { t: 'txt', f: 3, x: W - m - lw(3, un.length), y: py + ph - lh(3), s: un } : { t: 'txt', f: 3, x: W - m - lw(3, un.length), y: py + ph + 0.3, s: un });
    return L; }
  const dots = (mm, dpi) => Math.round(mm * dpi / 25.4);
  function cbDados(cod) { return cod.tipo === 'ean8' ? cod.dados.slice(0, 7) : cod.tipo === 'ean13' ? cod.dados.slice(0, 12) : cod.dados; } // EAN: a impressora calcula o dígito
  /* Argox PPLA (DPL): <STX>L, D11, H (escuro 00-20), m (medidas em 0,1 mm), registros "R F h v ooo yyyy xxxx dados", Q (cópias), E.
     A linha (yyyy) conta de baixo para cima a partir do pé da etiqueta. Barras: F = EAN-13, G = EAN-8, E = Code 128 (maiúscula = com os números). */
  function ppla(lista, c, cal) {
    c = config(c); cal = cal || {}; const dx = Number(cal.x) || 0, dy = Number(cal.y) || 0, escuro = pad(Math.min(20, Math.max(0, Math.round(Number(cal.escuro != null ? cal.escuro : 12)))), 2);
    const q = n => pad(Math.max(0, Math.round(n * 10)), 4), S = '\x02', CR = '\r';
    let out = '';
    for (const e of lista) {
      const L = plano(e.p, c, e.o), col = mm => q(mm + dx), lin = (topo, alt) => q(L.H - topo - alt - dy);
      let r = S + 'L' + CR + 'D11' + CR + 'H' + escuro + CR + 'm' + CR;
      if (cal.teste) { const lW = pad(Math.round((L.W - 1.2) * 10), 3), lH = pad(Math.round((L.H - 1.2) * 10), 3);
        r += '1X11000' + lin(0.6, 0.3) + col(0.6) + 'L' + lW + '003' + CR + '1X11000' + lin(L.H - 0.9, 0.3) + col(0.6) + 'L' + lW + '003' + CR;
        r += '1X11000' + lin(0.6, L.H - 1.2) + col(0.6) + 'L003' + lH + CR + '1X11000' + lin(0.6, L.H - 1.2) + col(L.W - 0.9) + 'L003' + lH + CR;
        for (let x = 5; x < L.W; x += 5) r += '1X11000' + lin(0.6, x % 10 ? 1.2 : 2.4) + col(x) + 'L003' + (x % 10 ? '012' : '024') + CR;
        r += '1311000' + lin(L.H / 2 - 2, lh(3)) + col(3) + `${L.W} x ${L.H} mm` + CR + '1211000' + lin(L.H / 2 + 2, lh(2)) + col(3) + 'Teste PPLA - Balcao PDV' + CR + 'Q0001' + CR + 'E' + CR; out += r; continue; }
      for (const it of L.itens) {
        if (it.t === 'txt') { const k = it.mult || 1; r += '1' + it.f + k.toString(36).toUpperCase() + k.toString(36).toUpperCase() + '000' + lin(it.y, lh(it.f, k)) + col(it.x) + it.s + CR; }
        else { const letra = it.cod.tipo === 'ean8' ? 'G' : it.cod.tipo === 'ean13' ? 'F' : 'E'; r += '1' + letra + it.md + it.md + pad(Math.round(it.h * 10), 3) + lin(it.y, it.h) + col(it.x) + cbDados(it.cod) + CR; } }
      r += 'Q' + pad(Math.max(1, e.copias || 1), 4) + CR + 'E' + CR; out += r; }
    return out; }
  /* Zebra ZPL II (fonte 0 com a mesma altura) */
  function zpl(lista, c, cal) {
    c = config(c); cal = cal || {}; const d = mm => dots(mm, c.dpi), dx = Number(cal.x) || 0, dy = Number(cal.y) || 0, esc30 = Math.min(30, Math.max(0, Math.round((Number(cal.escuro != null ? cal.escuro : 12)) * 1.5)));
    let out = '';
    for (const e of lista) {
      const L = plano(e.p, c, e.o); let r = `^XA^CI28^PW${d(L.W)}^LL${d(L.H)}^LH${d(dx)},${d(dy)}~SD${pad(esc30, 2)}`;
      if (cal.teste) { r += `^FO${d(0.6)},${d(0.6)}^GB${d(L.W - 1.2)},${d(L.H - 1.2)},2^FS`; for (let x = 5; x < L.W; x += 5) r += `^FO${d(x)},${d(0.6)}^GB2,${d(x % 10 ? 1.2 : 2.4)},2^FS`;
        r += `^FO${d(3)},${d(L.H / 2 - 2)}^A0N,${d(3.4)},${d(2.8)}^FD${L.W} x ${L.H} mm^FS^PQ1^XZ`; out += r; continue; }
      for (const it of L.itens) {
        if (it.t === 'txt') { const h = lh(it.f, it.mult), w = lw(it.f, 1, it.mult) * 0.9; r += `^FO${d(it.x)},${d(it.y)}^A0N,${d(h)},${d(w)}^FD${it.s}^FS`; }
        else { const bc = it.cod.tipo === 'ean8' ? '^B8N' : it.cod.tipo === 'ean13' ? '^BEN' : '^BCN'; r += `^BY${it.md}^FO${d(it.x)},${d(it.y)}${bc},${d(it.h)},Y,N${it.cod.tipo === 'code128' ? ',N' : ''}^FD${cbDados(it.cod)}^FS`; } }
      r += `^PQ${Math.max(1, e.copias || 1)}^XZ`; out += r; }
    return out; }
  /* EPL2 (Argox PPLB, Zebra antigas, Elgin): fontes 2/3/4 = 10x16, 12x20, 14x24 pontos */
  function epl(lista, c, cal) {
    c = config(c); cal = cal || {}; const d = mm => dots(mm, c.dpi), dx = Number(cal.x) || 0, dy = Number(cal.y) || 0, D = Math.min(15, Math.max(0, Math.round((Number(cal.escuro != null ? cal.escuro : 12)) * 0.75)));
    const X = mm => d(mm + dx), Y = mm => d(mm + dy), qs = t => '"' + String(t).replace(/"/g, "'") + '"', FE = { 2: 2, 3: 3, 4: 4 }, AE = { 2: 16, 3: 20, 4: 24 };
    let out = '';
    for (const e of lista) {
      const L = plano(e.p, c, e.o); let r = `\nN\nq${d(L.W)}\nQ${d(L.H)},${d(c.gap)}\nD${D}\n`;
      if (cal.teste) { r += `LO${X(0.6)},${Y(0.6)},${d(L.W - 1.2)},2\nLO${X(0.6)},${Y(L.H - 0.9)},${d(L.W - 1.2)},2\nLO${X(0.6)},${Y(0.6)},2,${d(L.H - 1.2)}\nLO${X(L.W - 0.9)},${Y(0.6)},2,${d(L.H - 1.2)}\n`;
        for (let x = 5; x < L.W; x += 5) r += `LO${X(x)},${Y(0.6)},2,${d(x % 10 ? 1.2 : 2.4)}\n`; r += `A${X(3)},${Y(L.H / 2 - 2)},0,3,1,1,N,${qs(L.W + ' x ' + L.H + ' mm')}\nP1\n`; out += r; continue; }
      for (const it of L.itens) {
        if (it.t === 'txt') { const k = Math.max(1, Math.round(lh(it.f, it.mult) / (AE[it.f] * 25.4 / 203))); r += `A${X(it.x)},${Y(it.y)},0,${FE[it.f]},${k},${k},N,${qs(it.s)}\n`; }
        else { const t = it.cod.tipo === 'ean8' ? 'E80' : it.cod.tipo === 'ean13' ? 'E30' : '1'; r += `B${X(it.x)},${Y(it.y)},0,${t},${it.md},${it.md},${d(it.h)},B,${qs(cbDados(it.cod))}\n`; } }
      r += `P${Math.max(1, e.copias || 1)}\n`; out += r; }
    return out; }
  const IDIOMAS = { ppla: { nome: 'Argox PPLA (padrão das Argox)', fn: ppla }, pplb: { nome: 'Argox PPLB / EPL2 (Zebra antigas, Elgin)', fn: epl }, zpl: { nome: 'Zebra ZPL / Elgin L42 (ZPL)', fn: zpl } };
  return { dvEan, eanValido, eanDoProduto, internoDe, codigo, lerInterno, barras, barrasEan13, barrasEan8, barrasCode128, ESQUEMAS, PRESETS, PADRAO, config, svg, svgTeste, folha, pagina, ppla, zpl, epl, IDIOMAS, brl, medir, ascii, plano };
});
