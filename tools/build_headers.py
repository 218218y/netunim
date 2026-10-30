"""Cloudflare merges matching header rules; cache policies must not overlap."""
import re
from build_validation import require


def production_headers(source, names, release=None):
    source = source.replace('\r\n', '\n').replace('\r', '\n')
    # Keep every security directive verbatim. Narrow the source global cache
    # policy to mutable paths so it cannot join the hashed immutable policy.
    rules = [line for line in source.splitlines() if line and not line[0].isspace() and not line.startswith('#')]
    require(rules == ['/*'], 'Review additional source header rules before building')
    policies = re.findall(r'^  Cache-Control: ([^\n]+)$', source, flags=re.M)
    require(policies == ['no-cache'], 'Expected one reviewed global no-cache policy')
    source = re.sub(r'^  Cache-Control: [^\n]+\n?', '', source, flags=re.M)
    if release is not None:
        source, count = re.subn(r'^  X-Netunim-Release: [^\n]+', '  X-Netunim-Release: '+release, source, flags=re.M)
        require(count == 1, 'Expected one global release header')
    mutable = {'/'} | {'/' + name for name in names
                      if name != '_headers' and not name.startswith(('assets/build/', 'assets/vendor/'))}
    # Pages redirects *.html to extensionless URLs. Those URLs serve mutable
    # HTML too; an exact rule for only the filename would miss the canonical URL.
    mutable.update('/' + name[:-5] for name in names if name.endswith('.html'))
    require(1 + len(mutable) + 2 <= 100, 'Cloudflare header rule limit exceeded')
    return source.rstrip() + '\n' + ''.join('\n'+name+'\n  Cache-Control: no-cache\n' for name in sorted(mutable)) + (
        '\n/assets/vendor/*\n  Cache-Control: no-cache\n'
        '\n/assets/build/*\n  Cache-Control: public, max-age=31536000, immutable\n')
