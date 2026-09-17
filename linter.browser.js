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

  function extractLogicalText(documentXml) {
    const withBreaks = documentXml.replace(/<\/w:p>/g, "\u2029");
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
  function extractLogicalTextWithDrawingRanges(documentXml) {
    const withBreaks = documentXml.replace(/<\/w:p>/g, "\u2029");
    let out = "";
    const drawingRanges = [];
    let depth = 0;
    const re = /<w:txbxContent\b[^>]*>|<\/w:txbxContent>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>|\u2029/g;
    let m;
    while ((m = re.exec(withBreaks))) {
      if (m[0] === "\u2029") { out += "\n"; continue; }
      if (m[0].startsWith("<w:txbxContent")) { depth++; continue; }
      if (m[0] === "</w:txbxContent>") { depth = Math.max(0, depth - 1); continue; }
      const start = out.length;
      out += decodeXmlEntities(m[1]);
      if (depth > 0) drawingRanges.push([start, out.length]);
    }
    return { text: out, drawingRanges };
  }

  function isInsideDrawing(drawingRanges, index) {
    return drawingRanges.some(([start, end]) => index >= start && index < end);
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
      const { text, drawingRanges } = extractLogicalTextWithDrawingRanges(xml);
      out.push({ part, text, drawingRanges });
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
          problems.push({ line, snippet, message: `Tag "${snippet}" tem um colchete "[" que nunca é fechado com "]".` });
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
            problems.push({ line: lineOf(text, tagStart), snippet: raw, message: `Tag "${raw}" sem colchetes — o formato correto é "<<[${idMatch[0]}]>>".` });
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
        tags.push({ start: tagStart, end: tagEnd, openLen, closeLen, isClose, kind, inner, raw: text.slice(tagStart, tagEnd) });
        i = tagEnd;
        continue;
      }

      // Nunca encontrou o ">" de fechamento antes de outro conteudo (texto comum ou outra
      // tag) — a tag ficou "aberta" e mal formada.
      const preview = snippetFrom(text, tagStart, 60);
      problems.push({ line: lineOf(text, tagStart), snippet: preview, message: `Tag "${preview}" nunca é fechada com ">>" antes de outro conteúdo — verifique se falta o fechamento dessa tag.` });
      if (kind === "if" || kind === "foreach") {
        tags.push({ start: tagStart, end: tagStart + openLen, openLen, closeLen: 0, isClose, kind, inner: null, raw: text.slice(tagStart, Math.min(n, tagStart + 40)), malformed: true });
      }
      i = tagStart + openLen;
    }
    return tags;
  }

  function lintText(text, rawSchema, drawingRanges) {
    const schema = normalizeSchema(rawSchema);
    const ranges = drawingRanges || [];
    const problems = [];
    const validIdentifiers = new Set([...schema.variables, ...schema.conditionFields, ...schema.loopVars, ...schema.loopCollections]);

    const tags = scanTags(text, problems);

    for (const tag of tags) {
      const { start, openLen, closeLen, isClose, kind, malformed } = tag;
      const inner = (tag.inner || "").trim();
      const line = lineOf(text, start);
      const snippet = snippetAround(text, start, tag.end - start);

      if (malformed) continue; // ja reportada pelo scanTags; so entra na pilha de aninhamento abaixo

      if (openLen !== 2 || closeLen !== 2) {
        problems.push({ line, snippet, message: `Tag "${tag.raw}" está com "<" ou ">" incorretos — o formato correto usa exatamente "<<" no início e ">>" no final, sem variações.` });
        continue;
      }

      if (isClose) continue;

      if (kind === "if") {
        const ids = extractIdentifiers(inner);
        const unknown = ids.filter((id) => !validIdentifiers.has(id));
        if (unknown.length) {
          problems.push({ line, snippet, message: `Condição "<<if [${inner}]>>" usa "${unknown.join('", "')}", que não existe no modelo de referência.` });
        }
      } else if (kind === "foreach") {
        const mm = inner.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+in\s+([A-Za-z_][A-Za-z0-9_.]*)$/);
        if (!mm) {
          problems.push({ line, snippet, message: `Laço "<<foreach [${inner}]>>" não segue o formato "item in Colecao".` });
        } else {
          const [, itemVar, coll] = mm;
          if (!schema.loopVars.has(itemVar)) problems.push({ line, snippet, message: `Laço "<<foreach [${inner}]>>" usa o item "${itemVar}", que não existe no modelo de referência.` });
          if (!schema.loopCollections.has(coll)) problems.push({ line, snippet, message: `Laço "<<foreach [${inner}]>>" usa a coleção "${coll}", que não existe no modelo de referência.` });
        }
      } else if (kind === "image") {
        if (!schema.imageVariables.has(inner)) {
          problems.push({ line, snippet, message: `Tag de imagem "<<image [${inner}]>>" não existe no modelo de referência.` });
        } else if (!isInsideDrawing(ranges, start)) {
          problems.push({ line, snippet, message: `A variável de imagem "<<image [${inner}]>>" foi encontrada como texto no documento. Ela precisa ser inserida como uma imagem (desenho) no arquivo .docx — se ficar como texto digitado, ocorrerá um erro ao gerar o documento.` });
        }
      } else {
        if (!inner) problems.push({ line, snippet, message: `Tag "<<...>>" sem nome de variável dentro dos colchetes.` });
        else if (!schema.variables.has(inner)) problems.push({ line, snippet, message: `Variável "<<[${inner}]>>" não existe no modelo de referência.` });
      }
    }

    const stack = [];
    for (const tag of tags) {
      if (tag.kind !== "if" && tag.kind !== "foreach") continue;
      const { isClose, kind } = tag;
      const line = lineOf(text, tag.start);
      const snippet = tag.malformed ? tag.raw : snippetAround(text, tag.start, tag.end - tag.start);
      if (!isClose) {
        stack.push({ kind, line, snippet, raw: tag.raw });
      } else if (stack.length === 0) {
        problems.push({ line, snippet, message: `Fechamento "<</${kind}>>" sem nenhuma abertura correspondente antes dele.` });
      } else {
        const top = stack[stack.length - 1];
        if (top.kind !== kind) {
          problems.push({ line, snippet, message: `Fechamento "<</${kind}>>" encontrado, mas a tag aberta mais recente (linha ~${top.line}: "${top.raw}") é um <<${top.kind}>> — falta fechar essa antes, ou este fechamento deveria ser "<</${top.kind}>>".` });
        } else {
          stack.pop();
        }
      }
    }
    for (const remaining of stack) {
      problems.push({ line: remaining.line, snippet: remaining.snippet, message: `A tag "${remaining.raw}" nunca é fechada com "<</${remaining.kind}>>".` });
    }

    problems.sort((a, b) => a.line - b.line);
    return problems;
  }

  async function lintDocxBuffer(arrayBuffer, schema) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const parts = getDocxParts(zip);
    const chunks = await extractLogicalTextFromPartsWithDrawingRanges(zip, parts);

    const problems = [];
    for (const { part, text, drawingRanges } of chunks) {
      const partProblems = lintText(text, schema, drawingRanges);
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
