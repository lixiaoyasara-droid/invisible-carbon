import fs from "node:fs/promises";
import fsSync from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 25_000_000) req.destroy();
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (err) { reject(err); }
    });
    req.on("error", reject);
  });
}

export async function loadFactors() {
  const dataPath = path.join(process.cwd(), "data", "emission-factors.json");
  return JSON.parse(await fs.readFile(dataPath, "utf8"));
}

function fetchText(url, timeout = 4500) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "Scope3Calculator/1.0" } }, res => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", chunk => data += chunk);
      res.on("end", () => resolve(data));
    });
    req.setTimeout(timeout, () => {
      req.destroy(new Error("timeout"));
    });
    req.on("error", reject);
  });
}

const industryRules = [
  { keys: ["汽车", "整车", "乘用车", "商用车", "新能源车", "比亚迪", "tesla", "蔚来", "理想", "小鹏"], industry: "汽车制造", business: "整车、零部件、动力电池及售后服务", traits: "金属、电子、电池材料采购密集，下游使用阶段和物流链条排放显著。", focus: ["动力电池和钢铝材料生产排放", "售出车辆使用阶段能源结构", "零部件供应商碳数据质量", "回收与再制造体系"] },
  { keys: ["科技", "电子", "半导体", "芯片", "华为", "小米", "苹果", "联想"], industry: "电子与信息技术", business: "电子硬件、软件服务、云与终端产品", traits: "高价值零部件、半导体制造、电力使用和全球运输占比较高。", focus: ["芯片和显示面板上游制造", "供应商可再生电力", "产品能效与使用阶段", "电子废弃物回收"] },
  { keys: ["食品", "饮料", "农业", "牧", "乳", "酒", "白酒", "酿造", "茅台", "伊利"], industry: "食品饮料", business: "农产品采购、加工、包装和渠道销售", traits: "农业原料、包装材料、冷链物流和土地相关排放重要。", focus: ["农业原料甲烷和氧化亚氮", "包装材料减量与循环", "冷链和运输效率", "供应链溯源"] },
  { keys: ["地产", "建筑", "水泥", "钢铁", "建材"], industry: "建筑与地产", business: "工程建设、建筑材料、资产运营", traits: "钢材、水泥、玻璃等建材隐含碳高，资本货物和下游运营重要。", focus: ["低碳建材采购", "施工废弃物", "建筑运营能效", "供应商环境产品声明"] },
  { keys: ["服装", "纺织", "鞋", "耐克", "安踏"], industry: "纺织服装", business: "面辅料采购、生产外包、品牌零售", traits: "面料、染整、包装、运输和售出产品报废处理相关。", focus: ["棉花和化纤材料", "染整环节能源", "供应商水电结构", "循环设计和回收"] },
  { keys: ["银行", "保险", "证券", "投资", "金融"], industry: "金融服务", business: "金融产品、投资、贷款和运营服务", traits: "自身运营排放较低，投资和融资相关排放通常是范围三重点。", focus: ["投融资组合碳强度", "高排放行业敞口", "客户转型计划", "绿色金融产品"] },
  { keys: ["物流", "航空", "快递", "铁路", "航运"], industry: "交通运输与物流", business: "货运、仓储、配送和运输服务", traits: "燃料、车辆船舶飞机资产、上下游运输活动排放集中。", focus: ["运输能源替代", "装载率和路线优化", "外包承运商数据", "可持续燃料采购"] }
];

const sicRules = [
  { code: "2085", name: "Distilled and Blended Liquors", zhName: "蒸馏及调配酒制造", keys: ["白酒", "酱香", "酒类", "酿酒", "酿造", "distilled spirits", "liquor", "baijiu"], industry: "食品饮料" },
  { code: "3711", name: "Motor Vehicles and Passenger Car Bodies", zhName: "机动车及乘用车车身制造", keys: ["汽车", "整车", "车辆", "动力电池", "motor vehicle", "automotive", "ev", "vehicle"], industry: "汽车制造" },
  { code: "3674", name: "Semiconductors and Related Devices", zhName: "半导体及相关器件制造", keys: ["半导体", "芯片", "晶圆", "集成电路", "semiconductor", "chip", "integrated circuit"], industry: "电子与信息技术" },
  { code: "3571", name: "Electronic Computers", zhName: "电子计算机制造", keys: ["电子", "计算机", "服务器", "终端", "云", "computer", "server", "electronics", "technology"], industry: "电子与信息技术" },
  { code: "2086", name: "Bottled and Canned Soft Drinks", zhName: "瓶装及罐装软饮料制造", keys: ["食品", "饮料", "乳", "农业", "农产品", "food", "beverage", "dairy", "agriculture"], industry: "食品饮料" },
  { code: "1521", name: "General Contractors - Single-Family Houses", zhName: "住宅建筑总承包", keys: ["地产", "建筑", "工程", "水泥", "钢铁", "建材", "construction", "real estate", "building material"], industry: "建筑与地产" },
  { code: "2339", name: "Women's, Misses', and Juniors' Outerwear, NEC", zhName: "女式、少女及青少年外衣制造（其他未分类）", keys: ["服装", "纺织", "鞋", "面料", "apparel", "textile", "footwear", "garment"], industry: "纺织服装" },
  { code: "6021", name: "National Commercial Banks", zhName: "全国性商业银行", keys: ["银行", "保险", "证券", "投资", "金融", "bank", "insurance", "securities", "investment", "finance"], industry: "金融服务" },
  { code: "4213", name: "Trucking, Except Local", zhName: "公路货运（本地除外）", keys: ["物流", "快递", "货运", "运输", "仓储", "trucking", "logistics", "freight", "delivery"], industry: "交通运输与物流" },
  { code: "4512", name: "Air Transportation, Scheduled", zhName: "定期航空运输", keys: ["航空", "航班", "机场", "airline", "aviation", "air transportation"], industry: "交通运输与物流" },
  { code: "4412", name: "Deep Sea Foreign Transportation of Freight", zhName: "远洋国际货物运输", keys: ["航运", "船舶", "港口", "shipping", "marine", "vessel"], industry: "交通运输与物流" },
  { code: "3999", name: "Manufacturing Industries, NEC", zhName: "制造业（其他未分类）", keys: ["制造", "生产", "工厂", "manufacturing", "factory", "production"], industry: "制造业/综合企业" }
];

const scope3Categories = [
  { code: "C1", zh: "外购商品和服务", en: "Purchased goods and services", keywords: ["外购商品", "外购服务", "购买的商品", "购买的产品和服务", "采购商品和服务", "購買的商品和服務", "外購商品和服務", "purchased goods"], aliases: ["外购商品和服务", "購買的商品和服務", "外購商品和服務", "Purchased Goods and Services", "外购商品及服务", "外購商品及服務"] },
  { code: "C2", zh: "资本品", en: "Capital goods", keywords: ["资本品", "资本货物", "资本商品", "資本品", "capital goods"], aliases: ["资本品", "资本商品", "資本貨物", "資本品", "Capital Goods"] },
  { code: "C3", zh: "燃料和能源相关活动", en: "Fuel- and energy-related activities", keywords: ["燃料和能源", "能源相关活动", "燃料及能源相关", "燃料和能源相關活動", "fuel- and energy"], aliases: ["燃料和能源相关活动", "燃料及能源相關活動", "Fuel- and Energy-Related Activities", "能源或燃料", "燃料及能源相关使用"] },
  { code: "C4", zh: "上游运输和配送", en: "Upstream transportation and distribution", keywords: ["上游运输", "上游配送", "上游运输及配送", "上游運輸和配送", "upstream transportation"], aliases: ["上游运输和配送", "上游運輸及配送", "Upstream Transportation and Distribution", "上游运输及配送"] },
  { code: "C5", zh: "运营中产生的废弃物", en: "Waste generated in operations", keywords: ["运营中产生的废弃物", "运营废弃物", "营运废弃物", "營運中產生的廢棄物", "waste generated"], aliases: ["运营中产生的废弃物", "營運中產生的廢棄物", "Waste Generated in Operations", "运营中产生的废物"] },
  { code: "C6", zh: "商务旅行", en: "Business travel", keywords: ["商务旅行", "商务差旅", "商務旅行", "business travel"], aliases: ["商务差旅", "商務差旅", "Business Travel", "商务旅行", "商務旅行", "员工差旅", "員工差旅"] },
  { code: "C7", zh: "员工通勤", en: "Employee commuting", keywords: ["员工通勤", "雇员通勤", "員工通勤", "僱員通勤", "employee commuting"], aliases: ["员工通勤", "員工通勤", "僱員通勤", "Employee Commuting"] },
  { code: "C8", zh: "上游租赁资产", en: "Upstream leased assets", keywords: ["上游租赁", "上游租赁资产", "上游租賃資產", "upstream leased"], aliases: ["上游租赁资产", "上游租賃資產", "Upstream Leased Assets", "上游租赁", "上游租賃"] },
  { code: "C9", zh: "下游运输和配送", en: "Downstream transportation and distribution", keywords: ["下游运输", "下游配送", "下游运输及配送", "下游運輸和配送", "downstream transportation"], aliases: ["下游运输和配送", "下游運輸及配送", "Downstream Transportation and Distribution", "下游运输及配送"] },
  { code: "C10", zh: "售出产品的加工", en: "Processing of sold products", keywords: ["售出产品的加工", "已售产品加工", "售出產品的加工", "processing of sold"], aliases: ["售出产品的加工", "售出產品的加工", "Processing of Sold Products"] },
  { code: "C11", zh: "售出产品的使用", en: "Use of sold products", keywords: ["售出产品的使用", "已售产品使用", "售出產品的使用", "use of sold products"], aliases: ["售出产品的使用", "售出產品的使用", "Use of Sold Products"] },
  { code: "C12", zh: "售出产品的寿命终止处理", en: "End-of-life treatment of sold products", keywords: ["寿命终止", "报废处理", "售出产品的寿命终止", "售出產品的壽命終止處理", "end-of-life"], aliases: ["售出产品的寿命终止处理", "售出產品生命週期結束後的處置", "生命週期結束後的處置", "End-of-Life Treatment of Sold Products", "处理寿命终止的售出产品"] },
  { code: "C13", zh: "下游租赁资产", en: "Downstream leased assets", keywords: ["下游租赁", "下游租赁资产", "下游租賃資產", "downstream leased"], aliases: ["下游租赁资产", "下游租賃資產", "Downstream Leased Assets", "下游租赁", "下游租賃"] },
  { code: "C14", zh: "特许经营", en: "Franchises", keywords: ["特许经营", "加盟", "特許經營", "franchises"], aliases: ["特许经营", "特許經營", "Franchises"] },
  { code: "C15", zh: "投资", en: "Investments", keywords: ["投资", "投融资", "投資", "investments"], aliases: ["投资", "投資", "Investments"] }
];

