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

  async function buildSchemaFromDocxBuffer(arrayBuffer) {
    const zip = await JSZip.loadAsync(arrayBuffer);
    const documentXml = await zip.file("word/document.xml").async("string");
    return setsToArrays(buildSchemaFromText(extractLogicalText(documentXml)));
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

  function lintText(text, rawSchema) {
    const schema = normalizeSchema(rawSchema);
    const problems = [];
    const validIdentifiers = new Set([...schema.variables, ...schema.conditionFields, ...schema.loopVars, ...schema.loopCollections]);

    TAG_RE.lastIndex = 0;
    let m;
    while ((m = TAG_RE.exec(text))) {
      const isClose = m[1] === "/";
      const kind = m[2];
      const inner = (m[3] || "").trim();
      const line = lineOf(text, m.index);
      const snippet = snippetAround(text, m.index, m[0].length);
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
        if (!schema.imageVariables.has(inner)) problems.push({ line, snippet, message: `Tag de imagem "<<image [${inner}]>>" não existe no modelo de referência.` });
      } else {
        if (!inner) problems.push({ line, snippet, message: `Tag "<<...>>" sem nome de variável dentro dos colchetes.` });
        else if (!schema.variables.has(inner)) problems.push({ line, snippet, message: `Variável "<<[${inner}]>>" não existe no modelo de referência.` });
      }
    }

    const noBracketRe = /<<(?!\/|if\b|foreach\b|image\b)\s*[A-Za-z_][A-Za-z0-9_.]*\s*>>/g;
    while ((m = noBracketRe.exec(text))) {
      problems.push({ line: lineOf(text, m.index), snippet: snippetAround(text, m.index, m[0].length), message: `Tag "${m[0]}" sem colchetes — o formato correto é "<<[${m[0].replace(/<</, "").replace(/>>/, "").trim()}]>>".` });
    }
    const singleBracketRe = /(?<!<)<\[[^\]]+\]>(?!>)/g;
    while ((m = singleBracketRe.exec(text))) {
      problems.push({ line: lineOf(text, m.index), snippet: snippetAround(text, m.index, m[0].length), message: `Tag "${m[0]}" com colchete simples — o formato correto usa "<<" e ">>" duplicados.` });
    }

    const stack = [];
    const nestRe = /<<\s*(\/?)(if|foreach)\b\s*(?:\[[^\]]*\])?\s*>>/g;
    while ((m = nestRe.exec(text))) {
      const isClose = m[1] === "/";
      const kind = m[2];
      const line = lineOf(text, m.index);
      const snippet = snippetAround(text, m.index, m[0].length);
      if (!isClose) {
        stack.push({ kind, line, snippet, raw: m[0] });
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
    const documentXml = await zip.file("word/document.xml").async("string");
    return lintText(extractLogicalText(documentXml), schema);
  }

  global.TemplateLinter = {
    buildSchemaFromDocxBuffer,
    buildMergedSchema,
    lintText,
    lintDocxBuffer,
    extractLogicalText,
  };
})(window);
