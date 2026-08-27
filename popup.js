let DEFAULT_SCHEMA = null;
const $ = (id) => document.getElementById(id);

async function loadDefaultSchema() {
  const url = chrome.runtime.getURL("reference-schema.json");
  const res = await fetch(url);
  DEFAULT_SCHEMA = await res.json();
}

async function fileToArrayBuffer(file) {
  return await file.arrayBuffer();
}

function setStatus(text) {
  const status = $("status");
  if (!text) {
    status.classList.add("hidden");
    status.textContent = "";
  } else {
    status.classList.remove("hidden");
    status.textContent = text;
  }
}

function renderProblems(problems) {
  const summary = $("summary");
  const list = $("issueList");
  list.innerHTML = "";

  if (problems.length === 0) {
    summary.className = "ok";
    summary.textContent = "Nenhum problema encontrado. ✓";
    list.style.display = "none";
    return;
  }

  summary.className = "err";
  summary.textContent = `${problems.length} problema(s) encontrado(s).`;

  for (const p of problems) {
    const div = document.createElement("div");
    div.className = "item";
    const lineTag = document.createElement("span");
    lineTag.className = "line";
    lineTag.textContent = p.part ? `${p.part} · linha ~${p.line}` : `linha ~${p.line}`;
    div.appendChild(lineTag);
    const msg = document.createElement("div");
    msg.textContent = p.message;
    div.appendChild(msg);
    const snip = document.createElement("div");
    snip.className = "snippet";
    snip.textContent = `"…${p.snippet}…"`;
    div.appendChild(snip);
    list.appendChild(div);
  }
  list.style.display = "block";
}

const VAR_CATEGORIES = [
  { key: "cliente",     label: "Dados do Cliente" },
  { key: "empresa",     label: "Dados da Empresa" },
  { key: "contrato",    label: "Dados de Contrato" },
  { key: "responsavel", label: "Dados do Responsável" },
  { key: "estruturas",  label: "Estruturas Prontas" },
];

// Ordem definida no documento de referência do cliente. Cada entrada é "nomeDaVariavel:tipo"
// (tipo = var/img/loop/col/cond), pois a mesma variável pode aparecer com tipos diferentes.
const VARIABLE_ORDER = {
  cliente: [
    "NomeCliente:var", "CpfCliente:var", "RgCliente:var", "DataNascimentoCliente:var", "SexoCliente:var",
    "EmailCliente:var", "TelefoneCliente:var", "CepCliente:var", "CidadeCliente:var", "BairroCliente:var",
    "EnderecoCliente:var", "ComplementoEnderecoCliente:var", "NumeroEnderecoCliente:var", "UfCliente:var",
  ],
  empresa: [
    "NomeFantasiaFilial:var", "RazaoSocialFilial:var", "CnpjCpfFilial:var", "TelefoneFilial:var", "EmailFilial:var",
    "CepFilial:var", "CidadeFilial:var", "BairroFilial:var", "EnderecoFilial:var", "ComplementoEnderecoFilial:var",
    "NumeroEnderecoFilial:var", "UfFilial:var", "LogoFilial:img",
  ],
  contrato: [
    "DescricaoContrato:var", "modalidade.DescricaoModalidade:var", "DuracaoContrato:var", "ValorTotalContrato:var",
    "ValorTotalContratoFormatado:var", "parcela.ValorFormatado:var", "ValorTotalContratoSemDescontoFormatado:var",
    "ValorTotalMedioMensalContrato:var", "ValorTotalMedioMensalContratoFormatado:var", "DataImpressao:var",
    "DataImpressaoCompleta:var", "DataImpressaoFormatada:var", "DataValidade:var", "parcela.DataVencimento:var",
    "gradeHorario.DiaDaSemana:var", "gradeHorario.HorarioFinal:var", "gradeHorario.HorarioInicial:var",
    "modalidade.DiasHorariosLiberadosParaAcesso:var", "modalidade.HorariosLiberadosParaAcesso:var",
    "modalidade.LimiteAcessos:var", "modalidade.QtdePacoteAulas:var", "modalidade.QtdeSessoesPorSemana:var",
    "QuantMaximoDiasSuspensao:var", "QuantMaximoSuspensoes:var",
    "modalidade.GradeHorarios:col", "Modalidades:col", "Parcelas:col", "gradeHorario:loop",
    "QuantMaximoDiasSuspensao:cond", "ValorAdesao:cond", "modalidade.TemGradeHorarios:cond", "modalidade.Tipo:cond",
  ],
  responsavel: [
    "NomeResponsavel:var", "CpfResponsavel:var", "RgResponsavel:var", "DataNascimentoResponsavel:var", "SexoResponsavel:var",
    "EmailResponsavel:var", "CepResponsavel:var", "CidadeResponsavel:var", "BairroResponsavel:var",
    "EnderecoResponsavel:var", "ComplementoEnderecoResponsavel:var", "NumeroEnderecoResponsavel:var", "UfResponsavel:var",
    "TemResponsavel:cond",
  ],
};

