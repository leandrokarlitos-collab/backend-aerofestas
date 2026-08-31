from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(r"C:\Users\Usuário\OneDrive\Desktop\Sistema Operante - Aero Festas")
SOURCE = ROOT / ".codex-artifacts" / "mega-operacoes-source"
QA = ROOT / ".codex-artifacts" / "mega-operacoes-qa"


def compare(left: Image.Image, right: Image.Image, output: str) -> None:
    left = left.convert("RGB")
    right = right.convert("RGB")
    height = max(left.height, right.height)
    if left.height != height:
        left = left.resize((round(left.width * height / left.height), height), Image.Resampling.LANCZOS)
    if right.height != height:
        right = right.resize((round(right.width * height / right.height), height), Image.Resampling.LANCZOS)
    header = 56
    gap = 24
    canvas = Image.new("RGB", (left.width + gap + right.width, height + header), "#111d31")
    canvas.paste(left, (0, header))
    canvas.paste(right, (left.width + gap, header))
    draw = ImageDraw.Draw(canvas)
    draw.text((18, 19), "REFERENCIA", fill="white")
    draw.text((left.width + gap + 18, 19), "IMPLEMENTACAO", fill="white")
    canvas.save(QA / output, quality=95)


compare(
    Image.open(SOURCE / "source-mobile-correct-01.png"),
    Image.open(QA / "implementation-mobile-top-v5.png"),
    "comparison-mobile-top-v5.png",
)

compare(
    Image.open(SOURCE / "source-desktop-correct-03.png"),
    Image.open(QA / "implementation-desktop-jurassic-up-v5.png"),
    "comparison-desktop-products-v5.png",
)

jurassic_source = ImageOps.fit(
    Image.open(SOURCE / "source-jurassic-v2.png").convert("RGB"),
    (640, 480),
    method=Image.Resampling.LANCZOS,
    centering=(0.5, 0.64),
)
jurassic_implementation = Image.open(QA / "implementation-mobile-jurassic-up-v5.png").crop((20, 78, 340, 323))
jurassic_implementation = jurassic_implementation.resize((640, 480), Image.Resampling.LANCZOS)
compare(jurassic_source, jurassic_implementation, "comparison-jurassic-focus-v5.png")

lobinho_source = Image.open(SOURCE / "source-lobinho-spec.png")
lobinho_implementation = Image.open(QA / "implementation-mobile-lobinho-v5.png").crop((20, 54, 340, 291))
compare(lobinho_source, lobinho_implementation, "comparison-lobinho-focus-v5.png")
