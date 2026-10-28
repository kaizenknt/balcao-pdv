/* Nome do produto para MOSTRAR na tela e no papel (não muda o que está guardado).
   "TEMPERO ANA MARIA 500G DLU" -> "Tempero Ana Maria 500 g D'Lu"; "AZEITE C/ ALHO NEGRO LISBOA" -> "Azeite c/ Alho Negro Lisboa".
   Só mexe em nome todo em maiúsculas (como vem do Hotline); nome já escrito com minúsculas fica como está.
   Usado pelo Balcão PDV e pela Ficha de Pesagem (mesmo arquivo nos dois). */
(function (raiz) {
  'use strict';
  const UNID = { G: 'g', GR: 'g', GRS: 'g', GRAMAS: 'g', KG: 'kg', KGS: 'kg', K: 'kg', ML: 'ml', L: 'l', LT: 'l', LTS: 'l', LITRO: 'l', LITROS: 'l', MG: 'mg', UN: 'un', UND: 'un', UNID: 'un', CM: 'cm', MM: 'mm', CAPS: 'caps', CPS: 'caps', MLT: 'ml' };
  const MINUSC = new Set(['DE', 'DA', 'DO', 'DAS', 'DOS', 'E', 'COM', 'SEM', 'EM', 'PARA', 'NO', 'NA', 'NOS', 'NAS', 'AO', 'A', 'O', 'OU', 'P/', 'C/', 'S/', 'PCT', 'CX', 'X']);
  // marcas e siglas com grafia própria
  const ESPECIAL = { DLU: "D'Lu", "D'LU": "D'Lu", KIDENDE: 'Kidendê', JGM: 'JGM', DNA: 'DNA', BA: 'BA', EVE: 'EVE', 'E.V.E.': 'E.V.E.', TB: 'TB', W4: 'W4', N6: 'N6', N5: 'N5', SP: 'SP', MG: 'MG',
    "D'MINAS": "D'Minas", 'D´MINAS': "D'Minas", MINAS: 'Minas', INTERESSA: 'Interessa', ALMAROMI: 'Almaromi', ALMORI: 'Almori', TANI: 'Tani', CAPSUM: 'Capsum', BBQ: 'BBQ', II: 'II', III: 'III' };
  const ligado = { v: true };
  const cap = w => w ? w.charAt(0).toLocaleUpperCase('pt-BR') + w.slice(1).toLocaleLowerCase('pt-BR') : w;
  function palavra(w, primeira, anterior) {
    if (!w) return w;
    if (w.includes('-') && w.length > 1 && !/^-|-$/.test(w)) return w.split('-').map((x, i) => palavra(x, primeira && i === 0, i ? 'x' : anterior)).join('-');
    if (w.includes('/') && !/^[CSP]\/$/.test(w)) {   // "C/PIMENTA", "GRANULADO/DESIDRATADO", "S/PIM"
      const m = /^([CSP])\/(.+)$/.exec(w); if (m) return (primeira ? m[1] : m[1].toLowerCase()) + '/ ' + palavra(m[2], false, 'c/');
      return w.split('/').map((x, i) => palavra(x, primeira && i === 0, anterior)).join('/');
    }
    const pre = (/^[("“]+/.exec(w) || [''])[0], pos = (/[)",.;:”]+$/.exec(w) || [''])[0], n = w.slice(pre.length, w.length - pos.length);
    if (!n) return w;
    const U = n.toLocaleUpperCase('pt-BR');
    let m;
    if ((m = /^(\d+(?:[.,]\d+)?)([A-Z]+)$/.exec(U)) && UNID[m[2]]) return pre + m[1] + ' ' + UNID[m[2]] + pos;   // 500G -> 500 g
    if (UNID[U] && anterior && /^\d+([.,]\d+)?$/.test(anterior)) return pre + UNID[U] + pos;                      // 500 G -> 500 g
    if (ESPECIAL[U]) return pre + ESPECIAL[U] + pos;
    if (/^([A-Z]\.)+[A-Z]?$/.test(U)) return pre + U + pos;   // siglas com ponto: E.V.E.
    if ((m = /^(\d+)([A-ZÀ-Ý]{3,})$/.exec(U))) return pre + m[1] + cap(m[2]) + pos;    // 7FIBRAS -> 7Fibras
    if ((m = /^([A-ZÀ-Ý]{3,})(\d+)$/.exec(U))) return pre + cap(m[1]) + m[2] + pos;    // GOLD0 -> Gold0
    if (/\d/.test(n)) return pre + n.replace(/[A-ZÀ-Ý]{2,}/g, x => (/^(MM|CM)$/.test(x) ? x.toLowerCase() : x)) + pos;   // N6, 12MM, Nº3: como está
    if (!primeira && MINUSC.has(U)) return pre + U.toLowerCase() + pos;
    return pre + cap(n) + pos;
  }
  function nomeBonito(s) {
    if (!ligado.v || s == null) return s;
    const t = String(s), suf = (/\s*\((c[oó]d\.?\s*\d+)\)\s*$/i.exec(t) || ['', ''])[0], corpo = suf ? t.slice(0, -suf.length) : t;
    if (/[a-zà-ÿ]/.test(corpo) || !/[A-ZÀ-Ý]{2}/.test(corpo)) return t;   // já tem minúsculas (ou não tem letras): fica como está
    const ws = corpo.replace(/,(?=[A-ZÀ-Ý])/g, ', ').replace(/(\S)\(/g, '$1 (').replace(/\bD[´'`] (?=[A-Z])/g, "D'").replace(/\s+/g, ' ').trim().split(' ');
    let saida = [], ant = '';
    ws.forEach((w, i) => { saida.push(palavra(w, i === 0, ant)); ant = w; });
    return saida.join(' ').replace(/\s+/g, ' ') + suf;
  }
  const api = { nomeBonito, ligar: v => { ligado.v = v !== false; }, ligado: () => ligado.v };
  if (typeof module === 'object' && module.exports) module.exports = api; else raiz.NomeBonito = api;
})(typeof window !== 'undefined' ? window : this);
