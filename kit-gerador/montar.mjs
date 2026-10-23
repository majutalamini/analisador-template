// Gera analisador-templates-console.js a partir dos arquivos da extensão + ui.js.
// Uso: node montar.mjs <pasta-da-extensao> <arquivo-de-saida>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const [ext, saida] = process.argv.slice(2);
if (!ext || !saida) { console.error('Uso: node montar.mjs <pasta-da-extensao> <saida.js>'); process.exit(1); }
const ler = (f) => fs.readFileSync(path.join(ext, f), 'utf8');

const manifest = JSON.parse(ler('manifest.json'));
const jszip = ler('jszip.min.js');
const schema = JSON.parse(ler('reference-schema.json'));
const popup = ler('popup.js');

// linter.browser.js e compressor.js registram em um objeto global; aqui registram em NS.
function paraNS(src, nome) {
  const fim = src.lastIndexOf('})(');
  if (fim < 0) throw new Error('Formato inesperado em ' + nome);
  return src.slice(0, fim) + '})(NS);\n';
}
const linter = paraNS(ler('linter.browser.js'), 'linter.browser.js');
const compressor = paraNS(ler('compressor.js'), 'compressor.js');

// Trechos do popup.js reaproveitados sem alteração: categorias, ordem, exemplos,
// estruturas prontas e as funções que nomeiam/formatam as variáveis.
const ini = popup.indexOf('const VAR_CATEGORIES');
const fimVars = popup.indexOf('function renderVariables(');
if (ini < 0 || fimVars < 0) throw new Error('Não encontrei as listas de variáveis no popup.js');
const listas = popup.slice(ini, fimVars);

function funcao(nome) {
  const i = popup.indexOf(`function ${nome}(`);
  if (i < 0) throw new Error('Função não encontrada no popup.js: ' + nome);
  const f = popup.indexOf('\n}\n', i);
  return popup.slice(i, f + 3);
}
const utilitarios = ['formatMB', 'plural', 'extractGoogleDocId'].map(funcao).join('\n');

const ui = fs.readFileSync(path.join(aqui, 'ui.js'), 'utf8').replace(/const VERSAO = '[^']*';/, `const VERSAO = '${manifest.version}';`);

const cabecalho = `/*
 * Analisador de Templates DOCX v${manifest.version} — versão para testar dentro do Next Fit
 * ---------------------------------------------------------------------------------
 * Gerado a partir da extensão (linter.browser.js, compressor.js, reference-schema.json,
 * popup.js e JSZip). A lógica de análise e de compressão é a mesma da extensão.
 *
 * Como usar:
 *   1. Abra o sistema e entre logado normalmente.
 *   2. Aperte F12 > aba "Console".
 *   3. Cole este código inteiro e aperte Enter.
 *      (Se o Chrome pedir, digite "allow pasting" / "permitir colar" antes.)
 *   4. Para reabrir, use o botão roxo "Analisador de templates" no canto inferior direito.
 *
 * Tudo roda só no seu navegador: nenhum arquivo é enviado para lugar nenhum.
 * Recarregar a página remove o protótipo. Para não precisar colar sempre,
 * salve como Snippet em DevTools > Sources > Snippets.
 */
`;

const saidaJs = `${cabecalho}(function () {
  // Objeto onde linter e compressor se registram (no lugar de window).
  const NS = {};

  // ---------- JSZip v3.10.1 (isolado: não altera nem usa o JSZip da página) ----------
  const JSZip = (function () {
    var module = { exports: {} };
    var exports = module.exports;
    var define;
    ${jszip}
    ;return module.exports;
  })();

  // ---------- reference-schema.json ----------
  const DEFAULT_SCHEMA = ${JSON.stringify(schema)};

  // ---------- linter.browser.js ----------
${linter}
  // ---------- compressor.js ----------
${compressor}
  // ---------- popup.js (listas e utilitários) ----------
${listas}
${utilitarios}
${ui}
})();
`;

fs.writeFileSync(saida, saidaJs);
console.log('Gerado:', saida, (saidaJs.length / 1024).toFixed(0) + ' KB');
