import hashlib, json, re, unicodedata
from html import unescape
from pathlib import Path
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
raw = ROOT / "preview.local/cet-sources"
sources = []
manifest = json.loads((ROOT / "content-sources/frequency-sources.json").read_text(encoding="utf-8"))
documents = {source["id"]: source["documents"] for source in manifest["sources"]}
downloads = {key: docs[0] for key, docs in documents.items()}
for docs in documents.values():
    for doc in docs:
        file = raw / doc["file"]
        if hashlib.sha256(file.read_bytes()).hexdigest() != doc["sha256"]:
            raise ValueError(f"Source checksum mismatch: {file}")

def normal(word):
    word = unicodedata.normalize("NFKC", word).lower().replace("’", "'")
    if "/-" in word:
        first, suffix = word.split("/-")
        return [first, first[:-len(suffix)] + suffix]
    values = []
    for part in word.split("/"):
        if "(" in part:
            values.extend([re.sub(r"\([^)]*\)", "", part), part.replace("(", "").replace(")", "")])
        else: values.append(part)
    return list(dict.fromkeys(values))

def paragraphs(file):
    text = file.read_text(encoding="utf-8")
    return [unescape(re.sub("<[^>]+>", "", p)).strip() for p in re.findall(r"<p(?: [^>]*)?>(.*?)</p>", text, re.S)]

def add(id, bank, title, url, note, documents, rows):
    sources.append(dict(id=id, bank=bank, title=title, url=url, note=note, retrievedAt="2026-10-20", documents=documents, entries=rows))

pages = [page.extract_text() for page in PdfReader(raw / "nju-cet4.pdf").pages]
rows = []
for i in range(25,40):
    for line in pages[i].splitlines():
        m = re.match(r"^([A-Za-z][A-Za-z'-]*)\s+[\u4e00-\u9fff（〈]", line.strip())
        if m and m[1] not in ("A", "B"): rows.append(dict(word=m[1].lower(), page=i+1, tier="A" if i<30 else "B"))
add("nju-cet4", "cet4", "南京大学大学英语通用词汇 A / B 级", downloads["nju-cet4"]["url"],
    "A 级为四级高频词、学术词；B 级为四级次高频词。仅采用表中主词，不展开派生词。", [downloads["nju-cet4"]], rows)

pages = [page.extract_text() for page in PdfReader(raw / "ynau-cet6.pdf").pages]
rows = []
for i,text in enumerate(pages):
    for line in text.splitlines():
        m = re.match(r"^(\d+)\s+([A-Za-z][A-Za-z'-]*)\s+[\[(/]", line.strip())
        if m: rows.append(dict(word=m[2].lower(), page=i+1, row=int(m[1])))
add("ynau-cet6", "cet6", "云南农业大学公开资料：六级高频词汇 1500 词", downloads["ynau-cet6"]["url"],
    "高校网站公开备考资料，原编者与考频统计年份未注明；按词表收录比对，不采用标题数字作实收数量。", [downloads["ynau-cet6"]], rows)

docs = documents["xdf-cet6"]
rows = []
for doc in docs:
    active = False
    for p in paragraphs(raw/doc["file"]):
        if re.fullmatch(r"英语六级高频词汇：List \d+", p): active=True; continue
        if active and p == "2019年6月大学英语六级高频词汇大全": break
        if not active: continue
        m = re.match(r"^([A-Za-z][A-Za-z/()'-]*)", p)
        if m:
            for word in normal(m[1]): rows.append(dict(word=word, url=doc["url"]))
add("xdf-cet6", "cet6", "新东方在线：六级高频词汇 List 1–56（2019）", "https://cet6.koolearn.com/20190530/827662.html",
    "栏目注明来源为网络，未公开真题语料及频次；56 篇作为一个渠道，不重复计票。", docs, rows)

docs = documents["xdf-cet4"]
rows = []
for doc in docs:
    for p in paragraphs(raw/doc["file"]):
        m = re.match(r"^(\d+)\.\s*([A-Za-z][A-Za-z'-]*)\s+(?:[anv]|adj|ad|vt|vi|n)\b", p)
        if m: rows.append(dict(word=m[2].lower(), row=int(m[1]), url=doc["url"]))
add("xdf-cet4", "cet4", "新东方在线：10 天突破四级高频词汇（2014）", docs[0]["url"],
    "栏目注明来源为网络；保留实际可提取的单词，短语和未列出的序号不补造。10 篇作为一个渠道。", docs, rows)

out = ROOT / "content-sources/frequency-sources.json"
out.write_text(json.dumps({"rule":"同级别至少两个渠道收录，再与本项目题库词条匹配；同站系列与重复转载不增加票数。不是官方真题考频排名。","sources":sources},ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
for s in sources:
    print(s["id"],len(s["entries"]),len(set(e["word"] for e in s["entries"])))
