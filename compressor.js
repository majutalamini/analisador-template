// compressor.js
// Reduz um .docx para caber em um limite de tamanho (padrão: 2 MB) sem mexer no texto
// nem na formatação. Tudo roda localmente no navegador; o arquivo não sai do computador.
//
// Ordem das etapas (para assim que o arquivo fica dentro do limite):
//   1. Limpeza sem perda: remove a miniatura de pré-visualização, imagens que não são
//      usadas em lugar nenhum do documento e recomprime os XMLs no nível máximo.
//   2. (Opcional) Remove fontes incorporadas — só se o usuário permitir.
//   3. Comprime as imagens em rodadas progressivas (menos resolução / qualidade a cada
//      rodada). Prints em PNG sem transparência viram JPEG, que é bem menor.
//
// O tamanho em que a imagem aparece na página fica gravado no XML do Word, separado dos
// pixels — por isso reduzir a resolução não muda o layout do documento.
//
// Depende do JSZip (jszip.min.js), que já é carregado pelo popup.html.
(function (global) {
  "use strict";

  // 2.000.000 bytes: fica abaixo de "2 MB" tanto na conta decimal (2.000.000) quanto na
  // binária (2.097.152), então passa em qualquer sistema que use um dos dois limites.
  const DEFAULT_TARGET_BYTES = 2000000;

  // Imagens menores que isso (logos, ícones) não valem a perda de qualidade.
  const MIN_IMAGE_BYTES = 20 * 1024;

  const ROUNDS = [
    { maxSide: 2000, quality: 0.85 },
    { maxSide: 1600, quality: 0.75 },
    { maxSide: 1280, quality: 0.65 },
    { maxSide: 1024, quality: 0.55 },
    { maxSide: 800, quality: 0.45 },
    { maxSide: 640, quality: 0.4 },
  ];

  // Formatos que o navegador consegue abrir e regravar. GIF fica de fora para não perder
  // animação; EMF/WMF/TIFF/SVG o navegador não decodifica (ou são vetoriais).
  const RASTER_KINDS = { jpg: "jpeg", jpeg: "jpeg", jpe: "jpeg", jfif: "jpeg", png: "png", bmp: "bmp" };
  const MIME_BY_KIND = { jpeg: "image/jpeg", png: "image/png", bmp: "image/bmp" };
  const CONTENT_TYPE_BY_EXT = { jpeg: "image/jpeg", png: "image/png" };

  const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  const NS_CT = "http://schemas.openxmlformats.org/package/2006/content-types";
  const XML_DECL = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';

  // ---------- Utilidades de caminho dentro do pacote ----------

  function extOf(path) {
    const m = path.match(/\.([^./]+)$/);
    return m ? m[1].toLowerCase() : "";
  }

  // "word/_rels/document.xml.rels" -> "word/"
  function relsSourceDir(relsPath) {
    const m = relsPath.match(/^(.*\/)?_rels\/[^/]+\.rels$/);
    return m ? m[1] || "" : "";
  }

  function resolveTarget(dir, target) {
    let t = target;
    try { t = decodeURIComponent(target); } catch (_) { /* mantém como está */ }
    const raw = t.startsWith("/") ? t.slice(1) : dir + t;
    const out = [];
    for (const part of raw.split("/")) {
      if (part === "" || part === ".") continue;
      if (part === "..") out.pop();
      else out.push(part);
    }
    return out.join("/");
  }

  // ---------- Pacote: zip + XMLs editados em memória ----------

  class DocxPackage {
    constructor(zip) {
      this.zip = zip;
      this.xmlCache = new Map(); // caminho -> Document
      this.dirty = new Set();
    }

    paths() {
      const list = [];
      this.zip.forEach((p, f) => { if (!f.dir) list.push(p); });
      return list;
    }

    has(path) { return !!this.zip.file(path); }

    // createFolders: false evita que o JSZip crie entradas de pasta vazias (ex.: "word/media/").
    put(path, data, opts = {}) { this.zip.file(path, data, { createFolders: false, ...opts }); }

    async bytes(path) { return await this.zip.file(path).async("uint8array"); }

    async xml(path) {
      if (this.xmlCache.has(path)) return this.xmlCache.get(path);
      const file = this.zip.file(path);
      if (!file) return null;
      const text = await file.async("string");
      const doc = new DOMParser().parseFromString(text, "application/xml");
      if (doc.getElementsByTagName("parsererror").length) return null;
      this.xmlCache.set(path, doc);
      return doc;
    }

    markDirty(path) { this.dirty.add(path); }

    remove(path) {
      this.zip.remove(path);
      this.xmlCache.delete(path);
      this.dirty.delete(path);
    }

    flush() {
      for (const path of this.dirty) {
        const doc = this.xmlCache.get(path);
        if (!doc) continue;
        let text = new XMLSerializer().serializeToString(doc);
        if (!text.startsWith("<?xml")) text = XML_DECL + text;
        this.put(path, text);
      }
      this.dirty.clear();
    }

    async generate() {
      this.flush();
      return await this.zip.generateAsync({
        type: "blob",
        mimeType: DOCX_MIME,
        compression: "DEFLATE",
        compressionOptions: { level: 9 },
      });
    }

    // Todas as relações internas: { relsPath, el, resolved }
    async relationships() {
      const list = [];
      for (const relsPath of this.paths().filter((p) => p.endsWith(".rels"))) {
        const doc = await this.xml(relsPath);
        if (!doc) continue;
        const dir = relsSourceDir(relsPath);
        for (const el of Array.from(doc.getElementsByTagNameNS("*", "Relationship"))) {
          if ((el.getAttribute("TargetMode") || "").toLowerCase() === "external") continue;
          const target = el.getAttribute("Target");
          if (!target) continue;
          list.push({ relsPath, el, resolved: resolveTarget(dir, target) });
        }
      }
      return list;
    }

    async ensureDefaultContentType(ext, contentType) {
      const doc = await this.xml("[Content_Types].xml");
      if (!doc) return;
      const exists = Array.from(doc.getElementsByTagNameNS("*", "Default"))
        .some((d) => (d.getAttribute("Extension") || "").toLowerCase() === ext);
      if (exists) return;
      const el = doc.createElementNS(NS_CT, "Default");
      el.setAttribute("Extension", ext);
      el.setAttribute("ContentType", contentType);
      doc.documentElement.insertBefore(el, doc.documentElement.firstChild);
      this.markDirty("[Content_Types].xml");
    }

    async removeOverride(partPath) {
      const doc = await this.xml("[Content_Types].xml");
      if (!doc) return;
      for (const el of Array.from(doc.getElementsByTagNameNS("*", "Override"))) {
        if ((el.getAttribute("PartName") || "").replace(/^\//, "") === partPath) {
          el.parentNode.removeChild(el);
          this.markDirty("[Content_Types].xml");
        }
      }
    }
  }

  // ---------- Etapa 1: limpeza sem perda ----------

  async function removeThumbnail(pkg) {
    const thumbs = pkg.paths().filter((p) => /^docProps\/thumbnail\.[^/]+$/i.test(p));
    if (!thumbs.length) return false;
    for (const rel of await pkg.relationships()) {
      if (thumbs.includes(rel.resolved)) {
        rel.el.parentNode.removeChild(rel.el);
        pkg.markDirty(rel.relsPath);
      }
    }
    for (const t of thumbs) {
      await pkg.removeOverride(t);
      pkg.remove(t);
    }
    return true;
  }

  async function removeUnusedMedia(pkg) {
    const used = new Set((await pkg.relationships()).map((r) => r.resolved));
    let removed = 0;
    for (const p of pkg.paths()) {
      if (/(^|\/)media\/[^/]+$/.test(p) && !used.has(p)) {
        await pkg.removeOverride(p);
        pkg.remove(p);
        removed++;
      }
    }
    return removed;
  }

  // O Word não grava os XMLs no nível máximo de compressão; regravar costuma tirar alguns %.
  async function recompressXml(pkg) {
    for (const p of pkg.paths()) {
      if (!/\.(xml|rels)$/i.test(p) || pkg.xmlCache.has(p)) continue;
      pkg.put(p, await pkg.bytes(p));
    }
  }

  // ---------- Etapa 2: fontes incorporadas (opcional) ----------

  async function removeEmbeddedFonts(pkg) {
    const fontFiles = pkg.paths().filter((p) => /^word\/fonts\//i.test(p));
    if (!fontFiles.length) return 0;

    const fontTable = await pkg.xml("word/fontTable.xml");
    if (fontTable) {
      for (const tag of ["embedRegular", "embedBold", "embedItalic", "embedBoldItalic"]) {
        for (const el of Array.from(fontTable.getElementsByTagNameNS(NS_W, tag))) el.parentNode.removeChild(el);
      }
      pkg.markDirty("word/fontTable.xml");
    }

    const settings = await pkg.xml("word/settings.xml");
    if (settings) {
      for (const tag of ["embedTrueTypeFonts", "embedSystemFonts", "saveSubsetFonts"]) {
        for (const el of Array.from(settings.getElementsByTagNameNS(NS_W, tag))) el.parentNode.removeChild(el);
      }
      pkg.markDirty("word/settings.xml");
    }

    for (const rel of await pkg.relationships()) {
      if (fontFiles.includes(rel.resolved)) {
        rel.el.parentNode.removeChild(rel.el);
        pkg.markDirty(rel.relsPath);
      }
    }
    for (const f of fontFiles) {
      await pkg.removeOverride(f);
      pkg.remove(f);
    }
    return fontFiles.length;
  }

  // ---------- Etapa 3: imagens ----------

  // Lê a orientação EXIF de um JPEG (1 = normal) e onde ela está gravada no arquivo.
  function readJpegOrientation(b) {
    const info = { orientation: 1, offset: -1, littleEndian: false };
    if (b[0] !== 0xff || b[1] !== 0xd8) return info;
    let i = 2;
    while (i + 4 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; }
      if (marker === 0xd9 || marker === 0xda) break;
      const len = (b[i + 2] << 8) | b[i + 3];
      const seg = i + 4;
      if (marker === 0xe1 && b[seg] === 0x45 && b[seg + 1] === 0x78 && b[seg + 2] === 0x69 && b[seg + 3] === 0x66) {
        const t = seg + 6;
        const le = b[t] === 0x49;
        const u16 = (o) => (le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1]);
        const u32 = (o) => (le ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
          : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0);
        const ifd = t + u32(t + 4);
        const count = ifd + 2 <= b.length ? u16(ifd) : 0;
        for (let k = 0; k < count; k++) {
          const e = ifd + 2 + k * 12;
          if (e + 12 > b.length) break;
          if (u16(e) === 0x0112) {
            const value = u16(e + 8);
            if (value >= 2 && value <= 8) Object.assign(info, { orientation: value, offset: e + 8, littleEndian: le });
            return info;
          }
        }
        return info;
      }
      i = seg + len - 2;
    }
    return info;
  }

  // Cópia do JPEG com a orientação EXIF trocada para "normal", para o navegador entregar
  // os pixels exatamente como estão gravados (sem girar).
  function withoutExifRotation(bytes, info) {
    const copy = bytes.slice();
    copy[info.offset] = info.littleEndian ? 1 : 0;
    copy[info.offset + 1] = info.littleEndian ? 0 : 1;
    return copy;
  }

  // Insere um bloco EXIF mínimo só com a orientação, logo após o início do JPEG.
  function withExifOrientation(jpeg, orientation) {
    const exif = new Uint8Array([
      0xff, 0xe1, 0x00, 0x22,
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // TIFF big-endian, IFD0 no offset 8
      0x00, 0x01, // 1 entrada
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation & 0xff, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // sem próximo IFD
    ]);
    const out = new Uint8Array(jpeg.length + exif.length);
    out.set(jpeg.subarray(0, 2), 0);
    out.set(exif, 2);
    out.set(jpeg.subarray(2), 2 + exif.length);
    return out;
  }

  function canvasToBytes(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("Falha ao gerar a imagem."));
        blob.arrayBuffer().then((buf) => resolve(new Uint8Array(buf)), reject);
      }, type, quality);
    });
  }

  function hasTransparency(ctx, w, h) {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
    return false;
  }

  // Recodifica a imagem original com o limite de resolução / qualidade da rodada.
  async function encodeImage(img, round) {
    // Fotos com orientação EXIF (comum em celular) são processadas sem girar e recebem de
    // volta a mesma tag: assim aparecem exatamente como antes em qualquer programa.
    const bitmap = await createImageBitmap(new Blob([img.decodeBytes], { type: MIME_BY_KIND[img.kind] }));
    let canvas = null;
    try {
      const scale = Math.min(1, round.maxSide / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: img.kind !== "jpeg" && img.hasAlpha === undefined });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, w, h);

      if (img.kind === "jpeg") img.hasAlpha = false;
      else if (img.hasAlpha === undefined) img.hasAlpha = hasTransparency(ctx, w, h);

      if (img.hasAlpha) {
        // Transparência precisa continuar PNG; aqui o ganho vem só da resolução menor.
        return { bytes: await canvasToBytes(canvas, "image/png"), ext: "png" };
      }

      // JPEG não tem transparência: pinta fundo branco por trás antes de codificar.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      let bytes = await canvasToBytes(canvas, "image/jpeg", round.quality);
      if (img.exif && img.exif.orientation > 1) bytes = withExifOrientation(bytes, img.exif.orientation);
      return { bytes, ext: "jpeg" };
    } finally {
      bitmap.close();
      if (canvas) { canvas.width = 0; canvas.height = 0; }
    }
  }

  function uniquePath(pkg, wanted, current) {
    if (wanted === current || !pkg.has(wanted)) return wanted;
    const m = wanted.match(/^(.*?)(\.[^./]+)$/);
    for (let n = 2; ; n++) {
      const candidate = `${m[1]}_${n}${m[2]}`;
      if (!pkg.has(candidate)) return candidate;
    }
  }

  // Grava a nova versão da imagem; se o formato mudou (PNG -> JPEG), renomeia o arquivo e
  // atualiza todas as relações que apontavam para ele.
  async function replaceImage(pkg, img, result) {
    const curExt = extOf(img.path);
    const sameFormat = (RASTER_KINDS[curExt] || curExt) === result.ext;
    if (sameFormat) {
      pkg.put(img.path, result.bytes, { compression: "STORE" });
      return;
    }
    const base = img.path.replace(/\.[^./]+$/, "");
    const newPath = uniquePath(pkg, `${base}.${result.ext}`, img.path);
    const newName = newPath.split("/").pop();
    for (const rel of img.refs) {
      const target = rel.el.getAttribute("Target");
      rel.el.setAttribute("Target", target.replace(/[^/]*$/, newName));
      pkg.markDirty(rel.relsPath);
    }
    await pkg.removeOverride(img.path);
    await pkg.ensureDefaultContentType(result.ext, CONTENT_TYPE_BY_EXT[result.ext]);
    pkg.remove(img.path);
    pkg.put(newPath, result.bytes, { compression: "STORE" });
    img.path = newPath;
  }

  async function collectImages(pkg) {
    const rels = await pkg.relationships();
    const images = [];
    for (const p of pkg.paths()) {
      if (!/(^|\/)media\/[^/]+$/.test(p)) continue;
      const kind = RASTER_KINDS[extOf(p)];
      if (!kind) continue;
      const original = await pkg.bytes(p);
      if (original.length < MIN_IMAGE_BYTES) continue;
      const exif = kind === "jpeg" ? readJpegOrientation(original) : null;
      images.push({
        path: p,
        kind,
        original,
        size: original.length,
        refs: rels.filter((r) => r.resolved === p),
        exif,
        decodeBytes: exif && exif.orientation > 1 ? withoutExifRotation(original, exif) : original,
        hasAlpha: undefined,
        failed: false,
      });
    }
    return images.sort((a, b) => b.size - a.size);
  }

  // ---------- Diagnóstico (quando não dá para chegar ao limite) ----------

  async function breakdown(pkg) {
    const parts = { imagens: 0, imagensNaoComprimiveis: 0, fontes: 0, objetos: 0 };
    for (const p of pkg.paths()) {
      const size = (await pkg.bytes(p)).length;
      if (/(^|\/)media\//.test(p)) {
        parts.imagens += size;
        if (!RASTER_KINDS[extOf(p)]) parts.imagensNaoComprimiveis += size;
      } else if (/^word\/fonts\//i.test(p)) parts.fontes += size;
      else if (/^word\/embeddings\//i.test(p)) parts.objetos += size;
    }
    return parts;
  }

  // ---------- Fluxo principal ----------

  async function compress(input, options = {}) {
    const target = options.targetBytes || DEFAULT_TARGET_BYTES;
    const allowFontRemoval = !!options.allowFontRemoval;
    const progress = typeof options.onProgress === "function" ? options.onProgress : () => {};
    const originalSize = input.byteLength ?? input.size;

    const result = {
      status: "ok",
      originalSize,
      finalSize: originalSize,
      target,
      blob: null,
      stats: {
        thumbnailRemoved: false,
        unusedMediaRemoved: 0,
        fontsRemoved: 0,
        imagesCompressed: 0,
        imagesConverted: 0,
        round: 0,
        totalRounds: ROUNDS.length,
      },
      breakdown: null,
    };

    if (originalSize <= target) {
      result.status = "already-small";
      return result;
    }

    progress({ text: "Abrindo o documento...", fraction: 0.02 });
    let zip;
    try {
      zip = await JSZip.loadAsync(input);
    } catch (_) {
      throw new Error("Não foi possível abrir o arquivo. Ele está corrompido ou não é um .docx.");
    }
    if (!zip.file("word/document.xml")) throw new Error("Este arquivo não parece ser um .docx do Word.");

    const pkg = new DocxPackage(zip);
    const done = async () => {
      const blob = await pkg.generate();
      result.blob = blob;
      result.finalSize = blob.size;
      return blob.size <= target;
    };

    // Etapa 1
    progress({ text: "Removendo itens desnecessários...", fraction: 0.06 });
    result.stats.thumbnailRemoved = await removeThumbnail(pkg);
    result.stats.unusedMediaRemoved = await removeUnusedMedia(pkg);
    await recompressXml(pkg);
    if (await done()) return result;

    // Etapa 2
    if (allowFontRemoval) {
      progress({ text: "Removendo fontes incorporadas...", fraction: 0.1 });
      result.stats.fontsRemoved = await removeEmbeddedFonts(pkg);
      if (result.stats.fontsRemoved && (await done())) return result;
    }

    // Etapa 3
    const images = await collectImages(pkg);
    if (images.length) {
      const changed = new Set();
      const converted = new Set();
      for (let r = 0; r < ROUNDS.length; r++) {
        const round = ROUNDS[r];
        result.stats.round = r + 1;
        for (let i = 0; i < images.length; i++) {
          const img = images[i];
          if (img.failed) continue;
          progress({
            text: `Comprimindo imagens — rodada ${r + 1} de ${ROUNDS.length} (${i + 1}/${images.length})`,
            fraction: 0.12 + 0.85 * ((r + (i + 1) / images.length) / ROUNDS.length),
          });
          let encoded;
          try {
            encoded = await encodeImage(img, round);
          } catch (err) {
            console.warn("Imagem ignorada:", img.path, err);
            img.failed = true;
            continue;
          }
          // Cada rodada parte da imagem original; só troca se ficar menor que a atual.
          if (encoded.bytes.length < img.size) {
            const before = img.path;
            await replaceImage(pkg, img, encoded);
            img.size = encoded.bytes.length;
            changed.add(img);
            if (img.path !== before) converted.add(img);
          }
        }
        progress({ text: `Verificando o tamanho (rodada ${r + 1})...`, fraction: 0.12 + 0.85 * ((r + 1) / ROUNDS.length) });
        result.stats.imagesCompressed = changed.size;
        result.stats.imagesConverted = converted.size;
        if (await done()) return result;
      }
    }

    // Não chegou ao limite: devolve o melhor resultado possível e explica o que pesa.
    if (!result.blob) await done();
    result.status = "not-reached";
    result.breakdown = await breakdown(pkg);
    result.breakdown.fontesPresentes = pkg.paths().some((p) => /^word\/fonts\//i.test(p));
    return result;
  }

  global.DocxCompressor = { compress, DEFAULT_TARGET_BYTES };
})(typeof window !== "undefined" ? window : globalThis);
