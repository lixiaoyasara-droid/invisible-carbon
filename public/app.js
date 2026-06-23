const state = {
  data: null,
  activeCode: "C1",
  rows: {},
  profile: null,
  reduction: null,
  esgReport: null
};

const colors = ["#003d25", "#4f8d2c", "#dce82e", "#8bc7a4", "#5c8c75", "#e5a642", "#9cae3d", "#6ab1b6"];
const fx = {
  CNY: { rate: 1, label: "人民币", date: "2026-06-14", source: "本地基准，输入金额统一为人民币" },
  USD: { rate: 7.12, label: "美元", date: "2026-06-14", source: "演示汇率；生产环境建议接入中国外汇交易中心或企业月度汇率表" },
  GBP: { rate: 9.05, label: "英镑", date: "2026-06-14", source: "演示汇率；生产环境建议接入中国外汇交易中心或企业月度汇率表" }
};

const sicZhNames = {
  "1521": "住宅建筑总承包",
  "2086": "瓶装及罐装软饮料制造",
  "2339": "女式、少女及青少年外衣制造（其他未分类）",
  "3571": "电子计算机制造",
  "3674": "半导体及相关器件制造",
  "3711": "机动车及乘用车车身制造",
  "3999": "制造业（其他未分类）",
  "4213": "公路货运（本地除外）",
  "4412": "远洋国际货物运输",
  "4512": "定期航空运输",
  "6021": "全国性商业银行"
};

const method = (text, formula) => ({ text, formula });

