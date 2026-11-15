"""Read executable script elements with the standard HTML parser, not tag regexes."""
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


def browser_js_units(html: Path, root: Path = Path(__file__).resolve().parents[1]) -> list[tuple[str, str]]:
    class Scripts(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=False)
            self.units = []
            self.attrs = None
            self.body = []
            self.index = 0

        def handle_starttag(self, tag, attrs):
            if tag == 'script':
                self.index += 1
                self.attrs = dict(attrs)
                self.body = []

        def handle_data(self, data):
            if self.attrs is not None:
                self.body.append(data)

        def handle_endtag(self, tag):
            if tag != 'script' or self.attrs is None:
                return
            attrs, body = self.attrs, ''.join(self.body)
            self.attrs = None
            typ = (attrs.get('type') or '').strip().lower()
            if typ and typ not in ('text/javascript', 'application/javascript', 'module'):
                return
            if attrs.get('src'):
                src = urlsplit(attrs['src'])
                if src.scheme or src.netloc:
                    return
                target = html.parent / src.path.lstrip('/')
                self.units.append((str(target.relative_to(root)), target.read_text(encoding='utf-8'))
                                  if target.is_file() else (f"missing:{src.path}", ''))
            elif body.strip():
                self.units.append((f'{html.relative_to(root)}:inline-{self.index}', body))

    parser = Scripts()
    parser.feed(html.read_text(encoding='utf-8'))
    parser.close()
    return parser.units
