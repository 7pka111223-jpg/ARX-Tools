"""Build a ready-to-install ZIP of the pyRevit extension.

Bundles the rule set at the extension root (so the buttons find it with no
prompt) and zips the whole ARX.extension folder, dictionary included.

    python3 tools/build_package.py
    -> dist/ARX-pyRevit-extension.zip
"""

import os
import shutil
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # revit-cad/pyrevit
EXT = os.path.join(ROOT, "ARX.extension")
DIST = os.path.join(ROOT, "dist")
OUT = os.path.join(DIST, "ARX-pyRevit-extension.zip")


def main():
    # 1) place the default rule set at the extension root (resolver finds it)
    src_rules = os.path.join(ROOT, "sample", "arx-rules.json")
    shutil.copyfile(src_rules, os.path.join(EXT, "arx-rules.json"))

    # 2) sanity: the expanded dictionary must be present
    dic = os.path.join(EXT, "lib", "arx_rulecore", "data", "en_US.txt")
    if not os.path.exists(dic):
        raise SystemExit("Missing %s — run tools/expand_dict.py first." % dic)

    # 3) zip the extension, keeping the ARX.extension/ top-level folder, skipping
    #    caches/compiled files
    os.makedirs(DIST, exist_ok=True)
    if os.path.exists(OUT):
        os.remove(OUT)
    count = 0
    with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
        for base, dirs, files in os.walk(EXT):
            dirs[:] = [d for d in dirs if d != "__pycache__"]
            for f in files:
                if f.endswith(".pyc"):
                    continue
                full = os.path.join(base, f)
                arc = os.path.join("ARX.extension", os.path.relpath(full, EXT))
                zf.write(full, arc)
                count += 1
    print("packaged %d files -> %s (%.1f MB)"
          % (count, os.path.relpath(OUT, ROOT), os.path.getsize(OUT) / 1048576.0))


if __name__ == "__main__":
    main()