const VARIABLE_ORDER_INDEX = Object.fromEntries(
  Object.entries(VARIABLE_ORDER).map(([cat, order]) => [cat, new Map(order.map((k, i) => [k, i]))])
);

// Exemplos de valor para cada variável, usados na dica exibida ao passar o mouse sobre o pill.
const VARIABLE_EXAMPLES = {
  NomeCliente: "Maria Julia",
  CpfCliente: "000.000.000-00",
  RgCliente: "00.000.000-0",
  DataNascimentoCliente: "00/00/0000",
  SexoCliente: "Masculino/Feminino",
  EmailCliente: "cliente@email.com",
  TelefoneCliente: "(00) 0 0000-0000",
  EnderecoCliente: "Rua Agrimensor Cassimiro Milioli",
  ComplementoEnderecoCliente: "Sala 0",
  BairroCliente: "Centro",
  CepCliente: "88802-100",
  CidadeCliente: "Criciúma",
  UfCliente: "SC",
  NumeroEnderecoCliente: "0",

  RazaoSocialFilial: "Academia Next Fit LTDA",
  NomeFantasiaFilial: "Academia Next Fit",
  LogoFilial: "Imagem da logo",
  CnpjCpfFilial: "31.265.901/0001-39",
  TelefoneFilial: "(00) 0 0000-0000",
  EmailFilial: "empresa@email.com",
  EnderecoFilial: "Rua Agrimensor Cassimiro Milioli",
  NumeroEnderecoFilial: "0",
  ComplementoEnderecoFilial: "Sala 0",
  BairroFilial: "Centro",
  CepFilial: "88802-100",
  CidadeFilial: "Criciúma",
  UfFilial: "SC",

  DescricaoContrato: "Contrato mensal de pilates",
  DuracaoContrato: "1 mês",
  ValorTotalContrato: "180,00",
  ValorTotalContratoFormatado: "180,00",
  ValorTotalContratoSemDescontoFormatado: "180,00",
  QuantMaximoSuspensoes: "2",
  QuantMaximoDiasSuspensao: "20",
  DataInicio: "00/00/0000",
  DataValidade: "00/00/0000",
  DataImpressao: "00/00/0000",
  DataImpressaoCompleta: "00/00/0000 23:00",
  DataImpressaoFormatada: "19 de janeiro de 2026",
  ValorTotalMedioMensalContrato: "180,00",
  ValorTotalMedioMensalContratoFormatado: "180,00",
  "modalidade.DescricaoModalidade": "Pilates",
  "parcela.ValorFormatado": "70,00",
  ValorAdesaoFormatado: "70,00",

  NomeResponsavel: "Maria Julia",
  CpfResponsavel: "000.000.000-00",
  RgResponsavel: "00.000.000-0",
  DataNascimentoResponsavel: "00/00/0000",
  SexoResponsavel: "Masculino/Feminino",
  EmailResponsavel: "responsavel@email.com",
  EnderecoResponsavel: "Rua Agrimensor Cassimiro Milioli",
  NumeroEnderecoResponsavel: "50",
  ComplementoEnderecoResponsavel: "Sala 0",
  BairroResponsavel: "Centro",
  CepResponsavel: "88802-100",
  CidadeResponsavel: "Criciúma",
  UfResponsavel: "SC",
};

