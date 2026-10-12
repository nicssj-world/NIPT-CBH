"""Dev-only differential harness for AT-HISIN-02 (synthetic files only).

Usage: python -I legacy-differential.py <legacy services dir containing pet_parser.py> <file.pet>...
Loads the legacy NIPTY parser from outside the repository (never copied into it) and prints one JSON
array: the legacy parse_pet_file() result per file (null = legacy treats it as non-NIPT/unparseable).
"""
import importlib.util
import json
import sys
from pathlib import Path

source = Path(sys.argv[1]) / "pet_parser.py"
spec = importlib.util.spec_from_file_location("legacy_pet_parser", source)
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
results = [legacy.parse_pet_file(path) for path in sys.argv[2:]]
sys.stdout.buffer.write(json.dumps(results, ensure_ascii=False).encode("utf-8"))