const phraseMap = new Map([
  ["永續發展", "可持续发展"],
  ["永續发展", "可持续发展"],
  ["可持續發展", "可持续发展"],
  ["溫室氣體", "温室气体"],
  ["溫室气体", "温室气体"],
  ["範疇一", "范围一"],
  ["範疇二", "范围二"],
  ["範疇三", "范围三"],
  ["範圍一", "范围一"],
  ["範圍二", "范围二"],
  ["範圍三", "范围三"],
  ["類別", "类别"],
  ["類型", "类型"],
  ["供應商", "供应商"],
  ["碳排放量", "碳排放量"],
  ["總排放量", "总排放量"],
  ["報告年度", "报告年度"],
  ["基準年", "基准年"],
  ["目標年", "目标年"],
  ["數據來源", "数据来源"],
  ["資料來源", "数据来源"],
  ["盤查", "核算"],
  ["營運", "运营"],
  ["員工", "员工"],
  ["僱員", "雇员"],
  ["商務", "商务"],
  ["差旅", "差旅"],
  ["廢棄物", "废弃物"],
  ["運輸", "运输"],
  ["配送", "配送"],
  ["租賃", "租赁"],
  ["資產", "资产"],
  ["資本", "资本"],
  ["購買", "购买"],
  ["採購", "采购"],
  ["產品", "产品"],
  ["服務", "服务"],
  ["電力", "电力"],
  ["蒸氣", "蒸汽"],
  ["製冷", "制冷"],
  ["製造", "制造"],
  ["辦公", "办公"],
  ["評價", "评价"],
  ["審核", "审核"],
  ["減排", "减排"],
  ["淨零", "净零"],
  ["碳中和", "碳中和"]
]);

const charMap = new Map(Object.entries({
  "與": "与", "萬": "万", "噸": "吨", "佔": "占", "據": "据", "數": "数", "據": "据",
  "據": "据", "單": "单", "類": "类", "別": "别", "範": "范", "圍": "围", "疇": "畴",
  "體": "体", "氣": "气", "溫": "温", "報": "报", "資": "资", "產": "产", "運": "运",
  "輸": "输", "營": "营", "廢": "废", "棄": "弃", "員": "员", "僱": "雇", "務": "务",
  "購": "购", "買": "买", "應": "应", "商": "商", "電": "电", "標": "标", "準": "准",
  "項": "项", "專": "专", "業": "业", "發": "发", "展": "展", "續": "续", "審": "审",
  "評": "评", "減": "减", "淨": "净", "製": "制", "辦": "办", "餘": "余", "處": "处",
  "壽": "寿", "終": "终", "過": "过", "程": "程", "會": "会", "責": "责", "任": "任"
}));

function toSimplified(text = "") {
  let out = String(text);
  for (const [from, to] of phraseMap) out = out.replaceAll(from, to);
  out = [...out].map(ch => charMap.get(ch) || ch).join("");
  return out.replace(/[二〇零一三四五六七八九]{4}(?=年|前|后|後|$)/g, year => {
    const digits = { "〇": "0", "零": "0", "一": "1", "二": "2", "三": "3", "四": "4", "五": "5", "六": "6", "七": "7", "八": "8", "九": "9" };
    return [...year].map(ch => digits[ch] || ch).join("");
  });
}

function detectLanguage(text = "") {
  const traditionalSignals = ["範疇", "溫室氣體", "永續", "供應商", "營運", "廢棄物", "員工", "數據", "報告"];
  const simplifiedSignals = ["范围", "温室气体", "可持续", "供应商", "运营", "废弃物", "员工", "数据", "报告"];
  const englishSignals = ["scope 3", "greenhouse gas", "sustainability", "supplier", "emissions"];
  const lower = text.toLowerCase();
  const traditional = traditionalSignals.filter(x => text.includes(x)).length;
  const simplified = simplifiedSignals.filter(x => text.includes(x)).length;
  const english = englishSignals.filter(x => lower.includes(x)).length;
  if (traditional >= 2) return "繁体中文";
  if (english > simplified && english >= 2) return "英文";
  if (simplified >= 1) return "简体中文";
  return "未能确认";
}

function classify(company, text = "") {
  const haystack = `${company} ${text}`.toLowerCase();
  const hit = industryRules.find(rule => rule.keys.some(k => haystack.includes(k.toLowerCase())));
  return hit || {
    industry: "制造业/综合企业",
    business: "商品采购、生产运营、物流配送和销售服务",
    traits: "原材料采购、运输、运营废弃物、差旅通勤等类别均可能形成可见度较低的间接排放。",
    focus: ["供应商排放因子质量", "高支出物料碳强度", "物流模式优化", "循环采购和废弃物管理"]
  };
}