const knowledgeCategories = [
  {
    code: "Category 1",
    zh: "外购商品和服务",
    en: "Purchased Goods and Services",
    definition: "企业在报告年度购买或取得的商品和服务，从原材料开采到产品交付给供应商客户之前的上游排放，不包括已计入类别2—8的活动。",
    logic: "根据采购商品或服务的数量、重量、金额或供应商提供的产品碳排放数据计算。",
    formula: "排放量 = Σ（采购数量、重量或金额 × 对应商品或服务排放因子）",
    methods: [
      method("供应商特定法：", "采购数量 × 供应商提供的产品级 cradle-to-gate 排放因子。"),
      "混合法：供应商的一手数据与行业平均数据结合。",
      method("平均数据法：", "商品数量、重量或其他物理量 × 行业平均排放因子。"),
      method("支出法：", "采购金额 × 单位货币排放因子。")
    ]
  },
  {
    code: "Category 2",
    zh: "资本品",
    en: "Capital Goods",
    definition: "企业在报告年度购买或取得的厂房、设备、车辆、建筑和其他资本性资产产生的上游 cradle-to-gate 排放。",
    logic: "根据资本品的采购数量、重量、金额或供应商提供的产品级排放数据计算，不进行多年摊销，通常在购入年度确认。",
    formula: "排放量 = Σ（资本品采购数量、重量或金额 × 对应资本品排放因子）",
    methods: [
      method("供应商特定法：使用供应商提供的资本品 cradle-to-gate 产品排放数据。", "资本品数量 × 供应商特定排放因子"),
      method("混合法：供应商一手数据与二手排放因子结合。", "供应商 Scope 1、2 分摊排放 + 材料、能源、运输及废弃物排放"),
      method("平均数据法：使用资本品重量或数量及行业平均因子。", "资本品数量或重量 × 行业平均排放因子"),
      method("支出法：使用采购金额和 EEIO 排放因子。", "资本品采购金额 × 单位货币排放因子")
    ]
  },
  {
    code: "Category 3",
    zh: "燃料和能源相关活动",
    en: "Fuel- and Energy-Related Activities Not Included in Scope 1 or Scope 2",
    definition: "企业购买和使用的燃料、电力、蒸汽、供热和制冷，在 Scope 1 和 Scope 2 中尚未包括的上游排放。",
    logic: "能源消耗量 × 对应的上游排放因子或输配电损耗因子。",
    formula: "排放量 = Σ（燃料或能源消耗量 × 上游排放因子） + Σ（电力用量 × 输配电损耗率 × 电力排放因子）",
    methods: [
      method("购买燃料上游排放：可使用供应商特定因子或区域、国家平均因子。", "燃料消耗量 × 燃料上游排放因子"),
      method("购买电力上游排放：可使用供应商特定因子或区域、国家平均因子。", "电力、蒸汽、供热或制冷用量 × 对应上游排放因子"),
      method("输配电损耗：可使用供应商特定因子或区域、国家平均因子。", "能源用量 × 能源生命周期排放因子 × 输配电损耗率"),
      method("转售能源的发电排放：可使用供应商特定因子或区域、国家平均因子。", "转售能源量 × 发电排放因子")
    ],
    includes: ["购买燃料的上游排放。", "购买电力的上游燃料排放。", "输配电损耗。", "能源零售商转售能源的发电排放。"]
  },
  {
    code: "Category 4",
    zh: "上游运输和配送",
    en: "Upstream Transportation and Distribution",
    definition: "企业采购商品从一级供应商运输至企业，以及企业购买的第三方运输、仓储和配送服务产生的排放。",
    logic: "根据运输距离、货物重量、燃料消耗或运输费用计算运输及仓储排放。",
    formula: "排放量 = Σ（燃料消耗量 × 燃料排放因子）或 Σ（货物重量 × 运输距离 × 运输方式排放因子）",
    methods: [
      method("燃料法：", "燃料消耗量 × 燃料排放因子。"),
      method("距离法：", "货物重量 × 运输距离 × 运输方式排放因子。"),
      method("支出法：", "运输或仓储费用 × 支出排放因子。"),
      "供应商特定法：直接使用物流供应商提供的数据。"
    ]
  },
  {
    code: "Category 5",
    zh: "运营中产生的废弃物",
    en: "Waste Generated in Operations",
    definition: "企业运营产生的废弃物在第三方设施中进行填埋、焚烧、回收、堆肥或其他处理时产生的排放。",
    logic: "不同废弃物种类和处理方式对应的废弃物重量 × 排放因子。",
    formula: "排放量 = Σ（废弃物重量 × 对应废弃物类型和处理方式排放因子）",
    methods: [
      method("供应商特定法：直接使用废弃物处理商提供的排放数据。", "废弃物处理商提供的排放量"),
      method("废弃物类型特定法：按废弃物类型和处理方式分别计算。", "废弃物重量 × 对应处理方式排放因子"),
      method("平均数据法：无法获得具体处理方式时使用平均处理因子。", "废弃物总重量 × 平均废弃物处理排放因子")
    ]
  },
  {
    code: "Category 6",
    zh: "商务旅行",
    en: "Business Travel",
    definition: "员工因商务活动乘坐企业不拥有或控制的交通工具产生的排放。",
    logic: "根据交通方式、行程距离、燃料消耗、住宿晚数或旅行费用计算。",
    formula: "排放量 = Σ（行程距离 × 交通方式排放因子）或 Σ（差旅费用 × 支出排放因子）",
    methods: [
      method("燃料法：按商务旅行实际燃料消耗计算。", "燃料消耗量 × 燃料排放因子"),
      method("距离法：按不同交通方式的行程距离计算。", "各交通方式行程距离 × 对应交通方式排放因子"),
      method("支出法：按商务旅行费用估算。", "商务旅行费用 × 单位货币排放因子"),
      method("供应商特定法：直接使用航空公司、铁路或差旅服务商提供的排放数据。", "供应商提供的商务旅行排放量")
    ]
  },
  {
    code: "Category 7",
    zh: "员工通勤",
    en: "Employee Commuting",
    definition: "员工在住所和工作地点之间通勤产生的排放，可选择纳入居家办公排放。",
    logic: "员工人数 × 通勤方式 × 单程距离 × 通勤次数 × 对应排放因子。",
    formula: "排放量 = Σ（员工人数 × 单程通勤距离 × 通勤次数 × 交通方式排放因子）",
    methods: [
      method("燃料法：按员工通勤实际燃料消耗计算。", "员工通勤燃料消耗量 × 燃料排放因子"),
      method("距离法：按员工通勤距离、频次和交通方式计算。", "员工人数 × 单程距离 × 往返次数 × 工作天数 × 交通方式排放因子"),
      method("平均数据法：使用平均通勤距离、工作天数和平均因子估算。", "员工人数 × 平均通勤距离 × 平均工作天数 × 平均排放因子"),
      method("居家办公可选计算：可选择纳入员工居家办公能源排放。", "居家办公天数 × 每日能源消耗 × 能源排放因子")
    ]
  },
  {
    code: "Category 8",
    zh: "上游租赁资产",
    en: "Upstream Leased Assets",
    definition: "企业作为承租方使用，但未计入自身 Scope 1 和 Scope 2 的租赁资产运营排放。",
    logic: "根据租赁资产的能源消耗、面积、资产数量或运营数据计算。",
    formula: "排放量 = Σ（租赁资产能源消耗量 × 对应能源排放因子）或 Σ（面积/数量 × 平均排放因子）",
    methods: [
      method("资产特定法：根据每项租赁资产的实际能源和制冷剂数据计算。", "燃料用量 × 燃料因子 + 电力、蒸汽、供热和制冷用量 × 能源因子 + 制冷剂泄漏量 × 制冷剂因子"),
      method("面积分摊法：用于未单独计量的租赁建筑。", "建筑总能耗 × 租赁面积 ÷ 建筑总面积"),
      method("平均数据法：按同类资产年度平均排放估算。", "资产数量 × 单项同类资产年度平均排放量")
    ]
  },
  {
    code: "Category 9",
    zh: "下游运输和配送",
    en: "Downstream Transportation and Distribution",
    definition: "产品售出后，由非企业拥有或控制、且运输费用不由企业承担的运输、仓储、配送和零售活动产生的排放。",
    logic: "根据售出产品重量、运输距离、运输方式、仓储能耗或零售设施数据计算。",
    formula: "排放量 = Σ（售出产品重量 × 运输距离 × 运输方式排放因子） + 仓储或零售活动排放",
    methods: [
      method("燃料法：运输部分沿用 Category 4 的燃料法。", "燃料消耗量 × 燃料排放因子"),
      method("距离法：运输部分沿用 Category 4 的距离法。", "售出货物重量 × 运输距离 × 运输方式排放因子"),
      method("支出法：按下游运输费用估算。", "下游运输费用 × 单位货币排放因子"),
      method("场地特定法：配送、仓储和零售部分根据实际能源消耗计算。", "仓储或零售设施能源用量 × 对应能源排放因子"),
      method("平均数据法：按货物体积、面积、托盘数或存储天数估算。", "货物体积、面积、托盘数或存储天数 × 平均配送排放因子")
    ]
  },
  {
    code: "Category 10",
    zh: "售出产品的加工",
    en: "Processing of Sold Products",
    definition: "企业售出的中间产品由下游企业进一步加工时产生的排放。",
    logic: "售出中间产品数量 × 下游加工过程的单位排放量，或根据加工能源消耗进行计算。",
    formula: "排放量 = Σ（售出中间产品数量 × 单位加工排放因子）",
    methods: [
      method("场地特定法：使用下游客户加工过程的实际能源、制冷剂及废弃物数据。", "燃料排放 + 电力排放 + 制冷剂排放 + 废弃物处理排放"),
      method("平均数据法：使用单位产品或单位加工过程的平均排放数据。", "售出中间产品数量 × 单位产品平均加工排放因子")
    ]
  },
  {
    code: "Category 11",
    zh: "售出产品的使用",
    en: "Use of Sold Products",
    definition: "企业在报告年度售出的产品，在预计使用寿命内由客户使用所产生的排放。",
    logic: "售出产品数量 × 单件产品生命周期使用次数或能源消耗 × 使用阶段排放因子。",
    formula: "排放量 = Σ（售出产品数量 × 生命周期使用强度 × 使用阶段排放因子）",
    methods: [
      method("直接能源使用产品：适用于使用阶段直接消耗燃料或电力的产品。", "售出产品数量 × 单件产品生命周期使用次数 × 每次能源消耗 × 能源排放因子"),
      method("燃料和原料产品：适用于售出后被燃烧或使用并产生排放的燃料或原料。", "售出燃料或原料数量 × 燃烧或使用排放因子"),
      method("含温室气体产品：适用于使用阶段预计发生温室气体泄漏的产品。", "售出产品数量 × 单件产品预计泄漏量 × 气体 GWP"),
      method("间接使用阶段排放：采用合理使用情景估算，并明确为可选报告。", "售出产品数量 × 使用情景活动数据 × 对应排放因子")
    ]
  },
  {
    code: "Category 12",
    zh: "售出产品的寿命终止处理",
    en: "End-of-Life Treatment of Sold Products",
    definition: "报告年度售出的产品及其包装，在使用寿命结束后进行回收、填埋、焚烧或其他处理产生的排放。",
    logic: "售出产品和包装重量 × 各类废弃物处理比例 × 对应处理排放因子。",
    formula: "排放量 = Σ（产品或包装重量 × 处理方式比例 × 对应处理排放因子）",
    methods: [
      method("废弃物类型特定法：处理方式应包括填埋、焚烧、回收、堆肥等。", "售出产品及包装重量 × 各处理方式比例 × 对应处理排放因子"),
      method("平均数据法：使用平均寿命终止处理排放因子估算。", "售出产品及包装总重量 × 平均寿命终止处理排放因子")
    ]
  },
  {
    code: "Category 13",
    zh: "下游租赁资产",
    en: "Downstream Leased Assets",
    definition: "企业作为出租方，将自有资产租给其他实体使用，且相关运营排放未计入企业 Scope 1 和 Scope 2。",
    logic: "根据承租方使用资产产生的能源消耗、面积或资产数量计算。",
    formula: "排放量 = Σ（出租资产能源消耗量 × 对应能源排放因子）或 Σ（面积/数量 × 平均排放因子）",
    methods: [
      method("资产特定法：计算方法与 Category 8 相同，但适用于企业作为出租方的资产。", "各出租资产的燃料、电力、供热、制冷和制冷剂排放之和"),
      method("面积分摊法：按承租资产面积分摊对应排放。", "承租资产面积 ÷ 资产总面积 × 对应 Scope 1 和 Scope 2 排放"),
      method("平均数据法：按同类出租资产年度平均排放估算。", "出租资产数量 × 同类资产年度平均排放量")
    ]
  },
  {
    code: "Category 14",
    zh: "特许经营",
    en: "Franchises",
    definition: "企业作为特许人，其特许经营门店或业务运营产生、但未计入企业 Scope 1 和 Scope 2 的排放。",
    logic: "根据各特许经营单位的燃料、电力、制冷剂或其他运营数据计算。",
    formula: "排放量 = Σ（特许经营单位燃料、电力、制冷剂等活动数据 × 对应排放因子）",
    methods: [
      method("特许经营单位特定法：汇总各加盟单位的 Scope 1 和 Scope 2 排放。", "各加盟单位燃料排放 + 购入能源排放 + 制冷剂及过程排放"),
      method("平均数据法：无法获得实际数据时，按门店类型、面积或数量估算。", "加盟店数量或面积 × 同类门店平均排放因子")
    ]
  },
  {
    code: "Category 15",
    zh: "投资",
    en: "Investments",
    definition: "企业股权投资、债权投资、项目融资及其他投资活动所对应的被投资方排放。",
    logic: "根据被投资方排放量及企业持股比例、融资比例或项目份额归属排放。",
    formula: "排放量 = Σ（被投资方排放量 × 企业持股比例、融资比例或项目份额）",
    methods: [
      method("股权投资：按企业持股比例归属被投资企业排放。", "被投资企业排放量 × 持股比例"),
      method("债权投资和项目融资：按未偿投资金额占被投资对象总资本比例归属。", "被投资企业或项目排放量 × 未偿投资金额 ÷ 被投资对象总股权与债务"),
      method("管理投资和客户投资：按投资组合中各项投资的归属比例汇总。", "Σ（单项投资排放量 × 投资归属比例）"),
      method("平均数据法：无法获得被投资方实际排放时，使用收入、资产或行业平均排放因子估算。", "被投资方收入或资产 × 行业平均排放因子 × 投资归属比例")
    ]
  }
];

