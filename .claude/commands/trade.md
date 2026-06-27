# /trade — Investment Dashboard Trade Execution Skill

Execute BUY and SELL trades against the Investment Dashboard portfolio API.
This skill makes live API calls that modify portfolio data. Always confirm with the user before executing.

```
Examples:
  /trade buy SKY 100 at 12.50        — buy 100 shares of SKY at 12.50 THB
  /trade buy DELTA 200 @ 72.00       — buy 200 shares of DELTA at 72.00 THB
  /trade buy from plan               — pick a stock from a purchase/weekly/portfolio action plan
  /trade sell SKY 50 at 15.00        — partial sell: close 50 of your SKY shares
  /trade sell SKY all at 15.00       — full sell: close all SKY shares
  /trade sell MINT 100               — sell 100 MINT (will prompt for price)
```

---

## SECTION 1: OVERVIEW

You are executing a trade operation for the Investment Dashboard. Your responsibilities:

1. Parse the user's intent and trade parameters from the arguments after `/trade`
2. Authenticate with the backend API using a JWT bearer token
3. Optionally load context from an action plan (purchase, weekly, portfolio, or review list)
4. Validate parameters before any API call
5. Confirm with the user before executing any write operation
6. Execute the trade via REST API using the Bash tool with curl
7. Display results in a clean, readable format

The two supported flows are **BUY** (open a new position) and **SELL** (close or partially close an existing position).

---

## SECTION 2: AUTHENTICATION

**ADR-TRADE-001 — Token management:**

- At the start of execution, check whether a JWT bearer token has already been provided during the current conversation session.
- If a token was provided earlier in this conversation, reuse it. Do NOT ask again.
- If no token has been provided yet, ask the user exactly: "Please provide your JWT bearer token to authenticate with the Investment Dashboard API:"
- After the user provides the token, keep it in mind for all subsequent API calls in this session.
- NEVER echo the token back to the user after they have provided it. Do not display it in confirmations, results, or any output.
- If any API call returns HTTP 401, inform the user: "Your token appears to have expired. Please provide a new JWT bearer token:" and wait for a new one.

---

## SECTION 3: INPUT PARSING

Parse the user's intent from the text following `/trade`.

### Supported BUY patterns
- `/trade buy SKY 100 at 12.50`
- `/trade buy 100 SKY at 12.50`
- `/trade buy SKY 100 shares at 12.50`
- `/trade buy SKY 100 @ 12.50`
- `/trade buy SKY 100` (price is missing — ask the user)
- `/trade buy from plan` (no symbol — enter Plan-Assisted BUY Flow, Section 5B)
- `/trade buy` (no parameters — ask the user: buy from plan or enter manually?)

### Supported SELL patterns
- `/trade sell SKY 50 at 15.00`
- `/trade sell SKY all at 15.00`
- `/trade sell SKY 50 @ 15.00`
- `/trade sell SKY 50` (price is missing — ask the user)

### Extraction rules

| Field | Rule |
|---|---|
| `action` | `buy` or `sell` (case-insensitive, first token after `/trade`) |
| `symbol` | The stock ticker token. ALWAYS convert to uppercase and strip whitespace. |
| `quantity` | Integer number of shares. If the user wrote `all`, defer resolution to Step S5. |
| `price` | Float after `at` or `@`. If absent, ask the user: "What price per share?" |
| `direction` | Default `LONG` unless the user explicitly states `SHORT`. |
| `entry_date` / `exit_date` | Default to today's date from the system context (`currentDate`). Format: `YYYY-MM-DD`. |

If `symbol`, `quantity`, or `price` cannot be extracted with confidence, ask for the missing field before proceeding. Do not guess.

If the user's command mentions "plan", "from plan", "action plan", or "watchlist", enter the Plan-Assisted BUY Flow (Section 5B) instead of Section 5A.

---

## SECTION 4: API BASE URL AND HEADERS

All API calls use this base URL:

```
http://localhost:3000/api/proxy/api/v1
```

This is the Next.js reverse proxy. NEVER call port 8000 directly.

Every request must include:
```
Authorization: Bearer <TOKEN>
Content-Type: application/json   (for POST/PUT requests)
```

---

## SECTION 5A: DIRECT BUY FLOW

Use this flow when the user provides the symbol, quantity, and price directly (no plan reference).

