#!/usr/bin/env python3
"""
Company Portal - Company Name
Shared web server with login and per-section access control.
Python 3.9+ standard library only (no installs needed).

    python server.py            -> http://localhost:8080
    config.txt  PORT=...        -> the port (a random free port is chosen and saved on first start)

Data is stored next to this file:
    data/coa.db       users, access rights, applications (SQLite)
    data/uploads/     attached documents: uploads/<Form No>/<Section>/<original file name>

Roles
    superadmin  everything; the only role that manages users, roles and section access
    admin       sees every application and section; edits sections they have access to
                (even after submission); can reopen submitted sections and cancel applications (nothing is ever deleted)
    user        works on the same applications as admins, but sees only the sections where they
                have "Submit Detail"; a section locks on their submit and they may resubmit it N times
    viewer      read-only, sees everything
"""
import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import smtplib
import socket
import ssl
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from datetime import date
from email.message import EmailMessage
from email.utils import formataddr
from http import cookies
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(BASE, "public")
DATA = os.environ.get("COA_DATA") or os.path.join(BASE, "data")
UPLOADS = os.path.join(DATA, "uploads")
DB_PATH = os.path.join(DATA, "coa.db")
CONFIG = os.path.join(BASE, "config.txt")


def _port_free(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s_:
        try:
            s_.bind(("0.0.0.0", port))
            return True
        except OSError:
            return False


def load_port():
    """Port order: COA_PORT environment setting > PORT= in config.txt > random free port (saved to config.txt)."""
    if os.environ.get("COA_PORT"):
        return int(os.environ["COA_PORT"])
    if os.path.isfile(CONFIG):
        # utf-8-sig: also reads files saved by Notepad with a byte-order mark
        with open(CONFIG, encoding="utf-8-sig", errors="replace") as fh:
            for line in fh:
                key, _, val = line.partition("=")
                if key.strip().upper() == "PORT" and val.strip().isdigit() and 1 <= int(val.strip()) <= 65535:
                    return int(val.strip())
        # never overwrite a config.txt someone has edited
        print("=" * 60)
        print(" config.txt has no valid line like  PORT=8080  (number 1024-65535).")
        print(" Please fix config.txt in this folder, save it, and start again.")
        print("=" * 60)
        sys.exit(1)
    import random
    while True:
        port = random.randint(20000, 49151)
        if _port_free(port):
            break
    with open(CONFIG, "w", encoding="utf-8") as fh:
        fh.write("# Company Portal - settings\n"
                 "# PORT: the port the website runs on (1024-65535). Change it, save, then restart the server.\n"
                 f"PORT={port}\n")
    return port


PORT = load_port()


def load_bind():
    """BIND= in config.txt: 0.0.0.0 (default, office network) or 127.0.0.1 (only this PC - e.g. Cloudflare Tunnel)."""
    if os.path.isfile(CONFIG):
        with open(CONFIG, encoding="utf-8-sig", errors="replace") as fh:
            for line in fh:
                key, _, val = line.partition("=")
                if key.strip().upper() == "BIND" and val.strip() in ("0.0.0.0", "127.0.0.1"):
                    return val.strip()
    return "0.0.0.0"


BIND = load_bind()

SESSION_SECONDS = 12 * 3600
MAX_JSON = 5 * 1024 * 1024
MAX_UPLOAD = 100 * 1024 * 1024
MAX_VALUE = 5000
PBKDF2_ITER = 240_000
ROLES = ("superadmin", "admin", "user", "viewer")
COOKIE = "coa_session"

# Which fields belong to which form section (generated from public/app.js - keep in sync).
with open(os.path.join(BASE, "sections.json"), encoding="utf-8") as fh:
    SECTIONS = json.load(fh)
DATA_SEC, CHECK_SEC, REMARK_SEC, FILE_SEC = {}, {}, {}, {}
for _sid, _s in SECTIONS.items():
    for _k in _s["data"]:
        DATA_SEC[_k] = _sid
    for _k in _s["checks"]:
        CHECK_SEC[_k] = _sid
    for _k in _s["remarks"]:
        REMARK_SEC[_k] = _sid
    for _k in _s["files"]:
        FILE_SEC[_k] = _sid
# Free-text fields are always saved in CAPITAL LETTERS (dropdowns, dates and amounts are left as they are).
UPPER_KEYS = {k for _s in SECTIONS.values() for k in _s.get("upper", [])}


def upper_if_text(key, v):
    return v.upper() if key in UPPER_KEYS else v


# Always shown in lists so everyone can identify an application and its status.
SUMMARY_KEYS = ("equipmentName", "companyModel", "appType", "coaNo", "stStatus", "coaExpiry", "prevCoaNo", "stEcos", "ecosStatus",
                "ecosCoaNo", "ecosCoaExpiry")
# Section I has an ST tab and an eCOS tab (Section B "ST / eCOS" decides which are used)
ST_ONLY = ("ePermitDate", "ePermitNo", "submittedBy", "submittedDate", "stFee", "stFeeDate", "paymentRef", "stStatus",
           "terFee", "terFeeDate", "coaFee", "coaNo", "coaIssue", "coaExpiry")
ECOS_ONLY = ("ecosEPermitDate", "ecosEPermitNo", "ecosSubmittedBy", "ecosSubmittedDate", "ecosFee", "ecosFeeDate",
             "ecosPaymentRef", "ecosStatus", "ecosTerFee", "ecosTerFeeDate", "ecosCoaFee", "ecosCoaNo", "ecosCoaIssue", "ecosCoaExpiry")
STATUS_KEYS = ("stStatus", "ecosStatus")


def st_ecos_ticks(data):
    t = [x.strip().lower() for x in re.split(r"[,/;]+", str(data.get("stEcos") or "")) if x.strip()]
    t = ["ecos" if re.match(r"e[\s-]*cos", x) else x for x in t]          # also old text like "ECOS-2026-00123"
    has = lambda keys: any(str(data.get(k) or "").strip() for k in keys if k not in STATUS_KEYS)   # details already filled in
    return (not t or "st" in t or has(ST_ONLY)), ("ecos" in t or has(ECOS_ONLY))   # (ST shown, eCOS shown); nothing ticked = ST


def coas_of(data):
    """The COA(s) of a form: [("ST", coa no, expiry), ("eCOS", coa no, expiry)] - only the ticked ones."""
    st, ecos = st_ecos_ticks(data)
    return ([("ST", data.get("coaNo") or "", data.get("coaExpiry") or "")] if st else []) + \
           ([("eCOS", data.get("ecosCoaNo") or "", data.get("ecosCoaExpiry") or "")] if ecos else [])

# Choices for dropdowns / suggestion lists (editable by the Super Admin under Settings).
DEFAULT_OPTIONS = {
    "hrRoles": [],                              # HR Setting: job roles of staff
    "hrOutlets": [],                            # HR Setting: [{"code": "KL01", "name": "Kuala Lumpur", "state": "Kuala Lumpur", "hours": {...}}, ...]
    "hrDepartments": ["Account", "Audit", "Director Board", "Human Resource", "Information Technology", "Logistics",
                      "Marketing", "Operation", "Purchase", "Warehouse"],     # HR Setting: Department list (Memo "Who can view")
    "hrPosDept": {},                            # HR Setting: {"Cashier": "Operation", ...} - the department of each position
    "hrPosParent": {},                          # {"Cashier": "Branch Manager", ...} - the position each position reports to
    "inspLocations": [{"name": "COMPANY NAME SDN BHD",
                       "addr1": "ADDRESS LINE 1,", "addr2": "ADDRESS LINE 2,",
                       "addr3": "POSTCODE CITY, STATE.", "contactA": "", "contactB": "", "telA": "", "telB": "",
                       "emailA": "", "emailB": "", "hpA": "", "hpB": ""}],
    "appType": ["New Application", "Renewal", "Amendment / Modification"],
    "purpose": ["Import for Sale", "Local Manufacturing", "Sample / Testing", "Re-export", "Other"],
    "productCategory": ["Household Appliance", "Lighting", "Power Supply / Adaptor", "Audio / Video Equipment", "IT Equipment",
                        "Cable / Wiring Accessory", "Fan", "Air Conditioner", "Refrigerator", "Television", "Rice Cooker",
                        "Electric Kettle", "Water Heater"],
    "productClass": ["Class I", "Class II", "Class III", "Other"],
    "country": ["China", "Malaysia", "Taiwan", "Hong Kong", "Thailand", "Vietnam", "Indonesia", "Japan", "Korea",
                "Singapore", "India", "Germany", "USA"],
    # Ports: UN/LOCODE code, name, country (Port of Loading is filtered by Country of Shipment,
    # Port of Arrival shows Malaysian ports)
    "ports": [
        {"code": "MYPKG", "name": "Port Klang", "country": "Malaysia"},
        {"code": "MYPGU", "name": "Pasir Gudang (Johor Port)", "country": "Malaysia"},
        {"code": "MYTPP", "name": "Tanjung Pelepas", "country": "Malaysia"},
        {"code": "MYJHB", "name": "Johor Bahru", "country": "Malaysia"},
        {"code": "MYPEN", "name": "Penang", "country": "Malaysia"},
        {"code": "MYBWH", "name": "Butterworth", "country": "Malaysia"},
        {"code": "MYMKZ", "name": "Melaka", "country": "Malaysia"},
        {"code": "MYKUA", "name": "Kuantan", "country": "Malaysia"},
        {"code": "MYKEM", "name": "Kemaman", "country": "Malaysia"},
        {"code": "MYBTU", "name": "Bintulu", "country": "Malaysia"},
        {"code": "MYKCH", "name": "Kuching", "country": "Malaysia"},
        {"code": "MYSBW", "name": "Sibu", "country": "Malaysia"},
        {"code": "MYMYY", "name": "Miri", "country": "Malaysia"},
        {"code": "MYLBU", "name": "Labuan", "country": "Malaysia"},
        {"code": "MYBKI", "name": "Kota Kinabalu", "country": "Malaysia"},
        {"code": "MYSDK", "name": "Sandakan", "country": "Malaysia"},
        {"code": "MYTWU", "name": "Tawau", "country": "Malaysia"},
        {"code": "MYKUL", "name": "KLIA – Kuala Lumpur (Air)", "country": "Malaysia"},
        {"code": "MYSZB", "name": "Subang (Air)", "country": "Malaysia"},
        {"code": "CNSHA", "name": "Shanghai", "country": "China"},
        {"code": "CNNGB", "name": "Ningbo", "country": "China"},
        {"code": "CNSZX", "name": "Shenzhen", "country": "China"},
        {"code": "CNYTN", "name": "Yantian", "country": "China"},
        {"code": "CNSHK", "name": "Shekou", "country": "China"},
        {"code": "CNCAN", "name": "Guangzhou", "country": "China"},
        {"code": "CNNSA", "name": "Nansha", "country": "China"},
        {"code": "CNXMN", "name": "Xiamen", "country": "China"},
        {"code": "CNTAO", "name": "Qingdao", "country": "China"},
        {"code": "CNTXG", "name": "Tianjin Xingang", "country": "China"},
        {"code": "CNDLC", "name": "Dalian", "country": "China"},
        {"code": "CNFOC", "name": "Fuzhou", "country": "China"},
        {"code": "CNZUH", "name": "Zhuhai", "country": "China"},
        {"code": "CNZSN", "name": "Zhongshan", "country": "China"},
        {"code": "CNJMN", "name": "Jiangmen", "country": "China"},
        {"code": "CNLYG", "name": "Lianyungang", "country": "China"},
        {"code": "HKHKG", "name": "Hong Kong", "country": "Hong Kong"},
        {"code": "TWKHH", "name": "Kaohsiung", "country": "Taiwan"},
        {"code": "TWKEL", "name": "Keelung", "country": "Taiwan"},
        {"code": "TWTXG", "name": "Taichung", "country": "Taiwan"},
        {"code": "SGSIN", "name": "Singapore", "country": "Singapore"},
        {"code": "THLCH", "name": "Laem Chabang", "country": "Thailand"},
        {"code": "THBKK", "name": "Bangkok", "country": "Thailand"},
        {"code": "VNHPH", "name": "Haiphong", "country": "Vietnam"},
        {"code": "VNSGN", "name": "Ho Chi Minh City", "country": "Vietnam"},
        {"code": "VNCMT", "name": "Cai Mep", "country": "Vietnam"},
        {"code": "IDJKT", "name": "Jakarta (Tanjung Priok)", "country": "Indonesia"},
        {"code": "IDSUB", "name": "Surabaya", "country": "Indonesia"},
        {"code": "JPTYO", "name": "Tokyo", "country": "Japan"},
        {"code": "JPYOK", "name": "Yokohama", "country": "Japan"},
        {"code": "JPOSA", "name": "Osaka", "country": "Japan"},
        {"code": "JPUKB", "name": "Kobe", "country": "Japan"},
        {"code": "JPNGO", "name": "Nagoya", "country": "Japan"},
        {"code": "KRPUS", "name": "Busan", "country": "Korea"},
        {"code": "KRINC", "name": "Incheon", "country": "Korea"},
        {"code": "INNSA", "name": "Nhava Sheva", "country": "India"},
        {"code": "INMAA", "name": "Chennai", "country": "India"},
        {"code": "DEHAM", "name": "Hamburg", "country": "Germany"},
        {"code": "DEBRV", "name": "Bremerhaven", "country": "Germany"},
        {"code": "USLAX", "name": "Los Angeles", "country": "USA"},
        {"code": "USLGB", "name": "Long Beach", "country": "USA"},
        {"code": "USNYC", "name": "New York", "country": "USA"},
    ],
    "stStatus": ["Not Submitted", "Submitted", "Under Evaluation", "Query / Additional Info Required", "Approved", "Rejected"],
}
# Choices the system relies on - they can be reordered but never removed.
LOCKED_OPTIONS = {
    "appType": ["Renewal"],
    "stStatus": ["Not Submitted", "Submitted", "Under Evaluation", "Query / Additional Info Required", "Approved", "Rejected"],
}

# Types that may be shown inside the browser; everything else is downloaded.
INLINE_TYPES = {"application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"}
STATIC_TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
                ".js": "application/javascript; charset=utf-8", ".png": "image/png",
                ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json"}

SCHEMA = """
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL COLLATE NOCASE, name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', pw_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at REAL NOT NULL, last_login REAL);
CREATE TABLE IF NOT EXISTS sessions(
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires REAL NOT NULL);
CREATE TABLE IF NOT EXISTS apps(
  id TEXT PRIMARY KEY, form_no TEXT NOT NULL, date_apply TEXT,
  data TEXT NOT NULL DEFAULT '{}', checks TEXT NOT NULL DEFAULT '{}', remarks TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at REAL, updated_by INTEGER, updated_at REAL);
CREATE TABLE IF NOT EXISTS files(
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, field TEXT NOT NULL, name TEXT NOT NULL,
  type TEXT, size INTEGER, uploaded_by INTEGER, uploaded_at REAL);
CREATE INDEX IF NOT EXISTS files_app ON files(app_id);
CREATE TABLE IF NOT EXISTS section_access(
  user_id INTEGER NOT NULL, section TEXT NOT NULL,
  can_edit INTEGER NOT NULL DEFAULT 0, can_check INTEGER NOT NULL DEFAULT 0, resubmits INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, section));
CREATE TABLE IF NOT EXISTS section_status(
  app_id TEXT NOT NULL, section TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  submit_count INTEGER NOT NULL DEFAULT 0, submitted_by INTEGER, submitted_at REAL,
  PRIMARY KEY(app_id, section));
CREATE TABLE IF NOT EXISTS contributors(
  app_id TEXT NOT NULL, user_id INTEGER NOT NULL, PRIMARY KEY(app_id, user_id));
CREATE TABLE IF NOT EXISTS person_status(
  app_id TEXT NOT NULL, section TEXT NOT NULL, user_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
  PRIMARY KEY(app_id, section, user_id));
CREATE TABLE IF NOT EXISTS section_log(
  id INTEGER PRIMARY KEY, app_id TEXT NOT NULL, section TEXT NOT NULL, user_id INTEGER, action TEXT, at REAL);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY, app_id TEXT NOT NULL, at REAL NOT NULL, user_id INTEGER, action TEXT NOT NULL,
  section TEXT, field TEXT, old_value TEXT, new_value TEXT);
CREATE INDEX IF NOT EXISTS audit_app ON audit_log(app_id, at);
CREATE TABLE IF NOT EXISTS option_lists(
  list_key TEXT PRIMARY KEY, items TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS app_settings(
  key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS eb_batches(
  id TEXT PRIMARY KEY, batch_no TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', from_name TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft',
  created_by INTEGER, created_at REAL, updated_by INTEGER, updated_at REAL, sent_by INTEGER, started_at REAL, finished_at REAL,
  cancelled_at REAL, cancelled_by INTEGER);
CREATE TABLE IF NOT EXISTS mc_requests(
  id TEXT PRIMARY KEY, doc_no TEXT NOT NULL UNIQUE, doc_type TEXT NOT NULL DEFAULT 'MC', omc_no TEXT NOT NULL DEFAULT '',
  staff_code TEXT NOT NULL, staff_name TEXT NOT NULL DEFAULT '', outlet TEXT NOT NULL DEFAULT '', leave_no TEXT NOT NULL DEFAULT '',
  date_apply TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'submitted', lead_days INTEGER NOT NULL DEFAULT 30,
  submitted_by INTEGER, submitted_at REAL, approved_by INTEGER, approved_at REAL, rejected_by INTEGER, rejected_at REAL,
  reject_reason TEXT NOT NULL DEFAULT '', received_by INTEGER, received_at REAL, reminded_at REAL,
  updated_by INTEGER, updated_at REAL);
CREATE TABLE IF NOT EXISTS mc_files(
  id TEXT PRIMARY KEY, mc_id TEXT NOT NULL, name TEXT NOT NULL, type TEXT, size INTEGER, path TEXT,
  uploaded_by INTEGER, uploaded_at REAL, removed_at REAL, removed_by INTEGER);
CREATE TABLE IF NOT EXISTS tr_docs(
  id TEXT PRIMARY KEY, doc_no TEXT NOT NULL UNIQUE, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'drafted',
  data TEXT NOT NULL DEFAULT '{}', outlet_sign TEXT NOT NULL DEFAULT '{}', hr_sign TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER, created_at REAL, updated_by INTEGER, updated_at REAL, processing_at REAL, completed_at REAL,
  completed_by INTEGER, checked_by INTEGER, checked_at REAL, cancel_reason TEXT, cancelled_by INTEGER, cancelled_at REAL);
CREATE TABLE IF NOT EXISTS tr_files(
  id TEXT PRIMARY KEY, tr_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, type TEXT, size INTEGER, path TEXT,
  uploaded_by INTEGER, uploaded_at REAL, removed_at REAL, removed_by INTEGER);
CREATE TABLE IF NOT EXISTS ta_docs(
  id TEXT PRIMARY KEY, doc_no TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'draft', rows TEXT NOT NULL DEFAULT '[]',
  agreed INTEGER NOT NULL DEFAULT 0, returned_by TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at REAL,
  updated_by INTEGER, updated_at REAL, submitted_at REAL, processing_at REAL, completed_by INTEGER, completed_at REAL,
  acknowledged_by INTEGER, acknowledged_at REAL, cancel_reason TEXT, cancelled_by INTEGER, cancelled_at REAL);
CREATE TABLE IF NOT EXISTS ta_files(
  id TEXT PRIMARY KEY, ta_id TEXT NOT NULL, row_uid TEXT NOT NULL, name TEXT NOT NULL, type TEXT, size INTEGER, path TEXT,
  uploaded_by INTEGER, uploaded_at REAL, removed_at REAL, removed_by INTEGER);
CREATE TABLE IF NOT EXISTS memos(
  id TEXT PRIMARY KEY, doc_no TEXT NOT NULL UNIQUE, kind TEXT NOT NULL DEFAULT 'manual', title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'processing',
  approver_id INTEGER, approved_by INTEGER, approved_at REAL, signature TEXT, posted_by INTEGER, posted_at REAL,
  cancel_reason TEXT, cancelled_by INTEGER, cancelled_at REAL, created_by INTEGER, created_at REAL, updated_by INTEGER, updated_at REAL);
CREATE TABLE IF NOT EXISTS memo_files(
  id TEXT PRIMARY KEY, memo_id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, type TEXT, size INTEGER, path TEXT,
  uploaded_by INTEGER, uploaded_at REAL, removed_at REAL, removed_by INTEGER);
CREATE TABLE IF NOT EXISTS memo_reads(memo_id TEXT NOT NULL, user_id INTEGER NOT NULL, at REAL, PRIMARY KEY(memo_id, user_id));
CREATE TABLE IF NOT EXISTS user_signatures(user_id INTEGER PRIMARY KEY, image TEXT NOT NULL, updated_at REAL);
CREATE TABLE IF NOT EXISTS access_roles(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, rights TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER, created_at REAL, updated_by INTEGER, updated_at REAL);
CREATE TABLE IF NOT EXISTS hr_staff(
  id TEXT PRIMARY KEY, staff_id TEXT NOT NULL, role TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  full_name TEXT NOT NULL DEFAULT '', outlet_code TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at REAL,
  updated_by INTEGER, updated_at REAL, removed_at REAL, removed_by INTEGER);
CREATE UNIQUE INDEX IF NOT EXISTS hr_staff_sid ON hr_staff(staff_id COLLATE NOCASE);
CREATE TABLE IF NOT EXISTS eb_recipients(
  id TEXT PRIMARY KEY, batch_id TEXT NOT NULL, row_no INTEGER NOT NULL, email TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending', error TEXT, sent_at REAL,
  sent_subject TEXT, sent_html TEXT);
CREATE INDEX IF NOT EXISTS eb_rec_batch ON eb_recipients(batch_id, row_no);
CREATE TABLE IF NOT EXISTS save_events(
  id INTEGER PRIMARY KEY, program TEXT NOT NULL, doc_id TEXT NOT NULL, user_id INTEGER NOT NULL, at REAL NOT NULL, sent_at REAL);
CREATE TABLE IF NOT EXISTS alert_log(
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, doc_id TEXT NOT NULL, tag TEXT NOT NULL DEFAULT '', sent_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS alert_doc ON alert_log(kind, doc_id);
CREATE TABLE IF NOT EXISTS wh_manifests(
  id TEXT PRIMARY KEY, doc_no TEXT NOT NULL UNIQUE, title TEXT NOT NULL DEFAULT '', doc_title TEXT NOT NULL DEFAULT '',
  mdate TEXT NOT NULL DEFAULT '', channel TEXT NOT NULL DEFAULT '', courier TEXT NOT NULL DEFAULT '',
  allow_edit INTEGER NOT NULL DEFAULT 1, remark TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at REAL,
  updated_by INTEGER, updated_at REAL, cancel_reason TEXT, cancelled_by INTEGER, cancelled_at REAL);
CREATE TABLE IF NOT EXISTS wh_parcels(
  id TEXT PRIMARY KEY, manifest_id TEXT NOT NULL, tracking TEXT NOT NULL, scanned_by INTEGER, scanned_at REAL,
  removed_by INTEGER, removed_at REAL);
CREATE INDEX IF NOT EXISTS wh_parcels_m ON wh_parcels(manifest_id, scanned_at);
CREATE INDEX IF NOT EXISTS wh_parcels_t ON wh_parcels(tracking);
CREATE TABLE IF NOT EXISTS drive_files(
  file_id TEXT PRIMARY KEY, program TEXT NOT NULL, drive_id TEXT, url TEXT, at REAL,
  trashed INTEGER NOT NULL DEFAULT 0, error TEXT);
CREATE TABLE IF NOT EXISTS sirim(
  id TEXT PRIMARY KEY, form_no TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER, created_at REAL, updated_by INTEGER, updated_at REAL,
  cancelled_at REAL, cancelled_by INTEGER, cancel_reason TEXT);
CREATE TABLE IF NOT EXISTS sirim_files(
  id TEXT PRIMARY KEY, sirim_id TEXT NOT NULL, field TEXT NOT NULL, name TEXT NOT NULL, type TEXT, size INTEGER,
  uploaded_by INTEGER, uploaded_at REAL, note TEXT, path TEXT);
CREATE INDEX IF NOT EXISTS sirim_files_form ON sirim_files(sirim_id);
CREATE TABLE IF NOT EXISTS doc_versions(
  id INTEGER PRIMARY KEY, program TEXT NOT NULL, doc_id TEXT NOT NULL, version_no INTEGER NOT NULL,
  at REAL NOT NULL, user_id INTEGER, action TEXT NOT NULL, changes TEXT NOT NULL DEFAULT '[]', snapshot TEXT NOT NULL,
  UNIQUE(program, doc_id, version_no));
CREATE TABLE IF NOT EXISTS program_access(
  user_id INTEGER NOT NULL, program TEXT NOT NULL, can_create INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, program));
"""

# ---------------------------------------------------------------- database
os.makedirs(UPLOADS, exist_ok=True)
CONN = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=30)   # wait up to 30 s if the database is busy
CONN.row_factory = sqlite3.Row
# Another program (e.g. DB Browser with unsaved changes) may hold the database. Wait for it instead of stopping.
_told = False
CONN.execute("PRAGMA busy_timeout = 2000")      # check quickly at start, so the message shows at once
while True:
    try:
        CONN.execute("BEGIN IMMEDIATE")
        CONN.execute("ROLLBACK")
        break
    except sqlite3.OperationalError as _e:
        if "locked" not in str(_e) and "busy" not in str(_e):
            raise
        if not _told:
            print("The database is locked by another program (for example DB Browser with unsaved changes).\n"
                  "In DB Browser press 'Write Changes' or 'Revert Changes' and close it - the server starts by itself.")
            _told = True
        time.sleep(3)
CONN.execute("PRAGMA busy_timeout = 30000")     # while running: wait up to 30 s for a busy database
if _told:
    print("Database is free again - starting.")
CONN.executescript(SCHEMA)
if "email" not in {r["name"] for r in CONN.execute("PRAGMA table_info(users)")}:
    CONN.execute("ALTER TABLE users ADD COLUMN email TEXT")          # for the email alerts
if "alert_prefs" not in {r["name"] for r in CONN.execute("PRAGMA table_info(users)")}:
    CONN.execute("ALTER TABLE users ADD COLUMN alert_prefs TEXT")    # which alerts this person receives (JSON)
# Applications are never deleted - they can only be cancelled (kept in the database, read-only).
_cols = {r["name"] for r in CONN.execute("PRAGMA table_info(apps)")}
for _col, _type in (("cancelled_at", "REAL"), ("cancelled_by", "INTEGER"), ("cancel_reason", "TEXT")):
    if _col not in _cols:
        CONN.execute(f"ALTER TABLE apps ADD COLUMN {_col} {_type}")
if "last_seen" not in {r["name"] for r in CONN.execute("PRAGMA table_info(sessions)")}:
    CONN.execute("ALTER TABLE sessions ADD COLUMN last_seen REAL")      # automatic sign-out after inactivity
CONN.execute("DELETE FROM sessions WHERE expires < ?", (time.time(),))
# Upgrade from the version without Super Admin: the first administrator becomes Super Admin.
if not CONN.execute("SELECT 1 FROM users WHERE role='superadmin'").fetchone():
    CONN.execute("UPDATE users SET role='superadmin' WHERE id=(SELECT MIN(id) FROM users WHERE role='admin')")
if "can_view" not in {r["name"] for r in CONN.execute("PRAGMA table_info(section_access)")}:
    CONN.execute("ALTER TABLE section_access ADD COLUMN can_view INTEGER NOT NULL DEFAULT 0")   # "View Only"
if "must_change_pw" not in {r["name"] for r in CONN.execute("PRAGMA table_info(users)")}:
    CONN.execute("ALTER TABLE users ADD COLUMN must_change_pw INTEGER NOT NULL DEFAULT 0")   # first sign-in / reset
_fcols = {r["name"] for r in CONN.execute("PRAGMA table_info(files)")}
if "note" not in _fcols:
    CONN.execute("ALTER TABLE files ADD COLUMN note TEXT")
if "path" not in _fcols:
    CONN.execute("ALTER TABLE files ADD COLUMN path TEXT")   # location inside uploads/, e.g. COMPANY-COA-008/E. .../x.pdf
if "access_role" not in {r["name"] for r in CONN.execute("PRAGMA table_info(users)")}:
    CONN.execute("ALTER TABLE users ADD COLUMN access_role INTEGER")     # Access Role (set of rights) the person follows
_hrc = {r["name"] for r in CONN.execute("PRAGMA table_info(hr_staff)")}
for _col in ("joined_date", "resigned_date", "ic_no", "cover_branches", "cover_depts"):   # Staff Master Data: dates, IC, coverage
    if _col not in _hrc:
        CONN.execute(f"ALTER TABLE hr_staff ADD COLUMN {_col} TEXT NOT NULL DEFAULT ''")
if not CONN.execute("SELECT 1 FROM app_settings WHERE key='mc_status_v2'").fetchone():   # MC: Submitted / Processing split
    CONN.execute("UPDATE mc_requests SET status='submitted' WHERE status='processing'")
    CONN.execute("INSERT INTO app_settings(key, value) VALUES('mc_status_v2', '1')")
_ebc = {r["name"] for r in CONN.execute("PRAGMA table_info(eb_batches)")}
for _col, _type in (("note", "TEXT"), ("wait_until", "REAL")):          # Email Batch: why it waits / is paused
    if _col not in _ebc:
        CONN.execute(f"ALTER TABLE eb_batches ADD COLUMN {_col} {_type}")
_mmc = {r["name"] for r in CONN.execute("PRAGMA table_info(memos)")}
if "lang" not in _mmc:                          # the language a memo is written in, and its translations
    CONN.execute("ALTER TABLE memos ADD COLUMN lang TEXT NOT NULL DEFAULT 'en'")
if "translations" not in _mmc:
    CONN.execute("ALTER TABLE memos ADD COLUMN translations TEXT NOT NULL DEFAULT '{}'")
for _t in ("files", "sirim_files"):            # removed files stay on disk for the document versions
    _tc = {r["name"] for r in CONN.execute(f"PRAGMA table_info({_t})")}
    if "removed_at" not in _tc:
        CONN.execute(f"ALTER TABLE {_t} ADD COLUMN removed_at REAL")
        CONN.execute(f"ALTER TABLE {_t} ADD COLUMN removed_by INTEGER")


_BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}


def safe_name(name, fallback="file", folder=False):
    """A file/folder name that is valid on Windows and cannot escape its folder."""
    name = _BAD_CHARS.sub("_", name or "").strip().strip(".")
    stem, ext = (name, "") if folder else os.path.splitext(name)
    if stem.upper() in _RESERVED:
        stem = "_" + stem
    stem = stem[:120].strip() or fallback
    return stem + ext[:15]


def storage_path(form_no, section, filename):
    """Pick a free path uploads/<Form No>/<X. Section name>/<filename>; adds ' (2)', ' (3)' ... if the name is taken."""
    sec_dir = f"{section}. {SECTIONS[section]['name']}" if section in SECTIONS else "Other"
    folder = os.path.join(safe_name(form_no, "application", True), safe_name(sec_dir, "section", True))
    os.makedirs(os.path.join(UPLOADS, folder), exist_ok=True)
    stem, ext = os.path.splitext(safe_name(filename))
    rel, n = os.path.join(folder, stem + ext), 1
    while os.path.exists(os.path.join(UPLOADS, rel)) or os.path.exists(os.path.join(UPLOADS, rel + ".part")):
        n += 1
        rel = os.path.join(folder, f"{stem} ({n}){ext}")
    return rel


def file_disk_path(f):
    """Absolute path of a stored file (old uploads were saved as uploads/<id>)."""
    full = os.path.normpath(os.path.join(UPLOADS, f["path"] or f["id"]))
    if not full.startswith(os.path.normpath(UPLOADS) + os.sep):
        raise HTTPError(404, "File not found.")
    return full


# Move files uploaded before this change (uploads/<id>, no file type) into the readable layout.
for _f in CONN.execute("SELECT f.*, a.form_no FROM files f LEFT JOIN apps a ON a.id = f.app_id WHERE f.path IS NULL").fetchall():
    _old = os.path.join(UPLOADS, _f["id"])
    if os.path.isfile(_old):
        _rel = storage_path(_f["form_no"] or _f["app_id"], FILE_SEC.get(_f["field"]), _f["name"])
        try:
            os.replace(_old, os.path.join(UPLOADS, _rel))
        except OSError as _e:      # e.g. the file is open in a PDF viewer - try again next start
            print(f"Could not move {_f['name']} yet: {_e}")
            continue
        CONN.execute("UPDATE files SET path=? WHERE id=?", (_rel, _f["id"]))
if not CONN.execute("SELECT 1 FROM person_status LIMIT 1").fetchone():
    CONN.execute("INSERT OR IGNORE INTO person_status(app_id, section, user_id, status) "
                 "SELECT app_id, section, submitted_by, 'submitted' FROM section_status "
                 "WHERE status='submitted' AND submitted_by IS NOT NULL")
# First start with the audit trail: record what is already known (creation + past submissions).
if not CONN.execute("SELECT 1 FROM audit_log LIMIT 1").fetchone():
    CONN.execute("INSERT INTO audit_log(app_id, at, user_id, action) SELECT id, created_at, created_by, 'create' FROM apps")
    CONN.execute("INSERT INTO audit_log(app_id, at, user_id, action, section) SELECT app_id, at, user_id, action, section FROM section_log")
    CONN.execute("INSERT INTO audit_log(app_id, at, user_id, action, new_value) "
                 "SELECT id, cancelled_at, cancelled_by, 'cancel', cancel_reason FROM apps WHERE cancelled_at IS NOT NULL")
CONN.commit()
LOCK = threading.RLock()


class DB:
    """`with DB() as c:` - serialised access + commit/rollback."""
    def __enter__(self):
        LOCK.acquire()
        return CONN

    def __exit__(self, exc_type, exc, tb):
        try:
            CONN.rollback() if exc_type else CONN.commit()
        finally:
            LOCK.release()


class HTTPError(Exception):
    def __init__(self, status, message, extra=None):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra or {}


# ---------------------------------------------------------------- helpers
def hash_pw(pw):
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, PBKDF2_ITER)
    return f"pbkdf2${PBKDF2_ITER}${salt.hex()}${dk.hex()}"


def check_pw(pw, stored):
    try:
        _, it, salt, h = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(it))
        return hmac.compare_digest(dk.hex(), h)
    except Exception:
        return False


def validate_pw(pw):
    """At least 10 characters with letters and numbers (the system is reachable from the internet)."""
    if not isinstance(pw, str) or len(pw) < 10 or not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise HTTPError(400, "Password must be at least 10 characters and have both letters and numbers.")


def random_password():
    """A first password for a new login, e.g. Dar4821-kmpt (changed by the person at the first sign-in)."""
    return f"Dar{secrets.randbelow(10000):04d}-" + "".join(secrets.choice("abcdefghjkmnpqrstuvwxyz") for _ in range(4))


SITE_URL = "https://portal.example.com"


def site_url(cfg):
    """The address used in the links of emails, the Google Sheet and AppSheet: always the portal address."""
    return SITE_URL


def validate_username(u):
    if not re.fullmatch(r"[A-Za-z0-9._-]{3,40}", u):
        raise HTTPError(400, "Username must be 3-40 letters, numbers, dot, dash or underscore.")


def tok_hash(t):
    return hashlib.sha256(t.encode()).hexdigest()


def new_id():
    return secrets.token_hex(8)


def user_json(r):
    return {"id": r["id"], "username": r["username"], "name": r["name"], "role": r["role"],
            "active": bool(r["active"]), "createdAt": r["created_at"], "lastLogin": r["last_login"],
            "mustChangePassword": bool(r["must_change_pw"]), "email": r["email"] or ""}


EMAIL_RE = re.compile(r"[^@\s,;<>]+@[^@\s,;<>]+\.[A-Za-z]{2,}")


def clean_email(v):
    v = str(v or "").strip()
    if v and not EMAIL_RE.fullmatch(v):
        raise HTTPError(400, f"'{v}' is not a valid email address.")
    return v.lower()


def last_change(c, doc_id, field, nm):
    """Who changed `field` last, and when (from the audit trail)."""
    r = c.execute("SELECT user_id, at FROM audit_log WHERE app_id=? AND field=? AND action IN ('edit','remark')"
                  " ORDER BY at DESC, rowid DESC LIMIT 1", (doc_id, field)).fetchone()
    return (nm.get(r["user_id"], "") if r else "", r["at"] if r else None)


def is_conflict(stored, base, new):
    """Someone else changed the value after this person opened the form, and this person wants a different value."""
    return base is not None and base != stored and new != stored


def names(c):
    return {r["id"]: r["name"] for r in c.execute("SELECT id, name FROM users")}


def as_dict(v, field):
    if v is None:
        return {}
    if not isinstance(v, dict):
        raise HTTPError(400, f"'{field}' must be an object.")
    return v


def next_form_no(c):
    mx = 0
    for (fn,) in c.execute("SELECT form_no FROM apps"):
        m = re.search(r"(\d+)\s*$", fn or "")
        if m:
            mx = max(mx, int(m.group(1)))
    return f"COMPANY-COA-{mx + 1:03d}"


def clean_value(v):
    if v is None:
        return ""
    if isinstance(v, bool) or not isinstance(v, (str, int, float)):
        raise HTTPError(400, "Invalid value.")
    return str(v)[:MAX_VALUE]


def file_json(f, nm):
    return {"id": f["id"], "name": f["name"], "type": f["type"], "size": f["size"], "note": f["note"] or "",
            "uploadedAt": f["uploaded_at"], "uploadedBy": nm.get(f["uploaded_by"], "")}


# ---------------------------------------------------------------- permissions
def is_admin(user):
    return user["role"] in ("superadmin", "admin")


def user_access(c, user):
    """{section: {edit, check, resubmits}} configured for this user."""
    if user["role"] == "superadmin":
        return {s: {"view": True, "edit": True, "check": True, "resubmits": 0} for s in SECTIONS}
    acc = {s: {"view": False, "edit": False, "check": False, "resubmits": 0} for s in SECTIONS}
    for r in c.execute("SELECT * FROM section_access WHERE user_id=?", (user["id"],)):
        if r["section"] in acc:
            acc[r["section"]] = {"view": bool(r["can_view"]), "edit": bool(r["can_edit"]),
                                 "check": bool(r["can_check"]), "resubmits": r["resubmits"]}
    return acc


def can_create(c, user, program="coa"):
    """May this person start a new application? Super Admin always; Viewer never; others as set."""
    if user["role"] == "superadmin":
        return True
    if user["role"] == "viewer":
        return False
    r = c.execute("SELECT can_create FROM program_access WHERE user_id=? AND program=?", (user["id"], program)).fetchone()
    return bool(r and r["can_create"])


def me_json(c, u):
    sa, eb, hr, mc, tr = sirim_access(c, u), eb_access(c, u), hr_access(c, u), mc_access(c, u), tr_access(c, u)
    ta = ta_access(c, u)
    wh = wh_access(c, u)
    mm = memo_access(c, u)
    hs = None if hr["view"] else hr_scope(c, u)
    me_staff = own_staff(c, u)
    return {**user_json(u), "canCreate": can_create(c, u), "coaAccess": coa_access(c, u),
            "canCreateSirim": sa["create"], "sirimAccess": u["role"] in ("superadmin", "admin", "viewer") or sa["view"] or sa["edit"],
            "ebView": eb["view"], "ebEdit": eb["edit"], "hrView": hr["view"], "hrEdit": hr["edit"],
            "mcSubmit": mc["submit"], "mcHR": mc["hr"], "trFill": tr["fill"], "trHR": tr["hr"],
            "taFill": ta["fill"], "taHR": ta["hr"], "whView": wh["view"], "whEdit": wh["edit"], "idleMinutes": idle_minutes(c),
            "memoHR": mm["hr"], "memoApprove": mm["approve"], "hrCoverage": bool(hs),
            "staff": {"code": me_staff["staff_id"], "name": me_staff["full_name"], "outlet": me_staff["outlet_code"]} if me_staff else None}


# ================================================================ Email Batch (Marketing Dept)
#   One template with [Fields] + a list of customers (typed in or imported from Excel / CSV)
#   -> one personal email per customer, sent from the company mail account, with a copy of every email kept.
EB_SEC = "EB"                                   # key in section_access: can_view = see batches, can_edit = create & send
EB_FIELD = re.compile(r"\[([^\[\]\n]{1,60})\]")
EB_MAX_ROWS = 5000
EB_GAP = 2.0                                    # seconds between two emails (mail servers limit how fast one may send)
EB_SENDING = set()
EB_EMAIL_HEADERS = ("email", "e-mail", "email address", "e-mail address", "customer email", "to", "recipient")


def eb_access(c, user):
    if user["role"] == "superadmin":
        return {"view": True, "edit": True}
    if user["role"] == "viewer":
        return {"view": False, "edit": False}
    r = c.execute("SELECT * FROM section_access WHERE user_id=? AND section=?", (user["id"], EB_SEC)).fetchone()
    return {"view": bool(r and (r["can_view"] or r["can_edit"])), "edit": bool(r and r["can_edit"])}


# ================================================================ HR Dept - Staff Master Data
HR_SEC = "HR"                                   # key in section_access: can_view = see the staff list, can_edit = add / edit / import
HR_FIELDS = (("outlet_code", "BR"), ("staff_id", "Staff Code"), ("full_name", "Staff Name"), ("ic_no", "IC No."), ("role", "Position"),
             ("email", "Email"), ("joined_date", "Joined Date"), ("resigned_date", "Resigned Date"),
             ("cover_branches", "Coverage Branch"))
HR_COVER = ("cover_branches",)                  # managers: the branches whose staff they manage (set by HR)
HR_HEADS = {                                    # Excel headings understood for each field (lower case)
    "staff_id": ("staff code", "staffcode", "user id", "userid", "user", "staff id", "staffid", "staff no", "staff no.",
                 "staff number", "employee id", "employee code", "employee no", "employee no.", "emp id", "emp no", "id", "code"),
    "full_name": ("staff name", "full name", "fullname", "name", "employee name"),
    "ic_no": ("ic no.", "ic no", "ic", "ic number", "ic num", "nric", "nric no", "nric no.", "mykad", "mykad no", "identity card",
              "identity card no", "ic/passport", "ic / passport", "ic/passport no", "ic / passport no", "passport", "passport no"),
    "role": ("role", "position", "designation", "job title", "title", "job role"),
    "email": ("email", "e-mail", "email address", "e-mail address", "mail"),
    "outlet_code": ("br", "outlet code", "outletcode", "outlet", "branch code", "branch", "store code", "store", "outlet id"),
    "joined_date": ("joined date", "join date", "joined", "date joined", "joining date", "date of joining", "start date",
                    "commencement date", "date join"),
    "resigned_date": ("resigned date", "resign date", "resigned", "date resigned", "resignation date", "last day",
                      "last working day", "end date", "leaving date", "date resign"),
    "cover_branches": ("coverage branch", "coverage branches", "coverage br", "cover branch", "coverage outlet", "coverage outlets"),
}
HR_DATES = ("joined_date", "resigned_date")
HR_DEFAULT_PASSWORD = "DAR.0166"               # first password of logins made from Staff Master Data (changed at the first sign-in)


def hr_date(value):
    """Excel / typed date -> 'yyyy-mm-dd' ('' when empty). Understands Excel date numbers (45567), 2026-09-30,
    30/09/2026, 30-09-2026, 30.9.26, 30 Sep 2026, 30-Sep-26. Returns None when it is not a date."""
    import datetime as dt
    v = str(value if value is not None else "").strip()
    if not v or v == "-":
        return ""
    if re.fullmatch(r"\d{4,5}(\.\d+)?", v) and 10000 < float(v) < 80000:          # Excel serial date
        return (dt.date(1899, 12, 30) + dt.timedelta(days=int(float(v)))).isoformat()
    v = re.sub(r"\s+\d{1,2}:\d{2}(:\d{2})?$", "", v)                              # drop a time part
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y", "%d.%m.%y", "%d %b %Y", "%d %B %Y",
                "%d-%b-%Y", "%d-%b-%y", "%d %b %y", "%Y/%m/%d"):
        try:
            return dt.datetime.strptime(v, fmt).date().isoformat()
        except ValueError:
            pass
    return None


def hr_scope(c, user):
    """Whose staff may this login see and manage?  HR (Staff Master Data rights) = every staff.
    A manager = the staff of their Coverage Branch(es) (set on their own staff record).  None = no access."""
    acc = hr_access(c, user)
    if acc["view"]:
        return {"all": True, "hr": True, "edit": acc["edit"]}
    if user["role"] == "viewer":
        return None
    st = own_staff(c, user)
    if not st:
        return None
    br = {x.strip().upper() for x in (st["cover_branches"] or "").split(",") if x.strip()}
    if not br:
        return None
    return {"all": False, "hr": False, "edit": True, "branches": br}


def hr_team(c, user):
    """The staff a manager looks after: in their Coverage Branch(es) AND in a position below theirs in the structure
    (Access Control > Positions > Reports to).  Not the manager; not resigned staff."""
    st = own_staff(c, user)
    if not st:
        return []
    br = {x.strip().upper() for x in (st["cover_branches"] or "").split(",") if x.strip()}
    if not br:
        return []
    pp = {k.lower(): v.lower() for k, v in get_options(c)["hrPosParent"].items()}
    below, grew = set(), True
    while grew:
        grew = False
        for k, v in pp.items():
            if (v == (st["role"] or "").lower() or v in below) and k not in below:
                below.add(k)
                grew = True
    if not below:
        return []
    today = time.strftime("%Y-%m-%d")
    return [r for r in c.execute("SELECT * FROM hr_staff WHERE removed_at IS NULL ORDER BY staff_id COLLATE NOCASE")
            if (r["outlet_code"] or "").upper() in br and (r["role"] or "").lower() in below
            and (not r["resigned_date"] or r["resigned_date"] > today) and r["staff_id"].lower() != st["staff_id"].lower()]


def hr_view_codes(c, user):
    """HR Dept documents a user (not HR) may look at: their own Staff Code, and - for a manager - the staff under them in the
    structure (Coverage Branch + Reports to).  Changing a document stays with the person who made it (or HR)."""
    return {user["username"].lower()} | {t["staff_id"].lower() for t in hr_team(c, user)}


def hr_in_scope(scope, outlet, role=None):
    return scope["all"] or (outlet or "").upper() in scope["branches"]


def hr_access(c, user):
    if user["role"] == "superadmin":
        return {"view": True, "edit": True}
    if user["role"] == "viewer":
        return {"view": False, "edit": False}
    r = c.execute("SELECT * FROM section_access WHERE user_id=? AND section=?", (user["id"], HR_SEC)).fetchone()
    return {"view": bool(r and (r["can_view"] or r["can_edit"])), "edit": bool(r and r["can_edit"])}


# ================================================================ HR Dept - MC Request (PRO-2603-012)
#   Staff submit an MC (picture) -> Submitted; HR opens it -> Processing; HR approves -> Approved, ticks "original MC received" -> Completed.
#   The original copy must reach HR within the lead time (30 days, counting down from the submit day); a reminder
#   at 10 days left; at 0 the request is rejected automatically.
MC_SEC = "MC"                                   # section_access: can_view = submit own requests, can_edit = HR (check & approve all)
MC_TYPES = ("MC", "OMC")                         # first Document Types; HR edits the list (Settings > HR Setting > MC Request)


def mc_types_clean(items):
    """Document Types: [{"code": "MC", "name": "..."}]; the code (A-Z / 0-9, up to 10) also starts the Document Number."""
    out, seen = [], set()
    for t in items if isinstance(items, list) else []:
        t = t if isinstance(t, dict) else {"code": t}
        code = re.sub(r"[^A-Z0-9]", "", str(t.get("code") or "").upper())[:10]
        if code and code not in seen:
            seen.add(code)
            out.append({"code": code, "name": re.sub(r"\s+", " ", str(t.get("name") or "")).strip()[:60]})
    return out
MC_STATUS = ("submitted", "processing", "approved", "completed", "rejected")
MC_OPEN = ("submitted", "processing", "approved")                    # still running: the lead time counts down
MC_LABEL = lambda st: st


def mc_access(c, user):
    if user["role"] == "superadmin":
        return {"submit": True, "hr": True}
    if user["role"] == "viewer":
        return {"submit": False, "hr": False}
    r = c.execute("SELECT * FROM section_access WHERE user_id=? AND section=?", (user["id"], MC_SEC)).fetchone()
    return {"submit": bool(r and (r["can_view"] or r["can_edit"])), "hr": bool(r and r["can_edit"])}


def mc_settings(cfg):
    num = lambda k, d: max(1, min(365, int(cfg.get(k) or d))) if str(cfg.get(k) or d).isdigit() else d
    bh = str(cfg.get("mc_backdate_hours") or 48)
    try:
        types = mc_types_clean(json.loads(cfg.get("mc_doc_types") or "null"))
    except ValueError:
        types = []
    return {"leadDays": num("mc_lead_days", 30), "remindDays": num("mc_remind_days", 10),
            "backdateHours": max(1, min(720, int(bh))) if bh.isdigit() else 48,
            "docTypes": types or [{"code": t, "name": ""} for t in MC_TYPES]}


def mc_date_check(cfg, date_apply, now=None):
    """Staff (not HR) must submit within the backdate limit (48 hours): Date Apply no earlier than 48 hours ago, not in the future."""
    import datetime as dt
    now = now or time.time()
    hours = mc_settings(cfg)["backdateHours"]
    earliest = dt.date.fromtimestamp(now - hours * 3600).isoformat()
    today = dt.date.fromtimestamp(now).isoformat()
    if date_apply > today:
        raise HTTPError(400, "Date Apply cannot be in the future.")
    if date_apply < earliest:
        raise HTTPError(400, f"MC must be submitted within {hours} hours - Date Apply can only be backdated {hours} hours "
                             f"(earliest {dt.date.fromisoformat(earliest).strftime('%d/%m/%Y')}). For an older MC ask HR.")


def mc_left(r, now=None):
    """Days left to hand in the original MC (stops counting when it is received or the request is rejected)."""
    if not r["submitted_at"]:
        return r["lead_days"]
    end = r["received_at"] or r["rejected_at"] or (now or time.time())
    return max(0, int(r["lead_days"]) - int((end - r["submitted_at"]) // 86400))


def own_staff(c, user):
    """The staff record of a login (username = Staff Code)."""
    return c.execute("SELECT * FROM hr_staff WHERE staff_id=? COLLATE NOCASE AND removed_at IS NULL", (user["username"],)).fetchone()


def mc_auto(c, now=None):
    """Reject requests whose lead time ran out without the original MC; mark the ones that reached the reminder day.
    Returns the rows to remind (for the email)."""
    now = now or time.time()
    st = mc_settings(setting_all(c))
    remind = []
    for r in c.execute("SELECT * FROM mc_requests WHERE status IN ('submitted','processing','approved') AND received_at IS NULL").fetchall():
        left = mc_left(r, now)
        if left <= 0:
            c.execute("UPDATE mc_requests SET status='rejected', rejected_at=?, rejected_by=NULL, updated_by=NULL, updated_at=?,"
                      " reject_reason=? WHERE id=?", (now, now, f"Original MC not received within {r['lead_days']} days (automatic)", r["id"]))
            audit(c, r["id"], {"id": None}, "cancel", MC_SEC, "status", MC_LABEL(r["status"]), "rejected (lead time over - automatic)", at=now)
        elif left <= st["remindDays"] and not r["reminded_at"]:
            c.execute("UPDATE mc_requests SET reminded_at=? WHERE id=?", (now, r["id"]))
            remind.append((r, left))
    return remind


def mc_remind_mail(items):
    """Email reminder (when a mail server is set): 'please hand in the original MC'."""
    if not items:
        return
    try:
        with DB() as c:
            cfg = setting_all(c)
            if not email_ready(cfg):
                return
            link = site_url(cfg)
            mails = []
            for r, left in items:
                u = c.execute("SELECT email, name FROM users WHERE id=?", (r["submitted_by"],)).fetchone() if r["submitted_by"] else None
                st = c.execute("SELECT email FROM hr_staff WHERE staff_id=? COLLATE NOCASE", (r["staff_code"],)).fetchone()
                to = (u["email"] if u and u["email"] else "") or (st["email"] if st and st["email"] else "")
                if to and EMAIL_RE.fullmatch(to):
                    mails.append((to, r, left))
        for to, r, left in mails:
            text = (f"Dear {r['staff_name'] or r['staff_code']},\n\nPlease hand in the ORIGINAL copy of your MC to HR.\n"
                    f"Request: {r['doc_no']} ({r['doc_type']}, applied {r['date_apply']})\nDays left: {left}\n\n"
                    f"If the original MC does not reach HR in time, the request is rejected automatically.\n\n{link}/#/mc/{r['id']}")
            body = (f'<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937">'
                    f'<p>Dear {html.escape(r["staff_name"] or r["staff_code"])},</p>'
                    f'<p>Please hand in the <b>original copy of your MC</b> to HR.</p>'
                    f'<p>Request: <b>{html.escape(r["doc_no"])}</b> ({html.escape(r["doc_type"])}, applied {html.escape(r["date_apply"])})<br>'
                    f'Days left: <b style="color:#b91c1c">{left}</b></p>'
                    f'<p>If the original MC does not reach HR in time, the request is rejected automatically.</p>'
                    f'<p><a href="{html.escape(link)}/#/mc/{r["id"]}">Open the request</a></p></div>')
            try:
                send_mail(cfg, [to], f"Reminder: original MC for {r['doc_no']} - {left} day(s) left", text, body)
            except Exception as e:
                print(f"MC reminder not sent to {to}: {e}")
    except Exception as e:
        print(f"MC reminder: {e}")


def mc_loop():
    """Background: check the MC lead times every 30 minutes."""
    time.sleep(30)
    while True:
        try:
            with DB() as c:
                items = mc_auto(c)
            mc_remind_mail(items)
        except Exception as e:
            print(f"MC timer: {e}")
        time.sleep(1800)


def mc_json(c, r, nm, files=True):
    out = {"id": r["id"], "docNo": r["doc_no"], "docType": r["doc_type"], "omcNo": r["omc_no"], "staffCode": r["staff_code"],
           "staffName": r["staff_name"], "outlet": r["outlet"], "leaveNo": r["leave_no"], "dateApply": r["date_apply"],
           "status": r["status"], "leadLeft": mc_left(r), "leadDays": r["lead_days"], "received": bool(r["received_at"]),
           "receivedAt": r["received_at"], "receivedBy": nm.get(r["received_by"], ""),
           "submittedBy": nm.get(r["submitted_by"], ""), "submittedById": r["submitted_by"], "submittedAt": r["submitted_at"],
           "approvedBy": nm.get(r["approved_by"], ""), "approvedAt": r["approved_at"],
           "rejectedBy": nm.get(r["rejected_by"], "System" if r["rejected_at"] else ""), "rejectedAt": r["rejected_at"],
           "rejectReason": r["reject_reason"], "updatedBy": nm.get(r["updated_by"], "System" if r["updated_at"] else ""),
           "updatedAt": r["updated_at"]}
    if files:
        out["files"] = [{"id": f["id"], "name": f["name"], "type": f["type"], "size": f["size"]} for f in c.execute(
            "SELECT * FROM mc_files WHERE mc_id=? AND removed_at IS NULL ORDER BY uploaded_at", (r["id"],))]
    return out


def next_mc_no(c, kind="MC"):
    """Document ID made by the system: MC-2610-001 / OMC-2610-001 (type - year month - running number)."""
    pre = f"{kind}-" + time.strftime("%y%m") + "-"
    n = max([int(r[0][len(pre):]) for r in c.execute("SELECT doc_no FROM mc_requests WHERE doc_no LIKE ?", (pre + "%",))
             if r[0][len(pre):].isdigit()] or [0])
    return f"{pre}{n + 1:03d}"


# ================================================================ HR Dept - Transfer Form (PRO-2603-011)
#   Outlet fills in the form -> Drafted -> prints the letter, gets it signed, uploads it -> Processing
#   -> HR reviews, prints, signs, uploads -> Completed -> outlet staff opens it -> Checked.  HR may cancel (not Checked).
TR_SEC = "TR"                                   # section_access: can_view = fill in / own forms, can_edit = HR (all forms)
TR_TIMES = ("timeIn", "timeOut", "lunchIn", "lunchOut", "dinnerIn", "dinnerOut")
TR_TIME_LABELS = (("timeIn", "Time In"), ("timeOut", "Time Out"), ("lunchIn", "Lunch In"), ("lunchOut", "Lunch Out"),
                  ("dinnerIn", "Dinner In"), ("dinnerOut", "Dinner Out"))
TR_TIME_HEADS = {k: (lbl.lower(), lbl.lower().replace(" ", "")) for k, lbl in TR_TIME_LABELS}
TR_LOGINS = ("Manager", "Asst. Manager", "Cashier", "Sales Asst.")      # Request For ID Login SBClient System
TR_STATUS = ("drafted", "submitted", "processing", "completed", "checked", "cancelled")


def hr_time(v):
    """'9:00', '09:00', '9.00 am', '2:30 PM', Excel 0.375 -> '09:00' ('' when empty / not a time)."""
    v = str(v if v is not None else "").strip().lower()
    if not v:
        return ""
    if re.fullmatch(r"0?\.\d+", v):                                    # Excel time as part of a day
        mins = round(float(v) * 1440)
        return f"{mins // 60 % 24:02d}:{mins % 60:02d}"
    m = re.fullmatch(r"(\d{1,2})[:.](\d{2})(?::\d{2})?\s*(am|pm|a\.m\.|p\.m\.)?", v) or re.fullmatch(r"(\d{1,2})()\s*(am|pm)", v)
    if not m:
        return ""
    h, mi, ap = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").replace(".", "")
    if ap == "pm" and h < 12:
        h += 12
    if ap == "am" and h == 12:
        h = 0
    return f"{h:02d}:{mi:02d}" if h < 24 and mi < 60 else ""


def tr_access(c, user):
    if user["role"] == "superadmin":
        return {"fill": True, "hr": True}
    if user["role"] == "viewer":
        return {"fill": False, "hr": False}
    r = c.execute("SELECT * FROM section_access WHERE user_id=? AND section=?", (user["id"], TR_SEC)).fetchone()
    return {"fill": bool(r and (r["can_view"] or r["can_edit"])), "hr": bool(r and r["can_edit"])}


def tr_staff(c, code):
    return c.execute("SELECT * FROM hr_staff WHERE staff_id=? COLLATE NOCASE AND removed_at IS NULL", (str(code or "").strip(),)).fetchone()


def tr_clean(c, typ, d):
    """Check and tidy the form; staff name / IC / outlet always come from Staff Master Data."""
    d = d if isinstance(d, dict) else {}
    txt = lambda v, n=200: re.sub(r"\s+", " ", str(v or "")).strip()[:n]
    outlet = lambda v: hr_clean("outlet_code", v)[:50]
    times = lambda t: {k: hr_time((t or {}).get(k)) for k in TR_TIMES}

    def person(x, label):
        st = tr_staff(c, x.get("staffId"))
        if not st:
            raise HTTPError(400, f"{label}: Staff ID '{txt(x.get('staffId'), 40)}' is not in Staff Master Data.")
        return {"staffId": st["staff_id"], "staffName": st["full_name"], "icNo": st["ic_no"] or "", "outlet": st["outlet_code"],
                "position": st["role"]}
    if typ == "permanent":
        out = person(d, "Staff")
        eff = hr_date(d.get("effectiveDate"))
        if not eff:
            raise HTTPError(400, "Choose the Effective From Date.")
        out.update({"effectiveDate": eff, "posFrom": txt(d.get("posFrom")), "posTo": txt(d.get("posTo")),
                    "outletFrom": outlet(d.get("outletFrom")), "outletTo": outlet(d.get("outletTo")), "times": times(d.get("times")),
                    "remarks": txt(d.get("remarks"), 1000)})
        if not out["posTo"] and not out["outletTo"]:
            raise HTTPError(400, "Fill in the new Department / Position (To) and / or the Transfer Outlet (To).")
        return out
    lines = d.get("lines") if isinstance(d.get("lines"), list) else []
    if not lines:
        raise HTTPError(400, "Add at least one staff.")
    if len(lines) > 50:
        raise HTTPError(400, "At most 50 staff in one form.")
    out = []
    for i, x in enumerate(lines, 1):
        x = x if isinstance(x, dict) else {}
        ln = person(x, f"Staff {i}")
        fd, td = hr_date(x.get("fromDate")), hr_date(x.get("toDate"))
        if not fd or not td:
            raise HTTPError(400, f"Staff {i} ({ln['staffId']}): choose the From Date and To Date.")
        if td < fd:
            raise HTTPError(400, f"Staff {i} ({ln['staffId']}): To Date is before From Date.")
        to = outlet(x.get("outletTo"))
        if not to:
            raise HTTPError(400, f"Staff {i} ({ln['staffId']}): choose the Transfer Outlet (To).")
        ln.update({"fromDate": fd, "toDate": td, "outletFrom": outlet(x.get("outletFrom")) or ln["outlet"], "outletTo": to,
                   "times": times(x.get("times")), "idLogin": [v for v in TR_LOGINS if v in (x.get("idLogin") or [])],
                   "remarks": txt(x.get("remarks"), 1000)})
        out.append(ln)
    return {"lines": out}


def tr_for_me(c, user, r, codes=None):
    """A transfer form (not a draft) with this user's Staff Code - or a staff under them - on it."""
    if r["status"] == "drafted":
        return False
    codes = codes if codes is not None else hr_view_codes(c, user)
    return any((x.get("staffId") or "").lower() in codes for x in tr_people(r["type"], json.loads(r["data"] or "{}")))


def tr_date_check(typ, data, old):
    """No backdating for the outlet (HR is not limited): Effective From Date / From Date must be today or later.
    A date already saved on the form (e.g. a draft from yesterday) may stay."""
    today = time.strftime("%Y-%m-%d")
    if typ == "permanent":
        d = data.get("effectiveDate") or ""
        if d and d < today and d != old.get("effectiveDate"):
            raise HTTPError(400, "Effective From Date cannot be backdated - choose today or a later date.")
        return
    kept = {(x.get("staffId"), x.get("fromDate")) for x in old.get("lines") or []}
    for i, x in enumerate(data.get("lines") or [], 1):
        d = x.get("fromDate") or ""
        if d and d < today and (x.get("staffId"), d) not in kept:
            raise HTTPError(400, f"Staff {i} ({x.get('staffId')}): From Date cannot be backdated - choose today or a later date.")


def tr_people(typ, data):
    return [data] if typ == "permanent" else list(data.get("lines") or [])


def tr_json(c, r, nm, full=True):
    data = json.loads(r["data"] or "{}")
    ppl = tr_people(r["type"], data)
    out = {"id": r["id"], "docNo": r["doc_no"], "type": r["type"], "status": r["status"],
           "staffIds": [x.get("staffId", "") for x in ppl], "staffNames": [x.get("staffName", "") for x in ppl],
           "outlets": [x.get("outlet", "") for x in ppl], "createdBy": nm.get(r["created_by"], ""), "createdById": r["created_by"],
           "createdAt": r["created_at"], "updatedBy": nm.get(r["updated_by"], ""), "updatedAt": r["updated_at"],
           "cancelReason": r["cancel_reason"] or "", "cancelledBy": nm.get(r["cancelled_by"], ""), "cancelledAt": r["cancelled_at"],
           "checkedBy": nm.get(r["checked_by"], ""), "checkedAt": r["checked_at"]}
    if full:
        out.update({"data": data, "outletSign": json.loads(r["outlet_sign"] or "{}"), "hrSign": json.loads(r["hr_sign"] or "{}"),
                    "files": [{"id": f["id"], "kind": f["kind"], "name": f["name"], "type": f["type"], "size": f["size"],
                               "uploadedBy": nm.get(f["uploaded_by"], ""), "uploadedAt": f["uploaded_at"]}
                              for f in c.execute("SELECT * FROM tr_files WHERE tr_id=? AND removed_at IS NULL ORDER BY uploaded_at", (r["id"],))]})
    return out


# ================================================================ HR Dept - Time Adjustment (PRO-2603-004)
#   Outlet fills in the staff whose clock times must be changed -> Draft (Save) / Submitted (Submit, "I agree" ticked)
#   -> HR opens it: Processing -> HR ticks or declines each line.  A declined line -> Incomplete: the outlet corrects the
#   declined lines and submits again.  All lines ticked -> HR changes the times in SBClient and presses Complete -> Completed
#   -> the outlet checks SBClient and acknowledges (-> Acknowledged) or declines a line (-> Incomplete, back to HR).
#   24 hours after Completed it becomes Acknowledged by itself.  HR sees a form only once it is submitted.
TA_SEC = "TA"                                   # section_access: can_view = fill in / own forms, can_edit = HR (all forms)
TA_TIMES = ("timeIn", "lunchIn", "lunchOut", "dinnerIn", "dinnerOut", "offOut", "offIn", "timeOut")
TA_STATUS = ("draft", "submitted", "processing", "incomplete", "completed", "acknowledged", "cancelled")
TA_REASONS = ["Forgot to clock in / out", "Clock machine error", "Outstation / outside duty", "Shift change", "Overtime",
              "Public holiday / replacement", "Others"]
TA_AUTO_ACK = 86400                             # Completed -> Acknowledged by itself after 24 hours
TA_TIME_LABELS = (("timeIn", "Time In"), ("lunchIn", "Lunch In"), ("lunchOut", "Lunch Out"), ("dinnerIn", "Dinner In"),
                  ("dinnerOut", "Dinner Out"), ("offOut", "Time Off Out"), ("offIn", "Time Off In"), ("timeOut", "Time Out"))


def ta_access(c, user):
    if user["role"] == "superadmin":
        return {"fill": True, "hr": True}
    if user["role"] == "viewer":
        return {"fill": False, "hr": False}
    r = c.execute("SELECT * FROM section_access WHERE user_id=? AND section=?", (user["id"], TA_SEC)).fetchone()
    return {"fill": bool(r and (r["can_view"] or r["can_edit"])), "hr": bool(r and r["can_edit"])}


def ta_reasons(c):
    r = c.execute("SELECT items FROM option_lists WHERE list_key='taReasons'").fetchone()
    return json.loads(r["items"]) if r else list(TA_REASONS)


def ta_staff_scope(c, user, hr):
    """The staff this person may put on a form: HR = every staff; an outlet / manager = the staff of their own outlet,
    their team (Coverage Branch + structure) and themselves; a login without a staff record = every staff."""
    today = time.strftime("%Y-%m-%d")
    active = [r for r in c.execute("SELECT * FROM hr_staff WHERE removed_at IS NULL ORDER BY staff_id COLLATE NOCASE")
              if not r["resigned_date"] or r["resigned_date"] > today]
    st = None if hr else own_staff(c, user)
    if hr or not st:
        return active
    outlet = (st["outlet_code"] or "").upper()
    team = {t["staff_id"].lower() for t in hr_team(c, user)}
    return [r for r in active if r["staff_id"].lower() == st["staff_id"].lower() or r["staff_id"].lower() in team
            or (outlet and (r["outlet_code"] or "").upper() == outlet)]


def ta_clean_row(c, x, n, allowed, outlets):
    """One line of the form; staff name / IC always come from Staff Master Data."""
    x = x if isinstance(x, dict) else {}
    txt = lambda v, k=200: re.sub(r"\s+", " ", str(v or "")).strip()[:k]
    code = txt(x.get("staffId"), 40)
    st = allowed.get(code.lower())
    if not st:
        raise HTTPError(400, f"Line {n}: Staff ID '{code}' is not in Staff Master Data" + ("." if tr_staff(c, code) is None else
                             " for your outlet / team."))
    d = hr_date(x.get("date"))
    if not d:
        raise HTTPError(400, f"Line {n} ({st['staff_id']}): choose the Date.")
    br = txt(x.get("branch"), 50).upper() or (st["outlet_code"] or "").upper()
    if outlets and br not in outlets:
        raise HTTPError(400, f"Line {n} ({st['staff_id']}): Branch '{br}' is not in the Outlet list (Settings > HR Setting).")
    times = {k: hr_time((x.get("times") or {}).get(k)) for k in TA_TIMES}
    if not any(times.values()):
        raise HTTPError(400, f"Line {n} ({st['staff_id']}): fill in at least one time.")
    uid = txt(x.get("uid"), 20)
    return {"uid": uid if re.fullmatch(r"[0-9a-z]{6,20}", uid) else new_id()[:12], "staffId": st["staff_id"],
            "staffName": st["full_name"], "icNo": st["ic_no"] or "", "date": d, "branch": br, "times": times,
            "reason": txt(x.get("reason"), 100), "remark": txt(x.get("remark"), 500),
            "hrAck": "", "hrNote": "", "userAck": "", "userNote": ""}


def ta_rows(r):
    return json.loads(r["rows"] or "[]")


def ta_for_me(c, user, r, codes=None):
    """A submitted form with this user's Staff Code - or a staff under them - on one of its lines."""
    if not r["submitted_at"]:
        return False
    codes = codes if codes is not None else hr_view_codes(c, user)
    return any((x.get("staffId") or "").lower() in codes for x in ta_rows(r))


def ta_json(c, r, nm, full=True):
    rows = ta_rows(r)
    out = {"id": r["id"], "docNo": r["doc_no"], "status": r["status"], "returnedBy": r["returned_by"] or "",
           "staffIds": [x["staffId"] for x in rows], "staffNames": [x["staffName"] for x in rows],
           "branches": sorted({x["branch"] for x in rows if x.get("branch")}), "lines": len(rows),
           "createdBy": nm.get(r["created_by"], ""), "createdById": r["created_by"], "createdAt": r["created_at"],
           "createdUser": next((u["username"] for u in c.execute("SELECT username FROM users WHERE id=?", (r["created_by"],))), ""),
           "updatedBy": nm.get(r["updated_by"], ""), "updatedAt": r["updated_at"], "submittedAt": r["submitted_at"],
           "completedBy": nm.get(r["completed_by"], ""), "completedAt": r["completed_at"],
           "completedUser": next((u["username"] for u in c.execute("SELECT username FROM users WHERE id=?", (r["completed_by"],))), "")
           if r["completed_by"] else "",
           "acknowledgedBy": nm.get(r["acknowledged_by"], "System (24 hours)" if r["acknowledged_at"] else ""),
           "acknowledgedAt": r["acknowledged_at"], "cancelReason": r["cancel_reason"] or "",
           "cancelledBy": nm.get(r["cancelled_by"], ""), "cancelledAt": r["cancelled_at"]}
    if full:
        files = {}
        for f in c.execute("SELECT * FROM ta_files WHERE ta_id=? AND removed_at IS NULL ORDER BY uploaded_at", (r["id"],)):
            files.setdefault(f["row_uid"], []).append({"id": f["id"], "name": f["name"], "type": f["type"], "size": f["size"]})
        out.update({"rows": [{**x, "files": files.get(x["uid"], [])} for x in rows], "agreed": bool(r["agreed"])})
    return out


def ta_auto(c, now=None):
    """Completed for 24 hours without the outlet's answer -> Acknowledged (by the system)."""
    now = now or time.time()
    for r in c.execute("SELECT * FROM ta_docs WHERE status='completed' AND completed_at < ?", (now - TA_AUTO_ACK,)).fetchall():
        rows = ta_rows(r)
        for x in rows:
            x["userAck"] = x.get("userAck") or "ok"
        c.execute("UPDATE ta_docs SET status='acknowledged', rows=?, acknowledged_by=NULL, acknowledged_at=?, updated_by=NULL,"
                  " updated_at=? WHERE id=?", (json.dumps(rows), now, now, r["id"]))
        audit(c, r["id"], {"id": None}, "edit", TA_SEC, "status", "completed", "acknowledged (24 hours after Completed - automatic)", at=now)


def next_ta_no(c, branch):
    """Document ID: <outlet of the maker>-TA-00001 (running number per outlet)."""
    pre = (re.sub(r"[^A-Z0-9]", "", (branch or "").upper()) or "HQ") + "-TA-"
    n = max([int(x[0][len(pre):]) for x in c.execute("SELECT doc_no FROM ta_docs WHERE doc_no LIKE ?", (pre + "%",))
             if x[0][len(pre):].isdigit()] or [0])
    return f"{pre}{n + 1:05d}"


# ================================================================ Warehouse Dept - Online Shop Delivery (Carrier Manifest)
#   Warehouse makes a Carrier Manifest (title, date, channel, courier company) and scans the tracking number of every
#   parcel handed to the courier.  A number scanned twice, already on another manifest, or not of the chosen courier
#   (Tracking prefixes in the courier list) is refused.  Allow Edit off = the list is locked.  Print = the hand-over list.
WH_SEC = "WH"                                   # section_access: can_view = see & print, can_edit = create, scan, settings
WH_COURIERS = [{"name": n, "prefixes": []} for n in ("DHL Ecommerce", "J&T Express", "Pos Laju", "Ninja Van", "Shopee Express",
                                                     "Lazada Logistics", "City-Link Express", "GDEX", "Flash Express", "SPX Express")]
WH_CHANNELS = ["Shopee", "Lazada", "TikTok Shop", "Website", "Others"]


def wh_access(c, user):
    if user["role"] == "superadmin":
        return {"view": True, "edit": True}
    if user["role"] == "viewer":
        return {"view": False, "edit": False}
    r = c.execute("SELECT * FROM section_access WHERE user_id=? AND section=?", (user["id"], WH_SEC)).fetchone()
    return {"view": bool(r and (r["can_view"] or r["can_edit"])), "edit": bool(r and r["can_edit"])}


def wh_lists(c):
    """Courier companies [{name, prefixes}] and channels [name], as set by the warehouse (Settings button)."""
    out = {"couriers": WH_COURIERS, "channels": WH_CHANNELS}
    for r in c.execute("SELECT * FROM option_lists WHERE list_key IN ('whCouriers', 'whChannels')"):
        out["couriers" if r["list_key"] == "whCouriers" else "channels"] = json.loads(r["items"])
    return out


def wh_tracking(v):
    """Tracking number as scanned -> upper case without spaces; None when it cannot be one."""
    t = re.sub(r"\s+", "", str(v or "")).upper()
    return t if re.fullmatch(r"[A-Z0-9][A-Z0-9\-_/.]{3,49}", t) else None


def wh_json(c, r, nm, full=True):
    n = c.execute("SELECT COUNT(*) FROM wh_parcels WHERE manifest_id=? AND removed_at IS NULL", (r["id"],)).fetchone()[0]
    out = {"id": r["id"], "docNo": r["doc_no"], "title": r["title"], "docTitle": r["doc_title"], "date": r["mdate"],
           "channel": r["channel"], "courier": r["courier"], "allowEdit": bool(r["allow_edit"]), "remark": r["remark"],
           "count": n, "status": "cancelled" if r["cancelled_at"] else "open" if r["allow_edit"] else "locked",
           "createdBy": nm.get(r["created_by"], ""), "createdById": r["created_by"], "createdAt": r["created_at"],
           "updatedBy": nm.get(r["updated_by"], ""), "updatedAt": r["updated_at"], "cancelReason": r["cancel_reason"] or "",
           "cancelledBy": nm.get(r["cancelled_by"], ""), "cancelledAt": r["cancelled_at"]}
    if full:
        out["parcels"] = [{"id": p["id"], "tracking": p["tracking"], "by": nm.get(p["scanned_by"], ""), "at": p["scanned_at"]}
                          for p in c.execute("SELECT * FROM wh_parcels WHERE manifest_id=? AND removed_at IS NULL"
                                             " ORDER BY scanned_at, rowid", (r["id"],))]
    return out


def next_wh_no(c):
    """Manifest No: CM-YYMM-001 (running number per month)."""
    pre = "CM-" + time.strftime("%y%m") + "-"
    n = max([int(x[0][len(pre):]) for x in c.execute("SELECT doc_no FROM wh_manifests WHERE doc_no LIKE ?", (pre + "%",))
             if x[0][len(pre):].isdigit()] or [0])
    return f"{pre}{n + 1:03d}"


def wh_clean(c, b):
    txt = lambda k, n=200: re.sub(r"\s+", " ", str(b.get(k) or "")).strip()[:n]
    title, doc_title = txt("title"), txt("docTitle")
    if not title or not doc_title:
        raise HTTPError(400, "Fill in the Title and the Document Title.")
    d = txt("date", 16)
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?", d):
        raise HTTPError(400, "Choose the Date.")
    lists = wh_lists(c)
    courier, channel = txt("courier", 100), txt("channel", 100)
    if courier and courier.lower() not in {x["name"].lower() for x in lists["couriers"]}:
        raise HTTPError(400, f"Courier company '{courier}' is not in the list (Settings).")
    if channel and channel.lower() not in {x.lower() for x in lists["channels"]}:
        raise HTTPError(400, f"Channel '{channel}' is not in the list (Settings).")
    return {"title": title, "doc_title": doc_title, "mdate": d, "courier": courier, "channel": channel,
            "allow_edit": int(b.get("allowEdit", True) is not False), "remark": txt("remark", 500)}


# ================================================================ General - Memo (PRO-2603-010)
#   HR creates a memo (uploads a PDF or types it in) and chooses who can view it -> Processing
#   -> the person in charge approves it (their e-signature goes into the memo) -> Approved -> HR posts it -> Posted:
#   the chosen staff see it under General > Memo.  HR may cancel it.
MM_SEC = "MM"                                   # section_access: can_edit = HR (create, edit, post, cancel, all memos), can_check = approve
MM_STATUS = ("processing", "approved", "posted", "cancelled")
MY_STATES = ("Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Sabah",
             "Sarawak", "Selangor", "Terengganu", "Kuala Lumpur", "Putrajaya", "Labuan")
MM_AUD_KEYS = ("states", "outlets", "departments", "positions")


def memo_access(c, user):
    if user["role"] == "superadmin":
        return {"hr": True, "approve": True}
    if user["role"] == "viewer":
        return {"hr": False, "approve": False}
    r = c.execute("SELECT * FROM section_access WHERE user_id=? AND section=?", (user["id"], MM_SEC)).fetchone()
    return {"hr": bool(r and r["can_edit"]), "approve": bool(r and r["can_check"])}


def memo_profile(c, user):
    """What decides which memos a person sees: the outlet (and its state), position and department of their staff record."""
    st = own_staff(c, user)
    if not st:
        return None
    opts = get_options(c)
    outlet = (st["outlet_code"] or "").upper()
    state = next((o.get("state") or "" for o in opts["hrOutlets"] if o["code"].upper() == outlet), "")
    pos = st["role"] or ""
    dept = next((d for p_, d in opts["hrPosDept"].items() if p_.lower() == pos.lower()), "")
    return {"outlet": outlet, "state": state, "position": pos, "department": dept}


def memo_for(aud, prof):
    """Is a posted memo meant for this person?  All - or: WHERE (Outlet narrows State) and WHO (Position narrows Department).
    Johor = every Johor outlet; Johor + JB03 = JB03 only; Account = every Account position; Johor + Account = Account staff in Johor."""
    if aud.get("all"):
        return True
    if not prof:
        return False
    low = lambda xs: {str(x).lower() for x in xs or []}

    def level(narrow, wide, mine_narrow, mine_wide):
        if aud.get(narrow):
            return mine_narrow.lower() in low(aud[narrow])
        if aud.get(wide):
            return mine_wide.lower() in low(aud[wide])
        return True                                              # nothing chosen at this level: any
    return (level("outlets", "states", prof["outlet"], prof["state"])
            and level("positions", "departments", prof["position"], prof["department"]))


def memo_can_see(c, user, r, acc, prof="?"):
    if acc["hr"] or r["created_by"] == user["id"]:
        return True
    if r["status"] in ("processing", "approved") and (r["approver_id"] == user["id"] or (acc["approve"] and user["role"] == "superadmin")):
        return True
    if r["approved_by"] == user["id"]:
        return True
    if r["status"] != "posted":
        return False
    return memo_for(json.loads(r["audience"] or "{}"), memo_profile(c, user) if prof == "?" else prof)


def memo_clean_aud(a):
    a = a if isinstance(a, dict) else {}
    out = {"all": bool(a.get("all"))}
    for k in MM_AUD_KEYS:
        vals = a.get(k) if isinstance(a.get(k), list) else []
        seen, clean = set(), []
        for v in vals[:2000]:
            v = re.sub(r"\s+", " ", str(v or "")).strip()[:100]
            if v and v.lower() not in seen:
                seen.add(v.lower())
                clean.append(v)
        out[k] = [] if out["all"] else clean
    if not out["all"] and not any(out[k] for k in MM_AUD_KEYS):
        raise HTTPError(400, "Choose who can view the memo (All, or at least one state / outlet / department / position).")
    return out


def memo_aud_text(a):
    if a.get("all"):
        return "All staff"
    where = (f"Outlet: {', '.join(a['outlets'])}" if a.get("outlets") else f"State: {', '.join(a['states'])}" if a.get("states") else "")
    who = (f"Position: {', '.join(a['positions'])}" if a.get("positions") else f"Department: {', '.join(a['departments'])}" if a.get("departments") else "")
    return " + ".join(x for x in (where, who) if x)


def memo_json(c, r, nm, un, full=False, read=None):
    aud = json.loads(r["audience"] or "{}")
    out = {"id": r["id"], "docNo": r["doc_no"], "kind": r["kind"], "title": r["title"], "status": r["status"],
           "audience": aud, "audienceText": memo_aud_text(aud),
           "createdBy": nm.get(r["created_by"], ""), "createdById": r["created_by"], "createdUser": un.get(r["created_by"], ""),
           "createdAt": r["created_at"], "updatedAt": r["updated_at"],
           "approverId": r["approver_id"], "approverName": nm.get(r["approver_id"], ""), "approverUser": un.get(r["approver_id"], ""),
           "approvedBy": nm.get(r["approved_by"], ""), "approvedUser": un.get(r["approved_by"], ""), "approvedAt": r["approved_at"],
           "postedBy": nm.get(r["posted_by"], ""), "postedAt": r["posted_at"],
           "cancelReason": r["cancel_reason"] or "", "cancelledBy": nm.get(r["cancelled_by"], ""), "cancelledAt": r["cancelled_at"],
           "read": read}
    tr = json.loads(r["translations"] or "{}") if "translations" in r.keys() else {}
    out["lang"] = (r["lang"] if "lang" in r.keys() else "") or "en"
    out["titles"] = {out["lang"]: r["title"], **{k: v.get("title", "") for k, v in tr.items() if v.get("title")}}
    if full:
        out["translations"] = tr
        files = [{"id": f["id"], "kind": f["kind"], "name": f["name"], "size": f["size"], "uploadedBy": nm.get(f["uploaded_by"], ""),
                  "uploadedAt": f["uploaded_at"]}
                 for f in c.execute("SELECT * FROM memo_files WHERE memo_id=? AND removed_at IS NULL ORDER BY uploaded_at", (r["id"],))]
        out.update({"content": r["content"] or "", "signature": r["signature"] or "", "files": files})
    return out


MEMO_LANGS = ("en", "ms", "zh")


def memo_users(c):
    return {r["id"]: r["username"] for r in c.execute("SELECT id, username FROM users")}


def memo_approvers(c):
    """People who may approve memos: Super Admin, and Admin / User accounts with Memo "Approve" ticked."""
    rows = c.execute("SELECT u.* FROM users u LEFT JOIN section_access s ON s.user_id=u.id AND s.section=? "
                     "WHERE u.active=1 AND (u.role='superadmin' OR (u.role IN ('admin','user') AND s.can_check=1)) "
                     "ORDER BY u.name COLLATE NOCASE", (MM_SEC,)).fetchall()
    return [{"id": r["id"], "username": r["username"], "name": r["name"]} for r in rows]


def memo_signature(v):
    """A drawn / uploaded signature as a data: URL (PNG or JPEG, at most 300 KB)."""
    import base64
    v = str(v or "")
    m = re.fullmatch(r"data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)", v)
    if not m or len(v) > 400_000:
        raise HTTPError(400, "Draw or upload your signature (PNG / JPG, at most 300 KB).")
    raw = base64.b64decode(m.group(2))
    if not (raw.startswith(b"\x89PNG") or raw.startswith(b"\xff\xd8")):
        raise HTTPError(400, "The signature is not a PNG / JPG picture.")
    return v


def next_memo_no(c):
    pre = "MEMO-" + time.strftime("%y%m") + "-"
    n = max([int(x[0][len(pre):]) for x in c.execute("SELECT doc_no FROM memos WHERE doc_no LIKE ?", (pre + "%",))
             if x[0][len(pre):].isdigit()] or [0])
    return f"{pre}{n + 1:03d}"


def next_tr_no(c):
    pre = "TRF-" + time.strftime("%y%m") + "-"
    n = max([int(x[0][len(pre):]) for x in c.execute("SELECT doc_no FROM tr_docs WHERE doc_no LIKE ?", (pre + "%",))
             if x[0][len(pre):].isdigit()] or [0])
    return f"{pre}{n + 1:03d}"


def hr_json(r, nm):
    email = r["email"] or ""
    resigned = r["resigned_date"] or ""
    return {"id": r["id"], "staffId": r["staff_id"], "fullName": r["full_name"], "icNo": r["ic_no"] or "", "role": r["role"], "email": email,
            "outletCode": r["outlet_code"], "emailOk": not email or bool(EMAIL_RE.fullmatch(email)),
            "joinedDate": r["joined_date"] or "", "resignedDate": resigned,
            "coverBranches": r["cover_branches"] or "",
            "active": not resigned or resigned > time.strftime("%Y-%m-%d"),
            "updatedBy": nm.get(r["updated_by"], ""), "updatedAt": r["updated_at"]}


def hr_clean(key, value):
    v = re.sub(r"\s+", " ", str(value if value is not None else "")).strip()
    if key == "staff_id" and re.fullmatch(r"\d+\.0", v):                     # Excel number 1001 read as 1001.0
        v = v[:-2]
    if key == "email":
        v = v.lower()
    if key == "outlet_code":
        v = v.upper()
    if key in HR_COVER:                                                      # "KL01; pg02 / JB03" -> "KL01, PG02, JB03"
        parts, seen = [], set()
        for x in re.split(r"[,;/|\n]+", v):
            x = x.strip().upper() if key == "cover_branches" else x.strip()
            if x and x.lower() not in seen:
                seen.add(x.lower())
                parts.append(x)
        return ", ".join(parts)[:2000]
    return v[:200]


EB_BOLD = re.compile(r"\*\*(.+?)\*\*")        # old plain-text templates: **text** = bold
EB_WRAP = '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1f2937">'


def eb_is_html(body):
    return (body or "").lstrip().startswith("<")


def eb_text(body):
    """Template body -> plain text (formatting removed; <br> / end of paragraph = new line)."""
    if not eb_is_html(body):
        return EB_BOLD.sub(r"\1", body or "")
    t = re.sub(r"(?is)<(script|style)\b.*?</\1>", "", body)
    t = re.sub(r"(?i)<br\s*/?>", "\n", t)
    t = re.sub(r"(?i)</(p|div|li|h[1-6]|blockquote)>", "\n\n", t)
    t = html.unescape(re.sub(r"<[^>]+>", "", t)).replace("\xa0", " ")
    t = re.sub(r"[ \t]+\n", "\n", t)
    return re.sub(r"\n{3,}", "\n\n", t).strip()


def eb_fields(subject, body):
    """The [Fields] used in a template, in order of first appearance."""
    out = []
    for m in EB_FIELD.finditer((subject or "") + "\n" + eb_text(body)):
        f = m.group(1).strip()
        if f and f.lower() not in (x.lower() for x in out):
            out.append(f)
    return out


def eb_fill(text, values):
    """Put each customer's values into the [Fields] of plain text; an empty / unknown field stays as [Field]."""
    low = {str(k).strip().lower(): str(v) for k, v in (values or {}).items()}

    def one(m):
        v = low.get(m.group(1).strip().lower(), "")
        return v if v.strip() else m.group(0)
    return EB_FIELD.sub(one, text or "")


_TAG_IN_FIELD = re.compile(r"\[((?:[^\[\]<>\n]|<[^<>]*>){1,400}?)\]")


def eb_merge_fields(h):
    """A [Field] split by formatting tags ("[<b>Na</b>me]") becomes one piece of text again."""
    def fix(m):
        inner = m.group(1)
        if "<" not in inner:
            return m.group(0)
        text = re.sub(r"<[^<>]*>", "", inner)
        if not text.strip() or len(text) > 60:
            return m.group(0)
        return "[" + text + "]" + "".join(re.findall(r"<[^<>]*>", inner))
    return _TAG_IN_FIELD.sub(fix, h or "")


def eb_fill_html(h, values):
    low = {str(k).strip().lower(): str(v) for k, v in (values or {}).items()}

    def one(m):
        v = low.get(html.unescape(m.group(1)).strip().lower(), "")
        return html.escape(v).replace("\n", "<br>") if v.strip() else m.group(0)
    return EB_FIELD.sub(one, eb_merge_fields(h))


def eb_legacy_html(text):
    """Old plain-text template (blank line = new paragraph, **text** = bold) -> HTML."""
    paras = [x for x in re.split(r"\n\s*\n", (text or "").strip()) if x.strip()]
    return "<div>" + "".join("<p style=\"margin:0 0 14px\">" + "<br>".join(EB_BOLD.sub(r"<strong>\1</strong>", html.escape(line))
                                                                        for line in x.split("\n")) + "</p>" for x in paras) + "</div>"


def eb_html(text):
    return EB_WRAP + eb_legacy_html(text) + "</div>"


def eb_body_html(body):
    """The template body as HTML (for the editor)."""
    return body if eb_is_html(body) else eb_legacy_html(body)


def eb_render(b, values):
    """(subject, plain text, HTML) of one customer's email."""
    subject = EB_BOLD.sub(r"\1", eb_fill(b["subject"], values)).replace("\n", " ").strip()
    filled = eb_fill_html(eb_body_html(b["body"]), values)
    return subject, eb_text(filled), EB_WRAP + filled + "</div>"


# ---- only formatting may be kept in a template (no scripts, forms, pictures from other sites ...)
from html.parser import HTMLParser
EB_TAGS = {"p", "br", "div", "span", "b", "strong", "i", "em", "u", "s", "strike", "font", "a", "ul", "ol", "li",
           "h1", "h2", "h3", "h4", "blockquote", "sub", "sup", "hr"}
EB_VOID = {"br", "hr"}
EB_DROP = {"script", "style", "head", "title", "iframe", "object", "embed", "noscript", "template", "svg", "math", "xml"}
EB_CSS = {"color", "background-color", "background", "font-weight", "font-style", "text-decoration", "font-size", "font-family",
          "text-align", "margin", "margin-top", "margin-bottom", "margin-left", "margin-right", "padding", "padding-left",
          "line-height", "text-indent"}


def eb_css(style):
    out = []
    for part in (style or "").split(";"):
        if ":" not in part:
            continue
        k, v = part.split(":", 1)
        k, v = k.strip().lower(), v.strip()
        if (k in EB_CSS and v and len(v) < 120 and re.fullmatch(r"[#\w\s.,%()'\"!-]+", v)
                and not re.search(r"url|expression|javascript|behavior|@|\\", v, re.I)):
            out.append(f"{k}:{v}")
    return ";".join(out)


class _EbClean(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out, self.skip = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in EB_DROP:
            self.skip += 1
            return
        if self.skip or tag not in EB_TAGS:
            return
        keep = []
        for k, v in attrs:
            v = (v or "").strip()
            if k == "style":
                v = eb_css(v)
                if v:
                    keep.append((k, v))
            elif tag == "font" and k in ("color", "size", "face") and re.fullmatch(r"[#\w\s,.-]{1,60}", v):
                keep.append((k, v))
            elif tag == "a" and k == "href" and re.match(r"(?i)(https?:|mailto:)", v):
                keep.append((k, v))
            elif k == "align" and v.lower() in ("left", "right", "center", "justify"):
                keep.append((k, v.lower()))
        self.out.append("<" + tag + "".join(f' {k}="{html.escape(v, quote=True)}"' for k, v in keep) + ">")

    def handle_endtag(self, tag):
        if tag in EB_DROP:
            self.skip = max(0, self.skip - 1)
            return
        if not self.skip and tag in EB_TAGS and tag not in EB_VOID:
            self.out.append(f"</{tag}>")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(html.escape(data, quote=False))


def eb_clean_html(h):
    cl = _EbClean()
    cl.feed(h or "")
    cl.close()
    out = "".join(cl.out).strip()
    if not out.startswith("<"):
        out = "<div>" + out + "</div>"
    return eb_merge_fields(out)[:200000]


EB_TYPO_DOMAINS = {                                  # addresses that look fine but can never arrive
    "gmail.com.my": "gmail.com", "gmail.my": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com",
    "gmail.cm": "gmail.com", "gmail.om": "gmail.com", "gmial.com": "gmail.com", "gmai.com": "gmail.com",
    "gamil.com": "gmail.com", "gmal.com": "gmail.com", "gmaill.com": "gmail.com", "gnail.com": "gmail.com",
    "googlemail.com.my": "googlemail.com", "hotmail.con": "hotmail.com", "hotmial.com": "hotmail.com",
    "hotmai.com": "hotmail.com", "outlook.con": "outlook.com", "outlook.com.my": "outlook.com", "outlok.com": "outlook.com",
    "yahoo.con": "yahoo.com", "yaho.com": "yahoo.com", "yahoo.co": "yahoo.com", "icloud.con": "icloud.com",
    "live.con": "live.com", "live.com.my": "live.com"}


def eb_email_typo(email):
    """'ali@gmail.com.my' -> 'ali@gmail.com' (a common mistake), else None."""
    local, _, domain = (email or "").strip().rpartition("@")
    right = EB_TYPO_DOMAINS.get(domain.lower()) or (domain[:-4] + ".com" if domain.lower().endswith(".con") else None)
    return f"{local}@{right}" if local and right else None


def eb_problems(b, email, values):
    """Why this customer's email cannot be sent yet (empty list = ready)."""
    out = []
    if not EMAIL_RE.fullmatch((email or "").strip()):
        out.append("email address missing or not valid" if email else "no email address")
    elif eb_email_typo(email):
        out.append(f"'{email.strip().rpartition('@')[2]}' does not exist - did you mean {eb_email_typo(email)} ?")
    low = {str(k).strip().lower(): str(v).strip() for k, v in (values or {}).items()}
    empty = [f for f in eb_fields(b["subject"], b["body"]) if not low.get(f.lower())]
    if empty:
        out.append("empty: " + ", ".join(f"[{f}]" for f in empty))
    return out


def next_eb_no(c):
    mx = 0
    for (no,) in c.execute("SELECT batch_no FROM eb_batches"):
        m = re.search(r"(\d+)\s*$", no or "")
        if m:
            mx = max(mx, int(m.group(1)))
    return f"COMPANY-EB-{mx + 1:03d}"


def eb_json(c, b, rows=True):
    nm = names(c)
    counts = {r["status"]: r["n"] for r in c.execute(
        "SELECT status, COUNT(*) n FROM eb_recipients WHERE batch_id=? GROUP BY status", (b["id"],))}
    out = {"id": b["id"], "batchNo": b["batch_no"], "title": b["title"], "fromName": b["from_name"], "subject": b["subject"],
           "body": eb_text(b["body"]), "bodyHtml": eb_body_html(b["body"]),
           "status": "cancelled" if b["cancelled_at"] else b["status"], "fields": eb_fields(b["subject"], b["body"]),
           "total": sum(counts.values()), "sent": counts.get("sent", 0), "failed": counts.get("failed", 0),
           "pending": counts.get("pending", 0), "createdBy": nm.get(b["created_by"], ""), "createdById": b["created_by"], "createdAt": b["created_at"],
           "updatedBy": nm.get(b["updated_by"], ""), "updatedAt": b["updated_at"], "sentBy": nm.get(b["sent_by"], ""),
           "startedAt": b["started_at"], "finishedAt": b["finished_at"], "sending": b["id"] in EB_SENDING,
           "note": b["note"] or "", "waitUntil": b["wait_until"]}
    if rows:
        out["quota"] = eb_quota(c)
        out["recipients"] = []
        for r in c.execute("SELECT * FROM eb_recipients WHERE batch_id=? ORDER BY row_no", (b["id"],)):
            values = json.loads(r["fields"] or "{}")
            out["recipients"].append({"id": r["id"], "row": r["row_no"], "email": r["email"], "fields": values, "status": r["status"],
                                      "error": r["error"] or "", "sentAt": r["sent_at"],
                                      "problems": [] if r["status"] == "sent" else eb_problems(b, r["email"], values)})
    return out


# ---- Word (.docx) -> subject + formatted email (bold, italic, underline, colour, highlight, size, font, alignment, links)
EB_HIGHLIGHT = {"yellow": "#FFFF00", "green": "#00FF00", "cyan": "#00FFFF", "magenta": "#FF00FF", "blue": "#0000FF", "red": "#FF0000",
                "darkblue": "#000080", "darkcyan": "#008080", "darkgreen": "#008000", "darkmagenta": "#800080", "darkred": "#800000",
                "darkyellow": "#808000", "darkgray": "#808080", "lightgray": "#C0C0C0", "black": "#000000", "white": "#FFFFFF"}


def _docx_rpr(x):
    """Run properties from a <w:rPr> block."""
    pr = {}
    if not x:
        return pr

    def on(tag):
        m = re.search(r"<w:" + tag + r'(?:\s+w:val="([^"]*)")?\s*/>', x)
        return None if not m else (m.group(1) or "1").lower() not in ("0", "false", "off", "none")
    for key, tag in (("b", "b"), ("i", "i"), ("s", "strike")):
        v = on(tag)
        if v is not None:
            pr[key] = v
    m = re.search(r'<w:u\s+w:val="([^"]+)"', x)
    if m:
        pr["u"] = m.group(1) != "none"
    m = re.search(r'<w:color\s+w:val="([0-9A-Fa-f]{6})"', x)
    if m:
        pr["color"] = "#" + m.group(1).upper()
    m = re.search(r'<w:highlight\s+w:val="(\w+)"', x)
    if m and m.group(1).lower() in EB_HIGHLIGHT:
        pr["bg"] = EB_HIGHLIGHT[m.group(1).lower()]
    m = re.search(r'<w:shd\b[^>]*w:fill="([0-9A-Fa-f]{6})"', x)
    if m and "bg" not in pr:
        pr["bg"] = "#" + m.group(1).upper()
    m = re.search(r'<w:sz\s+w:val="(\d+)"', x)
    if m:
        pr["sz"] = int(m.group(1))
    m = re.search(r'<w:rFonts\b[^>]*\bw:ascii="([^"]+)"', x)
    if m:
        pr["font"] = m.group(1)
    m = re.search(r'<w:rStyle\s+w:val="([^"]+)"', x)
    if m:
        pr["rstyle"] = m.group(1)
    return pr


def eb_docx_template(data):
    """Word (.docx) -> (subject, HTML body). A line 'Subject : ...' gives the subject; lines before it (e.g. a sample
    address) are skipped; everything after it is the email, with its formatting."""
    import io
    import zipfile
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
        xml = z.read("word/document.xml").decode("utf-8")
    except (zipfile.BadZipFile, KeyError):
        raise HTTPError(400, "This is not a Word (.docx) file. In Word use File > Save As > Word Document (.docx).")
    names_in = z.namelist()
    styles_xml = z.read("word/styles.xml").decode("utf-8") if "word/styles.xml" in names_in else ""
    rels_xml = z.read("word/_rels/document.xml.rels").decode("utf-8") if "word/_rels/document.xml.rels" in names_in else ""
    links = {}
    for tag in re.findall(r"<Relationship\b[^>]*>", rels_xml):
        rid, target = re.search(r'\bId="([^"]+)"', tag), re.search(r'\bTarget="([^"]+)"', tag)
        if rid and target and 'TargetMode="External"' in tag:
            links[rid.group(1)] = html.unescape(target.group(1))
    # Word styles (e.g. "Strong", headings): their run properties, following "basedOn"
    styles = {}
    for st in re.findall(r"<w:style\b.*?</w:style>", styles_xml, re.S):
        sid = re.search(r'w:styleId="([^"]+)"', st)
        if sid:
            base = re.search(r'<w:basedOn\s+w:val="([^"]+)"', st)
            rpr = re.search(r"<w:rPr>(.*?)</w:rPr>", st, re.S)
            styles[sid.group(1)] = (base.group(1) if base else None, _docx_rpr(rpr.group(1)) if rpr else {})

    def style_pr(sid, depth=0):
        if not sid or sid not in styles or depth > 10:
            return {"b": True} if sid == "Strong" else {}
        base, pr = styles[sid]
        return {**style_pr(base, depth + 1), **pr}
    dm = re.search(r"<w:docDefaults>.*?<w:sz\s+w:val=\"(\d+)\"", styles_xml, re.S)
    normal_sz = style_pr("Normal").get("sz") or (int(dm.group(1)) if dm else 22)

    def css_of(pr):
        css = []
        if pr.get("b"):
            css.append("font-weight:bold")
        if pr.get("i"):
            css.append("font-style:italic")
        deco = [x for x, k in (("underline", "u"), ("line-through", "s")) if pr.get(k)]
        if deco:
            css.append("text-decoration:" + " ".join(deco))
        if pr.get("color") and pr["color"] != "#000000":
            css.append("color:" + pr["color"])
        if pr.get("bg"):
            css.append("background-color:" + pr["bg"])
        if pr.get("sz") and pr["sz"] != normal_sz:
            css.append(f"font-size:{pr['sz'] / 2:g}pt")
        if pr.get("font"):
            css.append(f"font-family:'{pr['font']}'")
        return ";".join(css)

    paras = []                                               # [(plain text, html)]
    for p in re.findall(r"<w:p[ >].*?</w:p>|<w:p/>", xml, re.S):
        ppr = re.search(r"<w:pPr>(.*?)</w:pPr>", p, re.S)
        ppr = ppr.group(1) if ppr else ""
        pst = re.search(r'<w:pStyle\s+w:val="([^"]+)"', ppr)
        para_pr = style_pr(pst.group(1)) if pst else style_pr("Normal")
        jc = re.search(r'<w:jc\s+w:val="(\w+)"', ppr)
        align = {"center": "center", "right": "right", "end": "right", "both": "justify", "distribute": "justify"}.get(jc.group(1) if jc else "")
        chars = []                                           # [(char, (css, link))]
        body_p = re.sub(r"<w:pPr>.*?</w:pPr>", "", p, flags=re.S)
        for item in re.finditer(r"<w:hyperlink\b[^>]*>.*?</w:hyperlink>|<w:r[ >].*?</w:r>", body_p, re.S):
            chunk, href = item.group(0), None
            if chunk.startswith("<w:hyperlink"):
                rid = re.search(r'r:id="([^"]+)"', chunk)
                href = links.get(rid.group(1)) if rid else None
            for run in re.findall(r"<w:r[ >].*?</w:r>", chunk, re.S) if href is not None or chunk.startswith("<w:hyperlink") else [chunk]:
                rpr = re.search(r"<w:rPr>(.*?)</w:rPr>", run, re.S)
                direct = _docx_rpr(rpr.group(1)) if rpr else {}
                pr = {**para_pr, **style_pr(direct.get("rstyle")), **direct}
                key = (css_of(pr), href)
                for t, br, tab in re.findall(r"<w:t(?: [^>]*)?>(.*?)</w:t>|<w:(br|cr)\b[^>]*/>|<w:(tab)\b[^>]*/>",
                                             re.sub(r"<w:rPr>.*?</w:rPr>", "", run, flags=re.S), re.S):
                    piece = "\n" if br else "\t" if tab else html.unescape(t)
                    chars.extend((ch, key) for ch in piece)
        plain = "".join(ch for ch, _ in chars)
        for fm in EB_FIELD.finditer(plain):                  # a [Field] keeps one look (Word often splits "[" and "Name]")
            k = chars[fm.start() + 1][1]
            for i in range(fm.start(), fm.end()):
                chars[i] = (chars[i][0], k)
        out, i = [], 0
        while i < len(chars):
            j = i
            while j < len(chars) and chars[j][1] == chars[i][1]:
                j += 1
            css, href = chars[i][1]
            txt = html.escape("".join(ch for ch, _ in chars[i:j])).replace("\n", "<br>").replace("\t", "&emsp;")
            if css:
                txt = f'<span style="{css}">{txt}</span>'
            if href:
                txt = f'<a href="{html.escape(href, quote=True)}">{txt}</a>'
            out.append(txt)
            i = j
        style = "margin:0 0 10px" + (f";text-align:{align}" if align else "")
        paras.append((plain, f'<p style="{style}">{"".join(out) or "&nbsp;"}</p>'))
    subject, start = "", 0
    for idx, (plain, _) in enumerate(paras[:max(1, len(paras) // 2)]):
        m = re.search(r"(?i)subject\s*[:：]\s*([^\n]+)", plain)
        if m:
            subject, start = m.group(1).strip(), idx + 1
            break
    body = paras[start:]
    while body and not body[0][0].strip():
        body.pop(0)
    while body and not body[-1][0].strip():
        body.pop()
    return subject[:300], eb_clean_html("<div>" + "".join(h for _, h in body) + "</div>")


def eb_read_table(data, name):
    """Excel (.xlsx) / CSV upload -> list of rows (list of cell texts), first row = headings."""
    import csv
    import io
    import tempfile
    ext = os.path.splitext(name)[1].lower()
    if ext in (".xlsx", ".xlsm"):
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(data)
        try:
            rows = _xlsx_rows(tmp.name)
        except Exception:
            raise HTTPError(400, "Could not read this Excel file - save it as .xlsx (or .csv) and try again.")
        finally:
            os.remove(tmp.name)
    elif ext in (".csv", ".txt"):
        for enc in ("utf-8-sig", "cp1252", "latin-1"):
            try:
                text = data.decode(enc)
                break
            except UnicodeDecodeError:
                continue
        rows = list(csv.reader(io.StringIO(text)))
    else:
        raise HTTPError(400, "Please import an Excel (.xlsx) or CSV file.")
    return [[str(x if x is not None else "").strip() for x in r] for r in rows if any(str(x or "").strip() for x in r)]


EB_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
EB_SAME = str.maketrans({"\u2019": "'", "\u2018": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-",
                         "\xa0": " ", "\ufe0f": None, "\u200b": None, "\uff1a": ":"})


def _docx_text(xml):
    """A piece of Word XML -> plain text (paragraph = new line, page break = blank line)."""
    out = []
    for p in re.findall(r"<w:p[ >].*?</w:p>|<w:p/>", xml, re.S):
        line = []
        for t, br, tab in re.findall(r"<w:t(?: [^>]*)?>(.*?)</w:t>|<w:(br|cr)\b[^>]*/>|<w:(tab)\b[^>]*/>",
                                     re.sub(r"<w:(rPr|pPr)>.*?</w:\1>", "", p, flags=re.S), re.S):
            line.append("\n" if br else "\t" if tab else html.unescape(t))
        out.append("".join(line))
        if 'w:type="page"' in p:
            out.append("")
    return "\n".join(out)


def _eb_norm(text):
    """Text for matching (quotes / dashes / spaces made the same, runs of spaces = one space, lower case) and, for
    every character of it, where it came from in the original text."""
    norm, where, space = [], [], False
    for i, ch in enumerate(text):
        ch = ch.translate(EB_SAME)
        if not ch:
            continue
        if ch.isspace():
            if not space and norm:
                norm.append(" ")
                where.append(i)
            space = True
            continue
        space = False
        norm.append(ch.lower())
        where.append(i)
    return "".join(norm), where


def _eb_label_rows(lines, fields):
    """Lines like 'Name : Ali' / 'Email: ali@x.com' -> one customer per group (a label seen again = next customer)."""
    known = {f.lower().translate(EB_SAME): f for f in fields}
    rows, cur = [], {}
    for line in lines:
        m = re.match(r"^\s*\[?([^\[\]:\n]{1,60}?)\]?\s*[:\uff1a=]\s*(.*?)\s*$", line)
        if not m:
            continue
        label, value = m.group(1).strip().lower().translate(EB_SAME), m.group(2)
        key = "__email" if label in EB_EMAIL_HEADERS else known.get(label)
        if not key:
            continue
        if key in cur:
            rows.append(cur)
            cur = {}
        cur[key] = value
    if cur:
        rows.append(cur)
    return [r for r in rows if len(r) >= 2 or "__email" in r]


def _eb_letter_rows(text, subject, body, fields):
    """Letters that were already written from the template (one per customer): the template's fixed text is found in
    the Word text and whatever stands where a [Field] is becomes that customer's value."""
    tpl = eb_text(body)
    parts = EB_FIELD.split(tpl)                         # literal, field, literal, field, ..., literal
    lits = [_eb_norm(x)[0].strip() for x in parts[0::2]]
    names = [x.strip() for x in parts[1::2]]
    if not names or sum(len(x) for x in lits) < 15:
        return [], 0
    norm, where = _eb_norm(text)
    tpl_emails = {e.lower() for e in EB_EMAIL_RE.findall(tpl)}
    head = lambda x: x[:16]                             # short anchors: a changed word further on does not matter
    tail = lambda x: x[-16:]
    orig = lambda a, b: text[where[a]:where[b - 1] + 1].strip() if b > a else ""

    def line_end(pos):                                  # end of the line (for a template that ends with a [Field])
        k = text.find("\n", where[pos] if pos < len(where) else len(text))
        k = len(text) if k < 0 else k
        return next((j for j in range(pos, len(where)) if where[j] >= k), len(where))

    rows, pos, prev_end = [], 0, 0
    first = tail(lits[0]) if lits[0] else (head(lits[1]) if len(lits) > 1 else "")
    starts = norm.count(first) if first else 0
    while pos < len(norm):
        if lits[0]:
            j = norm.find(tail(lits[0]), pos)
            if j < 0:
                break
            start, cur = j, j + len(tail(lits[0]))
        else:                                            # template starts with a [Field]: the line before the next text
            j = norm.find(head(lits[1]), pos) if len(lits) > 1 and lits[1] else -1
            if j < 0:
                break
            k = text.rfind("\n", 0, where[j])
            start = cur = next((x for x in range(pos, j + 1) if where[x] > k), j)
        vals, ok = {}, True
        for i, name in enumerate(names):
            nxt = lits[i + 1]
            if nxt:
                j = norm.find(head(nxt), cur)
                if j < 0 or j - cur > 3000:
                    ok = False
                    break
                value = orig(cur, j)
                k = norm.find(tail(nxt), j)
                cur = (k + len(tail(nxt))) if 0 <= k <= j + len(nxt) + 200 else j + len(nxt)
            else:
                j = line_end(cur)
                value = orig(cur, j)
                cur = j
            if lits[0] and head(lits[0]) in _eb_norm(value)[0]:   # ran into the next letter
                ok = False
                break
            if value and not vals.get(name.lower()):
                vals[name.lower()] = value
        if not ok:
            pos = start + 1
            continue
        # the text around the letter: the email address, and fields that are only in the subject
        around = orig(prev_end, start) if start > prev_end else ""
        emails = [e for e in EB_EMAIL_RE.findall(around) if e.lower() not in tpl_emails] or \
                 [e for e in EB_EMAIL_RE.findall(orig(start, cur)) if e.lower() not in tpl_emails]
        row = {"__email": emails[-1] if around and emails else (emails[0] if emails else "")}
        sm = None
        if subject and EB_FIELD.search(subject):
            pat = r"\s*".join("(.+?)" if i % 2 else re.escape(x.strip()) for i, x in enumerate(EB_FIELD.split(subject.translate(EB_SAME))) if x.strip() or i % 2)
            for line in around.split("\n"):
                sm = re.search(pat + r"\s*$", line.translate(EB_SAME).strip(), re.I)
                if sm:
                    for f, v in zip([x.strip() for x in EB_FIELD.findall(subject)], sm.groups()):
                        if not vals.get(f.lower()):
                            vals[f.lower()] = v.strip()
                    break
        for f in fields:
            if vals.get(f.lower()):
                row[f] = vals[f.lower()]
        rows.append(row)
        pos = prev_end = cur
    return rows, max(0, starts - len(rows))


def eb_docx_customers(data, subject, body):
    """Customer details written in Word -> (rows, how). Understands: a table with headings (Email, Name, ...),
    'Name : Ali' lines (or a 2-column table), or letters already written from the template (the values are found
    where the template has its [Fields])."""
    import io
    import zipfile
    try:
        xml = zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode("utf-8")
    except (zipfile.BadZipFile, KeyError):
        raise HTTPError(400, "This is not a Word (.docx) file. In Word use File > Save As > Word Document (.docx).")
    fields = eb_fields(subject, body)
    known = {f.lower().translate(EB_SAME): f for f in fields}
    cands = []
    # 1) tables
    tables = re.findall(r"<w:tbl>.*?</w:tbl>", xml, re.S)
    table_rows, pair_lines = [], []
    for tb in tables:
        cells = [[_docx_text(c).strip() for c in re.findall(r"<w:tc>.*?</w:tc>", tr, re.S)]
                 for tr in re.findall(r"<w:tr\b.*?</w:tr>", tb, re.S)]
        cells = [r for r in cells if any(r)]
        if not cells:
            continue
        heads = [re.sub(r"^\[|\]$", "", h).strip().lower().translate(EB_SAME) for h in cells[0]]
        cols = {i: ("__email" if h in EB_EMAIL_HEADERS else known.get(h)) for i, h in enumerate(heads)}
        cols = {i: k for i, k in cols.items() if k}
        if cols and len(cells) > 1 and (len(cols) >= 2 or "__email" in cols.values()):
            for r in cells[1:]:
                table_rows.append({k: (r[i] if i < len(r) else "") for i, k in cols.items()})
        else:
            pair_lines += [f"{r[0]}: {' '.join(r[1:])}" for r in cells if len(r) >= 2]
    if table_rows:
        cands.append((table_rows, "a Word table"))
    text = _docx_text(re.sub(r"<w:tbl>.*?</w:tbl>", "", xml, flags=re.S))
    lab = _eb_label_rows(pair_lines + text.split("\n"), fields)
    if lab:
        cands.append((lab, '"Field : value" lines'))
    let, skipped = _eb_letter_rows(text, subject, body, fields) if fields else ([], 0)
    if let or skipped:
        cands.append((let, "letters written from the template" + (
            f" - {skipped} letter(s) could not be read because their wording is different from the template; "
            "add those customers by hand" if skipped else "")))
    if not any(c[0] for c in cands):
        if cands:
            raise HTTPError(400, "Letters were found, but none could be read: " + cands[-1][1].split(" - ", 1)[-1])
        raise HTTPError(400, "No customer details found in this Word file. It can have: a table with the headings "
                        "Email, " + ", ".join(fields[:5]) + " ... - or lines like 'Name : Ali' - or the emails already "
                        "written from this template (the words around each [Field] must be the same as the template).")
    score = lambda rows: sum(1 for r in rows for v in r.values() if str(v).strip())
    rows, how = max(cands, key=lambda c: score(c[0]))
    return [{"email": r.get("__email", "").strip(), "fields": {k: v for k, v in r.items() if k != "__email"}} for r in rows], how


def eb_xlsx(headers, rows=()):
    """A small Excel (.xlsx) file: bold heading row, all cells as text (so 0123 or a PIN keeps its zeros)."""
    return xlsx_book([("Customers", headers, rows)])


def xlsx_book(sheets):
    """An Excel (.xlsx) file with one sheet per (name, headings, rows): bold heading row, all cells as text."""
    import io
    import zipfile
    from xml.sax.saxutils import escape as xesc
    strings, index = [], {}

    def sid(v):
        v = str(v)
        if v not in index:
            index[v] = len(strings)
            strings.append(v)
        return index[v]

    def col(i):
        s = ""
        i += 1
        while i:
            i, r = divmod(i - 1, 26)
            s = chr(65 + r) + s
        return s
    sheet_xml = []
    for _name, headers, rows in sheets:
        lines = []
        for r_i, row in enumerate([list(headers)] + [list(r) for r in rows], 1):
            cells = "".join(f'<c r="{col(c_i)}{r_i}" t="s" s="{1 if r_i == 1 else 2}"><v>{sid(v)}</v></c>' for c_i, v in enumerate(row))
            lines.append(f'<row r="{r_i}">{cells}</row>')
        widths = "".join(f'<col min="{i + 1}" max="{i + 1}" width="{max(14, min(45, len(str(h)) + 6))}" style="2" customWidth="1"/>'
                         for i, h in enumerate(headers))
        sheet_xml.append('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                         '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                         '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
                         f'<cols>{widths}</cols><sheetData>{"".join(lines)}</sheetData></worksheet>')
    n = len(sheets)
    sst = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
           f'<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="{len(strings)}" uniqueCount="{len(strings)}">'
           + "".join(f'<si><t xml:space="preserve">{xesc(s)}</t></si>' for s in strings) + '</sst>')
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
              '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
              '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FF2E3A87"/><bgColor indexed="64"/></patternFill></fill></fills>'
              '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
              '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyNumberFormat="1"/>'
              '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs></styleSheet>')
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            + "".join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                      for i in range(1, n + 1)) +
            '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        "xl/workbook.xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets>' + "".join(f'<sheet name="{xesc(nm[:31])}" sheetId="{i}" r:id="rId{i}"/>' for i, (nm, _h, _r) in enumerate(sheets, 1))
            + '</sheets></workbook>',
        "xl/_rels/workbook.xml.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="rId{i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i}.xml"/>'
                      for i in range(1, n + 1))
            + f'<Relationship Id="rId{n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
            f'<Relationship Id="rId{n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        "xl/sharedStrings.xml": sst, "xl/styles.xml": styles,
        **{f"xl/worksheets/sheet{i}.xml": x for i, x in enumerate(sheet_xml, 1)}}
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(name, text)
    return buf.getvalue()


EB_LIMIT_WORDS = re.compile(r"(?i)limit|exceed|quota|throttl|too many|rate|4\.4\.2|4\.7\.0|5\.2\.0|4\.3\.1|4\.3\.2|\b421\b|\b452\b")


def eb_quota(c):
    """Emails sent by Email Batch in the last 24 hours, and the limit set on the Email Batch page."""
    cfg = setting_all(c)
    try:
        limit = max(0, int(cfg.get("eb_daily_limit") or 2000))
    except ValueError:
        limit = 2000
    since = time.time() - 86400
    sent = c.execute("SELECT COUNT(*) FROM eb_recipients WHERE status='sent' AND sent_at>?", (since,)).fetchone()[0]
    return {"limit": limit, "sent24h": sent, "left": max(0, limit - sent) if limit else None, "gap": EB_GAP}


def eb_wait_until(c, limit):
    """When the 24-hour window has room for one more email again."""
    times = [r[0] for r in c.execute("SELECT sent_at FROM eb_recipients WHERE status='sent' AND sent_at>? ORDER BY sent_at",
                                     (time.time() - 86400,))]
    over = len(times) - limit
    return (times[over] if 0 <= over < len(times) else time.time()) + 86400 + 5


def eb_notify(bid, what, tries=0):
    """Tell people by email what happened to a batch: the person who pressed Send, and everyone with 'Email Batch' ticked
    on the Email Alerts page. what = finished / waiting / paused. When the mail server itself is the problem the notice
    is tried again every 30 minutes (for up to a day); the batch page and the bell show it meanwhile."""
    try:
        with DB() as c:
            b = c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone()
            cfg = setting_all(c)
            if not b or not email_ready(cfg):
                return
            if tries and ((what == "paused" and not (b["status"] == "stopped" and b["note"]))
                          or (what == "waiting" and not b["wait_until"])):
                return                                       # a late try: that situation is over already
            j = eb_json(c, b, rows=False)
            people = {}
            for r in c.execute("SELECT id, name, email, role, alert_prefs FROM users WHERE active=1 AND email IS NOT NULL AND email != ''"):
                if r["id"] == b["sent_by"] or (r["role"] != "viewer" and user_prefs(r).get("ebatch")
                                                and (r["role"] in ("superadmin", "admin") or eb_access(c, r)["view"])):
                    people[r["email"].strip().lower()] = r["email"].strip()
            link = site_url(cfg) + f"/#/eb/{bid}"
        if not people:
            return
        name = f'{j["batchNo"]}' + (f' – {j["title"]}' if j["title"] else "")
        counts = f'{j["sent"]} sent · {j["failed"]} failed · {j["pending"]} waiting (of {j["total"]})'
        if what == "finished":
            subject = f'Email Batch {j["batchNo"]} finished: {j["sent"]} sent' + (f', {j["failed"]} failed' if j["failed"] else "")
            head, colour = "✔ Sending finished", "#15803d"
            msg = ("All emails have been sent." if not j["failed"] else
                   "Some emails failed – open the batch to see why, and press “Send the failed ones again”.")
        elif what == "waiting":
            subject = f'Email Batch {j["batchNo"]}: daily sending limit reached – continues by itself'
            head, colour, msg = "⏳ Waiting for the daily limit", "#b45309", j["note"]
        else:
            subject = f'Email Batch {j["batchNo"]} PAUSED – action needed'
            head, colour, msg = "⏸ Sending paused", "#b91c1c", j["note"]
        text = f"{head}\n{name}\n{counts}\n\n{msg}\n\nOpen: {link}"
        body = (f'<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#1f2937">'
                f'<h2 style="color:{colour};margin:0 0 8px">{html.escape(head)}</h2>'
                f'<div style="font-size:15px"><b>{html.escape(name)}</b></div>'
                f'<div style="margin:6px 0 12px;color:#4b5563">{html.escape(counts)}</div>'
                f'<p style="white-space:pre-line">{html.escape(msg)}</p>'
                f'<p><a href="{html.escape(link)}" style="background:#1d4ed8;color:#fff;padding:8px 14px;border-radius:6px;'
                f'text-decoration:none">Open the batch</a></p></div>')
        send_mail(cfg, list(people.values()), subject, text, body)
    except Exception as e:                                   # the note on the batch page / the bell still tell them
        print(f"Email Batch notice not sent: {e}")
        if tries < 48:
            tm = threading.Timer(1800, eb_notify, args=(bid, what, tries + 1))
            tm.daemon = True
            tm.start()


def eb_worker(bid):
    """Background: send the pending emails of a batch one by one - keeping to the 24-hour limit, pausing when the mail
    server stops accepting emails, and telling people by email when the batch finishes or pauses."""
    fails_in_row = 0
    try:
        while True:
            with DB() as c:
                b = c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone()
                if not b or b["cancelled_at"] or b["status"] != "sending":
                    return
                r = c.execute("SELECT * FROM eb_recipients WHERE batch_id=? AND status='pending' ORDER BY row_no LIMIT 1",
                              (bid,)).fetchone()
                cfg = setting_all(c)
                if not r:
                    failed = c.execute("SELECT COUNT(*) FROM eb_recipients WHERE batch_id=? AND status='failed'", (bid,)).fetchone()[0]
                    c.execute("UPDATE eb_batches SET status=?, finished_at=?, note=NULL, wait_until=NULL WHERE id=?",
                              ("partial" if failed else "sent", time.time(), bid))
                    done = True
                else:
                    done = False
                    q = eb_quota(c)
                    if q["limit"] and q["sent24h"] >= q["limit"]:            # 24-hour limit: wait, then go on by itself
                        until = eb_wait_until(c, q["limit"])
                        first = not b["wait_until"]
                        c.execute("UPDATE eb_batches SET wait_until=?, note=? WHERE id=?", (until, (
                            f"The limit of {q['limit']} emails per 24 hours is reached. Sending continues by itself at "
                            f"{time.strftime('%d/%m/%Y %H:%M', time.localtime(until))} - nothing to do. "
                            f"(The limit can be changed on the Email Batch page.)"), bid))
                    elif b["wait_until"]:
                        c.execute("UPDATE eb_batches SET wait_until=NULL, note=NULL WHERE id=?", (bid,))
                        first = None
                    else:
                        first = None
            if done:
                eb_notify(bid, "finished")
                return
            if first is not None:                                            # waiting for the 24-hour limit
                if first:
                    eb_notify(bid, "waiting")
                time.sleep(30)
                continue
            values = json.loads(r["fields"] or "{}")
            subject, text, body = eb_render(b, values)
            problems = eb_problems(b, r["email"], values)
            err = "; ".join(problems) if problems else None
            pause = None
            if not err:
                try:
                    send_mail(cfg, [r["email"].strip()], subject, text, body, from_name=b["from_name"] or "Company Name")
                except smtplib.SMTPRecipientsRefused as e:                   # this address only
                    err = mail_error_text(e, cfg)[:500]
                except smtplib.SMTPDataError as e:                           # this email - unless it is the sending limit
                    err = mail_error_text(e, cfg)[:500]
                    if EB_LIMIT_WORDS.search(str(e)):
                        pause = ("The mail server stopped accepting emails - its sending limit is reached (Office 365: "
                                 "about 10,000 per day, 30 per minute). Wait a few hours (up to 24), then press "
                                 "“Continue sending”.\n\n" + err)
                except Exception as e:                                       # login / connection / limit: every email would fail
                    err = mail_error_text(e, cfg)[:500]
                    pause = (("The mail server's sending limit is reached. Wait a few hours (up to 24), then press "
                              "“Continue sending”." if EB_LIMIT_WORDS.search(str(e)) else
                              "The mail server could not be used, so sending was paused (no email was lost). Fix the "
                              "problem, then press “Continue sending”.") + "\n\n" + err)
            fails_in_row = fails_in_row + 1 if err else 0
            if not pause and fails_in_row >= 10:
                pause = ("10 emails in a row failed, so sending was paused to protect the mailbox. Check the errors in "
                         "the customer list, then press “Continue sending”.")
            with DB() as c:
                if pause and err and fails_in_row < 10:                      # keep this customer waiting - not failed
                    c.execute("UPDATE eb_recipients SET error=? WHERE id=?", (err, r["id"]))
                else:
                    c.execute("UPDATE eb_recipients SET status=?, error=?, sent_at=?, sent_subject=?, sent_html=? WHERE id=?",
                              ("failed" if err else "sent", err, time.time(), subject, body, r["id"]))
                if pause:
                    c.execute("UPDATE eb_batches SET status='stopped', note=?, wait_until=NULL WHERE id=? AND status='sending'",
                              (pause[:1500], bid))
            if pause:
                eb_notify(bid, "paused")
                return
            time.sleep(EB_GAP)
    finally:
        EB_SENDING.discard(bid)


def eb_start(bid):
    if bid not in EB_SENDING:
        EB_SENDING.add(bid)
        threading.Thread(target=eb_worker, args=(bid,), daemon=True).start()


def section_perms(user, a, st):
    """What `user` may do with one section of one application right now."""
    role = user["role"]
    # Each person has their own submit: an Admin's submit does not lock a User, and the other way round.
    submitted = st.get("myStatus") == "submitted"      # submitted by THIS person
    anyone = st["status"] == "submitted"               # submitted by somebody
    none = {"view": False, "edit": False, "check": False, "submit": False,
            "resubmit": False, "reopen": False, "resubmitsLeft": 0, "viewOnly": False}
    if role == "superadmin":
        return {**none, "view": True, "edit": True, "check": True, "submit": not submitted, "reopen": anyone}
    if role == "viewer":
        return {**none, "view": True}
    has = a["edit"] or a["check"]
    if role == "admin":
        return {**none, "view": True, "edit": a["edit"], "check": a["check"],
                "submit": has and not submitted, "reopen": anyone}
    # normal user: SAVE only - only Admin / Super Admin submit. Once the section is submitted
    # it is locked for Users until an Admin reopens it.
    if not a["edit"]:
        # "View Only": can read the section in every application, but not change or submit it
        return {**none, "view": True, "viewOnly": True} if a.get("view") else none
    return {**none, "view": True, "edit": not anyone, "check": a["check"] and not anyone}


def app_statuses(c, app_ids=None):
    q = "SELECT * FROM section_status" + (" WHERE app_id=?" if app_ids else "")
    out = {}
    for r in c.execute(q, app_ids or ()):
        out.setdefault(r["app_id"], {})[r["section"]] = r
    return out


def my_submits(c, user, app_id=None):
    """{app_id: {section: number of times this user submitted it}}"""
    q = "SELECT app_id, section, COUNT(*) n FROM section_log WHERE user_id=? AND action='submit'"
    args = [user["id"]]
    if app_id:
        q += " AND app_id=?"
        args.append(app_id)
    out = {}
    for r in c.execute(q + " GROUP BY app_id, section", args):
        out.setdefault(r["app_id"], {})[r["section"]] = r["n"]
    return out


def my_status(c, user, app_id=None):
    """{app_id: {section: 'submitted' | 'draft'}} - this person's own submit status."""
    q = "SELECT app_id, section, status FROM person_status WHERE user_id=?"
    args = [user["id"]]
    if app_id:
        q += " AND app_id=?"
        args.append(app_id)
    out = {}
    for r in c.execute(q, args):
        out.setdefault(r["app_id"], {})[r["section"]] = r["status"]
    return out


def status_of(rows, s, mine=None, mystat=None):
    r = (rows or {}).get(s)
    return {"status": r["status"] if r else "draft", "count": r["submit_count"] if r else 0,
            "mine": (mine or {}).get(s, 0), "myStatus": (mystat or {}).get(s, "draft")}


def record_submit(c, app_id, sec, user, now):
    c.execute("INSERT OR IGNORE INTO section_status(app_id, section) VALUES(?,?)", (app_id, sec))
    c.execute("UPDATE section_status SET status='submitted', submit_count=submit_count+1,"
              " submitted_by=?, submitted_at=? WHERE app_id=? AND section=?", (user["id"], now, app_id, sec))
    c.execute("INSERT INTO person_status(app_id, section, user_id, status) VALUES(?,?,?,'submitted')"
              " ON CONFLICT(app_id, section, user_id) DO UPDATE SET status='submitted'", (app_id, sec, user["id"]))


def refresh_shared_status(c, app_id, sec):
    """The section counts as submitted while at least one person's submission is still locked."""
    anyone = c.execute("SELECT 1 FROM person_status WHERE app_id=? AND section=? AND status='submitted'",
                       (app_id, sec)).fetchone()
    c.execute("INSERT OR IGNORE INTO section_status(app_id, section) VALUES(?,?)", (app_id, sec))
    c.execute("UPDATE section_status SET status=? WHERE app_id=? AND section=?",
              ("submitted" if anyone else "draft", app_id, sec))


def coa_access(c, user):
    """May this person open the COA Application program at all? Super Admin / Admin / Viewer: yes. A User: only when
    something is ticked for them under Access Control > COA Application (a section, or Create New Application)."""
    if user["role"] in ("superadmin", "admin", "viewer"):
        return True
    if any(a["view"] or a["edit"] or a["check"] for a in user_access(c, user).values()):
        return True
    return can_create(c, user, "coa")


def can_see_app(c, user, row):
    # Everyone with COA access works on the same applications; what a User sees inside is limited per section.
    return coa_access(c, user)


LOCKED = {"edit": False, "check": False, "submit": False, "resubmit": False, "reopen": False}
EUP_KEYS = set(SECTIONS["F"]["checks"]) - {"isEup"}


def item_applies(key, data):
    """Same rules as the form: Previous COA No. only for renewals; energy items only for EUP products."""
    if key == "prevCoaNo":
        return data.get("appType") == "Renewal"
    if key in EUP_KEYS:
        return data.get("isEup") != "No"
    if key in ST_ONLY or key in ECOS_ONLY:
        st, ecos = st_ecos_ticks(data)
        return st if key in ST_ONLY else ecos
    return True


def checklist_progress(data, checks):
    """Checklist progress over the WHOLE form (all sections), whoever is looking."""
    keys = [k for sec in SECTIONS.values() for k in sec["checks"] if item_applies(k, data)]
    done = sum(1 for k in keys if checks.get(k))
    return {"checkDone": done, "checkTotal": len(keys), "completed": bool(keys) and done == len(keys)}


def app_json(row, files, nm, user, acc, stat_rows, mine=None, mystat=None):
    """Application as seen by `user` - hidden sections are stripped out."""
    cancelled = bool(row["cancelled_at"])
    sections = {}
    for s in SECTIONS:
        st = status_of(stat_rows, s, mine, mystat)
        r = (stat_rows or {}).get(s)
        p = section_perms(user, acc[s], st)
        if cancelled:
            p.update(LOCKED)          # a cancelled application is read-only for everyone
        sections[s] = {**p, **st,
                       "by": nm.get(r["submitted_by"], "") if r and r["submitted_by"] else "",
                       "at": r["submitted_at"] if r else None}
    visible = {s for s, p in sections.items() if p["view"]}
    data, checks, remarks = json.loads(row["data"]), json.loads(row["checks"]), json.loads(row["remarks"])
    grouped = {}
    for f in files:
        if FILE_SEC.get(f["field"]) in visible:
            grouped.setdefault(f["field"], []).append(file_json(f, nm))
    return {"id": row["id"], "formNo": row["form_no"], "dateApply": row["date_apply"],
            "data": {k: v for k, v in data.items() if DATA_SEC.get(k) in visible},
            "checks": {k: v for k, v in checks.items() if CHECK_SEC.get(k) in visible},
            "remarks": {k: v for k, v in remarks.items() if REMARK_SEC.get(k) in visible},
            "summary": {**{k: data.get(k, "") for k in SUMMARY_KEYS}, **checklist_progress(data, checks)},
            "files": grouped, "sections": sections, "version": row["version"],
            "canHeader": is_admin(user) and not cancelled, "canCancel": is_admin(user) and not cancelled,
            "cancelled": cancelled, "cancelledAt": row["cancelled_at"],
            "cancelledBy": nm.get(row["cancelled_by"], "") if cancelled else "", "cancelReason": row["cancel_reason"] or "",
            "createdAt": row["created_at"], "createdBy": nm.get(row["created_by"], ""),
            "updatedAt": row["updated_at"], "updatedBy": nm.get(row["updated_by"], "")}


def load_row(c, user, app_id):
    row = c.execute("SELECT * FROM apps WHERE id=?", (app_id,)).fetchone()
    if not row or not can_see_app(c, user, row):
        raise HTTPError(404, "Application not found.")
    return row


def load_app(c, user, app_id):
    row = load_row(c, user, app_id)
    files = c.execute("SELECT * FROM files WHERE app_id=? AND removed_at IS NULL ORDER BY uploaded_at", (app_id,)).fetchall()
    return app_json(row, files, names(c), user, user_access(c, user), app_statuses(c, (app_id,)).get(app_id),
                    my_submits(c, user, app_id).get(app_id), my_status(c, user, app_id).get(app_id))


def perms_for(c, user, app_id):
    acc = user_access(c, user)
    rows = app_statuses(c, (app_id,)).get(app_id)
    mine = my_submits(c, user, app_id).get(app_id)
    mystat = my_status(c, user, app_id).get(app_id)
    out = {s: section_perms(user, acc[s], status_of(rows, s, mine, mystat)) for s in SECTIONS}
    if c.execute("SELECT cancelled_at FROM apps WHERE id=?", (app_id,)).fetchone()["cancelled_at"]:
        for p in out.values():
            p.update(LOCKED)
    return out


def get_options(c):
    out = {k: dict(v) if isinstance(v, dict) else list(v) for k, v in DEFAULT_OPTIONS.items()}
    for r in c.execute("SELECT * FROM option_lists"):
        if r["list_key"] in out:
            out[r["list_key"]] = json.loads(r["items"])
    return out


def audit(c, app_id, user, action, section=None, field=None, old=None, new=None, at=None):
    """Append one line to the audit trail. Nothing in the audit trail is ever changed or deleted."""
    c.execute("INSERT INTO audit_log(app_id, at, user_id, action, section, field, old_value, new_value) VALUES(?,?,?,?,?,?,?,?)",
              (app_id, at or time.time(), user["id"], action, section, field,
               None if old is None else str(old)[:2000], None if new is None else str(new)[:2000]))


def auto_st_status(c, app_id, user, now):
    """Submitting Section I means the application went to ST: ST Status becomes "Submitted" (if not set yet)."""
    row = c.execute("SELECT data FROM apps WHERE id=?", (app_id,)).fetchone()
    data = json.loads(row["data"])
    changed = False
    for key in STATUS_KEYS:                              # ST Status and eCOS Status
        old = data.get(key) or ""
        if old in ("", "Not Submitted"):
            data[key] = "Submitted"
            changed = True
            audit(c, app_id, user, "edit", "I", key, old or "Not Submitted", "Submitted", at=now)
    if changed:
        c.execute("UPDATE apps SET data=?, version=version+1 WHERE id=?", (json.dumps(data), app_id))


def auto_st_draft(c, app_id, user, now):
    """Section I reopened (draft again): ST Status goes back from "Submitted" to "Not Submitted".
    A status the Super Admin set later (Under Evaluation, Approved, ...) is left alone."""
    st = c.execute("SELECT status FROM section_status WHERE app_id=? AND section='I'", (app_id,)).fetchone()
    if st and st["status"] == "submitted":
        return
    row = c.execute("SELECT data FROM apps WHERE id=?", (app_id,)).fetchone()
    data = json.loads(row["data"])
    changed = False
    for key in STATUS_KEYS:
        if data.get(key) == "Submitted":
            data[key] = "Not Submitted"
            changed = True
            audit(c, app_id, user, "edit", "I", key, "Submitted", "Not Submitted", at=now)
    if changed:
        c.execute("UPDATE apps SET data=?, version=version+1 WHERE id=?", (json.dumps(data), app_id))


def add_contributor(c, app_id, user_id):
    c.execute("INSERT OR IGNORE INTO contributors VALUES(?,?)", (app_id, user_id))


# login throttling: ip -> [failure timestamps]
FAILS = {}
FAILS_LOCK = threading.Lock()


def idle_minutes(c):
    """Automatic sign-out after this many minutes without activity (0 = off). Settings > Server."""
    r = c.execute("SELECT value FROM app_settings WHERE key='session_idle_min'").fetchone()
    v = (r["value"] if r else "30") or "30"
    return int(v) if str(v).isdigit() else 30


def site_version_tag():
    """A number that changes whenever app.js, styles.css or index.html is replaced."""
    return str(int(max([os.path.getmtime(os.path.join(PUBLIC, f)) for f in ("app.js", "styles.css", "index.html")
                        if os.path.isfile(os.path.join(PUBLIC, f))] or [0])))


def throttled(ip):
    now = time.time()
    with FAILS_LOCK:
        FAILS[ip] = [t for t in FAILS.get(ip, []) if now - t < 300]
        return len(FAILS[ip]) >= 8


def record_fail(ip):
    with FAILS_LOCK:
        FAILS.setdefault(ip, []).append(time.time())


# ---------------------------------------------------------------- handler
# ================================================================ Consignment Test Application (was "SIRIM Inspection")
SIRIM_SEC = "SIRIM"                     # key used in section_access / section_status / person_status / audit_log
SIRIM_FIELDS = (
    # product information
    "ctProductName", "ctCategory", "ctSubCategory", "ctModel", "ctBrand", "ctVoltage", "ctCurrent", "ctFrequency",
    "ctPower", "ctAdapter", "ctK1", "ctQty", "ctSerialRange",
    # COA / COE information
    "coaNo", "ctCoaExpiry", "ctCoaApproval", "ctCoeNo", "ctCoeExpiry", "ctCoeApproval",
    # for safety
    "ctSafStd", "ctSafReport", "ctSafCert", "ctSafIdentical",
    # for energy efficiency
    "ctIsEup", "ctEeStd", "ctEeReport", "ctEeCert", "ctEeIdentical", "ctEeStar", "ctEeYear", "ctEeAec", "ctEeSaving", "ctEeTesting",
    # B. inspection information
    "ctLocName", "ctLocAddr1", "ctLocAddr2", "ctLocAddr3", "ctContactA", "ctContactB", "ctTelA", "ctTelB",
    "ctEmailA", "ctEmailB", "ctHpA", "ctHpB", "estArrival", "estInspection", "ctReqTime",
)
SIRIM_DATE_FIELDS = ("ctCoaExpiry", "ctCoeExpiry", "estArrival", "estInspection", "ctReqTime",
                     "ctEmailA", "ctEmailB", "ctIsEup")          # dates, time and e-mail addresses are not put in capitals
LOCATION_FIELDS = ("name", "addr1", "addr2", "addr3", "contactA", "contactB", "telA", "telB", "emailA", "emailB", "hpA", "hpB")
SIRIM_DOCS = {"invoice": "Invoice", "packingList": "Packing List", "bol": "Bill of Lading (BOL)", "k1Form": "Customs Form (K1)",
              "serialFile": "Serial Number"}
# "Fill from COA": COA Application field -> Consignment Test field
COA_TO_CT = {"equipmentName": "ctProductName", "productCategory": "ctCategory", "companyModel": "ctModel", "companyBrand": "ctBrand",
             "isEup": "ctIsEup", "ratedVoltage": "ctVoltage", "ratedFrequency": "ctFrequency", "ratedPower": "ctPower", "k1No": "ctK1",
             "coaExpiry": "ctCoaExpiry", "coeNo": "ctCoeNo", "coeExpiry": "ctCoeExpiry",
             "standard": "ctSafStd", "testReportNo": "ctSafReport", "cbRefNo": "ctSafCert"}
MAX_SERIALS = 100000
SERIAL_DOC_TYPES = (".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp", ".tif", ".tiff")


def sirim_access(c, user):
    """SIRIM rights of one person: view / edit (= Submit Detail) / resubmits / create."""
    if user["role"] == "superadmin":
        return {"view": True, "edit": True, "check": False, "resubmits": 0, "create": True}
    r = c.execute("SELECT * FROM section_access WHERE user_id=? AND section=?", (user["id"], SIRIM_SEC)).fetchone()
    return {"view": bool(r and r["can_view"]), "edit": bool(r and r["can_edit"]), "check": False,
            "resubmits": r["resubmits"] if r else 0, "create": can_create(c, user, "sirim")}


_RANGE_SEP = re.compile(r"\s*(?:-|~|\u2013|\bTO\b)\s*", re.I)


def _range_one(s):
    """'2606XPB60-655S0001-2606XPB60-655S0870' -> 870, 'A0001-0870' -> 870, one serial -> 1"""
    for m in _RANGE_SEP.finditer(s):
        a, b = s[:m.start()].strip(), s[m.end():].strip()
        ma, mb = re.fullmatch(r"(.*?)(\d+)", a), re.fullmatch(r"(.*?)(\d+)", b)
        if ma and mb and (mb.group(1) in ("", ma.group(1))) and (mb.group(1) == "" or len(ma.group(2)) == len(mb.group(2))):
            n = int(mb.group(2)) - int(ma.group(2)) + 1
            if n >= 1:
                return n
    return 1


def serial_range_count(text):
    """How many serial numbers the typed Serial No. field covers (ranges and single numbers, split by , ; or new line)."""
    if "SEE IMPORTED LIST" in (text or "").upper():      # summary line written by the import
        return None
    parts = [x.strip() for x in re.split(r"[\n,;]+", text or "") if x.strip()]
    return sum(_range_one(x) for x in parts) if parts else None


def quantity_problems(data):
    """Quantity must match the serial numbers (uploaded Excel/CSV list and / or the typed Serial No. range)."""
    qty = (data.get("ctQty") or "").strip()
    listed = len(set(data.get("serials") or [])) or None
    ranged = serial_range_count(data.get("ctSerialRange"))
    out = []
    if not qty and (listed or ranged):
        out.append(f"Fill in Quantity ({listed or ranged} serial numbers).")
    elif qty:
        q = int(qty) if qty.isdigit() else None
        if q is None:
            out.append("Quantity must be a whole number.")
        else:
            if listed is not None and listed != q:
                out.append(f"Quantity is {q} but the uploaded serial number list has {listed}.")
            if ranged is not None and ranged != q:
                out.append(f"Quantity is {q} but the Serial No. range covers {ranged}.")
    return out


def split_power_current(text):
    """COA 'Rated Power / Current' -> Power (W, kW) and Current (A, mA): '1500W / 6.5A' -> 1500W and 6.5A."""
    text = (text or "").strip()
    if not text:
        return {}
    power, current = [], []
    for part in re.split(r"\s*[/,;]\s*|\s{2,}", text):
        p = part.strip()
        if not p:
            continue
        if re.search(r"\d\s*(M?A)$", p, re.I):          # 6.5A, 500MA
            current.append(p)
        else:                                          # 1500W, 1.5KW, or anything else
            power.append(p)
    if not current:                                    # nothing to split: keep it exactly as typed
        return {"ctPower": text}
    out = {}
    if power:
        out["ctPower"] = " / ".join(power)
    if current:
        out["ctCurrent"] = " / ".join(current)
    return out


def next_sirim_no(c):
    mx = 0
    for (fn,) in c.execute("SELECT form_no FROM sirim"):
        m = re.search(r"(\d+)\s*$", fn or "")
        if m:
            mx = max(mx, int(m.group(1)))
    return f"COMPANY-CTA-{mx + 1:03d}"


def sirim_perms(c, user, row):
    """Same rules as a COA section: own submit locks it for a User; Admin edits/reopens; cancelled = read-only."""
    sid = row["id"]
    st = status_of(app_statuses(c, (sid,)).get(sid), SIRIM_SEC,
                   my_submits(c, user, sid).get(sid), my_status(c, user, sid).get(sid))
    p = section_perms(user, sirim_access(c, user), st)
    if row["cancelled_at"]:
        p.update(LOCKED)
    return p, st


def sirim_json(c, row, user, nm=None):
    nm = nm or names(c)
    p, st = sirim_perms(c, user, row)
    r = (app_statuses(c, (row["id"],)).get(row["id"]) or {}).get(SIRIM_SEC)
    files = {}
    for f in c.execute("SELECT * FROM sirim_files WHERE sirim_id=? AND removed_at IS NULL ORDER BY uploaded_at", (row["id"],)):
        files.setdefault(f["field"], []).append(file_json(f, nm))
    cancelled = bool(row["cancelled_at"])
    return {"id": row["id"], "formNo": row["form_no"], "data": json.loads(row["data"]), "files": files,
            "perms": {**p, **st, "by": nm.get(r["submitted_by"], "") if r and r["submitted_by"] else "",
                      "at": r["submitted_at"] if r else None},
            "canCancel": is_admin(user) and not cancelled, "cancelled": cancelled, "cancelledAt": row["cancelled_at"],
            "canDelete": user["role"] == "superadmin" and sirim_never_submitted(c, row["id"]),
            "cancelledBy": nm.get(row["cancelled_by"], "") if cancelled else "", "cancelReason": row["cancel_reason"] or "",
            "createdAt": row["created_at"], "createdBy": nm.get(row["created_by"], ""),
            "updatedAt": row["updated_at"], "updatedBy": nm.get(row["updated_by"], "")}


def sirim_never_submitted(c, sid):
    """A Draft made by mistake: nobody ever submitted it (only such a form may be deleted)."""
    return not c.execute("SELECT 1 FROM section_log WHERE app_id=? AND action='submit'", (sid,)).fetchone() and \
        not c.execute("SELECT 1 FROM section_status WHERE app_id=? AND status<>'draft'", (sid,)).fetchone()


def sirim_storage_path(form_no, doc_label, filename):
    """uploads/<COMPANY-SIR-001>/<Invoice>/<original file name>"""
    folder = os.path.join(safe_name(form_no, "form", True), safe_name(doc_label, "documents", True))
    os.makedirs(os.path.join(UPLOADS, folder), exist_ok=True)
    stem, ext = os.path.splitext(safe_name(filename))
    rel, n = os.path.join(folder, stem + ext), 1
    while os.path.exists(os.path.join(UPLOADS, rel)) or os.path.exists(os.path.join(UPLOADS, rel + ".part")):
        n += 1
        rel = os.path.join(folder, f"{stem} ({n}){ext}")
    return rel


def _xlsx_rows(path):
    """Rows of the first worksheet of an .xlsx file (standard library only)."""
    book = _xlsx_book(path, first_only=True)
    return book[0][1] if book else []


def _xlsx_book(path, first_only=False):
    """[(sheet name, rows), ...] of an .xlsx file, in the order of its tabs."""
    import zipfile
    import xml.etree.ElementTree as ET
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    rel_ns = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    with zipfile.ZipFile(path) as z:
        shared = []
        if "xl/sharedStrings.xml" in z.namelist():
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", ns):
                shared.append("".join(t.text or "" for t in si.iter("{%s}t" % ns["m"])))
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        targets = {}
        if "xl/_rels/workbook.xml.rels" in z.namelist():
            for rel in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")):
                t = (rel.get("Target") or "").lstrip("/")
                targets[rel.get("Id")] = t if t.startswith("xl/") else "xl/" + t
        tabs = [(sh.get("name") or f"Sheet{i}", targets.get(sh.get(rel_ns), f"xl/worksheets/sheet{i}.xml"))
                for i, sh in enumerate(wb.findall("m:sheets/m:sheet", ns), 1)] or [("Sheet1", "xl/worksheets/sheet1.xml")]
        book = []
        for tab_name, target in tabs[:1] if first_only else tabs:
            if target in z.namelist():
                book.append((tab_name, _xlsx_sheet_rows(ET.fromstring(z.read(target)), shared, ns)))
        return book


def _xlsx_sheet_rows(sheet, shared, ns):
    rows = []
    for row in sheet.iter("{%s}row" % ns["m"]):
        cells = {}
        for cell in row.findall("m:c", ns):
            ref = re.match(r"([A-Z]+)", cell.get("r", "A"))
            col = 0
            for ch in (ref.group(1) if ref else "A"):
                col = col * 26 + ord(ch) - 64
            kind, v = cell.get("t"), cell.find("m:v", ns)
            if kind == "s" and v is not None:
                val = shared[int(v.text)]
            elif kind == "inlineStr":
                val = "".join(t.text or "" for t in cell.iter("{%s}t" % ns["m"]))
            else:
                val = v.text if v is not None else ""
                if re.fullmatch(r"-?\d+\.0+", val or ""):
                    val = val.split(".")[0]          # 12345.0 -> 12345
            cells[col - 1] = (val or "").strip()
        if cells:
            rows.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return rows


def read_serials(path, name):
    """Serial numbers from a .xlsx / .csv / .txt file: the column titled "Serial…" (or S/N), else the first column."""
    import csv
    import io
    ext = os.path.splitext(name)[1].lower()
    if ext in SERIAL_DOC_TYPES:
        return "document"                  # PDF / photo: kept as the serial number document, not read
    try:
        if ext in (".xlsx", ".xlsm"):
            rows = _xlsx_rows(path)
        elif ext in (".csv", ".txt"):
            raw = open(path, "rb").read()
            for enc in ("utf-8-sig", "cp1252", "latin-1"):
                try:
                    text = raw.decode(enc)
                    break
                except UnicodeDecodeError:
                    continue
            rows = [[x.strip() for x in r] for r in csv.reader(io.StringIO(text))]
        else:
            return None
    except Exception:
        return None
    rows = [r for r in rows if any(r)]
    if not rows:
        return []
    col, start = 0, 0
    for i, h in enumerate(rows[0]):
        low = h.lower()
        if "serial" in low or low in ("s/n", "sn", "s/no", "sn."):
            col, start = i, 1
            break
    else:
        first = rows[0][0].lower() if rows[0] else ""
        if first and any(w in first for w in ("no", "number", "model", "item")) and not any(ch.isdigit() for ch in first):
            start = 1                      # looks like a header row
    return [r[col].strip() for r in rows[start:] if len(r) > col and r[col].strip()][:MAX_SERIALS]


def sirim_refresh_serials(c, sid, user, now):
    """Re-read every uploaded Serial Number file and store the list on the form."""
    serials, problems, docs = [], [], []
    for f in c.execute("SELECT * FROM sirim_files WHERE sirim_id=? AND field='serialFile' AND removed_at IS NULL ORDER BY uploaded_at", (sid,)):
        try:
            got = read_serials(file_disk_path(f), f["name"])
        except HTTPError:
            got = None
        if got is None:
            problems.append(f["name"])
        elif got == "document":
            docs.append(f["name"])
        else:
            serials += got
    row = c.execute("SELECT data FROM sirim WHERE id=?", (sid,)).fetchone()
    data = json.loads(row["data"])
    old = len(data.get("serials", []))
    data["serials"], data["serialProblems"], data["serialDocs"] = serials[:MAX_SERIALS], problems, docs
    c.execute("UPDATE sirim SET data=?, version=version+1 WHERE id=?", (json.dumps(data), sid))
    if old != len(data["serials"]):
        audit(c, sid, user, "edit", SIRIM_SEC, "serials", f"{old} serial numbers", f"{len(data['serials'])} serial numbers", at=now)


# ================================================================ document versions
# After every amendment a full snapshot of the document is kept, so any two versions can be compared.
# Edits by the same person within VERSION_GROUP_SECONDS are grouped into one version;
# create / submit / resubmit / reopen / cancel always start a new version.
VERSION_GROUP_SECONDS = 600
MILESTONES = ("create", "submit", "resubmit", "reopen", "cancel", "baseline")


def coa_snapshot(c, app_id):
    r = c.execute("SELECT * FROM apps WHERE id=?", (app_id,)).fetchone()
    files = {}
    for f in c.execute("SELECT * FROM files WHERE app_id=? AND removed_at IS NULL ORDER BY uploaded_at", (app_id,)):
        files.setdefault(f["field"], []).append({"id": f["id"], "name": f["name"], "note": f["note"] or "", "type": f["type"]})
    secs = {x["section"]: x["status"] for x in c.execute("SELECT section, status FROM section_status WHERE app_id=?", (app_id,))}
    return {"formNo": r["form_no"], "dateApply": r["date_apply"] or "", "data": json.loads(r["data"]),
            "checks": {k: v for k, v in json.loads(r["checks"]).items() if v}, "remarks": json.loads(r["remarks"]),
            "files": files, "sections": secs, "cancelled": r["cancel_reason"] if r["cancelled_at"] else ""}


def sirim_snapshot(c, sid):
    r = c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone()
    data = json.loads(r["data"])
    serials = data.pop("serials", [])
    data.pop("serialProblems", None)
    data.pop("serialDocs", None)
    files = {}
    for f in c.execute("SELECT * FROM sirim_files WHERE sirim_id=? AND removed_at IS NULL ORDER BY uploaded_at", (sid,)):
        files.setdefault(f["field"], []).append({"id": f["id"], "name": f["name"], "note": "", "type": f["type"]})
    st = c.execute("SELECT status FROM section_status WHERE app_id=? AND section=?", (sid, SIRIM_SEC)).fetchone()
    snap = {"formNo": r["form_no"], "data": data, "files": files, "sections": {SIRIM_SEC: st["status"] if st else "draft"},
            "cancelled": r["cancel_reason"] if r["cancelled_at"] else "", "serialCount": len(serials),
            "serialsHash": hashlib.sha1("\n".join(serials).encode()).hexdigest()}
    if len(serials) <= 5000:
        snap["serials"] = serials
    return snap


def flatten_snapshot(snap):
    """{"data.coaNo": "...", "files.invoice": "a.pdf, b.pdf", ...} - used to list what changed."""
    out = {}
    for group in ("data", "checks", "remarks", "files", "sections"):
        for k, v in (snap.get(group) or {}).items():
            out[f"{group}.{k}"] = ", ".join(
                (x["name"] + (f" – {x['note']}" if x.get("note") else "")) if isinstance(x, dict) else str(x) for x in v
            ) if isinstance(v, list) else v
    for k in ("formNo", "dateApply", "cancelled", "serialsHash"):
        if snap.get(k) not in (None, ""):
            out[k] = snap[k]
    return out


def changed_keys(old, new):
    a, b = flatten_snapshot(old or {}), flatten_snapshot(new)
    return sorted(k for k in set(a) | set(b) if (a.get(k) or "") != (b.get(k) or ""))


def save_version(c, program, doc_id, user, action, now=None):
    now = now or time.time()
    snap = coa_snapshot(c, doc_id) if program == "coa" else sirim_snapshot(c, doc_id)
    last = c.execute("SELECT * FROM doc_versions WHERE program=? AND doc_id=? ORDER BY version_no DESC LIMIT 1",
                     (program, doc_id)).fetchone()
    group = (last is not None and action not in MILESTONES and last["action"] not in MILESTONES
             and last["user_id"] == (user["id"] if user else None) and now - last["at"] < VERSION_GROUP_SECONDS)
    if group:
        before = c.execute("SELECT snapshot FROM doc_versions WHERE program=? AND doc_id=? AND version_no=?",
                           (program, doc_id, last["version_no"] - 1)).fetchone()
        changes = changed_keys(json.loads(before["snapshot"]) if before else {}, snap)
        c.execute("UPDATE doc_versions SET at=?, changes=?, snapshot=? WHERE id=?",
                  (now, json.dumps(changes), json.dumps(snap), last["id"]))
        return
    changes = changed_keys(json.loads(last["snapshot"]) if last else {}, snap)
    if last is not None and not changes and action not in MILESTONES:
        return                                          # nothing really changed
    c.execute("INSERT INTO doc_versions(program, doc_id, version_no, at, user_id, action, changes, snapshot)"
              " VALUES(?,?,?,?,?,?,?,?)", (program, doc_id, (last["version_no"] if last else 0) + 1, now,
                                           user["id"] if user else None, action, json.dumps(changes), json.dumps(snap)))


def backfill_versions():
    """Documents created before versions existed get a starting version (v1) of how they look now."""
    with DB() as c:
        for r in c.execute("SELECT id, updated_at, updated_by FROM apps").fetchall():
            if not c.execute("SELECT 1 FROM doc_versions WHERE program='coa' AND doc_id=?", (r["id"],)).fetchone():
                c.execute("INSERT INTO doc_versions(program, doc_id, version_no, at, user_id, action, changes, snapshot)"
                          " VALUES('coa',?,1,?,?,'baseline','[]',?)",
                          (r["id"], r["updated_at"] or time.time(), r["updated_by"], json.dumps(coa_snapshot(c, r["id"]))))
        for r in c.execute("SELECT id, updated_at, updated_by FROM sirim").fetchall():
            if not c.execute("SELECT 1 FROM doc_versions WHERE program='sirim' AND doc_id=?", (r["id"],)).fetchone():
                c.execute("INSERT INTO doc_versions(program, doc_id, version_no, at, user_id, action, changes, snapshot)"
                          " VALUES('sirim',?,1,?,?,'baseline','[]',?)",
                          (r["id"], r["updated_at"] or time.time(), r["updated_by"], json.dumps(sirim_snapshot(c, r["id"]))))


class Handler(BaseHTTPRequestHandler):
    server_version = "COA"
    sys_version = ""

    # ---- plumbing
    def do_GET(self): self.dispatch("GET")
    def do_POST(self): self.dispatch("POST")
    def do_PUT(self): self.dispatch("PUT")
    def do_DELETE(self): self.dispatch("DELETE")

    def log_message(self, fmt, *args):
        sys.stderr.write("%s  %s\n" % (self.log_date_time_string(), fmt % args))

    def common_headers(self, frame=False):
        if self.is_https():                                          # over the internet: browsers must always use HTTPS
            self.send_header("Strict-Transport-Security", "max-age=31536000")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN" if frame else "DENY")    # frame: a memo PDF shown inside the portal
        self.send_header("Referrer-Policy", "same-origin")

    def send_json(self, status, obj, headers=()):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in headers:
            self.send_header(k, v)
        self.common_headers()
        self.end_headers()
        self.wfile.write(body)

    def body_json(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_JSON:
            raise HTTPError(413, "Request too large.")
        raw = self.rfile.read(n) if n else b"{}"
        try:
            obj = json.loads(raw or b"{}")
        except ValueError:
            raise HTTPError(400, "Invalid JSON.")
        if not isinstance(obj, dict):
            raise HTTPError(400, "Expected a JSON object.")
        return obj

    def from_proxy(self):
        return self.client_address[0] in ("127.0.0.1", "::1")

    def client_ip(self):
        """The visitor's address - behind Cloudflare Tunnel every request comes from this PC, so use Cloudflare's header."""
        if self.from_proxy():
            ip = (self.headers.get("CF-Connecting-IP") or self.headers.get("X-Forwarded-For") or "").split(",")[0].strip()
            if ip:
                return ip
        return self.client_address[0]

    def is_https(self):
        return self.from_proxy() and (self.headers.get("X-Forwarded-Proto") == "https" or '"https"' in (self.headers.get("CF-Visitor") or ""))

    def session_token(self):
        c = cookies.SimpleCookie()
        try:
            c.load(self.headers.get("Cookie", ""))
        except cookies.CookieError:
            return None
        return c[COOKIE].value if COOKIE in c else None

    def current_user(self):
        t = self.session_token()
        if not t:
            return None
        now = time.time()
        with DB() as c:
            row = c.execute("SELECT u.*, s.last_seen AS s_seen FROM sessions s JOIN users u ON u.id=s.user_id "
                            "WHERE s.token_hash=? AND s.expires>? AND u.active=1", (tok_hash(t), now)).fetchone()
            if not row:
                return None
            idle = idle_minutes(c)
            if idle and row["s_seen"] and now - row["s_seen"] > idle * 60:       # no activity for too long: signed out
                c.execute("DELETE FROM sessions WHERE token_hash=?", (tok_hash(t),))
                return None
            if not row["s_seen"] or now - row["s_seen"] > 30:
                c.execute("UPDATE sessions SET last_seen=? WHERE token_hash=?", (now, tok_hash(t)))
            return c.execute("SELECT * FROM users WHERE id=?", (row["id"],)).fetchone()

    def cookie_flags(self):
        return "HttpOnly; SameSite=Strict; Path=/" + ("; Secure" if self.is_https() else "")

    def start_session(self, c, user_id):
        t, now = secrets.token_urlsafe(32), time.time()
        c.execute("INSERT INTO sessions(token_hash, user_id, expires, last_seen) VALUES(?,?,?,?)",
                  (tok_hash(t), user_id, now + SESSION_SECONDS, now))
        c.execute("UPDATE users SET last_login=? WHERE id=?", (now, user_id))
        return ("Set-Cookie", f"{COOKIE}={t}; {self.cookie_flags()}; Max-Age={SESSION_SECONDS}")

    def dispatch(self, method):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        self.query = dict(urllib.parse.parse_qsl(parsed.query))
        try:
            if path.startswith("/api/"):
                self.api(method, path)
            elif method == "GET":
                self.static(path)
            else:
                raise HTTPError(405, "Method not allowed.")
        except HTTPError as e:
            self.send_json(e.status, {"error": e.message, **e.extra})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # pragma: no cover
            import traceback
            traceback.print_exc()
            try:
                self.send_json(500, {"error": "Server error: " + str(e)})
            except Exception:
                pass

    def api(self, method, path):
        if method != "GET":
            # CSRF protection: custom header + same-origin check
            if self.headers.get("X-Requested-With") != "coa":
                raise HTTPError(403, "Forbidden.")
            origin = self.headers.get("Origin")
            if origin and urllib.parse.urlsplit(origin).netloc != self.headers.get("Host"):
                raise HTTPError(403, "Cross-origin request blocked.")
        for m, pattern, fn, need in ROUTES:
            if m != method:
                continue
            match = re.fullmatch(pattern, path)
            if not match:
                continue
            user = None
            if need:
                user = self.current_user()
                if not user:
                    raise HTTPError(401, "Please sign in.")
                if need == "create" and user["role"] == "viewer":
                    raise HTTPError(403, "Your account is view-only.")
                if need == "admin" and not is_admin(user):
                    raise HTTPError(403, "Administrator only.")
                if need == "audit" and user["role"] not in ("superadmin", "admin", "viewer"):
                    raise HTTPError(403, "You do not have access to the audit trail.")
                if need == "super" and user["role"] != "superadmin":
                    raise HTTPError(403, "Super Admin only.")
                if user["must_change_pw"] and fn not in (Handler.me, Handler.change_password):
                    raise HTTPError(403, "Please change your password first.", {"mustChangePassword": True})
            return fn(self, user, *match.groups())
        raise HTTPError(404, "Not found.")

    def static(self, path):
        rel = urllib.parse.unquote(path).lstrip("/") or "index.html"
        full = os.path.normpath(os.path.join(PUBLIC, rel))
        # only real website files are ever sent - never a database or any other file placed in public/ by mistake
        if (not full.startswith(PUBLIC + os.sep) or not os.path.isfile(full)
                or os.path.splitext(full)[1].lower() not in STATIC_TYPES):
            full = os.path.join(PUBLIC, "index.html")
        with open(full, "rb") as f:
            body = f.read()
        if os.path.basename(full) == "index.html":             # app.js / styles.css?v=<version>: a new version is never
            v = site_version_tag().encode()                     # taken from a browser or Cloudflare cache
            body = body.replace(b'href="styles.css"', b'href="styles.css?v=' + v + b'"').replace(b'src="app.js"', b'src="app.js?v=' + v + b'"')
        self.send_response(200)
        self.send_header("Content-Type", STATIC_TYPES.get(os.path.splitext(full)[1].lower(), "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.common_headers()
        self.end_headers()
        self.wfile.write(body)

    def user_manual(self, user):
        """General > User Manual: the parts of manual.json this person's access allows ("for" = who a part is for).
        Admin / Super Admin may ask for every part (?all=1).  ?lang=ms gives manual-ms.json (Bahasa Melayu) when it is there."""
        items = []
        lang = self.query.get("lang")
        names = ([f"manual-{lang}.json"] if lang in ("ms", "zh") else []) + ["manual.json"]
        for name in names:
            try:
                with open(os.path.join(BASE, name), encoding="utf-8") as fh:
                    items = json.load(fh)
                break
            except (OSError, ValueError):
                continue
        items = items if isinstance(items, list) else []
        admin = user["role"] in ("superadmin", "admin")
        with DB() as c:
            m = me_json(c, user)
        allowed = {"all": True, "coa": m["coaAccess"] is not False, "sirim": bool(m["sirimAccess"]), "eb": bool(m["ebView"]),
                   "hr": bool(m["hrView"] or m["hrCoverage"]), "hrHR": bool(m["hrView"]),
                   "mc": bool(m["mcSubmit"] or m["mcHR"]), "tr": bool(m["trFill"] or m["trHR"]),
                   "memoHR": bool(m["memoHR"]), "memoApprove": bool(m["memoApprove"]), "admin": admin,
                   "mcSubmit": bool(m["mcSubmit"]), "mcHR": bool(m["mcHR"]), "trFill": bool(m["trFill"]), "trHR": bool(m["trHR"]),
                   "ta": bool(m["taFill"] or m["taHR"]), "taFill": bool(m["taFill"]), "taHR": bool(m["taHR"]),
                   "wh": bool(m["whView"]), "whEdit": bool(m["whEdit"])}
        show_all = admin and self.query.get("all") == "1"
        ok = lambda x: show_all or allowed.get(x.get("for", "all"), False)
        out = []
        for sec in items:                                    # a section, and inside it each part, may have its own "for"
            if not isinstance(sec, dict) or not ok(sec):
                continue
            parts = [p for p in sec.get("parts") or [] if isinstance(p, dict) and ok(p)]
            if parts:
                out.append({**sec, "parts": parts})
        self.send_json(200, {"manual": out, "canShowAll": admin})

    def system_updates(self, user):
        """General Dashboard > New System Update: the release notes in updates.json (newest first)."""
        try:
            with open(os.path.join(BASE, "updates.json"), encoding="utf-8") as fh:
                items = json.load(fh)
        except (OSError, ValueError):
            items = []
        self.send_json(200, {"updates": items if isinstance(items, list) else []})

    def site_version(self, user):
        """Changes whenever a page file (app.js, styles.css, index.html) is replaced - open pages offer "Reload"."""
        self.send_json(200, {"version": site_version_tag()})

    # ---- auth
    def setup_status(self, user):
        with DB() as c:
            n = c.execute("SELECT COUNT(*) FROM users").fetchone()[0]
        self.send_json(200, {"needed": n == 0})

    def setup_admin(self, user):
        b = self.body_json()
        username, name, pw = (b.get("username") or "").strip(), (b.get("name") or "").strip(), b.get("password")
        with DB() as c:
            if c.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
                raise HTTPError(409, "Setup has already been completed.")
            validate_username(username)
            validate_pw(pw)
            cur = c.execute("INSERT INTO users(username,name,role,pw_hash,created_at) VALUES(?,?,?,?,?)",
                            (username, name or username, "superadmin", hash_pw(pw), time.time()))
            cookie = self.start_session(c, cur.lastrowid)
            u = me_json(c, c.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone())
        self.send_json(200, {"user": u}, [cookie])

    def login(self, user):
        ip = self.client_ip()
        if throttled(ip):
            raise HTTPError(429, "Too many failed attempts. Please wait 5 minutes.")
        b = self.body_json()
        with DB() as c:
            name_in = (b.get("username") or "").strip()
            u = c.execute("SELECT * FROM users WHERE username=?", (name_in,)).fetchone() or \
                c.execute("SELECT * FROM users WHERE username=? COLLATE NOCASE", (name_in,)).fetchone()   # LKH002 = lkh002
            ok = u is not None and check_pw(b.get("password") or "", u["pw_hash"])
            if not ok:
                record_fail(ip)
                raise HTTPError(401, "Incorrect username or password.")
            if not u["active"]:
                raise HTTPError(403, "This account has been disabled. Contact your administrator.")
            cookie = self.start_session(c, u["id"])
            out = me_json(c, u)
        self.send_json(200, {"user": out}, [cookie])

    def logout(self, user):
        t = self.session_token()
        if t:
            with DB() as c:
                c.execute("DELETE FROM sessions WHERE token_hash=?", (tok_hash(t),))
        self.send_json(200, {"ok": True}, [("Set-Cookie", f"{COOKIE}=; {self.cookie_flags()}; Max-Age=0")])

    def me(self, user):
        with DB() as c:
            self.send_json(200, {"user": me_json(c, user)})

    def change_password(self, user):
        b = self.body_json()
        if not check_pw(b.get("current") or "", user["pw_hash"]):
            raise HTTPError(400, "Current password is incorrect.")
        validate_pw(b.get("new"))
        if check_pw(b["new"], user["pw_hash"]):
            raise HTTPError(400, "The new password must be different from the current one.")
        with DB() as c:
            c.execute("UPDATE users SET pw_hash=?, must_change_pw=0 WHERE id=?", (hash_pw(b["new"]), user["id"]))
            # sign out other devices
            c.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?", (user["id"], tok_hash(self.session_token())))
        self.send_json(200, {"ok": True})

    # ---- applications
    def list_apps(self, user):
        with DB() as c:
            nm = names(c)
            acc = user_access(c, user)
            stats = app_statuses(c)
            mine = my_submits(c, user)
            mystat = my_status(c, user)
            files = {}
            for f in c.execute("SELECT * FROM files WHERE removed_at IS NULL ORDER BY uploaded_at"):
                files.setdefault(f["app_id"], []).append(f)
            rows = c.execute("SELECT * FROM apps ORDER BY updated_at DESC").fetchall() if coa_access(c, user) else []
            out = [app_json(r, files.get(r["id"], []), nm, user, acc, stats.get(r["id"]), mine.get(r["id"]), mystat.get(r["id"]))
                   for r in rows]
        self.send_json(200, {"apps": out})

    def get_app(self, user, app_id):
        with DB() as c:
            self.send_json(200, {"app": load_app(c, user, app_id)})

    def create_app(self, user):
        b = self.body_json()
        now = time.time()
        with DB() as c:
            if not can_create(c, user):
                raise HTTPError(403, "You don't have permission to create new applications.")
            # copied/imported values are kept only for sections this user may fill
            acc = user_access(c, user)
            p = {s: section_perms(user, acc[s], {"status": "draft", "count": 0, "mine": 0}) for s in SECTIONS}
            data = {k: upper_if_text(k, clean_value(v)) for k, v in as_dict(b.get("data"), "data").items() if p.get(DATA_SEC.get(k), {}).get("edit")}
            checks = {k: bool(v) for k, v in as_dict(b.get("checks"), "checks").items() if p.get(CHECK_SEC.get(k), {}).get("check")}
            remarks = {k: clean_value(v).upper() for k, v in as_dict(b.get("remarks"), "remarks").items() if p.get(REMARK_SEC.get(k), {}).get("edit")}
            data.setdefault("stStatus", "Not Submitted")
            app_id = new_id()
            c.execute("INSERT INTO apps(id,form_no,date_apply,data,checks,remarks,created_by,created_at,updated_by,updated_at)"
                      " VALUES(?,?,?,?,?,?,?,?,?,?)",
                      (app_id, next_form_no(c), clean_value(b.get("dateApply"))[:20] or time.strftime("%Y-%m-%d"),
                       json.dumps(data), json.dumps(checks), json.dumps(remarks), user["id"], now, user["id"], now))
            audit(c, app_id, user, "create", at=now)
            for k, v in data.items():
                if v and k != "stStatus":
                    audit(c, app_id, user, "edit", DATA_SEC.get(k), k, "", v, at=now)
            save_version(c, "coa", app_id, user, "create", now)
            self.send_json(200, {"app": load_app(c, user, app_id)})

    def update_app(self, user, app_id):
        """Apply only the changed fields; every field is checked against the user's section rights."""
        b = self.body_json()
        with DB() as c:
            row = load_row(c, user, app_id)
            if row["cancelled_at"]:
                raise HTTPError(403, "This application has been cancelled and can no longer be changed.")
            perms = perms_for(c, user, app_id)
            data, checks, remarks = json.loads(row["data"]), json.loads(row["checks"]), json.loads(row["remarks"])

            def need(sec, what):
                if not sec:
                    raise HTTPError(400, "Unknown field.")
                if not perms[sec][what]:
                    label = f"{sec}. {SECTIONS[sec]['name']}"
                    if perms[sec].get("viewOnly"):
                        raise HTTPError(403, f"You have view-only access to section {label}.")
                    if perms[sec]["view"] and user["role"] == "user" and not perms[sec]["submit"]:
                        raise HTTPError(403, f"Section {label} has been submitted and is locked.")
                    raise HTTPError(403, f"You do not have permission to change section {label}.")

            now = time.time()
            base = as_dict(b.get("base"), "base")
            base_data, base_remarks = as_dict(base.get("data"), "base.data"), as_dict(base.get("remarks"), "base.remarks")
            conflicts, nm = [], None
            for k, v in as_dict(b.get("data"), "data").items():
                need(DATA_SEC.get(k), "edit")
                v = upper_if_text(k, clean_value(v))
                bv = upper_if_text(k, clean_value(base_data[k])) if k in base_data else None
                if is_conflict(data.get(k, ""), bv, v):
                    nm = nm or names(c)
                    by, at = last_change(c, app_id, k, nm)
                    conflicts.append({"kind": "data", "key": k, "theirs": data.get(k, ""), "yours": v, "by": by, "at": at})
                    continue
                if k in STATUS_KEYS and user["role"] != "superadmin" and v != (data.get(k) or "Not Submitted"):
                    raise HTTPError(403, f"{'ST' if k == 'stStatus' else 'eCOS'} Status is set by the system (Not Submitted until "
                                         "Section I is submitted, then Submitted). Only the Super Admin can change it.")
                if data.get(k, "") != v:
                    audit(c, app_id, user, "edit", DATA_SEC[k], k, data.get(k, ""), v, at=now)
                data[k] = v
            for k, v in as_dict(b.get("checks"), "checks").items():
                need(CHECK_SEC.get(k), "check")
                if bool(checks.get(k)) != bool(v):
                    audit(c, app_id, user, "check" if v else "uncheck", CHECK_SEC[k], k, at=now)
                checks[k] = bool(v)
            for k, v in as_dict(b.get("remarks"), "remarks").items():
                need(REMARK_SEC.get(k), "edit")
                v = clean_value(v).upper()
                bv = clean_value(base_remarks[k]).upper() if k in base_remarks else None
                if is_conflict(remarks.get(k, ""), bv, v):
                    nm = nm or names(c)
                    by, at = last_change(c, app_id, k, nm)
                    conflicts.append({"kind": "remarks", "key": k, "theirs": remarks.get(k, ""), "yours": v, "by": by, "at": at})
                    continue
                if remarks.get(k, "") != v:
                    audit(c, app_id, user, "remark", REMARK_SEC[k], k, remarks.get(k, ""), v, at=now)
                remarks[k] = v
            meta = as_dict(b.get("meta"), "meta")
            form_no, date_apply = row["form_no"], row["date_apply"]
            if meta:
                # Form No. is generated by the system and can never be changed
                if "formNo" in meta:
                    raise HTTPError(403, "Form No. is generated by the system and cannot be changed.")
                if not is_admin(user):
                    raise HTTPError(403, "Only administrators can change Date Apply.")
                if "dateApply" in meta:
                    date_apply = clean_value(meta["dateApply"])[:20]
                    if date_apply != (row["date_apply"] or ""):
                        audit(c, app_id, user, "edit", None, "dateApply", row["date_apply"] or "", date_apply, at=now)
            c.execute("UPDATE apps SET form_no=?, date_apply=?, data=?, checks=?, remarks=?, version=version+1,"
                      " updated_by=?, updated_at=? WHERE id=?",
                      (form_no, date_apply, json.dumps(data), json.dumps(checks), json.dumps(remarks),
                       user["id"], now, app_id))
            # Super Admin sets ST Status back to "Not Submitted" = Section I goes back to Draft (reopened for everyone)
            reopened = False
            old_data = json.loads(row["data"])
            if any(data.get(k) == "Not Submitted" and (old_data.get(k) or "Not Submitted") != "Not Submitted" for k in STATUS_KEYS):
                st = c.execute("SELECT status FROM section_status WHERE app_id=? AND section='I'", (app_id,)).fetchone()
                if st and st["status"] == "submitted":
                    c.execute("UPDATE person_status SET status='draft' WHERE app_id=? AND section='I'", (app_id,))
                    refresh_shared_status(c, app_id, "I")
                    c.execute("INSERT INTO section_log(app_id, section, user_id, action, at) VALUES(?,?,?,?,?)",
                              (app_id, "I", user["id"], "reopen", now))
                    audit(c, app_id, user, "reopen", "I", at=now)
                    reopened = True
            add_contributor(c, app_id, user["id"])
            save_version(c, "coa", app_id, user, "reopen" if reopened else "edit", now)
            self.send_json(200, {"app": load_app(c, user, app_id), "reopened": ["I"] if reopened else [], "conflicts": conflicts})

    def section_action(self, user, app_id, sec, action):
        if sec not in SECTIONS:
            raise HTTPError(404, "Unknown section.")
        with DB() as c:
            load_row(c, user, app_id)
            if not perms_for(c, user, app_id)[sec].get(action):
                raise HTTPError(403, {
                    "submit": "You cannot submit this section.",
                    "resubmit": "No resaves left for this section. Ask an administrator to reopen it.",
                    "reopen": "Only administrators can reopen a submitted section."}[action])
            now = time.time()
            if action == "submit":
                record_submit(c, app_id, sec, user, now)
            elif action == "resubmit":      # this person unlocks their own submission
                c.execute("UPDATE person_status SET status='draft' WHERE app_id=? AND section=? AND user_id=?",
                          (app_id, sec, user["id"]))
                refresh_shared_status(c, app_id, sec)
            else:                           # reopen (admin): unlocks the section for everyone
                c.execute("UPDATE person_status SET status='draft' WHERE app_id=? AND section=?", (app_id, sec))
                refresh_shared_status(c, app_id, sec)
            c.execute("INSERT INTO section_log(app_id, section, user_id, action, at) VALUES(?,?,?,?,?)",
                      (app_id, sec, user["id"], action, now))
            audit(c, app_id, user, action, sec, at=now)
            if action == "submit" and sec == "I":
                auto_st_status(c, app_id, user, now)
            elif sec == "I":
                auto_st_draft(c, app_id, user, now)
            c.execute("UPDATE apps SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, app_id))
            add_contributor(c, app_id, user["id"])
            save_version(c, "coa", app_id, user, action, now)
            self.send_json(200, {"app": load_app(c, user, app_id)})

    def submit_all(self, user, app_id):
        """Submit every section this person may submit right now, in one go."""
        with DB() as c:
            load_row(c, user, app_id)
            todo = [s for s, p in perms_for(c, user, app_id).items() if p["submit"]]
            if not todo:
                raise HTTPError(400, "There is nothing for you to submit on this application.")
            now = time.time()
            for sec in todo:
                record_submit(c, app_id, sec, user, now)
                c.execute("INSERT INTO section_log(app_id, section, user_id, action, at) VALUES(?,?,?,?,?)",
                          (app_id, sec, user["id"], "submit", now))
                audit(c, app_id, user, "submit", sec, at=now)
            if "I" in todo:
                auto_st_status(c, app_id, user, now)
            c.execute("UPDATE apps SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, app_id))
            add_contributor(c, app_id, user["id"])
            save_version(c, "coa", app_id, user, "submit", now)
            self.send_json(200, {"app": load_app(c, user, app_id), "submitted": todo})

    def section_history(self, user, app_id):
        with DB() as c:
            load_row(c, user, app_id)
            visible = {s for s, p in perms_for(c, user, app_id).items() if p["view"]}
            nm = names(c)
            rows = c.execute("SELECT * FROM section_log WHERE app_id=? ORDER BY at DESC", (app_id,)).fetchall()
            out = [{"section": r["section"], "action": r["action"], "by": nm.get(r["user_id"], ""), "at": r["at"]}
                   for r in rows if r["section"] in visible]
        self.send_json(200, {"history": out})

    def cancel_app(self, user, app_id):
        """Mark an application as cancelled. Nothing is deleted - the record stays in the database."""
        reason = clean_value(self.body_json().get("reason")).strip()[:500]
        if not reason:
            raise HTTPError(400, "Please give a reason for cancelling.")
        with DB() as c:
            row = load_row(c, user, app_id)
            if row["cancelled_at"]:
                raise HTTPError(409, "This application is already cancelled.")
            now = time.time()
            c.execute("UPDATE apps SET cancelled_at=?, cancelled_by=?, cancel_reason=?, updated_by=?, updated_at=? WHERE id=?",
                      (now, user["id"], reason, user["id"], now, app_id))
            audit(c, app_id, user, "cancel", new=reason, at=now)
            save_version(c, "coa", app_id, user, "cancel", now)
            self.send_json(200, {"app": load_app(c, user, app_id)})

    # ---- server (Super Admin)
    def server_settings(self, user):
        b = self.body_json()
        url = str(b.get("publicUrl") or "").strip().rstrip("/")
        if url and not re.fullmatch(r"https?://[A-Za-z0-9.-]+(:\d+)?(/[^\s]*)?", url):
            raise HTTPError(400, "Type the full address, e.g. https://portal.example.com")
        try:
            idle = int(b.get("idleMinutes"))
        except (TypeError, ValueError):
            raise HTTPError(400, "Type the minutes as a number.")
        if not (idle == 0 or 5 <= idle <= 720):
            raise HTTPError(400, "Automatic sign-out: 5 to 720 minutes, or 0 for off.")
        with DB() as c:
            if "publicUrl" in b:                              # only when sent (the page no longer has the box)
                setting_set(c, "public_url", url)
            setting_set(c, "session_idle_min", idle)
        self.send_json(200, {"ok": True})

    def server_info(self, user):
        with DB() as c:
            cfg = setting_all(c)
            idle = idle_minutes(c)
        self.send_json(200, {"startedAt": STARTED_AT, "port": PORT, "python": sys.version.split()[0],
                             "canRestart": CAN_RESTART, "publicUrl": cfg.get("public_url") or "", "idleMinutes": idle,
                             "bind": BIND, "viaTunnel": self.is_https()})

    def restart_server(self, user):
        if not CAN_RESTART:
            raise HTTPError(409, "This server was not started with the current start_server.bat, so it cannot restart itself. "
                                 "Close the server window and double-click start_server.bat once.")
        print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  Restart requested by {user['name']}")
        self.send_json(200, {"ok": True})
        threading.Thread(target=_restart_soon, daemon=True).start()

    # ---- "Saved" alert: someone pressed the Save button
    def mark_saved(self, user, program, doc_id):
        with DB() as c:
            if program == "coa":
                load_row(c, user, doc_id)
            else:
                self.sirim_row(c, user, doc_id)
            now = time.time()
            ev = c.execute("SELECT id FROM save_events WHERE doc_id=? AND user_id=? AND sent_at IS NULL", (doc_id, user["id"])).fetchone()
            if ev:
                c.execute("UPDATE save_events SET at=? WHERE id=?", (now, ev["id"]))
            else:
                c.execute("INSERT INTO save_events(program, doc_id, user_id, at) VALUES(?,?,?,?)", (program, doc_id, user["id"], now))
            cfg = setting_all(c)
            others = [r for r in c.execute("SELECT * FROM users WHERE active=1 AND email IS NOT NULL AND email != '' AND id != ?"
                                           " AND role IN ('superadmin','admin','user')", (user["id"],)) if user_prefs(r)["saved"]]
            if others and all(r["role"] == "user" for r in others):   # Users only hear about their own forms
                mine = user_recipients(c)
                others = [r for r in others if doc_id in mine.get(r["id"], ("", "", set()))[2]]
        notify = cfg.get("alert_enabled") == "1" and email_ready(cfg) and bool(others)
        if notify:
            threading.Thread(target=alert_run, kwargs={"who": f"save by {user['name']}"}, daemon=True).start()
        self.send_json(200, {"notified": notify})

    def save_coa(self, user, doc_id):
        self.mark_saved(user, "coa", doc_id)

    def save_sirim(self, user, doc_id):
        self.mark_saved(user, "sirim", doc_id)

    # ---- Email Batch (Marketing Dept)
    def eb_row(self, c, user, bid, edit=False):
        acc = eb_access(c, user)
        if not acc["view"]:
            raise HTTPError(403, "You do not have access to Email Batch.")
        if edit and not acc["edit"]:
            raise HTTPError(403, "You can only view Email Batch.")
        b = c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone()
        if not b:
            raise HTTPError(404, "Batch not found.")
        return b

    def eb_editable(self, b):
        if b["cancelled_at"]:
            raise HTTPError(409, "This batch is cancelled.")
        if b["status"] != "draft":
            raise HTTPError(409, "Emails of this batch have been sent - the template and customer list cannot change any more. "
                                 "Start a new batch (it can reuse this template).")

    # ------------------------------------------------------------ Memo (General)
    def memo_row(self, c, user, mid):
        acc = memo_access(c, user)
        r = c.execute("SELECT * FROM memos WHERE id=?", (mid,)).fetchone()
        if not r or not memo_can_see(c, user, r, acc):
            raise HTTPError(404, "Memo not found.")
        return r, acc

    def memo_list(self, user):
        with DB() as c:
            acc = memo_access(c, user)
            nm, un, prof = names(c), memo_users(c), memo_profile(c, user)
            read = {r[0] for r in c.execute("SELECT memo_id FROM memo_reads WHERE user_id=?", (user["id"],))}
            out = [memo_json(c, r, nm, un, read=r["id"] in read) for r in c.execute("SELECT * FROM memos ORDER BY created_at DESC")
                   if memo_can_see(c, user, r, acc, prof)]
        self.send_json(200, {"memos": out, "hr": acc["hr"], "approve": acc["approve"], "me": user["id"], "superadmin": user["role"] == "superadmin"})

    def memo_choices(self, user):
        """Who-can-view choices (from HR Setting) and the people who can approve."""
        with DB() as c:
            if not memo_access(c, user)["hr"]:
                raise HTTPError(403, "Only HR can create memos.")
            opts = get_options(c)
            used_states = {o.get("state") for o in opts["hrOutlets"] if o.get("state")}
            self.send_json(200, {"states": list(MY_STATES) + sorted(x for x in used_states if x not in MY_STATES),
                                 "outlets": [{"code": o["code"], "name": o["name"], "state": o.get("state") or ""} for o in opts["hrOutlets"]],
                                 "departments": opts["hrDepartments"], "positions": opts["hrRoles"], "posDept": opts["hrPosDept"],
                                 "approvers": memo_approvers(c)})

    def memo_reach(self, user):
        """Preview: how many staff (and how many of them have a login) the chosen "Who can view" reaches."""
        try:
            aud = memo_clean_aud(self.body_json().get("audience"))
        except HTTPError:
            return self.send_json(200, {"staff": 0, "logins": 0, "outlets": 0})
        with DB() as c:
            if not memo_access(c, user)["hr"]:
                raise HTTPError(403, "Only HR can create memos.")
            opts = get_options(c)
            state = {o["code"].upper(): o.get("state") or "" for o in opts["hrOutlets"]}
            pd = {k.lower(): v for k, v in opts["hrPosDept"].items()}
            logins = {r[0].lower() for r in c.execute("SELECT username FROM users WHERE active=1")}
            today = time.strftime("%Y-%m-%d")
            n = m = 0
            outlets = set()
            for st in c.execute("SELECT * FROM hr_staff WHERE removed_at IS NULL"):
                if st["resigned_date"] and st["resigned_date"] <= today:
                    continue
                oc = (st["outlet_code"] or "").upper()
                prof = {"outlet": oc, "state": state.get(oc, ""), "position": st["role"] or "", "department": pd.get((st["role"] or "").lower(), "")}
                if memo_for(aud, prof):
                    n += 1
                    m += st["staff_id"].lower() in logins
                    outlets.add(oc)
        self.send_json(200, {"staff": n, "logins": m, "outlets": len(outlets - {""})})

    def memo_get(self, user, mid):
        with DB() as c:
            r, acc = self.memo_row(c, user, mid)
            if r["status"] == "posted" and self.query.get("peek") != "1":     # peek: only the card picture
                c.execute("INSERT OR IGNORE INTO memo_reads(memo_id, user_id, at) VALUES(?,?,?)", (mid, user["id"], time.time()))
            nm, un = names(c), memo_users(c)
            hist = [{"at": a["at"], "by": nm.get(a["user_id"], "System"), "field": a["field"], "old": a["old_value"], "new": a["new_value"],
                     "action": a["action"]} for a in c.execute("SELECT * FROM audit_log WHERE app_id=? ORDER BY id", (mid,))] if acc["hr"] else []
            mine_appr = r["approver_id"] == user["id"] or user["role"] == "superadmin"
            self.send_json(200, {"memo": memo_json(c, r, nm, un, full=True, read=True), "hr": acc["hr"], "history": hist,
                                 "canApprove": r["status"] == "processing" and acc["approve"] and mine_appr,
                                 "canSign": r["status"] == "approved" and r["approved_by"] == user["id"] and r["kind"] == "upload"})

    def memo_save(self, user, mid=None):
        b = self.body_json()
        kind = b.get("kind")
        if kind not in ("upload", "manual"):
            raise HTTPError(400, "Choose Upload or Manual Create.")
        title = re.sub(r"\s+", " ", str(b.get("title") or "")).strip()[:200]
        if not title:
            raise HTTPError(400, "Type the Title.")
        content = eb_clean_html(str(b.get("content") or ""))[:500_000] if kind == "manual" else ""
        if kind == "manual" and not re.sub(r"<[^>]*>|&nbsp;|\s", "", content):
            raise HTTPError(400, "Type the memo content.")
        aud = memo_clean_aud(b.get("audience"))
        lang = b.get("lang") if b.get("lang") in MEMO_LANGS else "en"
        trin = b.get("translations") if isinstance(b.get("translations"), dict) else {}
        trans = {}
        for k in MEMO_LANGS:                                  # the other two languages (checked by HR before Save)
            v = trin.get(k) if isinstance(trin.get(k), dict) else {}
            if k == lang:
                continue
            t = re.sub(r"\s+", " ", str(v.get("title") or "")).strip()[:200]
            ct = eb_clean_html(str(v.get("content") or ""))[:500_000] if kind == "manual" else ""
            if not re.sub(r"<[^>]*>|&nbsp;|\s", "", ct):
                ct = ""
            if t or ct:
                trans[k] = {"title": t, "content": ct}
        now = time.time()
        with DB() as c:
            acc = memo_access(c, user)
            if not acc["hr"]:
                raise HTTPError(403, "Only HR can create memos.")
            try:
                appr = int(b.get("approverId") or 0)
            except (TypeError, ValueError):
                appr = 0
            if appr not in {a["id"] for a in memo_approvers(c)}:
                raise HTTPError(400, "Choose the Person in Charge who approves the memo.")
            if mid:
                r, _ = self.memo_row(c, user, mid)
                if r["status"] not in ("processing", "approved"):
                    raise HTTPError(409, "A Posted or Cancelled memo cannot be edited.")
                if r["kind"] != kind:
                    raise HTTPError(400, "An uploaded memo stays an uploaded memo (and a typed one stays typed). Cancel it and create a new one.")
                c.execute("UPDATE memos SET title=?, content=?, audience=?, approver_id=?, status='processing', approved_by=NULL, approved_at=NULL,"
                          " signature=NULL, updated_by=?, updated_at=?, lang=?, translations=? WHERE id=?",
                          (title, content, json.dumps(aud), appr, user["id"], now, lang, json.dumps(trans, ensure_ascii=False), mid))
                c.execute("UPDATE memo_files SET removed_at=?, removed_by=? WHERE memo_id=? AND kind='signed' AND removed_at IS NULL",
                          (now, user["id"], mid))
                audit(c, mid, user, "edit", MM_SEC, "memo", r["status"], "edited" + (" - back to processing (approve again)" if r["status"] == "approved" else ""), at=now)
            else:
                mid, no = new_id(), next_memo_no(c)
                c.execute("INSERT INTO memos(id, doc_no, kind, title, content, audience, status, approver_id, created_by, created_at, updated_by, updated_at,"
                          " lang, translations) VALUES(?,?,?,?,?,?, 'processing',?,?,?,?,?,?,?)",
                          (mid, no, kind, title, content, json.dumps(aud), appr, user["id"], now, user["id"], now, lang, json.dumps(trans, ensure_ascii=False)))
                audit(c, mid, user, "create", MM_SEC, "status", None, f"{no} created ({'uploaded PDF' if kind == 'upload' else 'typed in'}) - processing", at=now)
            r = c.execute("SELECT * FROM memos WHERE id=?", (mid,)).fetchone()
            self.send_json(200, {"memo": memo_json(c, r, names(c), memo_users(c), full=True)})

    def memo_update(self, user, mid):
        self.memo_save(user, mid)

    def memo_upload(self, user, mid):
        """HR: the memo PDF (while Processing).  Approver: the signed copy made in their browser (right after approving)."""
        name = os.path.basename((self.query.get("name") or "memo.pdf").replace("\\", "/")).strip()[:200] or "memo.pdf"
        n = int(self.headers.get("Content-Length") or 0)
        if n > 30 * 1048576:
            raise HTTPError(413, "File too large (max 30 MB).")
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/pdf" and not name.lower().endswith(".pdf"):
            raise HTTPError(400, "Upload the memo as a PDF file (.pdf only).")
        with DB() as c:
            r, acc = self.memo_row(c, user, mid)
            if self.query.get("kind") == "signed":
                if not (r["status"] == "approved" and r["approved_by"] == user["id"] and r["kind"] == "upload"):
                    raise HTTPError(409, "The signed copy is added by the person who approved the memo.")
                kind = "signed"
            else:
                if not acc["hr"] or r["kind"] != "upload" or r["status"] != "processing":
                    raise HTTPError(409, "The memo PDF can be changed by HR while the memo is Processing.")
                kind = "memo"
            folder = os.path.join("Memos", safe_name(r["doc_no"], "memo", True))
            os.makedirs(os.path.join(UPLOADS, folder), exist_ok=True)
            stem, ext = os.path.splitext(safe_name(name))
            rel, k = os.path.join(folder, f"{kind} - {stem}{ext or '.pdf'}"), 1
            while os.path.exists(os.path.join(UPLOADS, rel)) or os.path.exists(os.path.join(UPLOADS, rel + ".part")):
                k += 1
                rel = os.path.join(folder, f"{kind} - {stem} ({k}){ext or '.pdf'}")
            path = os.path.join(UPLOADS, rel)
            open(path + ".part", "wb").close()
        remaining = n
        with open(path + ".part", "wb") as out:
            head = b""
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                head = head or chunk[:5]
                out.write(chunk)
                remaining -= len(chunk)
        if remaining or head[:4] != b"%PDF":
            os.remove(path + ".part")
            raise HTTPError(400, "Upload interrupted." if remaining else "This file is not a PDF.")
        os.replace(path + ".part", path)
        now, fid = time.time(), new_id()
        with DB() as c:
            c.execute("UPDATE memo_files SET removed_at=?, removed_by=? WHERE memo_id=? AND kind=? AND removed_at IS NULL", (now, user["id"], mid, kind))
            c.execute("INSERT INTO memo_files(id, memo_id, kind, name, type, size, path, uploaded_by, uploaded_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (fid, mid, kind, name, "application/pdf", n, rel, user["id"], now))
            audit(c, mid, user, "file_upload", MM_SEC, "signed copy" if kind == "signed" else "memo PDF", None, name, at=now)
            r = c.execute("SELECT * FROM memos WHERE id=?", (mid,)).fetchone()
            self.send_json(200, {"memo": memo_json(c, r, names(c), memo_users(c), full=True)})

    def memo_file(self, user, fid):
        with DB() as c:
            f = c.execute("SELECT * FROM memo_files WHERE id=? AND removed_at IS NULL", (fid,)).fetchone()
            if not f:
                raise HTTPError(404, "File not found.")
            self.memo_row(c, user, f["memo_id"])
        self.send_stored_file(f, frame=True)

    def memo_my_signature(self, user):
        with DB() as c:
            r = c.execute("SELECT image FROM user_signatures WHERE user_id=?", (user["id"],)).fetchone()
        self.send_json(200, {"signature": r["image"] if r else ""})

    def memo_approve(self, user, mid):
        b = self.body_json()
        sig = memo_signature(b.get("signature"))
        now = time.time()
        with DB() as c:
            r, acc = self.memo_row(c, user, mid)
            if r["status"] != "processing":
                raise HTTPError(409, "Only a Processing memo can be approved.")
            if not acc["approve"] or not (r["approver_id"] == user["id"] or user["role"] == "superadmin"):
                raise HTTPError(403, "This memo is waiting for another person in charge.")
            if r["kind"] == "upload" and not c.execute("SELECT 1 FROM memo_files WHERE memo_id=? AND kind='memo' AND removed_at IS NULL", (mid,)).fetchone():
                raise HTTPError(409, "HR has not uploaded the memo PDF yet.")
            c.execute("UPDATE memos SET status='approved', approved_by=?, approved_at=?, signature=?, updated_by=?, updated_at=? WHERE id=?",
                      (user["id"], now, sig, user["id"], now, mid))
            if b.get("remember"):
                c.execute("INSERT INTO user_signatures(user_id, image, updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET"
                          " image=excluded.image, updated_at=excluded.updated_at", (user["id"], sig, now))
            audit(c, mid, user, "approve", MM_SEC, "status", "processing", "approved (e-signature added)", at=now)
            r = c.execute("SELECT * FROM memos WHERE id=?", (mid,)).fetchone()
            self.send_json(200, {"memo": memo_json(c, r, names(c), memo_users(c), full=True)})

    def memo_post(self, user, mid):
        now = time.time()
        with DB() as c:
            r, acc = self.memo_row(c, user, mid)
            if not acc["hr"]:
                raise HTTPError(403, "Only HR can post memos.")
            if r["status"] != "approved":
                raise HTTPError(409, "Only an Approved memo can be posted.")
            c.execute("UPDATE memos SET status='posted', posted_by=?, posted_at=?, updated_by=?, updated_at=? WHERE id=?",
                      (user["id"], now, user["id"], now, mid))
            audit(c, mid, user, "submit", MM_SEC, "status", "approved", "posted - " + memo_aud_text(json.loads(r["audience"] or "{}")), at=now)
            r = c.execute("SELECT * FROM memos WHERE id=?", (mid,)).fetchone()
            self.send_json(200, {"memo": memo_json(c, r, names(c), memo_users(c), full=True)})

    def memo_cancel(self, user, mid):
        reason = re.sub(r"\s+", " ", str(self.body_json().get("reason") or "")).strip()[:300]
        now = time.time()
        with DB() as c:
            r, acc = self.memo_row(c, user, mid)
            if not acc["hr"]:
                raise HTTPError(403, "Only HR can cancel memos.")
            if r["status"] == "cancelled":
                raise HTTPError(409, "This memo is already cancelled.")
            c.execute("UPDATE memos SET status='cancelled', cancel_reason=?, cancelled_by=?, cancelled_at=?, updated_by=?, updated_at=? WHERE id=?",
                      (reason, user["id"], now, user["id"], now, mid))
            audit(c, mid, user, "cancel", MM_SEC, "status", r["status"], "cancelled" + (f" - {reason}" if reason else ""), at=now)
            r = c.execute("SELECT * FROM memos WHERE id=?", (mid,)).fetchone()
            self.send_json(200, {"memo": memo_json(c, r, names(c), memo_users(c), full=True)})

    def memo_word(self, user):
        """Word (.docx) -> memo text with its formatting (a line 'Subject : ...' / 'Title : ...' becomes the title)."""
        with DB() as c:
            if not memo_access(c, user)["hr"]:
                raise HTTPError(403, "Only HR can create memos.")
        data, name = self.eb_read_upload()
        subject, body = eb_docx_template(data)
        if not body.strip():
            raise HTTPError(400, "No text found in this Word file.")
        self.send_json(200, {"title": subject, "content": body})

    # ------------------------------------------------------------ Transfer Form
    def tr_row(self, c, user, tid, hr=False):
        acc = tr_access(c, user)
        r = c.execute("SELECT * FROM tr_docs WHERE id=?", (tid,)).fetchone()
        if not r or not (acc["hr"] or (acc["fill"] and (r["created_by"] == user["id"] or tr_for_me(c, user, r)))):
            raise HTTPError(404, "Transfer form not found.")
        if hr and not acc["hr"]:
            raise HTTPError(403, "Only HR can do this.")
        return r, acc

    def tr_list(self, user):
        with DB() as c:
            acc = tr_access(c, user)
            if not (acc["fill"] or acc["hr"]):
                raise HTTPError(403, "You do not have access to the Transfer Form.")
            nm = names(c)
            codes = None if acc["hr"] else hr_view_codes(c, user)
            rows = c.execute("SELECT * FROM tr_docs ORDER BY created_at DESC").fetchall() if acc["hr"] else [
                r for r in c.execute("SELECT * FROM tr_docs ORDER BY created_at DESC")
                if r["created_by"] == user["id"] or tr_for_me(c, user, r, codes)]
            out = [tr_json(c, r, nm, full=False) for r in rows]
        self.send_json(200, {"forms": out, "hr": acc["hr"], "canFill": acc["fill"], "logins": TR_LOGINS})

    def tr_staff_list(self, user):
        """Staff to choose on the form (code, name, outlet, position) - the IC No. only comes with the chosen staff."""
        with DB() as c:
            acc = tr_access(c, user)
            if not (acc["fill"] or acc["hr"]):
                raise HTTPError(403, "You do not have access to the Transfer Form.")
            today = time.strftime("%Y-%m-%d")
            staff = [{"code": r["staff_id"], "name": r["full_name"], "outlet": r["outlet_code"], "position": r["role"]}
                     for r in c.execute("SELECT * FROM hr_staff WHERE removed_at IS NULL ORDER BY staff_id COLLATE NOCASE")
                     if not r["resigned_date"] or r["resigned_date"] > today]
            code = self.query.get("code")
            one = None
            if code:
                st = tr_staff(c, code)
                if st:
                    one = {"code": st["staff_id"], "name": st["full_name"], "icNo": st["ic_no"] or "", "outlet": st["outlet_code"],
                           "position": st["role"]}
            opts = get_options(c)
        self.send_json(200, {"staff": [] if code else staff, "one": one, "outlets": opts["hrOutlets"], "positions": opts["hrRoles"]})

    def tr_get(self, user, tid):
        with DB() as c:
            r, acc = self.tr_row(c, user, tid)
            if acc["hr"] and r["status"] == "submitted" and r["created_by"] != user["id"]:   # HR opened it: Submitted -> Processing
                now = time.time()
                c.execute("UPDATE tr_docs SET status='processing', processing_at=?, updated_by=?, updated_at=? WHERE id=?",
                          (now, user["id"], now, tid))
                audit(c, tid, user, "edit", TR_SEC, "status", "submitted", "processing (opened by HR)", at=now)
                r = c.execute("SELECT * FROM tr_docs WHERE id=?", (tid,)).fetchone()
            if r["status"] == "completed" and r["created_by"] == user["id"] and not acc["hr"]:   # outlet opened it: Checked
                now = time.time()
                c.execute("UPDATE tr_docs SET status='checked', checked_by=?, checked_at=?, updated_by=?, updated_at=? WHERE id=?",
                          (user["id"], now, user["id"], now, tid))
                audit(c, tid, user, "edit", TR_SEC, "status", "completed", "checked (opened by the outlet)", at=now)
                r = c.execute("SELECT * FROM tr_docs WHERE id=?", (tid,)).fetchone()
            nm = names(c)
            hist = [{"at": a["at"], "by": nm.get(a["user_id"], "System"), "field": a["field"], "old": a["old_value"], "new": a["new_value"],
                     "action": a["action"]} for a in c.execute("SELECT * FROM audit_log WHERE app_id=? ORDER BY id", (tid,))]
            self.send_json(200, {"form": tr_json(c, r, nm), "hr": acc["hr"], "mine": r["created_by"] == user["id"], "history": hist,
                                 "logins": TR_LOGINS})

    def tr_save(self, user, tid=None):
        b = self.body_json()
        typ = b.get("type")
        if typ not in ("permanent", "temporary"):
            raise HTTPError(400, "Choose the Type (Permanent or Temporary).")
        now = time.time()
        with DB() as c:
            acc = tr_access(c, user)
            if not acc["fill"]:
                raise HTTPError(403, "You cannot fill in transfer forms.")
            data = tr_clean(c, typ, b.get("data"))
            if tid:
                r, _ = self.tr_row(c, user, tid)
                if r["created_by"] != user["id"] and not acc["hr"]:
                    raise HTTPError(403, "Only the person who made the form (or HR) can change it.")
                if r["status"] == "processing":
                    raise HTTPError(409, "HR is already processing this form - it cannot be changed now.")
                if r["status"] not in ("drafted", "submitted"):
                    raise HTTPError(409, "Only a Drafted or Submitted form can be edited.")
                if not acc["hr"]:
                    tr_date_check(typ, data, json.loads(r["data"] or "{}") if r["type"] == typ else {})
                c.execute("UPDATE tr_docs SET type=?, data=?, updated_by=?, updated_at=? WHERE id=?", (typ, json.dumps(data), user["id"], now, tid))
                audit(c, tid, user, "edit", TR_SEC, "form", None, "edited", at=now)
            else:
                if not acc["hr"]:
                    tr_date_check(typ, data, {})
                tid, no = new_id(), next_tr_no(c)
                c.execute("INSERT INTO tr_docs(id, doc_no, type, status, data, created_by, created_at, updated_by, updated_at)"
                          " VALUES(?,?,?, 'drafted',?,?,?,?,?)", (tid, no, typ, json.dumps(data), user["id"], now, user["id"], now))
                audit(c, tid, user, "create", TR_SEC, "status", None, f"{no} ({typ}) drafted", at=now)
            self.send_json(200, {"form": tr_json(c, c.execute("SELECT * FROM tr_docs WHERE id=?", (tid,)).fetchone(), names(c))})

    def tr_update(self, user, tid):
        self.tr_save(user, tid)

    def tr_upload(self, user, tid):
        """Signed letter: the outlet uploads it while Drafted, HR while Processing."""
        name = os.path.basename((self.query.get("name") or "file").replace("\\", "/")).strip()[:200] or "file"
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise HTTPError(413, f"File too large (max {MAX_UPLOAD // 1048576} MB).")
        ctype = (self.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip()[:100]
        if not (ctype.startswith("image/") or ctype == "application/pdf"):
            raise HTTPError(400, "Upload the signed letter as a PDF or a picture (JPG / PNG).")
        with DB() as c:
            r, acc = self.tr_row(c, user, tid)
            stage = self.query.get("stage")
            if acc["hr"] and (r["status"] == "processing" or (r["status"] == "submitted" and r["created_by"] == user["id"] and stage == "hr")):
                kind = "hr"
            elif r["status"] in ("drafted", "submitted") and (r["created_by"] == user["id"] or acc["hr"]):
                kind = "outlet"
            elif r["status"] == "processing":
                raise HTTPError(403, "HR is already processing this form - it cannot be changed now.")
            else:
                raise HTTPError(403, "Upload is possible for the outlet until HR opens the form, and for HR while Processing.")
            folder = os.path.join("Transfer Forms", safe_name(r["doc_no"], "transfer", True))
            os.makedirs(os.path.join(UPLOADS, folder), exist_ok=True)
            stem, ext = os.path.splitext(safe_name(name))
            rel, k = os.path.join(folder, f"{kind} - {stem}{ext}"), 1
            while os.path.exists(os.path.join(UPLOADS, rel)) or os.path.exists(os.path.join(UPLOADS, rel + ".part")):
                k += 1
                rel = os.path.join(folder, f"{kind} - {stem} ({k}){ext}")
            path = os.path.join(UPLOADS, rel)
            open(path + ".part", "wb").close()
        remaining = n
        with open(path + ".part", "wb") as out:
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                out.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(path + ".part")
            raise HTTPError(400, "Upload interrupted.")
        os.replace(path + ".part", path)
        now, fid = time.time(), new_id()
        with DB() as c:
            c.execute("INSERT INTO tr_files(id, tr_id, kind, name, type, size, path, uploaded_by, uploaded_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (fid, tid, kind, name, ctype, n, rel, user["id"], now))
            audit(c, tid, user, "file_upload", TR_SEC, "signed letter (" + ("outlet" if kind == "outlet" else "HR") + ")", None, name, at=now)
            self.send_json(200, {"form": tr_json(c, c.execute("SELECT * FROM tr_docs WHERE id=?", (tid,)).fetchone(), names(c))})

    def tr_file(self, user, fid):
        with DB() as c:
            f = c.execute("SELECT * FROM tr_files WHERE id=? AND removed_at IS NULL", (fid,)).fetchone()
            if not f:
                raise HTTPError(404, "File not found.")
            self.tr_row(c, user, f["tr_id"])
        self.send_stored_file(f)

    def tr_stage(self, user, tid):
        """Outlet: signed letter uploaded -> Processing.  HR: signed letter uploaded -> Completed.  Names / ID / dates of the signers."""
        b = self.body_json()
        sign = b.get("sign") if isinstance(b.get("sign"), dict) else {}
        txt = lambda v, n=120: re.sub(r"\s+", " ", str(v or "")).strip()[:n]
        now = time.time()
        with DB() as c:
            r, acc = self.tr_row(c, user, tid)
            kind = "hr" if acc["hr"] and (r["status"] == "processing" or (r["status"] == "submitted" and b.get("stage") == "hr")) \
                else "outlet" if r["status"] in ("drafted", "submitted") else None
            if not kind or (kind == "hr" and not acc["hr"]) or (kind == "outlet" and not (acc["hr"] or r["created_by"] == user["id"])):
                raise HTTPError(409, "This form is not waiting for you.")
            if not c.execute("SELECT 1 FROM tr_files WHERE tr_id=? AND kind=? AND removed_at IS NULL", (tid, kind)).fetchone():
                raise HTTPError(400, "Upload the signed letter first.")
            if kind == "outlet":
                val = {"approver": {k: txt((sign.get("approver") or {}).get(k)) for k in ("name", "idNo", "date")},
                       "employee": {k: txt((sign.get("employee") or {}).get(k)) for k in ("name", "idNo", "date")}}
                c.execute("UPDATE tr_docs SET status='submitted', outlet_sign=?, updated_by=?, updated_at=? WHERE id=?",
                          (json.dumps(val), user["id"], now, tid))
                audit(c, tid, user, "submit", TR_SEC, "status", r["status"], "submitted (signed letter uploaded by the outlet)"
                      if r["status"] == "drafted" else "submitted - signers changed by the outlet", at=now)
            else:
                val = {k: txt(sign.get(k), 1000 if k == "remarks" else 120) for k in ("name", "idNo", "date", "remarks")}
                c.execute("UPDATE tr_docs SET status='completed', hr_sign=?, completed_at=?, completed_by=?, updated_by=?, updated_at=? WHERE id=?",
                          (json.dumps(val), now, user["id"], user["id"], now, tid))
                audit(c, tid, user, "submit", TR_SEC, "status", r["status"], "completed (signed letter uploaded by HR)", at=now)
            self.send_json(200, {"form": tr_json(c, c.execute("SELECT * FROM tr_docs WHERE id=?", (tid,)).fetchone(), names(c))})

    def tr_cancel(self, user, tid):
        reason = re.sub(r"\s+", " ", str(self.body_json().get("reason") or "")).strip()[:300]
        now = time.time()
        with DB() as c:
            r, _ = self.tr_row(c, user, tid, hr=True)
            if r["status"] in ("cancelled", "checked"):
                raise HTTPError(409, "A Cancelled or Checked form cannot be cancelled.")
            c.execute("UPDATE tr_docs SET status='cancelled', cancel_reason=?, cancelled_by=?, cancelled_at=?, updated_by=?, updated_at=? WHERE id=?",
                      (reason, user["id"], now, user["id"], now, tid))
            audit(c, tid, user, "cancel", TR_SEC, "status", r["status"], "cancelled" + (f" - {reason}" if reason else ""), at=now)
            self.send_json(200, {"form": tr_json(c, c.execute("SELECT * FROM tr_docs WHERE id=?", (tid,)).fetchone(), names(c))})

    # ------------------------------------------------------------ Warehouse - Online Shop Delivery (Carrier Manifest)
    def wh_row(self, c, user, mid, edit=False):
        acc = wh_access(c, user)
        r = c.execute("SELECT * FROM wh_manifests WHERE id=?", (mid,)).fetchone()
        if not r or not acc["view"]:
            raise HTTPError(404, "Carrier manifest not found.")
        if edit and not acc["edit"]:
            raise HTTPError(403, "You can only view carrier manifests.")
        return r, acc

    def wh_send(self, c, mid, extra=None):
        r = c.execute("SELECT * FROM wh_manifests WHERE id=?", (mid,)).fetchone()
        self.send_json(200, {"manifest": wh_json(c, r, names(c)), **(extra or {})})

    def wh_list(self, user):
        """Every manifest; ?tracking= only the manifests with that tracking number (part of it is enough)."""
        with DB() as c:
            acc = wh_access(c, user)
            if not acc["view"]:
                raise HTTPError(403, "You do not have access to Online Shop Delivery.")
            nm = names(c)
            t = re.sub(r"\s+", "", self.query.get("tracking") or "").upper()
            if t:
                rows = c.execute("SELECT DISTINCT m.* FROM wh_manifests m JOIN wh_parcels p ON p.manifest_id = m.id"
                                 " WHERE p.removed_at IS NULL AND p.tracking LIKE ? ORDER BY m.created_at DESC", (f"%{t}%",)).fetchall()
            else:
                rows = c.execute("SELECT * FROM wh_manifests ORDER BY created_at DESC").fetchall()
            out = [wh_json(c, r, nm, full=False) for r in rows]
            self.send_json(200, {"manifests": out, "edit": acc["edit"], **wh_lists(c)})

    def wh_get(self, user, mid):
        with DB() as c:
            r, acc = self.wh_row(c, user, mid)
            self.send_json(200, {"manifest": wh_json(c, r, names(c)), "edit": acc["edit"], **wh_lists(c)})

    def wh_create(self, user):
        b = self.body_json()
        now = time.time()
        with DB() as c:
            if not wh_access(c, user)["edit"]:
                raise HTTPError(403, "You can only view carrier manifests.")
            v = wh_clean(c, b)
            mid, no = new_id(), next_wh_no(c)
            c.execute("INSERT INTO wh_manifests(id, doc_no, title, doc_title, mdate, channel, courier, allow_edit, remark,"
                      " created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
                      (mid, no, v["title"], v["doc_title"], v["mdate"], v["channel"], v["courier"], v["allow_edit"], v["remark"],
                       user["id"], now, user["id"], now))
            audit(c, mid, user, "create", WH_SEC, "manifest", None, f"{no} {v['title']} ({v['courier'] or 'any courier'})", at=now)
            self.wh_send(c, mid)

    def wh_update(self, user, mid):
        b = self.body_json()
        now = time.time()
        with DB() as c:
            r, _ = self.wh_row(c, user, mid, edit=True)
            if r["cancelled_at"]:
                raise HTTPError(409, "This manifest is cancelled.")
            v = wh_clean(c, {**{"title": r["title"], "docTitle": r["doc_title"], "date": r["mdate"], "channel": r["channel"],
                                "courier": r["courier"], "allowEdit": bool(r["allow_edit"]), "remark": r["remark"]}, **b})
            if not r["allow_edit"] and any(v[k] != r[k] for k in ("title", "doc_title", "mdate", "channel", "courier", "remark")):
                raise HTTPError(409, "Allow Edit is off – turn it on first to change this manifest.")
            c.execute("UPDATE wh_manifests SET title=?, doc_title=?, mdate=?, channel=?, courier=?, allow_edit=?, remark=?,"
                      " updated_by=?, updated_at=? WHERE id=?", (v["title"], v["doc_title"], v["mdate"], v["channel"], v["courier"],
                                                                v["allow_edit"], v["remark"], user["id"], now, mid))
            for k, lab in (("title", "Title"), ("doc_title", "Document Title"), ("mdate", "Date"), ("channel", "Channel"),
                           ("courier", "Courier Company"), ("remark", "Remark")):
                if v[k] != r[k]:
                    audit(c, mid, user, "edit", WH_SEC, lab, r[k], v[k], at=now)
            if v["allow_edit"] != r["allow_edit"]:
                audit(c, mid, user, "edit", WH_SEC, "Allow Edit", "on" if r["allow_edit"] else "off",
                      "on" if v["allow_edit"] else "off (locked)", at=now)
            self.wh_send(c, mid)

    def wh_scan(self, user, mid):
        """Add one scanned tracking number.  Refused (409, with the reason) when it cannot go on this manifest."""
        raw = self.body_json().get("tracking")
        now = time.time()
        with DB() as c:
            r, _ = self.wh_row(c, user, mid, edit=True)
            if r["cancelled_at"]:
                raise HTTPError(409, "This manifest is cancelled.")
            if not r["allow_edit"]:
                raise HTTPError(409, "Allow Edit is off – this manifest is locked.")
            t = wh_tracking(raw)
            if not t:
                raise HTTPError(400, f"'{str(raw or '').strip()[:60]}' is not a tracking number.")
            same = c.execute("SELECT id FROM wh_parcels WHERE manifest_id=? AND tracking=? AND removed_at IS NULL", (mid, t)).fetchone()
            if same:
                n = [p["id"] for p in c.execute("SELECT id FROM wh_parcels WHERE manifest_id=? AND removed_at IS NULL"
                                                 " ORDER BY scanned_at, rowid", (mid,))].index(same["id"]) + 1
                raise HTTPError(409, f"{t} is already scanned on this manifest (No. {n}).")
            other = c.execute("SELECT m.doc_no, m.title FROM wh_parcels p JOIN wh_manifests m ON m.id = p.manifest_id"
                              " WHERE p.tracking=? AND p.removed_at IS NULL AND m.cancelled_at IS NULL", (t,)).fetchone()
            if other:
                raise HTTPError(409, f"{t} is already on manifest {other['doc_no']} ({other['title']}).")
            cour = next((x for x in wh_lists(c)["couriers"] if x["name"].lower() == (r["courier"] or "").lower()), None)
            pre = [p.upper() for p in (cour or {}).get("prefixes") or [] if p]
            if pre and not any(t.startswith(p) for p in pre):
                raise HTTPError(409, f"{t} does not belong to {cour['name']} (its tracking numbers start with {', '.join(pre)}).")
            c.execute("INSERT INTO wh_parcels(id, manifest_id, tracking, scanned_by, scanned_at) VALUES(?,?,?,?,?)",
                      (new_id(), mid, t, user["id"], now))
            c.execute("UPDATE wh_manifests SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, mid))
            audit(c, mid, user, "edit", WH_SEC, "scan", None, t, at=now)
            self.wh_send(c, mid, {"added": t})

    def wh_remove(self, user, mid):
        pid = str(self.body_json().get("parcelId") or "")
        now = time.time()
        with DB() as c:
            r, _ = self.wh_row(c, user, mid, edit=True)
            if r["cancelled_at"] or not r["allow_edit"]:
                raise HTTPError(409, "Allow Edit is off – this manifest is locked.")
            p = c.execute("SELECT * FROM wh_parcels WHERE id=? AND manifest_id=? AND removed_at IS NULL", (pid, mid)).fetchone()
            if not p:
                raise HTTPError(404, "Tracking number not found on this manifest.")
            c.execute("UPDATE wh_parcels SET removed_by=?, removed_at=? WHERE id=?", (user["id"], now, pid))
            c.execute("UPDATE wh_manifests SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, mid))
            audit(c, mid, user, "edit", WH_SEC, "scan", p["tracking"], "removed", at=now)
            self.wh_send(c, mid)

    def wh_cancel(self, user, mid):
        reason = re.sub(r"\s+", " ", str(self.body_json().get("reason") or "")).strip()[:300]
        if not reason:
            raise HTTPError(400, "Type the reason for cancelling.")
        now = time.time()
        with DB() as c:
            r, _ = self.wh_row(c, user, mid, edit=True)
            if r["cancelled_at"]:
                raise HTTPError(409, "This manifest is already cancelled.")
            c.execute("UPDATE wh_manifests SET cancel_reason=?, cancelled_by=?, cancelled_at=?, updated_by=?, updated_at=? WHERE id=?",
                      (reason, user["id"], now, user["id"], now, mid))
            audit(c, mid, user, "cancel", WH_SEC, "status", None, "cancelled" + (f" - {reason}" if reason else ""), at=now)
            self.wh_send(c, mid)

    def wh_delete(self, user, mid):
        """Super Admin: delete a carrier manifest completely (its scanned tracking numbers and its history too).
        The manifest number has to be typed to confirm.  One line stays in the audit log (who deleted which manifest)."""
        typed = str(self.body_json().get("confirm") or "").strip().upper()
        with DB() as c:
            r = c.execute("SELECT * FROM wh_manifests WHERE id=?", (mid,)).fetchone()
            if not r:
                raise HTTPError(404, "Carrier manifest not found.")
            if typed != r["doc_no"].upper():
                raise HTTPError(400, f"Type the manifest number {r['doc_no']} to confirm.")
            n = c.execute("SELECT COUNT(*) FROM wh_parcels WHERE manifest_id=? AND removed_at IS NULL", (mid,)).fetchone()[0]
            c.execute("DELETE FROM wh_parcels WHERE manifest_id=?", (mid,))
            c.execute("DELETE FROM audit_log WHERE app_id=?", (mid,))
            c.execute("DELETE FROM wh_manifests WHERE id=?", (mid,))
            audit(c, "wh-deleted", user, "delete", WH_SEC, r["doc_no"], None,
                  f"{r['doc_no']} {r['title']} deleted ({n} parcel(s))", at=time.time())
        self.send_json(200, {"ok": True})

    def wh_get_settings(self, user):
        with DB() as c:
            if not (wh_access(c, user)["edit"] or is_admin(user)):
                raise HTTPError(403, "You do not have access to the Online Shop Delivery settings.")
            self.send_json(200, wh_lists(c))

    def wh_settings(self, user):
        """Courier companies (with the start of their tracking numbers) and channels."""
        b = self.body_json()
        cs, ch = b.get("couriers"), b.get("channels")
        if not isinstance(cs, list) or not isinstance(ch, list) or len(cs) > 100 or len(ch) > 100:
            raise HTTPError(400, "Invalid list.")
        clean_c, seen = [], set()
        for x in cs:
            x = x if isinstance(x, dict) else {}
            n = re.sub(r"\s+", " ", str(x.get("name") or "")).strip()[:100]
            if n and n.lower() not in seen:
                seen.add(n.lower())
                pre = [p for p in (re.sub(r"[^A-Z0-9\-]", "", str(v).upper())[:20] for v in x.get("prefixes") or []) if p][:20]
                clean_c.append({"name": n, "prefixes": pre})
        clean_h, seen = [], set()
        for v in ch:
            v = re.sub(r"\s+", " ", str(v or "")).strip()[:100]
            if v and v.lower() not in seen:
                seen.add(v.lower())
                clean_h.append(v)
        with DB() as c:
            if not (wh_access(c, user)["edit"] or is_admin(user)):
                raise HTTPError(403, "You can only view carrier manifests.")
            for k, v in (("whCouriers", clean_c), ("whChannels", clean_h)):
                c.execute("INSERT INTO option_lists(list_key, items) VALUES(?, ?) ON CONFLICT(list_key) DO UPDATE SET items=excluded.items",
                          (k, json.dumps(v)))
            audit(c, "wh-settings", user, "edit", WH_SEC, "Courier / channel list", None,
                  "; ".join(x["name"] + (f" ({','.join(x['prefixes'])})" if x["prefixes"] else "") for x in clean_c)
                  + " | " + ", ".join(clean_h), at=time.time())
            self.send_json(200, wh_lists(c))

    # ------------------------------------------------------------ Time Adjustment
    def ta_row(self, c, user, tid, hr=False):
        acc = ta_access(c, user)
        r = c.execute("SELECT * FROM ta_docs WHERE id=?", (tid,)).fetchone()
        mine = r and r["created_by"] == user["id"]
        if not r or not ((acc["hr"] and (r["submitted_at"] or mine)) or (acc["fill"] and (mine or ta_for_me(c, user, r)))):
            raise HTTPError(404, "Time adjustment form not found.")
        if hr and not acc["hr"]:
            raise HTTPError(403, "Only HR can do this.")
        return r, acc

    def ta_send(self, c, tid, extra=None):
        r = c.execute("SELECT * FROM ta_docs WHERE id=?", (tid,)).fetchone()
        self.send_json(200, {"form": ta_json(c, r, names(c)), **(extra or {})})

    def ta_list(self, user):
        with DB() as c:
            acc = ta_access(c, user)
            if not (acc["fill"] or acc["hr"]):
                raise HTTPError(403, "You do not have access to Time Adjustment.")
            ta_auto(c)
            nm = names(c)
            codes = None if acc["hr"] else hr_view_codes(c, user)
            rows = c.execute("SELECT * FROM ta_docs WHERE created_by=? OR (? AND submitted_at IS NOT NULL) ORDER BY created_at DESC",
                             (user["id"], int(acc["hr"]))).fetchall() if acc["hr"] else [
                r for r in c.execute("SELECT * FROM ta_docs ORDER BY created_at DESC")
                if r["created_by"] == user["id"] or ta_for_me(c, user, r, codes)]
            out = [ta_json(c, r, nm, full=False) for r in rows]
        self.send_json(200, {"forms": out, "hr": acc["hr"], "canFill": acc["fill"]})

    def ta_staff_list(self, user):
        """Staff to choose (code, name, outlet); ?code= gives one staff with the IC No."""
        with DB() as c:
            acc = ta_access(c, user)
            if not (acc["fill"] or acc["hr"]):
                raise HTTPError(403, "You do not have access to Time Adjustment.")
            scope = ta_staff_scope(c, user, acc["hr"])
            code = (self.query.get("code") or "").strip().lower()
            one = next(({"code": r["staff_id"], "name": r["full_name"], "icNo": r["ic_no"] or "", "outlet": r["outlet_code"]}
                        for r in scope if r["staff_id"].lower() == code), None) if code else None
            st = own_staff(c, user)
            opts = get_options(c)
            self.send_json(200, {"staff": [] if code else [{"code": r["staff_id"], "name": r["full_name"], "outlet": r["outlet_code"]}
                                                           for r in scope],
                                 "one": one, "outlets": [{"code": o["code"], "name": o.get("name", "")} for o in opts["hrOutlets"]],
                                 "reasons": ta_reasons(c), "myOutlet": st["outlet_code"] if st else "", "hr": acc["hr"]})

    def ta_get(self, user, tid):
        with DB() as c:
            ta_auto(c)
            r, acc = self.ta_row(c, user, tid)
            if acc["hr"] and r["status"] == "submitted" and r["created_by"] != user["id"]:   # HR opened it: Submitted -> Processing
                now = time.time()
                c.execute("UPDATE ta_docs SET status='processing', processing_at=?, updated_by=?, updated_at=? WHERE id=?",
                          (now, user["id"], now, tid))
                audit(c, tid, user, "edit", TA_SEC, "status", "submitted", "processing (opened by HR)", at=now)
            nm = names(c)
            hist = [{"at": a["at"], "by": nm.get(a["user_id"], "System"), "field": a["field"], "old": a["old_value"], "new": a["new_value"],
                     "action": a["action"]} for a in c.execute("SELECT * FROM audit_log WHERE app_id=? ORDER BY id", (tid,))]
            self.ta_send(c, tid, {"hr": acc["hr"], "mine": r["created_by"] == user["id"], "history": hist})

    def ta_save(self, user, tid=None):
        """Save (Draft) or Submit.  New / Draft: every line.  Incomplete (declined by HR): only the declined lines change."""
        b = self.body_json()
        submit, agreed = bool(b.get("submit")), bool(b.get("agreed"))
        lines = b.get("rows") if isinstance(b.get("rows"), list) else []
        now = time.time()
        with DB() as c:
            acc = ta_access(c, user)
            if not acc["fill"]:
                raise HTTPError(403, "You cannot fill in time adjustment forms.")
            r = None
            if tid:
                r, _ = self.ta_row(c, user, tid)
                if r["created_by"] != user["id"]:
                    raise HTTPError(403, "Only the person who made the form can change it.")
                if r["status"] == "processing":
                    raise HTTPError(409, "HR is already processing this form - it cannot be changed now.")
                if not (r["status"] in ("draft", "submitted") or (r["status"] == "incomplete" and r["returned_by"] == "hr")):
                    raise HTTPError(409, "This form cannot be changed now.")
            allowed = {s["staff_id"].lower(): s for s in ta_staff_scope(c, user, acc["hr"])}
            outlets = {o["code"].upper() for o in get_options(c)["hrOutlets"]}
            if r and r["status"] == "incomplete":                 # only the lines HR declined
                old = ta_rows(r)
                given = {str((x or {}).get("uid")): x for x in lines if isinstance(x, dict)}
                for x in old:                                     # staff on a declined line may be from outside the scope now
                    allowed.setdefault(x["staffId"].lower(), tr_staff(c, x["staffId"]) or allowed.get(x["staffId"].lower()))
                rows = []
                for n, x in enumerate(old, 1):
                    if x.get("hrAck") == "declined" and x["uid"] in given:
                        nx = ta_clean_row(c, {**given[x["uid"]], "uid": x["uid"]}, n, allowed, outlets)
                        nx["hrNote"] = x.get("hrNote", "")
                        if submit:
                            nx["hrNote"] = ""
                        else:
                            nx["hrAck"] = "declined"
                        rows.append(nx)
                    else:
                        rows.append(x)
            else:
                if not lines:
                    raise HTTPError(400, "Add at least one staff.")
                if len(lines) > 60:
                    raise HTTPError(400, "At most 60 lines in one form.")
                rows = [ta_clean_row(c, x, n, allowed, outlets) for n, x in enumerate(lines, 1)]
            if submit and not agreed:
                raise HTTPError(400, "Tick \"I agree and accept the change of working hours as stated above.\" to submit.")
            if not tid:
                tid = new_id()
                st = own_staff(c, user)
                no = next_ta_no(c, st["outlet_code"] if st else "")
                c.execute("INSERT INTO ta_docs(id, doc_no, status, rows, agreed, created_by, created_at, updated_by, updated_at)"
                          " VALUES(?,?, 'draft',?,?,?,?,?,?)", (tid, no, json.dumps(rows), int(agreed), user["id"], now, user["id"], now))
                audit(c, tid, user, "create", TA_SEC, "status", None, f"{no} draft ({len(rows)} line(s))", at=now)
                old_status = "draft"
            else:
                old_status = r["status"]
                c.execute("UPDATE ta_docs SET rows=?, agreed=?, updated_by=?, updated_at=? WHERE id=?",
                          (json.dumps(rows), int(agreed), user["id"], now, tid))
                audit(c, tid, user, "edit", TA_SEC, "form", None, "edited", at=now)
            if submit and old_status != "submitted":
                c.execute("UPDATE ta_docs SET status='submitted', returned_by='', submitted_at=?, updated_at=? WHERE id=?", (now, now, tid))
                audit(c, tid, user, "submit", TA_SEC, "status", old_status, "submitted", at=now)
            self.ta_send(c, tid)

    def ta_update(self, user, tid):
        self.ta_save(user, tid)

    def ta_hr(self, user, tid):
        """HR: tick / decline each line (decline needs a remark).  action 'save' -> a declined line makes the form Incomplete;
        action 'complete' (every line ticked, SBClient updated) -> Completed.  HR may also correct the times of a line here."""
        b = self.body_json()
        dec = b.get("lines") if isinstance(b.get("lines"), dict) else {}
        action = b.get("action")
        now = time.time()
        with DB() as c:
            r, _ = self.ta_row(c, user, tid, hr=True)
            if not (r["status"] in ("submitted", "processing") or (r["status"] == "incomplete" and r["returned_by"] == "user")):
                raise HTTPError(409, "This form is not waiting for HR.")
            if r["status"] == "submitted":                        # HR's own form: checking it starts the processing
                c.execute("UPDATE ta_docs SET processing_at=? WHERE id=?", (now, tid))
                audit(c, tid, user, "edit", TA_SEC, "status", "submitted", "processing (checked by HR)", at=now)
            rows = ta_rows(r)
            for x in rows:
                d = dec.get(x["uid"]) if isinstance(dec.get(x["uid"]), dict) else {}
                if d.get("ack") in ("ok", "declined", ""):
                    x["hrAck"] = d["ack"]
                x["hrNote"] = re.sub(r"\s+", " ", str(d.get("note") or "")).strip()[:500] if x["hrAck"] == "declined" else ""
                if isinstance(d.get("times"), dict):              # HR corrected the times
                    t = {k: hr_time(d["times"].get(k)) for k in TA_TIMES}
                    if any(t.values()) and t != x["times"]:
                        audit(c, tid, user, "edit", TA_SEC, f"{x['staffId']} {x['date']} times", None, "changed by HR", at=now)
                        x["times"] = t
                if x["hrAck"] == "declined" and not x["hrNote"]:
                    raise HTTPError(400, f"{x['staffId']} ({x['date']}): type why the line is declined.")
            declined = [x for x in rows if x["hrAck"] == "declined"]
            if action == "complete":
                if declined or not all(x["hrAck"] == "ok" for x in rows):
                    raise HTTPError(400, "Tick every line before you complete the form.")
                for x in rows:
                    x["userAck"], x["userNote"] = "", ""
                c.execute("UPDATE ta_docs SET status='completed', rows=?, returned_by='', completed_by=?, completed_at=?, updated_by=?,"
                          " updated_at=? WHERE id=?", (json.dumps(rows), user["id"], now, user["id"], now, tid))
                audit(c, tid, user, "submit", TA_SEC, "status", r["status"], "completed (SBClient updated by HR)", at=now)
            elif declined:
                c.execute("UPDATE ta_docs SET status='incomplete', rows=?, returned_by='hr', updated_by=?, updated_at=? WHERE id=?",
                          (json.dumps(rows), user["id"], now, tid))
                audit(c, tid, user, "edit", TA_SEC, "status", r["status"],
                      f"incomplete - {len(declined)} line(s) declined by HR: " + "; ".join(f"{x['staffId']} {x['date']}: {x['hrNote']}" for x in declined), at=now)
            else:
                c.execute("UPDATE ta_docs SET status=CASE WHEN status='submitted' THEN 'processing' ELSE status END, rows=?, updated_by=?,"
                          " updated_at=? WHERE id=?", (json.dumps(rows), user["id"], now, tid))
                audit(c, tid, user, "edit", TA_SEC, "HR check", None, f"{sum(x['hrAck'] == 'ok' for x in rows)} of {len(rows)} line(s) ticked", at=now)
            self.ta_send(c, tid)

    def ta_ack(self, user, tid):
        """The outlet checks SBClient: every line acknowledged -> Acknowledged; a line declined (with a remark) -> Incomplete (to HR)."""
        dec = self.body_json().get("lines")
        dec = dec if isinstance(dec, dict) else {}
        now = time.time()
        with DB() as c:
            r, _ = self.ta_row(c, user, tid)
            if r["created_by"] != user["id"]:
                raise HTTPError(403, "Only the person who made the form can acknowledge it.")
            if r["status"] != "completed":
                raise HTTPError(409, "Only a Completed form can be acknowledged.")
            rows = ta_rows(r)
            for x in rows:
                d = dec.get(x["uid"]) if isinstance(dec.get(x["uid"]), dict) else {}
                if d.get("ack") not in ("ok", "declined"):
                    raise HTTPError(400, f"{x['staffId']} ({x['date']}): choose Acknowledge or Decline.")
                x["userAck"] = d["ack"]
                x["userNote"] = re.sub(r"\s+", " ", str(d.get("note") or "")).strip()[:500] if d["ack"] == "declined" else ""
                if d["ack"] == "declined" and not x["userNote"]:
                    raise HTTPError(400, f"{x['staffId']} ({x['date']}): type what is wrong in SBClient.")
            declined = [x for x in rows if x["userAck"] == "declined"]
            if declined:
                for x in declined:
                    x["hrAck"] = ""
                c.execute("UPDATE ta_docs SET status='incomplete', rows=?, returned_by='user', updated_by=?, updated_at=? WHERE id=?",
                          (json.dumps(rows), user["id"], now, tid))
                audit(c, tid, user, "edit", TA_SEC, "status", "completed",
                      "incomplete - declined by the outlet: " + "; ".join(f"{x['staffId']} {x['date']}: {x['userNote']}" for x in declined), at=now)
            else:
                c.execute("UPDATE ta_docs SET status='acknowledged', rows=?, acknowledged_by=?, acknowledged_at=?, updated_by=?, updated_at=?"
                          " WHERE id=?", (json.dumps(rows), user["id"], now, user["id"], now, tid))
                audit(c, tid, user, "edit", TA_SEC, "status", "completed", "acknowledged by the outlet", at=now)
            self.ta_send(c, tid)

    def ta_cancel(self, user, tid):
        reason = re.sub(r"\s+", " ", str(self.body_json().get("reason") or "")).strip()[:300]
        now = time.time()
        with DB() as c:
            r, acc = self.ta_row(c, user, tid)
            mine = r["created_by"] == user["id"]
            ok = (acc["hr"] and r["status"] in ("submitted", "processing", "incomplete")) or \
                 (mine and (r["status"] in ("draft", "submitted") or (r["status"] == "incomplete" and r["returned_by"] == "hr")))
            if not ok:
                raise HTTPError(409, "This form cannot be cancelled now.")
            c.execute("UPDATE ta_docs SET status='cancelled', cancel_reason=?, cancelled_by=?, cancelled_at=?, updated_by=?, updated_at=? WHERE id=?",
                      (reason, user["id"], now, user["id"], now, tid))
            audit(c, tid, user, "cancel", TA_SEC, "status", r["status"], "cancelled" + (f" - {reason}" if reason else ""), at=now)
            self.ta_send(c, tid)

    def ta_set_reasons(self, user):
        items = self.body_json().get("items")
        if not isinstance(items, list) or len(items) > 100:
            raise HTTPError(400, "Invalid list.")
        clean, seen = [], set()
        for v in items:
            v = re.sub(r"\s+", " ", str(v or "")).strip()[:100]
            if v and v.lower() not in seen:
                seen.add(v.lower())
                clean.append(v)
        with DB() as c:
            if not ta_access(c, user)["hr"]:
                raise HTTPError(403, "Only HR can change the reason codes.")
            c.execute("INSERT INTO option_lists(list_key, items) VALUES('taReasons', ?)"
                      " ON CONFLICT(list_key) DO UPDATE SET items=excluded.items", (json.dumps(clean),))
            audit(c, "ta-reasons", user, "edit", TA_SEC, "Reason codes", None, ", ".join(clean), at=time.time())
        self.send_json(200, {"reasons": clean})

    def ta_upload(self, user, tid):
        """Evidence (photo / PDF) for one line: the maker while the line can be changed; HR while it waits for HR."""
        name = os.path.basename((self.query.get("name") or "file").replace("\\", "/")).strip()[:200] or "file"
        row_uid = (self.query.get("row") or "").strip()
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise HTTPError(413, f"File too large (max {MAX_UPLOAD // 1048576} MB).")
        ctype = (self.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip()[:100]
        if not (ctype.startswith("image/") or ctype == "application/pdf"):
            raise HTTPError(400, "Evidence must be a photo (JPG / PNG) or a PDF.")
        with DB() as c:
            r, acc = self.ta_row(c, user, tid)
            line = next((x for x in ta_rows(r) if x["uid"] == row_uid), None)
            if not line:
                raise HTTPError(404, "Line not found - save the form first.")
            mine = r["created_by"] == user["id"]
            ok = (mine and (r["status"] in ("draft", "submitted") or (r["status"] == "incomplete" and r["returned_by"] == "hr" and line.get("hrAck") == "declined"))) \
                or (acc["hr"] and (r["status"] == "processing" or (r["status"] == "incomplete" and r["returned_by"] == "user")))
            if not ok:
                raise HTTPError(403, "Evidence cannot be added to this line now.")
            folder = os.path.join("Time Adjustment", safe_name(r["doc_no"], "time adjustment", True))
            os.makedirs(os.path.join(UPLOADS, folder), exist_ok=True)
            stem, ext = os.path.splitext(safe_name(name))
            rel, k = os.path.join(folder, f"{line['staffId']} {line['date']} - {stem}{ext}"), 1
            while os.path.exists(os.path.join(UPLOADS, rel)) or os.path.exists(os.path.join(UPLOADS, rel + ".part")):
                k += 1
                rel = os.path.join(folder, f"{line['staffId']} {line['date']} - {stem} ({k}){ext}")
            path = os.path.join(UPLOADS, rel)
            open(path + ".part", "wb").close()
        remaining = n
        with open(path + ".part", "wb") as out:
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                out.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(path + ".part")
            raise HTTPError(400, "Upload interrupted.")
        os.replace(path + ".part", path)
        now, fid = time.time(), new_id()
        with DB() as c:
            c.execute("INSERT INTO ta_files(id, ta_id, row_uid, name, type, size, path, uploaded_by, uploaded_at) VALUES(?,?,?,?,?,?,?,?,?)",
                      (fid, tid, row_uid, name, ctype, n, rel, user["id"], now))
            audit(c, tid, user, "file_upload", TA_SEC, f"evidence {line['staffId']} {line['date']}", None, name, at=now)
            self.ta_send(c, tid)

    def ta_file(self, user, fid):
        with DB() as c:
            f = c.execute("SELECT * FROM ta_files WHERE id=? AND removed_at IS NULL", (fid,)).fetchone()
            if not f:
                raise HTTPError(404, "File not found.")
            self.ta_row(c, user, f["ta_id"])
        self.send_stored_file(f)

    def ta_file_remove(self, user, fid):
        """Take an evidence file off a line (kept on the server, only hidden)."""
        now = time.time()
        with DB() as c:
            f = c.execute("SELECT * FROM ta_files WHERE id=? AND removed_at IS NULL", (fid,)).fetchone()
            if not f:
                raise HTTPError(404, "File not found.")
            r, acc = self.ta_row(c, user, f["ta_id"])
            if not ((r["created_by"] == user["id"] and r["status"] in ("draft", "submitted", "incomplete")) or (acc["hr"] and r["status"] in ("processing", "incomplete"))):
                raise HTTPError(403, "Evidence cannot be removed now.")
            c.execute("UPDATE ta_files SET removed_at=?, removed_by=? WHERE id=?", (now, user["id"], fid))
            audit(c, r["id"], user, "file_remove", TA_SEC, "evidence", f["name"], None, at=now)
            self.ta_send(c, r["id"])

    # ------------------------------------------------------------ MC Request
    def mc_row(self, c, user, mid, hr=False):
        acc = mc_access(c, user)
        r = c.execute("SELECT * FROM mc_requests WHERE id=?", (mid,)).fetchone()
        # a user (not HR): what they submitted, their own MC, and - a manager - the MC of the staff under them
        mine = r and (r["submitted_by"] == user["id"] or r["staff_code"].lower() in hr_view_codes(c, user))
        if not r or not (acc["hr"] or (acc["submit"] and mine)):
            raise HTTPError(404, "MC request not found.")
        if hr and not acc["hr"]:
            raise HTTPError(403, "Only HR can do this.")
        return r, acc

    def mc_list(self, user):
        with DB() as c:
            acc = mc_access(c, user)
            if not (acc["submit"] or acc["hr"]):
                raise HTTPError(403, "You do not have access to MC Request.")
            items = mc_auto(c)
            nm, cfg = names(c), setting_all(c)
            team = [] if acc["hr"] else hr_team(c, user)
            codes = set() if acc["hr"] else hr_view_codes(c, user)
            rows = c.execute("SELECT * FROM mc_requests ORDER BY submitted_at DESC").fetchall() if acc["hr"] else [
                r for r in c.execute("SELECT * FROM mc_requests ORDER BY submitted_at DESC")
                if r["submitted_by"] == user["id"] or r["staff_code"].lower() in codes]
            out = [mc_json(c, r, nm, files=False) for r in rows]
            st = own_staff(c, user)
        mc_remind_mail(items)
        sett = mc_settings(cfg)
        mine = [x for x in out if (x["submittedById"] == user["id"] or x["staffCode"].lower() == user["username"].lower())
                and x["status"] in MC_OPEN and not x["received"] and x["leadLeft"] <= sett["remindDays"]]
        self.send_json(200, {"requests": out, "hr": acc["hr"], "canSubmit": acc["submit"], "settings": sett, "reminders": mine,
                             "staff": {"code": st["staff_id"], "name": st["full_name"], "outlet": st["outlet_code"]} if st else None,
                             "team": [{"code": t["staff_id"], "name": t["full_name"], "outlet": t["outlet_code"], "position": t["role"]} for t in team]})

    def mc_get(self, user, mid):
        with DB() as c:
            mc_auto(c)
            r, acc = self.mc_row(c, user, mid)
            mine = r["submitted_by"] == user["id"] or r["staff_code"].lower() == user["username"].lower()
            if acc["hr"] and r["status"] == "submitted" and not mine:   # HR opened someone's request: Submitted -> Processing
                now = time.time()
                c.execute("UPDATE mc_requests SET status='processing', updated_by=?, updated_at=? WHERE id=?", (user["id"], now, mid))
                audit(c, mid, user, "edit", MC_SEC, "status", "submitted", "processing (opened by HR)", at=now)
                r = c.execute("SELECT * FROM mc_requests WHERE id=?", (mid,)).fetchone()
            hist = [{"at": a["at"], "by": names(c).get(a["user_id"], "System"), "action": a["action"], "field": a["field"],
                     "old": a["old_value"], "new": a["new_value"]}
                    for a in c.execute("SELECT * FROM audit_log WHERE app_id=? ORDER BY id", (mid,))]
            self.send_json(200, {"request": mc_json(c, r, names(c)), "hr": acc["hr"], "history": hist,
                                 "mine": r["submitted_by"] == user["id"] or r["staff_code"].lower() == user["username"].lower()})

    def mc_create(self, user):
        b = self.body_json()
        doc_type = str(b.get("docType") or "").strip().upper()
        with DB() as c:
            codes = [t["code"] for t in mc_settings(setting_all(c))["docTypes"]]
        if doc_type not in codes:
            raise HTTPError(400, f"Choose the Document Type ({', '.join(codes)}).")
        leave_no = re.sub(r"\s+", " ", str(b.get("leaveNo") or "")).strip()[:100]
        if not leave_no:
            raise HTTPError(400, "Type the Leave Number.")
        date_apply = hr_date(b.get("dateApply"))
        if not date_apply:
            raise HTTPError(400, "Choose the Date Apply.")
        now = time.time()
        with DB() as c:
            acc = mc_access(c, user)
            if not acc["submit"]:
                raise HTTPError(403, "You cannot submit MC requests.")
            if not acc["hr"]:
                mc_date_check(setting_all(c), date_apply, now)
            code = str(b.get("staffCode") or "").strip()
            if acc["hr"] and code:                                  # HR may submit for any staff
                st = c.execute("SELECT * FROM hr_staff WHERE staff_id=? COLLATE NOCASE AND removed_at IS NULL", (code,)).fetchone()
                if not st:
                    raise HTTPError(400, f"Staff Code {code} is not in Staff Master Data.")
            elif code and code.lower() != user["username"].lower():  # a manager, for a staff of his team
                st = next((t for t in hr_team(c, user) if t["staff_id"].lower() == code.lower()), None)
                if not st:
                    raise HTTPError(403, f"Staff Code {code} is not in your team (your coverage branch and the positions under yours).")
            else:
                st = own_staff(c, user)
                if not st:
                    raise HTTPError(400, f"Your login ({user['username']}) is not in Staff Master Data - ask HR to add Staff Code "
                                         f"{user['username']}.")
            lead = mc_settings(setting_all(c))["leadDays"]
            mid, no = new_id(), next_mc_no(c, doc_type)
            c.execute("INSERT INTO mc_requests(id, doc_no, doc_type, omc_no, staff_code, staff_name, outlet, leave_no, date_apply, status,"
                      " lead_days, submitted_by, submitted_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?, 'submitted',?,?,?,?,?)",
                      (mid, no, doc_type, "", st["staff_id"], st["full_name"], st["outlet_code"],
                       leave_no, date_apply, lead, user["id"], now, user["id"], now))
            audit(c, mid, user, "create", MC_SEC, "status", None, f"{no} submitted", at=now)
            self.send_json(200, {"request": mc_json(c, c.execute("SELECT * FROM mc_requests WHERE id=?", (mid,)).fetchone(), names(c))})

    def mc_upload(self, user, mid):
        name = os.path.basename((self.query.get("name") or "file").replace("\\", "/")).strip()[:200] or "file"
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise HTTPError(413, f"File too large (max {MAX_UPLOAD // 1048576} MB).")
        ctype = (self.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip()[:100]
        if not (ctype.startswith("image/") or ctype == "application/pdf"):
            raise HTTPError(400, "The MC must be a picture (JPG / PNG) or a PDF.")
        with DB() as c:
            r, acc = self.mc_row(c, user, mid)
            if not acc["hr"] and r["submitted_by"] != user["id"]:
                raise HTTPError(403, "Only the person who submitted it (or HR) can add a file.")
            if not acc["hr"] and r["status"] != "submitted":
                raise HTTPError(403, "HR is already processing this request - it cannot be changed now (ask HR to add the file).")
            folder = os.path.join("MC Requests", safe_name(r["doc_no"], "mc", True))
            os.makedirs(os.path.join(UPLOADS, folder), exist_ok=True)
            stem, ext = os.path.splitext(safe_name(name))
            rel, k = os.path.join(folder, stem + ext), 1
            while os.path.exists(os.path.join(UPLOADS, rel)) or os.path.exists(os.path.join(UPLOADS, rel + ".part")):
                k += 1
                rel = os.path.join(folder, f"{stem} ({k}){ext}")
            path = os.path.join(UPLOADS, rel)
            open(path + ".part", "wb").close()
        remaining = n
        with open(path + ".part", "wb") as out:
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                out.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(path + ".part")
            raise HTTPError(400, "Upload interrupted.")
        os.replace(path + ".part", path)
        now, fid = time.time(), new_id()
        with DB() as c:
            c.execute("INSERT INTO mc_files(id, mc_id, name, type, size, path, uploaded_by, uploaded_at) VALUES(?,?,?,?,?,?,?,?)",
                      (fid, mid, name, ctype, n, rel, user["id"], now))
            audit(c, mid, user, "file_upload", MC_SEC, "MC", None, name, at=now)
            self.send_json(200, {"request": mc_json(c, c.execute("SELECT * FROM mc_requests WHERE id=?", (mid,)).fetchone(), names(c))})

    def mc_file(self, user, fid):
        with DB() as c:
            f = c.execute("SELECT * FROM mc_files WHERE id=? AND removed_at IS NULL", (fid,)).fetchone()
            if not f:
                raise HTTPError(404, "File not found.")
            self.mc_row(c, user, f["mc_id"])                       # same rights as the request
        self.send_stored_file(f)

    def mc_update(self, user, mid):
        """The person who submitted it may still change the Leave Number / Date Apply until HR opens it (Processing)."""
        b = self.body_json()
        leave_no = re.sub(r"\s+", " ", str(b.get("leaveNo") or "")).strip()[:100]
        date_apply = hr_date(b.get("dateApply"))
        if not leave_no:
            raise HTTPError(400, "Type the Leave Number.")
        if not date_apply:
            raise HTTPError(400, "Choose the Date Apply.")
        now = time.time()
        with DB() as c:
            r, acc = self.mc_row(c, user, mid)
            if r["submitted_by"] != user["id"] and not acc["hr"]:
                raise HTTPError(403, "Only the person who submitted it can change it.")
            if r["status"] != "submitted":
                raise HTTPError(409, "HR is already processing this request - it cannot be changed now.")
            if not acc["hr"] and date_apply != r["date_apply"]:
                mc_date_check(setting_all(c), date_apply, r["submitted_at"] or now)
            for field, col, val in (("Leave Number", "leave_no", leave_no), ("Date Apply", "date_apply", date_apply)):
                if r[col] != val:
                    audit(c, mid, user, "edit", MC_SEC, field, r[col], val, at=now)
            c.execute("UPDATE mc_requests SET leave_no=?, date_apply=?, updated_by=?, updated_at=? WHERE id=?",
                      (leave_no, date_apply, user["id"], now, mid))
            self.send_json(200, {"request": mc_json(c, c.execute("SELECT * FROM mc_requests WHERE id=?", (mid,)).fetchone(), names(c))})

    def mc_file_remove(self, user, fid):
        """Take an MC picture off (kept on the server, only hidden): the submitter while Submitted, or HR."""
        now = time.time()
        with DB() as c:
            f = c.execute("SELECT * FROM mc_files WHERE id=? AND removed_at IS NULL", (fid,)).fetchone()
            if not f:
                raise HTTPError(404, "File not found.")
            r, acc = self.mc_row(c, user, f["mc_id"])
            if not (acc["hr"] or (r["submitted_by"] == user["id"] and r["status"] == "submitted")):
                raise HTTPError(403, "HR is already processing this request - it cannot be changed now.")
            c.execute("UPDATE mc_files SET removed_at=?, removed_by=? WHERE id=?", (now, user["id"], fid))
            audit(c, r["id"], user, "file_remove", MC_SEC, "MC", f["name"], None, at=now)
            self.send_json(200, {"request": mc_json(c, c.execute("SELECT * FROM mc_requests WHERE id=?", (r["id"],)).fetchone(), names(c))})

    def mc_decide(self, user, mid):
        """HR: approve / reject / original MC received (tick or untick)."""
        b = self.body_json()
        action, now = b.get("action"), time.time()
        with DB() as c:
            r, _ = self.mc_row(c, user, mid, hr=True)
            if r["status"] == "rejected":
                raise HTTPError(409, "This request is rejected.")
            received = r["received_at"]
            if "received" in b:                                     # the tick box "Click when receive original MC"
                if b["received"] and not received:
                    received = now
                    c.execute("UPDATE mc_requests SET received_at=?, received_by=? WHERE id=?", (now, user["id"], mid))
                    audit(c, mid, user, "edit", MC_SEC, "original MC", None, "received", at=now)
                elif not b["received"] and received:
                    received = None
                    c.execute("UPDATE mc_requests SET received_at=NULL, received_by=NULL WHERE id=?", (mid,))
                    audit(c, mid, user, "edit", MC_SEC, "original MC", "received", "not received", at=now)
            status = r["status"]
            if action == "reject":
                if status == "completed":
                    raise HTTPError(409, "A completed request cannot be rejected.")
                reason = re.sub(r"\s+", " ", str(b.get("reason") or "")).strip()[:300]
                c.execute("UPDATE mc_requests SET status='rejected', rejected_by=?, rejected_at=?, reject_reason=? WHERE id=?",
                          (user["id"], now, reason, mid))
                audit(c, mid, user, "cancel", MC_SEC, "status", MC_LABEL(status), "rejected" + (f" - {reason}" if reason else ""), at=now)
                status = "rejected"
            elif action == "approve" and status in ("submitted", "processing"):
                c.execute("UPDATE mc_requests SET status='approved', approved_by=?, approved_at=? WHERE id=?", (user["id"], now, mid))
                audit(c, mid, user, "submit", MC_SEC, "status", MC_LABEL(status), "approved", at=now)
                status = "approved"
            elif action not in (None, "", "approve", "save"):
                raise HTTPError(400, "Unknown action.")
            # Completed = approved + original MC received
            new = "completed" if status == "approved" and received else "approved" if status == "completed" and not received else status
            if new != status:
                c.execute("UPDATE mc_requests SET status=? WHERE id=?", (new, mid))
                audit(c, mid, user, "edit", MC_SEC, "status", status, new, at=now)
            c.execute("UPDATE mc_requests SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, mid))
            self.send_json(200, {"request": mc_json(c, c.execute("SELECT * FROM mc_requests WHERE id=?", (mid,)).fetchone(), names(c))})

    def mc_set(self, user):
        b = self.body_json()
        try:
            lead, remind = int(b.get("leadDays")), int(b.get("remindDays"))
        except (TypeError, ValueError):
            raise HTTPError(400, "Type numbers of days.")
        if not (1 <= lead <= 365 and 0 <= remind < lead):
            raise HTTPError(400, "Lead time 1-365 days; the reminder must be fewer days than the lead time.")
        with DB() as c:
            setting_set(c, "mc_lead_days", lead)
            setting_set(c, "mc_remind_days", remind)
            if b.get("backdateHours") not in (None, ""):
                try:
                    bh = int(b.get("backdateHours"))
                except (TypeError, ValueError):
                    raise HTTPError(400, "Type the backdate limit in hours.")
                if not 1 <= bh <= 720:
                    raise HTTPError(400, "Backdate limit: 1-720 hours.")
                setting_set(c, "mc_backdate_hours", bh)
            if b.get("docTypes") is not None:
                types = mc_types_clean(b.get("docTypes"))
                if not types:
                    raise HTTPError(400, "Keep at least one Document Type.")
                if len(types) > 30:
                    raise HTTPError(400, "At most 30 Document Types.")
                setting_set(c, "mc_doc_types", json.dumps(types))
            out = mc_settings(setting_all(c))
        self.send_json(200, {"settings": out})

    # ------------------------------------------------------------ HR Staff Master Data
    def hr_check(self, c, user, edit=False, hr_only=False):
        scope = hr_scope(c, user)
        if not scope:
            raise HTTPError(403, "You do not have access to Staff Master Data.")
        if hr_only and not scope["hr"]:
            raise HTTPError(403, "Only HR can do this.")
        if edit and not scope["edit"]:
            raise HTTPError(403, "You can only view the staff list.")
        return scope

    def hr_cover_text(self, scope):
        return ", ".join(sorted(scope["branches"]))

    def send_bytes(self, data, ctype, filename):
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{urllib.parse.quote(filename)}")
        self.send_header("Cache-Control", "private, no-store")
        self.common_headers()
        self.end_headers()
        self.wfile.write(data)

    def hr_list(self, user):
        with DB() as c:
            acc = self.hr_check(c, user)
            nm = names(c)
            logins = {r["username"].lower() for r in c.execute("SELECT username FROM users")}
            staff = [{**hr_json(r, nm), "hasLogin": r["staff_id"].lower() in logins} for r in c.execute(
                "SELECT * FROM hr_staff WHERE removed_at IS NULL ORDER BY staff_id COLLATE NOCASE") if hr_in_scope(acc, r["outlet_code"], r["role"])]
            opts = get_options(c)
        cover = None if acc["all"] else {"branches": sorted(acc["branches"])}
        self.send_json(200, {"staff": staff, "canEdit": acc["edit"], "isHR": acc["hr"], "coverage": cover,
                             "roles": opts["hrRoles"], "outlets": opts["hrOutlets"], "departments": opts["hrDepartments"],
                             "canCreateLogin": user["role"] == "superadmin", "defaultPassword": HR_DEFAULT_PASSWORD})

    def _staff_login(self, c, user, st, pw_hash, now):
        """Make the login of one staff; returns the new user row. Raises HTTPError with the reason when it cannot."""
        username = st["staff_id"].strip()
        if st["resigned_date"] and st["resigned_date"] <= time.strftime("%Y-%m-%d"):
            raise HTTPError(400, f"{username} has resigned.")
        if not re.fullmatch(r"[A-Za-z0-9._-]{3,40}", username):
            raise HTTPError(400, f"Staff Code '{username}' cannot be a username (3-40 letters, numbers, dot, dash or underscore). "
                                 "Make the login under Settings > Users instead.")
        if c.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone():
            raise HTTPError(409, f"A login with username {username} already exists.")
        email = st["email"] if st["email"] and EMAIL_RE.fullmatch(st["email"]) else ""
        pos = c.execute("SELECT id FROM access_roles WHERE name=?", (st["role"],)).fetchone() if st["role"] else None
        cur = c.execute("INSERT INTO users(username, name, role, pw_hash, created_at, must_change_pw, email, access_role)"
                        " VALUES(?,?,'user',?,?,1,?,?)", (username, st["full_name"] or username, pw_hash, now, email,
                                                          pos["id"] if pos else None))
        audit(c, st["id"], user, "create", HR_SEC, "login", None, f"login {username} created (position {st['role'] or '-'}, no access)", at=now)
        return c.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone(), bool(pos)

    def hr_create_login(self, user, sid):
        """One click (Super Admin): a system login for a staff - username = Staff Code, name = Staff Name, email copied,
        Position linked, default password (to be changed at the first sign-in) and NO access ticked."""
        pw = HR_DEFAULT_PASSWORD
        pw_hash, now = hash_pw(pw), time.time()
        with DB() as c:
            st = c.execute("SELECT * FROM hr_staff WHERE id=? AND removed_at IS NULL", (sid,)).fetchone()
            if not st:
                raise HTTPError(404, "Staff not found.")
            sync_roles(c)
            u, linked = self._staff_login(c, user, st, pw_hash, now)
        self.send_json(200, {"user": user_json(u), "position": st["role"] if linked else "", "password": pw})

    def hr_create_logins(self, user):
        """Batch: logins for many staff at once - the same rules as one click; staff that cannot get one are listed."""
        ids = self.body_json().get("ids")
        if not isinstance(ids, list) or not ids or len(ids) > 500:
            raise HTTPError(400, "Choose 1 to 500 staff.")
        pws = [HR_DEFAULT_PASSWORD for _ in ids]                     # the fixed first password (each login hashed with its own salt)
        hashes = [hash_pw(x) for x in pws]
        now, made, skipped = time.time(), [], []
        with DB() as c:
            sync_roles(c)
            for sid, h, pw in zip(ids, hashes, pws):
                st = c.execute("SELECT * FROM hr_staff WHERE id=? AND removed_at IS NULL", (str(sid),)).fetchone()
                if not st:
                    continue
                try:
                    u, _ = self._staff_login(c, user, st, h, now)
                    made.append({"username": u["username"], "name": u["name"], "outlet": st["outlet_code"], "password": pw})
                except HTTPError as e:
                    skipped.append({"staff": st["staff_id"], "reason": e.message})
        self.send_json(200, {"created": made, "skipped": skipped})

    def hr_bulk_update(self, user):
        """Batch: set BR / Position / Joined Date / Resigned Date of many staff at once (only the fields sent)."""
        b = self.body_json()
        ids, fields = b.get("ids"), b.get("set") or {}
        if not isinstance(ids, list) or not ids or len(ids) > 2000:
            raise HTTPError(400, "Choose the staff first.")
        keymap = {"outletCode": "outlet_code", "role": "role", "joinedDate": "joined_date", "resignedDate": "resigned_date"}
        vals = self._hr_values({keymap[k]: v for k, v in fields.items() if k in keymap})
        if not vals:
            raise HTTPError(400, "Tick at least one thing to change.")
        now, changed = time.time(), 0
        with DB() as c:
            self.hr_check(c, user, edit=True, hr_only=True)
            for sid in ids:
                row = c.execute("SELECT * FROM hr_staff WHERE id=? AND removed_at IS NULL", (str(sid),)).fetchone()
                if not row:
                    continue
                new = {k: v for k, v in vals.items() if v != row[k]}
                jd, rd = new.get("joined_date", row["joined_date"]), new.get("resigned_date", row["resigned_date"])
                if jd and rd and rd < jd:
                    raise HTTPError(400, f"{row['staff_id']}: Resigned Date would be before Joined Date - nothing was changed.")
                if not new:
                    continue
                c.execute(f"UPDATE hr_staff SET {', '.join(k + '=?' for k in new)}, updated_by=?, updated_at=? WHERE id=?",
                          (*new.values(), user["id"], now, row["id"]))
                for k, v in new.items():
                    audit(c, row["id"], user, "edit", HR_SEC, dict(HR_FIELDS)[k], row[k], v, at=now)
                changed += 1
        self.send_json(200, {"changed": changed, "unchanged": len(ids) - changed})

    def _hr_values(self, b):
        vals = {k: hr_clean(k, b.get(k)) for k, _ in HR_FIELDS if k in b and k not in HR_DATES}
        for k in HR_DATES:
            if k in b:
                d = hr_date(b.get(k))
                if d is None:
                    raise HTTPError(400, f"{dict(HR_FIELDS)[k]} '{b.get(k)}' is not a date.")
                vals[k] = d
        if vals.get("joined_date") and vals.get("resigned_date") and vals["resigned_date"] < vals["joined_date"]:
            raise HTTPError(400, "Resigned Date is before Joined Date.")
        if "staff_id" in vals and not vals["staff_id"]:
            raise HTTPError(400, "Staff Code is required.")
        if vals.get("email") and not EMAIL_RE.fullmatch(vals["email"]):
            raise HTTPError(400, f"'{vals['email']}' is not a valid email address.")
        return vals

    def _hr_taken(self, c, staff_id, not_id=None):
        r = c.execute("SELECT * FROM hr_staff WHERE staff_id=? COLLATE NOCASE", (staff_id,)).fetchone()
        return r if r and r["id"] != not_id else None

    def hr_add(self, user):
        b = self.body_json()
        b = {"staff_id": b.get("staffId"), "full_name": b.get("fullName"), "role": b.get("role"), "email": b.get("email"),
             "outlet_code": b.get("outletCode"), "joined_date": b.get("joinedDate"), "resigned_date": b.get("resignedDate"),
             "ic_no": b.get("icNo"), **({"cover_branches": b["coverBranches"]} if "coverBranches" in b else {})}
        vals = self._hr_values(b)
        if not vals.get("staff_id"):
            raise HTTPError(400, "Staff Code is required.")
        now = time.time()
        with DB() as c:
            scope = self.hr_check(c, user, edit=True)
            if not scope["hr"]:
                for k in HR_COVER:
                    vals.pop(k, None)                                # only HR sets coverage
                if not hr_in_scope(scope, vals.get("outlet_code"), vals.get("role")):
                    raise HTTPError(403, f"You can only add staff in your coverage ({self.hr_cover_text(scope)}).")
            old = self._hr_taken(c, vals["staff_id"])
            if old and not old["removed_at"]:
                raise HTTPError(409, f"Staff Code {old['staff_id']} already exists ({old['full_name'] or 'no name'}).")
            if old:                                              # was removed before: bring it back with the new details
                sid = old["id"]
                c.execute("UPDATE hr_staff SET staff_id=?, full_name=?, role=?, email=?, outlet_code=?, joined_date=?, resigned_date=?,"
                          " updated_by=?, updated_at=?, removed_at=NULL, removed_by=NULL WHERE id=?",
                          (vals["staff_id"], vals.get("full_name", ""), vals.get("role", ""), vals.get("email", ""),
                           vals.get("outlet_code", ""), vals.get("joined_date", ""), vals.get("resigned_date", ""), user["id"], now, sid))
            else:
                sid = new_id()
                c.execute("INSERT INTO hr_staff(id, staff_id, full_name, role, email, outlet_code, joined_date, resigned_date,"
                          " created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                          (sid, vals["staff_id"], vals.get("full_name", ""), vals.get("role", ""), vals.get("email", ""),
                           vals.get("outlet_code", ""), vals.get("joined_date", ""), vals.get("resigned_date", ""), user["id"], now, user["id"], now))
            for k in ("ic_no",) + HR_COVER:
                if k in vals:
                    c.execute(f"UPDATE hr_staff SET {k}=? WHERE id=?", (vals[k], sid))
            audit(c, sid, user, "create", HR_SEC, None, None, vals["staff_id"], at=now)
            self.send_json(200, {"staff": hr_json(c.execute("SELECT * FROM hr_staff WHERE id=?", (sid,)).fetchone(), names(c))})

    def hr_update(self, user, sid):
        b = self.body_json()
        b = {k: b[j] for k, j in (("staff_id", "staffId"), ("full_name", "fullName"), ("role", "role"), ("email", "email"),
                                  ("outlet_code", "outletCode"), ("joined_date", "joinedDate"), ("resigned_date", "resignedDate"),
                                  ("ic_no", "icNo"), ("cover_branches", "coverBranches")) if j in b}
        vals = self._hr_values(b)
        now = time.time()
        with DB() as c:
            scope = self.hr_check(c, user, edit=True)
            row = c.execute("SELECT * FROM hr_staff WHERE id=? AND removed_at IS NULL", (sid,)).fetchone()
            if not row or not hr_in_scope(scope, row["outlet_code"], row["role"]):
                raise HTTPError(404, "Staff not found.")
            if not scope["hr"]:
                for k in HR_COVER:
                    vals.pop(k, None)                                # only HR sets coverage
                if not hr_in_scope(scope, vals.get("outlet_code", row["outlet_code"]), vals.get("role", row["role"])):
                    raise HTTPError(403, f"The staff would leave your coverage ({self.hr_cover_text(scope)}) - ask HR to move them.")
            if "staff_id" in vals and self._hr_taken(c, vals["staff_id"], sid):
                raise HTTPError(409, f"Staff Code {vals['staff_id']} is already used by another staff.")
            changed = {k: v for k, v in vals.items() if v != row[k]}
            if changed:
                c.execute(f"UPDATE hr_staff SET {', '.join(k + '=?' for k in changed)}, updated_by=?, updated_at=? WHERE id=?",
                          (*changed.values(), user["id"], now, sid))
                for k, v in changed.items():
                    audit(c, sid, user, "edit", HR_SEC, dict(HR_FIELDS)[k], row[k], v, at=now)
            self.send_json(200, {"staff": hr_json(c.execute("SELECT * FROM hr_staff WHERE id=?", (sid,)).fetchone(), names(c))})

    def hr_remove(self, user, sid):
        now = time.time()
        with DB() as c:
            self.hr_check(c, user, edit=True, hr_only=True)
            row = c.execute("SELECT * FROM hr_staff WHERE id=? AND removed_at IS NULL", (sid,)).fetchone()
            if not row:
                raise HTTPError(404, "Staff not found.")
            c.execute("UPDATE hr_staff SET removed_at=?, removed_by=? WHERE id=?", (now, user["id"], sid))
            audit(c, sid, user, "cancel", HR_SEC, None, row["staff_id"], "removed", at=now)
        self.send_json(200, {"ok": True})

    def hr_import(self, user):
        """Excel / CSV -> staff. Only User ID, Role, Email, Full Name and Outlet Code are taken; other columns are ignored.
        A User ID already in the list is updated, a new one is added. mode=sync also removes staff not in the file."""
        data, name = self.eb_read_upload()
        table = eb_read_table(data, name)
        if not table:
            raise HTTPError(400, "The file is empty.")
        norm = lambda h: re.sub(r"\s+", " ", re.sub(r"[:*]+$", "", str(h))).strip().lower()
        heads = [norm(h) for h in table[0]]
        cols = {}
        for key, names_ in HR_HEADS.items():
            for i, h in enumerate(heads):
                if h in names_ and i not in cols.values():
                    cols[key] = i
                    break
        if "staff_id" not in cols:
            raise HTTPError(400, "No 'Staff Code' column found. The first row must have the headings: BR, Staff Code, Staff Name, "
                                 "Position, Email, Joined Date, Resigned Date. Headings found: " + (", ".join(h for h in table[0] if h) or "none"))
        used = set(cols.values())
        unused = [h for i, h in enumerate(table[0]) if i not in used and str(h).strip()]
        missing = [label for key, label in HR_FIELDS if key not in cols and key not in HR_COVER]
        rows, skipped, seen = {}, [], {}
        for n, r in enumerate(table[1:], start=2):
            raw = lambda k: r[cols[k]] if cols[k] < len(r) else ""
            vals = {k: hr_clean(k, raw(k)) for k in cols if k not in HR_DATES}
            for k in HR_DATES:
                if k in cols:
                    d = hr_date(raw(k))
                    if d is None:
                        skipped.append({"row": n, "reason": f"{dict(HR_FIELDS)[k]} '{raw(k)}' is not a date - left empty"})
                    vals[k] = d or ""
            if not vals["staff_id"]:
                if any(vals.values()):
                    skipped.append({"row": n, "reason": "no Staff Code"})
                continue
            key = vals["staff_id"].lower()
            if key in seen:
                skipped.append({"row": seen[key], "reason": f"Staff Code {vals['staff_id']} appears again in row {n} - row {n} is used"})
            seen[key] = n
            rows[key] = vals
        if not rows:
            raise HTTPError(400, "No staff rows found under the heading row.")
        bad_email = sorted({v["email"] for v in rows.values() if v.get("email") and not EMAIL_RE.fullmatch(v["email"])})
        with DB() as c:
            opts = get_options(c)
        known_roles = {r.lower() for r in opts["hrRoles"]}
        known_outlets = {o["code"] for o in opts["hrOutlets"]}
        new_roles = sorted({v["role"] for v in rows.values() if known_roles and v.get("role") and v["role"].lower() not in known_roles})
        new_outlets = sorted({v["outlet_code"] for v in rows.values()
                              if known_outlets and v.get("outlet_code") and v["outlet_code"] not in known_outlets})
        now = time.time()
        added = updated = same = removed = 0
        with DB() as c:
            self.hr_check(c, user, edit=True, hr_only=True)
            existing = {r["staff_id"].lower(): r for r in c.execute("SELECT * FROM hr_staff")}
            for key, vals in rows.items():
                old = existing.get(key)
                if not old:
                    sid = new_id()
                    c.execute("INSERT INTO hr_staff(id, staff_id, full_name, role, email, outlet_code, joined_date, resigned_date,"
                              " created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                              (sid, vals["staff_id"], vals.get("full_name", ""), vals.get("role", ""), vals.get("email", ""),
                               vals.get("outlet_code", ""), vals.get("joined_date", ""), vals.get("resigned_date", ""),
                               user["id"], now, user["id"], now))
                    for k in ("ic_no",) + HR_COVER:
                        if k in vals:
                            c.execute(f"UPDATE hr_staff SET {k}=? WHERE id=?", (vals[k], sid))
                    added += 1
                    continue
                changed = {k: v for k, v in vals.items() if v != old[k]}
                back = bool(old["removed_at"])
                if not changed and not back:
                    same += 1
                    continue
                sets = [k + "=?" for k in changed] + ["updated_by=?", "updated_at=?", "removed_at=NULL", "removed_by=NULL"]
                c.execute(f"UPDATE hr_staff SET {', '.join(sets)} WHERE id=?", (*changed.values(), user["id"], now, old["id"]))
                for k, v in changed.items():
                    if k != "staff_id":
                        audit(c, old["id"], user, "edit", HR_SEC, dict(HR_FIELDS)[k], old[k], v, at=now)
                if back:
                    added += 1
                else:
                    updated += 1
            if self.query.get("mode") == "sync":                 # staff no longer in the file are removed (kept for record)
                for key, old in existing.items():
                    if key not in rows and not old["removed_at"]:
                        c.execute("UPDATE hr_staff SET removed_at=?, removed_by=? WHERE id=?", (now, user["id"], old["id"]))
                        audit(c, old["id"], user, "cancel", HR_SEC, None, old["staff_id"], "removed (not in import file)", at=now)
                        removed += 1
            audit(c, "hr-import", user, "edit", HR_SEC, "import", None,
                  f"{name}: {added} added, {updated} updated, {same} unchanged, {removed} removed", at=now)
        self.send_json(200, {"added": added, "updated": updated, "unchanged": same, "removed": removed, "skipped": skipped,
                             "unusedColumns": unused, "missingColumns": missing, "badEmails": bad_email,
                             "unknownRoles": new_roles, "unknownOutlets": new_outlets})

    def hr_settings(self, user):
        """HR Setting (Super Admin / Admin): {"roles": ["Cashier", ...], "outlets": [{"code", "name"}, ...]}"""
        b = self.body_json()
        roles, outlets = b.get("roles"), b.get("outlets")
        if not isinstance(roles, list) or not isinstance(outlets, list) or len(roles) > 500 or len(outlets) > 2000:
            raise HTTPError(400, "Invalid lists.")
        depts_in, pdept_in, pparent_in = b.get("departments"), b.get("posDept"), b.get("posParent")
        clean_roles, seen = [], set()
        for v in roles:
            v = re.sub(r"\s+", " ", str(v or "")).strip()[:100]
            if v and v.lower() not in seen:
                seen.add(v.lower())
                clean_roles.append(v)
        clean_outlets, seen = [], set()
        for o in outlets:
            if not isinstance(o, dict):
                raise HTTPError(400, "Invalid outlet.")
            code, name = hr_clean("outlet_code", o.get("code"))[:50], re.sub(r"\s+", " ", str(o.get("name") or "")).strip()[:200]
            if not code and not name:
                continue
            if not code:
                raise HTTPError(400, f"Outlet '{name}' needs an Outlet Code.")
            if code in seen:
                raise HTTPError(400, f"Outlet Code {code} is listed twice.")
            seen.add(code)
            hrs = o.get("hours") if isinstance(o.get("hours"), dict) else {}
            state = re.sub(r"\s+", " ", str(o.get("state") or "")).strip()[:60]
            state = next((x for x in MY_STATES if x.lower() == state.lower()), state)
            clean_outlets.append({"code": code, "name": name, "state": state, "hours": {k: hr_time(hrs.get(k)) for k in TR_TIMES}})
        now = time.time()
        with DB() as c:
            old = get_options(c)
            depts = old["hrDepartments"]
            if isinstance(depts_in, list):
                depts, seen = [], set()
                for v in depts_in[:200]:
                    v = re.sub(r"\s+", " ", str(v or "")).strip()[:100]
                    if v and v.lower() not in seen:
                        seen.add(v.lower())
                        depts.append(v)
            pdept = old["hrPosDept"] if not isinstance(pdept_in, dict) else {
                str(k).strip()[:100]: str(v or "").strip()[:100] for k, v in pdept_in.items() if str(v or "").strip()}
            dk, rk = {d.lower(): d for d in depts}, {r.lower() for r in clean_roles}
            pdept = {k: dk.get(v.lower(), v) for k, v in pdept.items() if k.lower() in rk}
            for v in sorted(set(pdept.values())):                    # a department given to a position is in the list
                if v.lower() not in dk:
                    depts.append(v)
                    dk[v.lower()] = v
            keep = {r.lower() for r in clean_roles}
            gone = [r for r in c.execute("SELECT * FROM access_roles") if r["name"].lower() not in keep]
            used = [(r["name"], n) for r in gone
                    for n in [c.execute("SELECT COUNT(*) FROM users WHERE access_role=?", (r["id"],)).fetchone()[0]] if n]
            if used and not b.get("confirm"):
                raise HTTPError(409, "These positions are given to people in Access Control: " +
                                ", ".join(f"{nm} ({n} person{'s' if n > 1 else ''})" for nm, n in used) +
                                ". Removing them takes the position away from them (the people keep their rights). "
                                "To rename a position and keep its people, rename it in Access Control instead.", {"needConfirm": True})
            for r in gone:
                c.execute("UPDATE users SET access_role=NULL WHERE access_role=?", (r["id"],))
                c.execute("DELETE FROM access_roles WHERE id=?", (r["id"],))
            pparent = pos_parent_clean(pparent_in if isinstance(pparent_in, dict) else old["hrPosParent"], clean_roles)
            for key, val in (("hrRoles", clean_roles), ("hrOutlets", clean_outlets), ("hrDepartments", depts), ("hrPosDept", pdept),
                             ("hrPosParent", pparent)):
                c.execute("INSERT INTO option_lists(list_key, items) VALUES(?,?)"
                          " ON CONFLICT(list_key) DO UPDATE SET items=excluded.items", (key, json.dumps(val)))
            sync_roles(c)                                        # new roles become Access Roles (no rights yet)
            audit(c, "hr-settings", user, "edit", HR_SEC, "HR Setting", f"{len(old['hrRoles'])} roles, {len(old['hrOutlets'])} outlets",
                  f"{len(clean_roles)} roles, {len(clean_outlets)} outlets", at=now)
        self.send_json(200, {"roles": clean_roles, "outlets": clean_outlets, "departments": depts, "posDept": pdept, "posParent": pparent})

    def hr_settings_read(self, user):
        """Excel / CSV -> Role list or Outlet list (not saved here - the page merges it into the list and saves)."""
        kind = self.query.get("kind")
        if kind not in ("roles", "outlets"):
            raise HTTPError(400, "Unknown list.")
        data, name = self.eb_read_upload()
        table = eb_read_table(data, name)
        if not table:
            raise HTTPError(400, "The file is empty.")
        self.send_json(200, self.hrs_parse(kind, table))

    def hr_settings_read_all(self, user):
        """One Excel file with the sheets Positions, Departments, Outlets, MC Setting (from "Export all") -> all lists.
        Not saved here - the page merges them and saves."""
        data, name = self.eb_read_upload()
        if os.path.splitext(name)[1].lower() not in (".xlsx", ".xlsm"):
            raise HTTPError(400, "Choose the Excel file (.xlsx) made by \"Export all\".")
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
            tmp.write(data)
        try:
            book = _xlsx_book(tmp.name)
        except Exception:
            raise HTTPError(400, "Could not read this Excel file - save it as .xlsx and try again.")
        finally:
            os.remove(tmp.name)
        tab = lambda word: next((rows for nm, rows in book if word in nm.lower() and rows), None)
        out, found = {}, []
        if tab("position"):
            out.update(self.hrs_parse("roles", tab("position")))
            found.append("Positions")
        if tab("outlet"):
            out.update(self.hrs_parse("outlets", tab("outlet")))
            found.append("Outlets")
        deps = tab("department")
        if deps:
            seen, dl = set(), []
            for r in deps[1:] if deps and deps[0] and str(deps[0][0]).strip().lower() in ("department", "departments", "dept") else deps:
                v = re.sub(r"\s+", " ", str(r[0] if r else "")).strip()[:100]
                if v and v.lower() not in seen:
                    seen.add(v.lower())
                    dl.append(v)
            out["departments"] = dl
            found.append("Departments")
        mc = tab("mc")
        if mc:
            vals = {}
            for r in mc:
                if len(r) >= 2 and "type" in str(r[0]).lower() and str(r[1] or "").strip():
                    vals["docTypes"] = mc_types_clean([{"code": x.split("=", 1)[0], "name": x.split("=", 1)[1] if "=" in x else ""}
                                                       for x in str(r[1]).split(";")])
                    continue
                if len(r) >= 2 and str(r[1]).strip().isdigit():
                    key = str(r[0]).lower()
                    vals["remindDays" if "remind" in key else "backdateHours" if "hour" in key else "leadDays" if "lead" in key else None] = int(str(r[1]).strip())
            vals.pop(None, None)
            if vals:
                out["mc"] = vals
                found.append("MC Setting")
        if not found:
            raise HTTPError(400, "No HR Setting sheets found. Use the file made by \"Export all\" (sheets: Positions, Departments, Outlets, MC Setting).")
        out["found"] = found
        self.send_json(200, out)

    def hr_settings_export_all(self, user):
        with DB() as c:
            opts, mc = get_options(c), mc_settings(setting_all(c))
        pd = {k.lower(): v for k, v in opts["hrPosDept"].items()}
        pp = {k.lower(): v for k, v in opts["hrPosParent"].items()}
        book = xlsx_book([
            ("Positions", ["Position", "Department", "Reports To"], [[r, pd.get(r.lower(), ""), pp.get(r.lower(), "")] for r in opts["hrRoles"]]),
            ("Departments", ["Department"], [[d] for d in opts["hrDepartments"]]),
            ("Outlets", ["Outlet Code", "Outlet Name", "State"] + [lbl for _, lbl in TR_TIME_LABELS],
             [[o["code"], o["name"], o.get("state") or ""] + [(o.get("hours") or {}).get(k, "") for k, _ in TR_TIME_LABELS]
              for o in opts["hrOutlets"]]),
            ("MC Setting", ["Setting", "Value"], [["Lead time for the original MC (days)", mc["leadDays"]],
                                                  ["Remind the staff when days are left", mc["remindDays"]],
                                                  ["Staff must submit within hours (backdate limit)", mc["backdateHours"]],
                                                  ["Document types (CODE=Name; ...)", "; ".join(t["code"] + ("=" + t["name"] if t["name"] else "") for t in mc["docTypes"])]]),
        ])
        self.send_bytes(book, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        f"HR Setting {time.strftime('%Y-%m-%d')}.xlsx")

    @staticmethod
    def hrs_parse(kind, table):
        """A Position list (Position, Department) or Outlet list (Outlet Code, Outlet Name, State, working hours) from a table."""
        norm = lambda h: re.sub(r"\s+", " ", re.sub(r"[:*]+$", "", str(h))).strip().lower()
        heads = [norm(h) for h in table[0]] if table else []
        find = lambda names_: next((i for i, h in enumerate(heads) if h in names_), None)
        if kind == "roles":
            col = find(HR_HEADS["role"] + ("roles", "role name", "positions", "position name", "job"))
            body = table[1:] if col is not None else table          # no heading row: the first column is the list
            col = 0 if col is None else col
            c_dept = find(("department", "dept", "department name")) if body is not table else None
            c_par = find(("reports to", "report to", "reporting to", "parent", "superior", "under")) if body is not table else None
            roles, seen, pdept, ppar = [], set(), {}, {}
            for r in body:
                v = re.sub(r"\s+", " ", str(r[col] if col < len(r) else "")).strip()[:100]
                if v and v.lower() not in seen:
                    seen.add(v.lower())
                    roles.append(v)
                    d = re.sub(r"\s+", " ", str(r[c_dept] if c_dept is not None and c_dept < len(r) else "")).strip()[:100]
                    if d:
                        pdept[v] = d
                    up = re.sub(r"\s+", " ", str(r[c_par] if c_par is not None and c_par < len(r) else "")).strip()[:100]
                    if up:
                        ppar[v] = up
            if not roles:
                raise HTTPError(400, "No positions found in the file.")
            return {"roles": roles, "posDept": pdept, "posParent": ppar}
        c_code = find(("outlet code", "outletcode", "code", "branch code", "store code", "outlet id", "outlet"))
        c_name = find(("outlet name", "name", "branch name", "store name", "description"))
        c_times = {k: find(heads_) for k, heads_ in TR_TIME_HEADS.items()}
        c_state = find(("state", "negeri", "outlet state"))
        if c_code is None:
            raise HTTPError(400, "No 'Outlet Code' column found. The first row must have the headings: Outlet Code, Outlet Name. "
                                 "Headings found: " + (", ".join(h for h in table[0] if h) or "none"))
        outlets, seen = [], set()
        for r in table[1:]:
            code = hr_clean("outlet_code", r[c_code] if c_code < len(r) else "")[:50]
            nm = re.sub(r"\s+", " ", str(r[c_name] if c_name is not None and c_name < len(r) else "")).strip()[:200]
            if code and code not in seen:
                seen.add(code)
                cell = lambda i: r[i] if i is not None and i < len(r) else ""
                st_ = re.sub(r"\s+", " ", str(cell(c_state))).strip()[:60]
                outlets.append({"code": code, "name": nm, "state": next((x for x in MY_STATES if x.lower() == st_.lower()), st_),
                                "hours": {k: hr_time(cell(i)) for k, i in c_times.items()}})
        if not outlets:
            raise HTTPError(400, "No outlet rows found under the heading row.")
        return {"outlets": outlets}

    def hr_settings_template(self, user):
        kind = self.query.get("kind")
        heads = ["Position", "Department", "Reports To"] if kind == "roles" else ["Outlet Code", "Outlet Name", "State"] + [lbl for _, lbl in TR_TIME_LABELS]
        with DB() as c:
            opts = get_options(c)
        pd = {k.lower(): v for k, v in opts["hrPosDept"].items()}
        pp = {k.lower(): v for k, v in opts["hrPosParent"].items()}
        rows = [[r, pd.get(r.lower(), ""), pp.get(r.lower(), "")] for r in opts["hrRoles"]] if kind == "roles" else [
            [o["code"], o["name"], o.get("state") or ""] + [(o.get("hours") or {}).get(k, "") for k, _ in TR_TIME_LABELS] for o in opts["hrOutlets"]]
        self.send_bytes(eb_xlsx(heads, rows), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        f"HR Setting - {'Position' if kind == 'roles' else 'Outlet'} list.xlsx")

    def hr_template(self, user):
        with DB() as c:
            self.hr_check(c, user)
        self.send_bytes(eb_xlsx([label for _, label in HR_FIELDS]),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Staff Master Data - import template.xlsx")

    def hr_export(self, user):
        with DB() as c:
            scope = self.hr_check(c, user)
            dmy = lambda v: "/".join(reversed(v.split("-"))) if v else ""     # 2026-09-30 -> 30/09/2026
            rows = [[dmy(r[k]) if k in HR_DATES else r[k] for k, _ in HR_FIELDS] for r in c.execute(
                "SELECT * FROM hr_staff WHERE removed_at IS NULL ORDER BY staff_id COLLATE NOCASE") if hr_in_scope(scope, r["outlet_code"], r["role"])]
        self.send_bytes(eb_xlsx([label for _, label in HR_FIELDS], rows),
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        f"Staff Master Data {time.strftime('%Y-%m-%d')}.xlsx")

    def eb_list(self, user):
        with DB() as c:
            acc = eb_access(c, user)
            if not acc["view"]:
                raise HTTPError(403, "You do not have access to Email Batch.")
            batches = [eb_json(c, b, rows=False) for b in c.execute("SELECT * FROM eb_batches ORDER BY created_at DESC")]
            quota = eb_quota(c)
        self.send_json(200, {"batches": batches, "canEdit": acc["edit"], "quota": quota,
                             "canSetLimit": user["role"] in ("superadmin", "admin")})

    def eb_set_limit(self, user):
        b = self.body_json()
        try:
            limit = int(b.get("limit"))
        except (TypeError, ValueError):
            raise HTTPError(400, "Type a number.")
        if not 0 <= limit <= 100000:
            raise HTTPError(400, "The limit must be between 0 (no limit) and 100000.")
        with DB() as c:
            setting_set(c, "eb_daily_limit", limit)
            self.send_json(200, {"quota": eb_quota(c)})

    def eb_create(self, user):
        b = self.body_json()
        now = time.time()
        with DB() as c:
            if not eb_access(c, user)["edit"]:
                raise HTTPError(403, "You cannot create email batches.")
            subject = body = ""
            from_name = "Company Name"
            src = b.get("copyFrom")
            if src:                                              # reuse the template of an earlier batch
                old = c.execute("SELECT * FROM eb_batches WHERE id=?", (src,)).fetchone()
                if not old:
                    raise HTTPError(404, "Batch to copy the template from was not found.")
                subject, body, from_name = old["subject"], old["body"], old["from_name"] or from_name
            bid = new_id()
            c.execute("INSERT INTO eb_batches(id, batch_no, title, from_name, subject, body, created_by, created_at, updated_by, updated_at)"
                      " VALUES(?,?,?,?,?,?,?,?,?,?)", (bid, next_eb_no(c), str(b.get("title") or "").strip()[:200], from_name,
                                                        subject, body, user["id"], now, user["id"], now))
            audit(c, bid, user, "create", EB_SEC, at=now)
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone())})

    def eb_get(self, user, bid):
        with DB() as c:
            self.send_json(200, {"batch": eb_json(c, self.eb_row(c, user, bid)), "canEdit": eb_access(c, user)["edit"]})

    def eb_update(self, user, bid):
        b = self.body_json()
        with DB() as c:
            row = self.eb_row(c, user, bid, edit=True)
            self.eb_editable(row)
            now = time.time()
            vals = {"title": str(b.get("title", row["title"]) or "").strip()[:200],
                    "from_name": str(b.get("fromName", row["from_name"]) or "").strip()[:100],
                    "subject": str(b.get("subject", row["subject"]) or "").replace("\n", " ")[:300],
                    "body": eb_clean_html(str(b["bodyHtml"])) if "bodyHtml" in b
                    else str(b.get("body", row["body"]) or "").replace("\r\n", "\n")[:20000]}
            for k, v in vals.items():
                if v != row[k]:
                    audit(c, bid, user, "edit", EB_SEC, k, row[k], v, at=now)
            c.execute("UPDATE eb_batches SET title=?, from_name=?, subject=?, body=?, updated_by=?, updated_at=? WHERE id=?",
                      (vals["title"], vals["from_name"], vals["subject"], vals["body"], user["id"], now, bid))
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone())})

    def eb_read_upload(self, limit=10 * 1024 * 1024):
        n = int(self.headers.get("Content-Length") or 0)
        if n > limit:
            raise HTTPError(413, f"File too large (max {limit // 1048576} MB).")
        return self.rfile.read(n), os.path.basename((self.query.get("name") or "file").replace("\\", "/"))[:200]

    def eb_import_template(self, user, bid):
        data, name = self.eb_read_upload()
        subject, body = eb_docx_template(data)
        if not body.strip():
            raise HTTPError(400, "No text found in this Word file.")
        with DB() as c:
            row = self.eb_row(c, user, bid, edit=True)
            self.eb_editable(row)
            now = time.time()
            c.execute("UPDATE eb_batches SET subject=?, body=?, updated_by=?, updated_at=? WHERE id=?",
                      (subject or row["subject"], body, user["id"], now, bid))
            audit(c, bid, user, "edit", EB_SEC, "template", None, f"imported {name}", at=now)
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone())})

    def _eb_save_rows(self, c, bid, rows, append):
        start = 0
        if append:
            start = c.execute("SELECT COALESCE(MAX(row_no), 0) FROM eb_recipients WHERE batch_id=?", (bid,)).fetchone()[0]
        else:
            c.execute("DELETE FROM eb_recipients WHERE batch_id=?", (bid,))
        if start + len(rows) > EB_MAX_ROWS:
            raise HTTPError(400, f"At most {EB_MAX_ROWS} customers per batch.")
        c.executemany("INSERT INTO eb_recipients(id, batch_id, row_no, email, fields) VALUES(?,?,?,?,?)",
                      [(new_id(), bid, start + i + 1, str(r.get("email") or "").strip()[:200],
                        json.dumps({str(k)[:60]: str(v)[:5000] for k, v in (r.get("fields") or {}).items()})) for i, r in enumerate(rows)])

    def eb_set_recipients(self, user, bid):
        rows = self.body_json().get("rows")
        if not isinstance(rows, list):
            raise HTTPError(400, "Invalid customer list.")
        rows = [r for r in rows if isinstance(r, dict) and (str(r.get("email") or "").strip()
                                                           or any(str(v).strip() for v in (r.get("fields") or {}).values()))]
        with DB() as c:
            row = self.eb_row(c, user, bid, edit=True)
            self.eb_editable(row)
            self._eb_save_rows(c, bid, rows, append=False)
            c.execute("UPDATE eb_batches SET updated_by=?, updated_at=? WHERE id=?", (user["id"], time.time(), bid))
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone())})

    def eb_import_recipients(self, user, bid):
        data, name = self.eb_read_upload()
        if name.lower().endswith(".docx"):
            return self.eb_import_recipients_docx(user, bid, data, name)
        table = eb_read_table(data, name)
        if len(table) < 2:
            raise HTTPError(400, "The file needs a heading row (Email, Name, ...) and at least one customer row.")
        with DB() as c:
            row = self.eb_row(c, user, bid, edit=True)
            self.eb_editable(row)
            fields = eb_fields(row["subject"], row["body"])
            heads = [re.sub(r"^\[|\]$", "", h.strip()).strip() for h in table[0]]
            email_col = next((i for i, h in enumerate(heads) if h.lower() in EB_EMAIL_HEADERS), None)
            if email_col is None:
                raise HTTPError(400, "No 'Email' column found. The first row must have the headings, e.g. Email, " +
                                ", ".join(fields[:6]))
            cols = {}
            for i, h in enumerate(heads):
                f = next((f for f in fields if f.lower() == h.lower()), None)
                if f and i != email_col:
                    cols[i] = f
            unused = [h for i, h in enumerate(heads) if i != email_col and i not in cols and h]
            missing = [f for f in fields if f not in cols.values()]
            rows = [{"email": (r[email_col] if email_col < len(r) else ""),
                     "fields": {f: (r[i] if i < len(r) else "") for i, f in cols.items()}} for r in table[1:]]
            self._eb_save_rows(c, bid, rows, append=self.query.get("mode") == "append")
            now = time.time()
            c.execute("UPDATE eb_batches SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, bid))
            audit(c, bid, user, "edit", EB_SEC, "customers", None, f"imported {len(rows)} from {name}", at=now)
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone()),
                                 "imported": len(rows), "unusedColumns": unused, "missingColumns": missing})

    def eb_import_recipients_docx(self, user, bid, data, name):
        with DB() as c:
            row = self.eb_row(c, user, bid, edit=True)
            self.eb_editable(row)
            rows, how = eb_docx_customers(data, row["subject"], row["body"])
            fields = eb_fields(row["subject"], row["body"])
            missing = [f for f in fields if not any(str(r["fields"].get(f, "")).strip() for r in rows)]
            self._eb_save_rows(c, bid, rows, append=self.query.get("mode") == "append")
            now = time.time()
            c.execute("UPDATE eb_batches SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, bid))
            audit(c, bid, user, "edit", EB_SEC, "customers", None, f"imported {len(rows)} from {name} ({how})", at=now)
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone()),
                                 "imported": len(rows), "unusedColumns": [], "missingColumns": missing, "foundIn": how,
                                 "noEmail": sum(1 for r in rows if not r["email"])})

    def eb_sample(self, user, bid):
        import csv
        import io
        with DB() as c:
            row = self.eb_row(c, user, bid)
            fields = eb_fields(row["subject"], row["body"])
            rows = [(r["email"], json.loads(r["fields"] or "{}")) for r in
                    c.execute("SELECT * FROM eb_recipients WHERE batch_id=? ORDER BY row_no", (bid,))]
        buf = io.StringIO()
        w = csv.writer(buf)
        w.writerow(["Email"] + fields)
        for email, vals in rows or [("customer@example.com", {})]:
            w.writerow([email] + [vals.get(f, "") for f in fields])
        data = ("\ufeff" + buf.getvalue()).encode("utf-8")          # BOM: Excel opens it as UTF-8
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f"attachment; filename*=UTF-8''{urllib.parse.quote(row['batch_no'] + ' customers.csv')}")
        self.send_header("Cache-Control", "private, no-store")
        self.common_headers()
        self.end_headers()
        self.wfile.write(data)

    def eb_import_template_xlsx(self, user, bid):
        with DB() as c:
            row = self.eb_row(c, user, bid)
            fields = eb_fields(row["subject"], row["body"])
        data = eb_xlsx(["Email"] + fields)
        self.send_response(200)
        self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition",
                         f"attachment; filename*=UTF-8''{urllib.parse.quote(row['batch_no'] + ' import template.xlsx')}")
        self.send_header("Cache-Control", "private, no-store")
        self.common_headers()
        self.end_headers()
        self.wfile.write(data)

    def eb_preview(self, user, bid):
        rid = self.query.get("r", "")
        with DB() as c:
            b = self.eb_row(c, user, bid)
            r = c.execute("SELECT * FROM eb_recipients WHERE id=? AND batch_id=?", (rid, bid)).fetchone()
            if not r:
                raise HTTPError(404, "Customer not found in this batch.")
            if r["status"] == "sent" and r["sent_html"]:              # the copy of what was really sent
                self.send_json(200, {"subject": r["sent_subject"], "html": r["sent_html"], "sent": True, "sentAt": r["sent_at"],
                                     "to": r["email"], "from": b["from_name"]})
                return
            values = json.loads(r["fields"] or "{}")
            subject, text, body = eb_render(b, values)
            self.send_json(200, {"subject": subject, "html": body, "sent": False, "to": r["email"], "from": b["from_name"],
                                 "problems": eb_problems(b, r["email"], values)})

    def eb_test(self, user, bid):
        b_in = self.body_json()
        to = clean_email(b_in.get("to"))
        if not to:
            raise HTTPError(400, "Type the email address for the test.")
        with DB() as c:
            b = self.eb_row(c, user, bid, edit=True)
            r = c.execute("SELECT * FROM eb_recipients WHERE id=? AND batch_id=?", (b_in.get("r") or "", bid)).fetchone() or \
                c.execute("SELECT * FROM eb_recipients WHERE batch_id=? ORDER BY row_no LIMIT 1", (bid,)).fetchone()
            cfg = setting_all(c)
        if not email_ready(cfg):
            raise HTTPError(400, "The mail server is not set up yet (Settings > Email Alerts).")
        subject, text, body = eb_render(b, json.loads(r["fields"] or "{}") if r else {})
        try:
            send_mail(cfg, [to], "[TEST] " + subject, text, body, from_name=b["from_name"] or "Company Name")
        except Exception as e:
            raise HTTPError(400, mail_error_text(e, cfg)[:600])
        self.send_json(200, {"ok": True})

    def eb_send(self, user, bid):
        with DB() as c:
            b = self.eb_row(c, user, bid, edit=True)
            if b["cancelled_at"]:
                raise HTTPError(409, "This batch is cancelled.")
            if not email_ready(setting_all(c)):
                raise HTTPError(400, "The mail server is not set up yet (Settings > Email Alerts).")
            if not b["subject"].strip() or not b["body"].strip():
                raise HTTPError(400, "Fill in the subject and the email text first.")
            pending = c.execute("SELECT * FROM eb_recipients WHERE batch_id=? AND status='pending'", (bid,)).fetchall()
            if not pending:
                raise HTTPError(400, "There is no customer waiting to be sent.")
            bad = [(r["row_no"], p) for r in pending for p in [eb_problems(b, r["email"], json.loads(r["fields"] or "{}"))] if p]
            if bad:
                raise HTTPError(400, f"{len(bad)} customer(s) are not ready - e.g. row {bad[0][0]}: {'; '.join(bad[0][1])}. "
                                     "Fix them (or remove them) first.")
            now = time.time()
            c.execute("UPDATE eb_batches SET status='sending', sent_by=?, started_at=COALESCE(started_at, ?), note=NULL,"
                      " wait_until=NULL WHERE id=?", (user["id"], now, bid))
            audit(c, bid, user, "submit", EB_SEC, None, None, f"send to {len(pending)} customer(s)", at=now)
        eb_start(bid)
        with DB() as c:
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone())})

    def eb_stop(self, user, bid):
        with DB() as c:
            b = self.eb_row(c, user, bid, edit=True)
            if b["status"] == "sending":
                c.execute("UPDATE eb_batches SET status='stopped', note=NULL, wait_until=NULL WHERE id=?", (bid,))
                audit(c, bid, user, "edit", EB_SEC, "status", "sending", "stopped", at=time.time())
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone())})

    def eb_retry(self, user, bid):
        with DB() as c:
            self.eb_row(c, user, bid, edit=True)
            c.execute("UPDATE eb_recipients SET status='pending', error=NULL WHERE batch_id=? AND status='failed'", (bid,))
        self.eb_send(user, bid)

    def eb_cancel(self, user, bid):
        with DB() as c:
            b = self.eb_row(c, user, bid, edit=True)
            if b["status"] == "sending":
                raise HTTPError(409, "Stop the sending first.")
            now = time.time()
            c.execute("UPDATE eb_batches SET cancelled_at=?, cancelled_by=? WHERE id=?", (now, user["id"], bid))
            audit(c, bid, user, "cancel", EB_SEC, at=now)
            self.send_json(200, {"batch": eb_json(c, c.execute("SELECT * FROM eb_batches WHERE id=?", (bid,)).fetchone())})

    # ---- Email templates (Super Admin + Admin)
    def tpl_get(self, user):
        with DB() as c:
            cfg = setting_all(c)
        self.send_json(200, {"tpl": email_tpl(cfg), "defaults": DEFAULT_TPL, "fields": TPL_FIELDS})

    def _tpl_from_body(self):
        b = as_dict(self.body_json().get("tpl"), "tpl")
        tpl = dict(DEFAULT_TPL)
        for k, v in b.items():
            if k in DEFAULT_TPL:
                v = str(v or "").replace("\r\n", "\n")[:1000]
                if not v.strip() and k != "subject_prefix":
                    raise HTTPError(400, "Every text needs something in it (use Reset to default to go back).")
                tpl[k] = v
        return tpl

    def tpl_save(self, user):
        tpl = self._tpl_from_body()
        with DB() as c:
            setting_set(c, "email_tpl", json.dumps({k: v for k, v in tpl.items() if v != DEFAULT_TPL[k]}))
        self.send_json(200, {"tpl": tpl})

    def tpl_preview(self, user):
        tpl = self._tpl_from_body()
        subject, text, body = alert_email(sample_items(), tpl)
        t_subject, t_text, t_body = test_email(tpl, user["name"])
        self.send_json(200, {"subject": subject, "html": body, "text": text, "testSubject": t_subject, "testHtml": t_body})

    # ---- Email alerts (Super Admin: everything; Admin: which alerts are on)
    def email_alert_switches(self, user):
        b = self.body_json()
        levels = [x for x in re.split(r"[,\s]+", str(b.get("expiryDays") or "")) if x]
        if any(not x.isdigit() or not 0 < int(x) <= 365 for x in levels):
            raise HTTPError(400, "COA expiry alert days must be numbers like 30, 15, 5")
        try:
            days = int(b.get("unsettledDays") or 2)
        except (TypeError, ValueError):
            raise HTTPError(400, "Days must be a number.")
        if not 1 <= days <= 60:
            raise HTTPError(400, "Days must be 1-60.")
        with DB() as c:
            cfg = setting_all(c)
            save_people_prefs(c, b.get("people"))
            setting_set(c, "alert_unsettled_days", days)
            setting_set(c, "alert_expiry_days", ",".join(levels) or "30,15,5")
            setting_set(c, "alert_enabled", "1" if b.get("enabled") and email_ready(cfg) else "0")
        self.email_info(user)

    def email_info(self, user):
        with DB() as c:
            cfg = setting_all(c)
            admins = c.execute("SELECT * FROM users WHERE active=1 AND role IN ('superadmin','admin','user')"
                               " ORDER BY CASE role WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, name").fetchall()
        sup = user["role"] == "superadmin"
        self.send_json(200, {
            "canServer": sup, "ready": email_ready(cfg), **{f"on_{k}": alert_on(cfg, k) for k in ALERT_TYPES},
            "host": (cfg.get("mail_host") or "") if sup else "", "port": int(cfg.get("mail_port") or 587),
            "security": cfg.get("mail_security") or "starttls", "user": (cfg.get("mail_user") or "") if sup else "",
            "hasPassword": bool(cfg.get("mail_password")) if sup else False, "from": cfg.get("mail_from") or "",
            "enabled": cfg.get("alert_enabled") == "1", "unsettledDays": int(cfg.get("alert_unsettled_days") or 2),
            "expiryDays": ", ".join(str(x) for x in reversed(expiry_levels(cfg))),
            "recipients": [{"id": r["id"], "name": r["name"], "role": r["role"], "email": r["email"] or "", "prefs": user_prefs(r)}
                           for r in admins],
            "status": json.loads(cfg["alert_status"]) if cfg.get("alert_status") else None, "myEmail": user["email"] or ""})

    def email_save(self, user):
        b = self.body_json()
        host = str(b.get("host") or "").strip()
        if host and not re.fullmatch(r"[A-Za-z0-9.-]+", host):
            raise HTTPError(400, "Mail server must be a name like mail.example.com or smtp.office365.com")
        try:
            port = int(b.get("port") or 587)
            days = int(b.get("unsettledDays") or 2)
        except (TypeError, ValueError):
            raise HTTPError(400, "Port and days must be numbers.")
        if not 1 <= port <= 65535 or not 1 <= days <= 60:
            raise HTTPError(400, "Port must be 1-65535 and days 1-60.")
        sec = b.get("security") if b.get("security") in ("starttls", "ssl", "none") else "starttls"
        levels = [x for x in re.split(r"[,\s]+", str(b.get("expiryDays") or "")) if x]
        if any(not x.isdigit() or not 0 < int(x) <= 365 for x in levels):
            raise HTTPError(400, "COA expiry alert days must be numbers like 30, 15, 5")
        sender = clean_email(b.get("from"))
        with DB() as c:
            setting_set(c, "mail_host", host)
            setting_set(c, "mail_port", port)
            setting_set(c, "mail_security", sec)
            setting_set(c, "mail_user", str(b.get("user") or "").strip())
            if b.get("password"):
                setting_set(c, "mail_password", str(b["password"]))
            if b.get("clearPassword"):
                setting_set(c, "mail_password", "")
            setting_set(c, "mail_from", sender)
            setting_set(c, "alert_unsettled_days", days)
            setting_set(c, "alert_expiry_days", ",".join(levels) or "30,15,5")
            setting_set(c, "alert_enabled", "1" if b.get("enabled") and host and sender else "0")
            save_people_prefs(c, b.get("people"))
        self.email_info(user)

    def email_test(self, user):
        to = clean_email(self.body_json().get("to"))
        if not to:
            raise HTTPError(400, "Type the email address to send the test to.")
        with DB() as c:
            cfg = setting_all(c)
        if not email_ready(cfg):
            raise HTTPError(400, "Save the mail server and From address first.")
        try:
            send_mail(cfg, [to], *test_email(email_tpl(cfg), user["name"]))
        except Exception as e:
            raise HTTPError(400, mail_error_text(e, cfg)[:600])
        self.send_json(200, {"ok": True})

    def email_run_now(self, user):
        self.send_json(200, {"status": alert_run(who=f"by {user['name']}")})

    # ---- AppSheet / Google Sheet sync (Super Admin)
    def appsheet_info(self, user):
        with DB() as c:
            cfg = setting_all(c)
            if not cfg.get("appsheet_secret"):
                setting_set(c, "appsheet_secret", secrets.token_urlsafe(24))
                cfg = setting_all(c)
        self.send_json(200, {"url": cfg.get("appsheet_url") or "", "enabled": cfg.get("appsheet_enabled") == "1",
                             "drive": cfg.get("appsheet_drive", "1") == "1",
                             "access": cfg.get("appsheet_access") or "link", "viewers": viewer_list(cfg),
                             "minutes": int(cfg.get("appsheet_minutes") or 10), "linkBase": cfg.get("appsheet_link_base") or "",
                             "defaultLinkBase": default_link_base(),
                             "status": json.loads(cfg["appsheet_status"]) if cfg.get("appsheet_status") else None,
                             "secretCheck": secret_check(cfg["appsheet_secret"]),
                             "script": APPSHEET_SCRIPT.replace("__SECRET__", cfg["appsheet_secret"])})

    def appsheet_save(self, user):
        b = self.body_json()
        url = str(b.get("url") or "").strip()
        # normal account: /macros/s/<id>/exec   company Google Workspace: /a/macros/<domain>/s/<id>/exec
        if url and not re.fullmatch(r"https://script\.google\.com/(a/macros/[A-Za-z0-9.-]+|macros)/s/[A-Za-z0-9_-]+/exec", url):
            raise HTTPError(400, "The Web app URL must look like https://script.google.com/macros/s/.../exec")
        link = str(b.get("linkBase") or "").strip().rstrip("/")
        if link and not re.fullmatch(r"https?://[^\s/]+(:\d+)?", link):
            raise HTTPError(400, "The website address must look like https://portal.example.com")
        try:
            minutes = max(5, min(1440, int(b.get("minutes") or 10)))
        except (TypeError, ValueError):
            raise HTTPError(400, "Sync every ... minutes must be a number.")
        access = "restricted" if b.get("access") == "restricted" else "link"
        viewers = []
        for v in re.split(r"[\s,;]+", str(b.get("viewers") or "")):
            if v.strip():
                e = clean_email(v)
                if e not in viewers:
                    viewers.append(e)
        if len(viewers) > 100:
            raise HTTPError(400, "At most 100 email addresses.")
        if access == "restricted" and not viewers:
            raise HTTPError(400, "Type at least one email address that may see the Google Sheet (one per line).")
        with DB() as c:
            setting_set(c, "appsheet_url", url)
            setting_set(c, "appsheet_link_base", link)
            setting_set(c, "appsheet_minutes", minutes)
            setting_set(c, "appsheet_enabled", "1" if b.get("enabled") and url else "0")
            setting_set(c, "appsheet_drive", "1" if b.get("drive", True) else "0")
            setting_set(c, "appsheet_access", access)
            setting_set(c, "appsheet_viewers", "\n".join(viewers))
            setting_set(c, "appsheet_hash", "")              # send everything at the next sync
            setting_set(c, "appsheet_access_hash", "")       # apply the access list at the next sync
            if b.get("newSecret"):
                setting_set(c, "appsheet_secret", secrets.token_urlsafe(24))
        self.appsheet_info(user)

    def appsheet_sync_now(self, user):
        self.send_json(200, {"status": appsheet_sync(force=True, who=f"by {user['name']}")})

    # ---- option lists (everyone reads; Super Admin edits)
    def list_options(self, user):
        with DB() as c:
            self.send_json(200, {"options": get_options(c), "locked": LOCKED_OPTIONS})

    def set_options(self, user, key):
        if key not in DEFAULT_OPTIONS:
            raise HTTPError(404, "Unknown list.")
        items = self.body_json().get("items")
        if key == "ports":
            return self.set_ports(items)
        if key == "inspLocations":
            raise HTTPError(400, "Use the Inspection Location Master List page.")
        if key in ("hrRoles", "hrOutlets", "hrDepartments", "hrPosDept", "hrPosParent"):
            raise HTTPError(400, "Use the HR Setting page.")
        if not isinstance(items, list) or len(items) > 200:
            raise HTTPError(400, "Invalid list.")
        clean, seen = [], set()
        for v in items:
            if not isinstance(v, str):
                raise HTTPError(400, "Invalid choice.")
            v = v.strip()[:100]
            if v and v.lower() not in seen:
                seen.add(v.lower())
                clean.append(v)
        missing = [v for v in LOCKED_OPTIONS.get(key, []) if v not in clean]
        if missing:
            raise HTTPError(400, f"These choices are used by the system and cannot be removed: {', '.join(missing)}")
        with DB() as c:
            c.execute("INSERT INTO option_lists(list_key, items) VALUES(?,?)"
                      " ON CONFLICT(list_key) DO UPDATE SET items=excluded.items", (key, json.dumps(clean)))
        self.send_json(200, {"items": clean})

    def set_locations(self, user):
        items = self.body_json().get("items")
        if not isinstance(items, list) or len(items) > 200:
            raise HTTPError(400, "Invalid location list.")
        clean, seen = [], set()
        for it in items:
            if not isinstance(it, dict):
                raise HTTPError(400, "Invalid location.")
            loc = {k: str(it.get(k) or "").strip()[:200] for k in LOCATION_FIELDS}
            for k in LOCATION_FIELDS:
                if not k.startswith("email"):
                    loc[k] = loc[k].upper()
            if not loc["name"]:
                raise HTTPError(400, "Every location needs a Warehouse / Location Name.")
            if loc["name"] in seen:
                raise HTTPError(400, f"Location {loc['name']} is listed twice.")
            seen.add(loc["name"])
            clean.append(loc)
        with DB() as c:
            c.execute("INSERT INTO option_lists(list_key, items) VALUES('inspLocations', ?)"
                      " ON CONFLICT(list_key) DO UPDATE SET items=excluded.items", (json.dumps(clean),))
        self.send_json(200, {"items": clean})

    def set_ports(self, items):
        if not isinstance(items, list) or len(items) > 2000:
            raise HTTPError(400, "Invalid port list.")
        clean, seen = [], set()
        for it in items:
            if not isinstance(it, dict):
                raise HTTPError(400, "Invalid port.")
            code = str(it.get("code") or "").strip().upper()
            name = str(it.get("name") or "").strip()[:100]
            country = str(it.get("country") or "").strip()[:60]
            if not re.fullmatch(r"[A-Z0-9]{2,10}", code):
                raise HTTPError(400, f"Port code '{code}' is not valid (2-10 letters/numbers, e.g. CNNGB).")
            if not name or not country:
                raise HTTPError(400, f"Port {code} needs a name and a country.")
            if code in seen:
                raise HTTPError(400, f"Port code {code} is listed twice.")
            seen.add(code)
            clean.append({"code": code, "name": name, "country": country})
        with DB() as c:
            c.execute("INSERT INTO option_lists(list_key, items) VALUES('ports', ?)"
                      " ON CONFLICT(list_key) DO UPDATE SET items=excluded.items", (json.dumps(clean),))
        self.send_json(200, {"items": clean})

    # ---- audit trail (Super Admin, Admin, Viewer)
    def audit_list(self, user):
        with DB() as c:
            nm = names(c)
            stats = {r["app_id"]: r for r in c.execute(
                "SELECT app_id, COUNT(*) n, MAX(at) last_at FROM audit_log GROUP BY app_id")}
            last_by = {r["app_id"]: r["user_id"] for r in c.execute(
                "SELECT a.app_id, a.user_id FROM audit_log a JOIN (SELECT app_id, MAX(id) mid FROM audit_log GROUP BY app_id) m"
                " ON a.id = m.mid")}
            out = []
            for r in c.execute("SELECT * FROM apps ORDER BY form_no DESC"):
                d = json.loads(r["data"])
                st = stats.get(r["id"])
                out.append({"id": r["id"], "formNo": r["form_no"], "equipmentName": d.get("equipmentName", ""),
                            "companyModel": d.get("companyModel", ""), "stStatus": d.get("stStatus", ""),
                            "cancelled": bool(r["cancelled_at"]), "createdBy": nm.get(r["created_by"], ""),
                            "createdAt": r["created_at"], "changes": st["n"] if st else 0,
                            "lastAt": st["last_at"] if st else None, "lastBy": nm.get(last_by.get(r["id"]), "")})
        self.send_json(200, {"docs": out})

    def audit_doc(self, user, app_id):
        with DB() as c:
            r = c.execute("SELECT * FROM apps WHERE id=?", (app_id,)).fetchone()
            if not r:
                raise HTTPError(404, "Application not found.")
            nm = names(c)
            d = json.loads(r["data"])
            rows = c.execute("SELECT * FROM audit_log WHERE app_id=? ORDER BY at DESC, id DESC", (app_id,)).fetchall()
            entries = [{"id": e["id"], "at": e["at"], "by": nm.get(e["user_id"], ""), "action": e["action"],
                        "section": e["section"], "field": e["field"], "old": e["old_value"], "new": e["new_value"]}
                       for e in rows]
        self.send_json(200, {"doc": {"id": r["id"], "formNo": r["form_no"], "equipmentName": d.get("equipmentName", ""),
                                     "companyModel": d.get("companyModel", ""), "cancelled": bool(r["cancelled_at"]),
                                     "createdBy": nm.get(r["created_by"], ""), "createdAt": r["created_at"]},
                             "entries": entries})

    # ---- files
    def upload(self, user, app_id):
        field = self.query.get("field", "")
        name = os.path.basename((self.query.get("name") or "file").replace("\\", "/")).strip()[:200] or "file"
        note = (self.query.get("note") or "").strip()[:300].upper()
        sec = FILE_SEC.get(field)
        if not sec:
            raise HTTPError(400, "Invalid field.")
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise HTTPError(413, f"File too large (max {MAX_UPLOAD // 1048576} MB).")
        ctype = (self.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip()[:100]
        with DB() as c:
            row = load_row(c, user, app_id)
            if not perms_for(c, user, app_id)[sec]["edit"]:
                raise HTTPError(403, f"You cannot upload files to section {sec}.")
            rel = storage_path(row["form_no"], sec, name)
            path = os.path.join(UPLOADS, rel)
            open(path + ".part", "wb").close()        # reserve the name while the file arrives
        fid = new_id()
        remaining = n
        with open(path + ".part", "wb") as out:
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                out.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(path + ".part")
            raise HTTPError(400, "Upload interrupted.")
        os.replace(path + ".part", path)
        now = time.time()
        with DB() as c:
            c.execute("INSERT INTO files(id, app_id, field, name, type, size, uploaded_by, uploaded_at, note, path)"
                      " VALUES(?,?,?,?,?,?,?,?,?,?)", (fid, app_id, field, name, ctype, n, user["id"], now, note or None, rel))
            audit(c, app_id, user, "file_upload", sec, field, None, f"{name} – {note}" if note else name, at=now)
            c.execute("UPDATE apps SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, app_id))
            add_contributor(c, app_id, user["id"])
            save_version(c, "coa", app_id, user, "edit", now)
            f = c.execute("SELECT * FROM files WHERE id=?", (fid,)).fetchone()
            self.send_json(200, {"file": file_json(f, names(c))})

    def file_row(self, c, user, fid, need_edit=False):
        f = c.execute("SELECT * FROM files WHERE id=? AND removed_at IS NULL", (fid,)).fetchone()
        if not f:
            raise HTTPError(404, "File not found.")
        load_row(c, user, f["app_id"])
        p = perms_for(c, user, f["app_id"]).get(FILE_SEC.get(f["field"]), {})
        if not p.get("view"):
            raise HTTPError(404, "File not found.")
        if need_edit and not p.get("edit"):
            raise HTTPError(403, "You cannot remove files from this section.")
        return f

    def download(self, user, fid):
        with DB() as c:
            f = self.file_row(c, user, fid)
        path = file_disk_path(f)
        if not os.path.isfile(path):
            raise HTTPError(404, "File not found.")
        inline = f["type"] in INLINE_TYPES and self.query.get("dl") != "1"
        quoted = urllib.parse.quote(f["name"])
        self.send_response(200)
        self.send_header("Content-Type", f["type"] if inline else "application/octet-stream")
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.send_header("Content-Disposition", f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quoted}")
        self.send_header("Cache-Control", "private, no-store")
        self.common_headers()
        self.end_headers()
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def delete_file(self, user, fid):
        with DB() as c:
            f = self.file_row(c, user, fid, need_edit=True)
            c.execute("UPDATE files SET removed_at=?, removed_by=? WHERE id=?", (time.time(), user["id"], fid))
            audit(c, f["app_id"], user, "file_remove", FILE_SEC.get(f["field"]), f["field"],
                  f"{f['name']} – {f['note']}" if f["note"] else f["name"], None)
            c.execute("UPDATE apps SET updated_by=?, updated_at=? WHERE id=?", (user["id"], time.time(), f["app_id"]))
            save_version(c, "coa", f["app_id"], user, "edit")
        self.send_json(200, {"ok": True})

    # ---- SIRIM Inspection Form
    def send_stored_file(self, f, frame=False):
        path = file_disk_path(f)
        if not os.path.isfile(path):
            raise HTTPError(404, "File not found.")
        inline = f["type"] in INLINE_TYPES and self.query.get("dl") != "1"
        self.send_response(200)
        self.send_header("Content-Type", f["type"] if inline else "application/octet-stream")
        self.send_header("Content-Length", str(os.path.getsize(path)))
        self.send_header("Content-Disposition",
                         f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{urllib.parse.quote(f['name'])}")
        self.send_header("Cache-Control", "private, no-store")
        self.common_headers(frame)
        self.end_headers()
        with open(path, "rb") as fh:
            while True:
                chunk = fh.read(65536)
                if not chunk:
                    break
                self.wfile.write(chunk)

    def sirim_row(self, c, user, sid):
        row = c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone()
        if not row or not sirim_perms(c, user, row)[0]["view"]:
            raise HTTPError(404, "Consignment test form not found.")
        return row

    def sirim_list(self, user):
        with DB() as c:
            nm = names(c)
            forms = [sirim_json(c, r, user, nm) for r in c.execute("SELECT * FROM sirim").fetchall()]
            self.send_json(200, {"forms": [f for f in forms if f["perms"]["view"]],
                                 "canCreate": sirim_access(c, user)["create"]})

    def sirim_get(self, user, sid):
        with DB() as c:
            self.send_json(200, {"form": sirim_json(c, self.sirim_row(c, user, sid), user)})

    def sirim_create(self, user):
        now = time.time()
        with DB() as c:
            if not sirim_access(c, user)["create"]:
                raise HTTPError(403, "You don't have permission to create new Consignment Test forms.")
            sid = new_id()
            c.execute("INSERT INTO sirim(id, form_no, data, created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?,?)",
                      (sid, next_sirim_no(c), "{}", user["id"], now, user["id"], now))
            audit(c, sid, user, "create", at=now)
            save_version(c, "sirim", sid, user, "create", now)
            self.send_json(200, {"form": sirim_json(c, c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone(), user)})

    def sirim_update(self, user, sid):
        b = self.body_json()
        with DB() as c:
            row = self.sirim_row(c, user, sid)
            if row["cancelled_at"]:
                raise HTTPError(403, "This form has been cancelled and can no longer be changed.")
            p, _ = sirim_perms(c, user, row)
            if not p["edit"]:
                raise HTTPError(403, "You have view-only access." if p.get("viewOnly") else "This form is submitted and locked.")
            data, now = json.loads(row["data"]), time.time()
            base_data = as_dict(as_dict(b.get("base"), "base").get("data"), "base.data")
            conflicts, nm = [], None
            norm = lambda k, v: v if k in SIRIM_DATE_FIELDS else v.upper()
            for k, v in as_dict(b.get("data"), "data").items():
                if k not in SIRIM_FIELDS:
                    raise HTTPError(400, "Unknown field.")
                v = norm(k, clean_value(v))
                bv = norm(k, clean_value(base_data[k])) if k in base_data else None
                if is_conflict(data.get(k, ""), bv, v):
                    nm = nm or names(c)
                    by, at = last_change(c, sid, k, nm)
                    conflicts.append({"kind": "data", "key": k, "theirs": data.get(k, ""), "yours": v, "by": by, "at": at})
                    continue
                if data.get(k, "") != v:
                    audit(c, sid, user, "edit", SIRIM_SEC, k, data.get(k, ""), v, at=now)
                data[k] = v
            c.execute("UPDATE sirim SET data=?, version=version+1, updated_by=?, updated_at=? WHERE id=?",
                      (json.dumps(data), user["id"], now, sid))
            save_version(c, "sirim", sid, user, "edit", now)
            self.send_json(200, {"form": sirim_json(c, c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone(), user),
                                 "conflicts": conflicts})

    def sirim_coa_list(self, user):
        """COA Applications whose COA No. has been submitted - to choose from in the Consignment Test form."""
        sec = DATA_SEC.get("coaNo")
        with DB() as c:
            if not sirim_access(c, user)["edit"] and not is_admin(user):
                raise HTTPError(403, "You don't have permission to fill this form.")
            done = {r["app_id"] for r in c.execute("SELECT app_id FROM section_status WHERE section=? AND status='submitted'", (sec,))}
            out = []
            for r in c.execute("SELECT id, form_no, data FROM apps WHERE cancelled_at IS NULL ORDER BY created_at DESC"):
                d = json.loads(r["data"])
                if r["id"] not in done:
                    continue
                for kind, coa_no, exp in coas_of(d):
                    if coa_no.strip():
                        out.append({"coaNo": coa_no.strip().upper(), "formNo": r["form_no"], "product": d.get("equipmentName", ""),
                                    "model": d.get("companyModel", "") + ("" if kind == "ST" else " (eCOS)"), "expiry": exp})
            self.send_json(200, {"items": out})

    def sirim_coa_lookup(self, user):
        coa_no = (self.query.get("coaNo") or "").strip().upper()
        if not coa_no:
            raise HTTPError(400, "Type the COA No. first.")
        with DB() as c:
            if not sirim_access(c, user)["edit"] and not is_admin(user):
                raise HTTPError(403, "You don't have permission to fill this form.")
            found = None
            for r in c.execute("SELECT form_no, data FROM apps WHERE cancelled_at IS NULL ORDER BY created_at DESC"):
                d = json.loads(r["data"])
                if (d.get("coaNo") or "").strip().upper() == coa_no:
                    found = (r["form_no"], d)
                    break
                if (d.get("ecosCoaNo") or "").strip().upper() == coa_no:      # the eCOS COA of the form
                    found = (r["form_no"], {**d, "coaExpiry": d.get("ecosCoaExpiry", "")})
                    break
            if not found:
                raise HTTPError(404, f"No COA Application found with COA No. {coa_no}.")
            vals = {ct: str(found[1].get(k) or "") for k, ct in COA_TO_CT.items() if found[1].get(k)}
            vals.pop("ctPower", None)
            vals.update(split_power_current(found[1].get("ratedPower")))
            self.send_json(200, {"formNo": found[0], "data": vals})

    def sirim_action(self, user, sid, action):
        with DB() as c:
            row = self.sirim_row(c, user, sid)
            if not sirim_perms(c, user, row)[0].get(action):
                raise HTTPError(403, {"submit": "You cannot submit this form.",
                                      "resubmit": "No resaves left. Ask an administrator to reopen it.",
                                      "reopen": "Only administrators can reopen a submitted form."}[action])
            now = time.time()
            if action == "submit":
                problems = quantity_problems(json.loads(row["data"]))
                if problems:
                    raise HTTPError(400, "Quantity does not match the serial numbers: " + " ".join(problems))
                record_submit(c, sid, SIRIM_SEC, user, now)
            elif action == "resubmit":
                c.execute("UPDATE person_status SET status='draft' WHERE app_id=? AND section=? AND user_id=?", (sid, SIRIM_SEC, user["id"]))
                refresh_shared_status(c, sid, SIRIM_SEC)
            else:
                c.execute("UPDATE person_status SET status='draft' WHERE app_id=? AND section=?", (sid, SIRIM_SEC))
                refresh_shared_status(c, sid, SIRIM_SEC)
            c.execute("INSERT INTO section_log(app_id, section, user_id, action, at) VALUES(?,?,?,?,?)", (sid, SIRIM_SEC, user["id"], action, now))
            audit(c, sid, user, action, SIRIM_SEC, at=now)
            c.execute("UPDATE sirim SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, sid))
            save_version(c, "sirim", sid, user, action, now)
            self.send_json(200, {"form": sirim_json(c, c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone(), user)})

    def sirim_cancel(self, user, sid):
        reason = clean_value(self.body_json().get("reason")).strip()[:500]
        if not reason:
            raise HTTPError(400, "Please give a reason for cancelling.")
        with DB() as c:
            row = self.sirim_row(c, user, sid)
            if row["cancelled_at"]:
                raise HTTPError(409, "This form is already cancelled.")
            now = time.time()
            c.execute("UPDATE sirim SET cancelled_at=?, cancelled_by=?, cancel_reason=?, updated_by=?, updated_at=? WHERE id=?",
                      (now, user["id"], reason, user["id"], now, sid))
            audit(c, sid, user, "cancel", new=reason, at=now)
            save_version(c, "sirim", sid, user, "cancel", now)
            self.send_json(200, {"form": sirim_json(c, c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone(), user)})

    def sirim_delete(self, user, sid):
        """Super Admin: delete a Draft made by mistake - the form, its files and its history are removed completely.
        The form number has to be typed to confirm.  One line stays in the audit log (who deleted which form)."""
        typed = str(self.body_json().get("confirm") or "").strip().upper()
        with DB() as c:
            row = c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone()
            if not row:
                raise HTTPError(404, "Form not found.")
            if typed != row["form_no"].upper():
                raise HTTPError(400, f"Type the form number {row['form_no']} to confirm.")
            if not sirim_never_submitted(c, sid):
                raise HTTPError(409, "Only a Draft that was never submitted can be deleted - use Cancel Form instead.")
            files = c.execute("SELECT * FROM sirim_files WHERE sirim_id=?", (sid,)).fetchall()
            paths = [file_disk_path(f) for f in files]
            for f in files:
                c.execute("DELETE FROM drive_files WHERE file_id=?", (f["id"],))
            c.execute("DELETE FROM sirim_files WHERE sirim_id=?", (sid,))
            for tbl, col in (("section_status", "app_id"), ("section_log", "app_id"), ("person_status", "app_id"),
                             ("contributors", "app_id"), ("audit_log", "app_id"), ("alert_log", "doc_id")):
                c.execute(f"DELETE FROM {tbl} WHERE {col}=?", (sid,))
            c.execute("DELETE FROM doc_versions WHERE program='sirim' AND doc_id=?", (sid,))
            c.execute("DELETE FROM save_events WHERE program='sirim' AND doc_id=?", (sid,))
            c.execute("DELETE FROM sirim WHERE id=?", (sid,))
            audit(c, "sirim-deleted", user, "delete", SIRIM_SEC, row["form_no"], None,
                  f"{row['form_no']} deleted (Draft made by mistake, {len(files)} file(s))", at=time.time())
        for p in paths:                                       # the uploaded files of the form
            try:
                if p and os.path.isfile(p):
                    os.remove(p)
            except OSError as e:
                print(f"Could not remove {p}: {e}")
        folder = os.path.join(UPLOADS, safe_name(row["form_no"], "form", True))
        for root, dirs, fl in sorted(os.walk(folder), key=lambda x: -len(x[0])):   # empty folders left behind
            if not fl and not os.listdir(root):
                try:
                    os.rmdir(root)
                except OSError:
                    pass
        self.send_json(200, {"ok": True, "formNo": row["form_no"]})

    def sirim_upload(self, user, sid):
        field = self.query.get("field", "")
        if field not in SIRIM_DOCS:
            raise HTTPError(400, "Invalid field.")
        name = os.path.basename((self.query.get("name") or "file").replace("\\", "/")).strip()[:200] or "file"
        n = int(self.headers.get("Content-Length") or 0)
        if n > MAX_UPLOAD:
            raise HTTPError(413, f"File too large (max {MAX_UPLOAD // 1048576} MB).")
        ctype = (self.headers.get("Content-Type") or "application/octet-stream").split(";")[0].strip()[:100]
        with DB() as c:
            row = self.sirim_row(c, user, sid)
            if not sirim_perms(c, user, row)[0]["edit"]:
                raise HTTPError(403, "You cannot upload files to this form.")
            rel = sirim_storage_path(row["form_no"], SIRIM_DOCS[field], name)
            path = os.path.join(UPLOADS, rel)
            open(path + ".part", "wb").close()
        fid, remaining = new_id(), n
        with open(path + ".part", "wb") as out:
            while remaining > 0:
                chunk = self.rfile.read(min(65536, remaining))
                if not chunk:
                    break
                out.write(chunk)
                remaining -= len(chunk)
        if remaining:
            os.remove(path + ".part")
            raise HTTPError(400, "Upload interrupted.")
        os.replace(path + ".part", path)
        now = time.time()
        with DB() as c:
            c.execute("INSERT INTO sirim_files(id, sirim_id, field, name, type, size, uploaded_by, uploaded_at, path)"
                      " VALUES(?,?,?,?,?,?,?,?,?)", (fid, sid, field, name, ctype, n, user["id"], now, rel))
            audit(c, sid, user, "file_upload", SIRIM_SEC, field, None, name, at=now)
            if field == "serialFile":
                sirim_refresh_serials(c, sid, user, now)
            c.execute("UPDATE sirim SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, sid))
            save_version(c, "sirim", sid, user, "edit", now)
            self.send_json(200, {"form": sirim_json(c, c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone(), user)})

    def sirim_file(self, c, user, fid, need_edit=False):
        f = c.execute("SELECT * FROM sirim_files WHERE id=? AND removed_at IS NULL", (fid,)).fetchone()
        if not f:
            raise HTTPError(404, "File not found.")
        row = self.sirim_row(c, user, f["sirim_id"])
        if need_edit and not sirim_perms(c, user, row)[0]["edit"]:
            raise HTTPError(403, "You cannot remove files from this form.")
        return f

    def sirim_download(self, user, fid):
        with DB() as c:
            f = self.sirim_file(c, user, fid)
        self.send_stored_file(f)

    def sirim_delete_file(self, user, fid):
        now = time.time()
        with DB() as c:
            f = self.sirim_file(c, user, fid, need_edit=True)
            c.execute("UPDATE sirim_files SET removed_at=?, removed_by=? WHERE id=?", (now, user["id"], fid))
            audit(c, f["sirim_id"], user, "file_remove", SIRIM_SEC, f["field"], f["name"], None, at=now)
            if f["field"] == "serialFile":
                sirim_refresh_serials(c, f["sirim_id"], user, now)
            c.execute("UPDATE sirim SET updated_by=?, updated_at=? WHERE id=?", (user["id"], now, f["sirim_id"]))
            save_version(c, "sirim", f["sirim_id"], user, "edit", now)
            self.send_json(200, {"form": sirim_json(c, c.execute("SELECT * FROM sirim WHERE id=?", (f["sirim_id"],)).fetchone(), user)})

    def sirim_audit_list(self, user):
        with DB() as c:
            nm = names(c)
            stats = {r["app_id"]: r for r in c.execute("SELECT app_id, COUNT(*) n, MAX(at) last_at FROM audit_log GROUP BY app_id")}
            out = []
            for r in c.execute("SELECT * FROM sirim ORDER BY form_no DESC"):
                d, st = json.loads(r["data"]), stats.get(r["id"])
                out.append({"id": r["id"], "formNo": r["form_no"], "coaNo": d.get("coaNo", ""), "cancelled": bool(r["cancelled_at"]),
                            "createdBy": nm.get(r["created_by"], ""), "createdAt": r["created_at"],
                            "changes": st["n"] if st else 0, "lastAt": st["last_at"] if st else None})
        self.send_json(200, {"docs": out})

    def sirim_audit(self, user, sid):
        with DB() as c:
            r = c.execute("SELECT * FROM sirim WHERE id=?", (sid,)).fetchone()
            if not r:
                raise HTTPError(404, "Consignment test form not found.")
            nm, d = names(c), json.loads(r["data"])
            entries = [{"id": e["id"], "at": e["at"], "by": nm.get(e["user_id"], ""), "action": e["action"], "section": e["section"],
                        "field": e["field"], "old": e["old_value"], "new": e["new_value"]}
                       for e in c.execute("SELECT * FROM audit_log WHERE app_id=? ORDER BY at DESC, id DESC", (sid,))]
        self.send_json(200, {"doc": {"id": r["id"], "formNo": r["form_no"], "coaNo": d.get("coaNo", ""),
                                     "cancelled": bool(r["cancelled_at"]), "createdBy": nm.get(r["created_by"], ""),
                                     "createdAt": r["created_at"]}, "entries": entries})

    # ---- document versions (Super Admin, Admin, Viewer)
    def version_doc(self, c, program, doc_id):
        table = "apps" if program == "coa" else "sirim"
        r = c.execute(f"SELECT * FROM {table} WHERE id=?", (doc_id,)).fetchone()
        if not r:
            raise HTTPError(404, "Document not found.")
        d = json.loads(r["data"])
        return {"id": r["id"], "formNo": r["form_no"], "program": program, "cancelled": bool(r["cancelled_at"]),
                "title": d.get("equipmentName", "") if program == "coa" else (("COA No. " + d["coaNo"]) if d.get("coaNo") else "")}

    def list_versions(self, user, program, doc_id):
        with DB() as c:
            doc, nm = self.version_doc(c, program, doc_id), names(c)
            rows = c.execute("SELECT id, version_no, at, user_id, action, changes FROM doc_versions"
                             " WHERE program=? AND doc_id=? ORDER BY version_no DESC", (program, doc_id)).fetchall()
            out = [{"no": r["version_no"], "at": r["at"], "by": nm.get(r["user_id"], ""), "action": r["action"],
                    "changes": json.loads(r["changes"])} for r in rows]
        self.send_json(200, {"doc": doc, "versions": out})

    def version_pdf_file(self, user, program, doc_id, no):
        with DB() as c:
            self.version_doc(c, program, doc_id)
            r = c.execute("SELECT * FROM doc_versions WHERE program=? AND doc_id=? AND version_no=?", (program, doc_id, int(no))).fetchone()
            if not r:
                raise HTTPError(404, "Version not found.")
            data = version_pdf(c, r)
            form = json.loads(r["snapshot"]).get("formNo") or "document"
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Content-Disposition", f"inline; filename*=UTF-8''{urllib.parse.quote(f'{form} - version {no}.pdf')}")
        self.send_header("Cache-Control", "private, no-store")
        self.common_headers()
        self.end_headers()
        self.wfile.write(data)

    def get_version(self, user, program, doc_id, no):
        with DB() as c:
            self.version_doc(c, program, doc_id)
            r = c.execute("SELECT * FROM doc_versions WHERE program=? AND doc_id=? AND version_no=?",
                          (program, doc_id, int(no))).fetchone()
            if not r:
                raise HTTPError(404, "Version not found.")
            snap = json.loads(r["snapshot"])
            # versions saved by an older release only remember file names - find the stored file for each name
            table, col = ("files", "app_id") if program == "coa" else ("sirim_files", "sirim_id")
            for field, items in (snap.get("files") or {}).items():
                fixed = []
                for x in items:
                    if isinstance(x, str):
                        name, _, note = x.partition(" – ")
                        f = c.execute(f"SELECT * FROM {table} WHERE {col}=? AND field=? AND name=? AND uploaded_at<=? "
                                      "ORDER BY uploaded_at DESC LIMIT 1", (doc_id, field, name, r["at"] + 1)).fetchone()
                        x = {"id": f["id"], "name": f["name"], "note": note, "type": f["type"]} if f else {"name": x}
                    fixed.append(x)
                snap["files"][field] = fixed
            self.send_json(200, {"version": {"no": r["version_no"], "at": r["at"], "by": names(c).get(r["user_id"], ""),
                                             "action": r["action"], "snapshot": snap}})

    def version_file(self, user, program, doc_id, fid):
        with DB() as c:
            self.version_doc(c, program, doc_id)
            f = (c.execute("SELECT * FROM files WHERE id=? AND app_id=?", (fid, doc_id)) if program == "coa" else
                 c.execute("SELECT * FROM sirim_files WHERE id=? AND sirim_id=?", (fid, doc_id))).fetchone()
            if not f:
                raise HTTPError(404, "File not found.")
        self.send_stored_file(f)

    # ---- user management (Super Admin)
    def list_users(self, user):
        with DB() as c:
            rows = c.execute("SELECT * FROM users ORDER BY name COLLATE NOCASE").fetchall()
            sig = {r[0]: r[1] for r in c.execute("SELECT user_id, updated_at FROM user_signatures")}
        self.send_json(200, {"users": [{**user_json(r), "signatureAt": sig.get(r["id"])} for r in rows]})

    # ------------------------------------------------------------ e-signature of a person (Users > Signature, or "My signature")
    def sig_target(self, user, uid):
        uid = int(uid) if uid not in (None, "me") else user["id"]
        if uid != user["id"] and user["role"] != "superadmin":
            raise HTTPError(403, "Only the Super Admin can change another person's signature.")
        return uid

    def sig_get(self, user, uid=None):
        """The signature as a picture (for <img>), or 404 when there is none."""
        import base64
        uid = int(uid) if uid else user["id"]
        if uid != user["id"] and user["role"] not in ("superadmin", "admin"):
            raise HTTPError(403, "Not allowed.")
        with DB() as c:
            r = c.execute("SELECT image FROM user_signatures WHERE user_id=?", (uid,)).fetchone()
        if not r:
            raise HTTPError(404, "No signature yet.")
        head, data = r["image"].split(",", 1)
        raw = base64.b64decode(data)
        self.send_response(200)
        self.send_header("Content-Type", "image/png" if "png" in head else "image/jpeg")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "private, no-store")
        self.common_headers()
        self.end_headers()
        self.wfile.write(raw)

    def sig_put(self, user, uid=None):
        uid = self.sig_target(user, uid)
        img = memo_signature(self.body_json().get("signature"))
        now = time.time()
        with DB() as c:
            u = c.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()
            if not u:
                raise HTTPError(404, "User not found.")
            c.execute("INSERT INTO user_signatures(user_id, image, updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET"
                      " image=excluded.image, updated_at=excluded.updated_at", (uid, img, now))
            audit(c, "signatures", user, "edit", "USERS", u["name"], None, "signature saved", at=now)
        self.send_json(200, {"ok": True, "signatureAt": now})

    def sig_delete(self, user, uid=None):
        uid = self.sig_target(user, uid)
        with DB() as c:
            u = c.execute("SELECT name FROM users WHERE id=?", (uid,)).fetchone()
            if not u:
                raise HTTPError(404, "User not found.")
            c.execute("DELETE FROM user_signatures WHERE user_id=?", (uid,))
            audit(c, "signatures", user, "edit", "USERS", u["name"], "signature", "signature removed", at=time.time())
        self.send_json(200, {"ok": True})

    def create_user(self, user):
        b = self.body_json()
        username, name, role = (b.get("username") or "").strip(), (b.get("name") or "").strip(), b.get("role") or "user"
        validate_username(username)
        if role not in ROLES:
            raise HTTPError(400, "Invalid role.")
        validate_pw(b.get("password"))
        with DB() as c:
            if c.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE", (username,)).fetchone():
                raise HTTPError(409, "That username is already taken.")
            cur = c.execute("INSERT INTO users(username,name,role,pw_hash,created_at,must_change_pw,email) VALUES(?,?,?,?,?,1,?)",
                            (username, name or username, role, hash_pw(b["password"]), time.time(), clean_email(b.get("email"))))
            u = c.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
        self.send_json(200, {"user": user_json(u)})

    def update_user(self, user, uid):
        uid = int(uid)
        b = self.body_json()
        with DB() as c:
            u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
            if not u:
                raise HTTPError(404, "User not found.")
            name = (b.get("name") or u["name"]).strip()
            role = b.get("role") or u["role"]
            active = 1 if b.get("active", bool(u["active"])) else 0
            if role not in ROLES:
                raise HTTPError(400, "Invalid role.")
            if u["role"] == "superadmin" and (role != "superadmin" or not active):
                n = c.execute("SELECT COUNT(*) FROM users WHERE role='superadmin' AND active=1").fetchone()[0]
                if n <= 1:
                    raise HTTPError(400, "There must be at least one active Super Admin.")
            email = clean_email(b["email"]) if "email" in b else (u["email"] or "")
            new_un = str(b.get("username") or u["username"]).strip()
            if new_un != u["username"]:                              # e.g. lkh002 -> LKH002 (same as the Staff Code)
                validate_username(new_un)
                if c.execute("SELECT 1 FROM users WHERE username=? COLLATE NOCASE AND id<>?", (new_un, uid)).fetchone():
                    raise HTTPError(409, f"Another login already uses the username {new_un}.")
                c.execute("UPDATE users SET username=? WHERE id=?", (new_un, uid))
                audit(c, "users", user, "edit", "USERS", u["name"], u["username"], f"username: {new_un}", at=time.time())
            c.execute("UPDATE users SET name=?, role=?, active=?, email=? WHERE id=?", (name, role, active, email, uid))
            if b.get("password"):
                validate_pw(b["password"])
                # a password set by someone else must be changed by the owner at next sign-in
                c.execute("UPDATE users SET pw_hash=?, must_change_pw=? WHERE id=?",
                          (hash_pw(b["password"]), 0 if uid == user["id"] else 1, uid))
            if b.get("password") or not active:
                c.execute("DELETE FROM sessions WHERE user_id=?", (uid,))
            u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        self.send_json(200, {"user": user_json(u)})

    # ---- section access (Super Admin)
    def get_access(self, user):
        with DB() as c:
            sync_roles(c)
            users = [{**user_json(r), "accessRole": r["access_role"]} for r in c.execute("SELECT * FROM users ORDER BY name COLLATE NOCASE")]
            roles = [{"id": r["id"], "name": r["name"], "rights": flat_to_body(body_to_flat(json.loads(r["rights"] or "{}"))),
                      "members": [u["id"] for u in users if u["accessRole"] == r["id"] and u["role"] in ("admin", "user")]}
                     for r in c.execute("SELECT * FROM access_roles ORDER BY name COLLATE NOCASE")]
            access = {}
            for r in c.execute("SELECT * FROM section_access"):
                access.setdefault(str(r["user_id"]), {})[r["section"]] = {
                    "view": bool(r["can_view"]), "edit": bool(r["can_edit"]), "check": bool(r["can_check"]),
                    "resubmits": r["resubmits"]}
            create = {str(r["user_id"]): bool(r["can_create"])
                      for r in c.execute("SELECT * FROM program_access WHERE program='coa'")}
            sirim_create = {str(r["user_id"]): bool(r["can_create"])
                            for r in c.execute("SELECT * FROM program_access WHERE program='sirim'")}
            opts = get_options(c)
        pd = {k.lower(): v for k, v in opts["hrPosDept"].items()}
        pp = {k.lower(): v for k, v in opts["hrPosParent"].items()}
        for r in roles:
            r["department"] = pd.get(r["name"].lower(), "")
            r["parent"] = pp.get(r["name"].lower(), "")
        sections = [{"id": s, "name": v["name"]} for s, v in SECTIONS.items()]
        self.send_json(200, {"users": users, "access": access, "create": create, "sirimCreate": sirim_create, "sections": sections,
                             "roles": roles, "departments": opts["hrDepartments"]})

    def set_user_access(self, user, uid):
        """Save one person's rights: {"create": bool, "sections": {"A": {edit, check, resubmits}, ...}}"""
        uid = int(uid)
        body = self.body_json()
        with DB() as c:
            u = c.execute("SELECT role FROM users WHERE id=?", (uid,)).fetchone()
            if not u:
                raise HTTPError(404, "User not found.")
            if u["role"] not in ("admin", "user"):
                raise HTTPError(400, "Section access only applies to Admin and User accounts.")
            write_access(c, uid, body)
        self.get_access(user)

    # ---- Access Roles: a named set of rights. Changing a role changes ONLY what was changed for its people -
    #      each person's own other settings stay as they are.
    def role_create(self, user):
        b = self.body_json()
        name = re.sub(r"\s+", " ", str(b.get("name") or "")).strip()[:80]
        if not name:
            raise HTTPError(400, "Type a name for the position.")
        rights = flat_to_body(body_to_flat(b.get("rights") or {}))
        now = time.time()
        with DB() as c:
            if c.execute("SELECT 1 FROM access_roles WHERE name=?", (name,)).fetchone():
                raise HTTPError(409, f"A position called {name} already exists.")
            c.execute("INSERT INTO access_roles(name, rights, created_by, created_at, updated_by, updated_at) VALUES(?,?,?,?,?,?)",
                      (name, json.dumps(rights), user["id"], now, user["id"], now))
            rid = c.execute("SELECT id FROM access_roles WHERE name=?", (name,)).fetchone()[0]
            sync_roles(c)                                        # also added to the staff Role list
            if "department" in b:
                set_pos_dept(c, name, b.get("department"))
            if b.get("parent"):
                set_pos_parent(c, name, b.get("parent"))
            audit(c, "access-roles", user, "create", "ACCESS", name, None, "role created", at=now)
        self.send_json(200, {"id": rid})

    def role_update(self, user, rid):
        """Save a role; the rights that changed are given to (or taken from) every person with this role."""
        b = self.body_json()
        now = time.time()
        with DB() as c:
            role = c.execute("SELECT * FROM access_roles WHERE id=?", (int(rid),)).fetchone()
            if not role:
                raise HTTPError(404, "Position not found.")
            name = re.sub(r"\s+", " ", str(b.get("name") or role["name"])).strip()[:80]
            other = c.execute("SELECT id FROM access_roles WHERE name=? AND id!=?", (name, role["id"])).fetchone()
            if other:
                raise HTTPError(409, f"A position called {name} already exists.")
            old, new = body_to_flat(json.loads(role["rights"] or "{}")), body_to_flat(b.get("rights") or {})
            changed = {k: v for k, v in new.items() if old.get(k) != v}
            c.execute("UPDATE access_roles SET name=?, rights=?, updated_by=?, updated_at=? WHERE id=?",
                      (name, json.dumps(flat_to_body(new)), user["id"], now, role["id"]))
            if name != role["name"]:                             # renamed: same in the staff Role list and on the staff
                save_hr_roles(c, [name if r.lower() == role["name"].lower() else r for r in get_options(c)["hrRoles"]])
                pd = {(name if k.lower() == role["name"].lower() else k): v for k, v in get_options(c)["hrPosDept"].items()}
                c.execute("INSERT INTO option_lists(list_key, items) VALUES('hrPosDept', ?)"
                          " ON CONFLICT(list_key) DO UPDATE SET items=excluded.items", (json.dumps(pd),))
                ren = lambda x: name if x.lower() == role["name"].lower() else x       # the structure follows the new name
                save_pos_parent(c, {ren(k): ren(v) for k, v in get_options(c)["hrPosParent"].items()})
                c.execute("UPDATE hr_staff SET role=? WHERE role=? COLLATE NOCASE", (name, role["name"]))
            if "parent" in b:
                old_p = next((v for k, v in get_options(c)["hrPosParent"].items() if k.lower() == name.lower()), "")
                set_pos_parent(c, name, b.get("parent"))
                new_p = next((v for k, v in get_options(c)["hrPosParent"].items() if k.lower() == name.lower()), "")
                if old_p != new_p:
                    audit(c, "access-roles", user, "edit", "ACCESS", name, old_p or None, f"reports to: {new_p or '(none)'}", at=now)
            if "department" in b:
                old_d = next((v for k, v in get_options(c)["hrPosDept"].items() if k.lower() == name.lower()), "")
                set_pos_dept(c, name, b.get("department"))
                new_d = next((v for k, v in get_options(c)["hrPosDept"].items() if k.lower() == name.lower()), "")
                if old_d != new_d:
                    audit(c, "access-roles", user, "edit", "ACCESS", name, old_d or None, f"department: {new_d or '(none)'}", at=now)
            people = [r["id"] for r in c.execute("SELECT id FROM users WHERE access_role=? AND role IN ('admin','user')", (role["id"],))]
            if changed:
                for uid in people:
                    cur = user_flat(c, uid)
                    cur.update(changed)
                    write_access(c, uid, flat_to_body(cur))
                audit(c, "access-roles", user, "edit", "ACCESS", name, None,
                      f"{len(changed)} right(s) changed, given to {len(people)} person(s): " + ", ".join(sorted(changed))[:1500], at=now)
        self.send_json(200, {"changed": sorted(changed), "people": len(people)})

    def role_delete(self, user, rid):
        with DB() as c:
            role = c.execute("SELECT * FROM access_roles WHERE id=?", (int(rid),)).fetchone()
            if not role:
                raise HTTPError(404, "Position not found.")
            c.execute("UPDATE users SET access_role=NULL WHERE access_role=?", (role["id"],))   # people keep their rights
            c.execute("DELETE FROM access_roles WHERE id=?", (role["id"],))
            save_hr_roles(c, [r for r in get_options(c)["hrRoles"] if r.lower() != role["name"].lower()])
            pp = get_options(c)["hrPosParent"]                    # positions under it now report to its own superior
            up = next((v for k, v in pp.items() if k.lower() == role["name"].lower()), "")
            pp = {k: (up if v.lower() == role["name"].lower() else v) for k, v in pp.items() if k.lower() != role["name"].lower()}
            save_pos_parent(c, {k: v for k, v in pp.items() if v})
            audit(c, "access-roles", user, "cancel", "ACCESS", role["name"], None, "role deleted (people keep their rights)", at=time.time())
        self.send_json(200, {"ok": True})

    def role_assign(self, user, uid):
        """Give a person an Access Role. mode=add: the role's rights are added, the person keeps what they have;
        mode=replace: the person gets exactly the role's rights. roleId null = no role (rights stay as they are)."""
        b = self.body_json()
        uid, rid, mode = int(uid), b.get("roleId"), b.get("mode") or "add"
        with DB() as c:
            u = c.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
            if not u or u["role"] not in ("admin", "user"):
                raise HTTPError(400, "Positions only apply to Admin and User accounts.")
            if rid in (None, "", 0):
                c.execute("UPDATE users SET access_role=NULL WHERE id=?", (uid,))
                audit(c, "access-roles", user, "edit", "ACCESS", u["name"], None, "no access role", at=time.time())
                return self.get_access(user)
            role = c.execute("SELECT * FROM access_roles WHERE id=?", (int(rid),)).fetchone()
            if not role:
                raise HTTPError(404, "Position not found.")
            rr = body_to_flat(json.loads(role["rights"] or "{}"))
            if mode == "replace":
                flat = rr
            else:
                cur = user_flat(c, uid)
                flat = {k: (max(cur.get(k) or 0, v) if isinstance(v, int) and not isinstance(v, bool) else bool(cur.get(k) or v))
                        for k, v in rr.items()}
            write_access(c, uid, flat_to_body(flat))
            c.execute("UPDATE users SET access_role=? WHERE id=?", (role["id"], uid))
            audit(c, "access-roles", user, "edit", "ACCESS", u["name"], None,
                  f"access role {role['name']} ({'exactly the role' if mode == 'replace' else 'added to own rights'})", at=time.time())
        self.get_access(user)



def write_access(c, uid, body):
    """Write one person's rights (same shape as the Access Control page sends) into section_access / program_access."""
    entries = as_dict(body.get("sections"), "sections")
    if "create" in body:
        c.execute("INSERT INTO program_access(user_id, program, can_create) VALUES(?, 'coa', ?)"
                  " ON CONFLICT(user_id, program) DO UPDATE SET can_create=excluded.can_create",
                  (uid, int(bool(body["create"]))))
    eb = body.get("eb")
    if isinstance(eb, dict):             # Email Batch rights: view / create & send
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,0,0) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit", (uid, EB_SEC, int(bool(eb.get("view") or eb.get("edit"))), int(bool(eb.get("edit")))))
    mmr = body.get("mm")
    if isinstance(mmr, dict):            # Memo rights: HR (create, post, all memos) / approve (person in charge)
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,?,0) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit, can_check=excluded.can_check",
                  (uid, MM_SEC, int(bool(mmr.get("edit") or mmr.get("check"))), int(bool(mmr.get("edit"))), int(bool(mmr.get("check")))))
    trr = body.get("tr")
    if isinstance(trr, dict):            # Transfer Form rights: fill in own / HR (all forms)
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,0,0) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit", (uid, TR_SEC, int(bool(trr.get("view") or trr.get("edit"))), int(bool(trr.get("edit")))))
    tar = body.get("ta")
    if isinstance(tar, dict):            # Time Adjustment rights: fill in own / HR (all submitted forms)
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,0,0) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit", (uid, TA_SEC, int(bool(tar.get("view") or tar.get("edit"))), int(bool(tar.get("edit")))))
    whr = body.get("wh")
    if isinstance(whr, dict):            # Online Shop Delivery rights: view & print / create & scan
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,0,0) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit", (uid, WH_SEC, int(bool(whr.get("view") or whr.get("edit"))), int(bool(whr.get("edit")))))
    mcr = body.get("mc")
    if isinstance(mcr, dict):            # MC Request rights: submit own / HR (check & approve all)
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,0,0) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit", (uid, MC_SEC, int(bool(mcr.get("view") or mcr.get("edit"))), int(bool(mcr.get("edit")))))
    hr = body.get("hr")
    if isinstance(hr, dict):             # HR Staff Master Data rights: view / edit & import
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,0,0) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit", (uid, HR_SEC, int(bool(hr.get("view") or hr.get("edit"))), int(bool(hr.get("edit")))))
    sirim = body.get("sirim")
    if isinstance(sirim, dict):          # SIRIM Inspection Form rights
        c.execute("INSERT INTO program_access(user_id, program, can_create) VALUES(?, 'sirim', ?)"
                  " ON CONFLICT(user_id, program) DO UPDATE SET can_create=excluded.can_create",
                  (uid, int(bool(sirim.get("create")))))
        try:
            sres = max(0, min(99, int(sirim.get("resubmits") or 0)))
        except (TypeError, ValueError):
            raise HTTPError(400, "Resave Allowed must be a number.")
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,0,?) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit, resubmits=excluded.resubmits",
                  (uid, SIRIM_SEC, int(bool(sirim.get("view") or sirim.get("edit"))), int(bool(sirim.get("edit"))), sres))
    for sec, a in entries.items():
        if sec not in SECTIONS or not isinstance(a, dict):
            raise HTTPError(400, "Invalid access entry.")
        try:
            resub = max(0, min(99, int(a.get("resubmits") or 0)))
        except (TypeError, ValueError):
            raise HTTPError(400, "Resave Allowed must be a number.")
        c.execute("INSERT INTO section_access(user_id, section, can_view, can_edit, can_check, resubmits)"
                  " VALUES(?,?,?,?,?,?) ON CONFLICT(user_id, section) DO UPDATE SET can_view=excluded.can_view,"
                  " can_edit=excluded.can_edit, can_check=excluded.can_check, resubmits=excluded.resubmits",
                  (uid, sec, int(bool(a.get("view"))), int(bool(a.get("edit"))), int(bool(a.get("check"))), resub))


RIGHT_KEYS = ("view", "edit", "check", "resubmits")


# One Role list for the whole system: the staff Role list (Settings > HR Setting) = the Access Roles (Access Control).
def save_hr_roles(c, roles):
    c.execute("INSERT INTO option_lists(list_key, items) VALUES('hrRoles', ?)"
              " ON CONFLICT(list_key) DO UPDATE SET items=excluded.items", (json.dumps(roles),))


def pos_parent_clean(parents, roles):
    """{position: reports-to position} with only positions of the list, no position under itself and no loops."""
    known = {r.lower(): r for r in roles}
    out = {}
    for k, v in (parents or {}).items():
        k2, v2 = known.get(str(k).strip().lower()), known.get(str(v or "").strip().lower())
        if k2 and v2 and k2 != v2:
            out[k2] = v2
    for k in list(out):                                       # cut any loop (A -> B -> A)
        seen, x = {k}, out.get(k)
        while x:
            if x in seen:
                out.pop(k, None)
                break
            seen.add(x)
            x = out.get(x)
    return out


def pos_parent_loops(parents, pos, parent):
    """Would "pos reports to parent" make a loop (parent is pos, or is below pos)?"""
    x, seen = parent, set()
    while x and x.lower() not in seen:
        if x.lower() == pos.lower():
            return True
        seen.add(x.lower())
        x = next((v for k, v in parents.items() if k.lower() == x.lower()), None)
    return False


def save_pos_parent(c, parents):
    c.execute("INSERT INTO option_lists(list_key, items) VALUES('hrPosParent', ?) ON CONFLICT(list_key) DO UPDATE SET items=excluded.items",
              (json.dumps(parents),))


def set_pos_parent(c, position, parent):
    """Access Control > a Position > Reports to."""
    opts = get_options(c)
    parent = re.sub(r"\s+", " ", str(parent or "")).strip()
    parents = {k: v for k, v in opts["hrPosParent"].items() if k.lower() != position.lower()}
    if parent:
        known = next((r for r in opts["hrRoles"] if r.lower() == parent.lower()), None)
        if not known:
            raise HTTPError(400, f"Reports to: position '{parent}' is not in the Position list.")
        if pos_parent_loops(parents, position, known):
            raise HTTPError(400, f"{position} cannot report to {known} - {known} is {position} itself or below it.")
        parents[position] = known
    save_pos_parent(c, pos_parent_clean(parents, opts["hrRoles"]))


def set_pos_dept(c, position, dept):
    """The Department of a Position (Access Control > Positions, Settings > HR Setting); a new department joins the list."""
    opts = get_options(c)
    dept = re.sub(r"\s+", " ", str(dept or "")).strip()[:100]
    depts = list(opts["hrDepartments"])
    known = next((d for d in depts if d.lower() == dept.lower()), None)
    if dept and not known:
        depts.append(dept)
    pd = {k: v for k, v in opts["hrPosDept"].items() if k.lower() != position.lower()}
    if dept:
        pd[position] = known or dept
    for key, val in (("hrPosDept", pd), ("hrDepartments", depts)):
        c.execute("INSERT INTO option_lists(list_key, items) VALUES(?,?) ON CONFLICT(list_key) DO UPDATE SET items=excluded.items",
                  (key, json.dumps(val)))


def sync_roles(c):
    """Every role in the Role list has an Access Role (rights may still be empty), and every Access Role is in the list."""
    hr = list(get_options(c)["hrRoles"])
    have = {r.lower() for r in hr}
    rows = c.execute("SELECT * FROM access_roles ORDER BY id").fetchall()
    changed = False
    for r in rows:
        if r["name"].lower() not in have:
            hr.append(r["name"])
            have.add(r["name"].lower())
            changed = True
    names = {r["name"].lower() for r in rows}
    now = time.time()
    for name in hr:
        if name.lower() not in names:
            c.execute("INSERT INTO access_roles(name, rights, created_at, updated_at) VALUES(?,?,?,?)",
                      (name, json.dumps(flat_to_body({})), now, now))
    if changed:
        save_hr_roles(c, hr)


def body_to_flat(body):
    """Rights as {"A.view": True, ..., "A.resubmits": 2, "coa.create": True, "SIRIM.edit": ..., "EB.view": ..., "HR.edit": ...}"""
    body = body if isinstance(body, dict) else {}
    flat = {"coa.create": bool(body.get("create"))}
    secs = body.get("sections") if isinstance(body.get("sections"), dict) else {}
    num = lambda v: max(0, min(99, int(v or 0))) if str(v or 0).strip().lstrip("-").isdigit() else 0
    for sec in SECTIONS:
        a = secs.get(sec) if isinstance(secs.get(sec), dict) else {}
        edit = bool(a.get("edit"))
        flat[f"{sec}.view"] = bool(a.get("view")) or edit
        flat[f"{sec}.edit"] = edit
        flat[f"{sec}.check"] = bool(a.get("check")) and edit
        flat[f"{sec}.resubmits"] = num(a.get("resubmits")) if edit else 0
    si = body.get("sirim") if isinstance(body.get("sirim"), dict) else {}
    flat.update({"sirim.create": bool(si.get("create")), "SIRIM.edit": bool(si.get("edit")),
                 "SIRIM.view": bool(si.get("view") or si.get("edit")), "SIRIM.resubmits": num(si.get("resubmits")) if si.get("edit") else 0})
    for key, sec in (("eb", "EB"), ("hr", "HR"), ("mc", "MC"), ("tr", "TR"), ("ta", "TA"), ("wh", "WH")):
        x = body.get(key) if isinstance(body.get(key), dict) else {}
        flat[f"{sec}.edit"] = bool(x.get("edit"))
        flat[f"{sec}.view"] = bool(x.get("view") or x.get("edit"))
    mm = body.get("mm") if isinstance(body.get("mm"), dict) else {}
    flat["MM.edit"], flat["MM.check"] = bool(mm.get("edit")), bool(mm.get("check"))
    return flat


def flat_to_body(flat):
    g = lambda k, d=False: flat.get(k, d)
    return {"create": g("coa.create"),
            "sections": {sec: {"view": g(f"{sec}.view"), "edit": g(f"{sec}.edit"), "check": g(f"{sec}.check"),
                               "resubmits": g(f"{sec}.resubmits", 0)} for sec in SECTIONS},
            "sirim": {"create": g("sirim.create"), "view": g("SIRIM.view"), "edit": g("SIRIM.edit"), "resubmits": g("SIRIM.resubmits", 0)},
            "eb": {"view": g("EB.view"), "edit": g("EB.edit")}, "hr": {"view": g("HR.view"), "edit": g("HR.edit")},
            "mc": {"view": g("MC.view"), "edit": g("MC.edit")}, "tr": {"view": g("TR.view"), "edit": g("TR.edit")},
            "ta": {"view": g("TA.view"), "edit": g("TA.edit")}, "wh": {"view": g("WH.view"), "edit": g("WH.edit")},
            "mm": {"edit": g("MM.edit"), "check": g("MM.check")}}


def user_flat(c, uid):
    """One person's current rights in the flat form."""
    body = {"sections": {}}
    for r in c.execute("SELECT * FROM section_access WHERE user_id=?", (uid,)):
        a = {"view": bool(r["can_view"]), "edit": bool(r["can_edit"]), "check": bool(r["can_check"]), "resubmits": r["resubmits"]}
        if r["section"] in SECTIONS:
            body["sections"][r["section"]] = a
        elif r["section"] == SIRIM_SEC:
            body["sirim"] = {**body.get("sirim", {}), **a}
        elif r["section"] == EB_SEC:
            body["eb"] = a
        elif r["section"] == HR_SEC:
            body["hr"] = a
        elif r["section"] == MC_SEC:
            body["mc"] = a
        elif r["section"] == TR_SEC:
            body["tr"] = a
        elif r["section"] == TA_SEC:
            body["ta"] = a
        elif r["section"] == WH_SEC:
            body["wh"] = a
        elif r["section"] == MM_SEC:
            body["mm"] = a
    for r in c.execute("SELECT * FROM program_access WHERE user_id=?", (uid,)):
        if r["program"] == "coa":
            body["create"] = bool(r["can_create"])
        elif r["program"] == "sirim":
            body["sirim"] = {**body.get("sirim", {}), "create": bool(r["can_create"])}
    return body_to_flat(body)


ID = r"([0-9a-f]{16})"
SEC = r"([A-Z])"
ROUTES = [
    ("GET", r"/api/setup", Handler.setup_status, None),
    ("GET", r"/api/version", Handler.site_version, None),
    ("GET", r"/api/updates", Handler.system_updates, "any"),
    ("GET", r"/api/manual", Handler.user_manual, "any"),
    ("POST", r"/api/setup", Handler.setup_admin, None),
    ("POST", r"/api/login", Handler.login, None),
    ("POST", r"/api/logout", Handler.logout, None),
    ("GET", r"/api/me", Handler.me, "any"),
    ("POST", r"/api/me/password", Handler.change_password, "any"),
    ("GET", r"/api/apps", Handler.list_apps, "any"),
    ("POST", r"/api/apps", Handler.create_app, "create"),
    ("GET", r"/api/apps/" + ID, Handler.get_app, "any"),
    ("PUT", r"/api/apps/" + ID, Handler.update_app, "create"),
    ("POST", r"/api/apps/" + ID + r"/cancel", Handler.cancel_app, "admin"),
    ("POST", r"/api/apps/" + ID + r"/sections/" + SEC + r"/(submit|resubmit|reopen)", Handler.section_action, "create"),
    ("POST", r"/api/apps/" + ID + r"/submit", Handler.submit_all, "create"),
    ("GET", r"/api/apps/" + ID + r"/history", Handler.section_history, "any"),
    ("GET", r"/api/server", Handler.server_info, "super"),
    ("PUT", r"/api/server/settings", Handler.server_settings, "super"),
    ("GET", r"/api/appsheet", Handler.appsheet_info, "super"),
    ("GET", r"/api/email-settings", Handler.email_info, "admin"),
    ("GET", r"/api/memo", Handler.memo_list, "any"),
    ("POST", r"/api/memo", Handler.memo_save, "create"),
    ("GET", r"/api/memo/choices", Handler.memo_choices, "any"),
    ("GET", r"/api/memo/signature", Handler.memo_my_signature, "any"),
    ("POST", r"/api/memo/word", Handler.memo_word, "create"),
    ("POST", r"/api/memo/reach", Handler.memo_reach, "create"),
    ("GET", r"/api/memo/" + ID, Handler.memo_get, "any"),
    ("PUT", r"/api/memo/" + ID, Handler.memo_update, "create"),
    ("POST", r"/api/memo/" + ID + r"/files", Handler.memo_upload, "create"),
    ("GET", r"/api/memo/files/" + ID, Handler.memo_file, "any"),
    ("POST", r"/api/memo/" + ID + r"/approve", Handler.memo_approve, "create"),
    ("POST", r"/api/memo/" + ID + r"/post", Handler.memo_post, "create"),
    ("POST", r"/api/memo/" + ID + r"/cancel", Handler.memo_cancel, "create"),
    ("GET", r"/api/tr", Handler.tr_list, "any"),
    ("POST", r"/api/tr", Handler.tr_save, "create"),
    ("GET", r"/api/tr/staff", Handler.tr_staff_list, "any"),
    ("GET", r"/api/tr/" + ID, Handler.tr_get, "any"),
    ("PUT", r"/api/tr/" + ID, Handler.tr_update, "create"),
    ("POST", r"/api/tr/" + ID + r"/files", Handler.tr_upload, "create"),
    ("GET", r"/api/tr/files/" + ID, Handler.tr_file, "any"),
    ("POST", r"/api/tr/" + ID + r"/stage", Handler.tr_stage, "create"),
    ("POST", r"/api/tr/" + ID + r"/cancel", Handler.tr_cancel, "create"),
    ("GET", r"/api/wh", Handler.wh_list, "any"),
    ("POST", r"/api/wh", Handler.wh_create, "create"),
    ("GET", r"/api/wh/settings", Handler.wh_get_settings, "any"),
    ("PUT", r"/api/wh/settings", Handler.wh_settings, "create"),
    ("GET", r"/api/wh/" + ID, Handler.wh_get, "any"),
    ("PUT", r"/api/wh/" + ID, Handler.wh_update, "create"),
    ("POST", r"/api/wh/" + ID + r"/scan", Handler.wh_scan, "create"),
    ("POST", r"/api/wh/" + ID + r"/remove", Handler.wh_remove, "create"),
    ("POST", r"/api/wh/" + ID + r"/cancel", Handler.wh_cancel, "create"),
    ("POST", r"/api/wh/" + ID + r"/delete", Handler.wh_delete, "super"),
    ("GET", r"/api/ta", Handler.ta_list, "any"),
    ("POST", r"/api/ta", Handler.ta_save, "create"),
    ("GET", r"/api/ta/staff", Handler.ta_staff_list, "any"),
    ("PUT", r"/api/ta/reasons", Handler.ta_set_reasons, "create"),
    ("GET", r"/api/ta/" + ID, Handler.ta_get, "any"),
    ("PUT", r"/api/ta/" + ID, Handler.ta_update, "create"),
    ("POST", r"/api/ta/" + ID + r"/hr", Handler.ta_hr, "create"),
    ("POST", r"/api/ta/" + ID + r"/ack", Handler.ta_ack, "create"),
    ("POST", r"/api/ta/" + ID + r"/cancel", Handler.ta_cancel, "create"),
    ("POST", r"/api/ta/" + ID + r"/files", Handler.ta_upload, "create"),
    ("GET", r"/api/ta/files/" + ID, Handler.ta_file, "any"),
    ("POST", r"/api/ta/files/" + ID + r"/remove", Handler.ta_file_remove, "create"),
    ("GET", r"/api/mc", Handler.mc_list, "any"),
    ("POST", r"/api/mc", Handler.mc_create, "create"),
    ("GET", r"/api/mc/" + ID, Handler.mc_get, "any"),
    ("POST", r"/api/mc/" + ID + r"/files", Handler.mc_upload, "create"),
    ("GET", r"/api/mc/files/" + ID, Handler.mc_file, "any"),
    ("POST", r"/api/mc/" + ID + r"/decide", Handler.mc_decide, "create"),
    ("PUT", r"/api/mc/" + ID, Handler.mc_update, "create"),
    ("POST", r"/api/mc/files/" + ID + r"/remove", Handler.mc_file_remove, "create"),
    ("PUT", r"/api/mc/settings", Handler.mc_set, "admin"),
    ("GET", r"/api/hr/staff", Handler.hr_list, "any"),
    ("POST", r"/api/hr/staff", Handler.hr_add, "create"),
    ("PUT", r"/api/hr/staff/" + ID, Handler.hr_update, "create"),
    ("POST", r"/api/hr/staff/" + ID + r"/remove", Handler.hr_remove, "create"),
    ("POST", r"/api/hr/staff/" + ID + r"/login", Handler.hr_create_login, "super"),
    ("POST", r"/api/hr/logins", Handler.hr_create_logins, "super"),
    ("POST", r"/api/hr/staff/bulk", Handler.hr_bulk_update, "create"),
    ("POST", r"/api/hr/import", Handler.hr_import, "create"),
    ("PUT", r"/api/hr/settings", Handler.hr_settings, "admin"),
    ("POST", r"/api/hr/settings/read", Handler.hr_settings_read, "admin"),
    ("GET", r"/api/hr/settings-list\.xlsx", Handler.hr_settings_template, "admin"),
    ("GET", r"/api/hr/settings-all\.xlsx", Handler.hr_settings_export_all, "admin"),
    ("POST", r"/api/hr/settings/read-all", Handler.hr_settings_read_all, "admin"),
    ("GET", r"/api/hr/import-template\.xlsx", Handler.hr_template, "any"),
    ("GET", r"/api/hr/staff\.xlsx", Handler.hr_export, "any"),
    ("GET", r"/api/eb", Handler.eb_list, "any"),
    ("PUT", r"/api/eb-limit", Handler.eb_set_limit, "admin"),
    ("POST", r"/api/eb", Handler.eb_create, "create"),
    ("GET", r"/api/eb/" + ID, Handler.eb_get, "any"),
    ("PUT", r"/api/eb/" + ID, Handler.eb_update, "create"),
    ("POST", r"/api/eb/" + ID + r"/template", Handler.eb_import_template, "create"),
    ("PUT", r"/api/eb/" + ID + r"/recipients", Handler.eb_set_recipients, "create"),
    ("POST", r"/api/eb/" + ID + r"/recipients/import", Handler.eb_import_recipients, "create"),
    ("GET", r"/api/eb/" + ID + r"/customers\.csv", Handler.eb_sample, "any"),
    ("GET", r"/api/eb/" + ID + r"/import-template\.xlsx", Handler.eb_import_template_xlsx, "any"),
    ("GET", r"/api/eb/" + ID + r"/preview", Handler.eb_preview, "any"),
    ("POST", r"/api/eb/" + ID + r"/test", Handler.eb_test, "create"),
    ("POST", r"/api/eb/" + ID + r"/send", Handler.eb_send, "create"),
    ("POST", r"/api/eb/" + ID + r"/stop", Handler.eb_stop, "create"),
    ("POST", r"/api/eb/" + ID + r"/retry", Handler.eb_retry, "create"),
    ("POST", r"/api/eb/" + ID + r"/cancel", Handler.eb_cancel, "create"),
    ("GET", r"/api/email-templates", Handler.tpl_get, "admin"),
    ("PUT", r"/api/email-templates", Handler.tpl_save, "admin"),
    ("POST", r"/api/email-templates/preview", Handler.tpl_preview, "admin"),
    ("PUT", r"/api/email-settings/alerts", Handler.email_alert_switches, "admin"),
    ("POST", r"/api/apps/" + ID + r"/saved", Handler.save_coa, "create"),
    ("POST", r"/api/sirim/" + ID + r"/saved", Handler.save_sirim, "create"),
    ("PUT", r"/api/email-settings", Handler.email_save, "super"),
    ("POST", r"/api/email-settings/test", Handler.email_test, "super"),
    ("POST", r"/api/email-settings/run", Handler.email_run_now, "admin"),
    ("PUT", r"/api/appsheet", Handler.appsheet_save, "super"),
    ("POST", r"/api/appsheet/sync", Handler.appsheet_sync_now, "super"),
    ("POST", r"/api/server/restart", Handler.restart_server, "super"),
    ("GET", r"/api/sirim", Handler.sirim_list, "any"),
    ("GET", r"/api/sirim/coa-lookup", Handler.sirim_coa_lookup, "create"),
    ("GET", r"/api/sirim/coa-list", Handler.sirim_coa_list, "create"),
    ("POST", r"/api/sirim", Handler.sirim_create, "create"),
    ("GET", r"/api/sirim/" + ID, Handler.sirim_get, "any"),
    ("PUT", r"/api/sirim/" + ID, Handler.sirim_update, "create"),
    ("POST", r"/api/sirim/" + ID + r"/(submit|resubmit|reopen)", Handler.sirim_action, "create"),
    ("POST", r"/api/sirim/" + ID + r"/cancel", Handler.sirim_cancel, "admin"),
    ("POST", r"/api/sirim/" + ID + r"/delete", Handler.sirim_delete, "super"),
    ("POST", r"/api/sirim/" + ID + r"/files", Handler.sirim_upload, "create"),
    ("GET", r"/api/sirim/files/" + ID, Handler.sirim_download, "any"),
    ("DELETE", r"/api/sirim/files/" + ID, Handler.sirim_delete_file, "create"),
    ("GET", r"/api/sirim/" + ID + r"/audit", Handler.sirim_audit, "audit"),
    ("GET", r"/api/sirim-audit", Handler.sirim_audit_list, "audit"),
    ("GET", r"/api/versions/(coa|sirim)/" + ID, Handler.list_versions, "audit"),
    ("GET", r"/api/versions/(coa|sirim)/" + ID + r"/(\d+)", Handler.get_version, "audit"),
    ("GET", r"/api/versions/(coa|sirim)/" + ID + r"/(\d+)\.pdf", Handler.version_pdf_file, "audit"),
    ("GET", r"/api/versions/(coa|sirim)/" + ID + r"/files/" + ID, Handler.version_file, "audit"),
    ("GET", r"/api/options", Handler.list_options, "any"),
    ("PUT", r"/api/options/([A-Za-z]+)", Handler.set_options, "super"),
    ("PUT", r"/api/inspection-locations", Handler.set_locations, "admin"),
    ("GET", r"/api/audit", Handler.audit_list, "audit"),
    ("GET", r"/api/audit/" + ID, Handler.audit_doc, "audit"),
    ("POST", r"/api/apps/" + ID + r"/files", Handler.upload, "create"),
    ("GET", r"/api/files/" + ID, Handler.download, "any"),
    ("DELETE", r"/api/files/" + ID, Handler.delete_file, "create"),
    ("GET", r"/api/users", Handler.list_users, "super"),
    ("GET", r"/api/me/signature", Handler.sig_get, "any"),
    ("PUT", r"/api/me/signature", Handler.sig_put, "any"),
    ("DELETE", r"/api/me/signature", Handler.sig_delete, "any"),
    ("GET", r"/api/users/(\d+)/signature", Handler.sig_get, "super"),
    ("PUT", r"/api/users/(\d+)/signature", Handler.sig_put, "super"),
    ("DELETE", r"/api/users/(\d+)/signature", Handler.sig_delete, "super"),
    ("POST", r"/api/users", Handler.create_user, "super"),
    ("PUT", r"/api/users/(\d+)", Handler.update_user, "super"),
    ("GET", r"/api/access", Handler.get_access, "super"),
    ("PUT", r"/api/access/users/(\d+)", Handler.set_user_access, "super"),
    ("PUT", r"/api/access/users/(\d+)/role", Handler.role_assign, "super"),
    ("POST", r"/api/access/roles", Handler.role_create, "super"),
    ("PUT", r"/api/access/roles/(\d+)", Handler.role_update, "super"),
    ("POST", r"/api/access/roles/(\d+)/delete", Handler.role_delete, "super"),
]


STARTED_AT = time.time()
RESTART_EXIT_CODE = 3        # start_server.bat starts the server again when it exits with this code
CAN_RESTART = os.environ.get("COA_LAUNCHER") == "restart"   # only the new start_server.bat can restart us
SERVER = None
RESTART_REQUESTED = False


def _restart_soon():
    """Stop serving shortly after answering the request; __main__ then exits with RESTART_EXIT_CODE."""
    global RESTART_REQUESTED
    time.sleep(0.6)
    RESTART_REQUESTED = True
    if SERVER:
        SERVER.shutdown()


# ================================================================ AppSheet: copy the data to a Google Sheet
# The server sends everything (read-only copy) to a Google Apps Script web app inside the Google Sheet,
# and AppSheet builds its app on that Sheet. Nothing comes back from Google into this system.
APPSHEET_LOCK = threading.Lock()
LABELS = {k: v for sec in SECTIONS.values() for k, v in sec.get("labels", {}).items()}
COA_SHEET_KEYS = ["appType", "purpose", "pic", "requestedDate", "prevCoaNo", "equipmentName", "productCategory",
                  "supplierBrand", "companyBrand", "supplierModel", "companyModel", "hsCode", "ratedVoltage", "ratedFrequency",
                  "ratedPower", "productClass", "stEcos", "manufacturerName", "mfgCountry", "isEup", "coeNo", "coeExpiry",
                  "supplier", "shipCountry", "portLoading", "portArrival", "estArrivalDate", "invoiceNo", "k1No",
                  # Section I - the whole ST tab and the whole eCOS tab
                  *ST_ONLY, *ECOS_ONLY]
CT_SHEET = [("ctProductName", "Name of Product"), ("ctCategory", "Product Category"), ("ctSubCategory", "Product Sub Category"),
            ("ctModel", "Model No"), ("ctBrand", "Brand"), ("ctVoltage", "Voltage"), ("ctCurrent", "Current"),
            ("ctFrequency", "Frequency"), ("ctPower", "Power"), ("ctAdapter", "Adapter Model No"), ("ctK1", "K1 Form No"),
            ("ctQty", "Quantity"), ("ctSerialRange", "Serial No Range"), ("coaNo", "COA No"), ("ctCoaExpiry", "COA Expiry Date"),
            ("ctCoaApproval", "COA Approval Code"), ("ctCoeNo", "COE No"), ("ctCoeExpiry", "COE Expiry Date"),
            ("ctCoeApproval", "COE Approval Code"), ("ctSafStd", "Safety Std Ref No"), ("ctSafReport", "Safety Test Report No"),
            ("ctSafCert", "Safety Test Cert No"), ("ctSafIdentical", "Safety Identical Model"), ("ctIsEup", "Energy-Using Product"),
            ("ctEeStd", "EE Std Ref No"), ("ctEeReport", "EE Test Report No"), ("ctEeCert", "EE Test Cert No"),
            ("ctEeIdentical", "EE Identical Model"), ("ctEeStar", "Star Rating"), ("ctEeYear", "Year of Rating"),
            ("ctEeAec", "AEC kWh per year"), ("ctEeSaving", "Energy Saving Percentage"), ("ctEeTesting", "Testing Standard"),
            ("ctLocName", "Inspection Location"), ("ctLocAddr1", "Location Address 1"), ("ctLocAddr2", "Location Address 2"),
            ("ctLocAddr3", "Location Address 3"), ("ctContactA", "Contact Person a"), ("ctContactB", "Contact Person b"),
            ("ctTelA", "Telephone a"), ("ctTelB", "Telephone b"), ("ctEmailA", "Email a"), ("ctEmailB", "Email b"),
            ("ctHpA", "HP No a"), ("ctHpB", "HP No b"), ("estArrival", "Estimate Arrival Date"),
            ("estInspection", "Requested Inspection Date"), ("ctReqTime", "Requested Time")]
ST_LABEL = {"Not Submitted": "Draft", "Submitted": "Submitted", "Under Evaluation": "Under Evaluation",
            "Query / Additional Info Required": "Query from ST", "Approved": "Approved", "Rejected": "Rejected"}


def sheet_header(label):
    """Column names AppSheet is happy with (no dots, slashes, brackets)."""
    h = label.replace("/", "-").replace("%", "Percent")
    h = re.sub(r"[.\[\]()]", "", h)
    return re.sub(r"\s+", " ", h).strip()


def ts_text(t):
    return time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(t)) if t else ""


def days_until(iso):
    try:
        return (date.fromisoformat(str(iso)[:10]) - date.today()).days
    except ValueError:
        return None


def setting_all(c):
    return {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM app_settings")}


def setting_set(c, key, value):
    c.execute("INSERT INTO app_settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
              (key, None if value is None else str(value)))


def default_link_base():
    return f"http://{lan_ip() or 'localhost'}:{PORT}"


def build_sheets(c, link_base):
    """Rows for the Google Sheet: COA Applications, Consignment Test, Serial Numbers, Documents (the files of every program),
    Email Batch, Memo, MC Request, Transfer Form, Time Adjustment, Document Versions, Version Changes."""
    nm = names(c)
    link_base = (link_base or default_link_base()).rstrip("/")
    stats = app_statuses(c)
    apps = c.execute("SELECT * FROM apps ORDER BY created_at").fetchall()
    renewed = set()
    for r in apps:
        if not r["cancelled_at"]:
            prev = (json.loads(r["data"]).get("prevCoaNo") or "").strip().upper()
            if prev:
                renewed.add(prev)
    doc_count = {}
    for r in c.execute("SELECT app_id, COUNT(*) n FROM files WHERE removed_at IS NULL GROUP BY app_id"):
        doc_count[r["app_id"]] = r["n"]

    keys = [k for k in COA_SHEET_KEYS if k in DATA_SEC]
    # a heading column before the first field of each section (A - I) and before the summary - AppSheet shows them
    # as section headings when their type is Show / Section_Header (cells stay empty)
    cols, last = [], None
    for k in keys:
        if DATA_SEC.get(k) != last:
            last = DATA_SEC.get(k)
            cols.append((f"Section {last} - {SECTIONS[last]['name']}", None))
        cols.append((sheet_header(LABELS.get(k, k)), k))
    cols.append(("Summary", None))
    coa = [["Form No", "Date Apply"] + [h for h, _ in cols] +
           ["Status", "COA Alert", "Days to COA Expiry", "Checklist Done", "Checklist Total", "Checklist Percent",
            "Sections Submitted", "Documents", "Created By", "Created At", "Last Updated By", "Last Updated",
            "Cancelled", "Cancel Reason", "Open in Website"]]
    for r in apps:
        d, ck = json.loads(r["data"]), json.loads(r["checks"])
        prog = checklist_progress(d, ck)
        status = "Cancelled" if r["cancelled_at"] else (
            "Completed" if prog["completed"] else ST_LABEL.get(d.get("stStatus") or "Not Submitted", d.get("stStatus")))
        near = sorted(((days_until(e), n) for _, n, e in coas_of(d) if e and days_until(e) is not None), key=lambda x: x[0])
        days, alert = (near[0][0] if near else None), ""
        if days is not None and not r["cancelled_at"]:
            if near[0][1].strip().upper() in renewed:
                alert = "Renewed"
            elif days < 0:
                alert = "Expired"
            elif days <= 30:
                alert = f"Expiring in {days} day{'s' if days != 1 else ''}"
            else:
                alert = "OK"
        sub = sum(1 for sid in SECTIONS if ((stats.get(r["id"]) or {}).get(sid) or {"status": ""})["status"] == "submitted")
        coa.append([r["form_no"], r["date_apply"] or ""] + [d.get(k, "") if k else "" for _, k in cols] +
                   [status, alert, "" if days is None else days, prog["checkDone"], prog["checkTotal"],
                    round(100 * prog["checkDone"] / prog["checkTotal"]) if prog["checkTotal"] else 0,
                    f"{sub}/{len(SECTIONS)}", doc_count.get(r["id"], 0),
                    nm.get(r["created_by"], ""), ts_text(r["created_at"]), nm.get(r["updated_by"], ""), ts_text(r["updated_at"]),
                    "Yes" if r["cancelled_at"] else "No", r["cancel_reason"] or "", f"{link_base}/#/app/{r['id']}"])

    ct = [["Form No"] + [h for _, h in CT_SHEET] +
          ["Serial Count", "Quantity Matches Serials", "Status", "Documents", "Created By", "Created At",
           "Last Updated By", "Last Updated", "Cancelled", "Cancel Reason", "Open in Website"]]
    serial_rows = [["Key", "Form No", "No", "Serial Number", "Duplicate"]]
    sdocs = {}
    for r in c.execute("SELECT sirim_id, COUNT(*) n FROM sirim_files WHERE removed_at IS NULL AND field != 'serialFile' GROUP BY sirim_id"):
        sdocs[r["sirim_id"]] = r["n"]
    for r in c.execute("SELECT * FROM sirim ORDER BY created_at").fetchall():
        d = json.loads(r["data"])
        serials = d.get("serials") or []
        st = (stats.get(r["id"]) or {}).get(SIRIM_SEC)
        status = "Cancelled" if r["cancelled_at"] else ("Submitted" if st and st["status"] == "submitted"
                                                        else "Reopened" if st and st["submit_count"] else "Draft")
        match = "" if not (d.get("ctQty") or serials) else ("Yes" if not quantity_problems(d) else "No")
        ct.append([r["form_no"]] + [d.get(k, "") for k, _ in CT_SHEET] +
                  [len(set(serials)), match, status, sdocs.get(r["id"], 0), nm.get(r["created_by"], ""), ts_text(r["created_at"]),
                   nm.get(r["updated_by"], ""), ts_text(r["updated_at"]), "Yes" if r["cancelled_at"] else "No",
                   r["cancel_reason"] or "", f"{link_base}/#/sirim/{r['id']}"])
        seen = {}
        for x in serials:
            seen[x] = seen.get(x, 0) + 1
        for i, x in enumerate(serials, 1):
            serial_rows.append([f"{r['form_no']}-{i}", r["form_no"], i, x, "Yes" if seen[x] > 1 else "No"])

    drive = {r["file_id"]: r["url"] for r in c.execute("SELECT file_id, url FROM drive_files WHERE url IS NOT NULL AND trashed=0")}
    docs = [["Key", "Program", "Form No", "Document", "File Name", "File Type", "Size KB", "Uploaded By", "Uploaded At",
             "Drive Link", "Open in Website"]]
    for f in c.execute("SELECT f.*, a.form_no FROM files f JOIN apps a ON a.id = f.app_id WHERE f.removed_at IS NULL ORDER BY f.uploaded_at"):
        base = f["field"][:-5] if f["field"].endswith("__att") else f["field"]
        label = LABELS.get(f["field"]) or LABELS.get(base) or f["field"]
        if f["note"]:
            label += f" - {f['note']}"
        docs.append([f["id"], "COA Application", f["form_no"], label, f["name"], f["type"] or "", round((f["size"] or 0) / 1024),
                     nm.get(f["uploaded_by"], ""), ts_text(f["uploaded_at"]), drive.get(f["id"], ""), f"{link_base}/#/app/{f['app_id']}"])
    for f in c.execute("SELECT f.*, s.form_no FROM sirim_files f JOIN sirim s ON s.id = f.sirim_id WHERE f.removed_at IS NULL ORDER BY f.uploaded_at"):
        docs.append([f["id"], "Consignment Test", f["form_no"], SIRIM_DOCS.get(f["field"], f["field"]), f["name"], f["type"] or "",
                     round((f["size"] or 0) / 1024), nm.get(f["uploaded_by"], ""), ts_text(f["uploaded_at"]),
                     drive.get(f["id"], ""), f"{link_base}/#/sirim/{f['sirim_id']}"])
    # Email Batch: one row per email sent out (or failed) - only in the Google Sheet
    eb = [["Key", "Batch No", "Batch Title", "Row", "Customer Email", "Email Subject", "Details", "Status", "Sent At",
            "Error", "Sent By", "Open in Website"]]
    for r in c.execute("SELECT r.*, b.batch_no, b.title, b.sent_by FROM eb_recipients r JOIN eb_batches b ON b.id = r.batch_id"
                       " WHERE r.status IN ('sent', 'failed') ORDER BY r.sent_at, b.batch_no, r.row_no"):
        vals = json.loads(r["fields"] or "{}")
        details = "\n".join(f"{k}: {v}" for k, v in vals.items() if str(v).strip())
        eb.append([r["id"], r["batch_no"], r["title"] or "", r["row_no"], r["email"], r["sent_subject"] or "", details[:40000],
                   "Sent" if r["status"] == "sent" else "Failed", ts_text(r["sent_at"]), (r["error"] or "")[:1000],
                   nm.get(r["sent_by"], ""), f"{link_base}/#/eb/{r['batch_id']}"])
    hr_sheets = hr_dept_sheets(c, nm, link_base, docs, drive)
    vers, vchanges = version_sheets(c, nm, link_base)
    # Warehouse Dept - Online Shop Delivery: one row per parcel scanned
    osd = [["Key", "Manifest No", "Title", "Document Title", "Date", "Channel", "Courier Company", "Status", "No",
            "Tracking Number", "Scanned By", "Scanned At", "Remark", "Open in Website"]]
    for m in c.execute("SELECT * FROM wh_manifests ORDER BY created_at").fetchall():
        st = "Cancelled" if m["cancelled_at"] else "Scanning" if m["allow_edit"] else "Locked"
        for i, p in enumerate(c.execute("SELECT * FROM wh_parcels WHERE manifest_id=? AND removed_at IS NULL"
                                        " ORDER BY scanned_at, rowid", (m["id"],)), 1):
            osd.append([p["id"], m["doc_no"], m["title"], m["doc_title"], m["mdate"].replace("T", " "), m["channel"], m["courier"],
                        st, i, p["tracking"], nm.get(p["scanned_by"], ""), ts_text(p["scanned_at"]), m["remark"],
                        f"{link_base}/#/wh/{m['id']}"])
    return {"COA Applications": coa, "Consignment Test": ct, "Serial Numbers": serial_rows, "Documents": docs, "Email Batch": eb,
            **hr_sheets, "Online Shop Delivery": osd, "Document Versions": vers, "Version Changes": vchanges}


def sheet_text(h, limit=40000):
    """HTML (typed memo) -> plain text for a sheet cell."""
    t = re.sub(r"(?i)<br\s*/?>|</(p|div|li|h[1-6]|tr)>", "\n", h or "")
    t = html.unescape(re.sub(r"<[^>]+>", "", t))
    return re.sub(r"\n{3,}", "\n\n", t).strip()[:limit]


def hr_dept_sheets(c, nm, link_base, docs, drive):
    """Memo, MC Request, Transfer Form and Time Adjustment for the Google Sheet; their files are added to `docs`.
    IC numbers are not sent (personal data)."""
    un = {r["id"]: r["username"] for r in c.execute("SELECT id, username FROM users")}
    yn = lambda v: "Yes" if v else "No"
    # ---- Memo
    memo = [["Memo No", "Title", "Written In", "Title (English)", "Title (Bahasa Melayu)", "Title (Chinese)", "Type", "Status",
             "Who Can View", "Person in Charge", "Approved By", "Approved At", "Posted By", "Posted At", "Content",
             "Created By", "Created At", "Last Updated", "Cancelled", "Cancel Reason", "Open in Website"]]
    lname = {"en": "English", "ms": "Bahasa Melayu", "zh": "Chinese"}
    for r in c.execute("SELECT * FROM memos ORDER BY created_at").fetchall():
        lang = (r["lang"] if "lang" in r.keys() else "") or "en"
        tr = json.loads(r["translations"] or "{}") if "translations" in r.keys() else {}
        t = {lang: r["title"], **{k: v.get("title", "") for k, v in tr.items()}}
        memo.append([r["doc_no"], r["title"], lname.get(lang, lang), t.get("en", ""), t.get("ms", ""), t.get("zh", ""),
                     "Uploaded PDF" if r["kind"] == "upload" else "Typed", r["status"].title(),
                     memo_aud_text(json.loads(r["audience"] or "{}")), nm.get(r["approver_id"], ""), nm.get(r["approved_by"], ""),
                     ts_text(r["approved_at"]), nm.get(r["posted_by"], ""), ts_text(r["posted_at"]), sheet_text(r["content"]),
                     nm.get(r["created_by"], ""), ts_text(r["created_at"]), ts_text(r["updated_at"]), yn(r["cancelled_at"]),
                     r["cancel_reason"] or "", f"{link_base}/#/memo/{r['id']}"])
    for f in c.execute("SELECT f.*, m.doc_no FROM memo_files f JOIN memos m ON m.id = f.memo_id WHERE f.removed_at IS NULL ORDER BY f.uploaded_at"):
        docs.append([f["id"], "Memo", f["doc_no"], "Signed memo" if f["kind"] == "signed" else "Memo PDF", f["name"], f["type"] or "",
                     round((f["size"] or 0) / 1024), nm.get(f["uploaded_by"], ""), ts_text(f["uploaded_at"]), drive.get(f["id"], ""),
                     f"{link_base}/#/memo/{f['memo_id']}"])
    # ---- MC Request
    mc = [["Document Number", "Document Type", "Staff Code", "Staff Name", "Outlet", "Leave Number", "Date Apply", "Status",
           "Days Left for Original", "Original MC Received", "Received At", "Received By", "Submitted By", "Submitted At",
           "Approved By", "Approved At", "Rejected By", "Rejected At", "Reject Reason", "Files", "Open in Website"]]
    nfiles = {r["mc_id"]: r["n"] for r in c.execute("SELECT mc_id, COUNT(*) n FROM mc_files WHERE removed_at IS NULL GROUP BY mc_id")}
    for r in c.execute("SELECT * FROM mc_requests ORDER BY submitted_at").fetchall():
        mc.append([r["doc_no"], r["doc_type"], r["staff_code"], r["staff_name"], r["outlet"], r["leave_no"], r["date_apply"],
                   r["status"].title(), mc_left(r) if r["status"] in MC_OPEN and not r["received_at"] else "", yn(r["received_at"]),
                   ts_text(r["received_at"]), nm.get(r["received_by"], ""), nm.get(r["submitted_by"], ""), ts_text(r["submitted_at"]),
                   nm.get(r["approved_by"], ""), ts_text(r["approved_at"]),
                   nm.get(r["rejected_by"], "System" if r["rejected_at"] else ""), ts_text(r["rejected_at"]), r["reject_reason"] or "",
                   nfiles.get(r["id"], 0), f"{link_base}/#/mc/{r['id']}"])
    for f in c.execute("SELECT f.*, m.doc_no FROM mc_files f JOIN mc_requests m ON m.id = f.mc_id WHERE f.removed_at IS NULL ORDER BY f.uploaded_at"):
        docs.append([f["id"], "MC Request", f["doc_no"], "MC", f["name"], f["type"] or "", round((f["size"] or 0) / 1024),
                     nm.get(f["uploaded_by"], ""), ts_text(f["uploaded_at"]), drive.get(f["id"], ""), f"{link_base}/#/mc/{f['mc_id']}"])
    # ---- Transfer Form: one row per staff on the form
    tm = [k for k, _ in TR_TIME_LABELS]
    trf = [["Key", "Document ID", "Type", "Status", "Staff ID", "Staff Name", "Staff Outlet", "Position", "Effective From",
            "From Date", "To Date", "Outlet From", "Outlet To", "Position From", "Position To"] + [l for _, l in TR_TIME_LABELS] +
           ["ID Login SBClient", "Remarks", "Created By", "Created At", "Completed By", "Completed At", "Checked By", "Checked At",
            "Cancelled", "Cancel Reason", "Open in Website"]]
    for r in c.execute("SELECT * FROM tr_docs ORDER BY created_at").fetchall():
        data = json.loads(r["data"] or "{}")
        for i, x in enumerate(tr_people(r["type"], data), 1):
            t = x.get("times") or {}
            trf.append([f"{r['doc_no']}-{i}", r["doc_no"], r["type"].title(), r["status"].title(), x.get("staffId", ""),
                        x.get("staffName", ""), x.get("outlet", ""), x.get("position", ""), x.get("effectiveDate", ""),
                        x.get("fromDate", ""), x.get("toDate", ""), x.get("outletFrom", ""), x.get("outletTo", ""),
                        x.get("posFrom", ""), x.get("posTo", "")] + [t.get(k, "") for k in tm] +
                       [", ".join(x.get("idLogin") or []), x.get("remarks", ""), nm.get(r["created_by"], ""), ts_text(r["created_at"]),
                        nm.get(r["completed_by"], ""), ts_text(r["completed_at"]), nm.get(r["checked_by"], ""), ts_text(r["checked_at"]),
                        yn(r["cancelled_at"]), r["cancel_reason"] or "", f"{link_base}/#/tr/{r['id']}"])
    for f in c.execute("SELECT f.*, t.doc_no FROM tr_files f JOIN tr_docs t ON t.id = f.tr_id WHERE f.removed_at IS NULL ORDER BY f.uploaded_at"):
        docs.append([f["id"], "Transfer Form", f["doc_no"], "Signed letter (HR)" if f["kind"] == "hr" else "Signed letter (outlet)",
                     f["name"], f["type"] or "", round((f["size"] or 0) / 1024), nm.get(f["uploaded_by"], ""), ts_text(f["uploaded_at"]),
                     drive.get(f["id"], ""), f"{link_base}/#/tr/{f['tr_id']}"])
    # ---- Time Adjustment: one row per line
    ack = {"ok": "Acknowledged", "declined": "Declined"}
    ta = [["Key", "Document ID", "Status", "Staff ID", "Staff Name", "Date", "Branch"] + [l for _, l in TA_TIME_LABELS] +
          ["Reason Code", "Remark", "Evidence Files", "HR Acknowledge", "HR Remark", "User Acknowledge", "User Remark",
           "Created ID", "Created At", "Completed ID", "Completed At", "Acknowledged At", "Cancelled", "Cancel Reason", "Open in Website"]]
    tfiles = {}
    for r in c.execute("SELECT ta_id, row_uid, COUNT(*) n FROM ta_files WHERE removed_at IS NULL GROUP BY ta_id, row_uid"):
        tfiles[(r["ta_id"], r["row_uid"])] = r["n"]
    for r in c.execute("SELECT * FROM ta_docs ORDER BY created_at").fetchall():
        for i, x in enumerate(ta_rows(r), 1):
            t = x.get("times") or {}
            ta.append([f"{r['doc_no']}-{i}", r["doc_no"], r["status"].title(), x.get("staffId", ""), x.get("staffName", ""),
                       x.get("date", ""), x.get("branch", "")] + [t.get(k, "") for k, _ in TA_TIME_LABELS] +
                      [x.get("reason", ""), x.get("remark", ""), tfiles.get((r["id"], x.get("uid")), 0),
                       ack.get(x.get("hrAck"), ""), x.get("hrNote", ""), ack.get(x.get("userAck"), ""), x.get("userNote", ""),
                       un.get(r["created_by"], ""), ts_text(r["created_at"]), un.get(r["completed_by"], ""), ts_text(r["completed_at"]),
                       ts_text(r["acknowledged_at"]), yn(r["cancelled_at"]), r["cancel_reason"] or "", f"{link_base}/#/ta/{r['id']}"])
    rowname = {}
    for r in c.execute("SELECT id, rows FROM ta_docs"):
        for x in json.loads(r["rows"] or "[]"):
            rowname[(r["id"], x.get("uid"))] = f"Evidence {x.get('staffId', '')} {x.get('date', '')}".strip()
    for f in c.execute("SELECT f.*, t.doc_no FROM ta_files f JOIN ta_docs t ON t.id = f.ta_id WHERE f.removed_at IS NULL ORDER BY f.uploaded_at"):
        docs.append([f["id"], "Time Adjustment", f["doc_no"], rowname.get((f["ta_id"], f["row_uid"]), "Evidence"), f["name"],
                     f["type"] or "", round((f["size"] or 0) / 1024), nm.get(f["uploaded_by"], ""), ts_text(f["uploaded_at"]),
                     drive.get(f["id"], ""), f"{link_base}/#/ta/{f['ta_id']}"])
    # Memo Approval: memos waiting for the person in charge - approved from AppSheet (Decision = Approve)
    res = json.loads(setting_all(c).get("memo_sheet_results") or "{}")
    emails = {r["id"]: (r["email"] or "") for r in c.execute("SELECT id, email FROM users")}
    pdfs = {f["memo_id"]: drive.get(f["id"], "") for f in c.execute(
        "SELECT * FROM memo_files WHERE kind='memo' AND removed_at IS NULL ORDER BY uploaded_at")}
    appr = [["Memo No", "Title", "Type", "Status", "Who Can View", "Person in Charge", "Person in Charge Email", "Content",
             "PDF Link", "Created By", "Created At", "Decision", "Decided By", "Result", "Open in Website"]]
    week = time.time() - 7 * 86400
    for r in c.execute("SELECT * FROM memos WHERE status='processing' OR (status IN ('approved','posted') AND approved_at > ?)"
                       " ORDER BY created_at", (week,)).fetchall():
        rr = res.get(r["doc_no"]) or {}
        appr.append([r["doc_no"], r["title"], "Uploaded PDF" if r["kind"] == "upload" else "Typed", r["status"].title(),
                     memo_aud_text(json.loads(r["audience"] or "{}")), nm.get(r["approver_id"], ""), emails.get(r["approver_id"], ""),
                     sheet_text(r["content"]), pdfs.get(r["id"], ""), nm.get(r["created_by"], ""), ts_text(r["created_at"]),
                     "", "", rr.get("text", "") if r["status"] == "processing" else
                     f"Approved by {nm.get(r['approved_by'], '')} on {ts_text(r['approved_at'])}", f"{link_base}/#/memo/{r['id']}"])
    return {"Memo": memo, "MC Request": mc, "Transfer Form": trf, "Time Adjustment": ta, "Memo Approval": appr}


def memo_sheet_decisions(cfg):
    """Read the Decision column of the "Memo Approval" tab (set in AppSheet) and approve those memos.
    Only the person in charge may approve: the Google account email (Decided By) must be the email of that person
    in Users, and they need a saved signature (My signature).  Returns a short note for the sync status."""
    ans = appsheet_post(cfg["appsheet_url"], {"secret": cfg["appsheet_secret"], "action": "memoDecisions"}, timeout=60)
    if not ans.get("ok"):
        return "" if ans.get("net") else "Memo approval from AppSheet needs the new script (version 4) - copy it again from this page and deploy a new version."
    done, now = [], time.time()
    with DB() as c:
        res = json.loads(setting_all(c).get("memo_sheet_results") or "{}")
        for d in ans.get("decisions") or []:
            no = str(d.get("memoNo") or "").strip()
            dec = str(d.get("decision") or "").strip().lower()
            by = str(d.get("by") or "").strip().lower()
            r = c.execute("SELECT * FROM memos WHERE doc_no=?", (no,)).fetchone()
            if not r or not dec:
                continue
            note = ""
            if dec not in ("approve", "approved", "yes"):
                note = f"Not done: Decision must be Approve (was {d.get('decision')})."
            elif r["status"] != "processing":
                note = f"Not done: the memo is {r['status']}, not waiting for approval."
            else:
                u = c.execute("SELECT * FROM users WHERE id=?", (r["approver_id"],)).fetchone()
                sig = c.execute("SELECT image FROM user_signatures WHERE user_id=?", (r["approver_id"],)).fetchone()
                if not u or not by or (u["email"] or "").strip().lower() != by:
                    note = f"Not done: {by or 'unknown account'} is not the person in charge of this memo (email in Users must match the Google account)."
                elif not u["active"]:
                    note = "Not done: the person in charge's account is disabled."
                elif not sig:
                    note = "Not done: save your signature first in the portal (your name menu > My signature)."
                elif r["kind"] == "upload" and not c.execute("SELECT 1 FROM memo_files WHERE memo_id=? AND kind='memo' AND removed_at IS NULL", (r["id"],)).fetchone():
                    note = "Not done: HR has not uploaded the memo PDF yet."
                else:
                    c.execute("UPDATE memos SET status='approved', approved_by=?, approved_at=?, signature=?, updated_by=?, updated_at=? WHERE id=?",
                              (u["id"], now, sig["image"], u["id"], now, r["id"]))
                    audit(c, r["id"], u, "approve", MM_SEC, "status", "processing", f"approved via AppSheet ({by}) - saved e-signature added", at=now)
                    note = "Approved"
                    done.append(no)
            res[no] = {"text": note, "at": now}
        res = {k: v for k, v in res.items() if now - v.get("at", 0) < 14 * 86400}
        setting_set(c, "memo_sheet_results", json.dumps(res))
    return f"{len(done)} memo(s) approved from AppSheet." if done else ""


# ---------------------------------------------------------------- Version PDF (plain PDF made here - no extra software)
_HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278] + [556] * 10 + \
        [278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667,
         778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556,
         556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584]


def _pdf_text(t):
    """Text for the built-in PDF fonts (Windows-1252): emoji dropped, other characters the font lacks become '?'."""
    import unicodedata
    t = str(t).replace("\t", "    ").replace("\u2011", "-")
    return "".join(ch for ch in t if not (unicodedata.category(ch) == "So" and ch.encode("cp1252", "replace") == b"?"))


def _pdf_width(t, size, bold=False):
    w = sum(_HELV[ord(ch) - 32] if 32 <= ord(ch) < 127 else 556 for ch in t)
    return w * size / 1000 * (1.06 if bold else 1)


class SimplePdf:
    """A4 pages of wrapped text: heading / label-value rows / lines. Enough for a readable record of a version."""
    W, H, M = 595, 842, 40

    def __init__(self, footer=""):
        self.pages, self.ops, self.y, self.footer = [], [], 0, footer
        self.new_page()

    def new_page(self):
        if self.ops:
            self.pages.append(self.ops)
        self.ops, self.y = [], self.H - self.M

    def need(self, h):
        if self.y - h < self.M + 20:
            self.new_page()

    def text(self, x, y, t, size=9, bold=False, color=(0, 0, 0)):
        t = _pdf_text(t).encode("cp1252", "replace").decode("cp1252")
        t = t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
        self.ops.append(f"{color[0]} {color[1]} {color[2]} rg BT /{'F2' if bold else 'F1'} {size} Tf {x:.1f} {y:.1f} Td ({t}) Tj ET")

    def wrap(self, t, width, size, bold=False):
        out = []
        for para in _pdf_text(t).split("\n"):
            line = ""
            for word in para.split(" "):
                cand = (line + " " + word) if line else word
                if _pdf_width(cand, size, bold) <= width:
                    line = cand
                    continue
                if line:
                    out.append(line)
                while _pdf_width(word, size, bold) > width and len(word) > 1:      # a very long word: cut it
                    n = len(word)
                    while n > 1 and _pdf_width(word[:n], size, bold) > width:
                        n -= 1
                    out.append(word[:n])
                    word = word[n:]
                line = word
            out.append(line)
        return out

    # self.y is always the TOP of the free space; text is drawn on a baseline below it, rules below the text
    def heading(self, t, size=12):
        self.need(size + 22)
        self.y -= 8
        box = size + 10
        self.ops.append(f"0.93 0.95 0.99 rg {self.M} {self.y - box:.1f} {self.W - 2 * self.M} {box} re f")
        self.text(self.M + 6, self.y - size - 2, t, size, True, (0.1, 0.2, 0.45))
        self.y -= box + 4

    def line(self, t, size=9, bold=False, color=(0, 0, 0), indent=0):
        for ln in self.wrap(t, self.W - 2 * self.M - indent, size, bold):
            self.need(size + 5)
            self.text(self.M + indent, self.y - size, ln, size, bold, color)
            self.y -= size + 5

    def row(self, label, value, mark="", size=8.5):
        lw, step = 190, size + 3.5
        lab = self.wrap(label, lw - 14, size, True)
        val = self.wrap(value if value not in (None, "") else "-", self.W - 2 * self.M - lw, size)
        n = max(len(lab), len(val))
        self.need(n * step + 10)
        base = self.y - size - 2                                  # first baseline of this row
        if mark:
            self.text(self.M, base, mark, size, True, (0.08, 0.5, 0.2))
        for i, ln in enumerate(lab):
            self.text(self.M + 12, base - i * step, ln, size, True, (0.25, 0.25, 0.3))
        for i, ln in enumerate(val):
            self.text(self.M + lw, base - i * step, ln, size)
        rule = base - (n - 1) * step - 5                         # below the letters' tails (g, p, y)
        self.ops.append(f"0.88 0.9 0.93 RG 0.4 w {self.M} {rule:.1f} m {self.W - self.M} {rule:.1f} l S")
        self.y = rule - 1

    def bytes(self):
        pages = self.pages + ([self.ops] if self.ops else [])
        objs = ["<< /Type /Catalog /Pages 2 0 R >>", None,
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
                "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]
        kids = []
        for i, ops in enumerate(pages, 1):
            foot = f"0.45 0.45 0.5 rg BT /F1 7.5 Tf {self.M} 22 Td ({_pdf_text(self.footer).replace('(', '[').replace(')', ']')}   -   page {i} of {len(pages)}) Tj ET"
            stream = "\n".join(ops + [foot]).encode("cp1252", "replace")
            objs.append(f"<< /Length {len(stream)} >>\nstream\n".encode() + stream + b"\nendstream")
            objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.W} {self.H}] /Contents {len(objs)} 0 R "
                        f"/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>")
            kids.append(f"{len(objs)} 0 R")
        objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>"
        out, offs = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"), []
        for n, o in enumerate(objs, 1):
            offs.append(len(out))
            out += f"{n} 0 obj\n".encode() + (o if isinstance(o, bytes) else o.encode("cp1252", "replace")) + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode() + "".join(f"{x:010d} 00000 n \n" for x in offs).encode()
        out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        return bytes(out)


def version_pdf(c, v):
    """PDF of one document version (v = doc_versions row): what changed, then the whole document as it was."""
    program, doc_id = v["program"], v["doc_id"]
    snap = json.loads(v["snapshot"] or "{}")
    nm = names(c)
    prev = c.execute("SELECT snapshot FROM doc_versions WHERE program=? AND doc_id=? AND version_no=?",
                     (program, doc_id, v["version_no"] - 1)).fetchone()
    before = flatten_snapshot(json.loads(prev["snapshot"])) if prev else {}
    after = flatten_snapshot(snap)
    title = "COA Application" if program == "coa" else "Consignment Test Application"
    form = snap.get("formNo") or ""
    pdf = SimplePdf(f"{form} - version {v['version_no']} - Company Name Sdn Bhd")
    pdf.line("COMPANY NAME SDN BHD", 9, True, (0.35, 0.35, 0.4))
    pdf.y -= 3
    pdf.line(f"{title} - {form}", 16, True, (0.1, 0.2, 0.45))
    pdf.y -= 2
    pdf.line(f"Version {v['version_no']} - {VERSION_ACTIONS.get(v['action'], v['action'])} by {nm.get(v['user_id'], '-')} "
             f"on {ts_text(v['at'])}", 10, False, (0.25, 0.25, 0.3))
    if snap.get("cancelled"):
        pdf.line(f"CANCELLED - {snap['cancelled']}", 10, True, (0.7, 0.1, 0.1))
    changes = [k for k in json.loads(v["changes"] or "[]") if k != "serials"]
    pdf.heading(f"What changed in this version ({len(changes)})")
    if not changes:
        pdf.line("Nothing - starting version of the document." if v["action"] == "baseline" else "Nothing changed.", 9)
    for k in changes:
        pdf.row(version_change_label(k), f"{version_value(k, before.get(k)) or '(empty)'}  ->  {version_value(k, after.get(k)) or '(empty)'}")
    data, checks, remarks, files = snap.get("data") or {}, snap.get("checks") or {}, snap.get("remarks") or {}, snap.get("files") or {}
    fname = lambda lst: ", ".join((x.get("name", "") + (f" - {x['note']}" if x.get("note") else "")) if isinstance(x, dict) else str(x)
                                  for x in lst)
    if program == "coa":
        for sid, sec in SECTIONS.items():
            status = (snap.get("sections") or {}).get(sid) or "draft"
            pdf.heading(f"{sid}. {sec['name']}  -  {status.capitalize()}", 11)
            if sid == "A" and snap.get("dateApply"):
                pdf.row("Date Apply", snap["dateApply"])
            shown = set()
            for k in sec["data"]:
                if not item_applies(k, data):
                    continue
                shown.add(k)
                val = data.get(k, "")
                if isinstance(val, list):
                    val = ", ".join(map(str, val))
                att = files.get(k + "__att")
                if att:
                    val = (str(val) + "\n" if val else "") + "Attached: " + fname(att)
                pdf.row(LABELS.get(k, k), val, "[x]" if checks.get(k) else "")
                if remarks.get(k):
                    pdf.line(f"Remark: {remarks[k]}", 8, False, (0.45, 0.3, 0.05), 190)
            for f in sec.get("files", []):
                base = f[:-5] if f.endswith("__att") else f
                if files.get(f) and base not in shown:
                    pdf.row(LABELS.get(f, f), fname(files[f]), "[x]" if checks.get(base) else "")
    else:
        pdf.heading("Consignment Test Application", 11)
        for k, label in CT_SHEET:
            val = data.get(k, "")
            pdf.row(label, ", ".join(map(str, val)) if isinstance(val, list) else val)
        pdf.row("Serial Numbers", f"{snap.get('serialCount', 0)} serial number(s)")
        pdf.heading("Documents", 11)
        for k, label in SIRIM_DOCS.items():
            if files.get(k):
                pdf.row(label, fname(files[k]))
    return pdf.bytes()


VERSION_ACTIONS = {"create": "Created", "edit": "Amended", "submit": "Submitted", "resubmit": "Resaved", "reopen": "Reopened",
                   "cancel": "Cancelled", "baseline": "Starting version"}


def version_change_label(key):
    """'data.coaNo' -> 'COA No.', 'checks.coaNo' -> 'Checklist: COA No.', 'files.stFee__att' -> 'Document: ...'"""
    group, _, k = key.partition(".")
    if not k:
        return {"formNo": "Form No", "dateApply": "Date Apply", "cancelled": "Cancelled (reason)",
                "serialsHash": "Serial Numbers"}.get(group, group)
    base = k[:-5] if k.endswith("__att") else k
    label = LABELS.get(k) or dict(CT_SHEET).get(k) or SIRIM_DOCS.get(k) or LABELS.get(base) or dict(CT_SHEET).get(base) or k
    if group == "sections":
        return f"Section {k} status" if k in SECTIONS else "Status"
    return {"checks": "Checklist: ", "remarks": "Remark: ", "files": "Document: "}.get(group, "") + label


def version_value(key, value):
    if value in (None, ""):
        return ""
    if key.startswith("checks."):
        return "Ticked" if value else "Not ticked"
    if key == "serialsHash":
        return "(changed)"
    if key.startswith("sections."):
        return str(value).capitalize()
    return str(value)[:2000]


def version_sheets(c, nm, link_base):
    """Document Versions (one row per version) + Version Changes (one row per changed item: old -> new value)."""
    forms = {("coa", r["id"]): r["form_no"] for r in c.execute("SELECT id, form_no FROM apps")}
    forms.update({("sirim", r["id"]): r["form_no"] for r in c.execute("SELECT id, form_no FROM sirim")})
    drive = {r["file_id"]: r["url"] for r in c.execute(
        "SELECT file_id, url FROM drive_files WHERE file_id LIKE 'ver-%' AND url IS NOT NULL AND trashed=0")}
    vers = [["Key", "Program", "Form No", "Version", "Action", "Saved By", "Saved At", "Items Changed", "Changes",
             "Version PDF", "Open Version in Website"]]
    rows = [["Key", "Version Key", "Program", "Form No", "Version", "Item", "Old Value", "New Value", "Saved By", "Saved At"]]
    prev_doc, prev = None, {}
    for r in c.execute("SELECT * FROM doc_versions ORDER BY program, doc_id, version_no"):
        doc = (r["program"], r["doc_id"])
        if doc not in forms:
            continue
        if doc != prev_doc:
            prev_doc, prev = doc, {}
        cur = flatten_snapshot(json.loads(r["snapshot"] or "{}"))
        changes = [k for k in json.loads(r["changes"] or "[]") if k != "serials"]
        program = "COA Application" if r["program"] == "coa" else "Consignment Test"
        key = f"{forms[doc]}-v{r['version_no']}"
        who, when = nm.get(r["user_id"], ""), ts_text(r["at"])
        vers.append([key, program, forms[doc], r["version_no"], VERSION_ACTIONS.get(r["action"], r["action"]), who, when,
                     len(changes), "\n".join(version_change_label(k) for k in changes)[:40000],
                     drive.get(f"ver-{r['id']}", ""), f"{link_base}/#/versions/{r['program']}/{r['doc_id']}"])
        for i, k in enumerate(changes, 1):
            rows.append([f"{key}-{i}", key, program, forms[doc], r["version_no"], version_change_label(k),
                         version_value(k, prev.get(k)), version_value(k, cur.get(k)), who, when])
        prev = cur
    return vers, rows


DRIVE_MAX_FILE = 35 * 1024 * 1024       # Google Apps Script accepts about 50 MB per call (the file is sent as base64)
DRIVE_PER_SYNC = (20, 150 * 1024 * 1024)  # at most 20 files / 150 MB per sync - the rest follows at the next sync
OLD_SCRIPT = ("Google could not save the document. Either the web app still runs the OLD script, or Google Drive access is "
              "not allowed yet. In Apps Script: (1) paste the script from Settings > AppSheet and Save, (2) choose the function "
              "'authorizeDrive' at the top and press Run > Allow, (3) Deploy > Manage deployments > Edit > Version: New version > Deploy.")


def appsheet_post(url, payload, timeout=120):
    """POST to the Apps Script web app; returns its JSON answer (or {"ok": False, "error": ...})."""
    req = urllib.request.Request(url, data=json.dumps(payload, default=str).encode(), method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            text = r.read().decode("utf-8", "replace")
    except Exception as e:                       # no internet, wrong URL, Google error ...
        return {"ok": False, "error": f"Could not reach Google: {e}", "net": True}
    try:
        return json.loads(text)
    except ValueError:
        return {"ok": False, "error": "Google did not answer with data. Check the deployment: Execute as 'Me' and "
                                      "Who has access 'Anyone', then copy the /exec URL again.", "html": True}


def drive_step(cfg):
    """Copy new documents to Google Drive and move removed ones to the Drive trash. Returns a short summary."""
    url, secret = cfg["appsheet_url"], cfg["appsheet_secret"]
    with DB() as c:
        done = {r["file_id"]: r for r in c.execute("SELECT * FROM drive_files")}
        files = [dict(r, program="COA Application") for r in c.execute(
            "SELECT f.*, a.form_no FROM files f JOIN apps a ON a.id = f.app_id ORDER BY f.uploaded_at")]
        files += [dict(r, program="Consignment Test") for r in c.execute(
            "SELECT f.*, s.form_no FROM sirim_files f JOIN sirim s ON s.id = f.sirim_id ORDER BY f.uploaded_at")]
        files += [dict(r, program="Memo", document="Signed memo" if r["kind"] == "signed" else "Memo PDF") for r in c.execute(
            "SELECT f.*, m.doc_no form_no FROM memo_files f JOIN memos m ON m.id = f.memo_id ORDER BY f.uploaded_at")]
        files += [dict(r, program="MC Request", document="MC") for r in c.execute(
            "SELECT f.*, m.doc_no form_no FROM mc_files f JOIN mc_requests m ON m.id = f.mc_id ORDER BY f.uploaded_at")]
        files += [dict(r, program="Transfer Form", document="Signed letter (HR)" if r["kind"] == "hr" else "Signed letter (outlet)")
                  for r in c.execute("SELECT f.*, t.doc_no form_no FROM tr_files f JOIN tr_docs t ON t.id = f.tr_id ORDER BY f.uploaded_at")]
        files += [dict(r, program="Time Adjustment", document="Evidence") for r in c.execute(
            "SELECT f.*, t.doc_no form_no FROM ta_files f JOIN ta_docs t ON t.id = f.ta_id ORDER BY f.uploaded_at")]
    up = fail = 0
    budget_n, budget_b = DRIVE_PER_SYNC
    waiting, problems = 0, []
    for f in files:
        d = done.get(f["id"])
        if f["removed_at"]:
            if d and d["drive_id"] and not d["trashed"]:             # removed in the system -> Drive trash
                ans = appsheet_post(url, {"secret": secret, "action": "trash", "driveId": d["drive_id"]})
                if ans.get("ok"):
                    with DB() as c:
                        c.execute("UPDATE drive_files SET trashed=1 WHERE file_id=?", (f["id"],))
            continue
        if d and d["drive_id"]:
            continue
        size = f["size"] or 0
        if size > DRIVE_MAX_FILE:
            if not d:
                with DB() as c:
                    c.execute("INSERT OR REPLACE INTO drive_files(file_id, program, at, error) VALUES(?,?,?,?)",
                              (f["id"], f["program"], time.time(), "too big for Google Apps Script (over 35 MB)"))
            continue
        if budget_n <= 0 or budget_b - size < 0:
            waiting += 1
            continue
        try:
            with open(file_disk_path(f), "rb") as fh:
                data = base64.b64encode(fh.read()).decode()
        except (OSError, HTTPError):
            continue                                                 # file missing on disk - nothing to copy
        if f.get("document"):
            document = f["document"]
        else:
            base = f["field"][:-5] if f["field"].endswith("__att") else f["field"]
            document = (LABELS.get(f["field"]) or LABELS.get(base) or SIRIM_DOCS.get(f["field"]) or f["field"])
        ans = appsheet_post(url, {"secret": secret, "action": "file", "key": f["id"], "name": f["name"],
                                  "mime": f["type"] or "application/octet-stream", "form": f["form_no"],
                                  "restricted": (cfg.get("appsheet_access") or "link") == "restricted",
                                  "program": f["program"], "document": document, "data": data}, timeout=300)
        budget_n -= 1
        budget_b -= size
        if ans.get("ok") and ans.get("url"):
            up += 1
            with DB() as c:
                c.execute("INSERT OR REPLACE INTO drive_files(file_id, program, drive_id, url, at, error) VALUES(?,?,?,?,?,?)",
                          (f["id"], f["program"], ans.get("id"), ans["url"], time.time(),
                           None if ans.get("shared", True) else "not shared - Google Workspace blocks 'Anyone with the link'"))
        else:
            fail += 1
            problems.append(OLD_SCRIPT if ans.get("html") or (ans.get("ok") and not ans.get("url")) else str(ans.get("error")))
            if ans.get("net") or ans.get("html") or ans.get("ok"):
                break                                                # no point trying the other files now
    # a PDF of every document version (made again when a version was added to within its 10 minutes)
    if not problems and budget_n > 0:
        with DB() as c:
            vers = c.execute("SELECT v.id, v.at, v.version_no, v.program, COALESCE(a.form_no, s.form_no) form_no FROM doc_versions v"
                             " LEFT JOIN apps a ON v.program='coa' AND a.id=v.doc_id LEFT JOIN sirim s ON v.program='sirim'"
                             " AND s.id=v.doc_id ORDER BY v.at").fetchall()
        for v in vers:
            key, d = f"ver-{v['id']}", done.get(f"ver-{v['id']}")
            if not v["form_no"] or (d and d["drive_id"] and not d["trashed"] and d["at"] >= v["at"]):
                continue
            if budget_n <= 0:
                waiting += 1
                continue
            with DB() as c:
                row = c.execute("SELECT * FROM doc_versions WHERE id=?", (v["id"],)).fetchone()
                try:
                    data = version_pdf(c, row)
                except Exception as e:                                # never stop the sync for one PDF
                    print(f"Version PDF {v['form_no']} v{v['version_no']} failed: {e}")
                    continue
            if d and d["drive_id"] and not d["trashed"]:            # older PDF of this version -> Drive trash
                appsheet_post(url, {"secret": secret, "action": "trash", "driveId": d["drive_id"]})
            ans = appsheet_post(url, {"secret": secret, "action": "file", "key": key, "mime": "application/pdf",
                                      "name": f"{v['form_no']} - version {v['version_no']}.pdf", "form": v["form_no"],
                                      "restricted": (cfg.get("appsheet_access") or "link") == "restricted",
                                      "program": "COA Application" if v["program"] == "coa" else "Consignment Test",
                                      "document": f"Version {v['version_no']} PDF", "data": base64.b64encode(data).decode()}, timeout=300)
            budget_n -= 1
            if ans.get("ok") and ans.get("url"):
                up += 1
                with DB() as c:
                    c.execute("INSERT OR REPLACE INTO drive_files(file_id, program, drive_id, url, at, error) VALUES(?,?,?,?,?,?)",
                              (key, "Version PDF", ans.get("id"), ans["url"], time.time(), None))
            else:
                fail += 1
                problems.append(OLD_SCRIPT if ans.get("html") or (ans.get("ok") and not ans.get("url")) else str(ans.get("error")))
                break
    with DB() as c:
        stored = c.execute("SELECT COUNT(*) FROM drive_files WHERE url IS NOT NULL AND trashed=0").fetchone()[0]
        unshared = c.execute("SELECT COUNT(*) FROM drive_files WHERE url IS NOT NULL AND trashed=0 AND error IS NOT NULL").fetchone()[0]
    return {"uploaded": up, "failed": fail, "waiting": waiting, "inDrive": stored, "notShared": unshared,
            "problem": problems[0] if problems else ""}


def viewer_list(cfg):
    return [x for x in (cfg.get("appsheet_viewers") or "").split("\n") if x.strip()]


def access_step(cfg, force):
    """Share the Google Sheet + documents folder with exactly the listed emails (restricted), or 'anyone with the link'."""
    mode, viewers = cfg.get("appsheet_access") or "link", viewer_list(cfg)
    key = hashlib.sha256(json.dumps([mode, viewers]).encode()).hexdigest()
    if not force and key == cfg.get("appsheet_access_hash"):
        return None
    ans = appsheet_post(cfg["appsheet_url"], {"secret": cfg["appsheet_secret"], "action": "access", "mode": mode, "viewers": viewers},
                        timeout=300)
    if ans.get("html") or (ans.get("ok") and "added" not in ans):
        return {"ok": False, "problem": "The Google script is an older version - copy the script again from this page, paste it in "
                                        "Apps Script, Save, then Deploy > Manage deployments > Edit > Version: New version > Deploy."}
    if not ans.get("ok"):
        return {"ok": False, "problem": str(ans.get("error"))[:300]}
    with DB() as c:
        setting_set(c, "appsheet_access_hash", key)
    return {"ok": True, "mode": mode, "added": ans.get("added", 0), "removed": ans.get("removed", 0),
            "filesFixed": ans.get("filesFixed", 0), "failed": ans.get("failed", [])}


def secret_check(secret):
    """Short code made from the secret - the Google script shows the same code for its own secret."""
    return hashlib.sha256((secret or "").encode()).hexdigest()[:8]


def diagnose_script(cfg):
    """Ask the deployed Google script which version and secret it runs, and explain what to do."""
    fix = ("On THIS server press 'Copy script', paste it in Apps Script (replace everything), Save, then "
           "Deploy > Manage deployments > pencil > Version: NEW VERSION > Deploy, and press Sync now.")
    try:
        with urllib.request.urlopen(cfg["appsheet_url"], timeout=60) as r:
            info = json.loads(r.read().decode("utf-8", "replace"))
    except Exception:
        return "the script in Google has a different secret. " + fix
    mine = secret_check(cfg.get("appsheet_secret"))
    if not info.get("check"):
        return ("Google is still running an OLD version of the script (the web app was not deployed as a new version). "
                "In Apps Script: Deploy > Manage deployments > pencil > Version: NEW VERSION > Deploy. If you used "
                "'New deployment' instead, copy its new /exec URL into the Web app URL box here and press Save.")
    if info["check"] != mine:
        return (f"the script in Google has another secret (its check code {info['check']}, this server {mine}) - "
                "it was copied from another server or before 'New secret key'. " + fix)
    return "the check codes match - press Sync now again; if it still fails, deploy a new version once more."


def appsheet_sync(force=False, who="auto"):
    """Send the data to the Google Sheet. Returns the status that is also shown in Settings."""
    with APPSHEET_LOCK:
        now = time.time()
        with DB() as c:
            cfg = setting_all(c)
            setting_set(c, "appsheet_last_attempt", now)
            if not cfg.get("appsheet_url") or not cfg.get("appsheet_secret"):
                return {"ok": False, "at": now, "message": "Not set up yet - paste the Web app URL and press Save."}
        access = access_step(cfg, force)
        try:
            memo_note = memo_sheet_decisions(cfg)
        except Exception as e:                            # never stop the sync for this
            memo_note = f"Memo approval: {e}"
        drive = drive_step(cfg) if cfg.get("appsheet_drive", "1") == "1" else None
        with DB() as c:
            sheets = build_sheets(c, site_url(cfg))
        rows = {k: len(v) - 1 for k, v in sheets.items()}
        digest = hashlib.sha256(json.dumps(sheets, sort_keys=True, default=str).encode()).hexdigest()
        last_ok = float(cfg.get("appsheet_last_ok") or 0)
        if not force and digest == cfg.get("appsheet_hash") and now - last_ok < 6 * 3600:
            status = {"ok": True, "at": now, "message": "No changes since the last sync.", "rows": rows, "drive": drive}
        else:
            body = json.dumps({"secret": cfg["appsheet_secret"], "sheets": sheets}, default=str).encode()
            try:
                req = urllib.request.Request(cfg["appsheet_url"], data=body, method="POST",
                                             headers={"Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=120) as r:
                    text = r.read().decode("utf-8", "replace")
                try:
                    ans = json.loads(text)
                except ValueError:
                    ans = {"ok": False, "error": "Google did not answer with data. Check the deployment: "
                                                  "Execute as 'Me' and Who has access 'Anyone', then copy the /exec URL again."}
                if ans.get("ok"):
                    status = {"ok": True, "at": now, "message": f"Synced ({who}).", "rows": rows, "drive": drive}
                else:
                    status = {"ok": False, "at": now, "message": "Google Sheet refused: " + str(ans.get("error") or "unknown error")[:300]}
            except Exception as e:                       # no internet, wrong URL, Google error ...
                status = {"ok": False, "at": now, "message": f"Could not reach Google: {e}"[:400]}
        if status["ok"] and drive and drive["problem"]:
            status["message"] += " Documents: " + drive["problem"]
        if memo_note:
            status["message"] += " " + memo_note
        if "wrong secret" in status["message"].lower():
            status["message"] = "Wrong secret: " + diagnose_script(cfg)
            access = None
        if access:
            status["access"] = access
            if not access["ok"]:
                status["message"] += " Access list: " + access["problem"]
            elif access["failed"]:
                status["message"] += (" Access list: could not share with " + ", ".join(access["failed"][:5]) +
                                      " (they need a Google account).")
        with DB() as c:
            setting_set(c, "appsheet_status", json.dumps(status))
            if status["ok"]:
                setting_set(c, "appsheet_last_ok", now)
                setting_set(c, "appsheet_hash", digest)
        if not status["ok"]:
            print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  AppSheet sync: {status['message']}")
        return status


def appsheet_loop():
    """Background timer: sync every N minutes when switched on."""
    while True:
        time.sleep(30)
        try:
            with DB() as c:
                cfg = setting_all(c)
            if cfg.get("appsheet_enabled") != "1" or not cfg.get("appsheet_url"):
                continue
            every = max(5, int(cfg.get("appsheet_minutes") or 10)) * 60
            if time.time() - float(cfg.get("appsheet_last_attempt") or 0) >= every:
                appsheet_sync()
        except Exception as e:                           # never let the timer stop the server
            print(f"AppSheet timer: {e}")


APPSHEET_SCRIPT = r"""/**
 * Company COA System -> Google Sheet + Google Drive (for AppSheet)   - script version 4
 * 1. Paste this whole script into Extensions > Apps Script of your Google Sheet and press Save.
 * 2. Deploy > New deployment > type "Web app" > Execute as: Me > Who has access: Anyone > Deploy.
 * 3. Copy the Web app URL (ends with /exec) into Settings > AppSheet in the Company system.
 * The secret below must match the one in the Company system. Do not share it.
 * Documents are saved in the Drive folder "Company COA Documents" (one folder per Form No.),
 * shared as "Anyone with the link - Viewer".
 * After changing this script: Deploy > Manage deployments > Edit > Version: New version > Deploy.
 * First time only: choose "authorizeDrive" in the function list at the top, press Run and Allow (Google Drive access).
 */

function authorizeDrive() {
  // Run this once from the editor so Google asks for Drive permission.
  const root = DriveApp.getRootFolder();
  Logger.log('Drive access OK - documents will be saved in "Company COA Documents" in ' + root.getName());
}
const SECRET = '__SECRET__';

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return out({ ok: false, error: 'Bad data' }); }
  if (body.secret !== SECRET) return out({ ok: false, error: 'Wrong secret - copy the script again from the Company system' });
  if (body.action === 'file') return out(saveFile(body));
  if (body.action === 'trash') return out(trashFile(body));
  if (body.action === 'access') return out(setAccess(body));
  if (body.action === 'memoDecisions') return out(memoDecisions());
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const counts = {};
    Object.keys(body.sheets).forEach(function (name) {
      const rows = body.sheets[name];
      if (name === 'Memo Approval') keepDecisions(ss.getSheetByName(name), rows);
      const sh = ss.getSheetByName(name) || ss.insertSheet(name);
      const width = rows[0].length, old = sh.getLastRow();
      if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
      if (sh.getMaxRows() < rows.length) sh.insertRowsAfter(sh.getMaxRows(), rows.length - sh.getMaxRows());
      sh.getRange(1, 1, rows.length, width).setValues(rows);
      if (old > rows.length) sh.getRange(rows.length + 1, 1, old - rows.length, sh.getMaxColumns()).clearContent();
      if (sh.getLastColumn() > width) sh.getRange(1, width + 1, Math.max(old, rows.length), sh.getLastColumn() - width).clearContent();
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, width).setFontWeight('bold');
      counts[name] = rows.length - 1;
    });
    const info = ss.getSheetByName('Sync Info') || ss.insertSheet('Sync Info');
    const infoRows = [['Last sync', new Date()]].concat(Object.keys(counts).map(function (k) { return [k + ' (rows)', counts[k]]; }));
    info.clearContents();
    info.getRange(1, 1, infoRows.length, 2).setValues(infoRows);
    info.getRange(1, 2).setNumberFormat('dd/MM/yyyy HH:mm:ss');
    info.getRange(2, 2, infoRows.length - 1, 1).setNumberFormat('0').setHorizontalAlignment('left');
    info.getRange(1, 1, infoRows.length, 1).setFontWeight('bold');
    return out({ ok: true, counts: counts });
  } finally {
    lock.releaseLock();
  }
}

function docsRoot() {
  const props = PropertiesService.getScriptProperties();
  let root = null;
  const id = props.getProperty('DOCS_FOLDER');
  if (id) { try { root = DriveApp.getFolderById(id); if (root.isTrashed()) root = null; } catch (err) { root = null; } }
  if (!root) { root = DriveApp.createFolder('Company COA Documents'); props.setProperty('DOCS_FOLDER', root.getId()); }
  return root;
}

function docsFolder(form) {
  const root = docsRoot();
  const it = root.getFoldersByName(form);
  return it.hasNext() ? it.next() : root.createFolder(form);
}

// Who may see the Google Sheet and the documents: exactly the listed emails (restricted), or anyone with the link.
function setAccess(b) {
  const want = (b.viewers || []).map(function (e) { return String(e).toLowerCase(); });
  const restricted = b.mode === 'restricted';
  const targets = [DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId()), docsRoot()];
  let added = 0, removed = 0, filesFixed = 0;
  const failed = [];
  targets.forEach(function (t) {
    const owner = ((t.getOwner() && t.getOwner().getEmail()) || '').toLowerCase();
    const editors = t.getEditors().map(function (u) { return u.getEmail().toLowerCase(); });
    const viewers = t.getViewers().map(function (u) { return u.getEmail().toLowerCase(); });
    want.forEach(function (e) {
      if (e === owner || editors.indexOf(e) >= 0 || viewers.indexOf(e) >= 0) return;
      try { t.addViewer(e); added++; } catch (err) { if (failed.indexOf(e) < 0) failed.push(e); }
    });
    viewers.forEach(function (e) {
      if (want.indexOf(e) < 0 && editors.indexOf(e) < 0) { try { t.removeViewer(e); removed++; } catch (err) { /* not removable */ } }
    });
    if (restricted) t.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE);
  });
  const walk = function (folder) {
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      try {
        if (restricted && f.getSharingAccess() !== DriveApp.Access.PRIVATE) {
          f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); filesFixed++;
        } else if (!restricted && f.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK) {
          f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); filesFixed++;
        }
      } catch (err) { /* Workspace may block link sharing */ }
    }
    const subs = folder.getFolders();
    while (subs.hasNext()) walk(subs.next());
  };
  walk(docsRoot());
  return { ok: true, added: added, removed: removed, filesFixed: filesFixed, failed: failed };
}

function saveFile(b) {
  const blob = Utilities.newBlob(Utilities.base64Decode(b.data), b.mime || 'application/octet-stream', b.name);
  const file = docsFolder(b.form || 'Other').createFile(blob);
  file.setDescription(b.program + ' ' + b.form + ' - ' + b.document + ' (' + b.key + ')');
  let shared = true;
  if (!b.restricted) {   // restricted: the file only gets the access of its folder (the listed emails)
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) { shared = false; }
  }
  return { ok: true, id: file.getId(), url: file.getUrl(), shared: shared };
}

// Memo Approval: the person in charge sets Decision = Approve in AppSheet (Decided By = their Google account).
// The Company system collects them at each sync; the cells are then emptied so a decision is used only once.
function memoDecisions() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Memo Approval');
    if (!sh || sh.getLastRow() < 2) return { ok: true, decisions: [] };
    const v = sh.getDataRange().getValues(), h = v[0];
    const iNo = h.indexOf('Memo No'), iDec = h.indexOf('Decision'), iBy = h.indexOf('Decided By');
    const out = [];
    for (let r = 1; r < v.length; r++) {
      if (String(v[r][iDec]).trim()) {
        out.push({ memoNo: v[r][iNo], decision: v[r][iDec], by: v[r][iBy] });
        sh.getRange(r + 1, iDec + 1, 1, 2).setValues([['', '']]);
      }
    }
    return { ok: true, decisions: out };
  } finally {
    lock.releaseLock();
  }
}

function keepDecisions(sh, rows) {
  // a Decision made in AppSheet while the new data arrives is kept for the next sync
  if (!sh || sh.getLastRow() < 2) return;
  const v = sh.getDataRange().getValues(), h = v[0];
  const iNo = h.indexOf('Memo No'), iDec = h.indexOf('Decision'), iBy = h.indexOf('Decided By');
  const keep = {};
  for (let r = 1; r < v.length; r++) if (String(v[r][iDec]).trim()) keep[v[r][iNo]] = [v[r][iDec], v[r][iBy]];
  const n = rows[0].indexOf('Memo No'), d = rows[0].indexOf('Decision'), b = rows[0].indexOf('Decided By');
  for (let r = 1; r < rows.length; r++) if (keep[rows[r][n]]) { rows[r][d] = keep[rows[r][n]][0]; rows[r][b] = keep[rows[r][n]][1]; }
}

function trashFile(b) {
  try { DriveApp.getFileById(b.driveId).setTrashed(true); } catch (err) { /* already gone */ }
  return { ok: true };
}

function doGet() {
  // version + a short code made from the secret (not the secret itself), so the Company system can check this deployment
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, SECRET, Utilities.Charset.UTF_8);
  const check = d.map(function (b) { return ((b + 256) % 256).toString(16).padStart(2, '0'); }).join('').slice(0, 8);
  return out({ ok: true, version: 4, check: check, message: 'Company COA sync is ready. The Company system sends data here by itself.' });
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
"""


# ================================================================ Email alerts
#   Super Admin + Admins get every alert (one email); each User gets only the alerts of the forms they created or changed.
#   Unsettled job : a COA / Consignment Test form still in Draft (not submitted) with no change for N days (default 2);
#                   reminded again every N days while it stays like that.
#   COA expiry    : a COA Application whose COA expires in 30, 15 and 5 days (each once per expiry date).
ALERT_LOCK = threading.Lock()


ALERT_TYPES = ("unsettled", "expiry", "saved", "ebatch")


def alert_on(cfg, kind):
    """Alerts are chosen per person now (user_prefs) - every type is always collected."""
    return True


def user_prefs(r):
    """Which alerts one person receives. Default: Super Admin / Admin all; User unsettled + expiry."""
    base = {"unsettled": True, "expiry": True, "saved": r["role"] in ("superadmin", "admin"),
            "ebatch": r["role"] in ("superadmin", "admin")}
    try:
        base.update({k: bool(v) for k, v in json.loads(r["alert_prefs"] or "{}").items() if k in ALERT_TYPES})
    except ValueError:
        pass
    return base


def admin_recipients(c):
    return [(r["id"], r["name"], r["email"], user_prefs(r)) for r in c.execute(
        "SELECT id, name, email, role, alert_prefs FROM users WHERE active=1 AND role IN ('superadmin','admin')"
        " AND email IS NOT NULL AND email != '' ORDER BY name")]


def field_label(key):
    ct = dict(CT_SHEET)
    base = key[:-5] if key.endswith("__att") else key
    return LABELS.get(key) or ct.get(key) or SIRIM_DOCS.get(key) or LABELS.get(base) or key


def save_people_prefs(c, people):
    """{"<user id>": {"unsettled": bool, "expiry": bool, "saved": bool}, ...} from the Email Alerts page."""
    if not isinstance(people, dict):
        return
    for uid, pref in people.items():
        if str(uid).isdigit() and isinstance(pref, dict):
            c.execute("UPDATE users SET alert_prefs=? WHERE id=?",
                      (json.dumps({k: bool(pref.get(k)) for k in ALERT_TYPES}), int(uid)))


def email_ready(cfg):
    return bool(cfg.get("mail_host") and cfg.get("mail_from"))


def send_mail(cfg, to, subject, text, html_body, from_name="Company Portal"):
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((from_name, cfg["mail_from"]))
    msg["To"] = ", ".join(to)
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    host, port, sec = cfg["mail_host"], int(cfg.get("mail_port") or 587), cfg.get("mail_security") or "starttls"
    ctx = ssl.create_default_context()
    smtp = smtplib.SMTP_SSL(host, port, timeout=30, context=ctx) if sec == "ssl" else smtplib.SMTP(host, port, timeout=30)
    with smtp:
        if sec == "starttls":
            smtp.starttls(context=ctx)
        if cfg.get("mail_user"):
            smtp.login(cfg["mail_user"], cfg.get("mail_password") or "")
        smtp.send_message(msg)


def mail_error_text(e, cfg):
    """Plain-language explanation of a mail sending problem."""
    raw = str(e)
    host, port = cfg.get("mail_host") or "?", cfg.get("mail_port") or 587
    low = raw.lower()
    if isinstance(e, socket.gaierror) or "getaddrinfo" in low or "name or service not known" in low:
        why = (f"The mail server name '{host}' cannot be found. Check the spelling (e.g. smtp.office365.com / smtp.gmail.com) "
               f"and that this server PC has internet access. Test it on the server PC: nslookup {host}")
    elif isinstance(e, (socket.timeout, TimeoutError)) or "timed out" in low or "10060" in low:
        why = (f"No answer from {host} on port {port}. The port is probably blocked by the firewall / internet provider, "
               f"or the port is wrong (587 for STARTTLS, 465 for SSL, 25 for none).")
    elif isinstance(e, ConnectionRefusedError) or "10061" in low or "refused" in low:
        why = f"{host} refused the connection on port {port} - check the port number."
    elif isinstance(e, smtplib.SMTPAuthenticationError) or "535" in raw or "authentication" in low:
        why = ("The mail server rejected the login or password. Office 365: 'Authenticated SMTP' must be allowed for this "
               "mailbox. Gmail: use a Google App password, not the normal password.")
    elif isinstance(e, ssl.SSLError) or "wrong version number" in low or "ssl" in low:
        why = "Security setting does not match the port: use STARTTLS with 587, or SSL/TLS with 465."
    elif isinstance(e, smtplib.SMTPSenderRefused) or "send as" in low or "sendasdenied" in low.replace(" ", ""):
        why = "The mail server does not allow this From address - use the same address as the login mailbox."
    elif "auth extension not supported" in low:
        why = (f"{host} does not accept a login on port {port} with this security setting. Use port 587 with STARTTLS "
               f"(or 465 with SSL/TLS) - or, for an internal mail relay that needs no login, leave Login and Password empty.")
    elif isinstance(e, smtplib.SMTPRecipientsRefused):
        why = "The mail server refused the receiver's email address - check that the address is correct."
    else:
        why = "The mail server returned an error."
    return f"{why}\n\n(Technical detail: {raw})"


def user_recipients(c):
    """Users (role User) with an email, and the forms each one worked on: {user_id: (name, email, {doc ids})}."""
    out = {r["id"]: (r["name"], r["email"], set(), user_prefs(r)) for r in c.execute(
        "SELECT id, name, email, role, alert_prefs FROM users WHERE active=1 AND role='user' AND email IS NOT NULL AND email != ''")}
    if not out:
        return out
    for q in ("SELECT DISTINCT app_id doc, user_id uid FROM audit_log",          # everything they changed (COA + Consignment Test)
              "SELECT app_id doc, user_id uid FROM contributors",
              "SELECT id doc, created_by uid FROM apps", "SELECT id doc, created_by uid FROM sirim"):
        for r in c.execute(q):
            if r["uid"] in out:
                out[r["uid"]][2].add(r["doc"])
    return out


def alert_recipients(c):
    return [(r["name"], r["email"]) for r in c.execute(
        "SELECT name, email FROM users WHERE active=1 AND role IN ('superadmin','admin') AND email IS NOT NULL AND email != ''"
        " ORDER BY name")]


def expiry_levels(cfg):
    out = set()
    for x in re.split(r"[,\s]+", cfg.get("alert_expiry_days") or "30,15,5"):
        if x.isdigit() and 0 < int(x) <= 365:
            out.add(int(x))
    return sorted(out) or [30, 15, 5]


def collect_alerts(c, cfg, now):
    """New alerts that have not been sent yet: [{kind, doc, tag, program, formNo, title, detail, link}]"""
    nm = names(c)
    link = site_url(cfg)
    idle_days = max(1, int(cfg.get("alert_unsettled_days") or 2))
    idle = idle_days * 86400
    last = {}
    for r in c.execute("SELECT kind, doc_id, tag, MAX(sent_at) t FROM alert_log GROUP BY kind, doc_id, tag"):
        last[(r["kind"], r["doc_id"], r["tag"])] = r["t"]
    stats = app_statuses(c)
    items = []

    def unsettled(doc_id, program, form_no, title, row, path):
        quiet = now - (row["updated_at"] or row["created_at"] or now)
        sent = last.get(("unsettled", doc_id, ""))
        if quiet >= idle and (not sent or now - sent >= idle - 3600):       # every N days while unsettled
            items.append({"kind": "unsettled", "doc": doc_id, "tag": "", "program": program, "formNo": form_no, "title": title,
                          "vars": {"days": int(quiet // 86400), "user": nm.get(row["updated_by"], "-"),
                                   "time": time.strftime("%d/%m/%Y %H:%M", time.localtime(row["updated_at"] or 0))},
                          "link": f"{link}/#/{path}/{doc_id}"})

    renewed = set()
    apps = c.execute("SELECT * FROM apps WHERE cancelled_at IS NULL").fetchall()
    for r in apps:
        prev = (json.loads(r["data"]).get("prevCoaNo") or "").strip().upper()
        if prev:
            renewed.add(prev)
    levels = expiry_levels(cfg)
    for r in apps:
        d = json.loads(r["data"])
        title = " · ".join(x for x in (d.get("equipmentName"), d.get("companyModel")) if x) or "-"
        if alert_on(cfg, "unsettled") and (d.get("stStatus") or "Not Submitted") == "Not Submitted" and \
                not any(((stats.get(r["id"]) or {}).get(sid) or {"status": ""})["status"] == "submitted" for sid in SECTIONS):
            unsettled(r["id"], "COA Application", r["form_no"], title, r, "app")
        for kind, coa_no, exp in coas_of(d):                                 # ST COA and / or eCOS COA
            days = days_until(exp) if exp else None
            if not alert_on(cfg, "expiry") or days is None or days < 0 or coa_no.strip().upper() in renewed:
                continue
            level = next((lv for lv in levels if days <= lv), None)           # 5, 15 or 30
            tag = f"{level}:{exp}" if kind == "ST" else f"ecos:{level}:{exp}"
            if level is not None and ("expiry", r["id"], tag) not in last:
                items.append({"kind": "expiry", "doc": r["id"], "tag": tag, "program": "COA Application",
                              "formNo": r["form_no"], "title": title,
                              "vars": {"coaNo": (coa_no or "-") + ("" if kind == "ST" else " (eCOS)"),
                                       "expiryDate": date.fromisoformat(exp[:10]).strftime("%d/%m/%Y"), "days": days, "level": level},
                              "link": f"{link}/#/app/{r['id']}", "days": days})
    for r in c.execute("SELECT * FROM sirim WHERE cancelled_at IS NULL").fetchall():
        st = (stats.get(r["id"]) or {}).get(SIRIM_SEC)
        if alert_on(cfg, "unsettled") and (not st or st["status"] != "submitted"):
            d = json.loads(r["data"])
            title = " · ".join(x for x in (d.get("ctProductName"), d.get("ctModel")) if x) or (("COA No. " + d["coaNo"]) if d.get("coaNo") else "-")
            unsettled(r["id"], "Consignment Test", r["form_no"], title, r, "sirim")
    # "Saved": someone pressed Save on a form -> who, which form, what changed
    for ev in c.execute("SELECT * FROM save_events WHERE sent_at IS NULL ORDER BY at").fetchall():
        tbl, path = ("apps", "app") if ev["program"] == "coa" else ("sirim", "sirim")
        row = c.execute(f"SELECT * FROM {tbl} WHERE id=?", (ev["doc_id"],)).fetchone()
        if not row or row["cancelled_at"] or not alert_on(cfg, "saved"):
            items.append({"kind": "saved", "doc": ev["doc_id"], "tag": str(ev["id"]), "skip": True})
            continue
        d = json.loads(row["data"])
        title = " · ".join(x for x in ((d.get("equipmentName"), d.get("companyModel")) if tbl == "apps"
                                       else (d.get("ctProductName"), d.get("ctModel"))) if x) or "-"
        prev = c.execute("SELECT MAX(sent_at) FROM save_events WHERE doc_id=? AND user_id=? AND sent_at IS NOT NULL",
                         (ev["doc_id"], ev["user_id"])).fetchone()[0]
        since = max(prev or 0, ev["at"] - 12 * 3600)
        changed = []
        for a in c.execute("SELECT action, field, new_value FROM audit_log WHERE app_id=? AND user_id=? AND at>? AND at<=? ORDER BY at",
                           (ev["doc_id"], ev["user_id"], since, ev["at"] + 60)):
            if a["action"] == "file_upload":
                lab = f"uploaded {a['new_value']}"
            elif a["action"] == "file_remove":
                lab = f"removed a file ({field_label(a['field'] or '')})"
            elif a["field"]:
                lab = field_label(a["field"]) + (" (checklist)" if a["action"] in ("check", "uncheck") else "")
            else:
                continue
            if lab not in changed:
                changed.append(lab)
        more = f" and {len(changed) - 12} more" if len(changed) > 12 else ""
        items.append({"kind": "saved", "doc": ev["doc_id"], "tag": str(ev["id"]), "saver": ev["user_id"],
                      "program": "COA Application" if tbl == "apps" else "Consignment Test", "formNo": row["form_no"], "title": title,
                      "vars": {"user": nm.get(ev["user_id"], "-"), "time": time.strftime("%d/%m/%Y %H:%M", time.localtime(ev["at"])),
                               "changes": (", ".join(changed[:12]) + more) if changed else "no changes since the last save"},
                      "link": f"{link}/#/{path}/{ev['doc_id']}"})
    items.sort(key=lambda i: ({"expiry": 0, "saved": 1, "unsettled": 2}[i["kind"]], i.get("days", 0), i.get("formNo", "")))
    return items


DEFAULT_TPL = {
    "subject_prefix": "[Company COA]",
    "greeting": "Hello,\nthese items in the Company Portal need attention:",
    "footer": "Links open the form in the Company COA system (office network).\nSent automatically.",
    "expiry_heading": "COA expiring soon",
    "expiry_line": "COA No. {coaNo} expires on {expiryDate} - in {days} days ({level}-day alert).",
    "saved_heading": "Saved - please check / submit",
    "saved_line": "Saved by {user} on {time}. Changed: {changes}.",
    "unsettled_heading": "Unsettled jobs (Draft, no change)",
    "unsettled_line": "Still Draft (not submitted) - no change for {days} days. Last change by {user} on {time}.",
    "test_text": "This is a test from the Company Portal, sent by {user}.\nEmail alerts can be sent.",
}
TPL_FIELDS = {   # placeholders each template part may use (shown on the edit page)
    "expiry_line": ["formNo", "title", "program", "coaNo", "expiryDate", "days", "level"],
    "saved_line": ["formNo", "title", "program", "user", "time", "changes"],
    "unsettled_line": ["formNo", "title", "program", "days", "user", "time"],
    "test_text": ["user"],
}


def fill(template, values):
    """Replace {name} with its value; unknown names and stray braces stay as typed."""
    return re.sub(r"\{(\w+)\}", lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), template)


def email_tpl(cfg):
    tpl = dict(DEFAULT_TPL)
    try:
        tpl.update({k: str(v) for k, v in json.loads(cfg.get("email_tpl") or "{}").items() if k in DEFAULT_TPL})
    except ValueError:
        pass
    return tpl


def _html_lines(text):
    return "<br>".join(html.escape(x) for x in text.split("\n"))


def alert_email(items, tpl=None):
    tpl = tpl or dict(DEFAULT_TPL)
    exp = [i for i in items if i["kind"] == "expiry"]
    job = [i for i in items if i["kind"] == "unsettled"]
    sav = [i for i in items if i["kind"] == "saved"]
    parts = []
    if exp:
        parts.append(f"{len(exp)} COA expiring")
    if sav:
        parts.append(f"{len(sav)} form{'s' if len(sav) != 1 else ''} saved")
    if job:
        parts.append(f"{len(job)} unsettled job{'s' if len(job) != 1 else ''}")
    subject = (tpl["subject_prefix"].strip() + " " + ", ".join(parts)).strip()
    text, rows_html = [], []
    for kind, group, colour in (("expiry", exp, "#b45309"), ("saved", sav, "#15803d"), ("unsettled", job, "#1d4ed8")):
        if not group:
            continue
        title = tpl[f"{kind}_heading"]
        text.append(title.upper())
        rows_html.append(f'<h3 style="color:{colour};font-family:Segoe UI,Arial;margin:18px 0 6px">{html.escape(title)} ({len(group)})</h3>'
                         '<table cellpadding="6" style="border-collapse:collapse;font-family:Segoe UI,Arial;font-size:13px">')
        for i in group:
            i["detail"] = fill(tpl[f"{kind}_line"], {"formNo": i["formNo"], "title": i["title"], "program": i["program"], **i.get("vars", {})})
            text.append(f"- {i['formNo']} ({i['program']}) {i['title']}: {i['detail']}  {i['link']}")
            rows_html.append(f'<tr style="border-bottom:1px solid #e5e7eb"><td><a href="{html.escape(i["link"])}"><b>{html.escape(i["formNo"])}</b></a>'
                             f'<br><span style="color:#6b7280">{html.escape(i["program"])}</span></td>'
                             f'<td><b>{html.escape(i["title"])}</b><br>{html.escape(i["detail"])}</td></tr>')
        rows_html.append("</table>")
        text.append("")
    text = [tpl["greeting"], ""] + text + [tpl["footer"]]
    body = ('<div style="font-family:Segoe UI,Arial;font-size:14px">'
            f'<p>{_html_lines(tpl["greeting"])}</p>' + "".join(rows_html) +
            f'<p style="color:#6b7280;font-size:12px;margin-top:18px">{_html_lines(tpl["footer"])}</p></div>')
    return subject, "\n".join(text), body


def test_email(tpl, user_name):
    body = fill(tpl["test_text"], {"user": user_name})
    return ((tpl["subject_prefix"].strip() + " Test email").strip(), body,
            f"<p style='font-family:Segoe UI,Arial'>{_html_lines(body)}</p>")


def sample_items():
    """Example alerts for the template preview."""
    return [
        {"kind": "expiry", "program": "COA Application", "formNo": "COMPANY-COA-004", "title": "HAIR DRYER · DHD-39", "link": "#",
         "vars": {"coaNo": "SJT161105096152026", "expiryDate": "03/10/2026", "days": 4, "level": 5}},
        {"kind": "saved", "program": "COA Application", "formNo": "COMPANY-COA-001", "title": "ELECTRIC KETTLE · DK-1700", "link": "#",
         "vars": {"user": "Ben User", "time": "29/09/2026 14:20", "changes": "Name of Electrical Equipment, Colours, uploaded CB test report.pdf"}},
        {"kind": "unsettled", "program": "Consignment Test", "formNo": "COMPANY-CTA-002", "title": "TOASTER · DTS-2", "link": "#",
         "vars": {"days": 3, "user": "Alice Admin", "time": "26/09/2026 10:15"}}]


def alert_run(who="auto"):
    """Check the conditions and send one email with everything new. Returns the status shown in Settings."""
    with ALERT_LOCK:
        now = time.time()
        with DB() as c:
            cfg = setting_all(c)
            setting_set(c, "alert_last_check", now)
            to = admin_recipients(c)
            users = user_recipients(c)
            items = collect_alerts(c, cfg, now) if email_ready(cfg) else []
        skipped = [i for i in items if i.get("skip")]              # saves of cancelled forms / "Saved" alert switched off
        items = [i for i in items if not i.get("skip")]
        # each Super Admin / Admin: everything except their own saves; each User: alerts of the forms they worked on
        jobs, seen = [], set()
        for uid, name, mail, pref in to:                          # Super Admin / Admin: all forms, the alert types they ticked
            if mail.lower() in seen:
                continue
            seen.add(mail.lower())
            its = [i for i in items if pref.get(i["kind"]) and not (i["kind"] == "saved" and i.get("saver") == uid)]
            if its:
                jobs.append(([mail], its, name))
        for uid, (name, mail, docs, pref) in users.items():        # User: only their own forms, the alert types they ticked
            its = [i for i in items if i["doc"] in docs and pref.get(i["kind"]) and not (i["kind"] == "saved" and i.get("saver") == uid)]
            if its and mail.lower() not in seen:
                seen.add(mail.lower())
                jobs.append(([mail], its, name))
        if not email_ready(cfg):
            status = {"ok": False, "at": now, "message": "Email is not set up yet (mail server and From address)."}
        elif not to and not users:
            status = {"ok": False, "at": now, "message": "Nobody to send to - add an email address to the users (Administration > Users)."}
        elif not items:
            status = {"ok": True, "at": now, "message": f"Checked ({who}) - nothing new to send.", "sent": 0}
            with DB() as c:
                c.executemany("UPDATE save_events SET sent_at=? WHERE id=?", [(now, int(i["tag"])) for i in skipped])
        elif not jobs:
            with DB() as c:                                        # saves nobody else can be told about are done
                c.executemany("UPDATE save_events SET sent_at=? WHERE id=?",
                              [(now, int(i["tag"])) for i in items + skipped if i["kind"] == "saved"])
            if all(i["kind"] == "saved" for i in items):
                status = {"ok": True, "at": now, "message": f"Checked ({who}) - nothing to send (no other person to tell).", "sent": 0}
            else:
                status = {"ok": False, "at": now, "message": f"{len(items)} alert(s) found, but nobody with an email is linked to them - "
                                                             "add an email address to the Super Admin / Admin users."}
        else:
            sent_to, failed, sent_items = [], [], set()
            tpl = email_tpl(cfg)
            for addrs, its, label in jobs:
                subject, text, body = alert_email(its, tpl)
                try:
                    send_mail(cfg, addrs, subject, text, body)
                    sent_to.append(label)
                    sent_items.update((i["kind"], i["doc"], i["tag"]) for i in its)
                except Exception as e:
                    failed.append(f"{label}: {mail_error_text(e, cfg)}")
            # a save nobody else could be told about (e.g. the only Admin saved it) is done too
            done_saves = {i["tag"] for i in skipped} | {t for k, d, t in sent_items if k == "saved"}
            if not failed:
                done_saves |= {i["tag"] for i in items if i["kind"] == "saved"}
            with DB() as c:
                c.executemany("INSERT INTO alert_log(kind, doc_id, tag, sent_at) VALUES(?,?,?,?)",
                              [(k, d, t, now) for k, d, t in sent_items if k != "saved"])
                c.executemany("UPDATE save_events SET sent_at=? WHERE id=?", [(now, int(t)) for t in done_saves])
            subject = alert_email(items, tpl)[0]
            status = {"ok": not failed, "at": now, "sent": len(sent_items), "subject": subject,
                      "message": (f"Sent ({who}): {subject.replace('[Company COA] ', '')} to {', '.join(sent_to)}." if sent_to
                                  else "Nothing to send - no other person to tell." if not failed else "")
                                 + (" Problem: " + " | ".join(failed) if failed else "")}
            status["message"] = status["message"].strip()[:900]
            if failed:
                print(f"{time.strftime('%Y-%m-%d %H:%M:%S')}  Email alert: {status['message']}")
        with DB() as c:
            setting_set(c, "alert_status", json.dumps(status))
        return status


def alert_loop():
    """Background timer: check the alerts every 30 minutes when switched on."""
    time.sleep(60)
    while True:
        try:
            with DB() as c:
                cfg = setting_all(c)
            if cfg.get("alert_enabled") == "1" and time.time() - float(cfg.get("alert_last_check") or 0) >= 1800:
                alert_run()
        except Exception as e:                           # never let the timer stop the server
            print(f"Email alert timer: {e}")
        time.sleep(60)


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("10.255.255.255", 1))  # no packets are sent
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return None


if __name__ == "__main__":
    class Server(ThreadingHTTPServer):
        # Never share the port: on Windows, address reuse would let a second copy start on the same port.
        allow_reuse_address = False
        daemon_threads = True

        def server_bind(self):
            if hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
                self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            super().server_bind()

    srv = None
    for attempt in range(16):       # after a restart the port can take a few seconds to be released
        try:
            srv = Server((BIND, PORT), Handler)
            break
        except OSError:
            if attempt == 0:
                print(f" Waiting for port {PORT} ...")
            time.sleep(0.5)
    if srv is None:
        print("=" * 60)
        print(f" Port {PORT} is already in use by another program (or the server is already running).")
        print(f" Open config.txt in this folder, change PORT= to another number, save, and start again.")
        print("=" * 60)
        sys.exit(1)
    SERVER = srv
    backfill_versions()
    threading.Thread(target=appsheet_loop, daemon=True).start()
    threading.Thread(target=alert_loop, daemon=True).start()
    threading.Thread(target=mc_loop, daemon=True).start()
    with DB() as _c:                                    # Email Batch: carry on where sending stopped (server restart)
        for (_bid,) in _c.execute("SELECT id FROM eb_batches WHERE status='sending' AND cancelled_at IS NULL").fetchall():
            eb_start(_bid)
    srv.daemon_threads = True
    print("=" * 60)
    print(" Company Portal")
    print(f"   This PC:        http://localhost:{PORT}")
    ip = lan_ip()
    if BIND == "127.0.0.1":
        print("   Office network: (off - only this PC, e.g. the Cloudflare Tunnel; BIND=127.0.0.1 in config.txt)")
    elif ip:
        print(f"   Office network: http://{ip}:{PORT}")
    print(" Keep this window open. Press Ctrl+C to stop.")
    print("=" * 60)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    srv.server_close()
    CONN.close()
    if RESTART_REQUESTED:
        print("\n Restarting the server ...\n")
        sys.exit(RESTART_EXIT_CODE)
