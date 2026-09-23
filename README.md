# Expenses — my week

A small, private expense calendar for GitHub Pages. Flat black-and-white design,
with grey planned purchases. No dependencies, build step, account, backend,
tracking, external fonts, or API keys. All interface text is in English.

## Updated budget

For a calendar month with **N days**:

- **Monthly budget:** `€5 × N + €100`.
- **Daily limit:** `(€5 × N + €100) / N`.
- **Weekly limit:** the sum of the seven daily limits, Monday through Sunday.

| Month length | Monthly budget | Approximate daily limit |
| --- | --- | --- |
| 28 days | €240.00 | €8.57 |
| 29 days | €245.00 | €8.45 |
| 30 days | €250.00 | €8.33 |
| 31 days | €255.00 | €8.23 |

Dates determine the month length automatically, including leap years. For the
week 28 September–4 October 2026, the allowance is `3 × (€250 / 30) +
4 × (€255 / 31)`, approximately **€57.90**. It is not a flat weekly amount.

Purchases are stored in integer eurocents. Daily and weekly budget calculations
retain fractional cents until display; they are not rounded before adding.
Monthly totals are exact. Consequently, rounded daily amounts may not sum to
the monthly budget. A nonzero balance that would round to zero is displayed as
`<€0.01` (with a minus sign for a negative forecast).

The limit for a given day stays fixed throughout its month. It is **not** the
remaining monthly money divided by the number of days still left. Unspent money
is reflected in the weekly and monthly balances, but does not increase the next
day's allowance or carry into the next month.

## Publish or update

The publishing directory must contain these files together:

```text
index.html
styles.css
core.js
app.js
favicon.svg
.nojekyll
```

Upload these files to the root of your existing GitHub Pages publishing
location, replacing their previous versions. This is a static site; no install
or build command is needed. The archive also contains this guide and automated
unit tests, which are optional for hosting.

For a new repository, the usual branch-based Pages configuration publishes
`main` and `/(root)` under the repository's **Settings → Pages**. If the site is
already published, keep its existing publishing configuration.

### Preserve existing records

**First, use Data → Download backup in the old site.** Keep the same Pages
address and directory when updating. The app deliberately retains the previous
`nedelya-budget:v1:<directory>` browser-storage key and version-1 JSON schema.
Your old records and saved items are read without a reset or destructive
migration. Existing item names are never automatically translated or renamed.
Old JSON backups can still be restored via **Data → Choose a backup file**.

A different hostname, browser, device, or site directory uses different local
storage. Export from the old location and import at the new one. Downloaded
HTML files likewise should not be assumed to share storage with the hosted site.

## Everyday use

The main view is one Monday–Sunday week. Use the arrows to change weeks,
**Today** to return to the current date, or **Month** to open the mini calendar.
On narrow screens, use the seven day tabs to select the displayed day.

Each day shows its own computed daily limit, purchases, plans, spending,
remaining allowance, and a grey forecast. The weekly summary shows actual
spending, the remaining weekly budget, and the balance with plans. The monthly
strip includes the month budget, all spending in that month, the remaining
monthly balance, and the grey forecast. A week crossing two months displays
**both months separately**. Monthly figures include all records from the
calendar month, not just entries from the displayed week.

**Add** opens the same form for a purchase or plan. Enter the name, total cost of
that entry, and date; select **Bought** or **Planned**. Prices accept `2.50` and
`2,50`. **Add another** keeps the form open for the next item. Before saving, the
form previews the new daily, weekly, and monthly balances.

Grey plans do not count as actual spending. Tick a plan's square to mark it as
bought; the same entry changes status, so the cost is not duplicated. Click the
name or price to edit an entry, move its date, or delete it. Deletion has a
confirmation and a temporary **Undo** action.

Bought items are saved in **All items**, with their latest purchased price, and
are also suggested inside the add form. Select a suggestion to fill in its name
and price. Buying the same item again creates a new expense, not an overwrite.
Deleting a calendar entry does not erase an item from this saved-item library.
Planned-only items enter the library when marked as bought.

Keyboard shortcuts outside forms: **Left / Right** changes weeks, **N** adds an
item, and **Escape** closes an open dialog. In the name field, **Arrow Down**
enters the suggestions; arrow keys move between them.

## Storage and backup

Records stay in this browser's `localStorage`. They are not committed to GitHub,
uploaded to a server, or automatically synced across devices. Clearing website
data or closing private browsing may remove them. Keep regular backups.

**Data → Download backup** saves one JSON file containing every dated entry,
plan, and saved item. Import validates the whole file before saving and merges
records by ID; it does not duplicate a backup imported twice. For an existing ID,
the latest `updatedAt` wins. Deleted records that still exist in an old backup
will return when it is imported. Imported item names are treated as text, not HTML.

If local storage is blocked or full, the app displays an error instead of
pretending the record was saved. If existing data is unreadable, it is not
silently overwritten; download the original data first, then restore a valid
backup. Other tabs using the same site are refreshed after storage changes.

## Run and test locally

From this directory:

```sh
python3 -m http.server 8000
```

Open `http://localhost:8000`. To run the calculation and data-validation tests
with Node.js:

```sh
node --test tests/core.test.cjs
```

There is no package install step. The separately provided single-file HTML
version embeds the same styles and scripts and can be opened directly, but use
the hosted site for regular storage and keep backups.