function classifySic(text = "", fallbackIndustry = "") {
  const haystack = toSimplified(text).toLowerCase();
  const scored = sicRules
    .map(rule => ({
      rule,
      score: rule.keys.reduce((sum, key) => {
        const escaped = escapeRegExp(key.toLowerCase());
        const matches = haystack.match(new RegExp(escaped, "g"));
        return sum + (matches ? matches.length : 0);
      }, 0) * (rule.code === "3999" ? 0.18 : 1) + (rule.industry === fallbackIndustry ? 8 : 0)
    }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);
  const hit = scored[0]?.rule;
  if (hit) {
    return {
      code: hit.code,
      name: hit.name,
      zhName: hit.zhName,
      industry: hit.industry,
      basis: "报告披露：根据公司介绍、主营业务或业务板块关键词匹配SIC标准行业分类。",
      source: "报告披露"
    };
  }
  const fallback = sicRules.find(rule => rule.industry === fallbackIndustry) || sicRules[sicRules.length - 1];
  return {
    code: fallback.code,
    name: fallback.name,
    zhName: fallback.zhName,
    industry: fallback.industry,
    basis: "AI判断：报告未披露足够明确的业务关键词，按已识别行业属性匹配SIC标准行业分类。",
    source: "AI判断"
  };
}

function sentenceAround(text, keywords, window = 120) {
  const simplified = toSimplified(text);
  for (const keyword of keywords) {
    const index = simplified.toLowerCase().indexOf(keyword.toLowerCase());
    if (index < 0) continue;
    const start = Math.max(0, index - window);
    const end = Math.min(simplified.length, index + window * 2);
    const segment = simplified.slice(start, end);
    const parts = segment.split(/[。；;\n.]/).map(x => x.trim()).filter(Boolean);
    return (parts.find(x => x.toLowerCase().includes(keyword.toLowerCase())) || parts[0] || segment).slice(0, 180);
  }
  return "";
}

function reportOrAiField(text, keywords, aiValue) {
  const value = sentenceAround(text, keywords);
  return value
    ? { value, source: "报告披露" }
    : { value: aiValue || "未披露", source: aiValue ? "AI判断" : "报告披露" };
}

function categoryImportance(industry) {
  const base = [
    ["C1 外购商品和服务", 36, "高", "采购材料、服务和外包生产"],
    ["C2 资本货物", 12, "中", "设备、建筑和生产线投资"],
    ["C3 燃料和能源相关活动", 8, "中", "能源上游开采、加工和运输"],
    ["C4 上游运输和配送", 11, "中", "供应商到企业的物流"],
    ["C5 运营中产生的废弃物", 5, "低", "生产和办公废弃物处理"],
    ["C6 商务差旅", 4, "低", "航空、酒店、出租车和铁路"],
    ["C7 员工通勤", 3, "低", "员工上下班交通"]
  ];
  if (industry.includes("金融")) base.push(["C15 投资", 42, "高", "投融资组合关联排放"]);
  if (industry.includes("汽车")) base.push(["C11 售出产品使用", 39, "高", "车辆使用阶段能源消耗"]);
  if (industry.includes("建筑")) base[1][1] = 24;
  return base.sort((a, b) => b[1] - a[1]).slice(0, 7);
}

function aiBusinessForProfile(companyName, industry) {
  if (industry.includes("纺织服装")) return "运动鞋服、服装配饰及相关品牌零售业务，覆盖产品研发、设计、生产组织、渠道销售和消费者服务。";
  if (industry.includes("食品饮料")) return "酒类、食品或饮料产品的生产、包装、品牌运营和渠道销售，重点围绕原料采购、酿造/加工、包装和市场销售展开。";
  if (industry.includes("汽车")) return "整车、核心零部件、动力系统及售后服务相关业务，覆盖研发制造、供应链采购、销售和使用阶段服务。";
  if (industry.includes("电子")) return "电子硬件、终端设备、关键零部件或信息技术产品与服务，覆盖研发、制造协同、销售和售后支持。";
  if (industry.includes("金融")) return "银行、保险、证券、投资或综合金融服务，核心活动包括资金配置、客户服务、资产管理和投融资业务。";
  if (industry.includes("建筑")) return "工程建设、地产开发、建筑材料或资产运营相关业务，覆盖项目开发、采购施工、交付和运营管理。";
  if (industry.includes("交通运输")) return "货运、仓储、配送、航空、航运或综合物流服务，核心活动包括运输组织、线路调度、场站运营和客户交付。";
  return `${companyName || "该企业"}的主营业务按所属行业判断，主要涉及产品或服务的采购、生产/运营、销售交付及客户服务。`;
}

function aiValueChainForProfile(companyName, industry) {
  if (industry.includes("纺织服装")) return "上游以棉、化纤、皮革、橡胶、包装材料及代工供应商为主，中游包括设计、生产组织、仓储和门店/电商销售，下游涉及物流配送、消费者使用、包装与产品寿命终止处理。";
  if (industry.includes("食品饮料")) return "上游包括农产品、粮食、水、能源、玻璃瓶、纸箱、瓶盖等包材供应，中游为酿造/加工、包装和仓储，下游覆盖经销、零售、运输配送及包装回收处理。";
  if (industry.includes("汽车")) return "上游包括钢铝材料、电池、电子元器件和零部件供应商，中游为整车制造、物流和销售网络，下游重点在车辆使用阶段能源消耗、维修服务和报废回收。";
  if (industry.includes("电子")) return "上游包括芯片、显示、电池、金属和塑料部件供应，中游为组装制造、数据服务或渠道销售，下游关注产品使用电力、维修和电子废弃物回收。";
  if (industry.includes("金融")) return "价值链重点不在实物采购，而在投融资组合、客户行业敞口、办公运营、商务差旅、数据中心服务和供应商采购。";
  if (industry.includes("建筑")) return "上游包括钢材、水泥、玻璃、机电设备和施工服务，中游为项目建设和资产运营，下游涉及建筑能耗、租赁资产、改造维护和废弃物处理。";
  if (industry.includes("交通运输")) return "上游包括车辆、船舶、飞机、燃料和外包承运商，中游为仓储、场站和运输配送，下游关注客户配送网络、装载效率和替代燃料。";
  return "价值链通常覆盖上游供应商采购、企业自身运营、运输配送、客户使用和废弃物处理等环节。";
}

function industryRelevantCodes(industry = "") {
  const map = new Map([
    ["制造业/综合企业", ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C9", "C12"]],
    ["汽车制造", ["C1", "C2", "C3", "C4", "C9", "C11", "C12"]],
    ["电子与信息技术", ["C1", "C2", "C3", "C4", "C9", "C11", "C12"]],
    ["食品饮料", ["C1", "C3", "C4", "C5", "C9", "C12"]],
    ["建筑与地产", ["C1", "C2", "C3", "C4", "C5", "C13"]],
    ["纺织服装", ["C1", "C3", "C4", "C5", "C9", "C12"]],
    ["金融服务", ["C6", "C7", "C15"]],
    ["交通运输与物流", ["C2", "C3", "C4", "C5", "C9"]]
  ]);
  return new Set(map.get(industry) || map.get("制造业/综合企业"));
}

function pageForIndex(text, index) {
  const before = text.slice(0, Math.max(0, index));
  const matches = [...before.matchAll(/\[Page\s+(\d+)\]/gi)];
  return matches.length ? Number(matches[matches.length - 1][1]) : null;
}

function sourcePagesForTerms(text, terms) {
  const pages = new Set();
  terms.map(toSimplified).forEach(term => {
    const index = termIndex(text, term);
    if (index >= 0) {
      const page = pageForIndex(text, index);
      if (page) pages.add(page);
    }
  });
  return [...pages].sort((a, b) => a - b);
}

function categoryTerms(category) {
  const number = category.code.replace("C", "");
  return [category.code, `Category ${number}`, `Category${number}`, `类别 ${number}`, `类别${number}`, `范围三类别 ${number}`, `范围三类别${number}`, category.zh, category.en, ...category.keywords];
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termIndex(text, term) {
  const lower = toSimplified(text).toLowerCase();
  const normalized = toSimplified(term).toLowerCase().trim();
  if (!normalized) return -1;
  if (/^c\d+$/i.test(normalized)) {
    const match = lower.match(new RegExp(`(^|[^a-z0-9])${escapeRegExp(normalized)}(?![0-9])`, "i"));
    return match ? match.index + match[1].length : -1;
  }
  const categoryNumber = normalized.match(/^(?:范围三)?类别\s*(\d+)$/);
  if (categoryNumber) {
    const match = lower.match(new RegExp(`(?:范围三)?类别\\s*${categoryNumber[1]}(?!\\s*\\d)`, "i"));
    return match ? match.index : -1;
  }
  const categoryEnglish = normalized.match(/^category\s*(\d+)$/i);
  if (categoryEnglish) {
    const match = lower.match(new RegExp(`category\\s*${categoryEnglish[1]}(?!\\s*\\d)`, "i"));
    return match ? match.index : -1;
  }
  return lower.indexOf(normalized);
}

function assessScope3Categories(scope3, text, sic) {
  const normalized = toSimplified(text);
  const relevantCodes = industryRelevantCodes(sic.industry);
  const disclosedMap = new Map(scope3.disclosed.map(item => [item.code, item]));
  const disclosedAmounts = scope3.disclosed.map(item => Number(item.amount || 0)).filter(Boolean);
  const maxAmount = Math.max(...disclosedAmounts, 0);
  return scope3Categories.map(category => {
    const disclosed = disclosedMap.get(category.code) || null;
    const terms = categoryTerms(category);
    const mentionCount = terms.filter(term => termIndex(normalized, term) >= 0).length;
    const isIndustryRelevant = relevantCodes.has(category.code);
    const isRelevant = Boolean(disclosed) || mentionCount > 0 || isIndustryRelevant;
    const amount = Number(disclosed?.amount || 0);
    let level = "低";
    if (amount && (amount >= maxAmount * 0.25 || maxAmount === amount)) level = "高";
    else if (amount || (isIndustryRelevant && mentionCount > 0)) level = "中";
    else if (isIndustryRelevant) level = "中";
    const sourcePages = disclosed?.sourcePage ? [disclosed.sourcePage] : sourcePagesForTerms(normalized, terms);
    const disclosedValue = disclosed && disclosed.amount && disclosed.amount !== "需人工确认"
      ? `，排放量${disclosed.amount}${disclosed.unit && disclosed.unit !== "需人工确认" ? disclosed.unit : ""}`
      : "";
    const basis = disclosed
      ? `已披露${disclosedValue}${disclosed.share && disclosed.share !== "未披露" && disclosed.share !== "需人工确认" ? `，占比${disclosed.share}` : ""}${sourcePages.length ? `，来源页码：${sourcePages.join("、")}` : ""}`
      : mentionCount > 0
        ? `报告仅提及该类别或同义表达，未识别明确排放数据${sourcePages.length ? `，来源页码：${sourcePages.join("、")}` : ""}`
        : isIndustryRelevant
          ? `与${sic.zhName || sic.industry}业务链条相关，建议纳入核算边界`
          : "当前报告和行业属性未显示为优先类别";
    return {
      code: category.code,
      name: category.zh,
      label: `${category.code} ${category.zh}`,
      disclosed: Boolean(disclosed),
      disclosedStatus: disclosed ? "已披露" : "未披露",
      relevant: isRelevant,
      level,
      score: level === "高" ? 18 : level === "中" ? 10 : 4,
      basis,
      source: disclosed || mentionCount > 0 ? "报告披露" : isIndustryRelevant ? "AI判断" : "报告披露",
      sourcePages,
      amount: disclosed?.amount || "",
      unit: disclosed?.unit || "",
      share: disclosed?.share || ""
    };
  });
}

function reportBasedImportance(assessment) {
  return assessment
    .map(item => ({
      label: item.label,
      score: item.score,
      level: item.level,
      source: item.source,
      basis: item.basis,
      disclosed: item.disclosed,
      relevant: item.relevant,
      amount: item.amount,
      unit: item.unit,
      share: item.share
    }));
}

function managementFocus(assessment, profile) {
  const industry = profile.industry || "";
  const priority = assessment
    .filter(item => item.level !== "低" && item.relevant)
    .sort((a, b) => {
      const levelScore = { "高": 3, "中": 2, "低": 1 };
      return (levelScore[b.level] || 0) - (levelScore[a.level] || 0) || (b.disclosed ? 1 : 0) - (a.disclosed ? 1 : 0);
    })
    .slice(0, 6);
  const selected = priority.length >= 3 ? priority : assessment.filter(item => item.relevant).slice(0, 6);
  return selected.map(item => {
    const detail = focusDetail(item.code, industry);
    return {
      code: item.code,
      name: item.name,
      title: `${item.code} ${item.name}｜${item.level}优先级`,
      source: item.source === "AI判断" || !item.disclosed ? "AI判断" : "报告披露",
      link: detail.link,
      reason: detail.reason,
      action: detail.action
    };
  });
}

function focusDetail(code, industry = "") {
  const generic = {
    C1: {
      link: "核心原材料、包装材料、外包生产和关键服务采购。",
      reason: "采购端通常连接大量供应商和上游制造活动，是价值链排放最容易集中的入口。",
      action: "优先识别高排放采购品类，要求核心供应商披露产品碳足迹或低碳材料方案，并把低碳采购比例纳入供应商分级管理。"
    },
    C2: {
      link: "新增设备、厂房、产线、门店、仓储设施和信息系统资产。",
      reason: "资本品排放锁定在资产建设和制造阶段，前期选型会影响多年运营效率。",
      action: "在资本开支审批中加入低碳设备、耐用性、维修寿命和绿色建材要求，减少高碳短寿命资产投入。"
    },
    C3: {
      link: "外购电力、蒸汽、燃料及其上游开采、加工和运输。",
      reason: "即使企业自身能耗已计入范围二，能源上游仍会形成隐含排放，且受能源结构影响明显。",
      action: "提高绿电和可再生能源使用比例，推动重点站点节能改造，并优先选择低碳能源供应方案。"
    },
    C4: {
      link: "供应商到工厂/仓库的入厂物流、干线运输、仓网调拨和承运商服务。",
      reason: "运输方式、装载率和仓网布局会直接影响单位货物排放，尤其是公路和航空占比较高的场景。",
      action: "优化仓网和线路，提升满载率，推动公转铁、水运或新能源车辆，并把低碳运输能力纳入承运商选择。"
    },
    C5: {
      link: "生产边角料、包装废弃物、仓储运营废弃物和办公废弃物。",
      reason: "废弃物处理方式差异很大，填埋、焚烧和危险废弃物会带来更高环境影响。",
      action: "推动源头减量、分类回收、包装周转和边角料再利用，优先减少进入填埋或焚烧路径的废弃物。"
    },
    C6: {
      link: "航空差旅、铁路出行、酒店住宿和商务用车。",
      reason: "差旅排放虽然通常不是最大来源，但管理动作快、可见度高，适合作为短期行为减排抓手。",
      action: "建立差旅优先级规则，短途优先铁路和线上会议，选择低碳酒店和集中出行安排。"
    },
    C7: {
      link: "员工上下班交通、园区班车、私家车通勤和居家办公能源使用。",
      reason: "员工通勤与办公地点、班次安排和交通可达性相关，影响范围广且适合通过福利政策引导。",
      action: "优化班车和公共交通补贴，完善骑行设施，结合弹性办公降低高频高距离通勤。"
    },
    C8: {
      link: "租入办公室、仓库、门店、设备或车辆的能源使用。",
      reason: "租赁资产常缺少独立能耗管理，但会影响企业真实运营足迹。",
      action: "优先选择绿色建筑或低能耗租赁资产，在租约中加入能耗数据共享和节能改造条款。"
    },
    C9: {
      link: "产品出厂后的经销配送、终端补货、电商配送、仓储和零售网络。",
      reason: "下游配送贴近客户履约，受订单频次、仓网布局和末端配送方式影响明显。",
      action: "优化订单合并、区域仓布局和末端配送方式，推动经销商和物流伙伴采用低碳运输与绿色包装。"
    },
    C10: {
      link: "售出中间产品在客户侧继续加工、组装或包装的过程。",
      reason: "若企业销售中间品，下游加工能耗可能成为产品生命周期的重要排放段。",
      action: "与关键客户协同改进加工工艺、能源结构和材料利用率，并提供低碳设计或工艺建议。"
    },
    C11: {
      link: "售出产品在消费者或客户使用阶段的能源、燃料或耗材消耗。",
      reason: "使用阶段往往由产品设计决定，能效和使用寿命会持续影响多年排放。",
      action: "提升产品能效和耐用性，提供低碳使用指引，并将使用阶段碳影响纳入产品设计评审。"
    },
    C12: {
      link: "售出产品及包装的回收、再利用、焚烧、填埋和其他寿命终止处理。",
      reason: "产品和包装在末端处理中的去向会影响循环价值，也会影响品牌的延伸责任。",
      action: "推动可回收设计、包装减量、回收渠道建设和再生材料闭环利用。"
    },
    C13: {
      link: "出租给客户使用的建筑、门店、设备、车辆或其他资产。",
      reason: "出租资产的使用能耗虽然发生在客户侧，但通常受资产设计和运营规则影响。",
      action: "提升出租资产能效，提供绿色运营标准，并在租赁协议中推动能耗数据共享。"
    },
    C14: {
      link: "加盟店、特许经营门店、授权运营点及其能源和制冷剂使用。",
      reason: "特许经营网络通常分散，品牌方若缺少统一标准，门店能耗和制冷剂管理差异会较大。",
      action: "制定加盟门店能效、照明、制冷和装修材料标准，将低碳要求纳入加盟评价。"
    },
    C15: {
      link: "股权投资、债权投资、项目融资和资产管理组合。",
      reason: "金融或投资型企业的价值链排放通常集中在被投企业和融资项目。",
      action: "识别高碳行业敞口，推动被投企业制定转型计划，并把气候表现纳入投资和投后管理。"
    }
  };
  const industryOverrides = {
    "纺织服装": {
      C1: {
        link: "面料、棉花和化纤材料、鞋材、包装材料、染整及代工生产供应商。",
        reason: "运动鞋服行业的价值链排放通常集中在原材料生产、染整加工和供应商制造环节。",
        action: "优先锁定高用量面料和鞋材，提升再生纤维、生物基材料和低碳包装比例，并推动核心代工厂使用可再生电力。"
      },
      C4: {
        link: "面辅料入厂运输、成品从工厂到仓库的干线物流和跨区域调拨。",
        reason: "多品牌、多仓和跨区域供应会放大运输频次，公路运输和空运补货尤其值得关注。",
        action: "优化产地与仓网匹配，减少紧急空运，提升整车装载率，并与承运商推进新能源车辆和铁路运输。"
      },
      C9: {
        link: "门店补货、电商配送、经销商配送和退换货物流。",
        reason: "零售和电商履约会带来高频小批量配送，直接影响下游运输排放。",
        action: "推动订单合并、区域前置仓优化、绿色快递包装和逆向物流整合。"
      },
      C12: {
        link: "鞋服产品、吊牌、鞋盒、包装袋和退役产品回收处理。",
        reason: "纺织品和鞋材复合材料回收难度较高，末端处理会影响循环经济表现。",
        action: "扩大旧衣旧鞋回收、单一材料设计和可回收包装，建立再生材料回用路径。"
      }
    },
    "食品饮料": {
      C1: {
        link: "粮食/农产品、水、玻璃瓶、纸箱、瓶盖、陶瓷或塑料包材及外包服务。",
        reason: "食品饮料行业上游排放通常集中在农业原料和包装材料，尤其是玻璃、纸制品和金属瓶盖。",
        action: "优先管理高用量包材和主要原料，推动包装轻量化、再生材料使用和核心包材供应商节能降碳。"
      },
      C3: {
        link: "酿造、蒸馏、制冷、仓储和包装环节所用能源的上游排放。",
        reason: "食品饮料生产对热力、电力和制冷依赖较高，能源结构会影响供应链隐含碳。",
        action: "提高绿电和可再生热能比例，优化蒸汽、制冷和压缩空气系统，推动重点工厂能源替代。"
      },
      C5: {
        link: "酒糟、污泥、废包装、废玻璃、废纸箱及生产运营废弃物。",
        reason: "生产副产物和包装废弃物量大，资源化利用程度决定废弃物排放和循环价值。",
        action: "提升副产物综合利用、包装回收和废弃物分类处置比例，减少填埋和低价值处理。"
      },
      C12: {
        link: "售出产品包装在消费者端的回收、再利用和处置。",
        reason: "瓶、盒、盖等包装是消费者端最主要的寿命终止处理对象。",
        action: "推进可回收包装设计、经销渠道回收合作和再生材料闭环，减少一次性包装影响。"
      }
    }
  };
  return industryOverrides[industry]?.[code] || generic[code] || generic.C1;
}

function decodePdfLiteral(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function extractPdfText(buffer) {
  const chunks = [buffer.toString("utf8"), buffer.toString("latin1")];
  const raw = buffer.toString("latin1");
  const streamRegex = /<<(?:.|\n|\r)*?\/FlateDecode(?:.|\n|\r)*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  while ((match = streamRegex.exec(raw))) {
    try {
      const inflated = zlib.inflateSync(Buffer.from(match[1], "latin1"));
      chunks.push(inflated.toString("utf8"), inflated.toString("latin1"));
    } catch {
      // Some PDF streams are not plain zlib streams; skip them.
    }
  }
  const source = chunks.join("\n");
  const literalText = [...source.matchAll(/\((?:\\.|[^\\)]){2,}\)/g)]
    .map(m => decodePdfLiteral(m[0].slice(1, -1)))
    .join(" ");
  const hexText = [...source.matchAll(/<([0-9A-Fa-f]{4,})>/g)]
    .map(m => {
      try {
        return Buffer.from(m[1], "hex").toString("utf16be");
      } catch {
        return "";
      }
    })
    .join(" ");
  return `${literalText} ${hexText} ${source}`
    .replace(/\s+/g, " ")
    .replace(/[\x00-\x08\x0E-\x1F]/g, " ")
    .trim();
}

export const MAX_ESG_UPLOAD_BYTES = 200 * 1024 * 1024;

export function analyzeEsgExtractedText({ fileName, text, companyText = "", metadata = {}, extractionQuality = "" }) {
  const language = detectLanguage(text);
  const normalizedText = toSimplified(text);
  const companyName = extractCompanyName({ fileName, text, companyText, metadata });
  const aiProfile = classify(companyName || fileName, "");
  const sic = classifySic(`${companyName || ""} ${fileName || ""}`, aiProfile.industry);
  const profile = {
    ...aiProfile,
    industry: sic.industry,
    business: aiBusinessForProfile(companyName || fileName, sic.industry),
    traits: aiValueChainForProfile(companyName || fileName, sic.industry),
    sic,
    businessSource: "AI判断",
    valueChainSource: "AI判断"
  };
  const scope3 = buildScope3Disclosure(normalizedText, profile);
  const assessment = assessScope3Categories(scope3, normalizedText, sic);
  const categories = reportBasedImportance(assessment);
  const focus = managementFocus(assessment, profile);
  return {
    fileName,
    parsedAt: new Date().toISOString(),
    language,
    extractionQuality: extractionQuality || "原生PDF文本解析；未进行OCR。PDF仅用于识别Scope 3明确披露类别及排放数据。",
    sourceNote: `报告披露仅指PDF中明确识别到的Scope 3类别及排放数据；AI判断用于主营业务、供应链和行业关注重点生成。自动识别语言：${language}。`,
    enterprise: {
      companyName: companyName || "需人工确认",
      industry: sic.industry,
      sic,
      business: profile.business,
      valueChain: profile.traits,
      businessSource: profile.businessSource,
      valueChainSource: profile.valueChainSource,
      basis: companyName ? "公司名称来自PDF元数据、封面标题、公司简介或文件名候选；主营业务、供应链和价值链由AI判断生成。" : "公司名称无法可靠确认；主营业务、供应链和价值链由AI判断生成。"
    },
    scope3: { ...scope3, assessment },
    importantCategories: importantCategories(scope3, profile),
    categories,
    focus,
    management: {
      target: "未披露",
      baseYear: "未披露",
      targetYear: "未披露",
      reductionRatio: "未披露",
      projects: "未披露",
      supplierMeasures: "未披露",
      supplierData: "未披露"
    }
  };
}

function usefulLength(text = "") {
  return text.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").length;
}

function existingPath(candidates) {
  return candidates.find(item => item && fsSync.existsSync(item));
}

function ocrPdfText(buffer) {
  const binDir = "/Users/lixiaoya/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin";
  const pdftoppm = existingPath([process.env.PDFTOPPM_PATH, path.join(binDir, "pdftoppm"), "/opt/homebrew/bin/pdftoppm", "/usr/local/bin/pdftoppm"]);
  const swift = existingPath([process.env.SWIFT_PATH, "/usr/bin/swift"]);
  const script = path.join(process.cwd(), "scripts", "vision-ocr.swift");
  if (!pdftoppm || !swift || !fsSync.existsSync(script)) {
    return { text: "", lowConfidence: true, reason: "当前环境未配置可用OCR。相关数据需人工确认。" };
  }
  const workDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "scope3-ocr-"));
  try {
    const pdfPath = path.join(workDir, "report.pdf");
    const outputPrefix = path.join(workDir, "page");
    fsSync.writeFileSync(pdfPath, buffer);
    const render = spawnSync(pdftoppm, ["-png", "-f", "1", "-l", "3", "-r", "180", pdfPath, outputPrefix], { encoding: "utf8", timeout: 20000 });
    if (render.status !== 0) {
      return { text: "", lowConfidence: true, reason: "PDF扫描页渲染失败，相关数据需人工确认。" };
    }
    const images = fsSync.readdirSync(workDir)
      .filter(name => /^page-\d+\.png$/.test(name))
      .sort()
      .map(name => path.join(workDir, name));
    if (!images.length) return { text: "", lowConfidence: true, reason: "未能渲染扫描页，相关数据需人工确认。" };
    const swiftEnv = {
      ...process.env,
      CLANG_MODULE_CACHE_PATH: path.join(workDir, "module-cache"),
      SWIFT_MODULE_CACHE_PATH: path.join(workDir, "swift-module-cache")
    };
    const recognized = spawnSync(swift, [script, ...images], { encoding: "utf8", timeout: 60000, env: swiftEnv });
    if (recognized.status !== 0 || !recognized.stdout) {
      return { text: "", lowConfidence: true, reason: "OCR识别失败，相关数据需人工确认。" };
    }
    const parsed = JSON.parse(recognized.stdout);
    return {
      text: String(parsed.text || ""),
      lowConfidence: Number(parsed.averageConfidence || 0) < 0.55,
      reason: parsed.averageConfidence ? `OCR平均置信度 ${Number(parsed.averageConfidence).toFixed(2)}` : "OCR未返回置信度"
    };
  } catch {
    return { text: "", lowConfidence: true, reason: "OCR处理异常，相关数据需人工确认。" };
  } finally {
    fsSync.rmSync(workDir, { recursive: true, force: true });
  }
}

function findFirst(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1]
        .replace(/%PDF-\d(?:\.\d)?/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/[，。,.;；:：]+$/, "");
    }
  }
  return "";
}

