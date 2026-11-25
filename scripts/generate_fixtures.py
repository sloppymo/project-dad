"""Create fictional, selectable-text statements and their labeled ground truth."""

import json
from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
SAMPLES = ROOT / "public" / "samples"
EXPECTED = ROOT / "test" / "expected-rows.json"

CHECKING = (
    [("2026-01-02", "MERIDIAN RETIREMENT DEPOSIT", 210000),
     ("2026-01-04", "NORTHLINE INTERNET ACH", -6450),
     ("2026-01-12", "FIREFLY WATER DISTRICT ACH", -7300),
     ("2026-01-16", "SUMMIT VISA PAYMENT 2046", -16051),
     ("2026-01-24", "ONLINE TRANSFER TO SAVINGS 0832", -20000)],
    [("2026-02-02", "MERIDIAN RETIREMENT DEPOSIT", 210000),
     ("2026-02-04", "NORTHLINE INTERNET ACH", -6450),
     ("2026-02-12", "FIREFLY WATER DISTRICT ACH", -8200),
     ("2026-02-16", "SUMMIT VISA PAYMENT 2046", -15120),
     ("2026-02-23", "ACH ONLINE PAYMENT WEB", -1995)],
    [("2026-03-02", "MERIDIAN RETIREMENT DEPOSIT", 210000),
     ("2026-03-04", "NORTHLINE INTERNET ACH", -6450),
     ("2026-03-12", "FIREFLY WATER DISTRICT ACH", -9900),
     ("2026-03-16", "SUMMIT VISA PAYMENT 2046", -17180),
     ("2026-03-24", "WESTWARD HARDWARE", -2850)],
)

CARD = (
    [("2026-01-06", "LANTERN STREAMING", -1299),
     ("2026-01-09", "PAYPAL *PINECONE", -899),
     ("2026-01-16", "PAYMENT - THANK YOU", 16051),
     ("2026-01-21", "COPPER MARKET", -2342)],
    [("2026-02-06", "LANTERN STREAMING", -1299),
     ("2026-02-09", "PAYPAL *PINECONE", -899),
     ("2026-02-16", "PAYMENT - THANK YOU", 15120),
     ("2026-02-25", "COPPER MARKET", -3971)],
    [("2026-03-06", "LANTERN STREAMING", -1599),
     ("2026-03-09", "PAYPAL *PINECONE", -899),
     ("2026-03-16", "PAYMENT - THANK YOU", 17180),
     ("2026-03-21", "COPPER MARKET", -2250),
     ("2026-03-21", "COPPER MARKET", -2250),
     ("2026-03-25", "GLASSBRIDGE BOOKSHOP CREDIT", 1270)],
    [("2026-04-06", "LANTERN STREAMING", -1599),
     ("2026-04-09", "PAYPAL *PINECONE", -899),
     ("2026-04-16", "PAYMENT - THANK YOU", 13255),
     ("2026-04-26", "WESTWARD HARDWARE", -3450)],
)

CHECKING_APRIL = (
    [("2026-04-02", "MERIDIAN RETIREMENT DEPOSIT", 210000),
     ("2026-04-04", "NORTHLINE INTERNET ACH", -6450)],
    [("2026-04-12", "FIREFLY WATER DISTRICT ACH", -8600)],
)

INK = HexColor("#142c39")
MUTED = HexColor("#4c626d")
LINE = HexColor("#dce6e7")
PALE = HexColor("#edf5f3")


def dollars(cents):
    return "$" + f"{abs(cents) // 100:,}.{abs(cents) % 100:02d}"


def signed(cents):
    return ("-" if cents < 0 else "+") + dollars(cents)


def draw_text(doc, text, x, y, size=10, *, bold=False, color=INK):
    doc.setFillColor(color)
    doc.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    doc.drawString(x, y, text)