const STRUCTURES = [
  {
    key: "contratante",
    name: "Cliente",
    text: `CONTRATANTE (CLIENTE): <<[NomeCliente]>>, RG nº <<[RgCliente]>>, CPF nª <<[CpfCliente]>>, residente e domiciliado no endereço <<[EnderecoCliente]>>, nº <<[NumeroEnderecoCliente]>>, bairro <<[BairroCliente]>>, CEP <<[CepCliente]>> na cidade de <<[CidadeCliente]>> - <<[UfCliente]>>.`,
  },
  {
    key: "contratada",
    name: "Empresa",
    text: `CONTRATADA: <<[RazaoSocialFilial]>> (<<[NomeFantasiaFilial]>>), inscrita no CNPJ nº <<[CnpjCpfFilial]>>, com sede em <<[CidadeFilial]>>, no endereço <<[EnderecoFilial]>>, nº <<[NumeroEnderecoFilial]>>, bairro <<[BairroFilial]>>, CEP <<[CepFilial]>> na cidade de <<[CidadeFilial]>> - <<[UfFilial]>>.`,
  },
  {
    key: "responsavel",
    name: "Responsável",
    text: `<<if [TemResponsavel > 0]>>
  RESPONSÁVEL: <<[NomeResponsavel]>>, RG nº <<[RgResponsavel]>>, CPF nª <<[CpfResponsavel]>>, residente e domiciliado no endereço <<[EnderecoResponsavel]>>, nº <<[NumeroEnderecoResponsavel]>>, bairro <<[BairroResponsavel]>>, CEP <<[CepResponsavel]>> na cidade de <<[CidadeResponsavel]>> - <<[UfResponsavel]>>.
<</if>>`,
  },
  {
    key: "modalidades",
    name: "Modalidades/Grades de horário",
    text: `<<foreach [modalidade in Modalidades]>><<if [modalidade.Tipo == 1] >>

Tipo de modalidade: Padrão
• <<[modalidade.DescricaoModalidade]>>
  ◦ Limite de acessos: <<[modalidade.LimiteAcessos]>> , dentro do seu respectivo horário.
  ◦ Dias e horários liberados: <<[modalidade.DiasHorariosLiberadosParaAcesso]>>
  ◦ Horários liberados para acesso: <<[modalidade.HorariosLiberadosParaAcesso]>>
<</if>><<if [modalidade.Tipo == 2] >>

Tipo de modalidade: Agenda - Sessões por semana
• <<[modalidade.DescricaoModalidade]>>
  ◦ <<[modalidade.QtdeSessoesPorSemana]>> sessões por semana<<if [modalidade.TemGradeHorarios > 0]>>
  ◦ Horários agendados: <<foreach [gradeHorario in modalidade.GradeHorarios]>><<[gradeHorario.DiaDaSemana]>> das <<[gradeHorario.HorarioInicial]>> às <<[gradeHorario.HorarioFinal]>>;<</foreach>><</if>><</if>> <<if [modalidade.Tipo == 3] >>

Tipo de modalidade: Agenda – Pacote de aulas
• <<[modalidade.DescricaoModalidade]>>
  ◦ <<[modalidade.QtdePacoteAulas]>> aulas no pacote<<if [modalidade.TemGradeHorarios > 0]>>
  ◦ Horários agendados: <<foreach [gradeHorario in modalidade.GradeHorarios]>><<[gradeHorario.DiaDaSemana]>> das <<[gradeHorario.HorarioInicial]>> às <<[gradeHorario.HorarioFinal]>>;<</foreach>><</if>><</if>><</foreach>>`,
  },
  {
    key: "suspensao",
    name: "Suspensão",
    text: `<<if [QuantMaximoDiasSuspensao > 0]>> <<[ QuantMaximoDiasSuspensao]>> <</if>>`,
  },
  {
    key: "mensalidade",
    name: "Mensalidade",
    text: `R$<<[ValorTotalContratoFormatado]>>, <<if [ValorAdesao > 0]>> do qual R$<<[ValorAdesaoFormatado]>> <</if>> <<foreach [parcela in Parcelas]>>
R$<<[parcela.ValorFormatado]>> <<[parcela.DataVencimento]>>
<</foreach>>`,
  },
];

