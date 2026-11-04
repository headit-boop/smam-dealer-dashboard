# SMAM Automart — Dealer Dashboard (GitHub Pages)

Live dashboard for the dealer MIS workbook:
**https://headit-boop.github.io/smam-dealer-dashboard/**

Every 30 minutes a GitHub Action pulls all tabs of the Google Sheet, recomputes
the numbers and republishes `index.html`. No server, no paid tool.

## Sections

| # | Section | Source tab |
|---|---|---|
| 01 | Sales engine — monthly + model table | BOTH DATA |
| 02 | Month × year matrix | Perfromance |
| 03 | Billing — financiers, consultants, districts | BILLING REGISTER MIS |
| 04 | Off-take — monthly, status, ageing | OFF TAKE REPORT MIS |
| 05 | Registration desk | SMAM RTO SHEET |
| 06 | Market share | JAMMU DIVISION RTO SHEET |
| 07 | Kashmir valley | SRINAGAR DIVISION RTO SHEET |
| 08 | SMAM vs overall TATA | TATA MOTORS REST DEALER AND SMAM COUNT |
| 09 | Registrations per consultant | RTO SHEET DEALER CA WISE |
| 10 | Billing per consultant | BILLING SHEET DEALER CA WISE |

Hidden tabs (`Sheet6`, `ORDER VEHICLES`) are not reported.

## How it works

```
fetch_sheet.py   downloads the workbook as .xlsx (sheet must be link-viewable)
compute.py       builds metrics.json from the tab CSVs
render.py        writes index.html (self-contained: inline CSS, no JS deps)
```

`.github/workflows/refresh.yml` runs the three steps on a schedule and commits
`index.html` when the numbers change.

## Run locally

```bash
pip install -r requirements.txt
python fetch_sheet.py
python compute.py
python render.py
start index.html
```