def statement(filename, kind, start, end, pages, damaged=None):
    is_card = kind == "card"
    institution = "SUMMIT CARD SERVICES" if is_card else "HARBOR COMMUNITY BANK"
    title = "CREDIT CARD STATEMENT" if is_card else "CHECKING STATEMENT"
    last_four = "2046" if is_card else "1185"
    accent = HexColor("#3b456b" if is_card else "#246758")
    doc = canvas.Canvas(str(SAMPLES / filename), pagesize=letter, pageCompression=1, invariant=1)
    doc.setTitle(f"Fictional {title.lower()}")
    doc.setAuthor("Project Dad")
    expected = []
    for page, rows in enumerate(pages, 1):
        doc.setFillColor(accent)
        doc.rect(0, 782, 612, 10, fill=1, stroke=0)
        draw_text(doc, institution, 48, 744, 11, bold=True, color=accent)
        draw_text(doc, title, 48, 711, 21, bold=True)
        draw_text(doc, f"Account ending in {last_four}   |   Currency USD", 48, 681, 11)
        draw_text(doc, f"Statement period {start} to {end}", 48, 660, 11)
        draw_text(doc, f"Activity for {rows[0][0][:7]}", 48, 618, 12, bold=True, color=accent)
        doc.setFillColor(PALE)
        doc.roundRect(48, 568, 516, 28, 4, fill=1, stroke=0)
        draw_text(doc, "POST DATE" if is_card else "POSTED DATE", 58, 578, 9, bold=True)
        draw_text(doc, "MERCHANT / ACTIVITY" if is_card else "TRANSACTION DESCRIPTION", 184, 578, 9, bold=True)
        draw_text(doc, "USD AMOUNT" if is_card else "AMOUNT", 490, 578, 9, bold=True)
        for row_index, (date, description, amount) in enumerate(rows):
            year, month, day = date.split("-")
            printed_date = f"{month}/{day}" if is_card else f"{month}/{day}/{year}"
            printed_amount = (dollars(amount) if amount < 0 else f"({dollars(amount)})") if is_card else signed(amount)
            if (page, row_index) == damaged:
                printed_amount = "-$??.??"
            else:
                expected.append(dict(date=date, description=description, amountCents=amount, page=page))
            y = 544 - row_index * 29
            draw_text(doc, printed_date, 58, y, 10)
            draw_text(doc, description, 184, y, 10)
            doc.setFont("Helvetica", 10)
            doc.drawRightString(550, y, printed_amount)
            doc.setStrokeColor(LINE)
            doc.line(48, y - 10, 564, y - 10)
        end_y = 531 - len(rows) * 29
        draw_text(doc, "END OF ACTIVITY", 58, end_y, 9, bold=True, color=MUTED)
        if page == len(pages):
            all_rows = [row for group in pages for row in group]
            draw_text(
                doc, f"Statement totals: {len(all_rows)} rows   |   Net activity {signed(sum(row[2] for row in all_rows))}",
                58, end_y - 32, 11, bold=True,
            )
            note = "Parentheses identify credits and repayments." if is_card else "Negative amounts identify money leaving the account."
            draw_text(doc, note, 58, end_y - 55, 9, color=MUTED)
        draw_text(doc, "PROJECT DAD SAMPLE  /  FICTIONAL DATA", 48, 54, 9, bold=True, color=accent)
        draw_text(doc, f"Page {page} of {len(pages)}", 505, 54, 9, color=MUTED)
        doc.showPage()
    doc.save()
    return expected


def main():
    SAMPLES.mkdir(parents=True, exist_ok=True)
    EXPECTED.parent.mkdir(parents=True, exist_ok=True)
    expected = {
        "harbor-checking-jan-mar.pdf": statement(
            "harbor-checking-jan-mar.pdf", "checking", "2026-01-01", "2026-03-31", CHECKING,
        ),
        "summit-card-jan-mar.pdf": statement(
            "summit-card-jan-mar.pdf", "card", "2026-01-01", "2026-03-31", CARD[:3],
        ),
        "summit-card-feb-apr.pdf": statement(
            "summit-card-feb-apr.pdf", "card", "2026-02-01", "2026-04-30", CARD[1:],
        ),
        "harbor-checking-apr-partial.pdf": statement(
            "harbor-checking-apr-partial.pdf", "checking", "2026-04-01", "2026-04-30",
            CHECKING_APRIL, damaged=(2, 0),
        ),
    }
    EXPECTED.write_text(json.dumps(expected, indent=2) + "\n", encoding="utf-8")
    doc = canvas.Canvas(str(SAMPLES / "unsupported-statement.pdf"), pagesize=letter, invariant=1)
    doc.setTitle("Fictional document with an unsupported layout")
    doc.setFillColor(PALE)
    doc.roundRect(48, 551, 516, 176, 12, fill=1, stroke=0)
    draw_text(doc, "PROJECT DAD SAMPLE  /  IMPORT ERROR TEST", 72, 684, 10, bold=True)
    draw_text(doc, "Fictional hotel receipt", 72, 639, 24, bold=True)
    draw_text(doc, "This document has no checking or credit card transaction table.", 72, 595, 11)
    doc.save()


if __name__ == "__main__":
    main()