const CATEGORY_SUFFIX = { cliente: "Cliente", empresa: "Filial", responsavel: "Responsavel" };
const ACRONYMS = new Set(["Cep", "Cpf", "Rg", "Uf", "Cnpj"]);
const CONNECTORS = new Set(["de", "da", "do", "das", "dos", "e", "em", "para", "no", "na", "nos", "nas"]);
const WORD_ACCENTS = {
  endereco: "Endereço",
  enderecos: "Endereços",
  numero: "Número",
  razao: "Razão",
  descricao: "Descrição",
  duracao: "Duração",
  impressao: "Impressão",
  suspensao: "Suspensão",
  suspensoes: "Suspensões",
  adesao: "Adesão",
  maximo: "Máximo",
  medio: "Médio",
  horario: "Horário",
  horarios: "Horários",
  sessoes: "Sessões",
};

function splitPascalCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim();
}

const CUSTOM_TITLES = {
  "parcela.DataVencimento": "Data de Vencimento da Parcela",
  "parcela.ValorFormatado": "Valor Formatado Parcela",
};

function prettifyName(rawName, category) {
  if (CUSTOM_TITLES[rawName]) return CUSTOM_TITLES[rawName];

  let base = rawName.includes(".") ? rawName.split(".").pop() : rawName;

  const suffix = CATEGORY_SUFFIX[category];
  if (suffix && base.length > suffix.length && base.endsWith(suffix)) {
    base = base.slice(0, -suffix.length);
  }

  const words = splitPascalCase(base).split(" ").filter(Boolean);
  if (words.length === 0) return base;

  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS.has(w)) return w.toUpperCase();
      if (i > 0 && CONNECTORS.has(lower)) return lower;
      if (WORD_ACCENTS[lower]) return WORD_ACCENTS[lower];
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(" ");
}

function categorizeVariable(rawName) {
  const name = rawName.toLowerCase();
  if (name.includes("cliente")) return "cliente";
  if (name.includes("responsavel")) return "responsavel";
  if (name.includes("filial")) return "empresa";
  if (
    name.includes("contrato") ||
    name.includes("modalidade") ||
    name.includes("parcela") ||
    name.includes("gradehorario") ||
    name.includes("valoradesao") ||
    name.includes("quantmaximo") ||
    name.includes("dataimpressao") ||
    name === "datainicio" ||
    name === "datavalidade"
  ) return "contrato";
  return "outros";
}

const openVarCategories = new Set();

function buildLoopTagMap(schema) {
  const map = new Map();
  for (const raw of (schema.rawLoops || [])) {
    const m = raw.match(/^(.+?)\s+in\s+(.+)$/);
    if (!m) continue;
    const item = m[1].trim();
    const collection = m[2].trim();
    const tag = `<<foreach [${item} in ${collection}]>>`;
    map.set(item, tag);
    map.set(collection, tag);
  }
  return map;
}

function buildConditionMap(schema) {
  const map = new Map();
  for (const raw of (schema.rawConditions || [])) {
    const m = raw.match(/^([^\s<>=!]+)/);
    if (!m) continue;
    const field = m[1].trim();
    if (!map.has(field)) map.set(field, []);
    map.get(field).push(raw.trim());
  }
  return map;
}

function formatVariableForCopy(entry, loopTagMap, conditionMap) {
  const { name, label } = entry;
  switch (label) {
    case "var":
      return `<<[${name}]>>`;
    case "img":
      return `<<image [${name}]>>`;
    case "loop":
    case "col":
      return loopTagMap.get(name) || `<<foreach [${name} in Colecao]>>`;
    case "cond": {
      const conds = conditionMap.get(name);
      if (conds && conds.length === 1) return `<<if [${conds[0]}]>>`;
      return `<<if [${name} > 0]>>`;
    }
    default:
      return `<<[${name}]>>`;
  }
}

