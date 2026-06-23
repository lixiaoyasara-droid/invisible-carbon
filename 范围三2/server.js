import http from "node:http";
import https from "node:https";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { analyzeEsgExtractedText, analyzeEsgReport, buildReduction as buildReductionShared, MAX_ESG_UPLOAD_BYTES } from "./api/_scope3.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataPath = path.join(__dirname, "data", "emission-factors.json");
const PORT = Number(process.env.PORT || 4173);
const objectStoreDir = process.env.ESG_OBJECT_STORE_DIR || path.join(os.tmpdir(), "scope3-object-store");
const jobs = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png"
};

function readJson(req) {
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

function json(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(payload));
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    fileName: job.fileName,
    fileSize: job.fileSize,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    result: job.result || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function setJob(job, status, progress, message) {
  job.status = status;
  job.progress = progress;
  job.message = message;
  job.updatedAt = new Date().toISOString();
}

function decodeHeader(value = "") {
  try {
    return decodeURIComponent(String(value));
  } catch {
    return String(value);
  }
}

function runPython(args, timeout = 240000) {
  const python = process.env.PYTHON_PATH || "/Users/lixiaoya/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { cwd: __dirname });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("PDF处理超时，请重试。"));
    }, timeout);
    child.stdout.on("data", chunk => stdout += chunk);
    child.stderr.on("data", chunk => stderr += chunk);
    child.on("error", err => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `PDF处理失败，退出码 ${code}`));
    });
  });
}

async function processEsgJob(job) {
  try {
    if (job.cancelled) return;
    setJob(job, "转换中", 35, "服务端正在转换PDF格式。");
    const raw = await runPython(["scripts/pdf-extract-pipeline.py", job.objectPath]);
    if (job.cancelled) return;
    setJob(job, "提取中", 55, "正在提取文本、目录关键词页和表格。");
    const extracted = JSON.parse(raw);
    if (extracted.candidateOcrPages?.length || extracted.pdfType === "scanned") {
      setJob(job, "OCR中", 68, "检测到扫描页，仅对相关页执行OCR或标记人工确认。");
    }
    if (!String(extracted.text || "").replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, "").length) {
      throw new Error(extracted.warning || "未提取到可分析文本，相关扫描页需人工确认。");
    }
    setJob(job, "结构化中", 78, "正在生成文本、Markdown和表格JSON。");
    const extractionQuality = [
      `PDF类型：${extracted.pdfType}`,
      `共${extracted.pages}页，按${extracted.batches}批处理`,
      `关键词命中页：${(extracted.relevantPages || []).length}页`,
      extracted.warning || ""
    ].filter(Boolean).join("；");
    setJob(job, "AI分析中", 88, "AI分析仅读取提取后的文本和表格JSON。");
    const result = analyzeEsgExtractedText({
      fileName: job.fileName,
      text: `${extracted.markdown || extracted.text}\n\n${JSON.stringify(extracted.tables || [])}`,
      companyText: extracted.frontMatter || "",
      metadata: extracted.metadata || {},
      extractionQuality
    });
    result.extractedTables = extracted.tables || [];
    result.processing = {
      pdfType: extracted.pdfType,
      pages: extracted.pages,
      relevantPages: extracted.relevantPages || [],
      candidateOcrPages: extracted.candidateOcrPages || []
    };
    job.result = result;
    setJob(job, "完成", 100, "分析完成。");
  } catch (err) {
    job.error = err.message;
    setJob(job, "失败", job.progress || 0, err.message);
  } finally {
    if (job.objectPath) fs.rm(job.objectPath, { force: true }).catch(() => {});
  }
}

