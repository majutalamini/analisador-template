// Busca um Google Docs público como .docx.
//
// Na extensão isso funciona porque o manifest dá permissão para docs.google.com. Numa página
// web comum o navegador bloqueia essa leitura (CORS), então a página pede o arquivo para esta
// função, que roda no servidor do Firebase e repassa o .docx.
//
// Só aceita o ID de um documento e só busca a exportação pública dele, sem login: não é um
// proxy aberto e não enxerga documentos privados.

const DOC_ID = /^[a-zA-Z0-9_-]{20,100}$/;
const LIMITE_BYTES = 30 * 1024 * 1024;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

async function exportarGoogleDoc(docId, fetchImpl = fetch) {
  if (!DOC_ID.test(docId || '')) {
    return { status: 400, erro: 'Link do Google Docs inválido.' };
  }

  let res;
  try {
    res = await fetchImpl(`https://docs.google.com/document/d/${docId}/export?format=docx`, { redirect: 'follow' });
  } catch (err) {
    return { status: 502, erro: 'Não foi possível acessar o Google Docs agora. Tente de novo em instantes.' };
  }

  if (res.status === 404) {
    return { status: 404, erro: 'Documento não encontrado. Confira o link.' };
  }
  const tipo = res.headers.get('content-type') || '';
  if (!res.ok || !(tipo.includes('wordprocessingml') || tipo.includes('officedocument'))) {
    // Documento privado: o Google devolve a página de login (HTML) em vez do arquivo.
    return {
      status: 403,
      erro: 'Não foi possível ler o documento. Verifique se o compartilhamento está como "Qualquer pessoa com o link" (leitor).'
    };
  }

  const tamanho = Number(res.headers.get('content-length') || 0);
  if (tamanho > LIMITE_BYTES) {
    return { status: 413, erro: 'O documento é grande demais para analisar pelo link. Baixe como .docx e envie o arquivo.' };
  }
  const corpo = Buffer.from(await res.arrayBuffer());
  if (corpo.length > LIMITE_BYTES) {
    return { status: 413, erro: 'O documento é grande demais para analisar pelo link. Baixe como .docx e envie o arquivo.' };
  }
  return { status: 200, corpo, tipo: DOCX_MIME };
}

module.exports = { exportarGoogleDoc, DOC_ID };
