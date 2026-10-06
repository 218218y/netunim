"""Regenerate the reviewed PDF.js annotation performance fixture explicitly.

Normal tests never run this generator; the checked-in fixture and its digest are
fixed regression inputs. The PDF uses only standard syntax and fonts.
"""
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / "tests/fixtures/pdf-corpus/many-highlights.pdf"
PAGES = 4
HIGHLIGHTS_PER_PAGE = 100


def main() -> None:
    objects: list[bytes] = []

    def add(source: bytes) -> int:
        objects.append(source)
        return len(objects)

    catalog = add(b"")
    pages = add(b"")
    font = add(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    page_refs: list[int] = []
    for page_number in range(1, PAGES + 1):
        text = f"BT /F1 12 Tf 48 740 Td (Netunim annotation benchmark page {page_number}) Tj ET\n".encode("ascii")
        content = add(b"<< /Length " + str(len(text)).encode() + b" >>\nstream\n" + text + b"endstream")
        page = add(b"")
        page_refs.append(page)
        annotations: list[int] = []
        for index in range(HIGHLIGHTS_PER_PAGE):
            x = 48 + (index % 10) * 50
            y = 700 - (index // 10) * 28
            rect = f"{x} {y} {x + 42} {y + 12}"
            quad = f"{x} {y + 12} {x + 42} {y + 12} {x} {y} {x + 42} {y}"
            annotation = (
                f"<< /Type /Annot /Subtype /Highlight /Rect [{rect}] "
                f"/QuadPoints [{quad}] /C [1 1 0] /F 4 "
                f"/Contents (Benchmark highlight {index + 1}) /P {page} 0 R >>"
            )
            annotations.append(add(annotation.encode("ascii")))
        objects[page - 1] = (
            f"<< /Type /Page /Parent {pages} 0 R /MediaBox [0 0 612 792] "
            f"/Resources << /Font << /F1 {font} 0 R >> >> /Contents {content} 0 R "
            f"/Annots [{' '.join(f'{item} 0 R' for item in annotations)}] >>"
        ).encode("ascii")
    objects[pages - 1] = (
        f"<< /Type /Pages /Count {PAGES} /Kids [{' '.join(f'{page} 0 R' for page in page_refs)}] >>"
    ).encode("ascii")
    objects[catalog - 1] = f"<< /Type /Catalog /Pages {pages} 0 R >>".encode("ascii")

    output = bytearray(b"%PDF-1.7\n")
    offsets = [0]
    for number, source in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f"{number} 0 obj\n".encode("ascii"))
        output.extend(source)
        output.extend(b"\nendobj\n")
    xref = len(output)
    output.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode("ascii"))
    for offset in offsets[1:]:
        output.extend(f"{offset:010} 00000 n \n".encode("ascii"))
    output.extend(
        f"trailer\n<< /Size {len(objects) + 1} /Root {catalog} 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode("ascii")
    )
    TARGET.write_bytes(output)


if __name__ == "__main__":
    main()