function receiveJobUpload(req, job) {
  return new Promise((resolve, reject) => {
    const declaredSize = Number(req.headers["content-length"] || job.fileSize || 0);
    if (declaredSize > MAX_ESG_UPLOAD_BYTES) {
      req.resume();
      reject(new Error("PDF超过200MB上传限制。"));
      return;
    }
    fsSync.mkdirSync(objectStoreDir, { recursive: true });
    const objectPath = path.join(objectStoreDir, `${job.id}.pdf`);
    const out = fsSync.createWriteStream(objectPath);
    let received = 0;
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (err) {
        out.destroy();
        fsSync.rmSync(objectPath, { force: true });
        reject(err);
      } else {
        job.objectPath = objectPath;
        job.fileSize = received || declaredSize;
        resolve();
      }
    };
    req.setTimeout(10 * 60 * 1000, () => {
      finish(new Error("上传超时，请重试。"));
      req.destroy();
    });
    req.on("data", chunk => {
      received += chunk.length;
      if (received > MAX_ESG_UPLOAD_BYTES) {
        finish(new Error("PDF超过200MB上传限制。"));
        req.destroy();
      }
    });
    req.on("aborted", () => finish(new Error("上传已取消。")));
    req.on("error", finish);
    out.on("error", finish);
    out.on("finish", () => finish());
    req.pipe(out);
  });
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
  { keys: ["汽车", "车", "比亚迪", "tesla", "蔚来", "理想", "小鹏"], industry: "汽车制造", business: "整车、零部件、动力电池及售后服务", traits: "金属、电子、电池材料采购密集，下游使用阶段和物流链条排放显著。", focus: ["动力电池和钢铝材料生产排放", "售出车辆使用阶段能源结构", "零部件供应商碳数据质量", "回收与再制造体系"] },
  { keys: ["科技", "电子", "半导体", "芯片", "华为", "小米", "苹果", "联想"], industry: "电子与信息技术", business: "电子硬件、软件服务、云与终端产品", traits: "高价值零部件、半导体制造、电力使用和全球运输占比较高。", focus: ["芯片和显示面板上游制造", "供应商可再生电力", "产品能效与使用阶段", "电子废弃物回收"] },
  { keys: ["食品", "饮料", "农业", "牧", "乳", "茅台", "伊利"], industry: "食品饮料", business: "农产品采购、加工、包装和渠道销售", traits: "农业原料、包装材料、冷链物流和土地相关排放重要。", focus: ["农业原料甲烷和氧化亚氮", "包装材料减量与循环", "冷链和运输效率", "供应链溯源"] },
  { keys: ["地产", "建筑", "水泥", "钢铁", "建材"], industry: "建筑与地产", business: "工程建设、建筑材料、资产运营", traits: "钢材、水泥、玻璃等建材隐含碳高，资本货物和下游运营重要。", focus: ["低碳建材采购", "施工废弃物", "建筑运营能效", "供应商环境产品声明"] },
  { keys: ["服装", "纺织", "鞋", "耐克", "安踏"], industry: "纺织服装", business: "面辅料采购、生产外包、品牌零售", traits: "面料、染整、包装、运输和售出产品报废处理相关。", focus: ["棉花和化纤材料", "染整环节能源", "供应商水电结构", "循环设计和回收"] },
  { keys: ["银行", "保险", "证券", "投资", "金融"], industry: "金融服务", business: "金融产品、投资、贷款和运营服务", traits: "自身运营排放较低，投资和融资相关排放通常是范围三重点。", focus: ["投融资组合碳强度", "高排放行业敞口", "客户转型计划", "绿色金融产品"] },
  { keys: ["物流", "航空", "快递", "铁路", "航运"], industry: "交通运输与物流", business: "货运、仓储、配送和运输服务", traits: "燃料、车辆船舶飞机资产、上下游运输活动排放集中。", focus: ["运输能源替代", "装载率和路线优化", "外包承运商数据", "可持续燃料采购"] }
];

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