### Step B1 — Extract parameters
Extract `symbol`, `quantity`, and `price` from the user's input. If any are missing, ask for them before continuing.

### Step B2 — Set defaults
- `direction` = `LONG` (unless user stated `SHORT`)
- `entry_date` = today's date (from `currentDate` in system context), formatted as `YYYY-MM-DD`
- `status` = `"active"`

### Step B3 — Show confirmation and wait

Display this confirmation block (filled with actual values) BEFORE making any API call:

```
BUY CONFIRMATION
================
Symbol:     <SYMBOL>
Shares:     <QUANTITY>
Price:      <PRICE> THB
Direction:  <DIRECTION>
Date:       <ENTRY_DATE>
Total Cost: <QUANTITY * PRICE formatted with commas, 2 decimal places> THB

Confirm? (yes/no)
```

Wait for the user's response. Proceed only if they type `yes` or `y` (case-insensitive). If they type anything else or say "cancel", display "Trade cancelled." and stop.

### Step B4 — Execute the BUY API call

Use the Bash tool to run the following curl command. Substitute all placeholder values with the actual runtime values extracted from the user's input:

```bash
RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  -X POST "http://localhost:3000/api/proxy/api/v1/portfolio-db/positions" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN_HERE" \
  -d '{
    "symbol": "SYMBOL_HERE",
    "direction": "DIRECTION_HERE",
    "entry_date": "ENTRY_DATE_HERE",
    "entry_price": PRICE_HERE,
    "position_size": QUANTITY_HERE,
    "status": "active"
  }')
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | grep -o '[0-9]*')
echo "STATUS: $STATUS"
echo "BODY: $BODY"
```

Replace:
- `TOKEN_HERE` with the actual bearer token
- `SYMBOL_HERE` with the uppercased symbol string
- `DIRECTION_HERE` with `LONG` or `SHORT`
- `ENTRY_DATE_HERE` with the date string (`YYYY-MM-DD`)
- `PRICE_HERE` with the numeric price (no quotes)
- `QUANTITY_HERE` with the integer quantity (no quotes)

### Step B5 — Handle the HTTP response

Inspect the `STATUS` value from the curl output:

| Status | Action |
|---|---|
| `201` | Parse JSON body, proceed to Step B6 |
| `401` | "Your token appears to have expired. Please provide a new JWT bearer token:" — stop and wait |
| `422` | Display: "Validation error: <detail from body>" — stop |
| `400` | Display: "Bad request: <error detail from body>" — stop |
| Any other non-2xx | Display: "API error (HTTP <STATUS>): <error detail from body>" — stop |
| curl fails (empty status / connection refused) | Display: "Backend not reachable at http://localhost:3000. Ensure the Investment Dashboard is running." — stop |

### Step B6 — Display success result

Parse the `id` field from the JSON response body. Display:

```
BUY EXECUTED
============
Position ID: <id>
Symbol:      <SYMBOL>
Shares:      <QUANTITY>
Entry Price: <PRICE> THB
Date:        <ENTRY_DATE>
Direction:   <DIRECTION>
Status:      active
```

---

## SECTION 5B: PLAN-ASSISTED BUY FLOW

Use this flow when the user says "from plan", "from watchlist", "from action plan", or similar. This flow fetches one of the four action plan sources and pre-populates the BUY parameters.

### Step PB1 — Ask which plan source

Ask the user:

```
Which plan source?
1) Purchase Action Plan
2) Portfolio Action Plan
3) Weekly Action Plan
4) Review List (weekly review)

Enter number (1–4):
```

Wait for the user's selection.

### Step PB2 — Fetch and display available plans

**For option 1 (Purchase Action Plan) or 3 (Weekly Action Plan):**

Use the Bash tool:

```bash
RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "http://localhost:3000/api/proxy/api/v1/action-plans?plan_type=purchase" \
  -H "Authorization: Bearer TOKEN_HERE")
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | grep -o '[0-9]*')
echo "STATUS: $STATUS"
echo "BODY: $BODY"
```

Note: The backend uses `plan_type=purchase` for both Purchase and Weekly action plans. Weekly plans are purchase-type plans with weekly naming convention. The list endpoint returns plans ordered newest-first.

**For option 2 (Portfolio Action Plan):**

