"""The subset of Pages _headers syntax used by these static applications."""
import fnmatch


def response_headers(source, pathname):
    headers = {}
    matching = False
    for line in source.splitlines():
        if not line or line.startswith('#'):
            continue
        if not line[0].isspace():
            matching = fnmatch.fnmatchcase(pathname, line)
        elif matching:
            key, value = line.strip().split(':', 1)
            # Pages joins repeated values from every matching rule.
            headers[key] = headers[key]+', '+value.strip() if key in headers else value.strip()
    return headers