async function analyzeCompany({ companyName, reportYear }) {
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
  C1: {
    name: "外购商品和服务",
    levers: ["供应商产品碳足迹", "低碳材料替代", "采购规格重构", "供应商可再生电力"],
    short: "将排放贡献最高的采购品类拆到物料/供应商层级，要求核心供应商提供 PCF、EPD 或组织碳数据，并把附件中的平均因子逐步替换为供应商实测因子。",
    mid: "在招采评分中设置碳强度权重，对钢铝、电子件、包装、农产品等高碳物料建立低碳替代清单和年度降碳目标。",
    long: "与战略供应商共建低碳材料、闭环回收和可再生电力采购机制，把 Scope 3 数据嵌入采购合同、BOM 和产品生命周期管理。"
  },
  C2: {
    name: "资本货物",
    levers: ["设备能效", "低碳建材", "资产寿命延长", "绿色设计"],
    short: "梳理年度新增设备、产线、建筑和 IT 资产，优先补充供应商设备制造阶段排放数据。",
    mid: "把单位产能隐含碳、能效等级和维修寿命纳入资本开支审批，减少重复建设和短寿命资产。",
    long: "在工厂、门店或数据中心建设中采用低碳建材、模块化设计和可再利用资产标准。"
  },
  C3: {
    name: "燃料和能源相关活动",
    levers: ["能源结构", "绿电采购", "上游燃料", "能效管理"],
    short: "核对外购电力、蒸汽、燃料的上游排放边界，补齐能源供应商和地区因子。",
    mid: "提升绿电、绿证或分布式可再生能源占比，并对重点站点建立能效基线。",
    long: "推动高能耗环节电气化和低碳燃料替代，形成能源采购的长期脱碳组合。"
  },
  C4: {
    name: "上游运输和配送",
    levers: ["运输模式", "装载率", "路线优化", "承运商数据"],
    short: "按承运商、线路、运输方式和吨公里拆分上游物流，识别空驶率高和航空/公路占比高的线路。",
    mid: "推进海铁联运、共同配送、满载率提升和仓网优化，将承运商碳数据纳入 SLA。",
    long: "与核心承运商导入新能源车辆、可持续航空燃料或低碳船运方案。"
  },
  C5: {
    name: "运营中产生的废弃物",
    levers: ["源头减量", "分类回收", "处置方式", "循环利用"],
    short: "按废弃物类型和处置方式建立台账，优先处理填埋、焚烧和危险废弃物流向。",
    mid: "导入分类回收、包装周转和生产边角料再利用，降低单位运营废弃物强度。",
    long: "与回收商建立闭环回用体系，将废弃物转化为再生材料或二次资源。"
  },
  C6: {
    name: "商务差旅",
    levers: ["差旅政策", "视频会议", "交通替代", "住宿选择"],
    short: "按航空、铁路、出租车、酒店拆分差旅排放，识别高频航线和高排放出行场景。",
    mid: "设置差旅审批碳预算，短途优先铁路，会议优先线上或混合模式。",
    long: "与差旅平台联动低碳航班、绿色酒店和部门级碳绩效管理。"
  },
  C7: {
    name: "员工通勤",
    levers: ["通勤结构", "班车", "公共交通", "弹性办公"],
    short: "通过员工通勤调查获取城市、距离、交通方式和频次，替换人均默认因子。",
    mid: "为高通勤强度园区配置班车、公共交通补贴、骑行设施和弹性办公。",
    long: "将办公选址、混合办公和绿色出行福利纳入长期人力与园区规划。"
  },
  C11: {
    name: "售出产品使用",
    levers: ["产品能效", "使用场景", "能源结构", "用户引导"],
    short: "按主要产品型号核算使用阶段能耗、寿命和地区能源结构，识别高排放产品线。",
    mid: "提升产品能效、软件节能策略和用户使用指引，减少全生命周期使用排放。",
    long: "推动产品电气化、服务化和低碳能源协同，使收入增长与使用阶段排放脱钩。"
  },
  C15: {
    name: "投资",
    levers: ["投融资碳强度", "组合管理", "客户转型", "绿色金融"],
    short: "按行业、客户和资产类型计算投融资排放，识别高碳敞口和数据缺口。",
    mid: "把客户转型计划、科学碳目标和信息披露质量纳入授信或投资决策。",
    long: "调整组合碳预算，扩大转型金融和绿色金融产品，推动被投企业实质减排。"
  }
};