Use the Bash tool with `plan_type=portfolio`:

```bash
RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "http://localhost:3000/api/proxy/api/v1/action-plans?plan_type=portfolio" \
  -H "Authorization: Bearer TOKEN_HERE")
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | grep -o '[0-9]*')
echo "STATUS: $STATUS"
echo "BODY: $BODY"
```

**For option 4 (Review List):**

Use the Bash tool:

```bash
RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "http://localhost:3000/api/proxy/api/v1/review-list" \
  -H "Authorization: Bearer TOKEN_HERE")
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | grep -o '[0-9]*')
echo "STATUS: $STATUS"
echo "BODY: $BODY"
```

Handle 401 and non-2xx as in Section 5A Step B5.

Parse the JSON array from `BODY`. Display a numbered list. Show at most the 10 most recent plans to keep output manageable:

**For action plans (options 1, 2, 3):**
```
Available plans (most recent first):

#  | Name                  | Symbols
---|----------------------|---------
1  | 2026-06-27           | SKY, BH, BDMS
2  | 2026-06-20           | DELTA, MINT
...

Enter plan number, or 0 to cancel:
```

**For review list (option 4):**
```
Available weekly reviews (most recent first):

#  | Name                          | Week
---|-------------------------------|-----
1  | Week 26 (23 Jun–29 Jun 2026)  | 2026-W26
2  | Week 25 (16 Jun–22 Jun 2026)  | 2026-W25
...

Enter review number, or 0 to cancel:
```

Wait for the user's selection. If they enter 0, display "Trade cancelled." and stop.

### Step PB3 — Fetch plan detail

**For action plans (options 1, 2, 3):**

Use the `id` of the selected plan. Fetch plan detail:

```bash
RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "http://localhost:3000/api/proxy/api/v1/action-plans/PLAN_ID_HERE" \
  -H "Authorization: Bearer TOKEN_HERE")
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | grep -o '[0-9]*')
echo "STATUS: $STATUS"
echo "BODY: $BODY"
```

**For review list (option 4):**

Use the `id` of the selected review. Fetch review detail:

```bash
RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "http://localhost:3000/api/proxy/api/v1/review-list/REVIEW_ID_HERE" \
  -H "Authorization: Bearer TOKEN_HERE")
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | grep -o '[0-9]*')
echo "STATUS: $STATUS"
echo "BODY: $BODY"
```

### Step PB4 — Display plan items and ask which to buy

Parse the plan detail JSON from `BODY`.

**For Purchase / Weekly plans (plan_type = "purchase"):**

The plan detail has a `purchase_items` array. Each item has: `stock`, `buy_price`, `size`, `tp`, `sl`, `strategy`, `reason`, `current_price`.

Display:

```
Items in plan "<PLAN_NAME>":

#  | Symbol | Buy Price | Size  | TP     | SL    | Strategy
---|--------|-----------|-------|--------|-------|----------
1  | SKY    | 12.50     | 100   | 14.00  | 11.00 | Breakout
2  | BH     | 180.00    | 50    | 200.00 | 170.0 | Swing
...

Enter item number to BUY, or 0 to cancel:
```

**For Portfolio plans (plan_type = "portfolio"):**

The plan detail has a `portfolio_items` array. Each item has: `symbol`, `entry_price`, `order_size`, `tp`, `sl`, `current_price`.

Display:

```
Items in plan "<PLAN_NAME>":

#  | Symbol | Entry Price | Order Size | TP     | SL
---|--------|-------------|------------|--------|------
1  | DELTA  | 72.00       | 200        | 80.00  | 68.00
...

Enter item number to BUY, or 0 to cancel:
```

**For Review List:**

The review detail has an `items` array. Each item has: `symbol`, `item_type`, `buy_price`, `buy_size`, `buy_reason`, `buy_feeling`.

Display only items with `item_type == "TRADE"`:

```
Trade items in review "<REVIEW_NAME>":

#  | Symbol | Buy Price | Size  | Reason
---|--------|-----------|-------|-------
1  | STA    | 5.80      | 500   | Strong breakout above resistance
2  | CENTEL | 38.50     | 200   | Trend continuation
...

Enter item number to BUY, or 0 to cancel:
```

Wait for the user's selection. If they enter 0, display "Trade cancelled." and stop.

