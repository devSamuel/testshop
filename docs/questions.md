# Questions for the product owner, and the assumptions made

The requirements stress asking the right questions, not just shipping features. Each question below changed, or could change, the design. Every one is answered by an explicit assumption that the code centralizes, so a product owner can change any of them. The README lists the eight with the most impact.

| # | Question | Assumption made |
|---|---|---|
| 1 | Does a CSV row with an existing SKU **update** the product or get rejected? | Update (upsert by SKU); changes are shown in the dry run first |
| 2 | Is CSV `stock` an **absolute** count or a **delta**? On hand or sellable? | Absolute sellable quantity; units reserved by in-flight checkouts are subtracted |
| 3 | Should a file with some bad rows be imported **partially** or rejected entirely? | Partial, with a dry run first; all-or-nothing is a small flag if needed |
| 4 | Is the category list fixed? Who manages it? | Free text, normalized (trimmed, case-folded); see the CSV critique for the proposed controlled list |
| 5 | Single currency? | USD only; non-USD prices are rejected, not converted |
| 6 | Can a price be 0? | Allowed, with a warning (promotions) |
| 7 | What does deleting a product mean if it has orders? | Soft delete: hidden from the shop and admin lists; orders keep their snapshot; the SKU can be reused |
| 8 | Should out-of-stock products be visible? | Visible, with an "Out of stock" badge; the shop has an "In stock only" filter |
| 9 | When is stock reserved: in the cart or at checkout? | At checkout, for 10 minutes; carts don't hold stock |
| 10 | Guest checkout or accounts? | Guest checkout with email; authentication is out of scope ([Security scope](../README.md#security-scope)) |
| 11 | Do taxes or shipping apply? Is `weight_kg` used for shipping? | Out of scope; weight is stored and validated for a future shipping calculator |
| 12 | Who can create, edit and import products, and who may see customer orders? | Nobody signs in to this build, by decision: the admin screens and the full orders list, customer emails included, are open. [Security scope](../README.md#security-scope) lists the exposure and the production design |
| 13 | How large are the catalog and the files? How many users import at once? | Files up to 200 MB / 1M rows, streamed and processed within the request. Beyond that, direct-to-storage uploads and a background import job |
| 14 | Should SKUs be case-sensitive? | No: trimmed and upper-cased (`ab-1` = `AB-1`) |
| 15 | What happens if a payment succeeds after the reservation expired? | No silent capture: the order stays expired and `RefundRequired` is raised for finance or ops |
| 16 | Is an admin's stock edit a stocktake (absolute count) or an adjustment (+/-)? | Absolute count, guarded by `expected_stock`: if sales happened since the form was opened, the edit is rejected and the admin re-counts |
| 17 | Must a CSV import be all-or-nothing? | No. Commits are per batch so checkouts aren't blocked; the dry run reviews everything first, and re-running a file is idempotent |
| 18 | Within one file, if a SKU repeats with **different** values (official rows 36 and 56), which row wins? | Neither silently: the first row is kept and the later ones are errors for review. Row 36's "Updated…" text hints at last-row-wins; if confirmed, that needs a pre-pass over the whole file before writing |
| 19 | Is a textual price such as `free` (row 7) ever valid? | No. It's an error with guidance; a truly free product must say `0.00`, which is accepted with a warning (row 47) |
| 20 | Can product names contain HTML (row 20)? | No. Product text is plain text, rejected at import and at the API, and always rendered escaped |
| 21 | How are unlimited or digital products represented (Gift Card: stock `99999`, weight `0`, row 52)? | Imported as-is with a placeholder warning. An explicit `unlimited` / `is_digital` flag would be the proper model |
| 22 | How many users are expected each day, and how high are the peaks? | A few thousand orders a day, with peaks during sales. One API process on a laptop sustained about 140 orders per second on a single hot product ([benchmarks](benchmarks.md)), far above that; the limit is Python CPU per process, so more API containers raise it. The real number decides when to add rate limiting, caching and more API containers |
| 23 | Is it B2C or B2B? | B2C: guest checkout with an email and a card, and one public price per product. B2B would change the model: company accounts with several buyers and roles, negotiated price lists and volume tiers, invoices with payment terms instead of cards, purchase orders with approvals, and catalog visibility per customer |
| 24 | Is the stock real or virtual, and is it managed here or in an ERP? | Real stock, managed here: the shop is the system of record for sellable quantity, with the append-only ledger, reservations, and CSV imports that set absolute counts. If an ERP or WMS owns stock, the shop keeps only a sellable copy: the ERP pushes absolute snapshots or stock events (imports already treat stock as absolute and subtract in-flight reservations), and the shop sends `OrderPaid` back through the outbox. Virtual stock, such as unlimited digital goods or preorders, needs an explicit flag rather than a placeholder like `99999` (question 21) |
| 25 | Is the shop national or international? | National: one currency (USD only, question 5), one language, and no taxes or shipping (question 11). International would add prices per currency with an ISO 4217 code and no silent conversion, localized product text with a search analyzer per language, tax rules per country, shipping zones priced by `weight_kg`, and data residency for customer data |