function cleanCompanyName(name = "") {
  return name
    .replace(/^PDF-\d(?:\.\d)?\s*/i, "")
    .replace(/^%PDF-\d(?:\.\d)?\s*/i, "")
    .replace(/\.(pdf)$/i, "")
    .replace(/(?:20\d{2}|二〇[一二三四五六七八九零〇]{2}|202[0-9])\s*年?.*$/i, "")
    .replace(/(?:ESG|环境|環境|社会|社會|治理|可持续发展|可持續發展|永续|永續|社会责任|社會責任|报告|報告|年度|年报|年報)/gi, "")
    .replace(/^(本报告|本報告)?(覆盖|涵盖|覆蓋|涵蓋|主体为|主体為|由)\s*/, "")
    .split(/[，,；;]/)
    .pop()
    .replace(/^而\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function usableCompanyName(name = "") {
  const value = cleanCompanyName(name);
  if (!value) return "";
  if (/(不包括|包括|分佔|分占|聯營|联营|損益|损益|任何與|任何与|報告|报告|章節|章节|理念|戰略|战略|融入公司|推动公司|推動公司|公司治理|董事会|董事會|本公司|贵公司|貴公司)/.test(value)) return "";
  if (!/(股份有限公司|有限公司|集團|集团|控股|品牌|Inc\.|Ltd\.|Limited|Group|Company|Corporation|Corp\.)/i.test(value) && value.length > 12) return "";
  if (value.length > 40 && !/(股份有限公司|有限公司|集團|集团|Inc\.|Ltd\.|Limited|Group|Company)/i.test(value)) return "";
  return value;
}

function candidateCompanyNames(text = "", source = "text", baseScore = 0) {
  const sourceText = toSimplified(String(text || ""));
  const patterns = [
    /([\u4e00-\u9fa5A-Za-z0-9（）()·&.\-\s]{2,45}(?:股份有限公司|有限公司|控股有限公司|集团股份有限公司|集团有限公司|集团|控股|品牌))/g,
    /([A-Z][A-Za-z0-9&.,\s-]{2,70}(?:Inc\.|Ltd\.|Limited|Group|Company|Corporation|Corp\.))/g
  ];
  const candidates = [];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      const name = usableCompanyName(match[1]);
      if (!name) continue;
      const freqPattern = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const frequency = (sourceText.match(new RegExp(freqPattern, "g")) || []).length;
      candidates.push({ name, source, score: baseScore + frequency * 2 });
    }
  }
  return candidates;
}

function companyNameFromFile(fileName = "") {
  const raw = String(fileName || "").split(/[\\/]/).pop().replace(/\.pdf$/i, "");
  const cleaned = usableCompanyName(raw);
  if (cleaned) return cleaned;
  const brand = raw
    .replace(/(?:20\d{2}|202[0-9])\s*年?.*$/i, "")
    .replace(/(?:ESG|环境|環境|社会|社會|治理|可持续发展|可持續發展|永续|永續|社会责任|社會責任|报告|報告|年度|年报|年報)/gi, "")
    .replace(/[-_\s]+$/g, "")
    .trim();
  return usableCompanyName(brand) || (brand && !/(理念|战略|融入公司|推动公司|公司治理|报告|章節|章节)/.test(brand) ? brand : "");
}

