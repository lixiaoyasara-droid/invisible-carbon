#!/usr/bin/env python3
import json
import re
import sys

import contextlib
import io
import pdfplumber
from pypdf import PdfReader


BATCH_SIZE = 8
MAX_TEXT_CHARS = 1_500_000
KEYWORDS = [
    "scope 3", "scope iii", "scope three", "ghg protocol category", "scope 3 category",
    "purchased goods", "capital goods", "fuel- and energy-related", "upstream transportation",
    "waste generated", "business travel", "employee commuting", "leased assets",
    "downstream transportation", "processing of sold products", "use of sold products",
    "end-of-life", "franchises", "investments", "scope 3 emissions",
    "范围三", "范畴三", "範圍三", "範疇三", "类别", "類別", "外购", "外購",
    "资本品", "資本品", "商务旅行", "商務旅行", "员工通勤", "員工通勤",
    "上游运输", "上游運輸", "下游运输", "下游運輸", "租赁资产", "租賃資產",
    "售出产品", "售出產品", "寿命终止", "壽命終止", "特许经营", "特許經營",
    "投资", "投資", "范围三排放", "範圍三排放", "范围三温室气体", "範圍三溫室氣體",
    "温室气体范围三", "溫室氣體範圍三",
]


def compact(text):
    return re.sub(r"\s+", " ", text or "").strip()


def relevant(text):
    lowered = text.lower()
    scope_terms = ["scope 3", "scope iii", "scope three", "范围三", "范畴三", "範圍三", "範疇三", "温室气体范围三", "溫室氣體範圍三"]
    appendix_terms = ["附录", "附錄", "esg数据", "esg數據", "绩效数据", "績效數據", "关键绩效", "關鍵績效", "温室气体排放", "溫室氣體排放", "greenhouse gas emissions"]
    category_terms = [
        "scope 3 category", "ghg protocol category", "类别", "類別", "外购", "外購", "资本品", "資本品",
        "商务旅行", "商務旅行", "员工通勤", "員工通勤", "上游运输", "上游運輸", "下游运输", "下游運輸",
        "售出产品", "售出產品", "寿命终止", "壽命終止", "特许经营", "特許經營", "投资", "投資",
        "purchased goods", "capital goods", "business travel", "employee commuting", "end-of-life", "franchises", "investments",
    ]
    emission_terms = ["emission", "ghg", "排放", "温室气体", "溫室氣體", "co2", "co₂", "二氧化碳"]
    if any(item.lower() in lowered for item in scope_terms):
        return True
    if any(item.lower() in lowered for item in appendix_terms) and any(item.lower() in lowered for item in emission_terms):
        return True
    return any(item.lower() in lowered for item in category_terms) and any(item.lower() in lowered for item in emission_terms)


def classify_pdf(page_texts):
    text_pages = sum(1 for item in page_texts if compact(item))
    if text_pages == 0:
        return "scanned"
    if text_pages < len(page_texts):
        return "mixed"
    return "native_text"


def extract_tables(path, relevant_page_numbers):
    tables = []
    with pdfplumber.open(path) as pdf:
        for page_no in relevant_page_numbers:
            if page_no < 1 or page_no > len(pdf.pages):
                continue
            page = pdf.pages[page_no - 1]
            try:
                for table in page.extract_tables() or []:
                    rows = [[compact(cell) for cell in row] for row in table if row]
                    flat = " ".join(" ".join(row) for row in rows)
                    if rows and relevant(flat):
                        tables.append({"page": page_no, "rows": rows[:80]})
            except Exception:
                continue
    return tables[:40]


def page_text_with_layout(pdf, reader, index):
    texts = []
    try:
        texts.append(compact(reader.pages[index].extract_text() or ""))
    except Exception:
        pass
    try:
        page = pdf.pages[index]
        texts.append(compact(page.extract_text(layout=True, x_tolerance=2, y_tolerance=3) or ""))
        words = page.extract_words(use_text_flow=True, keep_blank_chars=False) or []
        if words:
            lines = {}
            for word in words:
                key = round(float(word.get("top", 0)) / 4)
                lines.setdefault(key, []).append(word)
            ordered = []
            for key in sorted(lines):
                ordered.append(" ".join(w["text"] for w in sorted(lines[key], key=lambda x: float(x.get("x0", 0)))))
            texts.append(compact("\n".join(ordered)))
    except Exception:
        pass
    return max(texts, key=len) if texts else ""


def main():
    if len(sys.argv) < 2:
        raise SystemExit("缺少PDF文件路径。")

    path = sys.argv[1]
    reader = PdfReader(path, strict=False)
    metadata = {str(k).lstrip("/"): compact(str(v)) for k, v in (reader.metadata or {}).items() if v}
    page_texts = []
    relevant_pages = set()
    first_pass_relevant = set()
    selected = []
    no_text_pages = []
    batches = 0

    with pdfplumber.open(path) as pdf:
        for start in range(0, len(reader.pages), BATCH_SIZE):
            batches += 1
            end = min(start + BATCH_SIZE, len(reader.pages))
            for index in range(start, end):
                with contextlib.redirect_stderr(io.StringIO()):
                    text = page_text_with_layout(pdf, reader, index)
                page_texts.append(text)
                page_no = index + 1
                is_relevant = relevant(text)
                if not text:
                    no_text_pages.append(page_no)
                if is_relevant:
                    first_pass_relevant.add(page_no)
                    relevant_pages.update([p for p in (page_no - 1, page_no, page_no + 1) if 1 <= p <= len(reader.pages)])

    pdf_type = classify_pdf(page_texts)
    front_matter = "\n".join(f"[Page {i + 1}]\n{page_texts[i]}" for i in range(min(3, len(page_texts))))
    candidate_ocr_pages = sorted(set(no_text_pages).intersection(relevant_pages))
    selected_pages = sorted(relevant_pages)
    for page_no in selected_pages:
        text = page_texts[page_no - 1] if page_no - 1 < len(page_texts) else ""
        selected.append(f"\n[Page {page_no}]\n{text}")
        if sum(len(item) for item in selected) >= MAX_TEXT_CHARS:
            break
    tables = extract_tables(path, sorted(relevant_pages)[:80])
    text = "\n".join(selected)[:MAX_TEXT_CHARS]
    markdown = text

    warning = ""
    if pdf_type == "scanned":
        warning = "该PDF疑似扫描版，需要按页分批OCR；当前处理器未对整份PDF执行OCR。"
    elif candidate_ocr_pages:
        warning = f"检测到 {len(candidate_ocr_pages)} 个相关扫描页需要OCR。"

    print(json.dumps({
        "pdfType": pdf_type,
        "pages": len(reader.pages),
        "batches": batches,
        "relevantPages": sorted(relevant_pages),
        "candidateOcrPages": candidate_ocr_pages[:120],
        "text": text,
        "frontMatter": front_matter[:120000],
        "metadata": metadata,
        "markdown": markdown,
        "tables": tables,
        "warning": warning
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