const $ = id => document.getElementById(id);
const fmt = n => Number(n || 0).toLocaleString("zh-CN", { maximumFractionDigits: 3, minimumFractionDigits: 3 });
const MAX_ESG_UPLOAD_BYTES = 200 * 1024 * 1024;
let activeEsgRequest = null;
let activeEsgJobId = null;
let lastEsgFile = null;
let reductionTimer = null;

async function api(url, payload) {
  const res = await fetch(url, {
    method: payload ? "POST" : "GET",
    headers: payload ? { "Content-Type": "application/json" } : {},
    body: payload ? JSON.stringify(payload) : undefined
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function unitLabel(unit) {
  const u = String(unit || "").toLowerCase();
  if (u.includes("rmb")) return "人民币（CNY）";
  if (u.includes("usd")) return "人民币（CNY，按美元因子换算）";
  if (u.includes("gbp") || u.includes("pound")) return "人民币（CNY，按英镑因子换算）";
  if (u.includes("ton*km")) return "吨公里";
  if (u.includes("/ton")) return "吨";
  if (u.includes("/t")) return "吨";
  if (u.includes("/m3")) return "立方米";
  if (u.includes("kwh")) return "千瓦时";
  if (u.includes("passenger")) return "人/年";
  return "活动数据";
}

function conversionFactor(unit) {
  const u = String(unit || "").toLowerCase();
  let factor = 1;
  let note = "因子单位未识别，按 tCO₂e/活动单位处理";
  if (u.includes("kg") && u.includes("rmb")) {
    factor = 1 / 1000;
    note = "kgCO₂e/RMB 转换为 tCO₂e";
  } else if (u.includes("kg") && u.includes("usd")) {
    factor = (1 / fx.USD.rate) / 1000;
    note = "输入人民币先按 USD 汇率换算，再由 kg 转 t";
  } else if (u.includes("kg") && (u.includes("gbp") || u.includes("pound"))) {
    factor = (1 / fx.GBP.rate) / 1000;
    note = "输入人民币先按 GBP 汇率换算，再由 kg 转 t";
  } else if (u.includes("gco2") || u.includes("g co2")) {
    factor = 1 / 1_000_000;
    note = "gCO₂e 转换为 tCO₂e";
  } else if (u.includes("kg") && !u.includes("rmb")) {
    factor = 1 / 1000;
    note = "kgCO₂e 转换为 tCO₂e";
  } else if (u.includes("t co2") || u.includes("tco2") || u.includes("t co₂")) {
    factor = 1;
    note = "因子已为 tCO₂e 单位";
  }
  return { factor, note };
}

function getCategory(code = state.activeCode) {
  return state.data.categories.find(c => c.code === code);
}

function normalizeCalculatorState() {
  const validCodes = new Set((state.data.categories || []).map(c => c.code));
  if (!validCodes.has(state.activeCode)) state.activeCode = state.data.categories[0]?.code || "C1";
  Object.keys(state.rows || {}).forEach(code => {
    if (!validCodes.has(code)) delete state.rows[code];
  });
}

function ensureRows(code) {
  if (!state.rows[code]) {
    const cat = getCategory(code);
    const first = cat.items[0] || { name: "", factor: 0, unit: "", source: "" };
    state.rows[code] = [{
      id: crypto.randomUUID(),
      itemName: first.name,
      wasteType: first.wasteType || "一般废物",
      treatment: first.treatment || "",
      activity: "",
      unit: unitLabel(first.unit)
    }];
  }
  return state.rows[code];
}

function renderTabs() {
  $("tabs").innerHTML = state.data.categories.map(cat => `
    <button class="tab ${cat.code === state.activeCode ? "active" : ""}" data-code="${cat.code}">
      ${cat.code} ${cat.title.replace(/^类别\s*\d+\s*/, "")}
    </button>
  `).join("");
  document.querySelectorAll(".tab").forEach(btn => btn.addEventListener("click", () => {
    state.activeCode = btn.dataset.code;
    renderCalculator();
  }));
}

function renderKnowledge() {
  $("categoryKnowledge").innerHTML = knowledgeCategories.map((cat, index) => `
    <details class="knowledge-item" ${index === 0 ? "open" : ""}>
      <summary>
        <span>${cat.code}</span>
        <strong>${escapeHtml(cat.zh)}</strong>
        <em>${escapeHtml(cat.en)}</em>
        <p>${escapeHtml(cat.definition)}</p>
      </summary>
      <div class="knowledge-detail">
        ${cat.includes ? `<div><b>包括：</b><ul>${cat.includes.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul></div>` : ""}
        <div><b>计算逻辑：</b><p>${escapeHtml(cat.logic)}</p></div>
        <div><b>核心计算公式：</b><p class="category-formula">${escapeHtml(cat.formula)}</p></div>
        <div><b>主要方法：</b><ul>${cat.methods.map(methodHtml).join("")}</ul></div>
      </div>
    </details>
  `).join("");
}

function methodHtml(item) {
  if (typeof item === "string") return `<li>${escapeHtml(item)}</li>`;
  return `<li>${escapeHtml(item.text)}<p class="category-formula">${escapeHtml(item.formula)}</p></li>`;
}

function updatePageVisibility(target) {
  const pages = {
    "#knowledge": ["knowledge"],
    "#analysis": ["analysis", "analysisPanel"],
    "#calculator": ["calculator", "roadmap"],
    "#roadmap": ["calculator", "roadmap"]
  };
  const visible = new Set(pages[target] || pages["#knowledge"]);
  ["knowledge", "analysis", "analysisPanel", "calculator", "roadmap"].forEach(id => {
    const el = $(id);
    if (el) el.classList.toggle("page-hidden", !visible.has(id));
  });
}

function updateNavActive() {
  const links = [...document.querySelectorAll(".sidebar nav a")];
  const hash = window.location.hash || "#knowledge";
  const normalizedHash = hash === "#roadmap" ? "#calculator" : hash;
  const target = links.some(link => link.getAttribute("href") === normalizedHash) ? normalizedHash : "#knowledge";
  links.forEach(link => link.classList.toggle("active", link.getAttribute("href") === target));
  updatePageVisibility(target);
}

function setupNavActive() {
  document.querySelectorAll(".sidebar nav a").forEach(link => {
    link.addEventListener("click", () => {
      document.querySelectorAll(".sidebar nav a").forEach(item => item.classList.remove("active"));
      link.classList.add("active");
      updatePageVisibility(link.getAttribute("href"));
    });
  });
  window.addEventListener("hashchange", updateNavActive);
  updateNavActive();
}

function renderCalculator() {
  normalizeCalculatorState();
  renderTabs();
  const cat = getCategory();
  $("categoryIntro").innerHTML = `
    <div><b>定义：</b>${cat.definition}</div>
    <div><b>计算逻辑：</b>${cat.formula}；页面统一换算为 tCO₂e。</div>
    <div><b>排放因子来源：</b>${cat.sourceNote || ""} 当前类别可选因子 ${cat.items.length} 项。</div>
  `;
  $("rows").innerHTML = ensureRows(cat.code).map(rowHtml).join("");
  bindRows();
  updateAllTotals();
}

function rowHtml(row) {
  const cat = getCategory();
  const item = rowItem(row, cat.code);
  const emission = calculate(row, item);
  return `
    <tr data-id="${row.id}">
      <td>
        ${cat.code === "C5" ? c5Selectors(row, cat) : `
          <select class="item-select">
            ${cat.items.map(x => `<option value="${escapeHtml(x.name)}" ${x.name === row.itemName ? "selected" : ""}>${escapeHtml(x.name)}</option>`).join("")}
          </select>
        `}
      </td>
      <td><input class="activity-input" type="number" min="0" step="0.01" value="${row.activity}" placeholder="请输入数值"></td>
      <td><div class="readonly">${unitLabel(item.unit)}</div></td>
      <td><div class="readonly">${item.factor ?? "-"}</div></td>
      <td><div class="readonly">${escapeHtml(item.unit || "-")}</div></td>
      <td><div class="readonly emission-cell">${fmt(emission)}</div></td>
      <td><button class="danger delete-row">删除</button></td>
    </tr>
  `;
}

function c5Selectors(row, cat) {
  const wasteTypes = [...new Set(cat.items.map(x => x.wasteType).filter(Boolean))];
  const activeWaste = row.wasteType && wasteTypes.includes(row.wasteType) ? row.wasteType : wasteTypes[0] || "一般废物";
  const treatments = cat.items.filter(x => x.wasteType === activeWaste).map(x => x.treatment);
  const activeTreatment = row.treatment && treatments.includes(row.treatment) ? row.treatment : treatments[0] || "";
  row.wasteType = activeWaste;
  row.treatment = activeTreatment;
  row.itemName = c5Item(cat, activeWaste, activeTreatment)?.name || row.itemName;
  return `
    <div class="split-selects">
      <select class="waste-type-select">
        ${wasteTypes.map(x => `<option value="${escapeHtml(x)}" ${x === activeWaste ? "selected" : ""}>${escapeHtml(x)}</option>`).join("")}
      </select>
      <select class="treatment-select">
        ${treatments.map(x => `<option value="${escapeHtml(x)}" ${x === activeTreatment ? "selected" : ""}>${escapeHtml(x)}</option>`).join("")}
      </select>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, s => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[s]));
}

function bindRows() {
  document.querySelectorAll("#rows tr").forEach(tr => {
    const row = ensureRows(state.activeCode).find(r => r.id === tr.dataset.id);
    tr.querySelector(".item-select")?.addEventListener("change", e => {
      row.itemName = e.target.value;
      renderCalculator();
    });
    tr.querySelector(".waste-type-select")?.addEventListener("change", e => {
      row.wasteType = e.target.value;
      const cat = getCategory();
      row.treatment = cat.items.find(x => x.wasteType === row.wasteType)?.treatment || "";
      row.itemName = c5Item(cat, row.wasteType, row.treatment)?.name || "";
      renderCalculator();
    });
    tr.querySelector(".treatment-select")?.addEventListener("change", e => {
      row.treatment = e.target.value;
      row.itemName = c5Item(getCategory(), row.wasteType, row.treatment)?.name || "";
      renderCalculator();
    });
    tr.querySelector(".activity-input").addEventListener("input", e => {
      row.activity = e.target.value;
      tr.querySelector(".emission-cell").textContent = fmt(rowEmission(row, state.activeCode));
      updateAllTotals();
    });
    tr.querySelector(".delete-row").addEventListener("click", () => {
      state.rows[state.activeCode] = ensureRows(state.activeCode).filter(r => r.id !== row.id);
      if (!state.rows[state.activeCode].length) delete state.rows[state.activeCode];
      renderCalculator();
    });
  });
}

function calculate(row, item) {
  const activity = Number(row.activity || 0);
  if (!activity || !item) return 0;
  const conv = conversionFactor(item.unit);
  return activity * Number(item.factor || 0) * conv.factor;
}

function c5Item(cat, wasteType, treatment) {
  return cat.items.find(x => x.wasteType === wasteType && x.treatment === treatment);
}

function rowItem(row, code) {
  const cat = getCategory(code);
  if (!cat) return {};
  if (code === "C5") return c5Item(cat, row.wasteType, row.treatment) || cat.items.find(x => x.name === row.itemName) || cat.items[0] || {};
  return cat.items.find(x => x.name === row.itemName) || cat.items[0] || {};
}

function rowEmission(row, code) {
  return calculate(row, rowItem(row, code));
}

function totalsByCategory() {
  return state.data.categories.map(cat => ({
    code: cat.code,
    title: cat.title,
    emission: (state.rows[cat.code] || []).reduce((sum, row) => sum + rowEmission(row, cat.code), 0)
  }));
}

function updateAllTotals() {
  const totals = totalsByCategory();
  const current = totals.find(x => x.code === state.activeCode)?.emission || 0;
  $("categoryTotal").textContent = fmt(current);
  const grand = totals.reduce((sum, x) => sum + x.emission, 0);
  $("grandTotal").textContent = fmt(grand);
  renderRanking(totals);
  renderPie(totals, grand);
  renderScenarioAnalysis(totals, grand);
  renderFxCard();
  scheduleReduction();
  saveState();
}

function renderRanking(totals) {
  const ranked = totals.filter(x => x.emission > 0).sort((a, b) => b.emission - a.emission);
  $("ranking").innerHTML = ranked.length
    ? ranked.slice(0, 8).map(x => `<li>${x.code} ${x.title.replace(/^类别\s*\d+\s*/, "")}：${fmt(x.emission)} tCO₂e</li>`).join("")
    : "<li>暂无计算数据</li>";
}

function renderPie(totals, grand) {
  if (!grand) {
    $("categoryPie").style.background = "conic-gradient(#e5ebe8 0 100%)";
    $("categoryPieLegend").innerHTML = "<span>暂无计算数据</span>";
    return;
  }
  let start = 0;
  const slices = totals.filter(x => x.emission > 0).map((x, i) => {
    const pct = x.emission / grand * 100;
    const seg = `${colors[i % colors.length]} ${start}% ${start + pct}%`;
    start += pct;
    return seg;
  });
  $("categoryPie").style.background = `conic-gradient(${slices.join(",")})`;
  $("categoryPieLegend").innerHTML = totals
    .filter(x => x.emission > 0)
    .sort((a, b) => b.emission - a.emission)
    .map((x, i) => `<span><i style="background:${colors[i % colors.length]}"></i>${x.code} ${escapeHtml(x.title.replace(/^类别\s*\d+\s*/, ""))} · ${(x.emission / grand * 100).toFixed(1)}%</span>`)
    .join("");
}

function renderFxCard() {
  const usedUnits = new Set();
  Object.entries(state.rows).forEach(([code, rows]) => {
    const cat = getCategory(code);
    if (!cat) return;
    rows.forEach(row => {
      const item = cat.items.find(x => x.name === row.itemName);
      if (item) usedUnits.add(item.unit);
    });
  });
  const usesFx = [...usedUnits].some(unit => /usd|gbp|pound/i.test(unit));
  $("fxCard").innerHTML = usesFx
    ? `货币换算：输入金额统一为人民币。美元因子按 1 USD = ${fx.USD.rate} CNY，英镑因子按 1 GBP = ${fx.GBP.rate} CNY；汇率日期：${fx.USD.date}；来源：${fx.USD.source}。`
    : `货币换算：当前已选因子未使用外币单位；金额类因子按附件中的 RMB 口径直接计算。汇率基准日期：${fx.CNY.date}；来源：${fx.CNY.source}。`;
}

function renderAnalysis(profile) {
  $("analysisStatus").textContent = profile.publicInfoStatus || "基于已上传ESG报告分析";
  const sic = profile.sic || {};
  $("industryName").textContent = profile.companyName || "待分析";
  $("industryTraits").innerHTML = `
    ${fieldLine("SIC标准行业分类", formatSic(sic), sic.source)}
    ${fieldLine("主营业务", profile.business || "需人工确认", profile.businessSource)}
    ${fieldLine("供应链和价值链", profile.traits || "需人工确认", profile.valueChainSource)}
  `;
  $("focusList").innerHTML = (profile.focus || []).map(x => {
    if (typeof x === "string") {
      return `<li><span>${escapeHtml(x)}</span></li>`;
    }
    return `<li class="focus-item">${sourceTag(x.source)}<span><b>${escapeHtml(x.title || `${x.code} ${x.name}`)}</b><small>重点业务环节：${escapeHtml(x.link || "")}</small><small>关注原因：${escapeHtml(x.reason || "")}</small><small>建议重点：${escapeHtml(x.action || "")}</small></span></li>`;
  }).join("");
  const total = profile.categories.reduce((sum, x) => sum + x.score, 0);
  let start = 0;
  const gradient = profile.categories.map((x, i) => {
    const pct = x.score / total * 100;
    const seg = `${colors[i % colors.length]} ${start}% ${start + pct}%`;
    start += pct;
    return seg;
  });
  $("analysisDonut").style.background = `conic-gradient(${gradient.join(",")})`;
  const disclosedCount = profile.categories.filter(x => x.disclosed).length;
  $("disclosureStats").innerHTML = `
    <div><b>已披露：</b>${disclosedCount}类</div>
    <div><b>未披露：</b>${Math.max(0, profile.categories.length - disclosedCount)}类</div>
  `;
  const maxScore = Math.max(...profile.categories.map(x => x.score), 1);
  $("importanceList").innerHTML = profile.categories.map((x, i) => {
    const levelClass = x.level === "高" ? "high" : x.level === "中" ? "mid" : "low";
    const detailText = x.disclosed
      ? x.amount
        ? `已披露，排放量 ${x.amount} ${x.unit || "tCO2e"}${x.share ? `，占比 ${x.share}` : ""}`
        : "已披露，未提供具体数值"
      : "未披露";
    const pct = Math.max(8, Math.round(x.score / maxScore * 100));
    return `<li class="importance-item ${levelClass}" title="${escapeHtml(x.basis || "")}"><span class="swatch" style="background:${colors[i % colors.length]}"></span><span>${escapeHtml(x.label)}<small>${escapeHtml(detailText)}</small><i class="mini-bar"><em style="width:${pct}%;background:${colors[i % colors.length]}"></em></i></span><span class="level ${levelClass}">${x.level}</span>${sourceTag(x.source)}</li>`;
  }).join("");
}

function fieldLine(label, value, source) {
  return `<span class="field-line"><b>${escapeHtml(label)}：</b>${escapeHtml(value)}${sourceTag(source)}</span>`;
}

function sourceLabel(value) {
  return String(value || "").includes("AI判断") ? "AI判断" : "报告披露";
}

function sourceTag(value) {
  return `<span class="source-pill ${sourceLabel(value) === "AI判断" ? "ai" : "report"}">${sourceLabel(value)}</span>`;
}

function formatSic(sic = {}) {
  return sic.code ? `SIC ${sic.code}｜${sic.zhName || sicZhNames[sic.code] || "未披露"}` : "未披露";
}

function aiBusinessForIndustry(industry = "") {
  if (industry.includes("纺织服装")) return "运动鞋服、服装配饰及相关品牌零售业务，覆盖产品研发、设计、生产组织、渠道销售和消费者服务。";
  if (industry.includes("食品饮料")) return "酒类、食品或饮料产品的生产、包装、品牌运营和渠道销售，重点围绕原料采购、酿造/加工、包装和市场销售展开。";
  if (industry.includes("汽车")) return "整车、核心零部件、动力系统及售后服务相关业务，覆盖研发制造、供应链采购、销售和使用阶段服务。";
  if (industry.includes("电子")) return "电子硬件、终端设备、关键零部件或信息技术产品与服务，覆盖研发、制造协同、销售和售后支持。";
  if (industry.includes("金融")) return "银行、保险、证券、投资或综合金融服务，核心活动包括资金配置、客户服务、资产管理和投融资业务。";
  if (industry.includes("建筑")) return "工程建设、地产开发、建筑材料或资产运营相关业务，覆盖项目开发、采购施工、交付和运营管理。";
  if (industry.includes("交通运输")) return "货运、仓储、配送、航空、航运或综合物流服务，核心活动包括运输组织、线路调度、场站运营和客户交付。";
  return "按所属行业判断，主要涉及产品或服务的采购、生产/运营、销售交付及客户服务。";
}

function aiValueChainForIndustry(industry = "") {
  if (industry.includes("纺织服装")) return "上游以棉、化纤、皮革、橡胶、包装材料及代工供应商为主，中游包括设计、生产组织、仓储和门店/电商销售，下游涉及物流配送、消费者使用、包装与产品寿命终止处理。";
  if (industry.includes("食品饮料")) return "上游包括农产品、粮食、水、能源、玻璃瓶、纸箱、瓶盖等包材供应，中游为酿造/加工、包装和仓储，下游覆盖经销、零售、运输配送及包装回收处理。";
  if (industry.includes("汽车")) return "上游包括钢铝材料、电池、电子元器件和零部件供应商，中游为整车制造、物流和销售网络，下游重点在车辆使用阶段能源消耗、维修服务和报废回收。";
  if (industry.includes("电子")) return "上游包括芯片、显示、电池、金属和塑料部件供应，中游为组装制造、数据服务或渠道销售，下游关注产品使用电力、维修和电子废弃物回收。";
  if (industry.includes("金融")) return "价值链重点不在实物采购，而在投融资组合、客户行业敞口、办公运营、商务差旅、数据中心服务和供应商采购。";
  if (industry.includes("建筑")) return "上游包括钢材、水泥、玻璃、机电设备和施工服务，中游为项目建设和资产运营，下游涉及建筑能耗、租赁资产、改造维护和废弃物处理。";
  if (industry.includes("交通运输")) return "上游包括车辆、船舶、飞机、燃料和外包承运商，中游为仓储、场站和运输配送，下游关注客户配送网络、装载效率和替代燃料。";
  return "价值链通常覆盖上游供应商采购、企业自身运营、运输配送、客户使用和废弃物处理等环节。";
}

function clientFocusDetail(code, industry = "") {
  const generic = {
    C1: ["核心原材料、包装材料、外包生产和关键服务采购。", "采购端通常连接大量供应商和上游制造活动，是价值链排放最容易集中的入口。", "优先识别高排放采购品类，推动核心供应商披露产品碳足迹或低碳材料方案，并提高低碳采购比例。"],
    C3: ["外购电力、蒸汽、燃料及其上游开采、加工和运输。", "能源上游会形成隐含排放，且受能源结构影响明显。", "提高绿电和可再生能源使用比例，推动重点站点节能改造，并优先选择低碳能源供应方案。"],
    C4: ["入厂物流、干线运输、仓网调拨和承运商服务。", "运输方式、装载率和仓网布局会直接影响单位货物排放。", "优化仓网和线路，提升满载率，推动低碳运输方式，并把低碳运输能力纳入承运商选择。"],
    C5: ["生产边角料、包装废弃物、仓储运营废弃物和办公废弃物。", "废弃物处理方式差异很大，填埋、焚烧和危险废弃物会带来更高环境影响。", "推动源头减量、分类回收、包装周转和边角料再利用。"],
    C9: ["经销配送、终端补货、电商配送、仓储和零售网络。", "下游配送贴近客户履约，受订单频次、仓网布局和末端配送方式影响明显。", "优化订单合并、区域仓布局和末端配送方式，推动物流伙伴采用低碳运输与绿色包装。"],
    C12: ["售出产品及包装的回收、再利用和处置。", "产品和包装末端去向会影响循环价值，也会影响品牌延伸责任。", "推动可回收设计、包装减量、回收渠道建设和再生材料闭环利用。"]
  };
  const apparel = {
    C1: ["面料、棉花和化纤材料、鞋材、包装材料、染整及代工生产供应商。", "运动鞋服行业的价值链排放通常集中在原材料生产、染整加工和供应商制造环节。", "优先锁定高用量面料和鞋材，提升再生纤维、生物基材料和低碳包装比例，并推动核心代工厂使用可再生电力。"],
    C4: ["面辅料入厂运输、成品从工厂到仓库的干线物流和跨区域调拨。", "多品牌、多仓和跨区域供应会放大运输频次，公路运输和空运补货尤其值得关注。", "优化产地与仓网匹配，减少紧急空运，提升整车装载率，并与承运商推进新能源车辆和铁路运输。"],
    C9: ["门店补货、电商配送、经销商配送和退换货物流。", "零售和电商履约会带来高频小批量配送，直接影响下游运输排放。", "推动订单合并、区域前置仓优化、绿色快递包装和逆向物流整合。"],
    C12: ["鞋服产品、吊牌、鞋盒、包装袋和退役产品回收处理。", "纺织品和鞋材复合材料回收难度较高，末端处理会影响循环经济表现。", "扩大旧衣旧鞋回收、单一材料设计和可回收包装，建立再生材料回用路径。"]
  };
  const food = {
    C1: ["粮食/农产品、水、玻璃瓶、纸箱、瓶盖、陶瓷或塑料包材及外包服务。", "食品饮料行业上游排放通常集中在农业原料和包装材料，尤其是玻璃、纸制品和金属瓶盖。", "优先管理高用量包材和主要原料，推动包装轻量化、再生材料使用和核心包材供应商节能降碳。"],
    C3: ["酿造、蒸馏、制冷、仓储和包装环节所用能源的上游排放。", "食品饮料生产对热力、电力和制冷依赖较高，能源结构会影响供应链隐含碳。", "提高绿电和可再生热能比例，优化蒸汽、制冷和压缩空气系统，推动重点工厂能源替代。"],
    C5: ["酒糟、污泥、废包装、废玻璃、废纸箱及生产运营废弃物。", "生产副产物和包装废弃物量大，资源化利用程度决定废弃物排放和循环价值。", "提升副产物综合利用、包装回收和废弃物分类处置比例，减少填埋和低价值处理。"],
    C12: ["售出产品包装在消费者端的回收、再利用和处置。", "瓶、盒、盖等包装是消费者端最主要的寿命终止处理对象。", "推进可回收包装设计、经销渠道回收合作和再生材料闭环，减少一次性包装影响。"]
  };
  const source = industry.includes("纺织服装") ? apparel : industry.includes("食品饮料") ? food : {};
  return source[code] || generic[code] || generic.C1;
}

function buildClientFocus(categories = [], industry = "") {
  return categories
    .filter(item => item.relevant && item.level !== "低")
    .slice(0, 6)
    .map(item => {
      const code = String(item.label || "").match(/C\d+/)?.[0] || "";
      const [link, reason, action] = clientFocusDetail(code, industry);
      return { title: `${item.label}｜${item.level}优先级`, source: item.source || "AI判断", link, reason, action };
    });
}

function profileFromReport(report) {
  const enterprise = report?.enterprise || {};
  const categories = report?.categories?.length
    ? report.categories
    : (report?.importantCategories || []).map((item, index) => ({
      label: `${item.code} ${item.name}`,
      score: Math.max(8, 36 - index * 5),
      level: item.level || "中",
      source: item.reason || "AI判断"
    }));
  return {
    publicInfoStatus: "PDF仅用于识别Scope 3披露；主营业务、价值链和关注重点由AI判断生成。",
    companyName: enterprise.companyName,
    sic: enterprise.sic,
    industry: enterprise.industry,
    business: aiBusinessForIndustry(enterprise.industry || enterprise.sic?.industry || ""),
    traits: aiValueChainForIndustry(enterprise.industry || enterprise.sic?.industry || ""),
    businessSource: "AI判断",
    valueChainSource: "AI判断",
    focus: buildClientFocus(categories, enterprise.industry || enterprise.sic?.industry || ""),
    categories: categories.length ? categories : [{ label: "暂无足够信息", score: 100, level: "低", source: "报告披露：未识别到足够Scope 3相关信息" }]
  };
}

function setEsgStatus(message, { cancel = false, retry = false } = {}) {
  const controls = [];
  if (cancel) controls.push(`<button class="ghost" id="cancelEsgJob">取消</button>`);
  if (retry) controls.push(`<button class="ghost" id="retryEsgJob">重试</button>`);
  $("esgUploadStatus").innerHTML = `${escapeHtml(message)}${controls.length ? `<div>${controls.join("")}</div>` : ""}`;
  if (cancel) $("cancelEsgJob").addEventListener("click", cancelEsgJob);
  if (retry) $("retryEsgJob").addEventListener("click", () => {
    if (lastEsgFile) uploadEsgWithJob(lastEsgFile);
  });
}

function uploadFileToJob(uploadUrl, file) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    activeEsgRequest = xhr;
    xhr.open("PUT", uploadUrl, true);
    xhr.timeout = 10 * 60 * 1000;
    xhr.setRequestHeader("Content-Type", "application/pdf");
    xhr.upload.onprogress = event => {
      if (event.lengthComputable) {
        setEsgStatus(`上传中：${file.name}（${Math.round(event.loaded / event.total * 100)}%）`, { cancel: true });
      }
    };
    xhr.onload = () => {
      activeEsgRequest = null;
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else {
        try {
          reject(new Error(JSON.parse(xhr.responseText || "{}").error || `上传失败：HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`上传失败：HTTP ${xhr.status}`));
        }
      }
    };
    xhr.onerror = () => {
      activeEsgRequest = null;
      reject(new Error("上传失败：网络或服务异常。"));
    };
    xhr.ontimeout = () => {
      activeEsgRequest = null;
      reject(new Error("上传超时，请重试。"));
    };
    xhr.onabort = () => {
      activeEsgRequest = null;
      reject(new Error("上传已取消。"));
    };
    xhr.send(file);
  });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollEsgJob(jobId) {
  const started = Date.now();
  while (Date.now() - started < 10 * 60 * 1000) {
    const job = await api(`/api/esg-jobs/${jobId}`);
    setEsgStatus(`${job.status}：${job.message || job.fileName}（${job.progress || 0}%）`, { cancel: job.status !== "完成" && job.status !== "失败", retry: job.status === "失败" });
    if (job.status === "完成") return job.result;
    if (job.status === "失败") throw new Error(job.error || job.message || "处理失败。");
    await wait(1400);
  }
  throw new Error("处理超时，请重试。");
}

