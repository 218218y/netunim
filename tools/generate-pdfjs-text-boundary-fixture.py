"""Explicitly regenerate the synthetic PDF text-item boundary research fixture.

Tests only read the checked-in bytes and immutable manifest. The five rows show
a single word, touching font runs, a small gap omitted from extracted text, an
explicit extracted space and a line break. No business PDF is used.
"""
from pathlib import Path

TARGET = Path(__file__).resolve().parents[1] / 'tests/fixtures/pdf-corpus/text-boundary-runs.pdf'
STREAM = b'\n'.join([
    b'BT /F1 20 Tf 50 700 Td (alphabeta) Tj ET',
    b'BT /F1 20 Tf 50 650 Td (alpha) Tj /F2 20 Tf (beta) Tj ET',
    b'BT /F1 20 Tf 1 0 0 1 50 600 Tm (alpha) Tj /F2 20 Tf 1 0 0 1 100 600 Tm (beta) Tj ET',
    b'BT /F1 20 Tf 1 0 0 1 50 550 Tm (alpha) Tj /F2 20 Tf 1 0 0 1 105 550 Tm (beta) Tj ET',
    b'BT /F1 20 Tf 50 500 Td (alpha) Tj /F2 20 Tf 0 -30 Td (beta) Tj ET',
])


def main():
    objects = [
        b'<< /Type /Catalog /Pages 2 0 R >>',
        b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman >>',
        b'<< /Length ' + str(len(STREAM)).encode() + b' >>\nstream\n' + STREAM + b'\nendstream',
    ]
    output, offsets = bytearray(b'%PDF-1.7\n'), [0]
    for index, item in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(f'{index} 0 obj\n'.encode() + item + b'\nendobj\n')
    xref = len(output)
    output.extend(f'xref\n0 {len(objects)+1}\n0000000000 65535 f \n'.encode())
    for offset in offsets[1:]:
        output.extend(f'{offset:010} 00000 n \n'.encode())
    output.extend(f'trailer\n<< /Root 1 0 R /Size {len(objects)+1} >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    TARGET.write_bytes(output)


if __name__ == '__main__':
    main()
