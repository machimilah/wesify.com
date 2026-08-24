from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "docs" / "BO_Investor_Value_Proposition.pdf"
WAVE = ROOT / "metallic_wave_webpage_images" / "varied_positions_and_angles" / "wave_10.png"

INK = colors.HexColor("#171A17")
GRAPHITE = colors.HexColor("#3B423F")
MUTED = colors.HexColor("#666E67")
LINE = colors.HexColor("#DCDED9")
SOFT = colors.HexColor("#F4F5F2")
PALE = colors.HexColor("#E9ECE7")
WHITE = colors.white
AMBER = colors.HexColor("#C99A3F")

PAGE_W, PAGE_H = letter
CONTENT_W = 7.08 * inch


base = getSampleStyleSheet()
styles = {
    "brand": ParagraphStyle(
        "Brand", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9,
        leading=10, textColor=INK, spaceAfter=6,
    ),
    "kicker": ParagraphStyle(
        "Kicker", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=7,
        leading=8, textColor=GRAPHITE, tracking=1.4, spaceAfter=6,
    ),
    "cover_title": ParagraphStyle(
        "CoverTitle", parent=base["Title"], fontName="Helvetica-Bold", fontSize=25,
        leading=24, textColor=INK, spaceAfter=10,
    ),
    "title": ParagraphStyle(
        "Title", parent=base["Title"], fontName="Helvetica-Bold", fontSize=22,
        leading=22, textColor=INK, spaceAfter=7,
    ),
    "subtitle": ParagraphStyle(
        "Subtitle", parent=base["Normal"], fontName="Helvetica", fontSize=9.4,
        leading=12.2, textColor=MUTED, spaceAfter=12,
    ),
    "h2": ParagraphStyle(
        "H2", parent=base["Heading2"], fontName="Helvetica-Bold", fontSize=11,
        leading=13, textColor=INK, spaceBefore=5, spaceAfter=6,
    ),
    "body": ParagraphStyle(
        "Body", parent=base["Normal"], fontName="Helvetica", fontSize=8.8,
        leading=11.5, textColor=GRAPHITE, spaceAfter=6,
    ),
    "body_small": ParagraphStyle(
        "BodySmall", parent=base["Normal"], fontName="Helvetica", fontSize=7.7,
        leading=9.8, textColor=GRAPHITE,
    ),
    "note": ParagraphStyle(
        "Note", parent=base["Normal"], fontName="Helvetica-Oblique", fontSize=7.2,
        leading=9, textColor=MUTED, spaceBefore=5,
    ),
    "card_label": ParagraphStyle(
        "CardLabel", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=6.5,
        leading=7.5, textColor=MUTED, tracking=0.9, spaceAfter=4,
    ),
    "card_title": ParagraphStyle(
        "CardTitle", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=9.2,
        leading=10.4, textColor=INK, spaceAfter=4,
    ),
    "card_body": ParagraphStyle(
        "CardBody", parent=base["Normal"], fontName="Helvetica", fontSize=7.35,
        leading=9.1, textColor=GRAPHITE,
    ),
    "callout_label": ParagraphStyle(
        "CalloutLabel", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=6.6,
        leading=7.5, textColor=MUTED, tracking=1.0, spaceAfter=4,
    ),
    "callout_title": ParagraphStyle(
        "CalloutTitle", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=12.2,
        leading=13.5, textColor=INK, spaceAfter=4,
    ),
    "callout_body": ParagraphStyle(
        "CalloutBody", parent=base["Normal"], fontName="Helvetica", fontSize=8.1,
        leading=10.2, textColor=GRAPHITE,
    ),
    "row_label": ParagraphStyle(
        "RowLabel", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=8,
        leading=9.5, textColor=INK,
    ),
    "row_body": ParagraphStyle(
        "RowBody", parent=base["Normal"], fontName="Helvetica", fontSize=7.7,
        leading=9.5, textColor=GRAPHITE,
    ),
    "table_head": ParagraphStyle(
        "TableHead", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=6.6,
        leading=8, textColor=WHITE, tracking=0.7,
    ),
    "stat": ParagraphStyle(
        "Stat", parent=base["Normal"], fontName="Helvetica-Bold", fontSize=16,
        leading=17, textColor=INK, alignment=TA_CENTER, spaceAfter=3,
    ),
    "stat_label": ParagraphStyle(
        "StatLabel", parent=base["Normal"], fontName="Helvetica", fontSize=6.9,
        leading=8, textColor=MUTED, alignment=TA_CENTER,
    ),
}