async function cancelEsgJob() {
  if (activeEsgRequest) activeEsgRequest.abort();
  if (activeEsgJobId) {
    try {
      await fetch(`/api/esg-jobs/${activeEsgJobId}`, { method: "DELETE" });
    } catch {
      // Cancellation is best effort.
    }
  }
  setEsgStatus("处理失败：任务已取消。", { retry: Boolean(lastEsgFile) });
}

async function uploadEsgWithJob(file) {
  state.esgReport = null;
  renderEsgReport(null);
  if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
    setEsgStatus("处理失败：仅支持 PDF 格式报告。", { retry: true });
    saveState();
    return;
  }
  if (file.size > MAX_ESG_UPLOAD_BYTES) {
    setEsgStatus("处理失败：PDF超过200MB上传限制。", { retry: true });
    saveState();
    return;
  }
  try {
    setEsgStatus(`上传中：${file.name}（0%）`, { cancel: true });
    const job = await api("/api/esg-jobs", { fileName: file.name, fileSize: file.size, fileType: file.type });
    activeEsgJobId = job.id;
    await uploadFileToJob(job.uploadUrl, file);
    setEsgStatus(`上传完成：${file.name}。转换中。`, { cancel: true });
    state.esgReport = await pollEsgJob(job.id);
    setEsgStatus(`完成：${file.name}（100%）`, { retry: true });
    state.profile = profileFromReport(state.esgReport);
    renderAnalysis(state.profile);
    renderEsgReport(state.esgReport);
    saveState();
  } catch (err) {
    state.esgReport = null;
    setEsgStatus(`处理失败：${err.message}`, { retry: true });
    renderEsgReport(null);
    saveState();
  } finally {
    activeEsgRequest = null;
    activeEsgJobId = null;
  }
}