function renderVariables(schema, filter) {
  const list = $("varList");
  if (!list) return;

  if (!schema) {
    list.innerHTML = '<div class="var-empty">Carregando variáveis...</div>';
    return;
  }

  const q = (filter || "").trim().toLowerCase();
  const entries = [];
  const added = new Set();

  // Apenas variáveis do tipo "var" e "img" ficam visíveis para copiar na extensão.
  // loop/col/cond continuam existindo no schema e sendo usadas na análise do template,
  // apenas não aparecem nesta lista de cópia.
  const groups = [
    { key: "variables",      label: "var", title: "Variável de texto — usar como <<[NomeVariavel]>>" },
    { key: "imageVariables", label: "img", title: "Variável de imagem — usar como <<image [NomeVariavel]>>" },
  ];

  // Variáveis que continuam no schema/análise, mas ficam ocultas nesta lista de cópia.
  const HIDDEN_VAR_NAMES = new Set([
    "parcela.DataVencimento",
    "gradeHorario.DiaDaSemana",
    "gradeHorario.HorarioFinal",
    "gradeHorario.HorarioInicial",
    "modalidade.DiasHorariosLiberadosParaAcesso",
    "modalidade.HorariosLiberadosParaAcesso",
    "modalidade.LimiteAcessos",
    "modalidade.QtdePacoteAulas",
    "modalidade.QtdeSessoesPorSemana",
    "TemResponsavel",
  ]);

  for (const group of groups) {
    for (const name of (schema[group.key] || [])) {
      if (HIDDEN_VAR_NAMES.has(name)) continue;
      const key = `${name}:${group.label}`;
      if (added.has(key)) continue;
      added.add(key);
      if (!q || name.toLowerCase().includes(q)) {
        entries.push({ name, label: group.label, title: group.title, category: categorizeVariable(name) });
      }
    }
  }

  const matchedStructures = STRUCTURES.filter((s) => !q || s.name.toLowerCase().includes(q));

  list.innerHTML = "";

  if (entries.length === 0 && matchedStructures.length === 0) {
    list.innerHTML = '<div class="var-empty">Nenhuma variável encontrada.</div>';
    return;
  }

  const isFiltering = q.length > 0;
  const loopTagMap = buildLoopTagMap(schema);
  const conditionMap = buildConditionMap(schema);

  for (const cat of VAR_CATEGORIES) {
    if (cat.key === "estruturas") continue; // rendered separately below, not schema-derived
    const catEntries = entries.filter((e) => e.category === cat.key);
    if (catEntries.length === 0) continue;

    const orderIndex = VARIABLE_ORDER_INDEX[cat.key];
    if (orderIndex) {
      catEntries.sort((a, b) => {
        const ia = orderIndex.has(`${a.name}:${a.label}`) ? orderIndex.get(`${a.name}:${a.label}`) : Infinity;
        const ib = orderIndex.has(`${b.name}:${b.label}`) ? orderIndex.get(`${b.name}:${b.label}`) : Infinity;
        return ia - ib;
      });
    }

    const isOpen = isFiltering || openVarCategories.has(cat.key);

    const catDiv = document.createElement("div");
    catDiv.className = "var-category" + (isOpen ? " open" : "");

    const header = document.createElement("div");
    header.className = "var-category-header";

    const title = document.createElement("span");
    title.className = "var-category-title";
    title.textContent = cat.label;

    const count = document.createElement("span");
    count.className = "var-category-count";
    count.textContent = catEntries.length;
    title.appendChild(count);

    const chevron = document.createElement("span");
    chevron.className = "var-category-chevron";
    chevron.textContent = "▾";

    header.append(title, chevron);

    if (!isFiltering) {
      header.addEventListener("click", () => {
        if (openVarCategories.has(cat.key)) {
          openVarCategories.delete(cat.key);
        } else {
          openVarCategories.add(cat.key);
        }
        renderVariables(schema, $("varSearch").value);
      });
    }

    const grid = document.createElement("div");
    grid.className = "var-category-grid";

    for (const entry of catEntries) {
      const pill = document.createElement("div");
      pill.className = "var-pill";

      const example = VARIABLE_EXAMPLES[entry.name];
      if (example) {
        pill.tabIndex = 0;
        const tooltip = document.createElement("span");
        tooltip.className = "var-pill-tooltip";
        tooltip.textContent = `Exemplo: ${example}`;
        pill.appendChild(tooltip);
      }

      const badge = document.createElement("span");
      badge.className = `var-badge var-badge-${entry.label}`;
      badge.title = entry.title;
      badge.textContent = entry.label;

      const copyText = formatVariableForCopy(entry, loopTagMap, conditionMap);
      const prettyName = prettifyName(entry.name, entry.category);

      const name = document.createElement("span");
      name.className = "var-pill-name";
      name.textContent = prettyName;

      const output = document.createElement("span");
      output.className = "var-pill-output";
      output.textContent = copyText;

      pill.append(badge, name, output);

      pill.addEventListener("click", () => {
        navigator.clipboard.writeText(copyText).catch(() => {});
        pill.classList.add("copied");
        const prevOutputText = output.textContent;
        output.textContent = "Copiado!";
        setTimeout(() => {
          pill.classList.remove("copied");
          output.textContent = prevOutputText;
        }, 1600);
      });

      grid.appendChild(pill);
    }

    catDiv.append(header, grid);
    list.appendChild(catDiv);
  }

  if (matchedStructures.length > 0) {
    const cat = VAR_CATEGORIES.find((c) => c.key === "estruturas");
    const isOpen = isFiltering || openVarCategories.has(cat.key);

    const catDiv = document.createElement("div");
    catDiv.className = "var-category" + (isOpen ? " open" : "");

    const header = document.createElement("div");
    header.className = "var-category-header";

    const title = document.createElement("span");
    title.className = "var-category-title";
    title.textContent = cat.label;

    const count = document.createElement("span");
    count.className = "var-category-count";
    count.textContent = matchedStructures.length;
    title.appendChild(count);

    const chevron = document.createElement("span");
    chevron.className = "var-category-chevron";
    chevron.textContent = "▾";

    header.append(title, chevron);

    if (!isFiltering) {
      header.addEventListener("click", () => {
        if (openVarCategories.has(cat.key)) {
          openVarCategories.delete(cat.key);
        } else {
          openVarCategories.add(cat.key);
        }
        renderVariables(schema, $("varSearch").value);
      });
    }

    const grid = document.createElement("div");
    grid.className = "var-category-grid single";

    for (const struct of matchedStructures) {
      const pill = document.createElement("div");
      pill.className = "var-pill";

      const badge = document.createElement("span");
      badge.className = "var-badge var-badge-struct";
      badge.title = "Estrutura pronta — bloco de tags para colar no template";
      badge.textContent = "estrutura";

      const name = document.createElement("span");
      name.className = "var-pill-name";
      name.textContent = struct.name;

      pill.append(badge, name);

      pill.addEventListener("click", () => {
        navigator.clipboard.writeText(struct.text).catch(() => {});
        pill.classList.add("copied");
        const prevText = name.textContent;
        name.textContent = "Copiado!";
        setTimeout(() => {
          pill.classList.remove("copied");
          name.textContent = prevText;
        }, 1600);
      });

      grid.appendChild(pill);
    }

    catDiv.append(header, grid);
    list.appendChild(catDiv);
  }
}

function initTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const target = tab.dataset.tab;
      $("panel-analyze").classList.toggle("active", target === "analyze");
      $("panel-variables").classList.toggle("active", target === "variables");
    });
  });
}

function extractGoogleDocId(url) {
  const m = (url || "").match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

async function fetchGoogleDocxBuffer(docId) {
  const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=docx`;
  let res;
  try {
    res = await fetch(exportUrl, { credentials: "omit" });
  } catch (err) {
    throw new Error("Certifica-se de que o documento está compartilhado como 'Qualquer pessoa com o link' (leitor). Caso contrário, não será possível acessá-lo.");
  }

  if (!res.ok) {
    throw new Error("Documento não encontrado ou sem permissão de acesso.");
  }

  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("wordprocessingml") && !contentType.includes("officedocument")) {
    throw new Error(
      'Não foi possível ler o documento. Verifique se o compartilhamento está definido como "Qualquer pessoa com o link" (leitor).'
    );
  }

  return await res.arrayBuffer();
}

let lastGoogleDocId = null;

async function runLintOnBuffer(buf) {
  const schema = DEFAULT_SCHEMA;
  const problems = await TemplateLinter.lintDocxBuffer(buf, schema);
  renderProblems(problems);
}

async function handleAnalyzeLink() {
  const urlInput = $("gdocsUrl");
  const docId = extractGoogleDocId(urlInput.value);
  if (!docId) {
    setStatus("Link inválido. Cole o link completo do Google Docs.");
    return;
  }

  $("analyzeLinkBtn").disabled = true;
  $("refreshBtn").disabled = true;
  setStatus("Buscando documento...");
  $("summary").className = "";
  $("issueList").style.display = "none";

  try {
    const buf = await fetchGoogleDocxBuffer(docId);
    await runLintOnBuffer(buf);
    lastGoogleDocId = docId;
    $("refreshBtn").classList.add("visible");
    setStatus("Concluído.");
  } catch (err) {
    console.error(err);
    setStatus("Erro: " + err.message);
  } finally {
    $("analyzeLinkBtn").disabled = false;
    $("refreshBtn").disabled = false;
  }
}

async function handleRefresh() {
  if (!lastGoogleDocId) return;

  const refreshBtn = $("refreshBtn");
  refreshBtn.disabled = true;
  refreshBtn.classList.add("spinning");
  setStatus("Atualizando...");

  try {
    const buf = await fetchGoogleDocxBuffer(lastGoogleDocId);
    await runLintOnBuffer(buf);
    setStatus("Concluído.");
  } catch (err) {
    console.error(err);
    setStatus("Erro ao atualizar: " + err.message);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.classList.remove("spinning");
  }
}

async function handleAnalyze() {
  const targetInput = $("targetFile");
  if (!targetInput || !targetInput.files[0]) return;

  $("analyzeBtn").disabled = true;
  setStatus("Analisando...");
  $("summary").className = "";
  $("issueList").style.display = "none";

  try {
    const schema = DEFAULT_SCHEMA;
    const targetBuf = await fileToArrayBuffer(targetInput.files[0]);
    const problems = await TemplateLinter.lintDocxBuffer(targetBuf, schema);

    renderProblems(problems);
    setStatus("Concluído.");
  } catch (err) {
    console.error(err);
    setStatus("Erro ao analisar: " + err.message);
  } finally {
    $("analyzeBtn").disabled = false;
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  initTabs();

  try {
    await loadDefaultSchema();
    renderVariables(DEFAULT_SCHEMA, "");
  } catch (err) {
    console.error(err);
    setStatus("Erro ao carregar o modelo de referência padrão.");
  }

  const targetInput = $("targetFile");
  if (targetInput) {
    targetInput.addEventListener("change", () => {
      $("analyzeBtn").disabled = !targetInput.files[0];
    });
  }

  $("analyzeBtn").addEventListener("click", handleAnalyze);

  const gdocsUrlInput = $("gdocsUrl");
  gdocsUrlInput.addEventListener("input", () => {
    $("analyzeLinkBtn").disabled = !extractGoogleDocId(gdocsUrlInput.value);
  });
  gdocsUrlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !$("analyzeLinkBtn").disabled) handleAnalyzeLink();
  });
  $("analyzeLinkBtn").addEventListener("click", handleAnalyzeLink);
  $("refreshBtn").addEventListener("click", handleRefresh);

  $("varSearch").addEventListener("input", (e) => {
    renderVariables(DEFAULT_SCHEMA, e.target.value);
  });
});
