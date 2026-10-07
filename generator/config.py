"""All assumptions for the synthetic CRM data, in one place.

Everything here is invented for illustration. The only confirmed Catalys fact used is the
clinc entry price (from 135 EUR/month). All other numbers (volumes, reply rates, conversion
rates, durations, prices, costs, churn) are plausible guesses for B2B healthcare SaaS, not
Catalys figures.
"""
from datetime import date

SEED = 159  # picked with check_seeds.py: F1 to F3 clear, closest to the typical seed

# Time window. Deals not closed by AS_OF are open pipeline. Weeks start on Mondays.
START = date(2026, 4, 1)
AS_OF = date(2026, 9, 30)
WINDOW_MONTHS = 6

# ---------------------------------------------------------------- lead volumes
# Outbound: contacts per week ramp linearly (start, end). Each reply becomes one lead.
OUTBOUND_CONTACTS_PER_WEEK = {
    "outbound_email": (85, 160),
    "outbound_phone": (16, 32),   # dial attempts, including calls where nobody was reached
    "linkedin": (20, 40),
}
REPLY_RATE = {"outbound_email": 0.04, "outbound_phone": 0.12, "linkedin": 0.07}

# Inbound: expected leads per week ramp linearly (start, end)
INBOUND_LEADS_PER_WEEK = {
    "seo_tools": (1.4, 2.8),
    "website_demo": (0.8, 1.5),
    "sumup": (0.7, 1.3),
}

# Referral: each live customer refers a new lead with this probability per week
REFERRAL_P_PER_CUSTOMER_WEEK = 0.03

OUTBOUND_SOURCES = ["outbound_email", "outbound_phone", "linkedin"]
ALL_SOURCES = OUTBOUND_SOURCES + ["seo_tools", "website_demo", "sumup", "referral"]

# ---------------------------------------------------------------- messages
OUTBOUND_MESSAGES = [
    "Money in hours, not months",
    "No percentage cut",
    "GOÄneu ready",
    "AI from Befund to invoice",
]
# Mild effect on reply rate. Billing setup is unknown before a reply, so no split by it.
MESSAGE_REPLY_FACTOR = {
    "AI from Befund to invoice": 1.15,
    "GOÄneu ready": 1.05,
    "No percentage cut": 0.95,
    "Money in hours, not months": 0.90,
}
# Dentists bill under GOZ, so the GOÄneu list never includes them
NOT_FOR_DENTISTS = {"GOÄneu ready"}

SEO_ENTRY_WEIGHTS = {"GOÄ-Rechner": 0.5, "GOÄ-Lexikon": 0.3, "Ratgeber": 0.2}
WEBSITE_MESSAGE = "Demo buchen"
SUMUP_MESSAGE = "SumUp referral"
REFERRAL_MESSAGE = "Customer referral"
KLINIK_MESSAGE = "AI from Befund to invoice"

# ---------------------------------------------------------------- accounts
# Channels bring different customers: segment mix per source (Klinik added separately)
SOURCE_SEGMENT_WEIGHTS = {
    "outbound_email": {"Praxis": 0.85, "MVZ": 0.15},
    "outbound_phone": {"Praxis": 0.78, "MVZ": 0.22},
    "linkedin": {"Praxis": 0.75, "MVZ": 0.25},
    "seo_tools": {"Praxis": 0.92, "MVZ": 0.08},
    "website_demo": {"Praxis": 0.90, "MVZ": 0.10},
    "sumup": {"Praxis": 0.95, "MVZ": 0.05},
    "referral": {"Praxis": 0.90, "MVZ": 0.10},
}
KLINIK_LEADS = 4
KLINIK_SOURCES = ["outbound_phone", "linkedin", "outbound_email"]

SPECIALTY_WEIGHTS = {
    "Allgemeinmedizin": 0.20,
    "Orthopädie": 0.16,
    "Dermatologie": 0.14,
    "Gynäkologie": 0.14,
    "Augenheilkunde": 0.10,
    "HNO": 0.10,
    "Zahnmedizin": 0.16,  # bills under GOZ instead of GOÄ
}

# Same city mix in every segment and channel, so city never drives a finding
CITY_WEIGHTS = {
    "München": 0.40,
    "Berlin": 0.14,
    "Hamburg": 0.092,
    "Düsseldorf": 0.092,
    "Köln": 0.092,
    "Frankfurt": 0.092,
    "Stuttgart": 0.092,
}

BILLING_SETUP_WEIGHTS = {"in_house": 0.65, "external_service": 0.35}

PRAXIS_DOCTORS_WEIGHTS = {1: 0.55, 2: 0.30, 3: 0.15}
MVZ_DOCTORS_RANGE = (4, 15)
KLINIK_DOCTORS_RANGE = (40, 150)