async function handleEsgUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (activeEsgRequest || activeEsgJobId) {
    setEsgStatus("已有ESG报告正在上传或解析，请先取消后再上传新报告。", { cancel: true });
    return;
  }
  lastEsgFile = file;
  await uploadEsgWithJob(file);
}

function renderEsgReport(report) {
  return;
}

async function runAnalysis() {
  if (!state.esgReport) {
    $("analysisStatus").textContent = "请先上传ESG报告。";
    return;
  }
  state.profile = profileFromReport(state.esgReport);
  renderAnalysis(state.profile);
  saveState();
}

async function generateReduction() {
  if (!totalsByCategory().some(x => x.emission > 0)) {
    $("reductionText").textContent = "尚未生成减排建议。";
    $("reductionDetail").innerHTML = "";
    $("fancyPath").innerHTML = "";
    $("timeline").innerHTML = "";
    return;
  }
  $("reductionText").textContent = "正在生成针对性减排路径...";
  state.reduction = await api("/api/reduction", { profile: state.profile, totals: totalsByCategory(), esgReport: state.esgReport });
  renderReduction(state.reduction);
  saveState();
}

function scheduleReduction() {
  clearTimeout(reductionTimer);
  reductionTimer = setTimeout(() => generateReduction().catch(err => {
    $("reductionText").textContent = `生成失败：${err.message}`;
  }), 450);
}

