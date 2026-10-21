"""Read-only, privacy-reduced inventory of the Owner's LAB templates."""
import csv
import hashlib
import io
import json
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else "C:/Users/User/Downloads")
for name in ["Final New_Task_List_1-3.xlsx", "NIPT_CBH_Final_Combined_Master_2026-10-15.xlsx", "NIFTY_Test_Request_FormHNZ_filled.xlsx"]:
    data = (ROOT / name).read_bytes()
    archive = zipfile.ZipFile(io.BytesIO(data))
    strings = []
    if "xl/sharedStrings.xml" in archive.namelist():
        strings = ["".join(e.itertext()) for e in ET.fromstring(archive.read("xl/sharedStrings.xml"))]
    sheets = [s.get("name") for s in ET.fromstring(archive.read("xl/workbook.xml")).find("s:sheets", NS)]
    print(json.dumps({"file": name, "sha256": hashlib.sha256(data).hexdigest(), "sheets": sheets}, ensure_ascii=False))
    def value(cell):
        v = cell.find("s:v", NS)
        if cell.get("t") == "s" and v is not None:
            return strings[int(v.text)]
        if cell.get("t") == "inlineStr":
            return "".join(cell.find("s:is", NS).itertext())
        return v.text if v is not None else ""
    for index, name in enumerate(sheets, 1):
        sheet = ET.fromstring(archive.read(f"xl/worksheets/sheet{index}.xml"))
        cells = sheet.findall(".//s:c", NS)
        formulas = {c.get("r"): c.find("s:f", NS).text for c in cells if c.find("s:f", NS) is not None}
        result = {"sheet": name, "dimension": sheet.find("s:dimension", NS).get("ref"), "formulas": formulas}
        if name.startswith("Ext."):
            result["mapped"] = {c.get("r"): value(c) for c in cells if c.get("r") in ["A4", "B4", "B5", "K5", "B8", "H8", "B15", "H15", "B16", "B17"]}
        if len(sheets) == 1:
            rows = sheet.findall(".//s:row", NS)
            result["rowCount"] = len(rows)
            result["headers"] = {c.get("r"): value(c) for c in rows[0]}
            result["controlRows"] = [{c.get("r"): value(c) for c in row if ''.join(filter(str.isalpha, c.get("r"))) in ["B", "C", "D", "I", "K", "P", "Z"]} for row in rows if any("ontrol" in str(value(c)) for c in row)]
        print(json.dumps(result, ensure_ascii=False))
data = (ROOT / "Pooling Sheet Template_R001.csv").read_bytes()
rows = list(csv.reader(io.StringIO(data.decode("utf-8-sig"))))
print(json.dumps({"csvSha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "bom": data.startswith(b'\xef\xbb\xbf'), "crlf": data.count(b'\r\n'), "rows": len(rows), "header": rows[0], "specialRows": {str(i): rows[i] for i in [1, 25, 40, 48]}}, ensure_ascii=False))