### Step PB5 — Pre-populate BUY parameters from plan item

Extract from the selected plan item:

**Purchase / Weekly plan item:**
- `symbol` = `item.stock` (convert to uppercase)
- `quantity` = `item.size` (use as default; confirm with user if null or 0)
- `price` = `item.buy_price` (use as default; confirm with user if null)
- `tp` = `item.tp` (optional, for display only)
- `sl` = `item.sl` (optional, for display only)

**Portfolio plan item:**
- `symbol` = `item.symbol` (convert to uppercase)
- `quantity` = `item.order_size` (use as default; confirm with user if null or 0)
- `price` = `item.entry_price` (use as default; confirm with user if null)
- `tp` = `item.tp` (optional, for display only)
- `sl` = `item.sl` (optional, for display only)

**Review list item:**
- `symbol` = `item.symbol` (convert to uppercase)
- `quantity` = `item.buy_size` (use as default; confirm with user if null or 0)
- `price` = `item.buy_price` (use as default; confirm with user if null)

If `price` is null or zero, ask the user: "No buy price set in the plan for <SYMBOL>. What price per share?"
If `quantity` is null or zero, ask the user: "No size set in the plan for <SYMBOL>. How many shares?"

After extracting all three, ask the user to confirm or override:

```
Pre-filled from plan:
  Symbol:   <SYMBOL>
  Shares:   <QUANTITY>
  Price:    <PRICE> THB

Press Enter to accept these values, or type overrides (e.g. "150 shares at 13.00"):
```

If the user presses Enter or types "yes", use the pre-filled values. If they type an override, re-parse the override input for quantity and/or price and use those instead.

Then proceed to Section 5A Steps B2–B6 using the final symbol, quantity, price, direction, and entry_date.

---

## SECTION 6: SELL FLOW

### Step S1 — Extract parameters
Extract `symbol`, `quantity` (or `"all"`), and `exit_price` from the user's input. If `exit_price` is missing, ask: "What exit price per share?"

### Step S2 — Fetch open positions

Use the Bash tool:

```bash
RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  "http://localhost:3000/api/proxy/api/v1/portfolio-db/positions?status=active" \
  -H "Authorization: Bearer TOKEN_HERE")
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | grep -o '[0-9]*')
echo "STATUS: $STATUS"
echo "BODY: $BODY"
```

Replace `TOKEN_HERE` with the actual bearer token.

Inform the user before running: "Fetching open positions..."

If STATUS is 401, follow the token-expired flow from Section 2. If STATUS is any non-2xx, display the error and stop.

The response JSON has shape `{"positions": [...], "total": N, "totalNetPnl": X}`. Use the `positions` array.

### Step S3 — Filter positions by symbol

From the `positions` array in `BODY`, filter for items where the `symbol` field matches the user's symbol (compare after converting both to uppercase). Collect all matching positions into a list.

### Step S4 — Handle position count

- **0 matches**: Display "No open position found for <SYMBOL>." and stop.
- **1 match**: Proceed automatically with that position. Note its `id`, `entryPrice`, `positionSize`, `direction`, and `entryDate`.
- **2 or more matches**: Display a disambiguation table:

```
Multiple open positions found for <SYMBOL>:

#  | Entry Date  | Entry Price | Shares | Remarks
---|-------------|-------------|--------|--------
1  | <date>      | <price> THB | <qty>  | <remarks or "-">
2  | <date>      | <price> THB | <qty>  | <remarks or "-">

Which position? Enter number (1, 2, ...):
```

Wait for the user's selection. Use the `id` of the selected position for subsequent steps.

Note: The API returns camelCase field names (`entryPrice`, `positionSize`, `entryDate`, `exitDate`, `exitPrice`, `netPnl`, `pnlPct`). Use these exact field names when parsing JSON.

### Step S5 — Resolve "all" quantity

If the user specified `all` as quantity, set `quantity` = `positionSize` from the selected position record.

### Step S6 — Validate quantity

If `quantity > positionSize`, display:
```
Cannot sell <QUANTITY> shares — position only holds <POSITION_SIZE> shares.
```
Stop without calling the API.

### Step S7 — Determine sell type

- If `quantity == positionSize`: this is a **FULL SELL**
- If `quantity < positionSize`: this is a **PARTIAL SELL**

