// Insere as variáveis do Next Fit num template .docx que está escrito "em texto corrido".
// Ex.: "o contratante se certifica…" vira "o <<[RazaoSocialFilial]>> se certifica…".
//
// Para ajustar o que é substituído, edite só a lista REGRAS abaixo.
// Cada regra tem:
//   nome      texto mostrado no relatório
//   re        o que procurar (sem diferenciar maiúsculas/minúsculas)
//   variavel  nome da variável do sistema (precisa existir na aba Variáveis)
(function (global) {
  'use strict';

  const L = '[\\p{L}\\p{N}_]';
  const palavra = (src) => `(?<!${L})(?:${src})(?!${L})`;
  // Campo em branco depois do rótulo: "CPF: ________", "CPF: ........", "CPF: …"
  const branco = '[_.\\u2026\\-]{3,}';
  const rotulo = (src) => `(?<=(?<!${L})(?:${src})\\s*:\\s*)${branco}`;

  const REGRAS = [
    // Partes do contrato escritas por extenso no meio do texto.
    { nome: 'Contratante', re: palavra('contratante'), variavel: 'RazaoSocialFilial' },
    { nome: 'Aluno(a)', re: palavra('aluno\\(a\\)|alun[oa]'), variavel: 'NomeCliente' },

    // Campos em branco depois de um rótulo ("CNPJ: ______").
    { nome: 'CNPJ em branco', re: rotulo('cnpj(?:\\s*/\\s*cpf)?'), variavel: 'CnpjCpfFilial' },
    { nome: 'Razão social em branco', re: rotulo('raz[ãa]o\\s+social'), variavel: 'RazaoSocialFilial' },
    { nome: 'Nome em branco', re: rotulo('nome(?:\\s+completo)?'), variavel: 'NomeCliente' },
    { nome: 'CPF em branco', re: rotulo('cpf'), variavel: 'CpfCliente' },
    { nome: 'RG em branco', re: rotulo('rg'), variavel: 'RgCliente' },
    { nome: 'Data de nascimento em branco', re: rotulo('data\\s+de\\s+nascimento|nascimento'), variavel: 'DataNascimentoCliente' },
    { nome: 'E-mail em branco', re: rotulo('e-?mail'), variavel: 'EmailCliente' },
    { nome: 'Telefone em branco', re: rotulo('telefone|celular|fone'), variavel: 'TelefoneCliente' },
    { nome: 'CEP em branco', re: rotulo('cep'), variavel: 'CepCliente' },
    { nome: 'Endereço em branco', re: rotulo('endere[çc]o'), variavel: 'EnderecoCliente' },
    { nome: 'Bairro em branco', re: rotulo('bairro'), variavel: 'BairroCliente' },
    { nome: 'Cidade em branco', re: rotulo('cidade'), variavel: 'CidadeCliente' }
  ].map(r => ({ ...r, regex: new RegExp(r.re, 'giu') }));

  const decodificar = (s) => s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const codificar = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const TAG = (nome) => `<<[${nome}]>>`;
  // Trechos que já são tags do sistema (<<[...]>>, <<if ...>> etc.) nunca são mexidos.
  const TAGS_EXISTENTES = /<<[\s\S]*?>>/g;

  // Acha as substituições de um texto. Devolve [{ ini, fim, regra }] sem sobreposição.
  function acharSubstituicoes(texto, aceitaVariavel) {
    const protegidos = [];
    for (const m of texto.matchAll(TAGS_EXISTENTES)) protegidos.push([m.index, m.index + m[0].length]);
    const dentroDeTag = (a, b) => protegidos.some(([i, f]) => a < f && b > i);

    const achados = [];
    REGRAS.forEach((regra, prioridade) => {
      if (aceitaVariavel && !aceitaVariavel(regra.variavel)) return;
      regra.regex.lastIndex = 0;
      for (const m of texto.matchAll(regra.regex)) {
        const ini = m.index, fim = m.index + m[0].length;
        if (!dentroDeTag(ini, fim)) achados.push({ ini, fim, regra, prioridade, original: m[0] });
      }
    });
    // Em caso de choque, vale a regra que vem primeiro na lista.
    achados.sort((a, b) => a.ini - b.ini || a.prioridade - b.prioridade);
    const livres = [];
    let ate = -1;
    for (const a of achados) {
      if (a.ini >= ate) { livres.push(a); ate = a.fim; }
    }
    return livres;
  }

  const RE_PARAGRAFO = /<w:p[ >][\s\S]*?<\/w:p>/g;
  const RE_TEXTO = /(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g;

  // Processa um trecho de XML do Word. Um mesmo texto pode estar quebrado em vários
  // "runs" (<w:t>), então o parágrafo é lido inteiro e a troca é distribuída entre eles.
  function processarXml(xml, aceitaVariavel, relatorio) {
    return xml.replace(RE_PARAGRAFO, (par) => {
      const nos = [];
      let texto = '';
      par.replace(RE_TEXTO, (todo, abre, conteudo, fecha, pos) => {
        const t = decodificar(conteudo);
        nos.push({ pos, todo, abre, fecha, ini: texto.length, fim: texto.length + t.length, texto: t });
        texto += t;
        return todo;
      });
      if (!nos.length) return par;

      const subs = acharSubstituicoes(texto, aceitaVariavel);
      if (!subs.length) return par;

      // Aplica de trás para frente para os índices anteriores continuarem valendo.
      for (const s of subs.slice().reverse()) {
        const tocados = nos.filter(n => n.fim > s.ini && n.ini < s.fim);
        tocados.forEach((n, i) => {
          const de = Math.max(s.ini, n.ini) - n.ini;
          const ate = Math.min(s.fim, n.fim) - n.ini;
          n.texto = n.texto.slice(0, de) + (i === 0 ? TAG(s.regra.variavel) : '') + n.texto.slice(ate);
        });
        const chave = `${s.regra.nome}|${s.regra.variavel}`;
        const item = relatorio.get(chave) || { nome: s.regra.nome, variavel: s.regra.variavel, quantidade: 0, exemplo: s.original };
        item.quantidade++;
        relatorio.set(chave, item);
      }

      // Remonta o parágrafo trocando só o conteúdo dos <w:t>.
      let saida = '', cursor = 0;
      for (const n of nos) {
        saida += par.slice(cursor, n.pos);
        const abre = /xml:space=/.test(n.abre) ? n.abre : n.abre.replace(/^<w:t/, '<w:t xml:space="preserve"');
        saida += abre + codificar(n.texto) + n.fecha;
        cursor = n.pos + n.todo.length;
      }
      return saida + par.slice(cursor);
    });
  }

  // aceitaVariavel(nome) → false para pular regras cuja variável o sistema não conhece.
  async function inserirVariaveis(buffer, { JSZip, aceitaVariavel } = {}) {
    const Zip = JSZip || global.JSZip;
    const zip = await Zip.loadAsync(buffer);
    const partes = Object.keys(zip.files).filter(n => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n));
    if (!partes.includes('word/document.xml')) throw new Error('Este arquivo não parece ser um .docx válido.');

    const relatorio = new Map();
    for (const nome of partes) {
      const xml = await zip.file(nome).async('string');
      const novo = processarXml(xml, aceitaVariavel, relatorio);
      if (novo !== xml) zip.file(nome, novo);
    }
    const itens = [...relatorio.values()].sort((a, b) => b.quantidade - a.quantidade);
    const total = itens.reduce((s, i) => s + i.quantidade, 0);
    const blob = total ? await zip.generateAsync({
      type: 'blob',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      compression: 'DEFLATE'
    }) : null;
    return { total, itens, blob };
  }

  const api = { inserirVariaveis, processarXml, acharSubstituicoes, REGRAS, TAG };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.Personalizador = api;
})(typeof window !== 'undefined' ? window : globalThis);