function extractCompanyName({ fileName = "", text = "", companyText = "", metadata = {} } = {}) {
  const metadataText = Object.values(metadata || {}).filter(Boolean).join(" ");
  const frontText = companyText || String(text || "").split(/\[Page\s+4\]/i)[0] || "";
  const introMatches = String(text || "").match(/(?:关于公司|公司简介|企业简介|企業簡介|走近公司|关于.*?集团|關於公司|公司概况|公司概況)[\s\S]{0,1200}/g) || [];
  const candidates = [
    ...candidateCompanyNames(metadataText, "metadata", 100),
    ...candidateCompanyNames(frontText, "front", 80),
    ...candidateCompanyNames(introMatches.join("\n"), "intro", 65)
  ];
  const fileCandidate = companyNameFromFile(fileName);
  if (fileCandidate) candidates.push({ name: fileCandidate, source: "file", score: 55 });
  const titleAligned = toSimplified(`${metadataText} ${frontText} ${fileName}`);
  const scored = candidates
    .map(item => ({
      ...item,
      score: item.score
        + (titleAligned.includes(item.name) ? 10 : 0)
        + (/(股份有限公司|有限公司|集團|集团|控股有限公司|Group|Limited|Ltd\.)/i.test(item.name) ? 8 : 0)
    }))
    .filter(item => usableCompanyName(item.name));
  if (!scored.length) return "";
  scored.sort((a, b) => b.score - a.score || b.name.length - a.name.length);
  return scored[0].score >= 50 ? scored[0].name : "";
}

function hasAny(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some(keyword => lower.includes(keyword.toLowerCase()));
}

function extractEmissionNear(text, category) {
  const number = category.code.replace("C", "");
  const names = [category.code, `Category ${number}`, `Category${number}`, `类别 ${number}`, `类别${number}`, `范围三类别 ${number}`, `范围三类别${number}`, category.zh, category.en, ...category.keywords].map(toSimplified);
  for (const name of names) {
    const index = termIndex(text, name);
    if (index < 0) continue;
    const segment = text.slice(index, index + 420);
    const sourcePage = pageForIndex(text, index);
    const amount = segment.match(/([0-9][0-9,]*(?:\.[0-9]+)?)\s*(万吨|吨|公吨|tCO2e|tCO₂e|t CO2e|tonnes CO2e|tonnes of CO2e|kgCO2e|kg CO2e)/i);
    const share = segment.match(/(?:占比|占总量|share|percentage)[^0-9%]{0,30}([0-9](?:[0-9,])*(?:\.[0-9]+)?)\s*%/i);
    const year = segment.match(/(20[0-9]{2})\s*(?:年|年度)?/);
    const rawMethod = findFirst(segment, [/方法[:：]?\s*([^。；;%]{2,60})/, /数据来源[:：]?\s*([^。；;%]{2,60})/, /(供应商特定法|平均数据法|支出法|距离法|燃料法|supplier-specific|average-data|spend-based|distance-based|fuel-based)/i]);
    const method = rawMethod.replace(/\s*(目标年|目标年份|基准年|基准年度|供应商管理|供应链管理|温室气体|报告年度|数据来源).*$/i, "").trim();
    if (amount) {
      return {
        amount: amount[1].replace(/,/g, ""),
        unit: amount[2],
        reportYear: year?.[1] || "未披露",
        method: method || "未披露",
        share: share?.[1] ? `${share[1]}%` : "未披露",
        evidence: "报告披露",
        sourcePage
      };
    }
    return { amount: "需人工确认", unit: "需人工确认", reportYear: year?.[1] || "需人工确认", method: method || "需人工确认", share: share?.[1] ? `${share[1]}%` : "需人工确认", evidence: "报告提及类别但未识别排放量", sourcePage };
  }
  return null;
}

function extractExplicitCategoryMention(text, category) {
  const number = category.code.replace("C", "");
  const terms = [
    category.code,
    `Category ${number}`,
    `Category${number}`,
    `类别 ${number}`,
    `类别${number}`,
    `范围三类别 ${number}`,
    `范围三类别${number}`,
    category.zh,
    category.en
  ].map(toSimplified);
  const normalized = toSimplified(text);
  for (const term of terms) {
    const index = termIndex(normalized, term);
    if (index < 0) continue;
    const segment = normalized.slice(Math.max(0, index - 180), index + 260);
    if (/(范围三|scope\s*3|温室气体|溫室氣體|排放|emission|ghg|二氧化碳|CO2|CO₂|类别|category)/i.test(segment)) {
      return { sourcePage: pageForIndex(normalized, index) };
    }
  }
  return null;
}

function extractZeroEmissionCategories(text) {
  const zeroCodes = new Map();
  const normalized = toSimplified(text);
  const sentences = normalized.split(/[。；;\n]/).map(x => x.trim()).filter(Boolean);
  sentences.forEach(sentence => {
    if (!/范围三|scope\s*3/i.test(sentence) || !/排放量\s*为\s*0|emissions?\s+(?:are|is)?\s*0/i.test(sentence)) return;
    const page = pageForIndex(normalized, normalized.indexOf(sentence));
    [...sentence.matchAll(/(?:类别|category)\s*(\d{1,2})/gi)].forEach(match => {
      const code = `C${match[1]}`;
      if (scope3Categories.some(cat => cat.code === code)) zeroCodes.set(code, page);
    });
  });
  return zeroCodes;
}

function extractScope3ShareRows(text) {
  const shares = new Map();
  const normalized = toSimplified(text);
  const blocks = normalized.split(/\[Page\s+\d+\]/i);
  const pageMatches = [...normalized.matchAll(/\[Page\s+(\d+)\]/gi)].map(match => Number(match[1]));
  blocks.slice(1).forEach((block, idx) => {
    if (!/(范围三|scope\s*3)/i.test(block) || !/类别\s*\d|category\s*\d/i.test(block) || !/%/.test(block)) return;
    const firstCategory = block.search(/(?:类别|category)\s*\d{1,2}/i);
    const scopeArea = firstCategory >= 0 ? block.slice(firstCategory) : block;
    const cats = [...scopeArea.matchAll(/(?:类别|category)\s*(\d{1,2})/gi)]
      .map(match => `C${match[1]}`)
      .filter(code => scope3Categories.some(cat => cat.code === code));
    const percents = [...scopeArea.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*%/g)].map(match => `${match[1]}%`);
    const uniqueCats = cats.filter((code, catIndex) => cats.indexOf(code) === catIndex);
    if (uniqueCats.length < 2 || percents.length < uniqueCats.length) return;
    uniqueCats.forEach((code, catIndex) => {
      if (!shares.has(code)) shares.set(code, { share: percents[catIndex], sourcePage: pageMatches[idx] || null });
    });
  });
  return shares;
}

function inferPossibleOmissions(profile, disclosedCodes) {
  const industry = profile.industry || "";
  const likely = new Map([
    ["制造业/综合企业", ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]],
    ["汽车制造", ["C1", "C2", "C3", "C4", "C11", "C12"]],
    ["电子与信息技术", ["C1", "C2", "C3", "C4", "C11", "C12"]],
    ["食品饮料", ["C1", "C4", "C5", "C9", "C12"]],
    ["建筑与地产", ["C1", "C2", "C3", "C5", "C13"]],
    ["纺织服装", ["C1", "C4", "C9", "C12"]],
    ["金融服务", ["C6", "C7", "C15"]],
    ["交通运输与物流", ["C3", "C4", "C9", "C2"]]
  ]);
  const codes = likely.get(industry) || likely.get("制造业/综合企业");
  return scope3Categories
    .filter(cat => codes.includes(cat.code) && !disclosedCodes.has(cat.code))
    .map(cat => ({
      code: cat.code,
      name: cat.zh,
      basis: `AI判断：${industry || "该企业"}通常与${cat.zh}相关，但报告未识别到该类别披露。`
    }));
}

function parseNumericValue(value = "") {
  const cleaned = String(value).replace(/,/g, "").trim();
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : null;
}

function pageBlocks(text = "") {
  const matches = [...String(text).matchAll(/\[Page\s+(\d+)\]([\s\S]*?)(?=\n\[Page\s+\d+\]|\s*$)/gi)];
  return matches.map(match => ({ page: Number(match[1]), text: match[2] || "" }));
}

function categoryAliasList(category) {
  return [...new Set([...(category.aliases || []), category.zh, category.en].filter(Boolean))];
}

function findCategoryByRawName(rawName = "") {
  const normalized = toSimplified(rawName).toLowerCase().replace(/\s+/g, " ").trim();
  return scope3Categories.find(category =>
    categoryAliasList(category).some(alias => normalized.includes(toSimplified(alias).toLowerCase().replace(/\s+/g, " ").trim()))
  );
}

function extractScope3Total(text = "") {
  const normalized = toSimplified(text);
  const patterns = [
    /(?:范围三|scope\s*3)[^。\n]{0,40}(?:总排放量|排放总量|emissions?)[^0-9]{0,20}([0-9][0-9,]*(?:\.[0-9]+)?)\s*(万吨|吨|公吨|tCO2e|tCO₂e|tonnes CO2e|tonnes of CO2e)/i,
    /(?:温室气体范围三排放量|范围三间接温室气体排放量)[^0-9]{0,30}([0-9][0-9,]*(?:\.[0-9]+)?)\s*(万吨|吨|公吨|tCO2e|tCO₂e|tonnes CO2e|tonnes of CO2e)/i
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const index = normalized.indexOf(match[0]);
      return {
        value: parseNumericValue(match[1]),
        unit: /吨|公吨|tCO2|tCO₂|tonnes/i.test(match[2]) ? "tCO2e" : match[2],
        sourcePage: pageForIndex(normalized, index),
        evidenceText: match[0]
      };
    }
  }
  return null;
}

function appendixLike(blockText = "") {
  return /(附录|附錄|ESG\s*数据|ESG\s*數據|绩效数据|績效數據|关键绩效|關鍵績效|关键绩效指标|温室气体排放|溫室氣體排放|greenhouse gas emissions)/i.test(blockText);
}

function rowAmountAfterLabel(area = "", label = "") {
  const normalizedArea = toSimplified(area);
  const normalizedLabel = toSimplified(label);
  const index = normalizedArea.toLowerCase().indexOf(normalizedLabel.toLowerCase());
  if (index < 0) return null;
  const row = normalizedArea.slice(index, index + 220);
  const match = row.match(/(?:吨二氧化碳当量|噸二氧化碳當量|tCO2e|tCO₂e|tonnes?\s+CO2e)\s*([0-9][0-9,]*(?:\.[0-9]+)?|\/|—|-)/i);
  if (!match || /[\/—-]/.test(match[1])) return null;
  return {
    value: parseNumericValue(match[1]),
    unit: "tCO2e",
    evidenceText: row.trim()
  };
}

