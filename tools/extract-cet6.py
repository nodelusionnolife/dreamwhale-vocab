import argparse
import csv
import hashlib
import json
import re
import unicodedata
from pathlib import Path

from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--pdf", type=Path, required=True)
parser.add_argument("--dictionary", type=Path, required=True)
args = parser.parse_args()
expected = "9166d3c03b7bc43abd9d9df91bd2ef8085b4419286f1e5ca100dea68f3cfd1f1"
assert hashlib.sha256(args.pdf.read_bytes()).hexdigest() == expected, "Unexpected syllabus edition"

variants = {
    "appal(l)": ["appal", "appall"],
    "armo(u)r": ["armor", "armour"],
    "cozy/Gsy": ["cozy", "cosy"],
    "dispatch/despatch": ["dispatch", "despatch"],
    "distil(l)": ["distil", "distill"],
    "encyclop(a)edia": ["encyclopedia", "encyclopaedia"],
    "endeavo(u)r": ["endeavor", "endeavour"],
    "esthetic/aesthetic": ["aesthetic", "esthetic"],
    "aesthetic": ["aesthetic", "esthetic"],
    "glamo(u)r": ["glamor", "glamour"],
    "jeopardize/Gise": ["jeopardize", "jeopardise"],
    "maneuver/manoeuvre": ["maneuver", "manoeuvre"],
    "mobilize/Gise": ["mobilize", "mobilise"],
    "paralyze/Gyse": ["paralyze", "paralyse"],
    "rigo(u)r": ["rigor", "rigour"],
    "skeptical/sceptical": ["skeptical", "sceptical"],
    "sober/Gre": ["sober"],
    "specialty/speciality": ["specialty", "speciality"],
    "steward(ess)": ["steward", "stewardess"],
    "sulfur/sulphur": ["sulfur", "sulphur"],
}
entries = {}
starred_rows = 0
for index, page in enumerate(PdfReader(args.pdf).pages[20:149], 20):
    text = unicodedata.normalize("NFKC", page.extract_text())
    for line in text.splitlines():
        if not line.strip().startswith("★"):
            continue
        starred_rows += 1
        raw = line.strip().removeprefix("★").strip().split()[0]
        forms = variants.get(raw, [raw])
        word = forms[0]
        assert re.fullmatch(r"[A-Za-zé]+", word), raw
        if word not in entries:
            entries[word] = {"word": word, "accepts": forms, "pdfPages": [], "syllabusForms": []}
        entries[word]["pdfPages"].append(index + 1)
        entries[word]["syllabusForms"].append(raw.replace("G", "-"))
assert starred_rows == 1263 and len(entries) == 1262

wanted = {form.lower() for e in entries.values() for form in e["accepts"]}
dictionary = {}
with args.dictionary.open(encoding="utf-8-sig", newline="") as stream:
    for row in csv.DictReader(stream):
        key = row["word"].lower()
        if key in wanted:
            dictionary[key] = row
missing = []
for word, entry in entries.items():
    match = next((dictionary[form.lower()] for form in entry["accepts"] if form.lower() in dictionary), None)
    if not match or not match["translation"]:
        missing.append(word)
    else:
        entry["dictionaryTranslation"] = match["translation"].replace("\\n", "\n")
        entry["phonetic"] = match["phonetic"]
print(json.dumps({"starredRows": starred_rows, "entries": len(entries), "missing": missing}, ensure_ascii=False))
out = ROOT / "preview.local/cet-sources/cet6-extracted.json"
out.write_text(json.dumps(list(entries.values()), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
