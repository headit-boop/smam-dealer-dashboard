# SMAM Automart — Dealer Dashboard (GitHub Pages)

**Live:** https://headit-boop.github.io/smam-dealer-dashboard/

Pick a report from the **Report** dropdown — only that tab's report is shown.
**Year** and **Month** dropdowns filter every report. The selection is kept in
the URL, so a view can be bookmarked or shared
(e.g. `?report=billing&year=2026&month=6`).

| Report | Source tab |
|---|---|
| BOTH DATA | sales engine — monthly, year by year, models |
| Perfromance | month × year matrix, last five years |
| BILLING REGISTER MIS | financiers, consultants, districts, margin |
| OFF TAKE REPORT MIS | monthly, physical status, ageing, models |
| SMAM RTO SHEET | registrations per office |
| JAMMU DIVISION RTO SHEET | market share by year and RTO |
| SRINAGAR DIVISION RTO SHEET | valley volume and makers |
| TATA MOTORS REST DEALER AND SMAM COUNT | our share of TATA |
| RTO SHEET DEALER CA WISE | registrations per consultant |
| BILLING SHEET DEALER CA WISE | invoices per consultant, cash discount |

Hidden tabs (`Sheet6`, `ORDER VEHICLES`) are not reported.

## How it works

`index.html` + `app.js`. No build step, no server, no workflow. On page load the
browser fetches each tab from the Google Sheet (`export?format=csv&gid=…`, which
is CORS-enabled) and aggregates in JavaScript. Reload = fresh numbers.

The workbook must stay shared as *anyone with the link → viewer*.

## Run locally

```bash
python -m http.server 8000   # then open http://localhost:8000
```
(file:// blocks the sheet fetch)
