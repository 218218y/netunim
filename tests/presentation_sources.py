"""Formatting-tolerant presence checks for the legacy presentation inventory.

These remain source characterization, not runtime authority proofs. Native DOM
and policy/model tests separately enforce behavior and exact financial results.
"""
import re


def presentation_contains(source, needle):
    def compact(value):
        # Adjacent untagged template pieces produce identical strings. The
        # presentation cleanup separately proves their parsed value equivalence.
        joined = re.sub(r'`\s*\+\s*`', '', value)
        return re.sub(r'\s+', '', joined).replace('return(`', 'return`')
    return compact(needle) in compact(source)