# ---------------------------------------------------------------- stage probabilities
# Finding 1: each channel leaks at a different stage.
# Outbound email is weak at lead -> demo booked, SEO drops after the demo, SumUp is steady.
P_BOOK = {  # lead -> demo booked (website leads start at demo booked)
    "outbound_email": 0.17,
    "outbound_phone": 0.30,
    "linkedin": 0.26,
    "seo_tools": 0.45,
    "website_demo": 1.00,
    "sumup": 0.65,
    "referral": 0.75,
}
P_HELD = {  # demo booked -> demo held (the rest are no-shows)
    "outbound_email": 0.82,
    "outbound_phone": 0.85,
    "linkedin": 0.82,
    "seo_tools": 0.80,
    "website_demo": 0.75,
    "sumup": 0.92,
    "referral": 0.92,
}
P_WIN = {  # demo held -> won, before the factors below (scaled x0.7 in v1.1 for realism)
    "outbound_email": 0.35,
    "outbound_phone": 0.34,
    "linkedin": 0.32,
    "seo_tools": 0.10,
    "website_demo": 0.31,
    "sumup": 0.43,
    "referral": 0.43,
}
SEGMENT_WIN_FACTOR = {"Praxis": 1.0, "MVZ": 0.85}

# Finding 2: speed to demo. Days from lead created to demo held -> factor on P_WIN
SPEED_FACTORS = [(7, 1.5), (14, 1.0), (10_000, 0.45)]  # (up to n days, factor)

# Finding 3: message fit depends on billing setup. Factor on P_BOOK for outbound leads
MESSAGE_FIT = {
    ("No percentage cut", "external_service"): 2.2,
    ("No percentage cut", "in_house"): 0.5,
    ("Money in hours, not months", "external_service"): 0.8,
    ("Money in hours, not months", "in_house"): 1.6,
}

P_MAX = 0.95

# ---------------------------------------------------------------- stage durations (days)
# Lognormal: most deals sit near the median, a few take much longer.
# With sigma 0.6, about 1 in 10 deals takes more than twice the median.
SIGMA = 0.6
MAX_DAYS = 150

MEDIAN_LEAD = 5           # lead -> demo booked
MEDIAN_BOOKED = 6         # demo booked -> demo held
MEDIAN_HELD_WON = 18      # demo held -> won
MEDIAN_HELD_LOST = 32     # demo held -> lost (lost deals stall)
MEDIAN_WON_TO_LIVE = 18   # won -> go-live (onboarding, revenue side)

SEGMENT_STAGE_FACTOR = {
    "Praxis": {"lead": 1.0, "booked": 1.0, "held": 1.0, "live": 1.0},
    "MVZ":    {"lead": 1.0, "booked": 1.1, "held": 2.0, "live": 1.8},
}
# Inbound, SumUp and referral leads mainly move faster at the lead stage
FAST_LEAD_SOURCES = {"seo_tools": 0.4, "sumup": 0.4, "referral": 0.4}

NO_RESPONSE_DAYS = 30     # CRM rule: no progress after 30 days -> lost
LEAD_MAX_DAYS = NO_RESPONSE_DAYS

# ---------------------------------------------------------------- lost reasons
SILENT = "Went silent after first reply"
LOST_LEAD_REASONS = {
    SILENT: 0.80,
    "Not a fit (few private patients)": 0.12,
    "Happy with current setup": 0.08,
}
LOST_BOOKED_REASONS = {"No-show": 0.85, "Timing": 0.15}
LOST_HELD_REASONS = {
    "Price": 0.25,
    "Happy with current setup": 0.20,  # becomes "Happy with external billing service" if external
    "PVS integration missing": 0.20,
    "Timing": 0.20,
    "Chose competitor": 0.15,
}
LOST_HELD_REASONS_SEO = {
    "Price": 0.40,
    "Just researching": 0.35,
    "PVS integration missing": 0.10,
    "Timing": 0.10,
    "Chose competitor": 0.05,
}

# ---------------------------------------------------------------- pricing and churn
# EUR per month. clinc from 135 is confirmed, the rest is assumed
TIER_PRICE = {"clinc": 135, "catalys lite": 249, "catalys": 449}
SOURCE_PRAXIS_TIER_WEIGHTS = {
    "outbound_email": {"clinc": 0.30, "catalys lite": 0.35, "catalys": 0.35},
    "outbound_phone": {"clinc": 0.25, "catalys lite": 0.35, "catalys": 0.40},
    "linkedin": {"clinc": 0.25, "catalys lite": 0.35, "catalys": 0.40},
    "seo_tools": {"clinc": 0.45, "catalys lite": 0.35, "catalys": 0.20},
    "website_demo": {"clinc": 0.40, "catalys lite": 0.35, "catalys": 0.25},
    "sumup": {"clinc": 0.45, "catalys lite": 0.35, "catalys": 0.20},
    "referral": {"clinc": 0.30, "catalys lite": 0.35, "catalys": 0.35},
}
MVZ_TIER_WEIGHTS = {"catalys lite": 0.20, "catalys": 0.80}
PRAXIS_EXTRA_DOCTOR_SHARE = 0.5   # each extra doctor adds half the base price
MVZ_PRICE_SHARE_PER_DOCTOR = 0.5  # MVZ pays half the base price per doctor (volume discount)
KLINIK_MRR_RANGE = (6000, 12000)  # placeholder for a custom deal