def P(text, style="body"):
    return Paragraph(text, styles[style])


def section_title(number, title, subtitle):
    return KeepTogether([
        P(f"{number} / INVESTMENT CASE", "kicker"),
        P(title, "title"),
        P(subtitle, "subtitle"),
    ])


def cards(items, columns=3, fill=SOFT):
    rows = []
    for offset in range(0, len(items), columns):
        row = []
        for item in items[offset:offset + columns]:
            label, title, body = item
            row.append([P(label.upper(), "card_label"), P(title, "card_title"), P(body, "card_body")])
        while len(row) < columns:
            row.append("")
        rows.append(row)
    col_width = CONTENT_W / columns
    table = Table(rows, colWidths=[col_width] * columns, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("BOX", (0, 0), (-1, -1), 0.45, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.45, WHITE),
    ]
    table.setStyle(TableStyle(commands))
    return table


def callout(label, title, body, fill=SOFT):
    table = Table(
        [[[P(label.upper(), "callout_label"), P(title, "callout_title"), P(body, "callout_body")]]],
        colWidths=[CONTENT_W], hAlign="LEFT",
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), fill),
        ("LINEABOVE", (0, 0), (-1, 0), 1.2, GRAPHITE),
        ("LEFTPADDING", (0, 0), (-1, -1), 14),
        ("RIGHTPADDING", (0, 0), (-1, -1), 14),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    return table


def row_table(rows, header=None, left=2.05 * inch):
    data = []
    if header:
        data.append([P(header[0].upper(), "table_head"), P(header[1].upper(), "table_head")])
    data.extend([[P(label, "row_label"), P(body, "row_body")] for label, body in rows])
    table = Table(data, colWidths=[left, CONTENT_W - left], repeatRows=1 if header else 0, hAlign="LEFT")
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LINEBELOW", (0, 0), (-1, -1), 0.45, LINE),
    ]
    if header:
        commands.extend([
            ("BACKGROUND", (0, 0), (-1, 0), GRAPHITE),
            ("LINEBELOW", (0, 0), (-1, 0), 0, GRAPHITE),
        ])
    table.setStyle(TableStyle(commands))
    return table


def stat_row(items):
    data = [[[P(value, "stat"), P(label, "stat_label")]] for value, label in items]
    table = Table([data], colWidths=[CONTENT_W / len(items)] * len(items), hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), SOFT),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("INNERGRID", (0, 0), (-1, -1), 0.45, WHITE),
        ("BOX", (0, 0), (-1, -1), 0.45, LINE),
    ]))
    return table


def bullet(title, body):
    return P(f"<b>{title}</b> {body}", "body")


def draw_first_page(canvas, doc):
    canvas.saveState()
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 6.8)
    canvas.drawString(0.71 * inch, 0.35 * inch, "PREPARED FOR INVESTOR CONVERSATIONS  |  AUGUST 2026")
    canvas.drawRightString(PAGE_W - 0.71 * inch, 0.35 * inch, "01")
    canvas.restoreState()