### Step S8 — Calculate P&L preview

Use these formulas:
- If `direction == LONG`: `diff = exit_price - entry_price`
- If `direction == SHORT`: `diff = entry_price - exit_price`
- `net_pnl = diff * quantity`
- `pnl_pct = (diff / entry_price) * 100`

Round all monetary values to 2 decimal places. Format `net_pnl` with a leading `+` if positive.

### Step S9 — Show pre-execution confirmation and wait

For **PARTIAL SELL**:
```
SELL CONFIRMATION (PARTIAL)
===========================
Symbol:      <SYMBOL>
Selected:    <POSITION_SIZE> shares @ <ENTRY_PRICE> THB (entered <ENTRY_DATE>)

Plan:
  Keep open:  <POSITION_SIZE - QUANTITY> shares @ <ENTRY_PRICE> THB (remaining)
  Close lot:  <QUANTITY> shares @ <EXIT_PRICE> THB
              Entry: <ENTRY_PRICE> | Exit: <EXIT_PRICE>
              P&L:   <+/-NET_PNL> THB (<+/-PNL_PCT>%)
Exit Date:   <EXIT_DATE>

Confirm? (yes/no)
```

For **FULL SELL**:
```
SELL CONFIRMATION (FULL CLOSE)
================================
Symbol:      <SYMBOL>
Shares:      <QUANTITY> @ <ENTRY_PRICE> THB (entered <ENTRY_DATE>)
Exit Price:  <EXIT_PRICE> THB
P&L:         <+/-NET_PNL> THB (<+/-PNL_PCT>%)
Exit Date:   <EXIT_DATE>

Confirm? (yes/no)
```

Wait for user response. Proceed only on `yes` or `y`. Otherwise display "Trade cancelled." and stop.

### Step S10 — Execute the SELL API call

Use the Bash tool:

```bash
RESPONSE=$(curl -s -w "\n__HTTP_STATUS__%{http_code}" \
  -X POST "http://localhost:3000/api/proxy/api/v1/portfolio-db/positions/POSITION_ID_HERE/sell" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN_HERE" \
  -d '{
    "quantity": QUANTITY_HERE,
    "exit_price": EXIT_PRICE_HERE,
    "exit_date": "EXIT_DATE_HERE",
    "remarks": "Executed via /trade skill"
  }')
BODY=$(echo "$RESPONSE" | sed 's/__HTTP_STATUS__[0-9]*//')
STATUS=$(echo "$RESPONSE" | grep -o '__HTTP_STATUS__[0-9]*' | grep -o '[0-9]*')
echo "STATUS: $STATUS"
echo "BODY: $BODY"
```

Replace:
- `POSITION_ID_HERE` with the actual position `id` from Step S3/S4
- `TOKEN_HERE` with the actual bearer token
- `QUANTITY_HERE` with the integer quantity to sell (no quotes)
- `EXIT_PRICE_HERE` with the numeric exit price (no quotes)
- `EXIT_DATE_HERE` with the date string (`YYYY-MM-DD`)

### Step S11 — Handle the HTTP response

| Status | Action |
|---|---|
| `200` or `201` | Parse JSON body, proceed to Step S12 |
| `401` | "Your token appears to have expired. Please provide a new JWT bearer token:" — stop and wait |
| `400` | Display: "Bad request: <detail from body>" (e.g., "Position is not active", "Cannot sell more than N shares") — stop |
| `422` | Display: "Validation error: <detail from body>" — stop |
| Any other non-2xx | Display: "API error (HTTP <STATUS>): <error detail from body>" — stop |
| curl fails | Display: "Backend not reachable at http://localhost:3000. Ensure the Investment Dashboard is running." — stop |

### Step S12 — Display success result

The sell endpoint returns a JSON object with a `type` field: either `"full"` or `"partial"`.

For **FULL SELL** (`type == "full"`), parse `position` from the response. Display:
```
SELL EXECUTED (FULL CLOSE)
===========================
Symbol:      <SYMBOL>
Shares Sold: <QUANTITY>
Entry Price: <ENTRY_PRICE> THB
Exit Price:  <EXIT_PRICE> THB
Net P&L:     <+/-NET_PNL> THB (<+/-PNL_PCT>%)
Status:      closed
```