const industryFocus = {
  "汽车制造": {
    anchors: ["动力电池、钢铝材料、电子件和整车使用阶段通常是隐含碳核心。", "供应链多层级且全球化，需把一级供应商数据逐步穿透到关键原材料。"],
    extraShort: "优先锁定电池、钢材、铝材、轮胎、电子控制件等高碳 BOM 项，建立车型级 Scope 3 热点矩阵。",
    extraMid: "推进低碳铝、短流程钢、再生材料和绿色电池材料采购，同时要求电池及零部件供应商披露可再生电力比例。",
    extraLong: "围绕电池回收、梯次利用、整车能效和充电侧绿电协同，形成从采购到使用再到回收的闭环减排。"
  },
  "电子与信息技术": {
    anchors: ["半导体、显示面板、精密零部件和数据中心电力是主要热点。", "产品迭代快，供应商制程电力结构和产品能效会显著影响范围三。"],
    extraShort: "先建立芯片、屏幕、结构件、服务器/终端运输的供应商碳数据清单。",
    extraMid: "推动晶圆厂、面板厂和代工厂使用可再生电力，并把产品待机能耗和寿命纳入设计评审。",
    extraLong: "建立可维修、可回收、可升级的产品策略，降低单位功能的全生命周期排放。"
  },
  "食品饮料": {
    anchors: ["农业原料、包装材料、冷链和土地相关排放通常占比较高。", "甲烷、氧化亚氮和供应链溯源是行业数据质量难点。"],
    extraShort: "优先按原料产地、种植/养殖方式、包装材料和冷链线路拆分排放。",
    extraMid: "推进再生农业、低碳肥料、包装轻量化和冷链能效优化。",
    extraLong: "与核心农户和供应商共建低碳原料基地，形成可追溯的农产品碳数据体系。"
  },
  "建筑与地产": {
    anchors: ["钢材、水泥、玻璃、铝材和设备资本货物通常是建造阶段碳热点。", "运营期能效会影响下游资产使用和租赁相关排放。"],
    extraShort: "按项目建立建材清单，优先补齐钢材、水泥、混凝土、幕墙和机电设备因子。",
    extraMid: "导入低熟料水泥、再生钢、绿色建材认证和施工废弃物资源化。",
    extraLong: "用全生命周期碳约束牵引设计、采购、施工和运营，把项目碳预算纳入投资决策。"
  },
  "金融服务": {
    anchors: ["投资和融资组合排放通常远高于办公运营排放。", "重点在资产组合碳强度、客户转型可信度和高碳行业敞口。"],
    extraShort: "按 PCAF 方法盘点贷款、投资和项目融资排放，标记高排放行业客户。",
    extraMid: "设置行业组合碳强度目标，将客户转型计划纳入授信和投后管理。",
    extraLong: "通过转型金融、绿色债券和组合再平衡，推动资本流向真实减排项目。"
  }
};

function categoryCode(item = {}) {
  const code = String(item.code || item.title || "").match(/C\d+/);
  return code ? code[0] : "";
}

function buildNode(code, index, phase, label, detail) {
  return {
    code,
    step: String(index).padStart(2, "0"),
    phase,
    label,
    detail
  };
}

