"""Pull every tab of the dealer Google Sheet and inspect its structure.

Works when the sheet is shared as "Anyone with the link -> Viewer".
Downloads the whole workbook as .xlsx (all tabs at once), then dumps
per-tab CSVs plus a schema report so the dashboard can be built from
the real column names.

Usage:
    python fetch_sheet.py            # download + inspect
    python fetch_sheet.py --inspect  # inspect the already-downloaded file
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

SHEET_ID = "15JZOzlxUKAStJpVLxFwRnbLMsHsV1f5B5_NeegUHVxA"
HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
XLSX = RAW / "source.xlsx"
OUT = HERE / "csv"
SCHEMA = HERE / "schema.json"


def download() -> Path:
    RAW.mkdir(parents=True, exist_ok=True)
    url = f"https://docs.google.com/spreadsheets/d/{SHEET_ID}/export?format=xlsx"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        blob = resp.read()
    if not blob.startswith(b"PK"):
        raise SystemExit(
            "Download was not an xlsx (sheet is probably still private). "
            f"First bytes: {blob[:120]!r}"
        )
    XLSX.write_bytes(blob)
    print(f"downloaded {len(blob):,} bytes -> {XLSX}")
    return XLSX


def inspect(path: Path) -> dict:
    import openpyxl

    OUT.mkdir(parents=True, exist_ok=True)
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    schema: dict[str, dict] = {}
    for ws in wb.worksheets:
        rows = list(ws.iter_rows(values_only=True))
        # drop fully empty leading rows
        while rows and all(c in (None, "") for c in rows[0]):
            rows.pop(0)
        header = [("" if c is None else str(c).strip()) for c in (rows[0] if rows else [])]
        body = [r for r in rows[1:] if any(c not in (None, "") for c in r)]
        width = max([len(header)] + [len(r) for r in body]) if (header or body) else 0
        header += [f"col{i}" for i in range(len(header), width)]
        schema[ws.title] = {
            "rows": len(body),
            "cols": width,
            "header": header[:40],
            "sample": [
                [("" if c is None else str(c)) for c in r[:40]] for r in body[:3]
            ],
        }
        # per-tab csv
        import csv

        safe = "".join(ch if ch.isalnum() or ch in " -_()" else "_" for ch in ws.title).strip()
        with open(OUT / f"{safe}.csv", "w", newline="", encoding="utf-8-sig") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            for r in body:
                w.writerow(["" if c is None else c for c in r])
    SCHEMA.write_text(json.dumps(schema, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\n{len(schema)} tabs:")
    for name, info in schema.items():
        print(f"  {name:<32} rows={info['rows']:<6} cols={info['cols']:<3} "
              f"{' | '.join(info['header'][:8])}")
    return schema


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--inspect", action="store_true", help="inspect existing raw/source.xlsx")
    args = ap.parse_args()
    if not args.inspect:
        download()
    if not XLSX.exists():
        sys.exit("raw/source.xlsx missing - run without --inspect first")
    inspect(XLSX)


if __name__ == "__main__":
    main()
