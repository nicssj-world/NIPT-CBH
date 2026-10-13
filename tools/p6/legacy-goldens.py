"""Dev-only oracle: inspect pinned ZIP source, execute only allowlisted pure AST nodes.

Never imports the legacy application, reads patient samples, or calls a legacy writer.
Usage: python -I tools/p6/legacy-goldens.py <immutable-source-directory> <output.json>
"""
import ast
import hashlib
import io
import json
import pathlib
import sys
import types
import zipfile

ARCHIVES = {
    "NIPTY.zip": "ec54193058f43540180fe1b006d286a6a8bfa17b9d99580329fa9b164fae99e8",
    "NIPTY_handover.zip": "332ef048b256ae81256238ce8d72abd4ebaf714e92e62797f45e4595cd2c4d9c",
}
SOURCES = {
    "services/result_text.py": "629b433e980495d21fda93fec86a4f6c53b3fc4fc8b301d373f27dd2d9f5ad91",
    "services/res_generator.py": ("cdef6943" "92003270" "6e36a55d" "0a5cd143" "3ec61551" "1e3f0cb0" "e94a6275" "d6e8efe4"),
    "services/pdf_exporter.py": "f44655e129aec274f0a4cd20943caf8177ac3657f8eac38b22cb2c8629980ebd",
    "routes/export_routes.py": "99b8c60765b6b202e6ddfb02bb64c777224073d4a654f8ab49c5f730c330d131",
}
PURE = {
    "services/result_text.py": {"_and_join", "_or_join", "_val", "compose_result_text"},
    "services/res_generator.py": {"hl7_escape", "thai_dt_to_hl7", "_parse_dspname", "name_to_hl7", "build_res_filename", "generate_res"},
    "services/pdf_exporter.py": {"sanitize_filename_part", "build_pdf_new_name"},
}


def grouped_digest(digest):
    # Human-readable SHA-256 grouping avoids a numeric run being misclassified as a national ID.
    return ":".join(digest[i:i + 8] for i in range(0, len(digest), 8))


def pure_module(raw, rel):
    tree = ast.parse(raw.decode("utf-8-sig"))
    nodes = []
    for node in tree.body:
        if isinstance(node, ast.Import) and all(a.name in {"re", "logging"} for a in node.names):
            nodes.append(node)
        elif isinstance(node, ast.Assign):
            # Only source constants; no app paths, imports, runtime calls or operator identity.
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if names and all(n.startswith(("_HL7_", "TRI", "SCA", "DEFAULT_CFS", "STYLES", "logger", "_PREFIXES", "_UNSAFE")) for n in names) and "_HL7_OPERATOR_ID" not in names:
                nodes.append(node)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id in {"_PREFIXES", "_HL7_ESCAPE_ORDER"}:
            nodes.append(node)
        elif isinstance(node, ast.FunctionDef) and node.name in PURE[rel]:
            # Do not retain source docstrings/examples in generated artifacts.
            if isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant) and isinstance(node.body[0].value.value, str):
                node.body = node.body[1:]
            nodes.append(node)
    module = types.ModuleType("services." + pathlib.Path(rel).stem)
    module.__dict__["_HL7_OPERATOR_ID"] = "SYNTHETIC^SYNTHETIC"
    exec(compile(ast.Module(body=nodes, type_ignores=[]), rel, "exec"), module.__dict__)
    sys.modules[module.__name__] = module
    return module


