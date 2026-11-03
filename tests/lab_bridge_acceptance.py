"""Operator lab adapter for existing staged native Bridge fixtures."""
import subprocess
from browser_harness import ROOT

if __name__ == '__main__':
    files = ['bank_bridge_runtime', 'bank_origin_runtime', 'bank_origin_policy',
             'bank_shutdown_native', 'bank_artifact_shutdown_native', 'bank_image_shutdown_native']
    raise SystemExit(subprocess.call(['node', '--test', '--test-concurrency=2',
        *['tests/'+name+'.test.mjs' for name in files]], cwd=ROOT))
