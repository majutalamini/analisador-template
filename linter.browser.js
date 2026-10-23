(function (global) {
  "use strict";

  const TAG_RE = /<<\s*(\/?)(if|foreach|image)?\s*(?:\[([^\]]*)\])?\s*>>/g;

  function decodeXmlEntities(s) {
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, "&");
  }

  // Fim de paragrafo (Enter) e quebra de linha manual (Shift+Enter, <w:br/> / <w:cr/>) viram
  // "\n" no texto extraido - assim uma tag partida em duas linhas pode ser detectada.
  function markLineBreaks(documentXml) {
    return documentXml.replace(/<\/w:p>|<w:(?:br|cr)\b[^>]*\/>/g, "\u2029");
  }

  function extractLogicalText(documentXml) {
    const withBreaks = markLineBreaks(documentXml);
    let out = "";
    const re = /<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\u2029/g;
    let m;
    while ((m = re.exec(withBreaks))) {
      if (m[0] === "\u2029") out += "\n";
      else out += decodeXmlEntities(m[1]);
    }
    return out;
  }

  // Como extractLogicalText, mas tambem marca quais trechos do texto extraido vem de
  // dentro de uma caixa de texto de um desenho/forma (<w:txbxContent>) - usado para nao
  // acusar "<<image [...]>>" como texto solto quando ele ja esta dentro de um desenho.
  // Tambem registra em qual "container" (celula de tabela ou caixa de texto) cada trecho
  // esta, para validar que a abertura e o fechamento de um bloco <<if>>/<<foreach>> ficam
  // no mesmo lugar - o texto extraido e "achatado" e, sem isso, um bloco que comeca em uma
  // celula e termina em outra parece valido.
  function extractLogicalTextWithDrawingRanges(documentXml) {
    const withBreaks = markLineBreaks(documentXml);
    let out = "";
    const drawingRanges = [];
    const containers = [];      // celulas e caixas de texto, na ordem em que aparecem
    const containerRanges = []; // [inicio, fim, container] de cada trecho do texto extraido
    const containerStack = [];
    const tableStack = [];
    let tableCount = 0;
    let depth = 0;

    const pushRange = (start, end) => {
      const c = containerStack[containerStack.length - 1] || null;
      const last = containerRanges[containerRanges.length - 1];
      if (last && last[2] === c && last[1] === start) last[1] = end;
      else containerRanges.push([start, end, c]);
    };

    const re = /<w:txbxContent\b[^>]*>|<\/w:txbxContent>|<w:tbl\b[^>]*>|<\/w:tbl>|<w:tr\b[^>]*>|<\/w:tr>|<w:tc\b[^>]*>|<\/w:tc>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\u2029/g;
    let m;
    while ((m = re.exec(withBreaks))) {
      const tok = m[0];
      if (tok === "\u2029") { pushRange(out.length, out.length + 1); out += "\n"; continue; }
      if (tok.startsWith("<w:txbxContent")) {
        depth++;
        const c = { type: "textbox", textStart: out.length, textEnd: null };
        containers.push(c);
        containerStack.push(c);
        continue;
      }
      if (tok === "</w:txbxContent>") {
        depth = Math.max(0, depth - 1);
        const c = containerStack.pop();
        if (c) c.textEnd = out.length;
        continue;
      }
      if (tok.startsWith("<w:tbl")) { tableStack.push({ id: ++tableCount, rowIndex: -1, cells: [] }); continue; }
      if (tok === "</w:tbl>") { tableStack.pop(); continue; }
      if (tok.startsWith("<w:tr")) {
        const t = tableStack[tableStack.length - 1];
        if (t) { t.rowIndex++; t.cells = []; }
        continue;
      }
      if (tok === "</w:tr>") {
        const t = tableStack[tableStack.length - 1];
        if (t && t.cells.length) t.cells[t.cells.length - 1].isLastCell = true;
        continue;
      }
      if (tok.startsWith("<w:tc")) {
        const t = tableStack[tableStack.length - 1];
        const c = {
          type: "cell",
          tableId: t ? t.id : 0,
          rowIndex: t ? t.rowIndex : 0,
          cellIndex: t ? t.cells.length : 0,
          isLastCell: false,
          textStart: out.length,
          textEnd: null,
        };
        if (t) t.cells.push(c);
        containers.push(c);
        containerStack.push(c);
        continue;
      }
      if (tok === "</w:tc>") {
        const c = containerStack.pop();
        if (c) c.textEnd = out.length;
        continue;
      }
      const start = out.length;
      out += decodeXmlEntities(m[1]);
      if (depth > 0) drawingRanges.push([start, out.length]);
      if (out.length > start) pushRange(start, out.length);
    }
    return { text: out, drawingRanges, containerRanges };
  }

  function isInsideDrawing(drawingRanges, index) {
    return drawingRanges.some(([start, end]) => index >= start && index < end);
  }

  // Container (celula de tabela / caixa de texto) em que esta o caractere `index`, ou null
  // quando esta no corpo do documento, fora de qualquer tabela.
  function containerAt(containerRanges, index) {
    for (const [start, end, c] of containerRanges) {
      if (index >= start && index < end) return c;
    }
    return null;
  }

  // O motor de templates so aceita um bloco <<if>>/<<foreach>> cuja abertura e fechamento
  // estejam no mesmo container (mesma celula, mesma caixa de texto ou ambos fora de tabela).
  // Excecao: bloco de linhas de tabela - abertura no inicio da primeira celula de uma linha e
  // fechamento no fim da ultima celula da mesma linha ou de uma linha seguinte.
  function isValidBlockScope(text, containerRanges, openTag, closeTag) {
    const a = containerAt(containerRanges, openTag.start);
    const b = containerAt(containerRanges, closeTag.start);
    if (a === b) return true;
    return !!(
      a && b && a.type === "cell" && b.type === "cell" &&
      a.tableId === b.tableId &&
      a.cellIndex === 0 && b.isLastCell &&
      b.rowIndex >= a.rowIndex &&
      b.textEnd != null &&
      !text.slice(a.textStart, openTag.start).trim() &&
      !text.slice(closeTag.end, b.textEnd).trim()
    );
  }

  function extractIdentifiers(expr) {
    if (!expr) return [];
    const ids = expr.match(/[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*/g) || [];
    return ids.filter((id) => id !== "in");
  }

  function buildSchemaFromText(text) {
    const schema = {
      variables: new Set(),
      imageVariables: new Set(),
      rawConditions: new Set(),
      rawLoops: new Set(),
      conditionFields: new Set(),
      loopVars: new Set(),
      loopCollections: new Set(),
      allIdentifiers: new Set(),
    };
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(text))) {
      const isClose = m[1] === "/";
      const kind = m[2];
      const inner = (m[3] || "").trim();
      if (isClose) continue;
      if (kind === "if") {
        schema.rawConditions.add(inner);
        extractIdentifiers(inner).forEach((id) => { schema.conditionFields.add(id); schema.allIdentifiers.add(id); });
      } else if (kind === "foreach") {
        schema.rawLoops.add(inner);
        const mm = inner.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_.]*)$/);
        if (mm) {
          schema.loopVars.add(mm[1]);
          schema.loopCollections.add(mm[2]);
          schema.allIdentifiers.add(mm[1]);
          schema.allIdentifiers.add(mm[2]);
        }
      } else if (kind === "image") {
        if (inner) { schema.imageVariables.add(inner); schema.allIdentifiers.add(inner); }
      } else if (inner) {
        schema.variables.add(inner);
        schema.allIdentifiers.add(inner);
        inner.split(".").forEach((p) => schema.allIdentifiers.add(p));
      }
    }
    return schema;
  }

  function setsToArrays(schema) {
    const out = {};
    for (const [k, v] of Object.entries(schema)) out[k] = [...v].sort();
    return out;
  }

  const PART_DEFS = [
    { re: /^word\/document\.xml$/, label: null },
    { re: /^word\/header(\d*)\.xml$/, label: (m) => `Cabeçalho ${m[1] || 1}` },
    { re: /^word\/footer(\d*)\.xml$/, label: (m) => `Rodapé ${m[1] || 1}` },
  ];

  function getDocxParts(zip) {
    const parts = [];
    const names = Object.keys(zip.files).sort();
    for (const name of names) {
      if (zip.files[name].dir) continue;
      for (const def of PART_DEFS) {
        const m = name.match(def.re);
        if (m) {
          parts.push({ name, label: typeof def.label === "function" ? def.label(m) : def.label });
          break;
        }
      }
    }
    return parts;
  }

  async function extractLogicalTextFromParts(zip, parts) {
    const out = [];
    for (const part of parts) {
      const file = zip.file(part.name);
      if (!file) continue;
      const xml = await file.async("string");
      out.push({ part, text: extractLogicalText(xml) });
    }
    return out;
  }

  async function extractLogicalTextFromPartsWithDrawingRanges(zip, parts) {
    const out = [];
    for (const part of parts) {
      const file = zip.file(part.name);
      if (!file) continue;
      const xml = await file.async("string");
      const { text, drawingRanges, containerRanges } = extractLogicalTextWithDrawingRanges(xml);
      out.push({ part, text, drawingRanges, containerRanges });
    }
    return out;
  }

  async function buildSchemaFromDocxBuffer(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parts = getDocxParts(zip);
    const chunks = await extractLogicalTextFromParts(zip, parts);
    const combinedText = chunks.map((c) => c.text).join("\n");
    return setsToArrays(buildSchemaFromText(combinedText));
  }

  async function buildMergedSchema(arrayBuffers) {
    const merged = {};
    for (const buf of arrayBuffers) {
      const s = await buildSchemaFromDocxBuffer(buf);
      for (const [k, v] of Object.entries(s)) merged[k] = new Set([...(merged[k] || []), ...v]);
    }
    const out = {};
    for (const [k, v] of Object.entries(merged)) out[k] = [...v].sort();
    return out;
  }

  // ---------------- linter ----------------

  function toSet(v) { return v instanceof Set ? v : new Set(v || []); }

  function normalizeSchema(schema) {
    return {
      variables: toSet(schema.variables),
      imageVariables: toSet(schema.imageVariables),
      rawConditions: toSet(schema.rawConditions),
      rawLoops: toSet(schema.rawLoops),
      conditionFields: toSet(schema.conditionFields),
      loopVars: toSet(schema.loopVars),
      loopCollections: toSet(schema.loopCollections),
      allIdentifiers: toSet(schema.allIdentifiers),
    };
  }

  function lineOf(text, index) { return text.slice(0, index).split("\n").length; }

  function snippetAround(text, index, len, radius = 40) {
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + len + radius);
    return text.slice(start, end).replace(/\s+/g, " ").trim();
  }

  // Como snippetAround, mas sem contexto antes do indice — usado para previews que devem
  // comecar exatamente no inicio da tag problematica, sem incluir o final da tag anterior.
  function snippetFrom(text, index, len) {
    const end = Math.min(text.length, index + len);
    return text.slice(index, end).replace(/\s+/g, " ").trim();
  }

  // Descobre o que digitar na busca do Google Docs para chegar ao erro: o trecho da tag
  // (sem atravessar quebras de paragrafo, que a busca do Docs nao cruza) e quantas vezes
  // esse mesmo trecho aparece antes dele, para pular as ocorrencias anteriores.
  // A busca do Docs ignora maiusculas/minusculas por padrao, entao a contagem tambem ignora.
  function locateInText(text, index, length) {
    let searchText = text.slice(index, index + Math.min(Math.max(length || 0, 1), 40));
    const nl = searchText.indexOf("\n");
    if (nl !== -1) searchText = searchText.slice(0, nl);
    searchText = searchText.trimEnd();
    if (!searchText) return {};

    const hay = text.slice(0, index).toLowerCase();
    const needle = searchText.toLowerCase();
    let occurrence = 0;
    for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + needle.length)) occurrence++;
    return { searchText, occurrence };
  }

  const WS_RE = /\s/;
  const KEYWORD_RE = /^(if|foreach|image)\b/;

  // Percorre o texto caractere a caractere procurando tags "<<...>>". Ao contrario de uma
  // unica regex, isso permite:
  //  - nao se confundir com os operadores "<" / ">" usados dentro de condicoes, ex.:
  //    "<<if [modalidade.TemGradeHorarios > 0]>>" (o ">" ali e comparacao, nao fechamento);
  //  - detectar uma tag que nunca encontra o ">>" de fechamento (ex.: "<<if [Cond]" seguido
  //    de texto comum ou de outra tag), que antes passava despercebida por nenhuma regex
  //    conseguir casar com ela.
  // Retorna as tags reconhecidas (bem formadas ou nao) e ja empilha em `problems` os erros
  // de sintaxe encontrados durante a varredura.
  function scanTags(text, problems) {
    const tags = [];
    const n = text.length;
    let i = 0;
    while (i < n) {
      if (text[i] !== "<") { i++; continue; }

      let j = i;
      while (j < n && text[j] === "<") j++;
      const openLen = j - i;
      const tagStart = i;
      let k = j;

      while (k < n && WS_RE.test(text[k])) k++;
      let isClose = false;
      if (text[k] === "/") { isClose = true; k++; while (k < n && WS_RE.test(text[k])) k++; }

      let kind = null;
      const kwMatch = KEYWORD_RE.exec(text.slice(k, k + 10));
      if (kwMatch) { kind = kwMatch[1]; k += kind.length; while (k < n && WS_RE.test(text[k])) k++; }

      let inner = null;
      let hasBracket = false;
      if (text[k] === "[") {
        hasBracket = true;
        const bStart = k + 1;
        const bEnd = text.indexOf("]", bStart);
        if (bEnd === -1) {
          const line = lineOf(text, tagStart);
          const snippet = snippetFrom(text, tagStart, 60);
          problems.push({ line, snippet, index: tagStart, length: 60, message: `Tag "${snippet}" tem um colchete "[" que nunca é fechado com "]".` });
          i = tagStart + openLen;
          continue;
        }
        inner = text.slice(bStart, bEnd);
        k = bEnd + 1;
      }
      while (k < n && WS_RE.test(text[k])) k++;

      // Caso "<<NomeDaVariavel>>" (sem colchetes) — trata separadamente para dar uma
      // mensagem especifica em vez do erro generico de "tag nunca fechada".
      if (!hasBracket && !kind && !isClose) {
        const idMatch = /^[A-Za-z_][A-Za-z0-9_.]*/.exec(text.slice(k));
        if (idMatch) {
          let k2 = k + idMatch[0].length;
          while (k2 < n && WS_RE.test(text[k2])) k2++;
          if (text[k2] === ">") {
            let m2 = k2;
            while (m2 < n && text[m2] === ">") m2++;
            const raw = text.slice(tagStart, m2);
            problems.push({ line: lineOf(text, tagStart), snippet: raw, index: tagStart, length: raw.length, message: `Tag "${raw}" sem colchetes — o formato correto é "<<[${idMatch[0]}]>>".` });
            i = m2;
            continue;
          }
        }
      }

      if (text[k] === ">") {
        let m2 = k;
        while (m2 < n && text[m2] === ">") m2++;
        const closeLen = m2 - k;
        const tagEnd = m2;
        const rawText = text.slice(tagStart, tagEnd);
        const raw = rawText.replace(/\s+/g, " ");
        // O motor de templates nao aceita uma tag partida em mais de uma linha, ex.:
        // "<<if" em uma linha e "[TemResponsavel > 0]>>" na seguinte.
        if (rawText.includes("\n")) {
          problems.push({ line: lineOf(text, tagStart), snippet: raw, index: tagStart, length: rawText.length, message: `A tag "${raw}" está quebrada em linhas. É necessário inserir a tag inteira na mesma linha.` });
        }
        tags.push({ start: tagStart, end: tagEnd, openLen, closeLen, isClose, kind, inner, raw });
        i = tagEnd;
        continue;
      }

      // Nunca encontrou o ">" de fechamento antes de outro conteudo (texto comum ou outra
      // tag) — a tag ficou "aberta" e mal formada.
      const preview = snippetFrom(text, tagStart, 60);
      problems.push({ line: lineOf(text, tagStart), snippet: preview, index: tagStart, length: 60, message: `Tag "${preview}" nunca é fechada com ">>" antes de outro conteúdo — verifique se falta o fechamento dessa tag.` });
      if (kind === "if" || kind === "foreach") {
        tags.push({ start: tagStart, end: tagStart + openLen, openLen, closeLen: 0, isClose, kind, inner: null, raw: text.slice(tagStart, Math.min(n, tagStart + 40)), malformed: true });
      }
      i = tagStart + openLen;
    }
    return tags;
  }

  function lintText(text, rawSchema, drawingRanges, containerRanges) {
    const schema = normalizeSchema(rawSchema);
    const ranges = drawingRanges || [];
    const scopes = containerRanges || [];
    const problems = [];
    const validIdentifiers = new Set([...schema.variables, ...schema.conditionFields, ...schema.loopVars, ...schema.loopCollections]);

    const tags = scanTags(text, problems);

    for (const tag of tags) {
      const { start, openLen, closeLen, isClose, kind, malformed } = tag;
      const inner = (tag.inner || "").trim();
      const line = lineOf(text, start);
      const snippet = snippetAround(text, start, tag.end - start);
      const at = { index: start, length: tag.end - start };

      if (malformed) continue; // ja reportada pelo scanTags; so entra na pilha de aninhamento abaixo

      if (openLen !== 2 || closeLen !== 2) {
        problems.push({ line, snippet, ...at, message: `Tag "${tag.raw}" está com "<" ou ">" incorretos — o formato correto usa exatamente "<<" no início e ">>" no final, sem variações.` });
        continue;
      }

      if (isClose) continue;

      if (kind === "if") {
        const ids = extractIdentifiers(inner);
        const unknown = ids.filter((id) => !validIdentifiers.has(id));
        if (unknown.length) {
          problems.push({ line, snippet, ...at, message: `Condição "<<if [${inner}]>>" usa "${unknown.join('", "')}", que não existe no modelo de referência.` });
        }
      } else if (kind === "foreach") {
        const mm = inner.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_.]*)$/);
        if (!mm) {
          problems.push({ line, snippet, ...at, message: `Laço "<<foreach [${inner}]>>" não segue o formato "item in Colecao".` });
        } else {
          const [, itemVar, coll] = mm;
          if (!schema.loopVars.has(itemVar)) problems.push({ line, snippet, ...at, message: `Laço "<<foreach [${inner}]>>" usa o item "${itemVar}", que não existe no modelo de referência.` });
          if (!schema.loopCollections.has(coll)) problems.push({ line, snippet, ...at, message: `Laço "<<foreach [${inner}]>>" usa a coleção "${coll}", que não existe no modelo de referência.` });
        }
      } else if (kind === "image") {
        if (!schema.imageVariables.has(inner)) {
          problems.push({ line, snippet, ...at, message: `Tag de imagem "<<image [${inner}]>>" não existe no modelo de referência.` });
        } else if (!isInsideDrawing(ranges, start)) {
          problems.push({ line, snippet, ...at, message: `A variável de imagem "<<image [${inner}]>>" foi encontrada como texto no documento. Ela precisa ser inserida como uma imagem (desenho) no arquivo .docx — se ficar como texto digitado, ocorrerá um erro ao gerar o documento.` });
        }
      } else {
        if (!inner) problems.push({ line, snippet, ...at, message: `Tag "<<...>>" sem nome de variável dentro dos colchetes.` });
        else if (!schema.variables.has(inner)) problems.push({ line, snippet, ...at, message: `Variável "<<[${inner}]>>" não existe no modelo de referência.` });
      }
    }

    const stack = [];
    for (const tag of tags) {
      if (tag.kind !== "if" && tag.kind !== "foreach") continue;
      const { isClose, kind } = tag;
      const line = lineOf(text, tag.start);
      const snippet = tag.malformed ? tag.raw : snippetAround(text, tag.start, tag.end - tag.start);
      const at = { index: tag.start, length: tag.end - tag.start };
      if (!isClose) {
        stack.push({ kind, line, snippet, raw: tag.raw, tag, ...at });
      } else if (stack.length === 0) {
        problems.push({ line, snippet, ...at, message: `Fechamento "<</${kind}>>" sem nenhuma abertura correspondente antes dele.` });
      } else {
        const top = stack[stack.length - 1];
        if (top.kind !== kind) {
          problems.push({ line, snippet, ...at, message: `Fechamento "<</${kind}>>" encontrado, mas a tag aberta mais recente (linha ~${top.line}: "${top.raw}") é um <<${top.kind}>> — falta fechar essa antes, ou este fechamento deveria ser "<</${top.kind}>>".` });
        } else {
          stack.pop();
          if (!top.tag.malformed && !isValidBlockScope(text, scopes, top.tag, tag)) {
            const a = containerAt(scopes, top.tag.start);
            const b = containerAt(scopes, tag.start);
            const where = a && b && a.type === "cell" && b.type === "cell"
              ? "em células diferentes da tabela. Coloque os dois na mesma célula."
              : "em lugares diferentes (dentro e fora de uma tabela ou caixa de texto). Coloque os dois no mesmo lugar.";
            problems.push({ line: top.line, snippet: top.snippet, index: top.index, length: top.length, message: `A tag "${top.raw}" e o seu "<</${kind}>>" estão ${where}` });
          }
        }
      }
    }
    for (const remaining of stack) {
      problems.push({ line: remaining.line, snippet: remaining.snippet, index: remaining.index, length: remaining.length, message: `A tag "${remaining.raw}" foi aberta, mas não tem o "<</${remaining.kind}>>" correspondente. Insira "<</${remaining.kind}>>" no ponto onde o bloco deve terminar.` });
    }

    for (const p of problems) Object.assign(p, locateInText(text, p.index, p.length));

    problems.sort((a, b) => a.line - b.line);
    return problems;
  }

  async function lintDocxBuffer(arrayBuffer, schema) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parts = getDocxParts(zip);
    const chunks = await extractLogicalTextFromPartsWithDrawingRanges(zip, parts);

    const problems = [];
    for (const { part, text, drawingRanges, containerRanges } of chunks) {
      const partProblems = lintText(text, schema, drawingRanges, containerRanges);
      for (const p of partProblems) {
        if (part.label) p.part = part.label;
        problems.push(p);
      }
    }

    problems.sort((a, b) => {
      const pa = a.part || "";
      const pb = b.part || "";
      if (pa !== pb) return pa.localeCompare(pb);
      return a.line - b.line;
    });

    return problems;
  }

  global.TemplateLinter = {
    buildSchemaFromDocxBuffer,
    buildMergedSchema,
    lintText,
    lintDocxBuffer,
    extractLogicalText,
  };
})(window);