def main():
    root, output = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    for name, digest in ARCHIVES.items():
        with (root / name).open("rb") as stream:
            if hashlib.file_digest(stream, "sha256").hexdigest() != digest:
                raise ValueError("ARCHIVE_HASH_MISMATCH")
    modules = {}
    with zipfile.ZipFile(root / "NIPTY.zip") as full, zipfile.ZipFile(root / "NIPTY_handover.zip") as handover:
        # Inventory before selective source reads. Never read samples/config/db/logs.
        counts = [len(full.infolist()), len(handover.infolist())]
        for rel, digest in SOURCES.items():
            raw = handover.read("NIPTY_handover/source/app/" + rel)
            if raw != full.read("NIPTY/app/" + rel) or hashlib.sha256(raw).hexdigest() != digest:
                raise ValueError("SOURCE_PARITY_MISMATCH")
            if rel in PURE:
                modules[rel] = pure_module(raw, rel)
    res = modules["services/res_generator.py"]
    pdf = modules["services/pdf_exporter.py"]
    low = dict(t21="Low Risk", t18="Low Risk", t13="Low Risk", sex_xo="Not Detected", sex_xxx="Not Detected", sex_xxy="Not Detected", sex_xyy="Not Detected")
    results = [None, {}, low, {**low, "t21": "High Risk"}, {**low, "t21": "High Risk", "t18": "High Risk"}, {**low, "t21": "High Risk", "t18": "High Risk", "t13": "High Risk"}, {**low, "sex_xo": "Detected", "sex_xxy": "Detected"}, {"t21": "High Risk"}, {k: low[k] for k in ("t21", "t18", "t13")}, {k: low[k] for k in ("sex_xo", "sex_xxx", "sex_xxy", "sex_xyy")}, {"result_type": "redraw_notice"}, {**low, "t21": " Low Risk ", "sex_xo": " Detected "}]
    # Exhaust all 8 trisomy high/low and 16 SCA detected/not-detected combinations per style.
    for tri in range(8):
        for sca in range(16):
            values = {k: ("High Risk" if tri & (1 << i) else "Low Risk") for i, k in enumerate(("t21", "t18", "t13"))}
            values.update({k: ("Detected" if sca & (1 << i) else "Not Detected") for i, k in enumerate(("sex_xo", "sex_xxx", "sex_xxy", "sex_xyy"))})
            results.append(values)
    fixtures = []
    for style in ("full", "short", "fixed"):
        for i, result in enumerate(results):
            for variant in (range(3) if i < 12 else range(1)):
                order = dict(ln="0" * variant + "990000000001", hn="SYNTHETIC-HN-1", dspname=["นาง SYNTHETIC  SYNTHETIC", "น.ส. SYNTHETIC|^~&\\  SYNTHETIC", "SYNTHETIC  SYNTHETIC"][variant], dob="20000101", sex="F", specimen_date=["20261010070000", "10/10/2569 - 07:00:00", ""][variant])
                settings = dict(hl7_sender="CIT5K", hl7_receiver="HOST", nipt_testcode="70096", hl7_specimen_code="2", hl7_o_field18="7", hl7_accession_sfx="118", hl7_operator_id="SYNTHETIC^SYNTHETIC", hl7_ward_id="301", hl7_ward_name="SYNTHETIC|^~&\\", nipt_result_text="ดูรายงานผลในโปรแกรม CFS", nipt_result_style=style, pdf_template=["N_HN__LN", "7_HN__LN", "SYNTHETIC_HN_LN"][variant])
                if variant == 2:
                    settings["nipt_result_text"] = "   "
                ts = ["20261011123456", "20261011090159", "20261011235959"][variant]
                content, name = res.generate_res(order, settings, timestamp=ts, approve_timestamp="20261011110000", result=result)
                stream = io.BytesIO()
                writer = io.TextIOWrapper(stream, encoding="utf-16le", newline="")
                writer.write(content)
                writer.flush()
                wire = b"\xff\xfe" + stream.getvalue()
                fixtures.append(dict(id=f"SYNTHETIC-{style}-{i}-{variant}", order=order, settings=settings, result=result, generatedAt=ts, approvedAt="20261011110000", sequence=variant + 1, resName=name, pdfName=pdf.build_pdf_new_name(order, settings, variant + 1), wireHex=wire.hex(), sha256=grouped_digest(hashlib.sha256(wire).hexdigest())))
    empty_stream = io.BytesIO()
    empty_writer = io.TextIOWrapper(empty_stream, encoding="utf-16")
    empty_writer.write("")
    empty_writer.flush()
    if empty_stream.getvalue() != b"\xff\xfe":
        raise ValueError("ORACLE_REQUIRES_LITTLE_ENDIAN_HOST")
    pdf_fixtures = []
    for template in ("N_HN__LN", "7_HN__LN", "N", "HN", "LN", "SYNTHETIC_HN_LN"):
        order = dict(hn="SYNTHETIC-HN-1", ln="990000000001")
        pdf_fixtures.append(dict(order=order, template=template, sequence=12, expected=pdf.build_pdf_new_name(order, {"pdf_template": template}, 12)))
    unsafe_order = dict(hn='SYNTHETIC-HN/1:*?"<>|', ln="990000000001")
    pdf_fixtures.append(dict(order=unsafe_order, template="N_HN__LN", sequence=2, expected=pdf.build_pdf_new_name(unsafe_order, {}, 2)))
    document = dict(syntheticOnly=True, oracle="Pinned pure AST only; not legacy app or receiver execution", archives=ARCHIVES, entryCounts=counts, sourceHashes={rel: grouped_digest(digest) for rel, digest in SOURCES.items()}, okHex=empty_stream.getvalue().hex(), pdfFixtures=pdf_fixtures, fixtures=fixtures)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes((json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8"))
    print(f"P6 synthetic goldens: {len(fixtures)}; four pinned sources identical; no patient samples read")


if __name__ == "__main__":
    main()