function renderReduction(reduction) {
  $("reductionText").textContent = reduction.headline;
  $("reductionDetail").innerHTML = `
    <div class="detail-block">
      <span>核心高排放环节识别</span>
      <p>${escapeHtml((reduction.diagnostic?.anchors || []).join(" "))}</p>
      <div class="emission-chips">
        ${(reduction.highEmissionLinks || []).map(item => `<b>${item.code} ${escapeHtml(String(item.title || "").replace(/^类别\s*\d+\s*/, ""))} · ${fmt(item.emission)} tCO₂e</b>`).join("") || "<b>暂无计算数据</b>"}
      </div>
    </div>
  `;
  $("fancyPath").innerHTML = `
    <div class="path-line"></div>
    ${(reduction.nodes || []).map((node, i) => `
      <article class="path-node ${i % 2 ? "below" : "above"}">
        <div class="node-dot">${escapeHtml(node.step)}</div>
        <div class="node-card">
          <span>${escapeHtml(node.phase)} · ${escapeHtml(node.code)}</span>
          <strong>${escapeHtml(node.label)}</strong>
          <p>${escapeHtml(node.detail)}</p>
        </div>
      </article>
    `).join("")}
  `;
  $("timeline").innerHTML = reduction.pathway.map(phase => `
    <article class="phase">
      <h3>${phase.phase}</h3>
      <small>${phase.horizon}</small>
      <ul>${phase.actions.map(x => `<li>${escapeHtml(x)}</li>`).join("")}</ul>
    </article>
  `).join("");
}

