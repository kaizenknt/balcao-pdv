#!/usr/bin/env node
/* Mensagens inteiras do WhatsApp na leitura da Ficha (vários itens, conversa no meio). Uso: node test/teste-ficha-mensagens.js caminho/do/parser.js */
'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert');
const Ficha = require(path.resolve(process.argv[2] || [path.join(__dirname, 'parser.js'), path.join(__dirname, '../../ficha/parser.js')].find(f => fs.existsSync(f))));
const PRODS = JSON.parse(fs.readFileSync(path.join(__dirname, 'produtos-dlu.json'), 'utf8'));
const nomes = [], unidades = {};
for (const p of [...PRODS].sort((a, b) => (a.unidade === 'kg' ? 0 : 1) - (b.unidade === 'kg' ? 0 : 1))) { const k = Ficha.norm(p.nome.trim()); if (k in unidades) continue; unidades[k] = p.unidade; nomes.push(p.nome); }
const ler = t => Ficha.parse(t, { catalog: nomes, unidades });
let ok = 0;
function caso(t, esperado) {
  const r = ler(t), got = r.itens.map(i => `${i.produto}|${i.quantidade} ${i.unidade}${i.alerta ? '|?' : i.confira ? '|confira' : ''}`);
  const bate = got.length === esperado.length && got.every((g, i) => esperado[i].startsWith('*') ? g.endsWith(esperado[i].slice(1)) : g === esperado[i]);   // "*|500 g|confira": qualquer produto, mas pedindo para conferir
  try { assert.ok(bate); ok++; } catch (e) { console.log('FALHOU:', JSON.stringify(t), '\n  veio    ', got, '\n  esperado', esperado); process.exitCode = 1; }
}
caso('boa tarde! quero 1kg de cominho em grão, meio kilo de colorau paraiba e 250g pimenta do reino. retiro as 17h', ['COMINHO GRÃO 99%|1 kg', 'COLORAL PARAÍBA|500 g', 'PIMENTA DO REINO|250 g']);
caso('[10:12, 27/10/2026] Maria: oi\n[10:12, 27/10/2026] Maria: 500g salsa, cebola e bacon\n[10:13, 27/10/2026] Maria: 1kg alho frito\n[10:13, 27/10/2026] Maria: obrigada!', ['SALSA, CEBOLA E BACON|500 g|confira', 'ALHO FRITO|1 kg']);
caso('tempero limao e ervas finas 500g\nlemon pepper 1/2 kg\npápricas defumadas 1 kg', ['TEMPERO DE LIMÃO E ERVAS FINAS|500 g', 'LEMON PEPPER|500 g', 'PAPRICA DEFUMADA|1 kg']);
caso('ana maria 500\nalho frito 1/2 kg\ntotal 52 reais\ntroco pra 50', ['TEMPERO ANA MARIA|500 g', 'ALHO FRITO|500 g']);
caso('1kg cominho e 500g colorau', ['*|1 kg|confira', '*|500 g|confira']);
caso('passo ai as 15:30 pra pegar 2kg de chimichurri', ['CHIMICHURRI|2 kg']);
caso('arroz 5kg\ncravo 100g', ['*|5 kg|confira', 'CRAVO|250 g']);
console.log(`${ok} mensagens certas`);
