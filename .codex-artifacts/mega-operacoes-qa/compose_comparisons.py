from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(r"C:\Users\Usuário\OneDrive\Desktop\Sistema Operante - Aero Festas")
SOURCE = ROOT / ".codex-artifacts" / "mega-operacoes-source"
QA = ROOT / ".codex-artifacts" / "mega-operacoes-qa"


def pair(source_name: str, implementation_name: str, output_name: str) -> None:
    source = Image.open(SOURCE / source_name).convert("RGB")
    implementation = Image.open(QA / implementation_name).convert("RGB")

    target_height = max(source.height, implementation.height)
    if source.height != target_height:
        source = source.resize((round(source.width * target_height / source.height), target_height))
    if implementation.height != target_height:
        implementation = implementation.resize(
            (round(implementation.width * target_height / implementation.height), target_height)
        )

    header_height = 56
    gutter = 24
    canvas = Image.new(
        "RGB",
        (source.width + gutter + implementation.width, header_height + target_height),
        "#111d31",
    )
    canvas.paste(source, (0, header_height))
    canvas.paste(implementation, (source.width + gutter, header_height))

    draw = ImageDraw.Draw(canvas)
    draw.text((18, 19), "REFERENCIA", fill="white")
    draw.text((source.width + gutter + 18, 19), "IMPLEMENTACAO", fill="white")
    canvas.save(QA / output_name, quality=95)


pair("source-desktop-correct-01.png", "implementation-desktop-top-v2.png", "comparison-desktop-top-v2.png")
pair("source-desktop-correct-03.png", "implementation-desktop-step-03-v2.png", "comparison-desktop-products-v2.png")
pair("source-desktop-correct-07.png", "implementation-desktop-step-07-v2.png", "comparison-desktop-cta-v2.png")
pair("source-mobile-correct-01.png", "implementation-mobile-top-v2.png", "comparison-mobile-top-v2.png")