const scenarioTemplates = {
  C1: { action: "绿色采购比例提升20%", pct: 0.12, difficulty: "中", cost: "中" },
  C2: { action: "资本设备低碳采购与寿命延长", pct: 0.08, difficulty: "中", cost: "高" },
  C3: { action: "供应商使用可再生能源", pct: 0.18, difficulty: "中", cost: "中" },
  C4: { action: "空运转铁路并优化装载率", pct: 0.15, difficulty: "中", cost: "中" },
  C5: { action: "废弃物分类回收与填埋替代", pct: 0.20, difficulty: "低", cost: "低" },
  C6: { action: "商务差旅减少15%", pct: 0.15, difficulty: "低", cost: "低" },
  C7: { action: "公共交通补贴与弹性办公", pct: 0.10, difficulty: "低", cost: "低" },
  C13: { action: "出租资产能效改造和绿电使用", pct: 0.12, difficulty: "中", cost: "中" },
  C15: { action: "投资组合碳强度筛选与转型要求", pct: 0.10, difficulty: "高", cost: "中" }
};

function scoreValue(label) {
  return ({ "低": 1, "中": 2, "高": 3 })[label] || 2;
}

function roiBand(score, max) {
  const ratio = max ? score / max : 0;
  if (ratio >= 0.66) return "高ROI";
  if (ratio >= 0.33) return "中ROI";
  return "低ROI";
}

function roiClass(label) {
  if (label.startsWith("高")) return "high";
  if (label.startsWith("中")) return "mid";
  return "low";
}