def draw_later_pages(canvas, doc):
    canvas.saveState()
    left = 0.71 * inch
    right = PAGE_W - 0.71 * inch
    canvas.setFillColor(INK)
    canvas.setFont("Helvetica-Bold", 7.6)
    canvas.drawString(left, PAGE_H - 0.38 * inch, "BO")
    canvas.setFillColor(MUTED)
    canvas.setFont("Helvetica", 6.8)
    canvas.drawString(left + 0.28 * inch, PAGE_H - 0.38 * inch, "|   INVESTOR VALUE PROPOSITION")
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.45)
    canvas.line(left, PAGE_H - 0.45 * inch, right, PAGE_H - 0.45 * inch)
    canvas.setFillColor(MUTED)
    canvas.drawString(left, 0.35 * inch, "PREPARED FOR INVESTOR CONVERSATIONS  |  AUGUST 2026")
    canvas.drawRightString(right, 0.35 * inch, f"{doc.page:02d}")
    canvas.restoreState()


def build_story():
    story = []

    # Cover
    story += [
        P("BO", "brand"),
        Image(str(WAVE), width=CONTENT_W, height=3.38 * inch),
        Spacer(1, 0.18 * inch),
        P("INVESTOR VALUE PROPOSITION", "kicker"),
        P("The business operating system<br/>that builds itself around the company.", "cover_title"),
        P("BO turns a plain-language description into a tailored Command Center: the records, workflows, metrics, controls, and connected data a company needs to operate.", "subtitle"),
        cards([
            ("01", "Immediate value", "A working system appears before the buyer commits to a configuration project."),
            ("02", "Structural differentiation", "The product compiles from company evidence instead of exposing a generic suite."),
            ("03", "Compounding moat", "Anonymous industry-level corrections make later builds more accurate."),
        ]),
        PageBreak(),
    ]

    # 01 Problem
    story += [
        section_title("01", "A large gap between spreadsheets and ERP", "Smaller operating companies are forced to choose between fragmentation and an implementation project."),
        cards([
            ("TODAY", "Fragmented tools", "Payments, CRM, accounting, scheduling, and spreadsheets each hold part of the truth. Teams re-key data and reconcile by hand."),
            ("ALTERNATIVE", "Overbuilt suites", "ERP and CRM suites ship broad module catalogs, then transfer configuration, training, and process design to the buyer."),
            ("CONSEQUENCE", "Operational blind spots", "Ownership, handoffs, exceptions, and definitions live in people rather than in one usable operating model."),
        ]),
        Spacer(1, 0.12 * inch),
        callout("BO's wedge", "Outgrown spreadsheets. Not ready for a six-month ERP program.", "The initial target is an operationally real company, roughly 5-200 employees, without a dedicated systems administrator. The strongest early verticals have specific workflows: field services, trades, logistics, studios, clinics, and small manufacturers."),
        Spacer(1, 0.12 * inch),
        P("The category shift", "h2"),
        row_table([
            ("Traditional software", "Choose a product, select modules, configure fields, map processes, migrate data, and train users."),
            ("BO", "Describe the business, answer only material gaps, review BO's understanding, and receive the configured Command Center."),
            ("Investor implication", "The demonstration is the product. BO can prove relevance before asking a company to switch or pay."),
        ]),
        P("No unsupported market-size or traction figures are used in this brief. The case rests on product architecture, customer economics, and measurable milestones.", "note"),
        PageBreak(),
    ]

    # 02 Product
    story += [
        section_title("02", "One sentence becomes an operating model", "BO asks only what can change the result, then compiles company knowledge into software."),
        cards([
            ("1", "Describe", "The operator explains the company in ordinary language."),
            ("2", "Classify", "BO maps the company to an industry and operating archetype."),
            ("3", "Resolve", "High-information questions settle undecided capabilities."),
            ("4", "Compile", "Evidence becomes records, pages, KPIs, workflows, and controls."),
            ("5", "Connect", "Existing systems remain the source of record where appropriate."),
            ("6", "Evolve", "Approved changes create a new, versioned Command Center."),
        ]),
        Spacer(1, 0.1 * inch),
        callout("Product rule", "BO installs structure, never fiction.", "A generated workspace can contain record types, relationships, workflows, responsibilities, controls, and unconfigured metrics. It must not invent customers, transactions, employees, performance figures, or operational alerts.", PALE),
        Spacer(1, 0.1 * inch),
        P("A deeper operating model, without changing how BO works", "h2"),
        row_table([
            ("Responsibility", "RACI-style ownership and approvals become role and policy primitives."),
            ("Flow", "Inputs, outputs, handoffs, exceptions, and stage gates become process definitions."),
            ("Data", "Master data dictionaries become generated schemas with governed field definitions."),
            ("Performance", "KPI catalogs connect measures to source capabilities, owners, and decisions."),
            ("Automation", "Reusable automation patterns are selected only when company evidence supports them."),
        ], header=("Operating knowledge", "How BO turns it into product")),
        PageBreak(),
    ]

    # 03 Defensibility
    story += [
        section_title("03", "A product that compounds by industry", "The catalog can be copied. The accumulated record of what real companies kept, removed, and added cannot."),
        stat_row([("1,923", "industry titles"), ("120", "buildable capabilities"), ("25", "operating archetypes"), ("5+", "companies before evidence applies")]),
        Spacer(1, 0.11 * inch),
        P("The learning loop", "h2"),
        cards([
            ("BUILD", "BO proposes", "Rules, public research, and the operator's statements produce the first Command Center."),
            ("OPERATE", "The company corrects", "Kept, removed, and newly added capabilities become clean operational labels."),
            ("AGGREGATE", "Only counts survive", "No company name, workspace ID, record, prompt, or field content enters shared evidence."),
            ("IMPROVE", "The next build starts better", "Observed behavior outranks industry research; explicit company statements still outrank both."),
        ], columns=2),
        Spacer(1, 0.08 * inch),
        P("Guardrails make the loop credible", "h2"),
        row_table([
            ("Minimum sample", "At least five companies contribute before a pattern can influence another company."),
            ("Strong threshold", "A 60% decision threshold avoids treating a narrow majority as an industry truth."),
            ("One company, one vote", "Repeated user activity cannot outweigh other companies."),
            ("Explicit beats inferred", "What this operator states always overrides research or observed patterns."),
        ]),
        P("Cold-start reality: the mechanism is implemented, but observed evidence must be earned through adoption. Until then, BO relies on authored rules and cited industry research.", "note"),
        PageBreak(),
    ]

    # 04 Value
    story += [
        section_title("04", "Value is created at setup and during operation", "BO reduces the cost of getting the right system and the cost of keeping it aligned as the company changes."),
        cards([
            ("OWNER / FOUNDER", "A company view, not an app view", "Customers, delivery, cash, responsibilities, and exceptions are visible through one operating model."),
            ("OPERATIONS LEAD", "Work has owners and states", "Processes expose handoffs, deadlines, approvals, and gaps instead of hiding them in chat and spreadsheets."),
            ("TEAM", "Less software interpretation", "Navigation and terminology follow the configured company rather than a vendor's universal object model."),
        ]),
        Spacer(1, 0.12 * inch),
        P("Economic mechanisms", "h2"),
        row_table([
            ("Lower implementation burden", "Discovery and compilation replace much of the blank-page configuration work."),
            ("Fewer duplicate systems", "A capability can be built in BO or connected to the system that already owns it."),
            ("Faster operational changes", "Natural-language requests become typed, reviewable proposals with impact and rollback."),
            ("Improved control", "KPI definitions, responsibilities, data sources, and approval policies remain connected."),
            ("AI readiness", "Structured processes and trustworthy data create the foundation for governed agents and decision support."),
        ], header=("Value lever", "Why it matters")),
        Spacer(1, 0.12 * inch),
        callout("Core promise", "Business managing in one place.", "BO is not trying to recreate every specialist system. It is the operating layer that decides what belongs in the company, builds what is missing, and connects what should remain elsewhere."),
        PageBreak(),
    ]

    # 05 Business model
    pricing = [
        [P("PLAN", "table_head"), P("FREE", "table_head"), P("PRO", "table_head"), P("BUSINESS", "table_head")],
        ["Price / month", "$0", "$10", "$50"],
        ["Workspaces", "1", "1", "5"],
        ["Records", "200", "Unlimited", "Unlimited"],
        ["Rebuilds / month", "0", "5", "20"],
        ["Connected apps", "-", "Included", "Included"],
        ["Team access", "-", "-", "Included"],
    ]
    pricing_table = Table(pricing, colWidths=[2.08 * inch, 1.5 * inch, 1.7 * inch, 1.8 * inch], hAlign="LEFT")
    pricing_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GRAPHITE),
        ("TEXTCOLOR", (0, 1), (-1, -1), GRAPHITE),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("FONTNAME", (1, 1), (-1, -1), "Helvetica"),
        ("FONTSIZE", (0, 1), (-1, -1), 8),
        ("ALIGN", (1, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [SOFT, WHITE]),
        ("LINEBELOW", (0, 1), (-1, -1), 0.45, LINE),
        ("LEFTPADDING", (0, 0), (-1, -1), 9),
        ("RIGHTPADDING", (0, 0), (-1, -1), 9),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
    ]))
    story += [
        section_title("05", "A low-friction entry with expansion tied to value", "The personalized first build is free. Paid plans monetize scale, change, connections, and collaboration."),
        pricing_table,
        Spacer(1, 0.12 * inch),
        P("Why the economics can improve with scale", "h2"),
        bullet("First build as acquisition.", "A buyer sees a system shaped around their own company before paying."),
        bullet("Usage is structurally light.", "Once built, the Command Center is primarily persistent structured data and application runtime."),
        bullet("Research amortizes by industry.", "Industry-level research can be reused by every later company in that segment."),
        bullet("Vertical concentration improves both product and margin.", "More customers in one industry create stronger evidence and spread fixed knowledge costs."),
        callout("Commercial discipline", "No deletion as a collection tactic.", "A lapsed plan falls back to Free limits while existing data stays readable and exportable. The product sells ongoing capacity and capability, not fear of losing company records.", PALE),
        PageBreak(),
    ]

    # 06 GTM
    story += [
        section_title("06", "Win vertically, expand horizontally", "BO can address many industries, but early distribution should deliberately concentrate evidence and references."),
        cards([
            ("LAND", "Personalized free build", "The product creates its own demo from the company's description."),
            ("FOCUS", "A few operating verticals", "Concentration accelerates accuracy, references, and repeatable onboarding."),
            ("EXPAND", "Connections and team use", "Paid value grows as BO becomes the shared view across existing systems."),
            ("MOVE UP", "Trust and governance", "Roles, auditability, data controls, and reliable runtime support larger deployments."),
        ], columns=2),
        Spacer(1, 0.08 * inch),
        P("The next commercial proof", "h2"),
        row_table([
            ("Design partners", "Recruit five companies from one narrowly defined operating segment."),
            ("Recognition", "More than 80% of the central process is recognized as correct by operators."),
            ("Correction rate", "Fewer than 15% of important claims require correction."),
            ("Time to value", "A useful reviewed operating model is reached in under 20 minutes."),
            ("Operational outcome", "Each company identifies at least one concrete decision or control improved by BO."),
        ], header=("Validation gate", "Evidence to collect")),
        Spacer(1, 0.08 * inch),
        P("Metrics that reveal compounding", "h2"),
        stat_row([("DOWN", "corrections per build"), ("UP", "build-to-first-record"), ("UP", "connected apps / workspace"), ("UP", "free-to-paid by vertical")]),
        PageBreak(),
    ]

    # 07 State
    story += [
        section_title("07", "The platform exists; adoption is the next risk to retire", "BO has moved beyond a visual prototype, but it should not claim commercial validation it has not earned."),
        row_table([
            ("Built and tested", "Structured discovery; 1,923-title taxonomy; 120-capability catalog; dependency graph; generated schemas and Command Center; persistent records and builds; tenant access; accounts; billing; observability; deployment; versioning."),
            ("Connected data", "A real, read-only Stripe connector imports customers, subscriptions, and payments; credentials are encrypted and never returned; remote deletions are marked rather than silently applied."),
            ("Compounding layer", "Industry research with citations plus anonymous, thresholded capability and reusable-pattern learning."),
            ("Still partial", "Durable workflow runtime, granular server-enforced agent policies, broader connector lifecycle, unified approval queues, and deeper domain packs."),
            ("Not yet proven", "Repeatable acquisition, retention, willingness to pay, vertical unit economics, and accuracy improvement from real customer behavior."),
        ], header=("State", "Investor interpretation")),
        Spacer(1, 0.1 * inch),
        P("Capital should unlock evidence, not more surface area", "h2"),
        cards([
            ("1", "Design-partner deployment", "Instrument activation, correction, usage, and conversion in one vertical."),
            ("2", "Durable execution", "Ship workflow instances, retries, exception handling, and one approval queue."),
            ("3", "Connector depth", "Add the few systems that dominate the chosen vertical."),
            ("4", "Governed intelligence", "Enforce agent scopes, capture traces, and gate autonomy through evaluations."),
        ], columns=2),
        Spacer(1, 0.1 * inch),
        callout("Investment thesis", "BO can become the adaptive operating layer for companies underserved by point tools and ERP suites.", "The near-term case is measurable: prove that a generated Command Center is recognized faster, corrected less, used earlier, and retained more deeply as industry evidence and connections accumulate.", PALE),
        PageBreak(),
    ]

    # 08 Risks
    story += [
        section_title("08", "The opportunity is large because the hard parts are real", "A credible investor case states the risks and the mechanisms BO uses to contain them."),
        row_table([
            ("Cold start", "Observed evidence begins empty. Mitigation: cited industry research, conservative authored rules, and vertical concentration."),
            ("Wrong inference", "A confident but incorrect workspace destroys trust. Mitigation: explicit evidence basis, playback, confidence, corrections, and stated answers overriding all inference."),
            ("System-of-record trust", "Operators are cautious with core data. Mitigation: tenant isolation, encrypted credentials, read-first connectors, versioning, audit, and no silent deletion."),
            ("Connector maintenance", "Every external API creates ongoing cost. Mitigation: a uniform provider contract and a narrow, vertical-first connector strategy."),
            ("Incumbent response", "Suites can add conversational setup. BO's defense is not chat; it is a narrow compiler, company evidence, and an industry loop that improves from operation."),
            ("Premature autonomy", "AI actions can create harm. Mitigation: deterministic validation, typed proposals, human approval, scoped tools, and progressive autonomy."),
        ], header=("Risk", "Response")),
        Spacer(1, 0.12 * inch),
        callout("In one sentence", "BO decides what a company needs instead of asking it to configure what it does not - and it is designed to decide better each time another company in the same industry uses it.", "That combines a strong product demonstration, a software-margin subscription model, and a privacy-safe data advantage that can compound with focused adoption."),
        Spacer(1, 0.12 * inch),
        P("Source basis", "h2"),
        P("Prepared from BO's live codebase and internal product materials, including the implementation architecture, roadmap, knowledge base, connected-app design, business research engine, billing model, and Oficial.docm. Product-state claims are limited to behavior represented in the current implementation and tests.", "body_small"),
        P("Excluded by design: unsupported traction, market-size, ROI, and payroll/labor calculation claims.", "note"),
    ]
    return story


def main():
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=letter,
        leftMargin=0.71 * inch, rightMargin=0.71 * inch,
        topMargin=0.62 * inch, bottomMargin=0.58 * inch,
        title="BO Investor Value Proposition",
        author="BO",
        subject="Investor brief for BO, an AI-native Business Command Center",
    )
    doc.build(build_story(), onFirstPage=draw_first_page, onLaterPages=draw_later_pages)
    print(OUTPUT)


if __name__ == "__main__":
    main()
