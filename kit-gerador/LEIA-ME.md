# Gerar o script de console a partir da extensão

Quando a extensão mudar (linter, compressor, variáveis), gere o script de novo:

    node montar.mjs caminho/da/analisador-template-main analisador-templates-console.js

- `ui.js` é só a interface no visual do Next Fit (as quatro abas).
- A análise, a compressão, o modelo de referência e as listas de variáveis vêm direto
  dos arquivos da extensão; não é preciso copiar nada à mão.
