#!/usr/bin/env node
/* Etiquetas de preço: códigos de barras (esquemas e leitura no caixa) e comandos PPLA dentro da etiqueta. Uso: node test/teste-etiquetas.js */
'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert');
const E = require(fs.existsSync(path.join(__dirname, '../public/etiquetas.js')) ? path.join(__dirname, '../public/etiquetas.js') : path.join(__dirname, 'etiquetas.js'));
let n = 0; const ok = (c, m) => { assert(c, m); n++; };
const canela = { nome: 'CANELA EM PÓ', preco: 34, unidade: 'kg', codigo: '000017' };
// etiqueta antiga da loja (foto): "0 000002 000017" = código interno 2000017 com zeros na frente, sem dígito verificador certo
ok(E.barrasEan13('0000002000017').length === 95 && E.dvEan('000000200001') === 5, 'o dígito certo seria 5, a etiqueta antiga tem 7');
for (const [esq, dados] of [['ean13', '0000020000172'], ['ean8', '20000172'], ['antigo', '0000002000017']]) {
  const c = E.codigo(canela, { esquema: esq, curto: '17' }); ok(c.dados === dados, esq + ' ' + c.dados);
  for (const lido of [dados, dados.replace(/^0/, '')]) ok(E.lerInterno(lido) === '2000017', 'lê ' + lido); }
ok(E.lerInterno('2000017') === '2000017' && E.lerInterno('7891234567895') === '' && E.lerInterno('20000173') === '' && E.lerInterno('2123456000123') === '', 'não confunde EAN de fabricante nem etiqueta de balança');
ok(E.codigo({ codigo: '7700010012064' }, { curto: '1206' }).dados === '7700010012064', 'EAN do fabricante');
ok(E.codigo({ codigo: '001206', codigoBarras: '7700010012064' }, {}).dados === '7700010012064', 'EAN no campo código de barras');
ok(E.codigo({ codigo: 'ABC-1' }, {}).tipo === 'code128', 'código com letras vira Code 128');
ok(E.codigo(canela, { esquema: 'nenhum', curto: '17' }) === null, 'sem código');
// comandos diretos: tudo dentro da etiqueta, sem sobrepor (fontes internas a 203 dpi)
const F = { 2: [8, 18], 3: [10, 27], 4: [14, 36] }, dot = 25.4 / 203;
const P = [canela, { nome: 'TEMPERO BAIANO DLU EM GRAO SELECIONADO', preco: 128.9, unidade: 'kg', codigo: '000222', precoAtacado: 120 }, { nome: 'CANELA JAVA GOLD MOIDA', preco: 19, unidade: 'un', codigo: '001206', codigoBarras: '7700010012064' }];
for (const t of E.PRESETS) for (const p of P) { const c = E.config({ tam: t.id, atacado: true }), o = { codigo: E.codigo(p, { curto: String(Number(p.codigo)) }), curto: String(Number(p.codigo)) };
  const recs = E.ppla([{ p, o, copias: 1 }], c, {}).split('\r').filter(r => /^1[0-9A-Z]/.test(r)), cx = [];
  for (const r of recs) { const f = r[1], h = parseInt(r[2], 36), v = parseInt(r[3], 36), ooo = r.slice(4, 7), row = Number(r.slice(7, 11)) / 10, col = Number(r.slice(11, 15)) / 10, d = r.slice(15), bar = /[A-Z]/.test(f);
    const w = bar ? (f === 'F' ? 95 : f === 'G' ? 67 : 11 * d.length + 35) * h * dot : d.length * (F[f][0] + 2) * h * dot, alt = bar ? Number(ooo) / 10 : F[f][1] * v * dot;
    const b = { x0: col, x1: col + w, y0: c.h - row - alt, y1: c.h - row + (bar ? 2.4 : 0) };
    ok(b.x0 >= 0.5 && b.x1 <= c.w - 0.5 && b.y0 >= 0.5 && b.y1 <= c.h - 0.3, `PPLA ${t.id} ${p.nome}: ${r} fora`);
    for (const a of cx) ok(!(b.x0 < a.x1 - 0.2 && a.x0 < b.x1 - 0.2 && b.y0 < a.y1 - 0.2 && a.y0 < b.y1 - 0.2), `PPLA ${t.id} ${p.nome}: ${r} sobrepõe`);
    cx.push(b); } }
ok(/^\x02L\rD11\rH08\rm\r/.test(E.ppla([{ p: canela, o: {}, copias: 3 }], E.config({}), { escuro: 8 })) && /Q0003\rE\r$/.test(E.ppla([{ p: canela, o: {}, copias: 3 }], E.config({}), {})), 'PPLA: escuro e cópias');
ok(/^\^XA/.test(E.zpl([{ p: canela, o: {}, copias: 1 }], E.config({}), {})) && /\nP1\n$/.test(E.epl([{ p: canela, o: {}, copias: 1 }], E.config({}), {})), 'ZPL e EPL');
const pg = E.pagina(E.config({ tam: '40x25', colunas: 3, gapCol: 2 })); ok(pg.w === 124 && pg.h === 25, 'página de 3 colunas');
console.log(`${n} verificações de etiquetas passaram`);