For **PARTIAL SELL** (`type == "partial"`), parse `remaining` and `sold` from the response. Display:
```
SELL EXECUTED (PARTIAL)
========================
Symbol:      <SYMBOL>
Shares Sold: <QUANTITY>
Entry Price: <ENTRY_PRICE> THB
Exit Price:  <EXIT_PRICE> THB
Net P&L:     <+/-NET_PNL> THB (<+/-PNL_PCT>%)

Remaining Position:
  Position ID: <remaining.id>
  Shares:      <remaining.positionSize>
  Entry Price: <remaining.entryPrice> THB
  Status:      active
```

If the response body does not include a `type` field, check for `position`, `remaining`, and `sold` fields and infer the type. If the body is empty or unparseable on a success status, display: "Trade appears to have executed but the response was unreadable. Check the Investment Dashboard to confirm."

---

## SECTION 7: GUARDRAILS — NEVER VIOLATE

1. **Never execute POST, PUT, or DELETE without an explicit `yes`/`y` confirmation from the user in the current turn.** If the user has not yet confirmed in this turn, do not proceed.
2. **Never echo the JWT token back to the user** after it has been provided, in any output, confirmation, or error message.
3. **Never hardcode a JWT token, password, or credential** in any API call. Always substitute the user-provided token at runtime.
4. **Never call port 8000 directly.** Always use the proxy at `http://localhost:3000`.
5. **Never skip the P&L preview** (Step S9) before executing a sell. The confirmation table is mandatory.
6. **Never send a sell request where `quantity > positionSize`.** Validate this in Step S6 before calling the API.
7. **If the user says "cancel" at any point**, stop immediately. Display "Trade cancelled." Do not proceed with any API call.
8. **Never invent position IDs, plan IDs, or price data.** Only use values returned directly from API responses.
9. **Never use plan item prices as definitive market prices.** Plan items store target/buy prices, not live market prices. The confirmation step allows the user to override.

---

## SECTION 8: API REFERENCE SUMMARY

All URLs are relative to `http://localhost:3000/api/proxy/api/v1`.

| Purpose | Method | URL | Notes |
|---|---|---|---|
| Create position (BUY) | POST | `/portfolio-db/positions` | Body: symbol, direction, entry_date, entry_price, position_size, status |
| List positions | GET | `/portfolio-db/positions?status=active` | Returns `{positions: [], total, totalNetPnl}`. Fields are camelCase. |
| Sell position (full or partial) | POST | `/portfolio-db/positions/{id}/sell` | Body: quantity, exit_price, exit_date, remarks. Returns `{type, position}` or `{type, remaining, sold}` |
| List action plans | GET | `/action-plans?plan_type=purchase` | Returns array of `{id, name, plan_type, symbols, created_at}` |
| List portfolio plans | GET | `/action-plans?plan_type=portfolio` | Same shape as above |
| Get plan detail | GET | `/action-plans/{id}` | Returns `{id, name, plan_type, purchase_items, portfolio_items}` |
| List review lists | GET | `/review-list` | Returns paginated list of `{id, name, week_start}` objects |
| Get review detail | GET | `/review-list/{id}` | Returns review with `items` array. Each item has symbol, item_type, buy_price, buy_size, buy_reason. |

---

## SECTION 9: GENERAL NOTES

- All prices and P&L values are in THB (Thai Baht).
- Format monetary values with 2 decimal places. Use commas for thousands separators in the "Total Cost" display (e.g., `1,250.00`).
- The `currentDate` value injected by the system context is authoritative for today's date — use it as the default for `entry_date` and `exit_date`.
- If the backend is unreachable, do not suggest retrying automatically — inform the user and stop.
- Do not invent position IDs or price data. Only use values returned directly from API responses.
- If the JSON response body is malformed or empty on a success status, display: "Trade appears to have executed but the response was unreadable. Check the Investment Dashboard to confirm."
- The `positions` list API returns camelCase field names: `entryPrice`, `positionSize`, `entryDate`, `exitDate`, `netPnl`, `pnlPct`, `parentId`, `hasChildren`. The sell endpoint also returns camelCase. Use these exact names when reading JSON.
- A position's `parentId` being non-null means it is a child (partially-sold lot). These positions have their own `id` and can be sold further. The `hasChildren` flag on a parent position indicates it has at least one child partial-sell record.
