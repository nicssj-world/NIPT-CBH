"""Read-only evidence check. Never exports, copies, repairs or saves a workbook."""
import argparse
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET
import zipfile


def inspect(path):
    data = Path(path).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    expected = "1e4ffc979235f3221ca637f37476713c3a02bc7a5c541c8d32688f4af9c0caec"
    if digest != expected:
        raise ValueError("TEMPLATE_HASH_MISMATCH: stop and review source version")
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, "ZIP_CRC_FAILURE"
        workbook = ET.fromstring(archive.read("xl/workbook.xml"))
        sheet = ET.fromstring(archive.read("xl/worksheets/sheet1.xml"))
        shared = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        strings = ["".join(t.text or "" for t in item.findall(".//m:t", ns)) for item in shared.findall("m:si", ns)]
        cells = {c.attrib["r"]: c for c in sheet.findall("m:sheetData/m:row/m:c", ns)}

        def value(address):
            cell = cells.get(address)
            if cell is None:
                return None
            raw = cell.find("m:v", ns)
            if raw is None:
                return None
            return strings[int(raw.text)] if cell.get("t") == "s" else int(raw.text)

        assert [s.get("name") for s in workbook.findall("m:sheets/m:sheet", ns)] == ["Sheet1"]
        assert sheet.find("m:dimension", ns).get("ref") == "A1:E48"
        assert [int(r.get("r")) for r in sheet.findall("m:sheetData/m:row", ns)] == list(range(1, 49))
        headers = [value(f"{col}1") for col in "ABCDE"]
        assert headers == ["*Sample ID", "*Lane ID", "*DNB ID\n(20 characters limited)", "*Barcode ID", "Sub-Library Conc. (ng/μl)"]
        barcodes = [value(f"D{r}") for r in range(2, 49)]
        assert barcodes == list(range(1, 13)) + list(range(14, 49))
        for row in range(2, 49):
            assert value(f"A{row}") is None and f"A{row}" in cells
            assert value(f"B{row}") == "L01" and cells[f"B{row}"].get("t") == "s"
            assert cells[f"D{row}"].get("t", "n") == "n"
            assert f"E{row}" not in cells
        assert value("C2") == "DNBYYYYMMDD"
        assert all(value(f"C{row}") is None for row in range(3, 49))
        assert not sheet.findall(".//m:f", ns)
    # Detect a concurrently changed original as well as accidental edits.
    assert hashlib.sha256(Path(path).read_bytes()).hexdigest() == digest
    return {"status": "READ_ONLY_TEMPLATE_MATCH", "sha256": digest, "bytes": len(data),
            "sheet": "Sheet1", "range": "A1:E48", "dataRows": 47, "headers": headers,
            "barcodes": barcodes, "blankEvidence": ["A2:A48 styled blank", "C3:C48 styled blank", "E2:E48 absent"],
            "halosImportTested": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("template", help="Explicit path to the read-only original XLSX")
    args = parser.parse_args()
    print(json.dumps(inspect(args.template), ensure_ascii=True, indent=2))