MONTHLY_CHURN = {"clinc": 0.03, "catalys lite": 0.02, "catalys": 0.02}

# ---------------------------------------------------------------- costs (all invented)
# CAC per channel = (channel cost + sales hours x hourly rate) / won customers in the window
# Payback months = CAC / average MRR of the customers won through that channel
COSTS = {
    "hourly_rate_eur": 45,                       # loaded cost of one sales hour (early team: founders and working students)
    "minutes_per_contact": {                     # average outbound time per contact
        "outbound_email": 4,                     # per prospect: quick research, personal first line, sequence automated
        "outbound_phone": 3,                     # per dial attempt: about 1 in 4 connects (~8 min), the rest ~1 min
        "linkedin": 5,                           # per prospect: profile check, connection request, 1 to 2 follow-ups
    },
    "sales_hours_per_deal_from_demo_booked": 5,  # prep, demo, follow-ups, offer; same for all channels
    "monthly_fixed_eur": {"seo_tools": 2500, "website_demo": 200},  # SEO: content and tools; website: hosting and tools
    "fee_per_won_eur": {"sumup": 0, "referral": 0},  # partner and referral terms are unknown, so none are assumed
    "window_months": WINDOW_MONTHS,
}

# ---------------------------------------------------------------- names (fictional)
PRAXIS_PREFIX = {
    "Allgemeinmedizin": "Hausarztpraxis",
    "Orthopädie": "Orthopädie",
    "Dermatologie": "Hautarztpraxis",
    "Gynäkologie": "Frauenarztpraxis",
    "Augenheilkunde": "Augenarztpraxis",
    "HNO": "HNO-Praxis",
    "Zahnmedizin": "Zahnarztpraxis",
}
PLACE_SUFFIXES = [
    "am Stadtpark", "am Marktplatz", "am Rosengarten", "Lindenhof", "im Westend",
    "am Bahnhof", "an der Oper", "am Lindenplatz", "Sonnenhof", "am Kirchplatz",
    "im Zentrum", "am Schlossgarten", "am Hofgarten", "am Wasserturm", "am Ring",
    "an der Allee", "am Mühlbach", "Eichenhof", "am Rathaus", "Kastanienhof",
    "am Brunnen", "am Theater", "Ahornhof", "am Südpark", "am Nordpark",
    "an der Brücke", "am Uferweg", "Birkenhof", "am Gartentor", "am Kreuzweg",
]
MVZ_PLACES = {
    "München": ["Isartal", "Würmtal", "Schwabing", "Lehel", "Nymphenburg", "Haidhausen", "Bogenhausen", "Sendling"],
    "Berlin": ["Spreebogen", "Havelblick", "Prenzlauer Berg", "Charlottenburg", "Kreuzberg"],
    "Hamburg": ["Alstertal", "Elbufer", "Eppendorf", "Winterhude"],
    "Düsseldorf": ["Rheinblick", "Oberkassel", "Benrath", "Pempelfort"],
    "Köln": ["Domblick", "Rheinauen", "Ehrenfeld", "Lindenthal"],
    "Frankfurt": ["Mainufer", "Taunusblick", "Sachsenhausen", "Bornheim"],
    "Stuttgart": ["Neckartal", "Killesberg", "Degerloch", "Vaihingen"],
}
KLINIK_NAMES = ["Klinikum Nordstadt", "Fachklinik am Kurpark", "Klinik Lindenallee", "Kreisklinik Seeblick"]

DISCLAIMER = (
    "All data is synthetic and generated by a script for illustration. "
    "It does not reflect real figures of Catalys or any other company. Not affiliated with Catalys."
)
ASSUMPTIONS = [
    "Lead volumes, reply rates, conversion rates, stage durations, deal sizes and churn are invented.",
    "Tier prices are assumed, except clinc from 135 EUR/month (public list price).",
    "Channel costs, sales hours and the hourly rate used for CAC and payback are invented.",
    "CAC leaves out founder salaries, sales tools, management time and onboarding, so real CAC is higher.",
    "Account names are fictional and built from generic place names.",
    "Lead sources and messages reflect channels visible on the Catalys website; their performance is invented.",
    "Kliniken are shown as early conversations only; their deal values are placeholders.",
]
