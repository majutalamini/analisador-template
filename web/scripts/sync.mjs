// Copia para web/public/compartilhado/ os arquivos da extensão que a página web reaproveita.
// A extensão continua sendo a fonte única: linter, compressor, modelo de referência e
// listas de variáveis são lidos da raiz do repositório a cada deploy.
//
// Uso (dentro da pasta web/):  node scripts/sync.mjs [pasta-da-extensao]
//
// A pasta da extensão é procurada nesta ordem: argumento da linha de comando, variável
// EXTENSAO_DIR, pasta acima de web/ (web/ dentro do repositório) e, por fim, a pasta
// "analisador-template-main" ao lado de web/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ehExtensao = (d) => d && fs.existsSync(path.join(d, 'manifest.json')) && fs.existsSync(path.join(d, 'linter.browser.js'));
const candidatas = [
  process.argv[2] && path.resolve(process.argv[2]),
  process.env.EXTENSAO_DIR && path.resolve(process.env.EXTENSAO_DIR),
  path.resolve(webDir, '..'),
  path.resolve(webDir, '..', 'analisador-template-main')
];
const raiz = candidatas.find(ehExtensao);
if (!raiz) {
  throw new Error('Pasta da extensão não encontrada. Rode: node scripts/sync.mjs <pasta-da-extensao>\nProcurei em:\n' + candidatas.filter(Boolean).join('\n'));
}
const destino = path.join(webDir, 'public', 'compartilhado');

const ler = (f) => fs.readFileSync(path.join(raiz, f), 'utf8');

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(path.join(destino, 'icons'), { recursive: true });

for (const f of ['jszip.min.js', 'linter.browser.js', 'compressor.js', 'reference-schema.json']) {
  fs.copyFileSync(path.join(raiz, f), path.join(destino, f));
}
for (const f of fs.readdirSync(path.join(raiz, 'icons'))) {
  fs.copyFileSync(path.join(raiz, 'icons', f), path.join(destino, 'icons', f));
}

// popup.js depende das APIs do Chrome, então só os trechos independentes dele são
// reaproveitados: categorias, ordem, exemplos, estruturas prontas e as funções que
// nomeiam e formatam as variáveis.
const popup = ler('popup.js');
const ini = popup.indexOf('const VAR_CATEGORIES');
const fim = popup.indexOf('function renderVariables(');
if (ini < 0 || fim < 0) throw new Error('Não encontrei as listas de variáveis no popup.js.');

function funcao(nome) {
  const i = popup.indexOf(`function ${nome}(`);
  if (i < 0) throw new Error(`Função não encontrada no popup.js: ${nome}`);
  const f = popup.indexOf('\n}\n', i);
  return popup.slice(i, f + 3);
}

const manifest = JSON.parse(ler('manifest.json'));
const variaveis = `// Gerado por web/scripts/sync.mjs a partir do popup.js da extensão. Não edite à mão.
const VERSAO_EXTENSAO = ${JSON.stringify(manifest.version)};

${popup.slice(ini, fim)}
${['formatMB', 'plural', 'extractGoogleDocId'].map(funcao).join('\n')}`;
fs.writeFileSync(path.join(destino, 'variaveis.js'), variaveis);

console.log(`Arquivos da extensão v${manifest.version} copiados para web/public/compartilhado/`);