function extractAppendixScope3Table(text = "") {
  const records = new Map();
  let total = null;
  const blocks = pageBlocks(text);
  for (const block of blocks) {
    const normalizedBlock = toSimplified(block.text);
    if (!appendixLike(normalizedBlock)) continue;
    if (!/(单位|單位).{0,30}20[0-9]{2}/.test(normalizedBlock)) continue;
    if (!/(范围三|scope\s*3|温室气体排放)/i.test(normalizedBlock)) continue;
    const ghgStart = Math.max(0, normalizedBlock.search(/温室气体排放|溫室氣體排放|greenhouse gas emissions/i));
    const area = normalizedBlock.slice(ghgStart, ghgStart + 2600);
    const totalRow = rowAmountAfterLabel(area, "范围三排放量")
      || rowAmountAfterLabel(area, "范围三间接温室气体排放量")
      || rowAmountAfterLabel(area, "Scope 3 emissions");
    if (totalRow?.value !== null && totalRow?.value !== undefined) {
      total = {
        value: totalRow.value,
        unit: totalRow.unit,
        sourcePage: block.page,
        evidenceText: totalRow.evidenceText
      };
    }
    for (const category of scope3Categories) {
      for (const alias of categoryAliasList(category)) {
        const found = rowAmountAfterLabel(area, alias);
        if (!found || found.value === null || found.value === undefined) continue;
        upsertScope3Record(records, {
          categoryId: category.code,
          rawCategoryName: alias,
          emissionValue: found.value,
          unit: found.unit,
          percentage: null,
          sourcePage: block.page,
          evidenceText: found.evidenceText,
          extractionType: "appendix_table",
          confidence: 0.96
        }, total);
        break;
      }
    }
  }
  return { total, records };
}

function appendixRecordsReliable(records, total) {
  const disclosed = [...records.values()].filter(item => item.disclosed && typeof item.emissionValue === "number");
  if (!total?.value || disclosed.length < 2) return false;
  const sum = disclosed.reduce((acc, item) => acc + item.emissionValue, 0);
  return Math.abs(sum - total.value) / total.value <= 0.02;
}

function recordPriority(type) {
  return ({ appendix_table: 0, summary_chart: 1, summary_table: 1, emissions_table: 2, category_detail: 3, body: 4 }[type] || 9);
}

function normalizeScope3Record(record, total) {
  const category = scope3Categories.find(item => item.code === record.categoryId);
  let percentage = record.percentage ?? null;
  let emissionValue = record.emissionValue ?? null;
  let unit = record.unit || total?.unit || "";
  if (/^(吨|公吨|萬吨|万吨)$/i.test(unit)) unit = "tCO2e";
  let calculatedFromPercentage = false;
  if ((emissionValue === null || emissionValue === undefined || emissionValue === "") && percentage !== null && total?.value) {
    emissionValue = Math.round(total.value * percentage / 100);
    unit = total.unit || unit;
    calculatedFromPercentage = true;
  }
  if (emissionValue !== null && total?.value) {
    const derivedPct = Math.round(emissionValue / total.value * 1000) / 10;
    if (percentage === null || percentage === undefined || Math.abs(derivedPct - percentage) > 0.2) {
      percentage = derivedPct;
    }
  }
  const disclosed = Boolean(record.rawCategoryName || emissionValue !== null || percentage !== null);
  return {
    categoryId: record.categoryId,
    categoryName: category?.zh || record.categoryId,
    rawCategoryName: record.rawCategoryName || "",
    disclosed,
    emissionValue,
    unit,
    percentage,
    sourcePage: record.sourcePage || null,
    printedPage: record.printedPage || record.sourcePage || null,
    evidenceText: record.evidenceText || "",
    extractionType: record.extractionType || "body",
    confidence: record.confidence ?? 0.75,
    calculatedFromPercentage: record.calculatedFromPercentage || calculatedFromPercentage,
    dataQuality: ""
  };
}

function upsertScope3Record(records, next, total) {
  if (!next?.categoryId) return;
  const normalized = normalizeScope3Record(next, total);
  const current = records.get(normalized.categoryId);
  if (!current || recordPriority(normalized.extractionType) < recordPriority(current.extractionType)) {
    records.set(normalized.categoryId, normalized);
    return;
  }
  if (recordPriority(normalized.extractionType) === recordPriority(current.extractionType)) {
    records.set(normalized.categoryId, {
      ...current,
      rawCategoryName: current.rawCategoryName || normalized.rawCategoryName,
      emissionValue: current.emissionValue ?? normalized.emissionValue,
      unit: current.unit || normalized.unit,
      percentage: current.percentage ?? normalized.percentage,
      evidenceText: current.evidenceText || normalized.evidenceText,
      calculatedFromPercentage: current.calculatedFromPercentage || normalized.calculatedFromPercentage,
      confidence: Math.max(current.confidence || 0, normalized.confidence || 0)
    });
  }
}

function extractExplicitZeroRecords(text = "") {
  const records = [];
  const normalized = toSimplified(text);
  const sentences = normalized.split(/[。；;\n]/).map(x => x.trim()).filter(Boolean);
  for (const sentence of sentences) {
    if (!/(范围三|scope\s*3|温室气体)/i.test(sentence) || !/排放量\s*为\s*0|emissions?\s+(?:are|is)?\s*0/i.test(sentence)) continue;
    const page = pageForIndex(normalized, normalized.indexOf(sentence));
    for (const category of scope3Categories) {
      if (categoryAliasList(category).some(alias => sentence.toLowerCase().includes(toSimplified(alias).toLowerCase())) || new RegExp(`类别\\s*${category.code.slice(1)}\\s*[-－]`).test(sentence)) {
        records.push({
          categoryId: category.code,
          rawCategoryName: categoryAliasList(category).find(alias => sentence.toLowerCase().includes(toSimplified(alias).toLowerCase())) || `类别${category.code.slice(1)}`,
          emissionValue: 0,
          unit: "tCO2e",
          percentage: null,
          sourcePage: page,
          evidenceText: sentence,
          extractionType: "summary_chart",
          confidence: 0.96
        });
      }
    }
  }
  return records;
}

function numberCandidates(segment = "") {
  return [...segment.matchAll(/(?<![\d.])([0-9][0-9,]*(?:\.[0-9]+)?)(?!\s*%|[\d.])/g)]
    .map(match => ({ value: parseNumericValue(match[1]), raw: match[1], index: match.index || 0 }))
    .filter(item => item.value !== null && item.value >= 0 && item.value < 10_000_000 && item.value !== 2023 && item.value !== 2024 && item.value !== 2025 && item.value !== 2026);
}

function percentCandidates(segment = "") {
  return [...segment.matchAll(/([0-9]+(?:\.[0-9]+)?)\s*%/g)]
    .map(match => ({ value: Number(match[1]), raw: match[1], index: match.index || 0 }))
    .filter(item => Number.isFinite(item.value) && item.value >= 0 && item.value <= 100);
}

function nearestBefore(candidates, pivot) {
  return candidates.filter(item => item.index <= pivot).sort((a, b) => b.index - a.index)[0] || null;
}

function nearestAfter(candidates, pivot) {
  return candidates.filter(item => item.index >= pivot).sort((a, b) => a.index - b.index)[0] || null;
}

function extractNameAmountRecords(text = "") {
  const records = [];
  for (const block of pageBlocks(text)) {
    const normalizedBlock = toSimplified(block.text);
    if (!/(范围三|scope\s*3|温室气体|排放|emission|二氧化碳)/i.test(normalizedBlock)) continue;
    for (const category of scope3Categories) {
      for (const alias of categoryAliasList(category)) {
        const rawIndex = normalizedBlock.toLowerCase().indexOf(toSimplified(alias).toLowerCase());
        if (rawIndex < 0) continue;
        const rawAlias = categoryAliasList(category).find(item => block.text.includes(item));
        const start = Math.max(0, rawIndex - 120);
        const segment = normalizedBlock.slice(start, rawIndex + toSimplified(alias).length + 140);
        const pivot = rawIndex - start;
        const nums = numberCandidates(segment).filter(item => item.value >= 100 || item.value === 0);
        const pcts = percentCandidates(segment);
        const beforeAmount = nearestBefore(nums, pivot);
        const afterAmount = nearestAfter(nums, pivot);
        const amount = [beforeAmount, afterAmount]
          .filter(Boolean)
          .filter(item => Math.abs(item.index - pivot) <= 46)
          .sort((a, b) => Math.abs(a.index - pivot) - Math.abs(b.index - pivot))[0] || null;
        const percent = [nearestBefore(pcts, pivot), nearestAfter(pcts, pivot)]
          .filter(Boolean)
          .filter(item => Math.abs(item.index - pivot) <= 90)
          .sort((a, b) => Math.abs(a.index - pivot) - Math.abs(b.index - pivot))[0] || null;
        const hasAmount = amount && /吨|tCO2|tCO₂|二氧化碳|範圍三排放|范围三排放/i.test(segment);
        const hasPercent = hasAmount && Boolean(percent);
        const summaryLike = /(范围三排放|範圍三排放|总排放量|總排放量|温室气体排放情况|溫室氣體排放情況|指标与目标|指標與目標)/i.test(segment);
        if (hasAmount || hasPercent || summaryLike) {
          records.push({
            categoryId: category.code,
            rawCategoryName: rawAlias || alias,
            emissionValue: hasAmount ? amount.value : null,
            unit: hasAmount ? "吨" : "",
            percentage: hasPercent ? percent.value : null,
            sourcePage: block.page,
            evidenceText: segment.slice(0, 260),
            extractionType: summaryLike ? "summary_chart" : hasAmount ? "category_detail" : "body",
            confidence: hasAmount || hasPercent ? 0.9 : 0.72
          });
        }
      }
    }
  }
  return records;
}

function extractSummarySequenceRecords(text = "") {
  const records = [];
  for (const block of pageBlocks(text)) {
    const normalizedBlock = toSimplified(block.text);
    if (!/(范围三|scope\s*3|温室气体范围三)/i.test(normalizedBlock) || !/%/.test(normalizedBlock)) continue;
    const runs = [...normalizedBlock.matchAll(/((?:(?:类别|category)\s*\d{1,2}\s*){3,})/gi)];
    for (const run of runs) {
      const start = run.index || 0;
      const area = normalizedBlock.slice(start, start + 1200);
      const uniqueCodes = [...run[1].matchAll(/(?:类别|category)\s*(\d{1,2})/gi)]
        .map(match => `C${match[1]}`)
        .filter(code => scope3Categories.some(category => category.code === code));
      const percents = percentCandidates(area).map(item => item.value);
      const dashNames = [...area.matchAll(/[－-]\s*([^－\n]+?)(?=\s*[－-]|$)/g)]
        .map(match => match[1].replace(/[0-9]+%?100%?.*$/g, "").trim())
        .filter(Boolean);
      if (uniqueCodes.length < 2 || percents.length < uniqueCodes.length) continue;
      uniqueCodes.forEach((code, index) => {
      const category = scope3Categories.find(item => item.code === code);
      const rawName = dashNames[index] || category?.zh || code;
      records.push({
        categoryId: code,
        rawCategoryName: rawName,
        emissionValue: null,
        unit: "",
        percentage: percents[index],
        sourcePage: block.page,
        evidenceText: area.slice(0, 500),
        extractionType: "summary_chart",
        confidence: 0.9
      });
      });
    }
  }
  return records;
}

function validateScope3Records(records, total) {
  const disclosed = [...records.values()].filter(item => item.disclosed);
  const pctRecords = disclosed.filter(item => typeof item.percentage === "number" && item.percentage > 0);
  if (pctRecords.length >= 2) {
    const pctSum = pctRecords.reduce((sum, item) => sum + item.percentage, 0);
    if (Math.abs(pctSum - 100) > 1) {
      pctRecords.forEach(item => {
        item.dataQuality = "数据需复核";
        item.confidence = Math.min(item.confidence || 0.7, 0.6);
      });
    }
  }
  const amountRecords = disclosed.filter(item => typeof item.emissionValue === "number" && item.emissionValue > 0 && !item.calculatedFromPercentage);
  if (total?.value && amountRecords.length >= 2) {
    const amountSum = amountRecords.reduce((sum, item) => sum + item.emissionValue, 0);
    if (Math.abs(amountSum - total.value) / total.value > 0.02) {
      amountRecords.forEach(item => {
        item.dataQuality = "数据需复核";
        item.confidence = Math.min(item.confidence || 0.7, 0.6);
      });
    }
  }
  disclosed.forEach(item => {
    if (total?.value && item.emissionValue && item.percentage) {
      const derived = item.emissionValue / total.value * 100;
      if (Math.abs(derived - item.percentage) > 1) {
        item.dataQuality = "数据需复核";
        item.confidence = Math.min(item.confidence || 0.7, 0.6);
      }
    }
  });
}

