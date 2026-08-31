from pathlib import Path

from PIL import Image, ImageDraw, ImageOps


ROOT = Path(r"C:\Users\USURIO~1\OneDrive\Desktop\SISTEM~2")
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
    draw.text((18, 19), "FOTO FORNECIDA", fill="white")
    draw.text((left.width + gap + 18, 19), "CARD IMPLEMENTADO", fill="white")
    canvas.save(QA / output, quality=95)


target_size = (720, 522)
lobinho_source = ImageOps.fit(
    Image.open(SOURCE / "source-lobinho-v2.jpg").convert("RGB"),
    target_size,
    method=Image.Resampling.LANCZOS,
    centering=(0.5, 0.5),
)
lobinho_card = Image.open(QA / "implementation-mobile-lobinho-v7d.png").convert("RGB")
lobinho_implementation = ImageOps.fit(
    lobinho_card.crop((20, 364, 341, 604)),
    target_size,
    method=Image.Resampling.LANCZOS,
    centering=(0.5, 0.5),
)
compare(lobinho_source, lobinho_implementation, "comparison-lobinho-focus-v7.png")
