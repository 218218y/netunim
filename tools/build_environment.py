"""Use the checked-in staging identity when verifying final release artifacts."""
import json
from pathlib import Path
import re
from build_validation import require

ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_PROJECT = 'bupoidcurcxuypfrjqio'

def environment_headers(source, environment):
    require(environment in ('production', 'staging'), 'Unknown build environment')
    if environment == 'production':
        return source
    config = json.loads((ROOT/'config/staging-supabase.json').read_text(encoding='utf-8'))
    require(re.fullmatch(r'https://[a-z]{20}\.supabase\.co', config['url']) and PRODUCTION_PROJECT not in config['url'], 'Invalid staging backend')
    return source.replace(PRODUCTION_PROJECT+'.supabase.co', config['url'].removeprefix('https://'))