function formatPercentage(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return Number.isInteger(num) && num > 0 && num < 10 ? num.toFixed(1) : String(num);
}

function buildScope3Disclosure(text, profile) {
  const appendix = extractAppendixScope3Table(text);
  const useAppendix = appendixRecordsReliable(appendix.records, appendix.total);
  const records = useAppendix ? appendix.records : new Map();
  const total = useAppendix ? appendix.total : extractScope3Total(text);
  if (!useAppendix) {
    [
      ...extractSummarySequenceRecords(text),
      ...extractNameAmountRecords(text),
      ...extractExplicitZeroRecords(text)
    ].forEach(record => upsertScope3Record(records, record, total));
  }
  validateScope3Records(records, total);
  const disclosed = scope3Categories
    .map(category => records.get(category.code))
    .filter(Boolean)
    .map(record => ({
      code: record.categoryId,
      name: record.categoryName,
      categoryId: record.categoryId,
      categoryName: record.categoryName,
      rawCategoryName: record.rawCategoryName,
      disclosed: record.disclosed,
      emissionValue: record.emissionValue,
      amount: record.emissionValue !== null && record.emissionValue !== undefined ? String(record.emissionValue) : "",
      unit: record.unit || "",
      percentage: record.percentage,
      share: record.percentage !== null && record.percentage !== undefined ? `${formatPercentage(record.percentage)}%` : "",
      sourcePage: record.sourcePage,
      printedPage: record.printedPage,
      evidenceText: record.evidenceText,
      extractionType: record.extractionType,
      confidence: record.confidence,
      calculatedFromPercentage: record.calculatedFromPercentage,
      dataQuality: record.dataQuality,
      evidence: record.emissionValue !== null && record.emissionValue !== undefined
        ? "报告披露"
        : record.percentage !== null && record.percentage !== undefined
          ? "报告披露Scope 3占比"
          : "报告披露类别但未提供具体数值",
      reportYear: "未披露",
      method: record.calculatedFromPercentage ? "根据报告占比计算" : record.extractionType
    }));
  const disclosedCodes = new Set(disclosed.map(item => item.code));
  const undisclosed = scope3Categories
    .filter(cat => !disclosedCodes.has(cat.code))
    .map(cat => ({ code: cat.code, name: cat.zh }));
  return {
    disclosed,
    undisclosed,
    possibleOmissions: inferPossibleOmissions(profile, disclosedCodes),
    total: total ? {
      emissionValue: total.value,
      unit: total.unit || "tCO2e",
      sourcePage: total.sourcePage,
      printedPage: total.sourcePage,
      evidenceText: total.evidenceText
    } : null
  };
}

function extractTargets(text) {
  const normalized = toSimplified(text);
  const invalidTarget = /(情景|情境|scenario|低温|高温|升温|基准情境|基准情景|rCP|SSP|1\.5|2℃|2°C)/i;
  const sentences = normalized
    .split(/[。；;\n]|(?<!\d)\.(?!\d)/)
    .map(x => x.trim())
    .filter(Boolean);
  const scoredTargets = sentences
    .filter(sentence =>
      !invalidTarget.test(sentence)
      && !/(category|类别\s*\d+\s*[-－]|排放量\s*[0-9]|emissions?\s+[0-9])/i.test(sentence)
      && /(减少|降低|减排|削减|下降|净零|碳中和|科学碳目标|SBTi|science based|reduce|reduction|net zero|carbon neutral|目标|承诺)/i.test(sentence)
      && /(20[0-9]{2}|%|百分之|净零|碳中和|net zero|carbon neutral)/i.test(sentence)
    )
    .map(sentence => {
      let score = 0;
      if (/SBTi|science based|科学碳目标/i.test(sentence)) score += 12;
      if (/范围三|scope\s*3/i.test(sentence)) score += 7;
      if (/(范围三|scope\s*3).{0,90}(减少|降低|减排|削减|reduce|reduction).{0,40}%/i.test(sentence)) score += 10;
      if (/目标|承诺|target|commit/i.test(sentence)) score += 6;
      if (/碳中和|净零|net zero|carbon neutral/i.test(sentence)) score += 5;
      if (/%/.test(sentence)) score += 4;
      if (/(?:到|至|于|before|by)[^0-9]{0,16}20[0-9]{2}/i.test(sentence)) score += 3;
      if (/20[0-9]{2}\s*年?\s*前/i.test(sentence)) score += 6;
      if (sentence.length > 320) score -= 12;
      if (sentence.length > 520) score -= 18;
      if (/1\+3\+5/.test(sentence)) score += 2;
      return { sentence, score };
    })
    .sort((a, b) => b.score - a.score);
  const targetSentence = scoredTargets[0]?.sentence || "";
  const targetIndex = targetSentence ? normalized.indexOf(targetSentence) : -1;
  const sourcePage = targetIndex >= 0 ? pageForIndex(normalized, targetIndex) : null;
  const reductionRatio = findFirst(targetSentence || "", [
    /(?:范围三|scope\s*3)[^%]{0,90}?([0-9]+(?:\.[0-9]+)?\s*%)/i,
    /(?:降低|减少|减排|下降|削减)[^0-9%]{0,20}([0-9]+(?:\.[0-9]+)?\s*%)/,
    /(?:reduce|reduction)[^0-9%]{0,30}([0-9]+(?:\.[0-9]+)?\s*%)/i,
    /([0-9]+(?:\.[0-9]+)?\s*%)/
  ]);
  const explicitTargetYear = findFirst(normalized, [/(?:目标年|目标年份|target year)[:：]?\s*(20[0-9]{2})/i]);
  const contextualTargetYear = findFirst(targetSentence || "", [/(?:到|至|于|於|before|by|no later than)[^0-9]{0,16}(20[0-9]{2})/i]);
  return {
    target: targetSentence || "需人工确认",
    targetYear: explicitTargetYear || contextualTargetYear || (targetSentence ? findFirst(targetSentence, [/(20[0-9]{2})(?![^。；;\n]{0,12}(?:基准年|base year))/i]) || "需人工确认" : "需人工确认"),
    baseYear: findFirst(normalized, [/(?:基准年|基准年度|基准年份|base year)[:：]?\s*(20[0-9]{2})/i, /以\s*(20[0-9]{2})\s*年?\s*为\s*基准年/i, /较\s*(20[0-9]{2})\s*年?\s*基准值/i]) || "需人工确认",
    reductionRatio: reductionRatio || "需人工确认",
    projects: findFirst(normalized, [/([^。；;\n]{0,50}(?:1\+3\+5|绿电|节能|光伏|可再生能源|绿色物流|循环|回收)[^。；;\n]{0,100})/]) || "需人工确认",
    supplierMeasures: findFirst(normalized, [/([^。；;\n]{0,50}(?:供应商|采购)[^。；;\n]{0,80}(?:碳|减排|ESG|环境|评价|审核|温室气体)[^。；;\n]{0,80})/]) || "需人工确认",
    supplierData: findFirst(normalized, [/([^。；;\n]{0,50}(?:供应商数据|供应商.*数据|问卷|评价|考核|审核|盘查)[^。；;\n]{0,80})/]) || "需人工确认",
    source: targetSentence ? "报告披露" : "需人工确认",
    sourcePage
  };
}

function importantCategories(scope3, profile) {
  const disclosedImportant = scope3.disclosed.slice(0, 5).map(item => ({
    code: item.code,
    name: item.name,
    level: item.amount !== "未披露" ? "高" : "中",
    reason: item.amount !== "未披露" ? "报告披露了该类别排放数据。" : "报告提及该类别，但未识别到排放量。"
  }));
  const omissionImportant = scope3.possibleOmissions.slice(0, 3).map(item => ({
    code: item.code,
    name: item.name,
    level: "中",
    reason: item.basis
  }));
  return [...disclosedImportant, ...omissionImportant].slice(0, 6);
}

export function analyzeEsgReport({ fileName, fileType, fileData }) {
  if (!fileName || !/\.pdf$/i.test(fileName) || fileType && fileType !== "application/pdf") {
    throw new Error("仅支持上传 PDF 格式的 ESG报告、可持续发展报告或社会责任报告。");
  }
  const base64 = String(fileData || "").split(",").pop();
  const buffer = Buffer.from(base64 || "", "base64");
  if (!buffer.length || buffer.slice(0, 4).toString() !== "%PDF") {
    throw new Error("文件不是有效的 PDF，无法解析。");
  }
  let text = extractPdfText(buffer);
  let usedOcr = false;
  let ocrNote = "";
  if (usefulLength(text) < 200) {
    const ocr = ocrPdfText(buffer);
    if (usefulLength(ocr.text) >= 200 && !ocr.lowConfidence) {
      text = ocr.text;
      usedOcr = true;
      ocrNote = ocr.reason;
    } else {
      throw new Error(`${ocr.reason || "未能从该 PDF 中提取足够文本，可能是扫描版、文字模糊或加密文件。"}不得自行补全或猜测，相关数据需人工确认。`);
    }
  }
  return analyzeEsgExtractedText({
    fileName,
    text,
    extractionQuality: usedOcr ? `扫描版PDF已通过OCR解析；${ocrNote}。` : "原生PDF文本解析；未进行OCR。若报告为扫描版或图表文字无法提取，相关数据标记为未披露或需人工确认。"
  });
}

export async function analyzeCompany({ companyName, reportYear }) {
  let publicText = "";
  const sources = [];
  if (companyName) {
    try {
      const wikiUrl = `https://zh.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(companyName)}`;
      const raw = await fetchText(wikiUrl);
      const parsed = JSON.parse(raw);
      if (parsed.extract) {
        publicText = parsed.extract;
        sources.push({ title: "Wikipedia 摘要", url: wikiUrl });
      }
    } catch {
      // Network is optional; local heuristics keep the app usable offline.
    }
  }
  const profile = classify(companyName || "", publicText);
  const importance = categoryImportance(profile.industry);
  return {
    companyName,
    reportYear,
    publicInfoStatus: sources.length ? "已检索公开摘要并结合本地行业规则分析" : "当前环境未取得公开网页结果，已使用本地行业知识库推断",
    sources,
    ...profile,
    categories: importance.map(([label, score, level, source]) => ({ label, score, level, source }))
  };
}

