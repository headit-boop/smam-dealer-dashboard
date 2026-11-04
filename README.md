# SMAM Automart — Dealer Dashboard (GitHub Pages)

**Live dashboard:** https://headit-boop.github.io/smam-dealer-dashboard/

One page, one section per report tab of the dealer MIS workbook:

| # | Section | Source tab |
|---|---|---|
| 01 | Sales engine — monthly + model table | BOTH DATA |
| 02 | Month × year matrix | Perfromance |
| 03 | Billing — financiers, consultants, districts | BILLING REGISTER MIS |
| 04 | Off-take — monthly, status, ageing | OFF TAKE REPORT MIS |
| 05 | Registration desk — approved / pending / fees / tax | SMAM RTO SHEET |
| 06 | Market share by year | JAMMU DIVISION RTO SHEET |
| 07 | Kashmir valley | SRINAGAR DIVISION RTO SHEET |
| 08 | SMAM vs overall TATA | TATA MOTORS REST DEALER AND SMAM COUNT |
| 09 | Registrations per consultant | RTO SHEET DEALER CA WISE |
| 10 | Billing per consultant | BILLING SHEET DEALER CA WISE |

Hidden tabs (`Sheet6`, `ORDER VEHICLES`) are deliberately not reported.

## How it works

`index.html` + `app.js` only — no build step, no server, no workflow.

On every page load the browser fetches each visible tab straight from the Google
Sheet (`export?format=csv&gid=…`, which is CORS-enabled), aggregates the rows in
JavaScript and renders the page. **Reload = fresh numbers**; nothing to redeploy.

Requirement: the workbook must stay shared as *anyone with the link → viewer*.

## Run locally

Open `index.html` through a local server (file:// blocks the sheet fetch):

```bash
python -m http.server 8000
# then http://localhost:8000
```
