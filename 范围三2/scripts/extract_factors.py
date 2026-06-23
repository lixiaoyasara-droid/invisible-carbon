import json
import re
from pathlib import Path

import openpyxl

SOURCE = Path("/Users/lixiaoya/Desktop/AI大赛/排放因子1.xlsx")
OUT = Path(__file__).resolve().parents[1] / "data" / "emission-factors.json"


GHG_META = {
    "C1": ("类别 1 外购商品和服务", "核算报告年度购买或取得的商品及服务在上游生产阶段产生的排放。", "活动数据 x 排放因子 x 单位换算系数"),
    "C2": ("类别 2 资本货物", "核算购买或取得的资本性设备、建筑、机器等在生产阶段产生的排放。", "资本性支出或实物活动数据 x 排放因子"),
    "C3": ("类别 3 燃料和能源相关活动", "核算未纳入范围一、范围二的燃料和能源上游排放。", "能源活动数据 x 上游排放因子"),
    "C4": ("类别 4 上游运输和配送", "核算由第三方提供、与采购相关的上游物流和配送排放。", "货运量或支出 x 运输排放因子"),
    "C5": ("类别 5 运营中产生的废弃物", "核算企业运营产生废弃物在处置和处理阶段的排放。", "废弃物重量 x 处置方式排放因子"),
    "C6": ("类别 6 商务差旅", "核算员工商务出行、住宿等活动产生的排放。", "差旅支出或里程 x 对应排放因子"),
    "C7": ("类别 7 员工通勤", "核算员工日常通勤产生的排放。", "人数或通勤活动数据 x 通勤排放因子"),
    "C13": ("类别 13 下游租赁资产", "核算出租资产运营但未纳入范围一、二的排放。", "出租资产活动数据 x 排放因子"),
    "C15": ("类别 15 投资", "核算投资组合、贷款或项目融资对应的被投企业排放。", "投资额或持股比例 x 被投企业排放强度"),
}

CALCULATOR_CODES = ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C13", "C15"]


def normalize_code(text):
    m = re.search(r"类别\s*(\d+)", str(text or ""))
    if not m:
        return None
    return f"C{int(m.group(1))}"


def clean(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def column_map(header):
    labels = [clean(x).lower() for x in header]
    result = {"name": 1, "unit": 2, "factor": 3, "source": 4}
    for idx, label in enumerate(labels):
        if idx == 0:
            continue
        if "来源" in label or "source" in label:
            result["source"] = idx
        elif "单位" in label or "unit" in label:
            result["unit"] = idx
        elif "排放因子" in label or "emission factor" in label:
            result["factor"] = idx
    return result


def currency_from_unit(unit):
    value = clean(unit).lower()
    if "rmb" in value or "人民币" in value:
        return "RMB"
    if "usd" in value or "dollar" in value or "美元" in value:
        return "USD"
    if "gbp" in value or "pound" in value or "英镑" in value:
        return "GBP"
    return ""


C6_ZH_NAMES = {
    "Scheduled Passenger Air Transportation": "航空客运",
    "Taxi Service": "出租车",
    "Commuter Rail Systems": "通勤铁路",
    "Hotels (except Casino Hotels) and Motels": "酒店住宿",
}


def normalize_c5_treatment(name, waste_type):
    if "能量" in name:
        return "焚烧（含能量回收）"
    if "焚烧" in name:
        return "焚烧"
    if "回收" in name:
        return "回收"
    if "污泥" in name:
        return "污泥填埋"
    if "填埋" in name:
        return "污泥填埋" if waste_type == "有害废物" else "填埋"
    return name


def main():
    wb = openpyxl.load_workbook(SOURCE, data_only=True)
    ws = wb.active
    groups = {}
    current = None
    columns = {"name": 1, "unit": 2, "factor": 3, "source": 4}
    c5_waste_type = "一般废物"
    for raw in ws.iter_rows(min_row=1, values_only=True):
        code = normalize_code(raw[0])
        if code:
            current = code
            groups.setdefault(code, {"items": []})
            columns = column_map(raw)
            c5_waste_type = "一般废物"
            continue
        if current not in CALCULATOR_CODES:
            continue
        name_value = raw[columns["name"]] if columns["name"] < len(raw) else None
        factor_value = raw[columns["factor"]] if columns["factor"] < len(raw) else None
        unit_value = raw[columns["unit"]] if columns["unit"] < len(raw) else None
        source_value = raw[columns["source"]] if columns["source"] < len(raw) else None
        if not current or not name_value or factor_value in (None, ""):
            continue
        name = clean(name_value)
        if current == "C5" and name == "有害废物分类":
            c5_waste_type = "有害废物"
            continue
        if name in {"类别", "行业类别", "类型", "排放因子", "单位", "燃料种类", "运输方式", "固体废物分类", "交通方式", "能源使用类别", "投资行业类型"}:
            continue
        try:
            factor = float(factor_value)
        except (TypeError, ValueError):
            continue
        if current == "C6":
            name = C6_ZH_NAMES.get(name, name)
        item = {
            "name": name,
            "unit": clean(unit_value),
            "factor": factor,
            "source": clean(source_value),
            "currency": currency_from_unit(unit_value),
        }
        if current == "C5":
            treatment = normalize_c5_treatment(name, c5_waste_type)
            item.update({
                "wasteType": c5_waste_type,
                "treatment": treatment,
                "name": f"{c5_waste_type} - {treatment}",
            })
        groups.setdefault(current, {"items": []})["items"].append(item)

    categories = []
    for code in CALCULATOR_CODES:
        title, definition, formula = GHG_META[code]
        items = groups.get(code, {}).get("items", [])
        sources = []
        for item in items:
            if item.get("source") and item["source"] not in sources:
                sources.append(item["source"])
        categories.append({
            "code": code,
            "title": title,
            "definition": definition,
            "formula": formula,
            "sourceNote": "；".join(sources),
            "items": items,
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({
        "generatedFrom": str(SOURCE),
        "factorDate": "附件未标注发布日期",
        "categories": categories,
    }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {OUT}")
    print({c["code"]: len(c["items"]) for c in categories})


if __name__ == "__main__":
    main()