const categoryLevers = {
  C1: { levers: ["供应商产品碳足迹", "低碳材料替代", "采购规格重构", "供应商可再生电力"], short: "将排放贡献最高的采购品类拆到物料/供应商层级，要求核心供应商提供 PCF、EPD 或组织碳数据，并把附件中的平均因子逐步替换为供应商实测因子。", mid: "在招采评分中设置碳强度权重，对钢铝、电子件、包装、农产品等高碳物料建立低碳替代清单和年度降碳目标。", long: "与战略供应商共建低碳材料、闭环回收和可再生电力采购机制，把 Scope 3 数据嵌入采购合同、BOM 和产品生命周期管理。" },
  C2: { levers: ["设备能效", "低碳建材", "资产寿命延长", "绿色设计"], short: "梳理年度新增设备、产线、建筑和 IT 资产，优先补充供应商设备制造阶段排放数据。", mid: "把单位产能隐含碳、能效等级和维修寿命纳入资本开支审批，减少重复建设和短寿命资产。", long: "在工厂、门店或数据中心建设中采用低碳建材、模块化设计和可再利用资产标准。" },
  C3: { levers: ["能源结构", "绿电采购", "上游燃料", "能效管理"], short: "核对外购电力、蒸汽、燃料的上游排放边界，补齐能源供应商和地区因子。", mid: "提升绿电、绿证或分布式可再生能源占比，并对重点站点建立能效基线。", long: "推动高能耗环节电气化和低碳燃料替代，形成能源采购的长期脱碳组合。" },
  C4: { levers: ["运输模式", "装载率", "路线优化", "承运商数据"], short: "按承运商、线路、运输方式和吨公里拆分上游物流，识别空驶率高和航空/公路占比高的线路。", mid: "推进海铁联运、共同配送、满载率提升和仓网优化，将承运商碳数据纳入 SLA。", long: "与核心承运商导入新能源车辆、可持续航空燃料或低碳船运方案。" },
  C5: { levers: ["源头减量", "分类回收", "处置方式", "循环利用"], short: "按废弃物类型和处置方式建立台账，优先处理填埋、焚烧和危险废弃物流向。", mid: "导入分类回收、包装周转和生产边角料再利用，降低单位运营废弃物强度。", long: "与回收商建立闭环回用体系，将废弃物转化为再生材料或二次资源。" },
  C6: { levers: ["差旅政策", "视频会议", "交通替代", "住宿选择"], short: "按航空、铁路、出租车、酒店拆分差旅排放，识别高频航线和高排放出行场景。", mid: "设置差旅审批碳预算，短途优先铁路，会议优先线上或混合模式。", long: "与差旅平台联动低碳航班、绿色酒店和部门级碳绩效管理。" },
  C7: { levers: ["通勤结构", "班车", "公共交通", "弹性办公"], short: "通过员工通勤调查获取城市、距离、交通方式和频次，替换人均默认因子。", mid: "为高通勤强度园区配置班车、公共交通补贴、骑行设施和弹性办公。", long: "将办公选址、混合办公和绿色出行福利纳入长期人力与园区规划。" },
  C11: { levers: ["产品能效", "使用场景", "能源结构", "用户引导"], short: "按主要产品型号核算使用阶段能耗、寿命和地区能源结构，识别高排放产品线。", mid: "提升产品能效、软件节能策略和用户使用指引，减少全生命周期使用排放。", long: "推动产品电气化、服务化和低碳能源协同，使收入增长与使用阶段排放脱钩。" },
  C15: { levers: ["投融资碳强度", "组合管理", "客户转型", "绿色金融"], short: "按行业、客户和资产类型计算投融资排放，识别高碳敞口和数据缺口。", mid: "把客户转型计划、科学碳目标和信息披露质量纳入授信或投资决策。", long: "调整组合碳预算，扩大转型金融和绿色金融产品，推动被投企业实质减排。" }
};

const industryFocus = {
  "汽车制造": { anchors: ["动力电池、钢铝材料、电子件和整车使用阶段通常是隐含碳核心。", "供应链多层级且全球化，需把一级供应商数据逐步穿透到关键原材料。"], extraShort: "优先锁定电池、钢材、铝材、轮胎、电子控制件等高碳 BOM 项，建立车型级 Scope 3 热点矩阵。", extraMid: "推进低碳铝、短流程钢、再生材料和绿色电池材料采购，同时要求电池及零部件供应商披露可再生电力比例。", extraLong: "围绕电池回收、梯次利用、整车能效和充电侧绿电协同，形成从采购到使用再到回收的闭环减排。" },
  "电子与信息技术": { anchors: ["半导体、显示面板、精密零部件和数据中心电力是主要热点。", "产品迭代快，供应商制程电力结构和产品能效会显著影响范围三。"], extraShort: "先建立芯片、屏幕、结构件、服务器/终端运输的供应商碳数据清单。", extraMid: "推动晶圆厂、面板厂和代工厂使用可再生电力，并把产品待机能耗和寿命纳入设计评审。", extraLong: "建立可维修、可回收、可升级的产品策略，降低单位功能的全生命周期排放。" },
  "食品饮料": { anchors: ["农业原料、包装材料、冷链和土地相关排放通常占比较高。", "甲烷、氧化亚氮和供应链溯源是行业数据质量难点。"], extraShort: "优先按原料产地、种植/养殖方式、包装材料和冷链线路拆分排放。", extraMid: "推进再生农业、低碳肥料、包装轻量化和冷链能效优化。", extraLong: "与核心农户和供应商共建低碳原料基地，形成可追溯的农产品碳数据体系。" },
  "建筑与地产": { anchors: ["钢材、水泥、玻璃、铝材和设备资本货物通常是建造阶段碳热点。", "运营期能效会影响下游资产使用和租赁相关排放。"], extraShort: "按项目建立建材清单，优先补齐钢材、水泥、混凝土、幕墙和机电设备因子。", extraMid: "导入低熟料水泥、再生钢、绿色建材认证和施工废弃物资源化。", extraLong: "用全生命周期碳约束牵引设计、采购、施工和运营，把项目碳预算纳入投资决策。" },
  "金融服务": { anchors: ["投资和融资组合排放通常远高于办公运营排放。", "重点在资产组合碳强度、客户转型可信度和高碳行业敞口。"], extraShort: "按 PCAF 方法盘点贷款、投资和项目融资排放，标记高排放行业客户。", extraMid: "设置行业组合碳强度目标，将客户转型计划纳入授信和投后管理。", extraLong: "通过转型金融、绿色债券和组合再平衡，推动资本流向真实减排项目。" }
};

function categoryCode(item = {}) {
  const code = String(item.code || item.title || "").match(/C\d+/);
  return code ? code[0] : "";
}

function buildNode(code, index, phase, label, detail) {
  return { code, step: String(index).padStart(2, "0"), phase, label, detail };
}

export function buildReduction({ profile = {}, totals = [], esgReport = null }) {
  const ranked = [...totals].sort((a, b) => b.emission - a.emission);
  const top = ranked.slice(0, 3).filter(x => x.emission > 0);
  const reportImportant = esgReport?.importantCategories || [];
  const reportTargets = esgReport?.management || null;
  const topText = top.map(x => `${x.code} ${String(x.title || "").replace(/^类别\s*\d+\s*/, "")}`).join("、") || reportImportant.map(x => `${x.code} ${x.name}`).join("、") || "暂无显著排放数据";
  const industry = profile.industry || esgReport?.enterprise?.industry || "企业";
  const context = industryFocus[industry] || {
    anchors: [profile.traits || "企业范围三排放主要由采购、运输、能源相关活动和员工活动共同构成。", "建议优先把高支出、高排放和数据质量低的类别作为治理入口。"],
    extraShort: "先把高排放类别拆到供应商、产品、线路或场景层级，建立可追踪的数据口径。",
    extraMid: "把碳强度纳入采购、物流、差旅和资产投资决策，形成跨部门管控机制。",
    extraLong: "将供应链协同减排、产品生命周期设计和可审计数据平台纳入长期转型。"
  };
  const topLevers = top.map(item => {
    const code = categoryCode(item);
    const lever = categoryLevers[code] || categoryLevers.C1;
    return { code, title: item.title, emission: item.emission, shareSignal: item.emission > 0 ? "已形成主要排放贡献" : "暂无活动数据", levers: lever.levers, short: lever.short, mid: lever.mid, long: lever.long };
  });
  const defaultLever = topLevers[0] || { code: "C1", levers: categoryLevers.C1.levers, short: categoryLevers.C1.short, mid: categoryLevers.C1.mid, long: categoryLevers.C1.long };
  const reportHotspots = new Set(reportImportant.map(x => x.code));
  const actualHotspots = new Set(top.map(x => x.code));
  const gap = esgReport
    ? [...actualHotspots].filter(code => !reportHotspots.has(code)).map(code => `${code} 未在报告重点类别中体现`)
    : [];
  const reportContext = esgReport
    ? `报告披露目标：${reportTargets?.target || "未披露"}；目标年份：${reportTargets?.targetYear || "未披露"}；供应商管理：${reportTargets?.supplierMeasures || "未披露"}。`
    : "";
  const nodes = [
    buildNode(defaultLever.code, 1, "短期", "热点识别", `聚焦 ${topText}，把核算颗粒度下钻到供应商、物料、线路或场景。`),
    buildNode(defaultLever.code, 2, "短期", "数据替换", defaultLever.short),
    buildNode(topLevers[1]?.code || defaultLever.code, 3, "中期", "采购与运营规则", topLevers[1]?.mid || defaultLever.mid),
    buildNode(topLevers[2]?.code || defaultLever.code, 4, "中期", "协同降碳项目", context.extraMid),
    buildNode(defaultLever.code, 5, "长期", "价值链转型", context.extraLong),
    buildNode(defaultLever.code, 6, "长期", "披露与审计", "形成可审计的数据平台，将供应商实测因子、减排项目成效和年度披露口径保持一致。")
  ];
  return {
    headline: `核心高排放环节集中在 ${topText}。结合${industry}业务特征${esgReport ? "和已上传ESG报告披露信息" : ""}，减排重点应从平均因子核算升级为供应商/产品/场景级管理。`,
    diagnostic: { industry, business: profile.business || "", anchors: context.anchors, topCategories: top },
    esgInsight: esgReport ? {
      target: reportTargets?.target || "未披露",
      targetYear: reportTargets?.targetYear || "未披露",
      baseYear: reportTargets?.baseYear || "未披露",
      disclosedMeasures: reportTargets?.projects || "未披露",
      supplierMeasures: reportTargets?.supplierMeasures || "未披露",
      actualHotspots: top.length ? top.map(x => `${x.code} ${String(x.title || "").replace(/^类别\s*\d+\s*/, "")}`) : ["未完成碳排放计算，当前仅基于报告数据判断。"],
      reportHotspots: reportImportant.map(x => `${x.code} ${x.name}`),
      gap: gap.length ? gap : ["未识别到明显差距，或尚未完成碳排放计算。"],
      improvement: [
        `短期聚焦数据完善、重点类别核算、供应商筛选和快速减排措施，优先覆盖${topText}。${reportContext}`,
        `中期围绕${industry}采购优化、供应商协同、运输和产品设计改善，补齐报告披露与实际排放热点之间的数据缺口。`,
        `长期推进供应链转型、低碳产品、循环经济和价值链净零，并将报告目标、供应商要求和实际核算结果闭环追踪。`
      ]
    } : null,
    highEmissionLinks: top,
    pathway: [
      { phase: "短期措施", horizon: "0-12个月", actions: [context.extraShort, topLevers[0]?.short || categoryLevers.C1.short, "建立“排放量、数据质量、供应商覆盖率”三类指标，优先替换贡献最大的平均排放因子。"] },
      { phase: "中期优化", horizon: "1-3年", actions: [topLevers[0]?.mid || categoryLevers.C1.mid, topLevers[1]?.mid || "推动绿色物流、包装减量、可再生电力和低碳材料替代，并对关键供应商设置年度降碳里程碑。", "把碳强度、数据披露质量和减排项目进度纳入采购评分、承运商 SLA 或资本开支审批。"] },
      { phase: "长期转型路径", horizon: "3年以上", actions: [topLevers[0]?.long || categoryLevers.C1.long, context.extraLong, "建立覆盖供应商、产品生命周期和年度披露的数字化碳账本，支持第三方鉴证和目标追踪。"] }
    ],
    nodes
  };
}
