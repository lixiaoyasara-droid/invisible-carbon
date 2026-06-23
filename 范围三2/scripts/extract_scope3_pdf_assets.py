from pathlib import Path

from pdf2image import convert_from_path

PDF = Path("/Users/lixiaoya/Desktop/AI大赛/Scope3_Calculation_Guidance_0.pdf")
OUT = Path(__file__).resolve().parents[1] / "public" / "assets" / "scope3-guidance"
POPPLER = Path("/Users/lixiaoya/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin")

PAGES = {
    6: "page-06-value-chain-overview.png",
    21: "page-21-category1-methods.png",
    23: "page-23-category1-decision-tree.png",
    43: "page-43-category3-energy-factors.png",
    78: "page-78-waste-recycling-boundary.png",
    103: "page-103-transport-boundary.png",
}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for page, filename in PAGES.items():
        image = convert_from_path(
            PDF,
            first_page=page,
            last_page=page,
            dpi=180,
            poppler_path=str(POPPLER),
        )[0]
        target = OUT / filename
        image.save(target, "PNG", optimize=True)
        print(target)


if __name__ == "__main__":
    main()
