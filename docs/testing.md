# How to test DiffNexa

Written for someone who is not a developer. Every command below is safe to run
as many times as you like.

## One-time setup

Install [Node.js 22+](https://nodejs.org) and [Python 3.11+](https://python.org).
Then, from the project folder:

```bash
cd apps/engine
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -e ".[dev]"
cd ../web
npm install
```

## 1. Try the upload page yourself

```bash
cd apps/web
npm run dev
```

Open http://localhost:3000/pdf-compare and try each of these. The expected
result is written beside it.

| What to try | What should happen |
|---|---|
| Drag a normal PDF onto a slot | Filename, size and **page count** appear, marked "Ready" |
| Click "Choose file" instead | Same result |
| A photo or Word file renamed to `.pdf` | "This file isn't a PDF…" |
| A password-protected PDF | "This PDF is password protected…" |
| A damaged PDF (open one in a text editor and delete a chunk) | "This PDF appears to be damaged…" |
| A PDF over 50 MB | "This PDF is larger than the current size limit." |
| "Replace file", then "Remove" | The slot updates, then empties |
| Fill both slots | "Compare PDFs" stays disabled, and says why |
| Press Tab repeatedly | Every control is reachable with a visible outline |
| Narrow the window to phone width | Slots stack vertically and stay readable |

Your files never leave your computer at this stage.

## 2. Run the engine tests

```bash
cd apps/engine
pytest
```

Expect `123 passed`. These cover the evidence rules, the AI boundary, file
validation, extraction accuracy, and the scoring system.

## 3. Run the accuracy suite

From the project root:

```bash
diffnexa golden run
```

This regenerates ten test document pairs, reads them, and checks the results
against what is known to be true. Open `reports/golden/index.html` to see the
scorecard and to click into any document's extraction report.

Comparison is honestly reported as "not run yet" until Stage 3 builds it.

## 4. Look inside one of your own PDFs

```bash
diffnexa extract "path/to/your/notice.pdf" --out reports/
```

Open the HTML file it creates. You'll see the page count, which pages have real
text and which are scanned, and the first words of each page with their exact
positions. This is what the comparison engine will work from, so it's the fastest
way to see whether a document will compare well.

## 5. Run the website's tests

```bash
cd apps/web
npm run check
```

This checks code style, types, tests and the production build.

## Adding your own test documents

This is the most valuable thing you can contribute. See `golden/pairs/README.md`.
In short: copy `golden/pairs/_template/`, rename the folder, put `old.pdf` and
`new.pdf` inside, and describe the real changes in `expected.yaml`. Then run:

```bash
diffnexa golden run --update-baseline --reason "Added <name>: <why>"
```

Only use public documents or ones you have permission to store.
