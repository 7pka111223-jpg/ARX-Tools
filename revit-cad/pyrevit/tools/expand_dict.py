"""Expand a Hunspell .dic + .aff pair into a flat word list.

The pyRevit speller (pure Python, no C-extensions under IronPython) can't run
Hunspell affix logic at runtime, so we pre-expand the dictionary once at package
time into ``en_US.txt`` (base words + prefixed/suffixed/cross-product forms).
This dramatically cuts false positives on plurals/verb forms.

    python3 tools/expand_dict.py <index.dic> <index.aff> <out.txt>
"""

import re
import sys


def parse_affixes(aff_path):
    """Return {flag: [(kind, strip, add, cond_regex, cross)]}."""
    rules = {}
    with open(aff_path, "r", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    i = 0
    while i < len(lines):
        parts = lines[i].split()
        if len(parts) >= 4 and parts[0] in ("PFX", "SFX"):
            kind, flag, cross, count = parts[0], parts[1], parts[2] == "Y", int(parts[4 - 1])
            entries = []
            for j in range(1, count + 1):
                p = lines[i + j].split()
                # KIND flag strip add [cond]
                strip = "" if p[2] == "0" else p[2]
                add = "" if p[3] == "0" else p[3].split("/")[0]  # drop continuation flags
                cond = p[4] if len(p) > 4 else "."
                entries.append((kind, strip, add, cond, cross))
            rules.setdefault(flag, []).extend(entries)
            i += count + 1
        else:
            i += 1
    return rules


def apply_rule(word, rule):
    kind, strip, add, cond, _cross = rule
    if kind == "SFX":
        if not re.search(cond + "$", word):
            return None
        stem = word[: len(word) - len(strip)] if strip else word
        return stem + add
    else:  # PFX
        if not re.search("^" + cond, word):
            return None
        stem = word[len(strip):] if strip else word
        return add + stem


def expand(dic_path, aff_path):
    rules = parse_affixes(aff_path)
    words = set()
    with open(dic_path, "r", encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    if lines and lines[0].strip().isdigit():
        lines = lines[1:]

    for line in lines:
        line = line.strip()
        if not line:
            continue
        base, _, flagstr = line.partition("/")
        base = base.strip()
        if not base or " " in base:
            continue
        words.add(base)
        if not flagstr:
            continue

        prefix_rules, suffix_forms = [], []
        for flag in flagstr:
            for r in rules.get(flag, []):
                if r[0] == "SFX":
                    nw = apply_rule(base, r)
                    if nw:
                        words.add(nw)
                        suffix_forms.append((nw, r[4]))
                else:
                    prefix_rules.append(r)
        for r in prefix_rules:
            nw = apply_rule(base, r)
            if nw:
                words.add(nw)
            if r[4]:  # cross-product: prefix onto already-suffixed forms
                for sw, scross in suffix_forms:
                    if scross:
                        pw = apply_rule(sw, r)
                        if pw:
                            words.add(pw)
    return words


def main():
    dic, aff, out = sys.argv[1], sys.argv[2], sys.argv[3]
    words = expand(dic, aff)
    cleaned = sorted({w.lower() for w in words if re.match(r"^[a-z'\-]+$", w.lower())})
    with open(out, "w", encoding="utf-8") as fh:
        fh.write("\n".join(cleaned) + "\n")
    print("wrote %d words to %s" % (len(cleaned), out))


if __name__ == "__main__":
    main()
