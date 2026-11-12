# Analisador de Templates — versão web (Firebase)

Página web com as mesmas funções da extensão (Analisar, Variáveis, Personalização e
Compressor), para ser aberta pelo botão **Correção** da tela de Templates do Next Fit.

A extensão continua sendo a fonte única da lógica: a cada deploy, `scripts/sync.mjs` copia
da raiz do repositório o `linter.browser.js`, o `compressor.js`, o `reference-schema.json`, o
JSZip, os ícones e as listas de variáveis do `popup.js`. Corrigiu algo na extensão, é só
publicar de novo.

```
web/
├── public/              página (index.html, app.js, styles.css)
│   └── compartilhado/   gerado pelo sync — não editar, não vai para o git
├── functions/           função que lê o Google Docs (/api/google-doc)
├── scripts/sync.mjs     copia os arquivos da extensão
├── botao-correcao-f12.js  botão "Correção" para testar no Next Fit pelo F12
└── firebase.json
```

## Publicar

1. Instale o Node 20 e a CLI do Firebase: `npm install -g firebase-tools`, depois `firebase login`.
2. Crie um projeto em <https://console.firebase.google.com> e coloque o ID dele no `.firebaserc`.
3. Dentro da pasta `web/`:

   ```bash
   npm --prefix functions install
   firebase deploy
   ```

   O endereço aparece no final (algo como `https://SEU-PROJETO.web.app`).

### Plano gratuito x Blaze

- **Hosting (a página)** funciona no plano gratuito (Spark).
- **A função do Google Docs** exige o plano **Blaze** (pago por uso, com cota gratuita
  mensal; para esse volume o custo tende a zero, mas pede cartão).
- Sem a função, publique só a página com `firebase deploy --only hosting`. Tudo funciona,
  menos a leitura automática do link: nesse caso a página baixa o .docx do Google Docs e
  pede para a pessoa enviar o arquivo.

## Testar no computador

```bash
node scripts/sync.mjs
firebase emulators:start --only hosting,functions
```

## Botão no Next Fit (F12)

1. Abra `botao-correcao-f12.js` e troque `URL_ANALISADOR` pelo endereço publicado.
2. No Next Fit, na tela de Templates: F12 › Console › cole o código › Enter.

O botão aparece ao lado do **+ TEMPLATE** com o mesmo visual e abre o analisador em outra
aba. Para remover: `__nfCorrecao.parar()` ou recarregar a página.

A página também aceita parâmetros, caso o botão definitivo queira usá-los:

- `?aba=variaveis` (ou `personalizacao`, `compressor`) abre direto na aba.
- `?doc=<link do Google Docs>` já preenche e analisa o link.

## O que muda em relação à extensão

| Extensão | Versão web |
| --- | --- |
| Lê o Google Docs direto (permissão do manifest) | Lê pela função `/api/google-doc`; sem ela, baixa o .docx para enviar |
| "Clique no erro" abre a busca dentro do Docs | "Ir para o trecho" copia o trecho e abre o Docs; é só Ctrl+F e colar |
| Painel lateral do Chrome | Página própria, também funciona no celular |

A análise e a compressão continuam acontecendo no navegador de quem usa: o .docx não é
enviado para o servidor. A função só repassa a exportação pública de um Google Docs.