function renderScenarioAnalysis(totals, grand) {
  const ranked = totals.filter(x => x.emission > 0).sort((a, b) => b.emission - a.emission);
  if (!ranked.length) {
    $("scenarioAnalysis").innerHTML = "";
    return;
  }
  const scenarios = ranked.map(item => {
    const tpl = scenarioTemplates[item.code] || { action: "供应商数据完善与重点环节减排", pct: 0.08, difficulty: "中", cost: "中" };
    const potential = item.emission * tpl.pct;
    const reductionPct = grand ? potential / grand * 100 : 0;
    const roi = potential / (scoreValue(tpl.difficulty) * scoreValue(tpl.cost));
    return { ...item, ...tpl, potential, reductionPct, roi };
  });
  const maxRoi = Math.max(...scenarios.map(x => x.roi), 1);
  const sorted = [...scenarios].sort((a, b) => b.roi - a.roi);
  $("scenarioAnalysis").innerHTML = `
    <div class="section-title scenario-title"><span>情景分析</span><small>基于当前计算结果自动生成</small></div>
    <div class="scenario-grid">
      ${scenarios.map(x => `
        <article class="scenario-card">
          <span>${x.code} ${escapeHtml(x.title.replace(/^类别\s*\d+\s*/, ""))}</span>
          <strong>${escapeHtml(x.action)}</strong>
          <p>减排潜力：${fmt(x.potential)} tCO₂e · 减排比例：${x.reductionPct.toFixed(1)}%</p>
          <div><b>难度：${x.difficulty}</b><b>成本：${x.cost}</b><b>${roiBand(x.roi, maxRoi)}</b></div>
        </article>
      `).join("")}
    </div>
    <div class="roi-table-wrap">
      <span class="card-label">减排措施优先级（ROI排序）</span>
      <table class="roi-table">
        <thead><tr><th>排名</th><th>Scope 3类别</th><th>减排措施</th><th>减排潜力</th><th>难度</th><th>成本</th><th>ROI评分</th></tr></thead>
        <tbody>
          ${sorted.map((x, i) => `
            <tr>
              <td>#${i + 1}</td>
              <td>${x.code} ${escapeHtml(x.title.replace(/^类别\s*\d+\s*/, ""))}</td>
              <td>${escapeHtml(x.action)}</td>
              <td>${fmt(x.potential)}</td>
              <td>${x.difficulty}</td>
              <td>${x.cost}</td>
              <td><span class="roi-pill ${roiClass(roiBand(x.roi, maxRoi))}">${fmt(x.roi)}</span></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
    <div class="scenario-note">
      <span class="card-label">指标说明</span>
      <p><b>减排潜力：</b>基于当前排放量 × 预设减排措施比例计算（单位：tCO₂e）。</p>
      <p><b>减排比例：</b>减排潜力 ÷ 当前类别排放量（%）。</p>
      <p><b>ROI评分：</b>减排潜力 ÷（实施难度 × 实施成本）。</p>
      <p>实施难度与成本均采用低=1、中=2、高=3的标准化评分；ROI用于衡量单位难度和成本下的减排收益，数值越高优先级越高。</p>
    </div>
  `;
}

function exportReport() {
  const totals = totalsByCategory().filter(x => x.emission > 0).sort((a, b) => b.emission - a.emission);
  const report = `
<!doctype html><html><head><meta charset="utf-8"><title>范围三碳排放报告</title>
<style>body{font-family:Arial,"Microsoft YaHei",sans-serif;line-height:1.7;color:#16231e;padding:32px}h1{color:#003d25}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dfe6e2;padding:8px;text-align:left}.box{background:#f5f7f6;padding:14px;border-radius:8px}</style></head>
<body><h1>范围三碳排放报告</h1>
<p>公司：${escapeHtml(state.esgReport?.enterprise?.companyName || "-")}</p>
<div class="box"><b>行业分析：</b>${escapeHtml(state.profile ? `${state.profile.industry}，${state.profile.traits}` : "未运行分析")}</div>
<h2>排放汇总</h2><p>总排放量：${$("grandTotal").textContent} tCO₂e</p>
<table><thead><tr><th>类别</th><th>排放量 tCO₂e</th></tr></thead><tbody>${totals.map(x => `<tr><td>${escapeHtml(x.title)}</td><td>${fmt(x.emission)}</td></tr>`).join("")}</tbody></table>
<h2>减排路径</h2><p>${escapeHtml(state.reduction?.headline || "未生成减排路径")}</p>
${(state.reduction?.pathway || []).map(p => `<h3>${p.phase}（${p.horizon}）</h3><ul>${p.actions.map(a => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`).join("")}
</body></html>`;
  const blob = new Blob([report], { type: "text/html;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `范围三碳排放报告-${state.esgReport?.enterprise?.companyName || "company"}.html`;
  a.click();
  URL.revokeObjectURL(a.href);
}

function clearData() {
  if (!confirm("确认清空当前输入和计算结果？")) return;
  localStorage.removeItem("scope3-calculator");
  state.rows = {};
  state.profile = null;
  state.reduction = null;
  state.esgReport = null;
  $("esgUpload").value = "";
  $("esgUploadStatus").textContent = "未上传ESG报告。";
  renderEsgReport(null);
  $("analysisStatus").textContent = "请先上传ESG报告";
  $("industryName").textContent = "待分析";
  $("industryTraits").textContent = "上传ESG报告并运行分析后，将展示SIC代码、SIC行业名称、主营业务、供应链和价值链信息。";
  $("focusList").innerHTML = "";
  $("importanceList").innerHTML = "";
  $("disclosureStats").innerHTML = "";
  $("timeline").innerHTML = "";
  $("fancyPath").innerHTML = "";
  $("reductionDetail").innerHTML = "";
  $("reductionText").textContent = "尚未生成减排建议。";
  renderCalculator();
}

function saveState() {
  const payload = {
    activeCode: state.activeCode,
    rows: state.rows,
    profile: state.profile,
    reduction: state.reduction,
    esgReport: state.esgReport
  };
  localStorage.setItem("scope3-calculator", JSON.stringify(payload));
}

function restoreState() {
  try {
    const saved = JSON.parse(localStorage.getItem("scope3-calculator") || "{}");
    state.activeCode = saved.activeCode || "C1";
    state.rows = saved.rows || {};
    normalizeCalculatorState();
    state.reduction = saved.reduction || null;
    state.esgReport = saved.esgReport || null;
    state.profile = state.esgReport ? profileFromReport(state.esgReport) : null;
    if (state.profile) renderAnalysis(state.profile);
    if (state.esgReport) {
      $("esgUploadStatus").textContent = `已加载上次解析结果：${state.esgReport.fileName}`;
      renderEsgReport(state.esgReport);
    }
    if (state.reduction) {
      renderReduction(state.reduction);
    }
  } catch {
    localStorage.removeItem("scope3-calculator");
  }
}

async function init() {
  state.data = await api("/api/factors");
  $("factorSummary").textContent = `已加载 ${state.data.categories.reduce((s, c) => s + c.items.length, 0)} 条排放因子`;
  renderKnowledge();
  setupNavActive();
  restoreState();
  renderCalculator();
  $("addRow").addEventListener("click", () => {
    const cat = getCategory();
    const first = cat.items[0] || {};
    ensureRows(cat.code).push({ id: crypto.randomUUID(), itemName: first.name, activity: "", unit: unitLabel(first.unit) });
    renderCalculator();
  });
  $("runAnalysis").addEventListener("click", () => runAnalysis().catch(err => {
    $("analysisStatus").textContent = `分析失败：${err.message}`;
  }));
  $("generateReduction")?.addEventListener("click", () => generateReduction().catch(err => {
    $("reductionText").textContent = `生成失败：${err.message}`;
  }));
  $("esgUpload").addEventListener("change", event => handleEsgUpload(event));
  $("exportBtn").addEventListener("click", exportReport);
  $("clearBtn").addEventListener("click", clearData);
}

init().catch(err => {
  document.body.innerHTML = `<pre style="padding:24px;color:#d94c4c">${escapeHtml(err.message)}</pre>`;
});