function buildReduction({ profile = {}, totals = [] }) {
  const ranked = [...totals].sort((a, b) => b.emission - a.emission);
  const top = ranked.slice(0, 3).filter(x => x.emission > 0);
  const topText = top.map(x => `${x.code} ${String(x.title || "").replace(/^类别\s*\d+\s*/, "")}`).join("、") || "暂无显著排放数据";
  const industry = profile.industry || "企业";
  const context = industryFocus[industry] || {
    anchors: [profile.traits || "企业范围三排放主要由采购、运输、能源相关活动和员工活动共同构成。", "建议优先把高支出、高排放和数据质量低的类别作为治理入口。"],
    extraShort: "先把高排放类别拆到供应商、产品、线路或场景层级，建立可追踪的数据口径。",
    extraMid: "把碳强度纳入采购、物流、差旅和资产投资决策，形成跨部门管控机制。",
    extraLong: "将供应链协同减排、产品生命周期设计和可审计数据平台纳入长期转型。"
  };
  const topLevers = top.map(item => {
    const code = categoryCode(item);
    const lever = categoryLevers[code] || categoryLevers.C1;
    return {
      code,
      title: item.title,
      emission: item.emission,
      shareSignal: item.emission > 0 ? "已形成主要排放贡献" : "暂无活动数据",
      levers: lever.levers,
      short: lever.short,
      mid: lever.mid,
      long: lever.long
    };
  });
  const defaultLever = topLevers[0] || { code: "C1", levers: categoryLevers.C1.levers, short: categoryLevers.C1.short, mid: categoryLevers.C1.mid, long: categoryLevers.C1.long };
  const nodes = [
    buildNode(defaultLever.code, 1, "短期", "热点识别", `聚焦 ${topText}，把核算颗粒度下钻到供应商、物料、线路或场景。`),
    buildNode(defaultLever.code, 2, "短期", "数据替换", defaultLever.short),
    buildNode(topLevers[1]?.code || defaultLever.code, 3, "中期", "采购与运营规则", topLevers[1]?.mid || defaultLever.mid),
    buildNode(topLevers[2]?.code || defaultLever.code, 4, "中期", "协同降碳项目", context.extraMid),
    buildNode(defaultLever.code, 5, "长期", "价值链转型", context.extraLong),
    buildNode(defaultLever.code, 6, "长期", "披露与审计", "形成可审计的数据平台，将供应商实测因子、减排项目成效和年度披露口径保持一致。")
  ];
  return {
    headline: `核心高排放环节集中在 ${topText}。结合${industry}业务特征，减排重点应从平均因子核算升级为供应商/产品/场景级管理。`,
    diagnostic: {
      industry,
      business: profile.business || "",
      anchors: context.anchors,
      topCategories: top
    },
    highEmissionLinks: top,
    pathway: [
      {
        phase: "短期措施",
        horizon: "0-12个月",
        actions: [
          context.extraShort,
          topLevers[0]?.short || categoryLevers.C1.short,
          "建立“排放量、数据质量、供应商覆盖率”三类指标，优先替换贡献最大的平均排放因子。"
        ]
      },
      {
        phase: "中期优化",
        horizon: "1-3年",
        actions: [
          topLevers[0]?.mid || categoryLevers.C1.mid,
          topLevers[1]?.mid || "推动绿色物流、包装减量、可再生电力和低碳材料替代，并对关键供应商设置年度降碳里程碑。",
          "把碳强度、数据披露质量和减排项目进度纳入采购评分、承运商 SLA 或资本开支审批。"
        ]
      },
      {
        phase: "长期转型路径",
        horizon: "3年以上",
        actions: [
          topLevers[0]?.long || categoryLevers.C1.long,
          context.extraLong,
          "建立覆盖供应商、产品生命周期和年度披露的数字化碳账本，支持第三方鉴证和目标追踪。"
        ]
      }
    ],
    nodes
  };
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === "/api/esg-jobs" && req.method === "POST") {
    const body = await readJson(req);
    const fileName = path.basename(decodeHeader(body.fileName || "uploaded-esg-report.pdf"));
    const fileSize = Number(body.fileSize || 0);
    if (!/\.pdf$/i.test(fileName)) return json(res, 400, { error: "仅支持 PDF 格式报告。" });
    if (!fileSize || fileSize > MAX_ESG_UPLOAD_BYTES) return json(res, 400, { error: "PDF超过200MB上传限制。" });
    const id = randomUUID();
    const job = {
      id,
      fileName,
      fileSize,
      status: "上传中",
      progress: 0,
      message: "等待上传。",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    jobs.set(id, job);
    return json(res, 200, { ...publicJob(job), uploadUrl: `/api/esg-jobs/${id}/upload` });
  }
  const jobUpload = url.pathname.match(/^\/api\/esg-jobs\/([^/]+)\/upload$/);
  if (jobUpload && req.method === "PUT") {
    const job = jobs.get(jobUpload[1]);
    if (!job) return json(res, 404, { error: "任务不存在。" });
    if (job.status !== "上传中") return json(res, 409, { error: "该任务已上传或正在处理。" });
    try {
      await receiveJobUpload(req, job);
      setJob(job, "上传完成", 25, "上传完成，等待服务端处理。");
      processEsgJob(job);
      return json(res, 202, publicJob(job));
    } catch (err) {
      job.error = err.message;
      setJob(job, "失败", job.progress || 0, err.message);
      return json(res, 400, { error: err.message });
    }
  }
  const jobStatus = url.pathname.match(/^\/api\/esg-jobs\/([^/]+)$/);
  if (jobStatus && req.method === "GET") {
    const job = jobs.get(jobStatus[1]);
    return job ? json(res, 200, publicJob(job)) : json(res, 404, { error: "任务不存在。" });
  }
  if (jobStatus && req.method === "DELETE") {
    const job = jobs.get(jobStatus[1]);
    if (!job) return json(res, 404, { error: "任务不存在。" });
    job.cancelled = true;
    setJob(job, "失败", job.progress || 0, "任务已取消。");
    if (job.objectPath) await fs.rm(job.objectPath, { force: true });
    return json(res, 200, publicJob(job));
  }
  if (url.pathname === "/api/factors") {
    return json(res, 200, JSON.parse(await fs.readFile(dataPath, "utf8")));
  }
  if (url.pathname === "/api/analyze" && req.method === "POST") {
    return json(res, 200, await analyzeCompany(await readJson(req)));
  }
  if (url.pathname === "/api/reduction" && req.method === "POST") {
    return json(res, 200, buildReductionShared(await readJson(req)));
  }
  if (url.pathname === "/api/esg-analyze" && req.method === "POST") {
    try {
      return json(res, 200, analyzeEsgReport(await readJson(req)));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }
  const safePath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) return json(res, 403, { error: "Forbidden" });
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(data);
  } catch {
    json(res, 404, { error: "Not found" });
  }
}

http.createServer((req, res) => {
  route(req, res).catch(err => json(res, 500, { error: err.message }));
}).listen(PORT, "127.0.0.1", () => {
  console.log(`Scope 3 calculator running at http://localhost:${PORT}`);
});
