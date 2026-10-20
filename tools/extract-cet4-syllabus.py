import argparse, csv, hashlib, json, re, unicodedata
from pathlib import Path
import pdfplumber

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--pdf", type=Path, required=True)
parser.add_argument("--dictionary", type=Path, required=True)
args = parser.parse_args()
assert hashlib.sha256(args.pdf.read_bytes()).hexdigest() == "9166d3c03b7bc43abd9d9df91bd2ef8085b4419286f1e5ca100dea68f3cfd1f1"

special = {
    "accordingto": ["according to"],
    "oughtto": ["ought to"],
    "Celsius/-cius": ["Celsius"],
    "center/-tre": ["center", "centre"],
    "centimeter/-tre": ["centimeter", "centimetre"],
    "fiber/-bre": ["fiber", "fibre"],
    "kilometer/-tre": ["kilometer", "kilometre"],
    "license/-ce": ["license", "licence"],
    "liter/-tre": ["liter", "litre"],
    "meter/-tre": ["meter", "metre"],
    "millimeter/-tre": ["millimeter", "millimetre"],
    "practise/-ice": ["practise", "practice"],
    "theater/-tre": ["theater", "theatre"],
}
def forms(raw):
    clean = re.sub(r"\d", "", raw).replace("G", "-").replace("\U001001b3", "'")
    if clean in special: return special[clean]
    if "/-" in clean:
        first, suffix = clean.split("/-")
        return [first, first[:-len(suffix)] + suffix]
    result = []
    for part in clean.split("/"):
        if "(" in part:
            result += [re.sub(r"\([^)]*\)", "", part), part.replace("(", "").replace(")", "")]
        else:
            result.append(part)
    return list(dict.fromkeys(result))

rows = []
with pdfplumber.open(args.pdf) as pdf:
    for i in range(20, 149):
        words = pdf.pages[i].extract_words(x_tolerance=1, y_tolerance=3)
        heads = [w for w in words if 70 < w["top"] < 699 and 80 < w["x0"] < 90 and re.search("[A-Za-z]", w["text"])]
        for w in heads:
            rest = [c for c in words if 0.1 < c["x0"] - w["x0"] < 78 and abs(c["top"] - w["top"]) < 3]
            raw = unicodedata.normalize("NFKC", w["text"] + "".join(" " + c["text"] for c in rest))
            starred = any(c["text"] == "★" and abs(c["top"] - w["top"] - 7.336) < 3 for c in words)
            rows.append({"raw": raw, "bank": "cet6" if starred else "cet4", "pdfPage": i + 1})
assert sum(r["bank"] == "cet6" for r in rows) == 1263
entries = {}
for row in rows:
    if row["bank"] != "cet4": continue
    for word in forms(row["raw"]):
        assert re.fullmatch(r"[A-Za-zé][A-Za-zé' .-]*", word), row
        key = word.lower()
        entry = entries.setdefault(key, {"word": word, "accepts": [word], "pdfPages": [], "syllabusForms": []})
        if row["pdfPage"] not in entry["pdfPages"]: entry["pdfPages"].append(row["pdfPage"])
        if row["raw"] not in entry["syllabusForms"]: entry["syllabusForms"].append(row["raw"])
dictionary = {}
with args.dictionary.open(encoding="utf-8-sig", newline="") as stream:
    for row in csv.DictReader(stream):
        key = row["word"].lower()
        if key in entries and (key not in dictionary or row["word"] == entries[key]["word"]):
            dictionary[key] = row
missing = []
for key, entry in entries.items():
    match = dictionary.get(key)
    if not match or not match["translation"]: missing.append(entry["word"])
    entry["dictionaryTranslation"] = (match or {}).get("translation", "").replace("\\n", "\n")
    entry["phonetic"] = (match or {}).get("phonetic", "")
out = ROOT / "content-sources/cet4-syllabus-entries.json"
out.write_text(json.dumps(list(entries.values()), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
(ROOT / "content-sources/syllabus-primary-rows.json").write_text(json.dumps(rows, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"primaryRows": len(rows), "cet4Rows": sum(r["bank"] == "cet4" for r in rows), "cet4Spellings": len(entries), "missing": missing}, ensure_ascii=False))
