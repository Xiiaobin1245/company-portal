/* =========================================================
   COA Application Form & Checklist – Company Name
   Based on "COA application check list.xlsx"
   Talks to server.py (login, shared database, attachments).
   ========================================================= */

const YES_NO = ["Yes", "No"];
const YES_NO_NA = ["Yes", "No", "N/A"];
// Section B "ST / eCOS" decides which payment / status items Section I shows (nothing ticked = ST, as before)
const stEcosTicks = d => String(d?.stEcos || "").split(/[,/;]+/).map(x => x.trim().toLowerCase()).filter(Boolean)
  .map(x => /^e[\s-]*cos/.test(x) ? "ecos" : x === "st" ? "st" : x);
// a tab that already has details filled in is always shown (so nothing typed there can disappear)
const tabHasData = (d, tab) => (SECTIONS.find(s => s.id === "I")?.items || [])
  .some(it => it.only === tab && !["stStatus", "ecosStatus"].includes(it.key) && String(d?.[it.key] ?? "").trim());
const showsST = d => { const t = stEcosTicks(d); return !t.length || t.includes("st") || tabHasData(d, "st"); };
const showsECOS = d => stEcosTicks(d).includes("ecos") || tabHasData(d, "ecos");
const tabShown = (t, d) => t === "st" ? showsST(d) : showsECOS(d);
const mainStatus = sum => (!showsST(sum) && showsECOS(sum) ? sum.ecosStatus : sum.stStatus) || "Not Submitted";
// the COA(s) of a form: the ST tab and / or the eCOS tab
const coasOf = sum => [showsST(sum) && { kind: "ST", no: sum.coaNo, exp: sum.coaExpiry },
  showsECOS(sum) && { kind: "eCOS", no: sum.ecosCoaNo, exp: sum.ecosCoaExpiry }].filter(Boolean);
const secTab = {};                        // open tab per section, e.g. { I: "ecos" }
function activeTab(s, d) {
  const shown = (s.tabs || []).filter(t => tabShown(t.id, d)).map(t => t.id);
  if (!shown.includes(secTab[s.id])) secTab[s.id] = shown[0];
  return secTab[s.id];
}

/* ---------- Form definition (mirrors the Excel sheet) ---------- */
const SECTIONS = [
  {
    id: "A", short: "Application Info", title: "A. APPLICATION INFORMATION",
    items: [
      { key: "appType", label: "Application Type", type: "select", opt: "appType", required: true },
      { key: "purpose", label: "Application Purpose", type: "select", opt: "purpose", required: true },
      { key: "pic", label: "Person in Charge", type: "text", required: true },
      { key: "requestedDate", label: "Requested Application Date", type: "date" },
      { key: "ePermitDateA", label: "e-Permit Application Date", type: "date" },
      { key: "prevCoaNo", label: "Previous COA No. (if renewal)", type: "text", showIf: d => d.appType === "Renewal", hint: "Only required for renewal" },
    ],
  },
  {
    id: "B", short: "Product Info", title: "B. PRODUCT INFORMATION",
    items: [
      { key: "equipmentName", label: "Name of Electrical Equipment", type: "text", required: true },
      { key: "productCategory", label: "Product Category", type: "text", list: "productCategory" },
      { key: "supplierBrand", label: "Supplier Brand", type: "text" },
      { key: "companyBrand", label: "Company Brand", type: "text" },
      { key: "supplierModel", label: "Supplier Model", type: "text" },
      { key: "companyModel", label: "Company Model", type: "text", required: true },
      { key: "colours", label: "Colours", type: "text" },
      { key: "hsCode", label: "HS Code", type: "text" },
      { key: "ratedVoltage", label: "Rated Voltage", type: "text", placeholder: "e.g. 220-240V~" },
      { key: "ratedFrequency", label: "Rated Frequency", type: "text", placeholder: "e.g. 50Hz" },
      { key: "ratedPower", label: "Rated Power / Current", type: "text", placeholder: "e.g. 1200W / 5A" },
      { key: "productClass", label: "Product Class / Type", type: "select", opt: "productClass" },
      { key: "stEcos", label: "ST / eCOS", type: "multi", options: ["ST", "eCOS"], hint: "Tick one or both" },
    ],
  },
  {
    id: "C", short: "Manufacturer Info", title: "C. MANUFACTURER INFORMATION",
    items: [
      { key: "manufacturerName", label: "Manufacturer Name", type: "text", required: true },
      { key: "factoryName", label: "Factory Name", type: "text" },
      { key: "factoryAddress", label: "Factory Address", type: "textarea" },
      { key: "mfgCountry", label: "Country", type: "text", list: "country" },
    ],
  },
  {
    id: "D", short: "Type Test Report", title: "D. TYPE TEST REPORT",
    items: [
      { key: "testReportNo", label: "Test Report No.", type: "text", required: true },
      { key: "testReportDate", label: "Test Report Date", type: "date", required: true },
      { key: "testLab", label: "Testing Laboratory", type: "text" },
      { key: "standard", label: "Applicable Standard", type: "text", placeholder: "e.g. MS IEC 60335-1" },
      { key: "testModelDesc", label: "Test Model Description", type: "textarea" },
      { key: "testValidUntil", label: "Test Report Valid Until", type: "computed", hint: "Five years from Test Report Date",
        compute: d => addYears(d.testReportDate, 5) },
      { key: "cbRefNo", label: "CB Ref Certif No.", type: "text" },
      { key: "cbRefDate", label: "CB Ref Certif Date", type: "date" },
    ],
  },
  {
    id: "E", short: "Technical Documents", title: "E. PRODUCT TECHNICAL DOCUMENTS",
    items: [
      { key: "docTypeTest", label: "Type Test Report", type: "file", required: true },
      { key: "docCB", label: "CB Test Report", type: "file" },
      { key: "docComponents", label: "List of Components", type: "file" },
      { key: "docManual", label: "Instruction Manual", type: "file" },
      { key: "docTechSpec", label: "Technical Specification", type: "file" },
      { key: "docCatalogue", label: "Product Catalogue", type: "file" },
      { key: "docSample", label: "Product Sample, if requested", type: "file", note: true },
      { key: "docTrademark", label: "Trade Mark", type: "file" },
      { key: "docMarkingPlate", label: "Product Marking Plate (Label Rating)", type: "file" },
      { key: "docAuthLetter", label: "Letter of Authorisation", type: "file" },
      { key: "docOthers", label: "Other Supporting Documents", type: "doclist", hint: "Add a remark, then upload that document – one by one" },
    ],
  },
  {
    id: "F", short: "Energy Efficiency", title: "F. ENERGY EFFICIENCY CHECK",
    note: "Applicable for Energy-Using Products (EUP), where required.",
    items: [
      { key: "isEup", label: "Is product an Energy-Using Product?", type: "select", options: YES_NO },
      { key: "eupCategory", label: "Product Category", type: "text", eup: true },
      { key: "meps", label: "MEPS Applicable", type: "select", options: YES_NO_NA, eup: true },
      { key: "energyReport", label: "Energy Performance Test Report", type: "file", eup: true },
      { key: "assessmentLetter", label: "Assessment Letter", type: "file", eup: true },
      { key: "coeRequired", label: "COE Required", type: "select", options: YES_NO, eup: true },
      { key: "coeNo", label: "COE No. (If available)", type: "text", eup: true },
      { key: "coeExpiry", label: "COE Expiry Date", type: "date", eup: true },
    ],
  },
  {
    id: "G", short: "Nameplate / Marking", title: "G. PRODUCT NAMEPLATE / MARKING CHECK",
    items: [
      { key: "npBrand", label: "Brand Correct", type: "verify" },
      { key: "npModel", label: "Model Correct", type: "verify" },
      { key: "npRating", label: "Electrical Rating Correct", type: "verify" },
      { key: "npMfg", label: "Manufacturer Information Correct", type: "verify" },
      { key: "npOrigin", label: "Country of Origin is Correct", type: "verify" },
      { key: "npMarking", label: "Required Marking is Available", type: "verify" },
    ],
  },
  {
    id: "H", short: "Import / Consignor", title: "H. IMPORT INFORMATION / CONSIGNOR INFORMATION",
    items: [
      { key: "supplier", label: "Supplier / Exporter", type: "text" },
      { key: "supplierAddress", label: "Supplier Address", type: "textarea" },
      { key: "shipCountry", label: "Country of Shipment", type: "text", list: "country" },
      { key: "portLoading", label: "Port of Loading", type: "port", portFrom: "shipCountry" },
      { key: "portArrival", label: "Port of Arrival", type: "port", portCountry: "Malaysia" },
      { key: "estShipDate", label: "Estimated Shipment Date", type: "date" },
      { key: "estArrivalDate", label: "Estimated Arrival Date", type: "date" },
      { key: "invoiceNo", label: "Invoice No.", type: "text", attach: "Upload document" },
      { key: "docPackingList", label: "Packing List", type: "file" },
      { key: "poNo", label: "Purchase Order No.", type: "text", attach: "Upload document" },
      { key: "blNo", label: "Bill of Lading / AWB No.", type: "text", attach: "Upload document" },
      { key: "containerNo", label: "Container No.", type: "text", attach: "Upload document" },
      { key: "customsHs", label: "Customs HS Code", type: "text" },
      { key: "k1No", label: "Customs Form (K1)", type: "text", placeholder: "K1 declaration no.", attach: "Upload K1" },
    ],
  },
  {
    id: "I", short: "COA Submission", title: "I. COA APPLICATION SUBMISSION",
    tabs: [{ id: "st", label: "ST" }, { id: "ecos", label: "eCOS" }],   // one tab per ticked "ST / eCOS" in Section B
    items: [
      // ---- ST tab
      { key: "ePermitDate", label: "e-Permit Application Date", type: "date", only: "st" },
      { key: "ePermitNo", label: "e-Permit Application No.", type: "text", only: "st" },
      { key: "submittedBy", label: "Submitted By", type: "text", only: "st" },
      { key: "submittedDate", label: "Submitted Date", type: "date", only: "st" },
      { key: "stFee", label: "ST Processing Fee", type: "money", attach: "Attached receipt", only: "st" },
      { key: "stFeeDate", label: "Payment Processing Fee Date", type: "date", only: "st" },
      { key: "paymentRef", label: "Payment Reference", type: "text", only: "st" },
      { key: "stStatus", label: "ST Status", type: "select", opt: "stStatus", superOnly: true, only: "st",
        hint: "Automatic: Not Submitted (draft) → Submitted when this section is submitted. Only Super Admin can change it." },
      { key: "terFee", label: "Technical Evaluation Fee", type: "money", only: "st" },
      { key: "terFeeDate", label: "Payment TER Fee Date", type: "date", attach: "Attached receipt", only: "st" },
      { key: "coaFee", label: "COA Fee", type: "money", attach: "Attached receipt", only: "st" },
      { key: "coaNo", label: "COA No.", type: "text", attach: "Attached COA", only: "st" },
      { key: "coaIssue", label: "COA Issue Date", type: "date", only: "st" },
      { key: "coaExpiry", label: "COA Expiry Date", type: "date", only: "st" },
      // ---- eCOS tab (same items; "label" is used in the audit trail / emails, "display" on the form)
      { key: "ecosEPermitDate", label: "eCOS e-Permit Application Date", display: "e-Permit Application Date", type: "date", only: "ecos" },
      { key: "ecosEPermitNo", label: "eCOS e-Permit Application No.", display: "e-Permit Application No.", type: "text", only: "ecos" },
      { key: "ecosSubmittedBy", label: "eCOS Submitted By", display: "Submitted By", type: "text", only: "ecos" },
      { key: "ecosSubmittedDate", label: "eCOS Submitted Date", display: "Submitted Date", type: "date", only: "ecos" },
      { key: "ecosFee", label: "eCOS Processing Fee", type: "money", attach: "Attached receipt", only: "ecos" },
      { key: "ecosFeeDate", label: "eCOS Payment Processing Fee Date", display: "Payment Processing Fee Date", type: "date", only: "ecos" },
      { key: "ecosPaymentRef", label: "eCOS Payment Reference", display: "Payment Reference", type: "text", only: "ecos" },
      { key: "ecosStatus", label: "eCOS Status", type: "select", opt: "stStatus", superOnly: true, only: "ecos",
        hint: "Automatic: Not Submitted (draft) → Submitted when this section is submitted. Only Super Admin can change it." },
      { key: "ecosTerFee", label: "eCOS Technical Evaluation Fee", display: "Technical Evaluation Fee", type: "money", only: "ecos" },
      { key: "ecosTerFeeDate", label: "eCOS Payment TER Fee Date", display: "Payment TER Fee Date", type: "date", attach: "Attached receipt", only: "ecos" },
      { key: "ecosCoaFee", label: "eCOS COA Fee", display: "COA Fee", type: "money", attach: "Attached receipt", only: "ecos" },
      { key: "ecosCoaNo", label: "eCOS COA No.", display: "COA No.", type: "text", attach: "Attached COA", only: "ecos" },
      { key: "ecosCoaIssue", label: "eCOS COA Issue Date", display: "COA Issue Date", type: "date", only: "ecos" },
      { key: "ecosCoaExpiry", label: "eCOS COA Expiry Date", display: "COA Expiry Date", type: "date", only: "ecos" },
    ],
  },
];

// Choices for dropdowns and suggestion lists - loaded from the server, edited under Administration > Settings
let OPTIONS = {};
const OPTION_LISTS = [
  { key: "appType", name: "Application Type", where: "A. Application Info – dropdown" },
  { key: "purpose", name: "Application Purpose", where: "A. Application Info – dropdown" },
  { key: "productCategory", name: "Product Category", where: "B. Product Info – suggestions" },
  { key: "productClass", name: "Product Class / Type", where: "B. Product Info – dropdown" },
  { key: "country", name: "Country", where: "C. Manufacturer Country, H. Country of Shipment – suggestions (also used for Ports)" },
  { key: "stStatus", name: "ST Status", where: "I. COA Submission – dropdown" },
];
const ITEM_BY_KEY = Object.fromEntries(SECTIONS.flatMap(s => s.items).map(i => [i.key, i]));
const portLabel = p => `${p.code} – ${p.name}`;
// Port of Loading: ports of the Country of Shipment. Port of Arrival: Malaysian ports.
function portChoices(it) {
  const country = (it.portCountry || current?.data[it.portFrom] || "").trim();
  const all = OPTIONS.ports || [];
  return { country, list: country ? all.filter(p => p.country.toLowerCase() === country.toLowerCase()) : all };
}
function openCombo(input) {
  const it = ITEM_BY_KEY[input.dataset.key];
  const box = input.parentElement.querySelector(".combo-list");
  const { country, list } = portChoices(it);
  let q = input.value.toLowerCase().trim();
  if (list.some(p => portLabel(p).toLowerCase() === q)) q = "";          // a port is already chosen: show them all
  const hits = list.filter(p => !q || portLabel(p).toLowerCase().includes(q)).slice(0, 60);
  box.innerHTML = hits.length
    ? hits.map(p => `<div class="combo-opt" data-pick="${esc(portLabel(p))}"><strong>${esc(p.code)}</strong><span>${esc(p.name)}</span><span class="muted">${esc(p.country)}</span></div>`).join("")
    : `<div class="combo-empty muted">No matching port${country ? ` in ${esc(country)}` : ""}. You can type it in, or ask the Super Admin to add it under Settings.</div>`;
  box.hidden = false;
}

function optionList(it, cur) {
  const base = OPTIONS[it.opt] || [];
  return cur && !base.includes(cur) ? [...base, cur] : base;   // keep a value that was removed from the list later
}

/* ---------- Helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const today = () => new Date().toISOString().slice(0, 10);

function addYears(iso, n) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  d.setFullYear(d.getFullYear() + n);
  d.setDate(d.getDate() - 1);
  return toIso(d);
}
function toIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function fmtDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso + "T00:00:00") - new Date(today() + "T00:00:00")) / 86400000);
}
function fmtSize(b) {
  return b < 1024 ? b + " B" : b < 1048576 ? (b / 1024).toFixed(0) + " KB" : (b / 1048576).toFixed(1) + " MB";
}
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------- Derived state ---------- */
const ROLE_LABEL = { superadmin: "Super Admin", admin: "Admin", user: "User", viewer: "Viewer" };

const secInfo = (rec, id) => rec.sections?.[id] || {};
const visibleSections = rec => SECTIONS.filter(s => secInfo(rec, s.id).view);

function isApplicable(item, d) {
  if (item.showIf && !item.showIf(d)) return false;
  if (item.only === "st" && !showsST(d)) return false;
  if (item.only === "ecos" && !showsECOS(d)) return false;
  if (item.eup && d.isEup === "No") return false;
  return true;
}
function progress(rec, section) {
  const secs = section ? [section] : visibleSections(rec);
  let total = 0, done = 0;
  for (const s of secs) for (const it of s.items) {
    if (!isApplicable(it, rec.data)) continue;
    total++;
    if (rec.checks[it.key]) done++;
  }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}
function statusOf(rec) {
  if (rec.cancelled) return { label: "Cancelled", cls: "cancelled" };
  const sum = rec.summary || rec.data;
  const s = mainStatus(sum);
  const map = {
    "Not Submitted": ["Draft", "draft"],
    "Submitted": ["Submitted", "submitted"],
    "Under Evaluation": ["Under Evaluation", "review"],
    "Query / Additional Info Required": ["Query from ST", "review"],
    "Approved": ["Approved", "approved"],
    "Rejected": ["Rejected", "rejected"],
  };
  let [label, cls] = map[s] || [s, "draft"];
  // whole checklist ticked (all sections) -> Completed
  if (rec.summary?.completed) [label, cls] = ["Completed", "completed"];
  // a COA that expires within 1 month (or has expired) needs attention first
  const due = coasOf(sum).filter(c => c.exp && !isRenewed(rec, c.no)).map(c => ({ ...c, d: daysUntil(c.exp) })).sort((x, y) => x.d - y.d)[0];
  if (due) {
    const name = coasOf(sum).length > 1 ? `${due.kind} COA` : "COA";
    if (due.d < 0) [label, cls] = [`${name} Expired`, "expired"];
    else if (due.d <= COA_ALERT_DAYS) [label, cls] = [`${name} expires in ${due.d} day${due.d === 1 ? "" : "s"}`, "expiring"];
  }
  return { label, cls };
}

// ---- COA expiry alert: from 1 month before the COA Expiry Date
const COA_ALERT_DAYS = 30;
// a renewal application (Previous COA No. = this COA No.) stops the alert
const isRenewed = (a, no) => !!no && apps.some(x => x !== a && !x.cancelled &&
  (x.summary?.prevCoaNo || "").trim().toUpperCase() === no.trim().toUpperCase());
const renewedBy = a => !!a.summary?.coaNo && isRenewed(a, a.summary.coaNo);
function coaAlerts() {                    // one line per COA (ST and / or eCOS) that expires within 1 month
  return apps.filter(a => !a.cancelled && a.summary)
    .flatMap(a => coasOf(a.summary).filter(c => c.exp && !isRenewed(a, c.no)).map(c => ({ a, c, days: daysUntil(c.exp) })))
    .filter(x => x.days <= COA_ALERT_DAYS)
    .sort((x, y) => x.days - y.days);
}
const daysText = d => d < 0 ? `expired ${-d} day${d === -1 ? "" : "s"} ago` : d === 0 ? "expires TODAY" : `expires in ${d} day${d === 1 ? "" : "s"}`;
// MC Request: own requests near the end of the lead time (hand in the original MC) / requests waiting for HR
let mcNotices = { reminders: [], waiting: 0 };
async function loadMcNotices() {
  if (!(me?.mcSubmit || me?.mcHR)) { mcNotices = { reminders: [], waiting: 0 }; return; }
  try {
    const d = await api("GET", "/api/mc");
    mcNotices = { reminders: d.reminders || [], waiting: d.hr ? d.requests.filter(r => r.status === "submitted").length : 0 };
  } catch { /* keep the last */ }
  updateBell();
}
function mcReminderDialog() {
  const list = mcNotices.reminders;
  if (!list.length) return;
  openDialog(`<h3>🩺 Please hand in your original MC</h3>
    <p class="muted" style="margin:0">HR needs the original copy of these MCs. If it does not reach HR in time, the request is rejected automatically.</p>
    <div class="alert-list">${list.map(r => `<a class="alert-item bad" href="#/mc/${r.id}" data-close-dialog>
      <span><strong>${esc(r.docNo)}</strong> · ${esc(r.docType)} · applied ${fmtDate(r.dateApply)}</span>
      <span class="alert-days">${r.leadLeft} day${r.leadLeft === 1 ? "" : "s"} left</span></a>`).join("")}</div>`, async () => {}, "OK", true);
  $("#dialog").querySelectorAll("[data-close-dialog]").forEach(l => l.onclick = () => $("#dialog").close());
}

// Email Batch: batches sending, waiting for the daily limit, paused, or finished in the last 24 hours
let ebNotices = [];
async function loadEbNotices() {
  if (!me?.ebView) { ebNotices = []; return; }
  try {
    const { batches } = await api("GET", "/api/eb");
    const now = Date.now() / 1000;
    ebNotices = batches.filter(b => b.status === "sending" || (b.status === "stopped" && b.note)
      || (["sent", "partial"].includes(b.status) && b.finishedAt && now - b.finishedAt < 86400));
  } catch { /* keep the last list */ }
  updateBell();
}
const ebNoticeText = b => b.status === "sending" ? (b.waitUntil ? "⏳ waiting for the daily limit" : `📤 sending… ${b.sent} of ${b.total}`)
  : b.status === "stopped" ? "⏸ PAUSED – action needed" : `✔ finished – ${b.sent} sent${b.failed ? `, ${b.failed} failed` : ""}`;
function updateBell() {
  const coa = coaAlerts().length, mcN = mcNotices.reminders.length + mcNotices.waiting, mmN = memoNotices.unread + memoNotices.approvals,
    n = coa + ebNotices.length + mcN + mmN;
  const bell = $("#bellBtn");
  bell.hidden = !me;                       // always visible once signed in
  bell.classList.toggle("none", !n);       // grey when there is nothing
  bell.title = n ? [coa ? `${coa} COA${coa > 1 ? "s" : ""} expire within 1 month or have expired` : "",
    ebNotices.length ? `${ebNotices.length} email batch notice${ebNotices.length > 1 ? "s" : ""}` : "",
    mcNotices.reminders.length ? `${mcNotices.reminders.length} original MC to hand in` : "",
    mcNotices.waiting ? `${mcNotices.waiting} MC request(s) waiting for HR` : "",
    memoNotices.approvals ? `${memoNotices.approvals} memo(s) waiting for your approval` : "",
    memoNotices.unread ? `${memoNotices.unread} new memo(s)` : ""].filter(Boolean).join(" · ")
    : "No COA is expiring within 1 month";
  $("#bellCount").textContent = n;
}
function coaAlertDialog() {
  const list = coaAlerts();
  if (!list.length && !ebNotices.length && !mcNotices.reminders.length && !mcNotices.waiting) {
    if (memoNotices.approvals) { location.hash = "#/memo/approval"; return; }
    if (memoNotices.unread) { location.hash = "#/memo"; return; }
    toast("No COA is expiring within 1 month"); return;
  }
  if (!list.length && !ebNotices.length) {
    if (mcNotices.reminders.length) { mcReminderDialog(); return; }
    location.hash = "#/mc"; return;
  }
  const ebHtml = ebNotices.length ? `
    <h3 style="margin-top:${list.length ? "18px" : "0"}">📧 Email Batch</h3>
    <div class="alert-list">${ebNotices.map(b => `
      <a class="alert-item ${b.status === "stopped" ? "bad" : ""}" href="#/eb/${b.id}" data-close-dialog>
        <span><strong>${esc(b.batchNo)}</strong> · ${esc(b.title || b.subject || "—")}<br>
          <span class="muted">${b.sent} sent · ${b.failed} failed · ${b.pending} waiting${b.note ? " – " + esc(b.note.split("\n")[0]).slice(0, 140) : ""}</span></span>
        <span class="alert-days">${ebNoticeText(b)}</span>
      </a>`).join("")}</div>` : "";
  if (!list.length) {
    openDialog(ebHtml, async () => {}, "OK", true);
    $("#dialog").querySelectorAll("[data-close-dialog]").forEach(l => l.onclick = () => $("#dialog").close());
    return;
  }
  openDialog(`
    <h3>⚠ COA expiry alert</h3>
    <p class="muted" style="margin:0">These COAs expire within 1 month (or have expired). Start the renewal in time –
      the alert stops when a Renewal application with this COA No. as Previous COA No. is created.</p>
    <div class="alert-list">${list.map(({ a, c, days }) => `
      <a class="alert-item ${days < 0 ? "bad" : ""}" href="#/app/${a.id}" data-close-dialog>
        <span><strong>${esc(a.formNo)}</strong> · ${esc(a.summary.equipmentName || "—")} ${a.summary.companyModel ? "· " + esc(a.summary.companyModel) : ""}<br>
          <span class="muted">${c.kind} COA No. ${esc(c.no || "—")} · expiry ${fmtDate(c.exp)}</span></span>
        <span class="alert-days">${daysText(days)}</span>
      </a>`).join("")}</div>${ebHtml}`, async () => {}, "OK", true);
  $("#dialog").querySelectorAll("[data-close-dialog]").forEach(l => l.onclick = () => $("#dialog").close());
}
// status used by the Dashboard filter and counters
const statusKey = a => a.cancelled ? "Cancelled" : a.summary?.completed ? "Completed" : mainStatus(a.summary || {});
function alertsOf(rec) {
  const d = rec.data, out = [];
  const vis = new Set(visibleSections(rec).map(s => s.id));
  const tv = vis.has("D") && addYears(d.testReportDate, 5);
  if (tv) {
    const n = daysUntil(tv);
    if (n < 0) out.push({ bad: true, msg: `Type test report expired on ${fmtDate(tv)}` });
    else if (n <= 180) out.push({ msg: `Type test report expires in ${n} days (${fmtDate(tv)})` });
  }
  for (const c of coasOf(rec.summary || d)) {
    if (!c.exp) continue;
    const n = daysUntil(c.exp), name = coasOf(rec.summary || d).length > 1 ? `${c.kind} COA` : "COA";
    if (n < 0) out.push({ bad: true, msg: `${name} expired on ${fmtDate(c.exp)}` });
    else if (n <= COA_ALERT_DAYS) out.push({ bad: true, msg: `${name} expires in ${n} days – plan renewal now` });
  }
  if (vis.has("F") && d.isEup !== "No" && d.coeExpiry) {
    const n = daysUntil(d.coeExpiry);
    if (n < 0) out.push({ bad: true, msg: `COE expired on ${fmtDate(d.coeExpiry)}` });
    else if (n <= 90) out.push({ msg: `COE expires in ${n} days` });
  }
  for (const s of visibleSections(rec)) for (const it of s.items) {
    if (!it.required || !isApplicable(it, d)) continue;
    if (!isFilled(rec, it)) out.push({ msg: `${s.id}: "${it.label}" is required` });
  }
  if (vis.has("G")) for (const it of SECTIONS.find(s => s.id === "G").items) {
    if (d[it.key] === "No") out.push({ bad: true, msg: `Nameplate check failed: ${it.label}` });
  }
  return out;
}
function isFilled(rec, it) {
  if (it.type === "file" || it.type === "doclist") return (rec.files[it.key] || []).length > 0;
  if (it.type === "computed") return !!it.compute(rec.data);
  return !!rec.data[it.key];
}

/* ---------- API ---------- */
// ask("Remove this file?") -> true (OK) / false (Cancel), shown in the page itself
function ask(message, okLabel = "OK", cancelLabel = "Cancel") {
  return new Promise(resolve => {
    let d = document.getElementById("askDlg");
    if (!d) {
      d = document.createElement("dialog");
      d.id = "askDlg";
      d.className = "ask-dlg";
      document.body.append(d);
    }
    d.innerHTML = `<div class="ask-msg"></div>
      <div class="dlg-actions">${cancelLabel ? `<button type="button" class="btn" data-ans="0">${esc(cancelLabel)}</button>` : ""}
        <button type="button" class="btn btn-primary" data-ans="1">${esc(okLabel)}</button></div>`;
    d.querySelector(".ask-msg").textContent = message;
    const done = v => { d.onclose = null; if (d.open) d.close(); resolve(v); };
    d.onclick = e => { const b = e.target.closest("[data-ans]"); if (b) done(b.dataset.ans === "1"); };
    d.onclose = () => resolve(false);                  // Esc key = Cancel
    d.showModal();
    d.querySelector('[data-ans="1"]').focus();
  });
}
// Print / Save as PDF: the browser names the PDF after the page title, so use the Form No. (e.g. COMPANY-CTA-006.pdf)
function printAs(name) {
  const old = document.title;
  const clean = String(name || "").replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
  if (clean) document.title = clean;
  const restore = () => { document.title = old; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  window.print();
  setTimeout(restore, 1000);
}

// a message with only an OK button
const tell = message => ask(message, "OK", "");

async function api(method, url, body) {
  const opts = { method, headers: { "X-Requested-With": "coa" }, credentials: "same-origin" };
  if (body instanceof Blob) {
    opts.body = body;
    opts.headers["Content-Type"] = body.type || "application/octet-stream";
  } else if (body !== undefined) {
    opts.body = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
  }
  let r;
  try {
    r = await fetch(url, opts);
  } catch {
    throw Object.assign(new Error("Cannot reach the server. Is it running?"), { status: 0 });
  }
  const data = (r.headers.get("content-type") || "").includes("json") ? await r.json() : null;
  if (!r.ok) {
    if (r.status === 403 && data?.mustChangePassword && me) {
      me.mustChangePassword = true;
      showChangePassword();
    }
    if (r.status === 401 && me && url !== "/api/login") {
      me = null;
      showAuth("login", "Your session has expired. Please sign in again.");
    }
    throw Object.assign(new Error(data?.error || r.statusText), { status: r.status, data });
  }
  return data;
}

/* ---------- State ---------- */
let me = null;            // signed-in user
let apps = [];            // applications this user can see
let current = null;       // application open in the form
let saveTimer = null, saving = null, dirty = false;
let pending = emptyPending();   // changed fields not yet saved

function emptyPending() { return { data: {}, checks: {}, remarks: {}, meta: {} }; }
const canCreate = () => !!me?.canCreate;
const isAdmin = () => me?.role === "admin" || me?.role === "superadmin";
const isSuper = () => me?.role === "superadmin";
const canAudit = () => ["superadmin", "admin", "viewer"].includes(me?.role);
const initials = n => (n || "?").split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase();
const fmtTime = ts => ts ? new Date(ts * 1000).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "—";

function upsertApp(a) {
  const i = apps.findIndex(x => x.id === a.id);
  if (i >= 0) apps[i] = a; else apps.unshift(a);
}

/* =========================================================
   LOGIN / SETUP
   ========================================================= */
function showAuth(mode, msg = "") {
  current = null;
  clearTimeout(saveTimer); saveTimer = null; dirty = false; pending = emptyPending();
  $("#shell").hidden = true;
  if ($("#dialog").open) $("#dialog").close();
  const setup = mode === "setup";
  const auth = $("#auth");
  auth.hidden = false;
  auth.innerHTML = `
    <div class="auth-card">
      <img class="logo" src="logo.png" alt="Company" />
      <h1>COMPANY NAME SDN BHD</h1>
      <div class="sub">${setup ? "First-time setup – create the Super Admin account" : "Company Portal"}</div>
      <form id="authForm">
        ${setup ? `<label class="field"><span>Full name</span><input type="text" name="name" required autocomplete="name" /></label>` : ""}
        <label class="field"><span>Username</span><input type="text" name="username" required autocomplete="username" /></label>
        <label class="field"><span>Password</span><input type="password" name="password" required ${setup ? 'minlength="10" autocomplete="new-password"' : 'autocomplete="current-password"'} /></label>
        ${setup ? `<label class="field"><span>Confirm password</span><input type="password" name="confirm" required minlength="10" autocomplete="new-password" /></label>` : ""}
        <div class="form-error" id="authErr">${esc(msg)}</div>
        <button class="btn btn-primary" type="submit">${setup ? "Create account & sign in" : "Sign in"}</button>
      </form>
      <div class="auth-foot">${setup ? "Password: at least 10 characters with letters and numbers." : "Forgot your password? Ask your Super Admin to reset it."}</div>
      <div class="auth-lang no-tr">🌐 ${Object.entries(LANGS).map(([k, [name]]) => k === LANG ? `<strong>${name}</strong>`
        : `<a href="#" data-setlang="${k}">${name}</a>`).join(" · ")}</div>
    </div>`;
  auth.querySelector("input").focus();
  $("#authForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = $("#authErr");
    err.textContent = "";
    if (setup && f.password !== f.confirm) { err.textContent = "Passwords do not match."; return; }
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      me = (await api("POST", setup ? "/api/setup" : "/api/login", f)).user;
      enterApp(true);
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  };
}

// First sign-in (or after a password reset): the person must choose their own password.
function showChangePassword() {
  clearTimeout(saveTimer); saveTimer = null; dirty = false;
  $("#shell").hidden = true;
  if ($("#dialog").open) $("#dialog").close();
  const auth = $("#auth");
  auth.hidden = false;
  auth.innerHTML = `
    <div class="auth-card">
      <img class="logo" src="logo.png" alt="Company" />
      <h1>Change your password</h1>
      <div class="sub">Welcome, ${esc(me.name)}. Please set your own password before you continue.</div>
      <form id="pwForm">
        <label class="field"><span>Current password (the one you were given)</span><input type="password" name="current" required autocomplete="current-password" /></label>
        <label class="field"><span>New password</span><input type="password" name="new" required minlength="10" autocomplete="new-password" /></label>
        <label class="field"><span>Confirm new password</span><input type="password" name="confirm" required minlength="10" autocomplete="new-password" /></label>
        <div class="form-error" id="pwErr"></div>
        <button class="btn btn-primary" type="submit">Save new password</button>
      </form>
      <div class="auth-foot">At least 10 characters, with letters and numbers. <a href="#" id="pwLogout">Sign out</a></div>
    </div>`;
  auth.querySelector("input").focus();
  $("#pwLogout").onclick = e => { e.preventDefault(); signOut(); };
  $("#pwForm").onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target)), err = $("#pwErr");
    err.textContent = "";
    if (f.new !== f.confirm) { err.textContent = "New passwords do not match."; return; }
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    try {
      await api("POST", "/api/me/password", { current: f.current, new: f.new });
      me.mustChangePassword = false;
      toast("Password changed");
      enterApp(true);
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
}

async function enterApp(fresh = false) {                   // fresh = just signed in / set a new password
  if (me.mustChangePassword) return showChangePassword();
  $("#auth").hidden = true;
  $("#auth").innerHTML = "";
  $("#shell").hidden = false;
  $("#userName").textContent = me.name;
  if ($("#langBtn")) $("#langBtn").textContent = "🌐 Language / Bahasa / 语言";
  if ($("#installBtn")) $("#installBtn").hidden = !installEvt && (window.matchMedia("(display-mode: standalone)").matches || !/iPhone|iPad|Android/i.test(navigator.userAgent));
  if ($("#langTopTxt")) $("#langTopTxt").textContent = LANGS[LANG][1] + " ▾";
  $("#userRole").textContent = ROLE_LABEL[me.role] || me.role;
  $("#avatar").textContent = initials(me.name);
  $("#navSettings").hidden = $("#adminLabel").hidden = !(isSuper() || me.role === "admin");   // User Manual (same box) is for everyone
  $("#navAudit").hidden = !canAudit();
  $("#progSirim").hidden = !me.sirimAccess;
  $("#progCoa").hidden = me.coaAccess === false;             // only the programs ticked under Access Control
  $("#deptPurchase").hidden = me.coaAccess === false && !me.sirimAccess;
  $("#deptMarketing").hidden = !me.ebView;
  $("#deptHR").hidden = !(me.hrView || me.hrCoverage || me.mcSubmit || me.mcHR || me.trFill || me.trHR || me.taFill || me.taHR);
  $("#progTr").hidden = !(me.trFill || me.trHR);
  $("#progTa").hidden = !(me.taFill || me.taHR);
  $("#navTaNew").hidden = !me.taFill;
  $("#deptWH").hidden = !me.whView;
  $("#navWhNew").hidden = !me.whEdit;
  $("#navTrNew").hidden = !me.trFill;
  $("#progHrStaff").hidden = !(me.hrView || me.hrCoverage);
  $("#progMc").hidden = !(me.mcSubmit || me.mcHR);
  $("#navMcNew").hidden = !me.mcSubmit;
  $("#navMemoList").hidden = !me.memoHR;
  $("#navMemoAppr").hidden = !me.memoApprove;
  $("#navSirimAudit").hidden = !canAudit();
  OPTIONS = (await api("GET", "/api/options")).options;
  await loadApps();
  // every user starts on General > Dashboard after signing in (and in a new tab); a link to a page still opens that page
  let landed = false;
  try { landed = sessionStorage.getItem("portal.landed") === "1"; sessionStorage.setItem("portal.landed", "1"); } catch { /* private window */ }
  if ((fresh || !landed) && ["", "#", "#/"].includes(location.hash)) history.replaceState(null, "", "#/general");
  route();
  const seenKey = `coa.alertSeen.${me.id}`;
  let seen = false;
  try { seen = sessionStorage.getItem(seenKey) === "1"; sessionStorage.setItem(seenKey, "1"); } catch {}
  if (!seen && coaAlerts().length) setTimeout(coaAlertDialog, 400);
  loadMemoNotices();
  markNewUpdates();
  if (!seen && (me.mcSubmit || me.mcHR)) loadMcNotices().then(() => { if (mcNotices.reminders.length && !coaAlerts().length) mcReminderDialog(); });
}

async function signOut() {
  await flushSave();
  try { await api("POST", "/api/logout", {}); } catch {}
  me = null; apps = [];
  history.replaceState(null, "", "#/");
  showAuth("login");
}

/* =========================================================
   SHELL: side menu, user menu, polling
   ========================================================= */
function bindShell() {
  window.addEventListener("hashchange", route);
  $("#menuBtn").onclick = () => document.body.classList.toggle("side-open");
  $("#backdrop").onclick = () => document.body.classList.remove("side-open");

  $("#bellBtn").onclick = e => { e.stopPropagation(); coaAlertDialog(); };
  $("#userBtn").onclick = e => { e.stopPropagation(); $("#userDrop").hidden = !$("#userDrop").hidden; };
  document.addEventListener("click", () => { $("#userDrop").hidden = true; });
  $("#userDrop").onclick = e => {
    const a = e.target.dataset.action;
    if (a === "logout") signOut();
    if (a === "password") passwordDialog();
    if (a === "signature") signatureDialog(null);
    if (a === "install") installApp();
    if (a === "lang") setTimeout(() => langMenu(document.getElementById("langTop")), 0);
  };

  // expand / collapse a program in the side menu
  document.querySelectorAll("[data-prog-toggle]").forEach(b =>
    b.onclick = () => b.closest(".program").classList.toggle("open"));
  // expand / collapse a department (e.g. Purchase Dept) with all its programs
  document.querySelectorAll("[data-dept-toggle]").forEach(b =>
    b.onclick = () => b.closest(".dept").classList.toggle("open"));

  // keep the dashboard up to date with other people's changes
  setInterval(() => { if (me && !document.hidden) loadApps(true).catch(() => {}); }, 30000);
  setInterval(() => { if (!document.hidden) checkSiteVersion(); }, 60000);

  window.addEventListener("beforeunload", e => {
    if (dirty || saving) { flushSave(); e.preventDefault(); e.returnValue = ""; }
  });
}

// ---- a proper suggestion list for every <input list="..."> (instead of the browser's own dark list):
//      search by any word (code, name, outlet), arrow keys + Enter, click; the chosen value fires "input" and "change" as typing does
const combo = { box: null, input: null, items: [], idx: -1 };
function comboOptions(input) {
  const dl = document.getElementById(input.dataset.combo);
  return dl ? [...dl.options].map(o => ({ v: o.value, t: (o.textContent || o.label || "").trim() })).filter(o => o.v) : [];
}
function comboClose() { combo.box?.remove(); combo.box = null; combo.input = null; combo.items = []; combo.idx = -1; }
function comboPlace() {
  if (!combo.box || !combo.input) return;
  const r = combo.input.getBoundingClientRect(), below = window.innerHeight - r.bottom;
  combo.box.style.left = Math.max(8, Math.min(r.left, window.innerWidth - Math.max(r.width, 280) - 8)) + "px";
  combo.box.style.width = Math.max(r.width, 280) + "px";
  if (below < 220 && r.top > below) { combo.box.style.top = ""; combo.box.style.bottom = (window.innerHeight - r.top + 4) + "px"; }
  else { combo.box.style.bottom = ""; combo.box.style.top = (r.bottom + 4) + "px"; }
}
function comboDraw() {
  const MAX = 150, list = combo.items.slice(0, MAX);
  combo.box.innerHTML = list.length ? list.map((o, i) => `<div class="combo-item ${i === combo.idx ? "on" : ""}" data-i="${i}">
      <strong>${esc(o.v)}</strong>${o.t && o.t !== o.v ? `<span>${esc(o.t)}</span>` : ""}</div>`).join("")
      + (combo.items.length > MAX ? `<div class="combo-more">${combo.items.length - MAX} more – keep typing to narrow</div>` : "")
    : `<div class="combo-more">Nothing matches – the typed text is kept.</div>`;
  combo.box.querySelector(".combo-item.on")?.scrollIntoView({ block: "nearest" });
}
function comboOpen(input) {
  const q = input.value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean), opts = comboOptions(input);
  if (!opts.length) { comboClose(); return; }
  const exact = opts.some(o => o.v.toLowerCase() === q);
  let items = !words.length || exact ? opts : opts.filter(o => words.every(w => (o.v + " " + o.t).toLowerCase().includes(w)));
  if (words.length && !exact) items.sort((a, b) => (b.v.toLowerCase().startsWith(q)) - (a.v.toLowerCase().startsWith(q)));
  if (combo.input !== input) {
    comboClose();
    combo.box = document.createElement("div");
    combo.box.className = "combo-box";
    (input.closest("dialog") || document.body).appendChild(combo.box);   // inside an open dialog, or it would be hidden behind it
    combo.input = input;
    combo.box.addEventListener("mousedown", e => {
      e.preventDefault();                                     // keep the focus in the box
      const it = e.target.closest(".combo-item");
      if (it) comboPick(+it.dataset.i);
    });
  }
  combo.items = items;
  combo.idx = exact ? items.findIndex(o => o.v.toLowerCase() === q) : -1;
  comboDraw(); comboPlace();
}
function comboPick(i) {
  const o = combo.items[i], input = combo.input;
  if (!o || !input) return;
  input.value = o.v;
  comboClose();
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}
function comboEnhance(root) {                                // <input list="x"> -> data-combo="x" (the browser list is switched off)
  (root.querySelectorAll ? root : document).querySelectorAll("input[list]").forEach(inp => {
    inp.dataset.combo = inp.getAttribute("list");
    inp.removeAttribute("list");
    inp.setAttribute("autocomplete", "off");
  });
}
document.addEventListener("focusin", e => { if (e.target.matches?.("input[data-combo]") && !e.target.disabled) comboOpen(e.target); });
document.addEventListener("input", e => { if (e.target.matches?.("input[data-combo]") && e.isTrusted) comboOpen(e.target); });
document.addEventListener("click", e => { if (e.target.matches?.("input[data-combo]") && !e.target.disabled && combo.input !== e.target) comboOpen(e.target); });
document.addEventListener("focusout", e => { if (e.target === combo.input) setTimeout(() => { if (document.activeElement !== combo.input) comboClose(); }, 120); });
document.addEventListener("keydown", e => {
  if (!combo.box || e.target !== combo.input) return;
  const n = Math.min(combo.items.length, 150);
  if (e.key === "ArrowDown" && n) { e.preventDefault(); combo.idx = (combo.idx + 1) % n; comboDraw(); }
  else if (e.key === "ArrowUp" && n) { e.preventDefault(); combo.idx = (combo.idx - 1 + n) % n; comboDraw(); }
  else if (e.key === "Enter" && combo.idx >= 0) { e.preventDefault(); comboPick(combo.idx); }
  else if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); comboClose(); }
  else if (e.key === "Tab") comboClose();
}, true);
window.addEventListener("resize", comboPlace);
document.addEventListener("scroll", e => { if (combo.box && !combo.box.contains(e.target)) comboPlace(); }, true);
new MutationObserver(ms => { for (const m of ms) { if (m.type === "attributes") comboEnhance(m.target.parentNode || document); else m.addedNodes.forEach(nd => nd.nodeType === 1 && comboEnhance(nd.matches?.("input[list]") ? nd.parentNode : nd)); } })
  .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["list"] });
comboEnhance(document);

// the ⋮ menus of the lists float above the page (a table box that scrolls would cut them off)
function placeRowMenus() {
  document.querySelectorAll(".tr-menu:not([hidden])").forEach(menu => {
    const btn = menu.previousElementSibling;
    if (!btn) return;
    const r = btn.getBoundingClientRect(), h = menu.offsetHeight, w = menu.offsetWidth;
    menu.style.left = Math.max(8, Math.min(r.right + 4, window.innerWidth - w - 8)) + "px";
    menu.style.top = (r.top + h + 8 > window.innerHeight ? Math.max(8, r.bottom - h) : r.top) + "px";
  });
}
document.addEventListener("click", e => {
  if (!e.target.closest(".tr-menu, [data-menu]")) document.querySelectorAll(".tr-menu:not([hidden])").forEach(m => { m.hidden = true; });
  placeRowMenus();
});
document.addEventListener("scroll", e => { if (!e.target.closest?.(".tr-menu")) document.querySelectorAll(".tr-menu:not([hidden])").forEach(m => { m.hidden = true; }); }, true);
window.addEventListener("resize", placeRowMenus);

// a newer portal version was copied to the server while this page was open: offer to reload (never automatic - typing is kept)
let siteVersion = null;
async function checkSiteVersion() {
  let v;
  try { v = (await (await fetch("/api/version", { cache: "no-store" })).json()).version; } catch { return; }
  if (!siteVersion) { siteVersion = v; return; }
  if (v === siteVersion || $("#newVersionBar")) return;
  document.body.insertAdjacentHTML("beforeend", `<div class="new-version" id="newVersionBar">🔄 A new version of the portal is ready.
    <button class="btn btn-sm btn-primary" id="nvReload">Reload</button><button class="btn btn-sm" id="nvLater" title="Reload later">Later</button></div>`);
  $("#nvReload").onclick = async () => { try { await flushSave(); } catch { /* keep going */ } location.reload(); };
  $("#nvLater").onclick = () => { $("#newVersionBar").remove(); siteVersion = v; };
}
checkSiteVersion();
async function loadApps(poll = false) {
  const list = (await api("GET", "/api/apps")).apps;
  if (current) {
    const srv = list.find(a => a.id === current.id);
    const i = list.findIndex(a => a.id === current.id);
    if (i >= 0) list[i] = current;
    if (poll && srv && !dirty && !saving && srv.updatedAt > current.updatedAt + 1) showRemoteBanner(srv);
  }
  apps = list;
  updateBell();
  loadEbNotices();
  loadMcNotices();
  loadMemoNotices();
  if (poll && !current && (location.hash || "#/") === "#/") renderDashboard();
}

// newest Form No. first: COMPANY-COA-011, -010, -009 ...
const formNum = a => +((a.formNo || "").match(/(\d+)\s*$/) || [0, 0])[1];
const byFormNo = (a, b) => formNum(b) - formNum(a);

function filterApps(q, fs) {
  q = q.toLowerCase().trim();
  return apps.filter(a => {
    if (fs && statusKey(a) !== fs) return false;
    if (!q) return true;
    const s = a.summary, d = a.data;
    return [a.formNo, s.equipmentName, s.companyModel, s.coaNo, s.ecosCoaNo, d.supplierModel, d.manufacturerName, d.companyBrand, d.supplierBrand]
      .some(v => (v || "").toLowerCase().includes(q));
  });
}

/* ---------- Router ---------- */
function renderNoProgram() {
  $("#app").innerHTML = `<div class="card" style="max-width:560px;margin:40px auto;padding:28px;text-align:center">
    <div style="font-size:40px">🔒</div><h2 style="margin:8px 0">No program yet</h2>
    <p class="muted">Your account has no program ticked yet. Ask the Super Admin to give you access under
      Settings › Access Control.</p></div>`;
}

async function route() {
  if (!me) return;
  await flushSave();
  await flushSirim();
  sirimCur = null;
  document.body.classList.remove("side-open");
  const h = location.hash || "#/";
  document.querySelectorAll("[data-nav]").forEach(a =>
    a.classList.toggle("active", (a.dataset.nav === "dash" && h === "#/") || h === "#/" + a.dataset.nav
      || (h.startsWith("#/" + a.dataset.nav + "/") && !(a.dataset.nav === "mc" && h === "#/mc/new") && !(a.dataset.nav === "tr" && h === "#/tr/new") && !(a.dataset.nav === "ta" && h === "#/ta/new") && !(a.dataset.nav === "wh" && h === "#/wh/new")
        && !(a.dataset.nav === "memo" && /^#\/memo\/(new|list|approval)/.test(h)))
      || (a.dataset.nav === "settings" && /^#\/(users|access)(\/|$)/.test(h))));
  // the side menu starts closed; the department (and program) of the page shown opens
  const act = document.querySelector(".sidebar [data-nav].active");
  if (act) { act.closest(".dept")?.classList.add("open"); act.closest(".program")?.classList.add("open"); }

  if (h === "#/new") {
    if (!canCreate()) { location.replace("#/"); return; }
    try {
      const { app } = await api("POST", "/api/apps", {});
      upsertApp(app);
      toast("Created " + app.formNo);
      location.replace("#/app/" + app.id);
    } catch (e) { toast(e.message); location.replace("#/"); }
    return;
  }

  current = null;
  pending = emptyPending();
  const coaPage = h === "#/" || /^#\/(app|audit)(\/|$)/.test(h) || h === "#/new";
  if (coaPage && me.coaAccess === false) {                    // no COA Application access: go to a program this person has
    const home = me.sirimAccess ? "#/sirim" : me.ebView ? "#/eb" : me.hrView || me.hrCoverage ? "#/hr" : me.mcSubmit || me.mcHR ? "#/mc" : me.trFill || me.trHR ? "#/tr" : me.taFill || me.taHR ? "#/ta" : me.whView ? "#/wh" : "#/memo";
    if (home) { location.replace(home); return; }
    renderNoProgram(); window.scrollTo(0, 0); return;
  }
  if (/^#\/sirim(\/|$)/.test(h) && !me.sirimAccess) { location.replace("#/"); return; }
  const m = h.match(/^#\/app\/(\w+)$/);
  if (m) {
    try {
      current = (await api("GET", `/api/apps/${m[1]}`)).app;
    } catch (e) {
      if (e.status === 404) { toast("Application not found"); location.replace("#/"); }
      return;
    }
    upsertApp(current);
    renderForm();
  } else if (/^#\/versions\/(coa|sirim)\/[0-9a-f]{16}$/.test(h) && canAudit()) {
    renderVersions(h.split("/")[2], h.split("/")[3]);
  } else if (h === "#/manual") {
    renderManual();
  } else if (h === "#/general") {
    renderGeneralDash();
  } else if (h === "#/memo") {
    renderMemoHome();
  } else if (h === "#/memo/new" && me.memoHR) {
    renderMemoNewPage();
  } else if ((h === "#/memo/new/upload" || h === "#/memo/new/manual") && me.memoHR) {
    renderMemoForm(null, h.split("/")[3]);
  } else if (h === "#/memo/list" && me.memoHR) {
    renderMemoList();
  } else if (h === "#/memo/approval" && me.memoApprove) {
    renderMemoApproval();
  } else if (/^#\/memo\/[0-9a-f]{16}\/edit$/.test(h) && me.memoHR) {
    renderMemoForm(h.split("/")[2]);
  } else if (/^#\/memo\/[0-9a-f]{16}$/.test(h)) {
    renderMemoOpen(h.split("/")[2]);
  } else if (h === "#/tr/new" && me.trFill) {
    renderTrForm(null);
  } else if (/^#\/tr\/[0-9a-f]{16}\/edit$/.test(h) && (me.trFill || me.trHR)) {
    renderTrForm(h.split("/")[2]);
  } else if (h === "#/tr" && (me.trFill || me.trHR)) {
    renderTrList();
  } else if (/^#\/tr\/[0-9a-f]{16}$/.test(h) && (me.trFill || me.trHR)) {
    renderTrView(h.split("/")[2]);
  } else if (h === "#/bi/collection") {
    renderBiCollection();
  } else if (h === "#/wh/new" && me.whEdit) {
    renderWhForm(null);
  } else if (/^#\/wh\/[0-9a-f]{16}\/edit$/.test(h) && me.whEdit) {
    renderWhForm(h.split("/")[2]);
  } else if (h === "#/wh" && me.whView) {
    renderWhList();
  } else if (/^#\/wh\/[0-9a-f]{16}$/.test(h) && me.whView) {
    renderWhScan(h.split("/")[2]);
  } else if (h === "#/ta/new" && me.taFill) {
    renderTaForm(null);
  } else if (/^#\/ta\/[0-9a-f]{16}\/edit$/.test(h) && me.taFill) {
    renderTaForm(h.split("/")[2]);
  } else if (h === "#/ta" && (me.taFill || me.taHR)) {
    renderTaList();
  } else if (/^#\/ta\/[0-9a-f]{16}$/.test(h) && (me.taFill || me.taHR)) {
    renderTaView(h.split("/")[2]);
  } else if (h === "#/mc/new" && me.mcSubmit) {
    renderMcForm();
  } else if (h === "#/mc" && (me.mcSubmit || me.mcHR)) {
    renderMcList();
  } else if (/^#\/mc\/[0-9a-f]{16}$/.test(h) && (me.mcSubmit || me.mcHR)) {
    renderMcView(h.split("/")[2]);
  } else if (h === "#/hr" && (me.hrView || me.hrCoverage)) {
    renderHrStaff();
  } else if (h === "#/eb" && me.ebView) {
    renderEbList();
  } else if (/^#\/eb\/[0-9a-f]{16}$/.test(h) && me.ebView) {
    renderEbBatch(h.split("/")[2]);
  } else if (h === "#/sirim") {
    renderSirimList();
  } else if (h === "#/sirim/new") {
    createSirim();
  } else if (/^#\/sirim\/[0-9a-f]{16}$/.test(h)) {
    renderSirimForm(h.split("/")[2]);
  } else if (h === "#/sirim-audit" && canAudit()) {
    renderSirimAuditList();
  } else if (/^#\/sirim-audit\/[0-9a-f]{16}$/.test(h) && canAudit()) {
    renderAuditDoc(h.split("/")[2], "sirim");
  } else if (h === "#/audit" && canAudit()) {
    renderAuditList();
  } else if (/^#\/audit\/\w+$/.test(h) && canAudit()) {
    renderAuditDoc(h.split("/")[2]);
  } else if (h === "#/settings" && (isSuper() || me.role === "admin")) {
    renderSettings();
  } else if (h === "#/settings/cta/locations" && canManageLocations()) {
    renderLocations();
  } else if (h === "#/settings/email-templates" && (isSuper() || me.role === "admin")) {
    renderEmailTemplates();
  } else if (h === "#/settings/wh" && (isSuper() || me.role === "admin" || me.whEdit)) {
    renderWhSettings();
  } else if (h === "#/settings/hr" && (isSuper() || me.role === "admin")) {
    renderHrSettings();
  } else if (h === "#/settings/email" && (isSuper() || me.role === "admin")) {
    renderEmailSettings();
  } else if (h === "#/settings/integration" && isSuper()) {
    renderIntegration();
  } else if (h === "#/settings/appsheet" && isSuper()) {
    renderAppSheet();
  } else if (h === "#/settings/coa/dropdown" && isSuper()) {
    renderDropdownSettings();
  } else if (h === "#/users" && isSuper()) {
    renderUsers();
  } else if (h === "#/access" && isSuper()) {
    renderAccess();
  } else if (/^#\/access\/\d+$/.test(h) && isSuper()) {
    renderAccessUser(+h.split("/")[2]);
  } else if (/^#\/access\/role\/(new|\d+)$/.test(h) && isSuper()) {
    renderAccessUser(null, h.split("/")[3] === "new" ? "new" : +h.split("/")[3]);
  } else {
    renderDashboard();
  }
  window.scrollTo(0, 0);
}

/* =========================================================
   DASHBOARD
   ========================================================= */
// Dashboard columns. std = shown by default; the rest can be switched on under "Columns".
const dv = (a, k) => esc(a.summary?.[k] || a.data?.[k] || "—");
const dd = (a, k) => { const v = a.summary?.[k] || a.data?.[k]; return v ? fmtDate(v) : "—"; };
// ST and / or eCOS value of a Section I item, e.g. "ST: X / eCOS: Y" when both are ticked
const both = (a, stKey, ecosKey, date) => {
  const sum = { ...(a.data || {}), ...(a.summary || {}) }, f = v => v ? (date ? fmtDate(v) : esc(v)) : "—";
  const parts = [showsST(sum) && ["ST", sum[stKey]], showsECOS(sum) && ["eCOS", sum[ecosKey]]].filter(Boolean);
  return parts.length > 1 ? parts.map(([k, v]) => `<span class="muted" style="font-size:11px">${k}</span> ${f(v)}`).join("<br>") : f(parts[0]?.[1]);
};
const DASH_COLS = [
  { key: "formNo", label: "Form No.", always: true, cell: a => `<strong>${esc(a.formNo)}</strong>` },
  { key: "dateApply", label: "Date Apply", std: true, cell: a => fmtDate(a.dateApply) },
  { key: "equipment", label: "Equipment", std: true, cell: a => dv(a, "equipmentName") },
  { key: "companyModel", label: "Company Model", std: true, cell: a => dv(a, "companyModel") },
  { key: "type", label: "Type", std: true, cell: a => dv(a, "appType") },
  { key: "coaNo", label: "COA No.", std: true, cell: a => both(a, "coaNo", "ecosCoaNo") },
  { key: "sections", label: "Sections", std: true, cell: a => {
      const vis = visibleSections(a);
      return `${vis.filter(x => a.sections[x.id].status === "submitted").length}/${vis.length} submitted`; } },
  { key: "checklist", label: "Checklist", std: true, cell: a => { const p = progress(a);
      return `<div class="progress-wrap"><div class="progress" style="width:90px"><div style="width:${p.pct}%"></div></div><small>${p.done}/${p.total}</small></div>`; } },
  { key: "status", label: "Status", std: true, cell: a => { const s = statusOf(a); return `<span class="badge ${s.cls}">${esc(s.label)}</span>`; } },
  { key: "updated", label: "Last Updated", std: true, cell: a => `<span class="muted" style="font-size:12px">${esc(a.updatedBy || "")}<br>${fmtTime(a.updatedAt)}</span>` },
  // more details (off by default)
  { key: "purpose", label: "Application Purpose", cell: a => dv(a, "purpose") },
  { key: "pic", label: "Person in Charge", cell: a => dv(a, "pic") },
  { key: "productCategory", label: "Product Category", cell: a => dv(a, "productCategory") },
  { key: "supplierBrand", label: "Supplier Brand", cell: a => dv(a, "supplierBrand") },
  { key: "companyBrand", label: "Company Brand", cell: a => dv(a, "companyBrand") },
  { key: "supplierModel", label: "Supplier Model", cell: a => dv(a, "supplierModel") },
  { key: "hsCode", label: "HS Code", cell: a => dv(a, "hsCode") },
  { key: "stEcos", label: "ST / eCOS", cell: a => dv(a, "stEcos") },
  { key: "manufacturer", label: "Manufacturer", cell: a => dv(a, "manufacturerName") },
  { key: "mfgCountry", label: "Manufacturer Country", cell: a => dv(a, "mfgCountry") },
  { key: "testReportNo", label: "Test Report No.", cell: a => dv(a, "testReportNo") },
  { key: "testValid", label: "Test Report Valid Until", cell: a => { const v = a.data?.testReportDate && addYears(a.data.testReportDate, 5); return v ? fmtDate(v) : "—"; } },
  { key: "supplier", label: "Supplier / Exporter", cell: a => dv(a, "supplier") },
  { key: "portLoading", label: "Port of Loading", cell: a => dv(a, "portLoading") },
  { key: "portArrival", label: "Port of Arrival", cell: a => dv(a, "portArrival") },
  { key: "k1No", label: "Customs Form (K1)", cell: a => dv(a, "k1No") },
  { key: "ePermitNo", label: "e-Permit No.", cell: a => both(a, "ePermitNo", "ecosEPermitNo") },
  { key: "stStatus", label: "ST Status", cell: a => dv(a, "stStatus") },
  { key: "ecosStatus", label: "eCOS Status", cell: a => dv(a, "ecosStatus") },
  { key: "coaIssue", label: "COA Issue Date", cell: a => both(a, "coaIssue", "ecosCoaIssue", true) },
  { key: "coaExpiry", label: "COA Expiry Date", cell: a => both(a, "coaExpiry", "ecosCoaExpiry", true) },
  { key: "createdBy", label: "Created By", cell: a => `<span class="muted" style="font-size:12px">${esc(a.createdBy || "")}<br>${fmtTime(a.createdAt)}</span>` },
];

function renderDashboard() {
  const st = statusKey;
  const count = f => apps.filter(f).length;
  const prevQ = $("#q")?.value || "", prevS = $("#fStatus")?.value || "";
  const mine = me.role === "user";

  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Dashboard</h1>
        <div class="sub">${mine ? "Open an application to fill in and submit your sections" : "Application for Certificate of Approval (COA) – Electrical Equipment"}</div>
      </div>
      <div class="actions">
        <button class="btn" id="exportCsv">Export list (CSV)</button>
        ${canCreate() ? `<a class="btn btn-primary" href="#/new">+ New Application</a>` : ""}
      </div>
    </div>

    ${coaAlerts().length ? `<div class="coa-banner" id="coaBanner">
      <span>⚠ <strong>${coaAlerts().length} COA${coaAlerts().length > 1 ? "s" : ""}</strong> expire${coaAlerts().length > 1 ? "" : "s"} within 1 month or ha${coaAlerts().length > 1 ? "ve" : "s"} expired:
        ${coaAlerts().slice(0, 3).map(({ a, days }) => `<a href="#/app/${a.id}">${esc(a.formNo)}</a> (${daysText(days)})`).join(", ")}${coaAlerts().length > 3 ? " …" : ""}</span>
      <button class="btn btn-sm" id="coaBannerBtn">View all</button>
    </div>` : ""}
    <div class="stats">
      <div class="stat"><div class="n">${apps.length}</div><div class="l">Total</div></div>
      <div class="stat"><div class="n">${count(a => st(a) === "Not Submitted")}</div><div class="l">Draft</div></div>
      <div class="stat"><div class="n">${count(a => st(a) === "Completed")}</div><div class="l">Completed</div></div>
      <div class="stat"><div class="n">${count(a => ["expiring", "expired"].includes(statusOf(a).cls))}</div><div class="l">COA Expiring / Expired</div></div>
      <div class="stat"><div class="n">${count(a => a.cancelled)}</div><div class="l">Cancelled</div></div>
    </div>

    <div class="card">
      <div class="toolbar">
        <input type="text" id="q" placeholder="Search form no., product, model, COA no., manufacturer…" value="${esc(prevQ)}" />
        <select id="fStatus">
          <option value="">All statuses</option>
          ${[...(OPTIONS.stStatus || []), "Completed", "Cancelled"].map(s => `<option ${s === prevS ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <div class="col-menu">
          <button type="button" class="btn" id="colBtn">☷ Columns ▾</button>
          <div class="col-drop" id="colDrop" hidden></div>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr id="dashHead"></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </div>`;

  // ---- columns this person chose to see (remembered in this browser)
  const colKey = `coa.dashCols.${me.id}`;
  let shown;
  try { shown = JSON.parse(localStorage.getItem(colKey)); } catch { shown = null; }
  if (!Array.isArray(shown)) shown = DASH_COLS.filter(c => c.std).map(c => c.key);
  // extra columns go between "COA No." and "Sections"
  const cols = () => {
    const on = DASH_COLS.filter(c => c.always || shown.includes(c.key));
    const std = on.filter(c => c.always || c.std), extra = on.filter(c => !c.always && !c.std);
    const at = DASH_COLS.findIndex(c => c.key === "sections");
    const before = std.filter(c => DASH_COLS.indexOf(c) < at), after = std.filter(c => DASH_COLS.indexOf(c) >= at);
    return [...before, ...extra, ...after];
  };
  const drawMenu = () => {
    const group = std => DASH_COLS.filter(c => !c.always && !!c.std === std).map(c =>
      `<label class="col-opt"><input type="checkbox" data-col="${c.key}" ${shown.includes(c.key) ? "checked" : ""} /> ${esc(c.label)}</label>`).join("");
    $("#colDrop").innerHTML = `
      <div class="col-group">Standard</div>${group(true)}
      <div class="col-group">More details</div>${group(false)}
      <div class="col-actions"><button type="button" class="btn btn-sm" id="colReset">Reset</button></div>`;
  };

  const draw = () => {
    const cs = cols();
    $("#dashHead").innerHTML = cs.map(c => `<th>${esc(c.label)}</th>`).join("");
    const list = filterApps($("#q").value, $("#fStatus").value).sort(byFormNo);
    $("#rows").innerHTML = list.length ? list.map(a => `<tr data-id="${a.id}">${cs.map(c => `<td>${c.cell(a)}</td>`).join("")}</tr>`).join("")
      : `<tr><td colspan="${cs.length}" class="empty">${apps.length ? "No matching applications." : "No applications yet." + (canCreate() ? " Click <strong>+ New Application</strong> to start." : "")}</td></tr>`;
  };
  draw();
  drawMenu();
  $("#colBtn").onclick = e => { e.stopPropagation(); $("#colDrop").hidden = !$("#colDrop").hidden; };
  $("#colDrop").onclick = e => {
    e.stopPropagation();
    if (e.target.id === "colReset") {
      shown = DASH_COLS.filter(c => c.std).map(c => c.key);
    } else if (e.target.dataset.col) {
      const k = e.target.dataset.col;
      shown = e.target.checked ? [...shown, k] : shown.filter(x => x !== k);
    } else return;
    try { localStorage.setItem(colKey, JSON.stringify(shown)); } catch {}
    drawMenu();
    draw();
  };
  if (!window._colMenuBound) {       // close the Columns menu when clicking elsewhere (added once)
    window._colMenuBound = true;
    document.addEventListener("click", () => { const d = $("#colDrop"); if (d) d.hidden = true; });
  }
  $("#q").addEventListener("input", draw);
  $("#fStatus").addEventListener("change", draw);

  $("#rows").addEventListener("click", e => {
    const tr = e.target.closest("tr[data-id]");
    if (tr) location.hash = "#/app/" + tr.dataset.id;
  });

  $("#exportCsv").onclick = () => exportCsv(apps);
  if ($("#coaBannerBtn")) $("#coaBannerBtn").onclick = coaAlertDialog;
}

function exportCsv(list) {
  const cols = [["Form No.", a => a.formNo], ["Date Apply", a => a.dateApply]];
  for (const s of SECTIONS) {
    if (!list.some(a => secInfo(a, s.id).view)) continue;
    cols.push([`${s.id}. Section Status`, a => secInfo(a, s.id).view ? `${secInfo(a, s.id).status} (${secInfo(a, s.id).count}x)` : ""]);
    for (const it of s.items) {
      if (it.type === "file") cols.push([`${s.id}. ${it.label}`, a => (a.files[it.key] || []).map(f => f.name).join("; ")]);
      else if (it.type === "computed") cols.push([`${s.id}. ${it.label}`, a => secInfo(a, s.id).view ? it.compute(a.data) : ""]);
      else cols.push([`${s.id}. ${it.label}`, a => a.data[it.key] || ""]);
    }
  }
  cols.push(["Checklist Done", a => progress(a).done], ["Checklist Total", a => progress(a).total],
    ["Last Updated By", a => a.updatedBy], ["Last Updated", a => fmtTime(a.updatedAt)]);
  const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = [cols.map(c => q(c[0])).join(",")].concat(list.map(a => cols.map(c => q(c[1](a))).join(","))).join("\r\n");
  download(new Blob(["﻿" + csv], { type: "text/csv" }), `COA_applications_${today()}.csv`);
}

function download(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =========================================================
   APPLICATION FORM
   ========================================================= */
function renderForm() {
  const rec = current;
  if (!rec._base) rec._base = { data: { ...rec.data }, remarks: { ...rec.remarks } };
  const vis = visibleSections(rec);
  const anyCheck = vis.some(s => secInfo(rec, s.id).check);
  $("#app").innerHTML = `
    <div class="page-head no-print">
      <div>
        <a href="#/" style="text-decoration:none;font-weight:600">← Back to Dashboard</a>
        <h1 style="margin-top:6px">${esc(rec.formNo)}</h1>
        <div class="savebar"><span id="metaLine"></span> · <span id="savebar">All changes saved</span></div>
      </div>
      <div class="actions">
        <button class="btn" id="expandAll">Expand / Collapse all</button>
        ${anyCheck ? `<button class="btn" id="checkFilled" title="Tick checklist for every filled item you are allowed to tick">Tick filled items</button>` : ""}
        ${canAudit() ? `<a class="btn" href="#/audit/${rec.id}">Audit Trail</a><a class="btn" href="#/versions/coa/${rec.id}">Versions</a>` : `<button class="btn" id="historyBtn">History</button>`}
        <button class="btn" id="print">Print / PDF</button>
        ${rec.canCancel ? `<button class="btn btn-danger" id="cancelApp">Cancel Application</button>` : ""}
      </div>
    </div>
    ${rec.cancelled ? `<div class="cancel-banner">
      <strong>CANCELLED</strong> – cancelled by ${esc(rec.cancelledBy)} on ${fmtTime(rec.cancelledAt)}.
      <div>Reason: ${esc(rec.cancelReason)}</div>
      <div class="muted no-print" style="font-size:12px">This application is kept for record and can no longer be changed.</div>
    </div>` : ""}
    <div id="remoteBanner"></div>
    ${me.role === "viewer" ? `<div class="banner readonly-note no-print">You have view-only access.</div>` : ""}
    ${!vis.length ? `<div class="banner no-print">You don't have access to any section of this form yet. Ask your Super Admin to give you section access.</div>` : ""}

    <div class="layout">
      <!-- the table lets the printed letterhead repeat at the top of every page -->
      <table class="print-frame">
        <thead class="print-only"><tr><td><img class="letterhead" src="letterhead.png" alt="Company Name Sdn. Bhd." /></td></tr></thead>
        <tbody><tr><td>
        <div class="card">
          <div class="form-title">
            <div class="co">COMPANY NAME SDN BHD</div>
            <div class="t1">COA APPLICATION FORM</div>
            <div class="t2">APPLICATION FOR CERTIFICATE OF APPROVAL (COA) – ELECTRICAL EQUIPMENT</div>
          </div>
          <div class="meta-grid">
            <label class="field"><span>Form No. <small class="muted">(system generated)</small></span><input type="text" id="formNo" value="${esc(rec.formNo)}" readonly tabindex="-1" /></label>
            <label class="field"><span>Date Apply</span><input type="date" id="dateApply" value="${esc(rec.dateApply)}" ${rec.canHeader ? "" : "disabled"} /></label>
          </div>
        </div>
        ${vis.map(renderSection).join("")}
        <div class="submit-all no-print" id="submitBar"></div>
        </td></tr></tbody>
      </table>
      <aside class="side no-print">
        <div class="card" id="summary"></div>
      </aside>
    </div>
    ${[...new Set(SECTIONS.flatMap(x => x.items).filter(i => i.list).map(i => i.list))].map(k =>
      `<datalist id="dl-${k}">${(OPTIONS[k] || []).map(o => `<option value="${esc(o)}">`).join("")}</datalist>`).join("")}
  `;
  bindForm();
  refresh();
  updateMeta();
}

function updateMeta() {
  const el = $("#metaLine");
  if (el && current) el.textContent = `Created by ${current.createdBy || "—"} · Last updated by ${current.updatedBy || "—"}, ${fmtTime(current.updatedAt)}`;
}

function showRemoteBanner(srv) {
  const el = $("#remoteBanner");
  if (!el) return;
  el.innerHTML = `<div class="banner no-print">${esc(srv.updatedBy || "Someone")} updated this application at ${fmtTime(srv.updatedAt)}.
    <button class="btn btn-sm" id="reloadApp" style="margin-left:8px">Load latest</button></div>`;
  $("#reloadApp").onclick = () => route();
}

function sectionState(p) {
  if (p.myStatus === "submitted") return { cls: "submitted", label: "Submitted by you" };
  if (p.status === "submitted") return { cls: "submitted", label: `Submitted by ${p.by}` };
  if (p.count > 0) return { cls: "review", label: `Reopened · editing (submitted ${p.count}×)` };
  return { cls: "draft", label: "Draft" };
}

function renderSection(s) {
  return `
  <section class="card" id="sec-${s.id}" data-sec="${s.id}">
    <div class="card-head" data-toggle="${s.id}">
      <h2>${esc(s.title)}</h2>
      <div class="progress-wrap">
        <span class="badge" data-secbadge="${s.id}"></span>
        <div class="progress" style="width:90px"><div data-bar="${s.id}"></div></div>
        <small data-count="${s.id}"></small>
        <span class="chev">▾</span>
      </div>
    </div>
    ${s.note ? `<div class="section-note">${esc(s.note)}</div>` : ""}
    <div class="card-body">
      ${s.tabs ? `<div class="sec-tabs no-print">${s.tabs.map(t => `<button type="button" class="sec-tab" data-sec="${s.id}" data-tabbtn="${t.id}">${esc(t.label)}</button>`).join("")}
        <span class="sec-tabhint" data-tabhint="${s.id}"></span></div>` : ""}
      <div class="row row-head"><div>Item</div><div></div><div>Details</div><div style="text-align:center">Checklist</div></div>
      ${(() => { const n = {}; let last = null; return s.items.map(it => {
        const head = s.tabs && it.only && it.only !== last ? `<div class="tab-head print-only" data-tabhead="${it.only}">${esc(s.tabs.find(t => t.id === it.only)?.label || "")}</div>` : "";
        last = it.only || last;
        n[it.only || "_"] = (n[it.only || "_"] || 0) + 1;
        return head + renderItem(it, n[it.only || "_"]);
      }).join(""); })()}
      <div class="sec-bar no-print" data-secbar="${s.id}"></div>
    </div>
  </section>`;
}

function renderItem(it, n) {
  const d = current.data;
  const v = esc(d[it.key] ?? "");
  let input = "";
  switch (it.type) {
    case "text":
      input = `<input type="text" data-key="${it.key}" value="${v}" ${it.list ? `list="dl-${it.list}"` : ""} placeholder="${esc(it.placeholder || "")}" />`;
      break;
    case "textarea":
      input = `<textarea data-key="${it.key}" rows="2">${v}</textarea>`;
      break;
    case "date":
      input = `<input type="date" data-key="${it.key}" value="${v}" />`;
      break;
    case "money":
      input = `<input type="number" min="0" step="0.01" data-key="${it.key}" value="${v}" placeholder="RM 0.00" />`;
      break;
    case "select":
      input = `<select data-key="${it.key}"><option value="">— Select —</option>${(it.opt ? optionList(it, d[it.key]) : it.options).map(o => `<option ${d[it.key] === o ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      break;
    case "verify":
      input = `<div class="inline">
        <select data-key="${it.key}" style="flex:0 1 140px"><option value="">— Select —</option>${YES_NO_NA.map(o => `<option ${d[it.key] === o ? "selected" : ""}>${o}</option>`).join("")}</select>
        <input type="text" data-remark="${it.key}" value="${esc(current.remarks[it.key] || "")}" placeholder="Remark" />
      </div>`;
      break;
    case "computed":
      input = `<input type="text" data-computed="${it.key}" readonly />`;
      break;
    case "file":
      input = fileBox(it.key);
      break;
    case "multi": {
      const cur = String(d[it.key] || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
      input = `<div class="multi" data-multi="${it.key}">${it.options.map(o =>
        `<label class="multi-opt"><input type="checkbox" value="${esc(o)}" ${cur.includes(o.toLowerCase()) ? "checked" : ""} /> ${esc(o)}</label>`).join("")}</div>`;
      break;
    }
    case "port":
      input = `<div class="combo" data-combo="${it.key}">
        <input type="text" data-key="${it.key}" value="${v}" autocomplete="off" placeholder="🔍 Search port name or code…" />
        <div class="combo-list" hidden></div>
        <div class="combo-hint muted no-print" data-combohint="${it.key}"></div>
      </div>`;
      break;
    case "doclist":
      input = `<div class="doclist" data-doclist="${it.key}">
        <div class="doclist-items"></div>
        <div class="doclist-add no-print">
          <input type="text" data-docnote="${it.key}" maxlength="300" placeholder="Remark – what is this document?" />
          <label class="btn btn-sm upload-btn"><span>📎 Upload document</span><input type="file" data-upload="${it.key}" data-withnote="1" /></label>
        </div>
      </div>`;
      break;
  }
  if (it.attach) input += `<div style="margin-top:6px">${fileBox(it.key + "__att", it.attach)}</div>`;
  return `
  <div class="row" data-row="${it.key}" ${it.only ? `data-tab="${it.only}"` : ""}>
    <div class="no">${n}</div>
    <div class="label">${esc(it.display || it.label)}${it.required ? '<span class="req">*</span>' : ""}${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ""}</div>
    <div class="input-cell">${input}</div>
    <div class="check-cell">
      <label class="check"><input type="checkbox" data-check="${it.key}" ${current.checks[it.key] ? "checked" : ""} /> <span>Done</span></label>
      ${it.attach && !/^upload/i.test(it.attach) ? `<div class="check-note">${esc(it.attach)}</div>` : ""}
    </div>
  </div>`;
}

function fileBox(key, label = "Upload file") {
  return `<div class="files" data-files="${key}">
    <div class="file-list"></div>
    <label class="btn btn-sm upload-btn"><span>📎 ${esc(label)}</span><input type="file" multiple data-upload="${key}" /></label>
  </div>`;
}

// file types the browser can show in a tab; everything else can only be downloaded
const VIEWABLE = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp", "text/plain"];
function fileButtons(f, base = "/api/files/") {
  const info = `${f.name} (${fmtSize(f.size)}) – uploaded by ${f.uploadedBy}, ${fmtTime(f.uploadedAt)}`;
  const canView = VIEWABLE.includes(f.type);
  return {
    name: canView ? `<a class="fname" href="${base}${f.id}" target="_blank" rel="noopener" title="View – ${esc(info)}">📄 ${esc(f.name)}</a>`
                  : `<span class="fname" title="${esc(info)}">📄 ${esc(f.name)}</span>`,
    btns: `${canView ? `<a class="fbtn" href="${base}${f.id}" target="_blank" rel="noopener" title="Open in a new tab">👁 View</a>` : ""}
      <a class="fbtn" href="${base}${f.id}?dl=1" download="${esc(f.name)}" title="Save to your computer">⬇ Download</a>`,
  };
}

function drawFiles(key) {
  const list = document.querySelector(`[data-doclist="${key}"] .doclist-items`);
  if (list) {
    const files = current.files[key] || [];
    list.innerHTML = files.length ? files.map((f, i) => `
      <div class="doc-row">
        <span class="doc-no">${i + 1}.</span>
        <span class="doc-note">${esc(f.note || "(no remark)")}</span>
        <span class="doc-file">${fileButtons(f).name}<span class="fbtns">${fileButtons(f).btns}
          <button type="button" class="doc-rm" data-rmfile="${key}|${f.id}" title="Remove">× Remove</button></span></span>
      </div>`).join("") : `<div class="muted no-files">No document uploaded</div>`;
    return;
  }
  const box = document.querySelector(`[data-files="${key}"] .file-list`);
  if (!box) return;
  const files = current.files[key] || [];
  box.innerHTML = files.length ? files.map(f => `
    <span class="file-chip">
      ${fileButtons(f).name}
      <span class="fbtns">${fileButtons(f).btns}
        <button type="button" class="frm" data-rmfile="${key}|${f.id}" title="Remove">× Remove</button></span>
    </span>`).join("") : `<span class="muted no-files">No document uploaded</span>`;
}

function setCheck(key, on) {
  current.checks[key] = on;
  pending.checks[key] = on;
  const cb = document.querySelector(`[data-check="${key}"]`);
  if (cb) cb.checked = on;
}

function bindForm() {
  const root = $("#app");
  root.oninput = e => {
    const t = e.target;
    if (t.dataset.key) {
      current.data[t.dataset.key] = t.value;
      pending.data[t.dataset.key] = t.value;
      if (t.dataset.key === "hsCode") hintFrom("customsHs", t.value);
      if (t.closest("[data-combo]")) openCombo(t);
      if (t.dataset.key === "ePermitDateA") hintFrom("ePermitDate", t.value);
    } else if (t.dataset.remark) {
      current.remarks[t.dataset.remark] = t.value;
      pending.remarks[t.dataset.remark] = t.value;
    } else if (t.id === "dateApply") {
      current[t.id] = t.value;
      pending.meta[t.id] = t.value;
    } else return;
    scheduleSave();
    refresh();
  };

  root.onchange = async e => {
    const t = e.target;
    const multi = t.closest("[data-multi]");
    if (multi) {
      const key = multi.dataset.multi;
      const v = [...multi.querySelectorAll("input:checked")].map(x => x.value).join(", ");
      current.data[key] = v;
      pending.data[key] = v;
      scheduleSave();
      refresh();
    } else if (t.dataset.check) {
      setCheck(t.dataset.check, t.checked);
      scheduleSave();
      refresh();
    } else if (t.dataset.upload) {
      const key = t.dataset.upload;
      const files = [...t.files];
      t.value = "";
      const noteEl = t.dataset.withnote ? document.querySelector(`[data-docnote="${key}"]`) : null;
      const note = noteEl ? noteEl.value.trim() : "";
      if (noteEl && !note) { toast("Please type a remark for this document first"); noteEl.focus(); return; }
      const label = t.previousElementSibling, old = label.textContent;
      for (const [i, f] of files.entries()) {
        label.textContent = `Uploading ${i + 1}/${files.length}…`;
        try {
          const { file } = await api("POST", `/api/apps/${current.id}/files?field=${encodeURIComponent(key)}&name=${encodeURIComponent(f.name)}${note ? `&note=${encodeURIComponent(note)}` : ""}`, f);
          if (noteEl) noteEl.value = "";
          (current.files[key] ||= []).push(file);
          current.updatedAt = file.uploadedAt;
          drawFiles(key);
        } catch (ex) {
          toast(`Upload failed (${f.name}): ${ex.message}`);
        }
      }
      label.textContent = old;
      // uploading a document auto-ticks its checklist item (if this user may tick it)
      const sec = t.closest("[data-sec]").dataset.sec;
      if (!key.endsWith("__att") && secInfo(current, sec).check && (current.files[key] || []).length && !current.checks[key]) {
        setCheck(key, true);
        scheduleSave();
      }
      refresh();
    }
  };

  // searchable port boxes (listeners are added once; #app is reused for every page)
  if (!root._comboBound) {
    root._comboBound = true;
    root.addEventListener("focusin", e => {
      const t = e.target;
      if (current && t.dataset.key && t.closest("[data-combo]") && !t.disabled) openCombo(t);
    });
    root.addEventListener("focusout", e => {
      const combo = e.target.closest("[data-combo]");
      if (combo) setTimeout(() => { const b = combo.querySelector(".combo-list"); if (b) b.hidden = true; }, 150);
    });
    root.addEventListener("mousedown", e => {
      const opt = e.target.closest("[data-pick]");
      if (!opt) return;
      e.preventDefault();
      const input = opt.closest("[data-combo]").querySelector("input");
      input.value = opt.dataset.pick;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      opt.closest(".combo-list").hidden = true;
    });
  }

  root.onclick = async e => {
    const t = e.target;
    if (t.closest("[data-submitall]")) { submitAll(); return; }
    const tabBtn = t.closest("[data-tabbtn]");
    if (tabBtn) { secTab[tabBtn.dataset.sec] = tabBtn.dataset.tabbtn; refresh(); return; }
    if (t.closest("[data-saveall]")) {
      await flushSave();
      const sb = $("#savebar");
      if (sb && !dirty) sb.textContent = "All changes saved";
      const r = await api("POST", `/api/apps/${current.id}/saved`, {}).catch(() => ({}));
      toast(`${current.formNo} saved${r.notified ? " – Admins are notified by email" : ""}`);
      return;
    }
    const act = t.closest("[data-secact]");
    if (act) { sectionAction(act.dataset.sec, act.dataset.secact); return; }
    const tog = t.closest("[data-toggle]");
    if (tog) { tog.parentElement.classList.toggle("collapsed"); return; }
    if (t.dataset.rmfile) {
      const [key, id] = t.dataset.rmfile.split("|");
      const f = (current.files[key] || []).find(x => x.id === id);
      if (!await ask(`Remove "${f?.name}"?`)) return;
      try {
        await api("DELETE", `/api/files/${id}`);
        current.files[key] = current.files[key].filter(x => x.id !== id);
        current.updatedAt = Date.now() / 1000;
        drawFiles(key);
        refresh();
      } catch (ex) { toast(ex.message); }
      return;
    }
    const jump = t.closest("[data-jump]");
    if (jump) {
      const sec = document.getElementById("sec-" + jump.dataset.jump);
      sec.classList.remove("collapsed");
      sec.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  $("#expandAll").onclick = () => {
    const cards = [...document.querySelectorAll("section.card")];
    const anyOpen = cards.some(c => !c.classList.contains("collapsed"));
    cards.forEach(c => c.classList.toggle("collapsed", anyOpen));
  };
  if ($("#checkFilled")) $("#checkFilled").onclick = () => {
    let n = 0;
    for (const s of visibleSections(current)) {
      if (!secInfo(current, s.id).check) continue;
      for (const it of s.items) {
        if (isApplicable(it, current.data) && isFilled(current, it) && !current.checks[it.key]) { setCheck(it.key, true); n++; }
      }
    }
    if (n) scheduleSave();
    refresh();
    toast(n ? `Ticked ${n} item(s)` : "Nothing new to tick");
  };
  $("#print").onclick = () => {
    document.querySelectorAll("section.card").forEach(c => c.classList.remove("collapsed"));
    printAs(current.formNo);
  };
  if ($("#historyBtn")) $("#historyBtn").onclick = historyDialog;
  if ($("#cancelApp")) $("#cancelApp").onclick = () => {
    openDialog(`
      <h3>Cancel application ${esc(current.formNo)}?</h3>
      <p class="muted" style="margin:0">The application is not deleted. It stays in the system for record, marked as Cancelled, and nobody can change it any more.</p>
      <label class="field"><span>Reason for cancelling</span><textarea name="reason" rows="3" required maxlength="500"></textarea></label>
    `, async form => {
      await flushSave();
      const { app } = await api("POST", `/api/apps/${current.id}/cancel`, { reason: form.reason.value });
      current = app;
      upsertApp(app);
      renderForm();
      toast(`${app.formNo} cancelled`);
    }, "Cancel Application");
  };

  for (const s of visibleSections(current)) for (const it of s.items) {
    if (it.type === "file" || it.type === "doclist") drawFiles(it.key);
    if (it.attach) drawFiles(it.key + "__att");
  }
  hintFrom("customsHs", current.data.hsCode);
  hintFrom("ePermitDate", current.data.ePermitDateA);
}

// show a value from another section as a placeholder suggestion
function hintFrom(key, val) {
  const el = document.querySelector(`[data-key="${key}"]`);
  if (el) el.placeholder = val || "";
}

/* Update permissions, computed fields, conditional rows, progress and summary */
function refresh() {
  const rec = current, d = rec.data;
  const vis = visibleSections(rec);
  for (const s of vis) {
    const p = secInfo(rec, s.id);
    const card = document.getElementById("sec-" + s.id);
    card.classList.toggle("no-edit", !p.edit);
    card.classList.toggle("locked", p.myStatus === "submitted");
    for (const it of s.items) {
      const row = card.querySelector(`[data-row="${it.key}"]`);
      const ok = isApplicable(it, d);
      row.classList.toggle("disabled", !ok);
      if (it.only) {                     // ST / eCOS rows: hidden when not ticked in Section B, and when on the other tab
        row.classList.toggle("only-off", !ok);
        row.classList.toggle("tab-off", !!s.tabs && it.only !== activeTab(s, d));
      }
      row.querySelectorAll("[data-key], [data-remark], [data-upload], [data-docnote], [data-multi] input").forEach(el => {
        el.disabled = !ok || !p.edit || (it.superOnly && !isSuper() && !!el.dataset.key);
      });
      row.querySelector("[data-check]").disabled = !ok || !p.check;
      row.classList.toggle("done", !!rec.checks[it.key] && ok);
      row.querySelector(".check").classList.toggle("on", !!rec.checks[it.key]);
      if (it.type === "computed") {
        const val = it.compute(d);
        row.querySelector("[data-computed]").value = val ? fmtDate(val) : "";
      }
    }
    // number the rows that are shown (ST / eCOS rows can be hidden) - each tab counts from 1
    const count = {};
    card.querySelectorAll(".row[data-row]").forEach(r => {
      const no = r.querySelector(".no"), t = r.dataset.tab || "_";
      if (no && !r.classList.contains("only-off")) no.textContent = count[t] = (count[t] || 0) + 1;
    });
    if (s.tabs) {
      const open = activeTab(s, d);
      card.querySelectorAll("[data-tabbtn]").forEach(b => {
        b.hidden = !tabShown(b.dataset.tabbtn, d);
        b.classList.toggle("active", b.dataset.tabbtn === open);
      });
      card.querySelectorAll("[data-tabhead]").forEach(h => h.classList.toggle("only-off", !tabShown(h.dataset.tabhead, d)));
      const hint = card.querySelector("[data-tabhint]");
      if (hint) hint.textContent = !showsECOS(d) ? "eCOS is not ticked in Section B (ST / eCOS) – tick eCOS there to show the eCOS tab."
        : !showsST(d) ? "ST is not ticked in Section B (ST / eCOS) – tick ST there to show the ST tab." : "";
    }
    for (const it of s.items.filter(i => i.type === "port")) {
      const h = card.querySelector(`[data-combohint="${it.key}"]`);
      const { country, list } = portChoices(it);
      if (h) h.textContent = it.portCountry ? `Showing ${list.length} ports in ${country}`
        : country ? `Showing ${list.length} ports in ${country} (from Country of Shipment)` : "Tip: fill in Country of Shipment first to show only that country's ports";
    }
    const pr = progress(rec, s);
    card.querySelector(`[data-bar="${s.id}"]`).style.width = pr.pct + "%";
    card.querySelector(`[data-count="${s.id}"]`).textContent = `${pr.done}/${pr.total}`;
    const stt = sectionState(p);
    const badge = card.querySelector(`[data-secbadge="${s.id}"]`);
    badge.className = "badge " + stt.cls;
    badge.textContent = p.myStatus === "submitted" ? "Submitted by you" : p.status === "submitted" ? `Submitted by ${p.by}` : stt.cls === "draft" ? "Draft" : "Reopened";
    drawSectionBar(s, p, stt);
  }

  const p = progress(rec), st = statusOf(rec), al = alertsOf(rec);
  const subCount = vis.filter(s => secInfo(rec, s.id).status === "submitted").length;
  $("#summary").innerHTML = `
    <h3>Checklist Progress</h3>
    <div class="big-pct">${p.pct}%</div>
    <div class="progress" style="margin:6px 0 4px"><div style="width:${p.pct}%"></div></div>
    <div style="color:var(--muted);font-size:12px;margin-bottom:12px">${p.done} of ${p.total} items checked · ${subCount}/${vis.length} sections submitted</div>
    <div style="margin-bottom:12px">Status: <span class="badge ${st.cls}">${esc(st.label)}</span></div>
    ${vis.map(s => {
      const sp = progress(rec, s), si = secInfo(rec, s.id);
      const lock = si.status === "submitted" ? "🔒 " : "";
      return `<div class="side-item" data-jump="${s.id}"><span>${lock}${s.id}. ${esc(s.short)}</span><span style="color:${sp.total && sp.done === sp.total ? "var(--ok)" : "var(--muted)"};font-weight:600">${sp.done}/${sp.total}</span></div>`;
    }).join("")}
    ${al.length ? `<div class="alerts">${al.map(a => `<div class="alert ${a.bad ? "bad" : ""}">${esc(a.msg)}</div>`).join("")}</div>` : ""}
    ${submittable(rec).length ? `<button class="btn btn-primary" data-submitall style="width:100%;justify-content:center;margin-top:14px">Submit (${submittable(rec).length} section${submittable(rec).length > 1 ? "s" : ""})</button>` : ""}
  `;
  drawSubmitBar();
}

const submittable = rec => visibleSections(rec).filter(s => secInfo(rec, s.id).submit);

function drawSubmitBar() {
  const bar = $("#submitBar");
  if (!bar) return;
  const todo = submittable(current);
  const canEdit = !current.cancelled && visibleSections(current).some(s => { const p = secInfo(current, s.id); return p.edit || p.check; });
  const saveBtn = canEdit ? `<button class="btn" data-saveall title="Save your changes and keep working (the form is not submitted)">💾 Save</button>` : "";
  if (!todo.length) {
    const all = visibleSections(current);
    const mineToDo = all.filter(s => !secInfo(current, s.id).viewOnly && (secInfo(current, s.id).edit || secInfo(current, s.id).check || secInfo(current, s.id).myStatus === "submitted"));
    const done = mineToDo.length && mineToDo.every(s => secInfo(current, s.id).myStatus === "submitted");
    const msg = done && !current.cancelled ? `<div class="muted">✔ All your sections have been submitted.</div>` : "";
    bar.innerHTML = msg || saveBtn ? (msg || `<div class="muted">${me.role === "user" ? "Press <strong>Save</strong> when you finish – an Admin will submit this form." : "Changes are saved automatically – press Save to save now."}</div>`) + (saveBtn ? `<div class="submit-btns">${saveBtn}</div>` : "") : "";
    bar.hidden = !bar.innerHTML;
    return;
  }
  bar.hidden = false;
  bar.innerHTML = `
    <div>
      <strong>Ready to submit?</strong>
      <div class="muted" style="font-size:12px;margin-top:2px">Sections to submit: ${todo.map(s => `${s.id}. ${esc(s.short)}`).join(" · ")}</div>
      <div class="muted" style="font-size:12px">Not finished yet? Press <strong>Save</strong> and continue later.</div>
    </div>
    <div class="submit-btns">${saveBtn}<button class="btn btn-primary" data-submitall>Submit</button></div>`;
}

async function submitAll() {
  const todo = submittable(current);
  if (!todo.length) return;
  const missing = [];
  for (const s of todo) for (const it of s.items) {
    if (it.required && isApplicable(it, current.data) && !isFilled(current, it)) missing.push(`${s.id}: ${it.label}`);
  }
  let msg = "Submit these sections?\n\n" + todo.map(s => `${s.id}. ${s.short}`).join("\n");
  if (missing.length) msg += "\n\nStill missing (required):\n" + missing.join("\n");
  if (me.role === "user") msg += "\n\nAfter submitting, these sections are locked. You can only change them again if you have resaves left.";
  if (!await ask(msg)) return;
  await flushSave();
  try {
    const { app, submitted } = await api("POST", `/api/apps/${current.id}/submit`, {});
    upsertApp(app);
    toast(`${app.formNo}: submitted ${submitted.length} section${submitted.length > 1 ? "s" : ""}`);
    location.hash = "#/";                     // back to the COA dashboard
  } catch (ex) { toast(ex.message); }
}

function drawSectionBar(s, p, stt) {
  const bar = document.querySelector(`[data-secbar="${s.id}"]`);
  const parts = [];
  if (p.status === "submitted") parts.push(`<span>Last submitted by <strong>${esc(p.by)}</strong>, ${fmtTime(p.at)}</span>`);
  else if (p.count > 0) parts.push(`<span>Reopened for changes – last submitted by <strong>${esc(p.by)}</strong>, ${fmtTime(p.at)}</span>`);
  else parts.push(`<span class="muted">Not submitted by anyone yet</span>`);
  // this person's own submit (an Admin's submit does not lock a User, and the other way round)
  if (!p.viewOnly && me.role !== "viewer") {
    if (p.myStatus === "submitted") parts.push(`<span>🔒 <strong>You</strong> have submitted this section</span>`);
    else if (p.submit) parts.push(`<span><strong>You</strong> have not submitted this section yet – use the Submit button at the bottom of the form</span>`);
  }
  const rights = p.viewOnly ? "view only" : me.role === "user" && p.status === "submitted" ? "locked – submitted"
    : [p.edit ? "submit detail" : "", p.check ? "tick checklist" : ""].filter(Boolean).join(" & ");
  parts.push(`<span class="muted">Your access: ${rights || "view only"}${me.role === "user" && !p.viewOnly ? " · you Save, an Admin submits" : ""}</span>`);
  const btns = [];
  if (p.resubmit) btns.push(`<button class="btn btn-sm" data-secact="resubmit" data-sec="${s.id}">Unlock to resave (${p.resubmitsLeft} left)</button>`);
  if (p.reopen) btns.push(`<button class="btn btn-sm" data-secact="reopen" data-sec="${s.id}">Reopen section</button>`);
  if (me.role === "user" && !p.viewOnly && p.status === "submitted") btns.push(`<span class="muted" style="font-size:12px">Locked – ask an Admin to reopen</span>`);
  bar.innerHTML = `<div class="sec-info">${parts.join("")}</div><div class="sec-btns">${btns.join("")}</div>`;
}

async function sectionAction(sec, action) {
  const s = SECTIONS.find(x => x.id === sec), p = secInfo(current, sec);
  if (action === "resubmit") {
    if (!await ask(`Unlock section ${sec} to make changes?\n\nThis uses 1 of your ${p.resubmitsLeft} resave(s). Remember to press Save at the bottom of the form when done.`)) return;
  } else if (action === "reopen") {
    if (!await ask(`Reopen section ${sec}? The person who submitted it will be able to edit it again.`)) return;
  }
  await flushSave();
  try {
    const { app } = await api("POST", `/api/apps/${current.id}/sections/${sec}/${action}`, {});
    const y = window.scrollY;
    current = app;
    upsertApp(app);
    renderForm();
    window.scrollTo(0, y);
    toast({ resubmit: `Section ${sec} unlocked – press Save when done`, reopen: `Section ${sec} reopened` }[action]);
  } catch (ex) { toast(ex.message); }
}

async function historyDialog() {
  let rows = [];
  try { rows = (await api("GET", `/api/apps/${current.id}/history`)).history; } catch (ex) { toast(ex.message); return; }
  const label = { submit: "Submitted", resubmit: "Unlocked to resave", reopen: "Reopened by admin" };
  openDialog(`
    <h3>Submission history – ${esc(current.formNo)}</h3>
    <div style="max-height:50vh;overflow:auto">
      ${rows.length ? `<table><thead><tr><th>When</th><th>Section</th><th>Action</th><th>By</th></tr></thead><tbody>
        ${rows.map(r => `<tr style="cursor:default"><td>${fmtTime(r.at)}</td><td>${esc(r.section)}</td><td>${esc(label[r.action] || r.action)}</td><td>${esc(r.by)}</td></tr>`).join("")}
      </tbody></table>` : `<p class="muted">No sections have been submitted yet.</p>`}
    </div>`, async () => {}, "Close", true);
}

/* ---------- Saving (only changed fields are sent) ---------- */
function scheduleSave() {
  dirty = true;
  const sb = $("#savebar");
  if (sb) sb.textContent = "Saving…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 600);
}

function mergePending(into, p) {
  Object.assign(into.data, p.data);
  Object.assign(into.checks, p.checks);
  Object.assign(into.remarks, p.remarks);
  Object.assign(into.meta, p.meta);
}

// ---------------- two people saving the same form
// Each save says which value the person started from ("base"). If someone else saved a different value in the
// meantime, the server does not overwrite it but sends both back, and the person saving last chooses.
const pickBase = (base, sent) => Object.fromEntries(Object.keys(sent || {}).map(k => [k, base?.[k] ?? ""]));

// put a value into the form on screen (unless the person is typing in that box right now)
function setShown(sel, v) {
  const el = document.querySelector(sel);
  if (el && el !== document.activeElement && "value" in el) el.value = v ?? "";
}

// "Someone else changed ..." – returns ["theirs" | "mine", ...] in the order of `list`
function askConflicts(list) {
  return new Promise(resolve => {
    const val = (c, x) => esc(auditValue(c.key, x) || "(empty)");
    const rows = list.map((c, i) => `
      <div class="cf-item">
        <div class="cf-label">${esc(FIELD_INFO[c.key]?.label || c.key)}${c.kind === "remarks" ? " – remark" : ""}</div>
        <label class="cf-opt"><input type="radio" name="c${i}" value="theirs" checked />
          <span><strong>Keep the saved value:</strong> ${val(c, c.theirs)}
          <span class="muted cf-by">saved by ${esc(c.by || "someone else")}${c.at ? ", " + fmtTime(c.at) : ""}</span></span></label>
        <label class="cf-opt"><input type="radio" name="c${i}" value="mine" />
          <span><strong>Change to yours:</strong> ${val(c, c.yours)}</span></label>
      </div>`).join("");
    openDialog(`
      <h3>⚠ ${list.length === 1 ? "This detail was" : `${list.length} details were`} changed by someone else</h3>
      <p class="muted" style="margin:0 0 6px">While you were working, another person saved a different value. Choose which one to keep.
        Your other changes have been saved and combined into the document.</p>
      ${rows}`, async form => { resolve(list.map((c, i) => form[`c${i}`].value)); }, "Apply", true);
  });
}

// COA form: after a save – take in what other people saved, then let this person decide on the clashes
async function mergeCoaSave(rec, app, sent, conflicts) {
  const clash = new Set((conflicts || []).map(c => c.kind + "." + c.key));
  for (const kind of ["data", "remarks"]) {
    const base = rec._base[kind], server = app[kind] || {};
    for (const k of Object.keys(sent[kind] || {})) if (!clash.has(kind + "." + k)) base[k] = server[k] ?? "";
    for (const [k, v] of Object.entries(server)) {
      if (clash.has(kind + "." + k) || k in pending[kind] || (v ?? "") === (base[k] ?? "")) continue;
      rec[kind][k] = v;                        // saved by someone else meanwhile
      base[k] = v;
      setShown(kind === "data" ? `[data-key="${k}"]` : `[data-remark="${k}"]`, v);
    }
  }
  if (rec === current) refresh();
  if (!conflicts?.length || rec !== current) return;
  const pick = await askConflicts(conflicts);
  let again = false;
  conflicts.forEach((c, i) => {
    rec._base[c.kind][c.key] = c.theirs;
    if (pick[i] === "mine") {
      rec[c.kind][c.key] = c.yours;
      pending[c.kind][c.key] = c.yours;
      again = true;
    } else {
      rec[c.kind][c.key] = c.theirs;
      setShown(c.kind === "data" ? `[data-key="${c.key}"]` : `[data-remark="${c.key}"]`, c.theirs);
    }
  });
  refresh();
  if (again) { scheduleSave(); await flushSave(); toast("Your value was saved"); }
  else toast("Kept the saved value");
}

// Consignment Test form: same as above
async function mergeSirimSave(rec, form, sent, conflicts) {
  const clash = new Set((conflicts || []).map(c => c.key)), base = rec._base;
  for (const k of Object.keys(sent)) if (!clash.has(k)) base[k] = form.data[k] ?? "";
  for (const f of SIRIM_FIELDS) {
    const k = f.key, v = form.data[k] ?? "";
    if (clash.has(k) || k in sirimPending || v === (base[k] ?? "")) continue;
    rec.data[k] = v;
    base[k] = v;
    setShown(`[data-skey="${k}"]`, v);
  }
  if (rec !== sirimCur) return;
  applyEup();
  drawQtyCheck();
  if (!conflicts?.length) return;
  const pick = await askConflicts(conflicts);
  let again = false;
  conflicts.forEach((c, i) => {
    base[c.key] = c.theirs;
    if (pick[i] === "mine") { rec.data[c.key] = c.yours; sirimPending[c.key] = c.yours; again = true; }
    else { rec.data[c.key] = c.theirs; setShown(`[data-skey="${c.key}"]`, c.theirs); }
  });
  applyEup();
  drawQtyCheck();
  if (again) { await flushSirim(); toast("Your value was saved"); }
  else toast("Kept the saved value");
}

async function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (saving) await saving;
  if (!dirty || !current) return;
  dirty = false;
  const rec = current;
  const sent = pending;
  pending = emptyPending();
  saving = (async () => {
    try {
      const { app, reopened, conflicts } = await api("PUT", `/api/apps/${rec.id}`,
        { ...sent, base: { data: pickBase(rec._base?.data, sent.data), remarks: pickBase(rec._base?.remarks, sent.remarks) } });
      Object.assign(rec, { version: app.version, updatedAt: app.updatedAt, updatedBy: app.updatedBy, summary: app.summary, sections: app.sections });
      if (rec._base && !reopened?.length) mergeCoaSave(rec, app, sent, conflicts);
      if (reopened?.length && rec === current && !dirty) {
        // ST Status set to "Not Submitted": Section I is Draft again - show the unlocked section
        const y = window.scrollY;
        current = app;
        upsertApp(app);
        renderForm();
        window.scrollTo(0, y);
        toast("ST Status is Not Submitted – Section I is back to Draft");
        return;
      }
      if (rec === current) {
        const sb = $("#savebar");
        if (sb && !dirty) sb.textContent = "All changes saved";
        updateMeta();
        refresh();
        updateBell();
      }
    } catch (e) {
      if (e.status === 403 || e.status === 400) {
        // not allowed any more (e.g. section was submitted meanwhile) - reload what the server has
        tell("Could not save: " + e.message);
        if (rec === current) route();
      } else if (e.status !== 401) {
        const merged = emptyPending();
        mergePending(merged, sent); mergePending(merged, pending);
        pending = merged;
        dirty = true;
        const sb = $("#savebar");
        if (sb) sb.textContent = "Save failed – retrying…";
        saveTimer = setTimeout(flushSave, 4000);
      }
    }
  })();
  await saving;
  saving = null;
}

/* =========================================================
   USERS (Super Admin)
   ========================================================= */
let userCache = [];
async function renderUsers() {
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/settings">Settings</a> › <span>Users</span></div>
        <h1 style="margin-top:6px">Users</h1>
        <div class="sub">Create accounts and set each person's account type. Section rights are set under <a href="#/access">Access Control</a> (click a person).</div>
      </div>
      <div class="actions"><button class="btn btn-primary" id="addUser">+ Add user</button></div>
    </div>
    <div class="card" style="padding:12px 16px;font-size:13px;line-height:1.8">
      <strong>Super Admin</strong> – everything, incl. users, positions and section access ·
      <strong>Admin</strong> – sees all applications; edits sections they have access to (even after submit); can reopen sections and delete applications ·
      <strong>User</strong> – works on the same applications but sees only their "Submit Detail" sections; can Save only (an Admin submits) ·
      <strong>Viewer</strong> – read-only
    </div>
    <div class="card">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Account Type</th><th>Status</th><th>Last sign-in</th><th>Signature</th><th></th></tr></thead>
          <tbody id="urows"><tr><td colspan="8" class="empty">Loading…</td></tr></tbody>
        </table>
      </div>
    </div>`;
  $("#addUser").onclick = () => userDialog(null);
  $("#urows").onclick = e => {
    const b = e.target.closest("[data-edit]"), sg = e.target.closest("[data-sig]");
    if (b) userDialog(userCache.find(u => u.id === +b.dataset.edit));
    if (sg) signatureDialog(userCache.find(u => u.id === +sg.dataset.sig), drawUsers);
  };
  await drawUsers();
}

async function drawUsers() {
  userCache = (await api("GET", "/api/users")).users;
  $("#urows").innerHTML = userCache.map(u => `
    <tr style="cursor:default">
      <td><strong>${esc(u.name)}</strong>${u.id === me.id ? ' <span class="muted">(you)</span>' : ""}</td>
      <td>${esc(u.username)}</td>
      <td class="muted" style="font-size:12px">${esc(u.email || "—")}</td>
      <td><span class="badge role-${u.role}">${esc(ROLE_LABEL[u.role] || u.role)}</span></td>
      <td><span class="badge ${u.active ? "approved" : "rejected"}">${u.active ? "Active" : "Disabled"}</span>${u.mustChangePassword ? ' <span class="badge review" title="Will be asked to set a new password at next sign-in">Must change password</span>' : ""}</td>
      <td class="muted">${u.lastLogin ? fmtTime(u.lastLogin) : "Never"}</td>
      <td><button type="button" class="sig-cell" data-sig="${u.id}" title="Upload or draw the signature">${u.signatureAt
        ? `<img loading="lazy" src="/api/users/${u.id}/signature?v=${u.signatureAt}" alt="signature" />` : `<span>✍ Add</span>`}</button></td>
      <td><button class="btn btn-sm" data-edit="${u.id}">Edit</button></td>
    </tr>`).join("");
}

function openDialog(html, onSubmit, submitLabel = "Save", infoOnly = false) {
  const d = $("#dialog");
  d.classList.toggle("wide", infoOnly);
  d.innerHTML = `<form>${html}
    <div class="form-error" id="dlgErr"></div>
    <div class="dlg-actions">
      ${infoOnly ? "" : `<button type="button" class="btn" data-close>Close</button>`}
      <button type="submit" class="btn btn-primary">${esc(submitLabel)}</button>
    </div></form>`;
  const form = d.querySelector("form");
  d.querySelector("[data-close]")?.addEventListener("click", () => d.close());
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('[type="submit"]');
    btn.disabled = true;
    $("#dlgErr").textContent = "";
    try {
      await onSubmit(form);
      d.close();
    } catch (ex) {
      $("#dlgErr").textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  };
  d.showModal();
}

function userDialog(u) {
  const isNew = !u;
  const roleOpts = Object.entries(ROLE_LABEL).map(([r, l]) => `<option value="${r}" ${(u?.role || "user") === r ? "selected" : ""}>${l}</option>`).join("");
  openDialog(`
    <h3>${isNew ? "Add user" : "Edit " + esc(u.name)}</h3>
    <label class="field"><span>Full name</span><input type="text" name="name" required value="${esc(u?.name || "")}" /></label>
    <label class="field"><span>Username <span class="muted" style="font-weight:400">(User ID – capitals do not matter when signing in)</span></span><input type="text" name="username" required value="${esc(u?.username || "")}" autocomplete="off" /></label>
    <label class="field"><span>Email <span class="muted" style="font-weight:400">(for the email alerts)</span></span>
      <input type="email" name="email" value="${esc(u?.email || "")}" placeholder="name@example.com" autocomplete="off" /></label>
    <label class="field"><span>Account Type</span><select name="role">${roleOpts}</select></label>
    <label class="field"><span>${isNew ? "Password" : "New password (leave blank to keep current)"}</span>
      <input type="password" name="password" ${isNew ? "required" : ""} minlength="10" autocomplete="new-password" /></label>
    ${isNew ? "" : `<label class="check-inline"><input type="checkbox" name="active" ${u.active ? "checked" : ""} /> Account active (can sign in)</label>`}
    <p class="muted" style="margin:0;font-size:12px">The person must change this password the first time they sign in (also after you reset it).
      New Users and Admins have no section access until you give it under Access Control.</p>
  `, async form => {
    const f = new FormData(form);
    if (isNew) {
      await api("POST", "/api/users", { name: f.get("name"), username: f.get("username"), email: f.get("email"), role: f.get("role"), password: f.get("password") });
      toast("User added");
    } else {
      const body = { name: f.get("name"), username: f.get("username"), email: f.get("email"), role: f.get("role"), active: form.active.checked };
      if (f.get("password")) body.password = f.get("password");
      const { user } = await api("PUT", `/api/users/${u.id}`, body);
      if (user.id === me.id) {
        Object.assign(me, user);
        if (me.role !== "superadmin") { location.hash = "#/"; location.reload(); return; }
        $("#userName").textContent = me.name;
        $("#avatar").textContent = initials(me.name);
      }
      toast("User updated");
    }
    await drawUsers();
  });
}

function passwordDialog() {
  openDialog(`
    <h3>Change password</h3>
    <label class="field"><span>Current password</span><input type="password" name="current" required autocomplete="current-password" /></label>
    <label class="field"><span>New password</span><input type="password" name="new" required minlength="10" autocomplete="new-password" /></label>
    <label class="field"><span>Confirm new password</span><input type="password" name="confirm" required minlength="10" autocomplete="new-password" /></label>
  `, async form => {
    const f = Object.fromEntries(new FormData(form));
    if (f.new !== f.confirm) throw new Error("New passwords do not match.");
    await api("POST", "/api/me/password", { current: f.current, new: f.new });
    toast("Password changed");
  }, "Change password");
}

/* =========================================================
   ACCESS CONTROL (Super Admin)
   #/access       list of people
   #/access/<id>  one person's rights, grouped by program
   ========================================================= */
// "＋ Add new department…" in a Department dropdown: ask the name; done(name) when OK (an existing name is reused)
const NEW_DEPT = "__newdept";
const NEW_DEPT_OPT = `<option value="${NEW_DEPT}">＋ Add new department…</option>`;
function askNewDept(list, done) {
  openDialog(`<h3>＋ New department</h3>
    <label class="field"><span>Department name</span><input type="text" name="d" maxlength="100" required placeholder="e.g. Customer Service" /></label>
    <p class="muted" style="margin:0;font-size:12px">It is added to the Department list (Settings › HR Setting) and chosen here.</p>`,
    async form => {
      const v = form.d.value.replace(/\s+/g, " ").trim();
      if (!v) throw new Error("Type the department name.");
      $("#dialog").close();
      done(list.find(x => x.toLowerCase() === v.toLowerCase()) || v);
    }, "Add");
  setTimeout(() => $("#dialog").querySelector('[name="d"]')?.focus(), 50);
}
// the position structure: every position under the one it reports to (tops = positions others report to but that report to nobody)
function posTree(roles) {
  const key = x => String(x || "").toLowerCase(), by = Object.fromEntries(roles.map(r => [key(r.name), r])), kids = {};
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  for (const r of roles) { const up = by[key(r.parent)]; if (up && up !== r) (kids[key(up.name)] ||= []).push(r); }
  const tops = roles.filter(r => !by[key(r.parent)] && kids[key(r.name)]).sort(byName);
  const rows = [], seen = new Set();
  const walk = (r, d, last) => {
    if (seen.has(r)) return;
    seen.add(r); rows.push({ r, d, last });
    const k = (kids[key(r.name)] || []).sort(byName);
    k.forEach((c, i) => walk(c, d + 1, i === k.length - 1));
  };
  tops.forEach(t => walk(t, 0, true));
  return { rows, loose: roles.filter(r => !seen.has(r)).sort(byName) };
}
// positions grouped by department, in the order of the Department list (positions without one last)
function posGroups(roles, departments) {
  const order = d => { const i = departments.findIndex(x => x.toLowerCase() === d.toLowerCase()); return d ? (i < 0 ? 900 : i) : 999; };
  const groups = {};
  for (const r of roles) (groups[r.department || ""] ||= []).push(r);
  return Object.entries(groups).sort((a, b) => order(a[0]) - order(b[0]) || a[0].localeCompare(b[0]));
}
async function renderAccess() {
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/settings">Settings</a> › <span>Access Control</span></div>
        <h1 style="margin-top:6px">Access Control</h1>
        <div class="sub">Click a person to set which sections they can edit, tick and resave – or give them a Position.</div>
      </div>
    </div>
    <div class="card" id="roleCard"></div>
    <div class="card"><div class="table-wrap" id="accList"><div class="empty">Loading…</div></div></div>`;
  const { users, access, create, sirimCreate, sections, roles = [], departments = [] } = await api("GET", "/api/access");
  const roleName = id => roles.find(r => r.id === id)?.name;
  let posView = "tree";
  try { posView = localStorage.getItem("acc.posView") || "tree"; } catch { /* private window */ }
  const rightsCell = r => `<td style="font-size:12px">${accRightsText(r.rights, sections) || `<span class="muted">no rights set yet – click to set</span>`}</td>
        <td style="text-align:right"><button class="btn btn-sm">Edit ›</button></td>`;
  const deptTag = r => r.department ? ` <span class="pos-dept">${esc(r.department)}</span>` : "";
  const drawPositions = () => {
    let body;
    if (!roles.length) body = `<tr style="cursor:default"><td colspan="3" class="empty">No position yet. Make one (e.g. "Purchase Clerk"), then give it to people.
             When you change a position later, only what you changed is given to its people – their own other settings stay.</td></tr>`;
    else if (posView === "dept") body = posGroups(roles, departments).map(([dept, list]) => `<tr class="acc-dept-row"><td colspan="3">🏛 ${dept ? esc(dept) : `<span class="muted">No department yet</span>`}
          <span class="muted" style="font-weight:400">(${list.length})</span></td></tr>` + list.map(r => `<tr data-role="${r.id}">
        <td class="acc-pos"><strong>${esc(r.name)}</strong></td>${rightsCell(r)}</tr>`).join("")).join("");
    else {
      const { rows, loose } = posTree(roles);
      body = rows.map(({ r, d, last }) => `<tr data-role="${r.id}" class="${d ? "" : "pos-root"}">
          <td class="pos-tree" style="padding-left:${16 + d * 28}px">${d ? `<span class="pos-line">${last ? "└" : "├"}</span>` : "🔝 "}<strong>${esc(r.name)}</strong>${deptTag(r)}</td>${rightsCell(r)}</tr>`).join("")
        + (loose.length ? `<tr class="acc-dept-row"><td colspan="3">📌 Not in the structure yet <span class="muted" style="font-weight:400">(${loose.length}) – open a position and choose “Reports to”</span></td></tr>`
          + loose.map(r => `<tr data-role="${r.id}"><td class="acc-pos"><strong>${esc(r.name)}</strong>${deptTag(r)}</td>${rightsCell(r)}</tr>`).join("") : "");
    }
    $("#roleCard").innerHTML = `
    <div class="prog-title" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
      <span>🧩 Positions <span class="muted" style="font-weight:400;font-size:12px">– the same list as the staff Positions (Settings › HR Setting) · a set of rights given to many people at once</span></span>
      <span style="display:inline-flex;gap:6px;align-items:center">
        <span class="memo-modes"><button class="btn btn-sm ${posView === "tree" ? "on" : ""}" data-posview="tree" title="Who reports to whom">🌳 Structure</button><button class="btn btn-sm ${posView === "dept" ? "on" : ""}" data-posview="dept" title="Grouped by department">🏛 By department</button></span>
        <a class="btn btn-sm btn-primary" href="#/access/role/new">+ New position</a></span></div>
    <div class="table-wrap"><table>
      <thead><tr><th>${posView === "dept" ? "Department / Position" : "Structure (reports to)"}</th><th>Rights</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  };
  drawPositions();
  $("#roleCard").onclick = e => {
    const v = e.target.closest("[data-posview]");
    if (v) { posView = v.dataset.posview; try { localStorage.setItem("acc.posView", posView); } catch { /* private window */ } drawPositions(); return; }
    const tr = e.target.closest("tr[data-role]"); if (tr) location.hash = "#/access/role/" + tr.dataset.role;
  };
  const ebChip = u => {
    const e = access[u.id]?.EB;
    return e && (e.view || e.edit) ? `<span class="acc-chip sirim" title="Email Batch">EB${e.edit ? " ✎" : " 👁"}</span>` : "";
  };
  const sirimChip = u => {
    const sa = access[u.id]?.SIRIM, sc = sirimCreate?.[u.id];
    if (!sc && !(sa && (sa.edit || sa.view))) return "";
    return `<span class="acc-chip sirim" title="${CT_NAME}">CTA${sa?.edit ? " ✎" : sa?.view ? " 👁" : ""}${sc ? " ＋" : ""}</span>`;
  };
  const summary = u => {
    if (u.role === "superadmin") return `<span class="acc full">Full access to everything</span>`;
    if (u.role === "viewer") return `<span class="muted">View only</span>`;
    const secs = sections.filter(s => access[u.id]?.[s.id]?.edit || access[u.id]?.[s.id]?.check || access[u.id]?.[s.id]?.view);
    const newChip = create[u.id] ? `<span class="acc-chip new">＋ New application</span>` : "";
    if (!secs.length) return newChip + sirimChip(u) + ebChip(u) + (sirimChip(u) || ebChip(u) ? "" : `<span class="muted">No section access yet</span>`);
    return newChip + sirimChip(u) + ebChip(u) + secs.map(s => {
      const a = access[u.id][s.id];
      const viewOnly = !a.edit && a.view;
      return `<span class="acc-chip ${viewOnly ? "view" : ""}" title="${esc(s.name)}">${s.id}${a.edit ? " ✎" : ""}${a.check ? " ☑" : ""}${viewOnly ? " 👁" : ""}</span>`;
    }).join("");
  };
  $("#accList").innerHTML = `<table>
    <thead><tr><th>Name</th><th>Account Type</th><th>Position</th><th>Access</th><th></th></tr></thead>
    <tbody>${users.map(u => {
      const settable = u.role === "admin" || u.role === "user";
      return `<tr ${settable ? `data-uid="${u.id}"` : 'style="cursor:default"'}>
        <td><strong>${esc(u.name)}</strong> <span class="muted">${esc(u.username)}</span>${u.active ? "" : ' <span class="badge rejected">Disabled</span>'}</td>
        <td><span class="badge role-${u.role}">${ROLE_LABEL[u.role]}</span></td>
        <td>${settable && roleName(u.accessRole) ? `<span class="acc-chip role">🧩 ${esc(roleName(u.accessRole))}</span>` : settable ? `<span class="muted">—</span>` : ""}</td>
        <td>${summary(u)}</td>
        <td style="text-align:right">${settable ? `<button class="btn btn-sm">Set access ›</button>` : ""}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>
  <div class="muted" style="padding:10px 14px;font-size:12px">＋ = can create new applications · 👁 = view only · ✎ = submit detail · ☑ = tick checklist. Super Admin always has full access; Viewers are read-only.</div>`;
  $("#accList").onclick = e => {
    const tr = e.target.closest("tr[data-uid]");
    if (tr) location.hash = "#/access/" + tr.dataset.uid;
  };
}

// rights (as the Access Control page sends them) -> flat {key: value} and readable labels, to show what a role change does
function accFlat(r, sections) {
  r = r || {};
  const f = { "coa.create": !!r.create };
  for (const s of sections) {
    const a = r.sections?.[s.id] || {};
    f[`${s.id}.view`] = !!(a.view || a.edit); f[`${s.id}.edit`] = !!a.edit; f[`${s.id}.check`] = !!(a.check && a.edit);
    f[`${s.id}.resubmits`] = a.edit ? +(a.resubmits || 0) : 0;
  }
  const si = r.sirim || {};
  Object.assign(f, { "sirim.create": !!si.create, "SIRIM.view": !!(si.view || si.edit), "SIRIM.edit": !!si.edit, "SIRIM.resubmits": si.edit ? +(si.resubmits || 0) : 0,
    "EB.view": !!(r.eb?.view || r.eb?.edit), "EB.edit": !!r.eb?.edit, "HR.view": !!(r.hr?.view || r.hr?.edit), "HR.edit": !!r.hr?.edit,
    "MC.view": !!(r.mc?.view || r.mc?.edit), "MC.edit": !!r.mc?.edit, "TR.view": !!(r.tr?.view || r.tr?.edit), "TR.edit": !!r.tr?.edit,
    "TA.view": !!(r.ta?.view || r.ta?.edit), "TA.edit": !!r.ta?.edit, "WH.view": !!(r.wh?.view || r.wh?.edit), "WH.edit": !!r.wh?.edit,
    "MM.edit": !!r.mm?.edit, "MM.check": !!r.mm?.check });
  return f;
}
function accLabel(k, sections) {
  const [a, b] = k.split(".");
  const what = { view: "View", edit: "Submit Detail", check: "Tick Checklist", resubmits: "Resave Allowed", create: "Create New" }[b] || b;
  if (a === "coa") return "COA Application – Create New Application";
  if (a === "sirim") return `${CT_NAME} – Create New Application`;
  if (a === "SIRIM") return `${CT_NAME} – ${what}`;
  if (a === "EB") return `Email Batch – ${b === "edit" ? "Create & Send" : "View"}`;
  if (a === "HR") return `Staff Master Data – ${b === "edit" ? "Edit & Import" : "View"}`;
  if (a === "MC") return `MC Request – ${b === "edit" ? "HR (check & approve all)" : "Submit own"}`;
  if (a === "TR") return `Transfer Form – ${b === "edit" ? "HR (all forms)" : "Fill in (own forms)"}`;
  if (a === "TA") return `Time Adjustment – ${b === "edit" ? "HR (all forms)" : "Fill in (own forms)"}`;
  if (a === "WH") return `Online Shop Delivery – ${b === "edit" ? "Create & Scan" : "View & Print"}`;
  if (a === "MM") return `Memo – ${b === "edit" ? "HR (create, post, all memos)" : "Approve (person in charge)"}`;
  const s = sections.find(x => x.id === a);
  return `COA ${a}. ${s ? s.name : ""} – ${what}`;
}
function accRightsText(r, sections) {
  const f = accFlat(r, sections), out = [];
  if (f["coa.create"]) out.push("COA ＋");
  const secs = sections.filter(s => f[`${s.id}.view`]).map(s => `${s.id}${f[`${s.id}.edit`] ? "✎" : "👁"}${f[`${s.id}.check`] ? "☑" : ""}`);
  if (secs.length) out.push("COA " + secs.join(" "));
  if (f["SIRIM.view"] || f["sirim.create"]) out.push(`CTA${f["SIRIM.edit"] ? "✎" : f["SIRIM.view"] ? "👁" : ""}${f["sirim.create"] ? "＋" : ""}`);
  if (f["EB.view"]) out.push(`Email Batch${f["EB.edit"] ? "✎" : "👁"}`);
  if (f["HR.view"]) out.push(`Staff Master Data${f["HR.edit"] ? "✎" : "👁"}`);
  if (f["MC.view"]) out.push(`MC Request${f["MC.edit"] ? " (HR)" : ""}`);
  if (f["TR.view"]) out.push(`Transfer${f["TR.edit"] ? " (HR)" : ""}`);
  if (f["TA.view"]) out.push(`Time Adjustment${f["TA.edit"] ? " (HR)" : ""}`);
  if (f["WH.view"]) out.push(`Online Shop Delivery${f["WH.edit"] ? "✎" : "👁"}`);
  if (f["MM.edit"] || f["MM.check"]) out.push(`Memo ${[f["MM.edit"] ? "HR" : "", f["MM.check"] ? "Approve" : ""].filter(Boolean).join(" + ")}`);
  return out.map(x => `<span class="acc-chip">${esc(x)}</span>`).join("");
}

async function renderAccessUser(uid, roleId) {
  const { users, access, create, sirimCreate, sections, roles = [], departments = [] } = await api("GET", "/api/access");
  let u, mine, createOn, sirimCreateOn, role = null;
  if (roleId) {                                              // editing an Access Role (same page as for a person)
    role = roleId === "new" ? { id: null, name: "", rights: {}, members: [] } : roles.find(r => r.id === roleId);
    if (!role) { location.replace("#/access"); return; }
    const rt = role.rights || {};
    u = { id: null, name: role.name || "New position", role: "user" };
    mine = { ...(rt.sections || {}), SIRIM: rt.sirim, EB: rt.eb, HR: rt.hr, MC: rt.mc, TR: rt.tr, TA: rt.ta, MM: rt.mm };
    createOn = !!rt.create; sirimCreateOn = !!rt.sirim?.create;
  } else {
    u = users.find(x => x.id === uid);
    if (!u || !(u.role === "admin" || u.role === "user")) { location.replace("#/access"); return; }
    mine = access[u.id] || {};
    createOn = !!create[u.id]; sirimCreateOn = !!sirimCreate?.[u.id];
  }
  const isUserRole = u.role === "user";
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/access" style="text-decoration:none;font-weight:600">← Back to Access Control</a>
        ${role ? `<h1 style="margin-top:6px">🧩 ${role.id ? esc(role.name) : "New position"}</h1>
        <div class="sub">A Position is a set of rights for many people – the same list as the staff Positions (Settings › HR Setting);
          renaming here renames it there and on the staff. When you save a change here, <strong>only the rights you changed</strong>
          are given to (or taken from) its ${role.members.length} person(s) – their own other settings stay as they are.</div>
        <div class="acc-role-fields">
          <label class="field"><span>Department</span>
            <select id="roleDept"><option value="">– no department –</option>${[...departments, ...(role.department && !departments.some(x => x.toLowerCase() === role.department.toLowerCase()) ? [role.department] : [])]
              .map(x => `<option ${x.toLowerCase() === (role.department || "").toLowerCase() ? "selected" : ""}>${esc(x)}</option>`).join("")}${NEW_DEPT_OPT}</select></label>
          <label class="field"><span>Position name</span>
            <input type="text" id="roleName" maxlength="80" value="${esc(role.name)}" placeholder="e.g. Purchase Clerk" /></label>
          <label class="field"><span>Reports to</span>
            <select id="roleParent"><option value="">– nobody (top) –</option>${(() => {
              const key = x => String(x || "").toLowerCase(), below = new Set([key(role.name)]);
              let grew = true;                                  // the position itself and everything under it cannot be chosen
              while (grew) { grew = false; for (const r of roles) if (below.has(key(r.parent)) && !below.has(key(r.name))) { below.add(key(r.name)); grew = true; } }
              return roles.filter(r => !below.has(key(r.name))).sort((a, b) => a.name.localeCompare(b.name))
                .map(r => `<option ${key(r.name) === key(role.parent) ? "selected" : ""}>${esc(r.name)}</option>`).join("");
            })()}</select></label></div>
        <div class="muted" style="font-size:12px">The Department list is in Settings › HR Setting (it also decides who sees a Memo sent to a department).</div>
`
        : `<h1 style="margin-top:6px">${esc(u.name)} <span class="badge role-${u.role}" style="vertical-align:middle">${ROLE_LABEL[u.role]}</span></h1>`}
        <div class="sub" ${role ? 'style="margin-top:10px"' : ""}>${isUserRole
          ? "View Only: can see the section but not change it. Submit Detail: can fill in and submit it (includes viewing). Sections with neither are hidden. Users Save only – an Admin submits, and a submitted section is locked for Users. Resave Allowed is how many more times this person may unlock it and save again. Tick Checklist only works together with Submit Detail."
          : "Admins can view every section. Tick where they may submit detail or tick the checklist – they can change these sections even after submission."}</div>
      </div>
    </div>

    ${!role ? `<div class="card acc-rolebox">
      <div class="prog-title">🧩 Position</div>
      <div class="acc-rolebody">
        <select id="roleSel"><option value="">— No position —</option>${roles.map(r => `<option value="${r.id}" ${r.id === u.accessRole ? "selected" : ""}>${esc(r.name)}</option>`).join("")}</select>
        <label class="check-line"><input type="radio" name="roleMode" value="add" checked /> <span>Add the position's rights – keep this person's own</span></label>
        <label class="check-line"><input type="radio" name="roleMode" value="replace" /> <span>Exactly the position's rights</span></label>
        <button class="btn btn-primary btn-sm" id="roleApply">Apply</button>
      </div>
      <div class="muted" style="font-size:12px;padding:0 16px 12px">${roles.length ? "Later changes to the position are given to this person automatically – only what changed in the position."
        : `No position yet – <a href="#/access/role/new">make one</a>.`}</div>
    </div>` : ""}
    <div class="card">
      <div class="prog-title">📋 COA Application</div>
      <label class="create-row">
        <input type="checkbox" id="canCreate" ${createOn ? "checked" : ""} />
        <span><strong>Create New Application</strong><br><span class="muted">Can start new applications</span></span>
      </label>
      <div class="table-wrap">
        <table class="acc-table">
          <thead><tr>
            <th>Section</th>
            <th style="text-align:center">View Only<br>${isUserRole ? `<label class="all"><input type="checkbox" data-all="view" /> all</label>` : `<span class="all muted">admins see all</span>`}</th>
            <th style="text-align:center">Submit Detail<br><label class="all"><input type="checkbox" data-all="edit" /> all</label></th>
            <th style="text-align:center">Tick Checklist<br><label class="all"><input type="checkbox" data-all="check" /> all</label></th>
            <th style="text-align:center">Resave Allowed</th>
          </tr></thead>
          <tbody>${sections.map(s => {
            const a = mine[s.id] || { view: false, edit: false, check: false, resubmits: 0 };
            return `<tr data-sec="${s.id}" style="cursor:default">
              <td><strong>${s.id}. ${esc(s.name)}</strong></td>
              <td style="text-align:center">${isUserRole
                ? `<input type="checkbox" name="view" ${a.view || a.edit ? "checked" : ""} />`
                : `<span class="muted">Always</span>`}</td>
              <td style="text-align:center"><input type="checkbox" name="edit" ${a.edit ? "checked" : ""} /></td>
              <td style="text-align:center"><input type="checkbox" name="check" ${a.check ? "checked" : ""} /></td>
              <td style="text-align:center">${isUserRole
                ? `<input type="number" name="resubmits" min="0" max="99" value="${a.resubmits}" style="width:80px;text-align:center" />`
                : `<span class="muted">No Limit</span>`}</td>
            </tr>`;
          }).join("")}</tbody>
        </table>
      </div>
      <div class="prog-title" style="border-top:1px solid var(--line)">🔎 ${CT_NAME}</div>
      <label class="create-row">
        <input type="checkbox" id="sirimCreate" ${sirimCreateOn ? "checked" : ""} />
        <span><strong>Create New Application</strong><br><span class="muted">Can start new Consignment Test forms</span></span>
      </label>
      <div class="table-wrap">
        <table class="sirim-table">
          <thead><tr><th>Form</th><th style="text-align:center">View Only</th><th style="text-align:center">Submit Detail</th><th style="text-align:center">Resave Allowed</th></tr></thead>
          <tbody><tr style="cursor:default">
            <td><strong>${CT_NAME}</strong></td>
            <td style="text-align:center">${isUserRole ? `<input type="checkbox" id="sirimView" ${mine.SIRIM?.view || mine.SIRIM?.edit ? "checked" : ""} />` : `<span class="muted">Always</span>`}</td>
            <td style="text-align:center"><input type="checkbox" id="sirimEdit" ${mine.SIRIM?.edit ? "checked" : ""} /></td>
            <td style="text-align:center">${isUserRole ? `<input type="number" id="sirimResub" min="0" max="99" value="${mine.SIRIM?.resubmits || 0}" style="width:80px;text-align:center" />` : `<span class="muted">No Limit</span>`}</td>
          </tr></tbody>
        </table>
      </div>
      <div class="prog-title" style="border-top:1px solid var(--line)">✉️ Email Batch <span class="muted" style="font-weight:400;font-size:12px">– Marketing Dept</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Program</th><th style="text-align:center">View</th><th style="text-align:center">Create &amp; Send</th></tr></thead>
          <tbody><tr style="cursor:default">
            <td><strong>Email Batch</strong><br><span class="muted" style="font-size:12px">View = see batches and the emails sent · Create &amp; Send = make batches and send to customers</span></td>
            <td style="text-align:center"><input type="checkbox" id="ebView" ${mine.EB?.view || mine.EB?.edit ? "checked" : ""} /></td>
            <td style="text-align:center"><input type="checkbox" id="ebEdit" ${mine.EB?.edit ? "checked" : ""} /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="prog-title" style="border-top:1px solid var(--line)">🪪 Staff Master Data <span class="muted" style="font-weight:400;font-size:12px">– HR Dept</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Program</th><th style="text-align:center">View</th><th style="text-align:center">Edit &amp; Import</th></tr></thead>
          <tbody><tr style="cursor:default">
            <td><strong>Staff Master Data</strong><br><span class="muted" style="font-size:12px">View = see the staff list and export it · Edit &amp; Import = add, change, remove and import staff</span></td>
            <td style="text-align:center"><input type="checkbox" id="hrView" ${mine.HR?.view || mine.HR?.edit ? "checked" : ""} /></td>
            <td style="text-align:center"><input type="checkbox" id="hrEdit" ${mine.HR?.edit ? "checked" : ""} /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="prog-title" style="border-top:1px solid var(--line)">🔁 Transfer Form <span class="muted" style="font-weight:400;font-size:12px">– HR Dept</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Program</th><th style="text-align:center">Fill in (own forms)</th><th style="text-align:center">HR – all forms</th></tr></thead>
          <tbody><tr style="cursor:default">
            <td><strong>Transfer Form</strong><br><span class="muted" style="font-size:12px">Fill in = make transfer forms, upload the signed letter, see own forms · HR = see all, upload HR's signed letter, complete and cancel</span></td>
            <td style="text-align:center"><input type="checkbox" id="trView" ${mine.TR?.view || mine.TR?.edit ? "checked" : ""} /></td>
            <td style="text-align:center"><input type="checkbox" id="trEdit" ${mine.TR?.edit ? "checked" : ""} /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="prog-title" style="border-top:1px solid var(--line)">⏱ Time Adjustment <span class="muted" style="font-weight:400;font-size:12px">– HR Dept</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Program</th><th style="text-align:center">Fill in (own forms)</th><th style="text-align:center">HR – all forms</th></tr></thead>
          <tbody><tr style="cursor:default">
            <td><strong>Time Adjustment</strong><br><span class="muted" style="font-size:12px">Fill in = make time adjustment forms for the staff of own outlet / team, acknowledge after HR completes · HR = see every submitted form, tick / decline lines, complete, cancel, reason codes</span></td>
            <td style="text-align:center"><input type="checkbox" id="taView" ${mine.TA?.view || mine.TA?.edit ? "checked" : ""} /></td>
            <td style="text-align:center"><input type="checkbox" id="taEdit" ${mine.TA?.edit ? "checked" : ""} /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="prog-title" style="border-top:1px solid var(--line)">🚚 Online Shop Delivery <span class="muted" style="font-weight:400;font-size:12px">– Warehouse Dept</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Program</th><th style="text-align:center">View &amp; Print</th><th style="text-align:center">Create &amp; Scan</th></tr></thead>
          <tbody><tr style="cursor:default">
            <td><strong>Online Shop Delivery</strong><br><span class="muted" style="font-size:12px">View &amp; Print = see the carrier manifests, find a tracking number, print · Create &amp; Scan = make manifests, scan / take off parcels, lock, cancel, couriers &amp; channels</span></td>
            <td style="text-align:center"><input type="checkbox" id="whView" ${mine.WH?.view || mine.WH?.edit ? "checked" : ""} /></td>
            <td style="text-align:center"><input type="checkbox" id="whEdit" ${mine.WH?.edit ? "checked" : ""} /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="prog-title" style="border-top:1px solid var(--line)">🩺 MC Request <span class="muted" style="font-weight:400;font-size:12px">– HR Dept</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Program</th><th style="text-align:center">Submit own</th><th style="text-align:center">HR – check &amp; approve all</th></tr></thead>
          <tbody><tr style="cursor:default">
            <td><strong>MC Request</strong><br><span class="muted" style="font-size:12px">Submit own = fill in the MC Request Form and see own requests · HR = see every request, approve / reject, tick "original MC received"</span></td>
            <td style="text-align:center"><input type="checkbox" id="mcView" ${mine.MC?.view || mine.MC?.edit ? "checked" : ""} /></td>
            <td style="text-align:center"><input type="checkbox" id="mcEdit" ${mine.MC?.edit ? "checked" : ""} /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="prog-title" style="border-top:1px solid var(--line)">📢 Memo <span class="muted" style="font-weight:400;font-size:12px">– General (every login can read the memos posted to them)</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Program</th><th style="text-align:center">HR – create, post, all memos</th><th style="text-align:center">Approve (person in charge)</th></tr></thead>
          <tbody><tr style="cursor:default">
            <td><strong>Memo</strong><br><span class="muted" style="font-size:12px">HR = Memo Create Form, Memo Listings, edit, post and cancel · Approve = Memo Approval: approve memos with an e-signature (HR chooses the person in charge on each memo)</span></td>
            <td style="text-align:center"><input type="checkbox" id="mmEdit" ${mine.MM?.edit ? "checked" : ""} /></td>
            <td style="text-align:center"><input type="checkbox" id="mmCheck" ${mine.MM?.check ? "checked" : ""} /></td>
          </tr></tbody>
        </table>
      </div>
      <div class="toolbar" style="border-top:1px solid var(--line);border-bottom:none;justify-content:flex-end">
        ${role?.id ? `<button class="btn btn-danger" id="delRole" style="margin-right:auto">Delete position</button>` : ""}
        <a class="btn" href="#/access">Cancel</a>
        <button class="btn btn-primary" id="saveAccess">Save</button>
      </div>
    </div>`;

  // for Users, Tick Checklist only works together with Submit Detail
  const syncRows = () => {
    if (!isUserRole) return;
    document.querySelectorAll(".acc-table tbody tr").forEach(tr => {
      const ed = tr.querySelector('[name="edit"]').checked, ck = tr.querySelector('[name="check"]');
      const vw = tr.querySelector('[name="view"]');
      if (ed) vw.checked = true;          // Submit Detail already includes viewing
      vw.disabled = ed;
      ck.disabled = !ed;
      if (!ed) ck.checked = false;
      const rs = tr.querySelector('[name="resubmits"]');
      if (rs) rs.disabled = !ed;
    });
  };
  const syncAll = () => ["view", "edit", "check"].forEach(k => {
    const boxes = [...document.querySelectorAll(`.acc-table tbody [name="${k}"]`)];
    const all = $(`[data-all="${k}"]`);
    if (all) all.checked = boxes.length > 0 && boxes.every(b => b.checked);
  });
  syncRows();
  syncAll();
  const syncSirim = () => {             // Submit Detail includes viewing; resubmits only matter with Submit Detail
    const ed = $("#sirimEdit").checked, vw = $("#sirimView"), rs = $("#sirimResub");
    if (vw) { if (ed) vw.checked = true; vw.disabled = ed; }
    if (rs) rs.disabled = !ed;
  };
  syncSirim();
  $(".sirim-table").onchange = syncSirim;
  $(".acc-table").onchange = e => {
    const all = e.target.dataset.all;
    if (all) document.querySelectorAll(`.acc-table tbody [name="${all}"]`).forEach(b => { if (!b.disabled || all === "edit") b.checked = e.target.checked; });
    syncRows();
    syncAll();
  };
  if ($("#roleApply")) $("#roleApply").onclick = async () => {
    const rid = $("#roleSel").value ? +$("#roleSel").value : null, mode = document.querySelector('[name="roleMode"]:checked').value;
    const rn = roles.find(r => r.id === rid)?.name;
    if (rid && mode === "replace" && !await ask(`Give ${u.name} exactly the rights of "${rn}"? Rights this person has that the position does not have are taken away.`, "Apply")) return;
    try {
      await api("PUT", `/api/access/users/${u.id}/role`, { roleId: rid, mode });
      toast(rid ? `${u.name}: position ${rn} applied` : `${u.name}: no position (rights stay as they are)`);
      renderAccessUser(u.id);
    } catch (ex) { tell(ex.message); }
  };
  if ($("#delRole")) $("#delRole").onclick = async () => {
    if (!await ask(`Delete the position "${role.name}"?\n\nIt is also taken out of the staff Positions (HR Setting). Its ${role.members.length} person(s) keep the rights they have now.`, "Delete")) return;
    try { await api("POST", `/api/access/roles/${role.id}/delete`, {}); toast("Position deleted"); location.hash = "#/access"; }
    catch (ex) { tell(ex.message); }
  };
  if ($("#roleDept")) {
    let lastDept = $("#roleDept").value;
    $("#roleDept").onchange = e => {
      const sel = e.target;
      if (sel.value !== NEW_DEPT) { lastDept = sel.value; return; }
      sel.value = lastDept;                                    // stays as it was if the box is closed
      askNewDept(departments, name => {
        if (![...sel.options].some(o => o.value === name)) sel.lastElementChild.insertAdjacentHTML("beforebegin", `<option>${esc(name)}</option>`);
        sel.value = lastDept = name;
        if (!departments.includes(name)) departments.push(name);
        toast(`${name} – press Save to keep it`);
      });
    };
  }
  $("#saveAccess").onclick = async () => {
    const out = {};
    document.querySelectorAll(".acc-table tbody tr").forEach(tr => {
      out[tr.dataset.sec] = {
        view: !!tr.querySelector('[name="view"]')?.checked,
        edit: tr.querySelector('[name="edit"]').checked,
        check: tr.querySelector('[name="check"]').checked,
        resubmits: +(tr.querySelector('[name="resubmits"]')?.value || 0),
      };
    });
    const rights = { create: $("#canCreate").checked, sections: out, sirim: {
        create: $("#sirimCreate").checked, edit: $("#sirimEdit").checked,
        view: isUserRole ? $("#sirimView").checked : true, resubmits: +($("#sirimResub")?.value || 0) },
        eb: { view: $("#ebView").checked || $("#ebEdit").checked, edit: $("#ebEdit").checked },
        hr: { view: $("#hrView").checked || $("#hrEdit").checked, edit: $("#hrEdit").checked },
        mc: { view: $("#mcView").checked || $("#mcEdit").checked, edit: $("#mcEdit").checked },
        tr: { view: $("#trView").checked || $("#trEdit").checked, edit: $("#trEdit").checked },
        ta: { view: $("#taView").checked || $("#taEdit").checked, edit: $("#taEdit").checked },
        wh: { view: $("#whView").checked || $("#whEdit").checked, edit: $("#whEdit").checked },
        mm: { edit: $("#mmEdit").checked, check: $("#mmCheck").checked } };
    try {
      if (role) {
        const name = $("#roleName").value.trim();
        if (!name) { tell("Type a name for the position."); return; }
        if (!role.id) {
          await api("POST", "/api/access/roles", { name, rights, department: $("#roleDept").value, parent: $("#roleParent").value });
          toast(`Position ${name} created – now give it to people (click a person)`);
          location.hash = "#/access";
          return;
        }
        const before = accFlat(role.rights, sections), after = accFlat(rights, sections);
        const diff = Object.keys(after).filter(k => before[k] !== after[k]).map(k => typeof after[k] === "boolean"
          ? `${after[k] ? "＋" : "－"} ${accLabel(k, sections)}` : `• ${accLabel(k, sections)}: ${before[k]} → ${after[k]}`);
        if (diff.length && role.members.length && !await ask(`Save "${name}"? These changes are given to its ${role.members.length} person(s) – `
            + `nothing else of theirs changes:\n\n${diff.slice(0, 15).join("\n")}${diff.length > 15 ? `\n… and ${diff.length - 15} more` : ""}`, "Save")) return;
        const r = await api("PUT", `/api/access/roles/${role.id}`, { name, rights, department: $("#roleDept").value, parent: $("#roleParent").value });
        toast(r.changed.length ? `Position saved – ${r.changed.length} change(s) given to ${r.people} person(s)` : "Position saved");
        location.hash = "#/access";
        return;
      }
      await api("PUT", `/api/access/users/${u.id}`, rights);
      toast(`Access saved for ${u.name}`);
      location.hash = "#/access";
    } catch (ex) { toast(ex.message); }
  };
}

/* =========================================================
   AUDIT TRAIL (Super Admin, Admin, Viewer)
   #/audit        list of COA documents
   #/audit/<id>   every amendment made to one document
   ========================================================= */
const FIELD_INFO = (() => {
  const m = { dateApply: { label: "Date Apply", type: "date" } };
  for (const s of SECTIONS) for (const it of s.items) {
    m[it.key] = { label: it.label, type: it.type, sec: s.id };
    if (it.attach) m[it.key + "__att"] = { label: `${it.label} – ${it.attach}`, type: "file", sec: s.id };
  }
  return m;
})();
const ACTION_LABEL = {
  create: "Created application", edit: "Amended", check: "Ticked checklist", uncheck: "Unticked checklist",
  remark: "Changed remark", file_upload: "Uploaded file", file_remove: "Removed file",
  submit: "Submitted section", resubmit: "Unlocked to resave", reopen: "Reopened section", cancel: "Cancelled application",
};
const ACTION_CLS = { create: "approved", cancel: "cancelled", submit: "submitted", reopen: "review", resubmit: "review", file_remove: "rejected", uncheck: "rejected" };
Object.assign(FIELD_INFO, {
  estArrival: { label: "Estimate Arrival Date", type: "date" }, estInspection: { label: "Estimate Inspection Date", type: "date" },
  invoice: { label: "Invoice", type: "file" }, packingList: { label: "Packing List", type: "file" },
  bol: { label: "Bill of Lading (BOL)", type: "file" }, serialFile: { label: "Serial Number file", type: "file" },
  serials: { label: "Serial numbers", type: "text" },
});
const secName = id => { if (id === "SIRIM") return "Consignment Test"; const s = SECTIONS.find(x => x.id === id); return s ? `${s.id}. ${s.short}` : "General"; };
function auditValue(field, v) {
  if (v === null || v === undefined) return "";
  if (v === "") return "(empty)";
  return FIELD_INFO[field]?.type === "date" ? fmtDate(v) : v;
}

async function renderAuditList() {
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Audit Trail</h1>
        <div class="sub">Every COA document with its full history of amendments. Click a document to see who changed what, and when.</div>
      </div>
    </div>
    <div class="card">
      <div class="toolbar"><input type="text" id="aq" placeholder="Search form no., equipment, model…" /></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Form No.</th><th>Equipment</th><th>Company Model</th><th>Created</th><th style="text-align:center">Amendments</th><th>Last Change</th><th></th></tr></thead>
        <tbody id="arows"><tr><td colspan="7" class="empty">Loading…</td></tr></tbody>
      </table></div>
    </div>`;
  const { docs } = await api("GET", "/api/audit");
  const draw = () => {
    const q = $("#aq").value.toLowerCase().trim();
    const list = docs.filter(d => !q || [d.formNo, d.equipmentName, d.companyModel].some(v => (v || "").toLowerCase().includes(q)));
    $("#arows").innerHTML = list.length ? list.map(d => `
      <tr data-aid="${d.id}">
        <td><strong>${esc(d.formNo)}</strong>${d.cancelled ? ' <span class="badge cancelled">Cancelled</span>' : ""}</td>
        <td>${esc(d.equipmentName || "—")}</td>
        <td>${esc(d.companyModel || "—")}</td>
        <td class="muted" style="font-size:12px">${esc(d.createdBy)}<br>${fmtTime(d.createdAt)}</td>
        <td style="text-align:center"><strong>${d.changes}</strong></td>
        <td class="muted" style="font-size:12px">${d.lastAt ? `${esc(d.lastBy)}<br>${fmtTime(d.lastAt)}` : "—"}</td>
        <td style="text-align:right"><button class="btn btn-sm">View ›</button></td>
      </tr>`).join("") : `<tr><td colspan="7" class="empty">${docs.length ? "No matching documents." : "No COA documents yet."}</td></tr>`;
  };
  draw();
  $("#aq").oninput = draw;
  $("#arows").onclick = e => {
    const tr = e.target.closest("tr[data-aid]");
    if (tr) location.hash = "#/audit/" + tr.dataset.aid;
  };
}

async function renderAuditDoc(id, prog = "coa") {
  const S = prog === "sirim", backTo = S ? "#/sirim-audit" : "#/audit";
  let res;
  try { res = await api("GET", S ? `/api/sirim/${id}/audit` : `/api/audit/${id}`); } catch (ex) { toast(ex.message); location.replace(backTo); return; }
  const { doc, entries } = res;
  const docTitle = S ? (doc.coaNo ? "COA No. " + doc.coaNo : CT_NAME) : [doc.equipmentName, doc.companyModel].filter(Boolean).join(" · ");
  const people = [...new Set(entries.map(e => e.by).filter(Boolean))].sort();
  const secsUsed = [...new Set(entries.map(e => e.section || ""))].sort();
  $("#app").innerHTML = `
    <div class="page-head no-print">
      <div>
        <a href="${backTo}" style="text-decoration:none;font-weight:600">← Back to Audit Trail</a>
        <h1 style="margin-top:6px">${esc(doc.formNo)} ${doc.cancelled ? '<span class="badge cancelled" style="vertical-align:middle">Cancelled</span>' : ""}</h1>
        <div class="sub">${esc(docTitle || "Untitled")} · created by ${esc(doc.createdBy)}, ${fmtTime(doc.createdAt)} · ${entries.length} audit entries</div>
      </div>
      <div class="actions">
        <a class="btn" href="${S ? "#/sirim/" : "#/app/"}${doc.id}">${S ? "Open form" : "Open application"}</a>
        <a class="btn" href="#/versions/${S ? "sirim" : "coa"}/${doc.id}">Versions</a>
        <button class="btn" id="auditCsv">Export CSV</button>
        <button class="btn" id="auditPrint">Print / PDF</button>
      </div>
    </div>
    <table class="print-frame">
      <thead class="print-only"><tr><td><img class="letterhead" src="letterhead.png" alt="Company Name Sdn. Bhd." /></td></tr></thead>
      <tbody><tr><td>
        <div class="print-only audit-print-title">
          <strong>AUDIT TRAIL – ${esc(doc.formNo)}</strong><br>
          ${esc(docTitle)} · printed ${fmtTime(Date.now() / 1000)}
        </div>
        <div class="card">
          <div class="toolbar no-print">
            <select id="fSec"><option value="*">All sections</option>${secsUsed.map(s => `<option value="${esc(s)}">${esc(secName(s))}</option>`).join("")}</select>
            <select id="fBy"><option value="">Everyone</option>${people.map(p => `<option>${esc(p)}</option>`).join("")}</select>
            <select id="fAct"><option value="">All actions</option>${Object.entries(ACTION_LABEL).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
            <input type="text" id="fTxt" placeholder="Search item or value…" />
          </div>
          <div class="table-wrap"><table class="audit-table">
            <thead><tr><th>Date &amp; Time</th><th>By</th><th>Action</th><th>Section</th><th>Item</th><th>Before</th><th>After</th></tr></thead>
            <tbody id="auditRows"></tbody>
          </table></div>
        </div>
      </td></tr></tbody>
    </table>`;

  const filtered = () => {
    const fs = $("#fSec").value, fb = $("#fBy").value, fa = $("#fAct").value, q = $("#fTxt").value.toLowerCase().trim();
    return entries.filter(e =>
      (fs === "*" || (e.section || "") === fs) && (!fb || e.by === fb) && (!fa || e.action === fa) &&
      (!q || [FIELD_INFO[e.field]?.label, e.old, e.new].some(v => (v || "").toLowerCase().includes(q))));
  };
  const draw = () => {
    const list = filtered();
    $("#auditRows").innerHTML = list.length ? list.map(e => `
      <tr>
        <td style="white-space:nowrap">${fmtTime(e.at)}</td>
        <td>${esc(e.by || "—")}</td>
        <td><span class="badge ${ACTION_CLS[e.action] || ""}">${esc(ACTION_LABEL[e.action] || e.action)}</span></td>
        <td style="white-space:nowrap">${e.section ? esc(secName(e.section)) : (e.field ? "Form header" : "—")}</td>
        <td>${esc(FIELD_INFO[e.field]?.label || e.field || "")}</td>
        <td class="aud-old">${esc(auditValue(e.field, e.old))}</td>
        <td class="aud-new">${esc(auditValue(e.field, e.new))}</td>
      </tr>`).join("") : `<tr><td colspan="7" class="empty">No audit entries match.</td></tr>`;
  };
  draw();
  ["fSec", "fBy", "fAct"].forEach(i => $("#" + i).onchange = draw);
  $("#fTxt").oninput = draw;
  $("#auditPrint").onclick = () => printAs(`${doc.formNo || ""} Audit Trail`);
  $("#auditCsv").onclick = () => {
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const rows = [["Date & Time", "By", "Action", "Section", "Item", "Before", "After"]].concat(filtered().map(e => [
      fmtTime(e.at), e.by, ACTION_LABEL[e.action] || e.action, e.section ? secName(e.section) : (e.field ? "Form header" : ""),
      FIELD_INFO[e.field]?.label || e.field || "", auditValue(e.field, e.old), auditValue(e.field, e.new)]));
    download(new Blob(["\ufeff" + rows.map(r => r.map(q).join(",")).join("\r\n")], { type: "text/csv" }), `Audit_${doc.formNo}.csv`);
  };
}

/* =========================================================
   SETTINGS (Super Admin): choices for every dropdown / suggestion list
   ========================================================= */
// Settings home: one block per program
function renderSettings() {
  const sup = isSuper();
  const link = (href, title, text) => `<a class="set-link" href="${href}"><span><strong>${title}</strong><br>
    <span class="muted">${text}</span></span><span class="set-arrow">›</span></a>`;
  if (!sup) {                                   // Admin: only what an Admin may set up
    $("#app").innerHTML = `
      <div class="page-head"><div><h1>Settings</h1><div class="sub">Choose what you want to set up.</div></div></div>
      <div class="card set-prog">
        <div class="prog-title">🛡 Administration</div>
        ${link("#/settings/email", "📧 Email Alerts", "Who receives which alert, alert days, and the email templates")}
      </div>
      <div class="card set-prog">
        <div class="prog-title">🧩 Program Settings</div>
        <div class="set-dept">🏢 Purchase Dept</div>
        <div class="set-dept-body">
          ${link("#/settings/cta/locations", `🔎 ${CT_NAME} – Inspection Location Master List`, "Locations of inspection / warehouses with address and contact persons (Section B)")}
        </div>
        <div class="set-dept">👥 HR Dept</div>
        <div class="set-dept-body">
          ${link("#/settings/hr", "🪪 Staff Master Data – HR Setting", "Position list and BR / Outlet list (Outlet Code + Outlet Name) used for the staff")}
        </div>
        <div class="set-dept">📦 Warehouse Dept</div>
        <div class="set-dept-body">
          ${link("#/settings/wh", "🚚 Online Shop Delivery – Courier &amp; Channel Setting", "Courier companies (with the start of their tracking numbers) and channels offered on the Carrier Manifest")}
        </div>
      </div>`;
    return;
  }
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Settings</h1>
        <div class="sub">Choose what you want to set up.</div>
      </div>
    </div>
    <div class="card set-prog">
      <div class="prog-title">🛡 Administration</div>
      ${link("#/users", "👤 Users", "Add people, set their account type, email address and password")}
      ${link("#/access", "🔐 Access Control", "Which sections and programs each person can see, fill in and tick")}
      ${link("#/settings/email", "📧 Email Alerts", "Mail server, who receives which alert, alert days, and the email templates")}
    </div>
    <div class="card set-prog">
      <div class="prog-title">🧩 Program Settings</div>
      <div class="set-dept">🏢 Purchase Dept</div>
      <div class="set-dept-body">
        ${link("#/settings/coa/dropdown", "📋 COA Application – Setting for Drop Down",
          "Choices for Application Type, Purpose, Product Category, Product Class, Country, Ports and ST Status")}
        ${link("#/settings/cta/locations", `🔎 ${CT_NAME} – Inspection Location Master List`,
          "Locations of inspection / warehouses with address and contact persons (Section B)")}
      </div>
      <div class="set-dept">👥 HR Dept</div>
      <div class="set-dept-body">
        ${link("#/settings/hr", "🪪 Staff Master Data – HR Setting", "Position list and BR / Outlet list (Outlet Code + Outlet Name) used for the staff")}
      </div>
      <div class="set-dept">📦 Warehouse Dept</div>
      <div class="set-dept-body">
        ${link("#/settings/wh", "🚚 Online Shop Delivery – Courier &amp; Channel Setting", "Courier companies (with the start of their tracking numbers) and channels offered on the Carrier Manifest")}
      </div>
    </div>
    <div class="card set-prog">
      <div class="prog-title">🖥 Server Settings</div>
      ${link("#/settings/integration", "🔗 Integration", "Connections to other systems – AppSheet (Google Sheet sync)")}
      <form class="set-row srv-form" id="srvForm">
        <span><strong>⏱ Automatic sign-out</strong><br><span class="muted">Signed out after this many minutes without activity (0 = never).</span></span>
        <span class="srv-inputs"><label>Sign out after <input type="number" name="idleMinutes" min="0" max="720" style="width:70px" /> min</label>
          <button class="btn btn-sm btn-primary">Save</button></span>
      </form>
      <div class="set-row">
        <span><strong>🔄 Restart server</strong><br>
          <span class="muted" id="srvInfo">Use after copying an updated server.py / sections.json. Takes a few seconds – nobody is signed out.</span></span>
        <button class="btn btn-danger" id="restartBtn">Restart server</button>
      </div>
    </div>`;
  api("GET", "/api/server").then(i => {
    const f = $("#srvForm");
    f.idleMinutes.value = i.idleMinutes ?? 30;
    f.onsubmit = async e => {
      e.preventDefault();
      try { await api("PUT", "/api/server/settings", { idleMinutes: +f.idleMinutes.value }); me.idleMinutes = +f.idleMinutes.value; toast("Saved"); }
      catch (ex) { tell(ex.message); }
    };
    $("#srvInfo").innerHTML = `Running since ${fmtTime(i.startedAt)} · port ${i.port}.<br>` + (i.canRestart
      ? "Use after copying an updated server.py / sections.json. Takes a few seconds – nobody is signed out."
      : `<span style="color:var(--bad)">Not available yet: the server was started with an older start_server.bat.
         Close the black server window once and double-click <strong>start_server.bat</strong> – after that this button works.</span>`);
    $("#restartBtn").disabled = !i.canRestart;
  }).catch(() => {});
  $("#restartBtn").onclick = restartServer;
}

// Settings > Server Settings > Integration: list of connections to other systems
function renderIntegration() {
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/settings">Settings</a> › <span>Integration</span></div>
        <h1 style="margin-top:6px">Integration</h1>
        <div class="sub">Connections between this system and other systems.</div>
      </div>
    </div>
    <div class="card set-prog">
      <div class="prog-title">🔗 Integrations</div>
      <a class="set-link" href="#/settings/appsheet">
        <span><strong>📱 AppSheet – Google Sheet sync</strong><br>
          <span class="muted">Send a read-only copy of the data (and documents to Google Drive) to a Google Sheet, so an AppSheet app can show it on the phone</span>
          <br><span id="intAppsheet" class="muted" style="font-size:12px"></span></span>
        <span class="set-arrow">›</span>
      </a>
    </div>`;
  api("GET", "/api/appsheet").then(i => {
    const el = $("#intAppsheet");
    if (!el) return;
    const st = i.status;
    el.innerHTML = !i.url ? "⚪ Not set up" : !i.enabled ? "⚪ Set up – automatic sync is off"
      : st && !st.ok ? `🔴 Problem at the last sync (${fmtTime(st.at)})` : `🟢 On – every ${i.minutes} minutes${st ? ` · last sync ${fmtTime(st.at)}` : ""}`;
    if (i.url) el.innerHTML += i.access === "restricted" ? ` · 🔒 ${i.viewers.length} email(s) allowed` : " · 🌐 documents: anyone with the link";
  }).catch(() => {});
}

async function restartServer() {
  if (!await ask("Restart the server now?\n\nEveryone's page pauses for a few seconds. Nobody is signed out.")) return;
  await flushSave();
  const btn = $("#restartBtn");
  btn.disabled = true;
  btn.textContent = "Restarting…";
  const before = (await api("GET", "/api/server").catch(() => ({}))).startedAt;
  try { await api("POST", "/api/server/restart", {}); } catch (ex) { toast(ex.message); btn.disabled = false; btn.textContent = "Restart server"; return; }
  // wait until the server answers again with a new start time
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 750));
    try {
      const r = await fetch("/api/server", { credentials: "same-origin" });
      if (r.ok && (await r.json()).startedAt !== before) {
        toast("Server restarted");
        setTimeout(() => location.reload(), 600);
        return;
      }
    } catch {}
  }
  btn.textContent = "Restart server";
  btn.disabled = false;
  tell("The server has not come back yet.\n\nIt was probably started without start_server.bat – please start it again on the server PC by double-clicking start_server.bat.");
}

// Settings > COA Application > Setting for Drop Down
let ddType = "appType";
async function renderDropdownSettings() {
  const { options, locked } = await api("GET", "/api/options");
  OPTIONS = options;
  const types = [...OPTION_LISTS, { key: "ports", name: "Ports (Port of Loading / Port of Arrival)",
    where: "H. Import / Consignor – Port of Loading shows the ports of the Country of Shipment; Port of Arrival shows Malaysian ports" }];
  if (!types.some(t => t.key === ddType)) ddType = "appType";

  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/settings">Settings</a> › Program Settings › <span>COA Application – Setting for Drop Down</span></div>
        <h1 style="margin-top:6px">Setting for Drop Down</h1>
        <div class="sub">Select a type, then add, remove or reorder its choices. Changes are saved straight away.</div>
      </div>
    </div>
    <div class="card dd-card">
      <div class="dd-select">
        <label class="field"><span>Select Type</span>
          <select id="ddType">${types.map(t => `<option value="${t.key}" ${t.key === ddType ? "selected" : ""}>${esc(t.name)}</option>`).join("")}</select>
        </label>
        <div class="muted" id="ddWhere"></div>
      </div>
      <div id="ddBody"></div>
    </div>
    <p class="muted dd-note">🔒 = used by the system (e.g. "Renewal" shows Previous COA No., ST Statuses drive the Dashboard) – it can be moved but not removed.
      Removing a choice does not change applications that already use it.</p>`;

  const body = $("#ddBody");
  const typeOf = () => types.find(t => t.key === ddType);

  // ---- normal lists
  const drawList = () => {
    const t = typeOf(), items = OPTIONS[t.key] || [];
    body.innerHTML = `
      <div class="dd-title">${esc(t.name)} <span class="muted">(${items.length})</span></div>
      <div class="dd-items">${items.length ? items.map((v, i) => `
        <div class="opt-row">
          <span class="opt-val">${esc(v)}</span>
          <button class="icon-btn" data-mv="-1" data-i="${i}" title="Move up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="icon-btn" data-mv="1" data-i="${i}" title="Move down" ${i === items.length - 1 ? "disabled" : ""}>↓</button>
          ${(locked[t.key] || []).includes(v) ? `<span class="icon-btn" title="Used by the system">🔒</span>`
            : `<button class="icon-btn opt-del" data-del="${i}" title="Remove">✕</button>`}
        </div>`).join("") : `<div class="muted" style="padding:10px 0">No choices yet.</div>`}
      </div>
      <form class="dd-add" data-form="list">
        <input type="text" maxlength="100" placeholder="New ${esc(t.name)}…" />
        <button class="btn btn-primary">Add</button>
      </form>`;
  };
  const saveList = async items => {
    try { OPTIONS[ddType] = (await api("PUT", `/api/options/${ddType}`, { items })).items; toast("Saved"); }
    catch (ex) { toast(ex.message); }
    drawList();
  };

  // ---- ports (code, name, country)
  const countries = () => [...new Set([...(OPTIONS.country || []), ...(OPTIONS.ports || []).map(p => p.country)])].sort();
  const drawPortRows = () => {
    const q = ($("#portQ")?.value || "").toLowerCase().trim(), fc = $("#portC")?.value || "";
    const rows = (OPTIONS.ports || []).map((p, i) => ({ ...p, i }))
      .filter(p => (!fc || p.country === fc) && (!q || `${p.code} ${p.name} ${p.country}`.toLowerCase().includes(q)));
    $("#portRows").innerHTML = rows.length ? rows.map(p => `
      <tr style="cursor:default"><td><strong>${esc(p.code)}</strong></td><td>${esc(p.name)}</td><td>${esc(p.country)}</td>
        <td><button class="icon-btn opt-del" data-pdel="${p.i}" title="Remove">✕</button></td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">No ports found.</td></tr>`;
    $("#portCount").textContent = `(${(OPTIONS.ports || []).length})`;
  };
  const drawPorts = () => {
    const cs = countries();
    body.innerHTML = `
      <div class="dd-title">Ports <span class="muted" id="portCount"></span></div>
      <div class="toolbar">
        <input type="text" id="portQ" placeholder="🔍 Search code, port or country…" />
        <select id="portC"><option value="">All countries</option>${cs.map(c => `<option>${esc(c)}</option>`).join("")}</select>
      </div>
      <div class="table-wrap" style="max-height:440px;overflow-y:auto"><table>
        <thead><tr><th style="width:110px">Code</th><th>Port</th><th>Country</th><th style="width:40px"></th></tr></thead>
        <tbody id="portRows"></tbody>
      </table></div>
      <form class="dd-add" data-form="port">
        <input name="code" maxlength="10" placeholder="Code e.g. CNNGB" style="flex:0 0 150px;text-transform:uppercase" required />
        <input name="name" maxlength="100" placeholder="New port name" required />
        <select name="country" style="flex:0 0 170px" required>${cs.map(c => `<option>${esc(c)}</option>`).join("")}</select>
        <button class="btn btn-primary">Add</button>
      </form>`;
    drawPortRows();
    $("#portQ").oninput = drawPortRows;
    $("#portC").onchange = drawPortRows;
  };
  const savePorts = async items => {
    try { OPTIONS.ports = (await api("PUT", "/api/options/ports", { items })).items; toast("Saved"); }
    catch (ex) { toast(ex.message); }
    drawPortRows();
  };

  const draw = () => {
    $("#ddWhere").textContent = "Used in: " + typeOf().where;
    ddType === "ports" ? drawPorts() : drawList();
  };
  $("#ddType").onchange = e => { ddType = e.target.value; draw(); };
  draw();

  // one set of handlers for whatever type is shown
  body.onclick = async e => {
    const mv = e.target.closest("[data-mv]"), del = e.target.closest("[data-del]"), pdel = e.target.closest("[data-pdel]");
    if (mv || del) {
      const items = [...(OPTIONS[ddType] || [])];
      if (mv) {
        const i = +mv.dataset.i, j = i + +mv.dataset.mv;
        [items[i], items[j]] = [items[j], items[i]];
      } else {
        if (!await ask(`Remove "${items[+del.dataset.del]}" from ${typeOf().name}?`)) return;
        items.splice(+del.dataset.del, 1);
      }
      saveList(items);
    } else if (pdel) {
      const p = OPTIONS.ports[+pdel.dataset.pdel];
      if (!await ask(`Remove port ${p.code} – ${p.name}?`)) return;
      savePorts(OPTIONS.ports.filter((_, i) => i !== +pdel.dataset.pdel));
    }
  };
  body.onsubmit = e => {
    e.preventDefault();
    const f = e.target;
    if (f.dataset.form === "port") {
      const code = f.code.value.trim().toUpperCase(), name = f.name.value.trim();
      if ((OPTIONS.ports || []).some(p => p.code === code)) { toast(`Port code ${code} already exists`); return; }
      savePorts([...(OPTIONS.ports || []), { code, name, country: f.country.value }]);
      f.code.value = ""; f.name.value = "";
    } else {
      const input = f.querySelector("input"), v = input.value.trim();
      if (!v) return;
      if ((OPTIONS[ddType] || []).some(x => x.toLowerCase() === v.toLowerCase())) { toast(`"${v}" is already in the list`); return; }
      saveList([...(OPTIONS[ddType] || []), v]);
    }
  };
}

/* =========================================================
   SIRIM INSPECTION FORM
   #/sirim            dashboard        #/sirim/new   new form
   #/sirim/<id>       one form         #/sirim-audit audit trail
   ========================================================= */
const CT_NAME = "Consignment Test Application";
const CT_GROUPS = [
  { sec: "A", title: "Product Information", fields: [
    { key: "ctProductName", label: "Name of Product", hint: "Nama Kelengkapan", type: "text" },
    { key: "ctCategory", label: "Product Category", hint: "Jenis Kelengkapan", type: "text" },
    { key: "ctSubCategory", label: "Product Sub Category", type: "text" },
    { key: "ctModel", label: "Model No", type: "text" },
    { key: "ctBrand", label: "Brand", type: "text" },
    { key: "ctVoltage", label: "Voltage", type: "text", placeholder: "e.g. 220-240" },
    { key: "ctCurrent", label: "Current", type: "text" },
    { key: "ctFrequency", label: "Frequency", type: "text", placeholder: "e.g. 50-60" },
    { key: "ctPower", label: "Power", type: "text" },
    { key: "ctAdapter", label: "Adapter Model No.", type: "text" },
    { key: "ctK1", label: "K1 Form No.", type: "text", hint: "Upload the K1 under Documents" },
    { key: "ctQty", label: "Quantity", type: "number", unit: "Unit" },
    { key: "ctSerialRange", label: "Serial No.", type: "textarea", placeholder: "e.g. 2606XPB60-655S0001-2606XPB60-655S0870" },
  ] },
  { sub: true, title: "COA / COE Information", fields: [
    { key: "coaNo", label: "COA No.", type: "text", lookup: true },
    { key: "ctCoaExpiry", label: "COA Expiry Date", type: "date" },
    { key: "ctCoaApproval", label: "COA Approval Code", type: "text" },
    { key: "ctCoeNo", label: "COE No.", type: "text", eup: true },
    { key: "ctCoeExpiry", label: "COE Expiry Date", type: "date", eup: true },
    { key: "ctCoeApproval", label: "COE Approval Code", type: "text", eup: true },
  ] },
  { sub: true, title: "For Safety", fields: [
    { key: "ctSafStd", label: "Std Ref No.", type: "text" },
    { key: "ctSafReport", label: "Test Report No.", type: "text" },
    { key: "ctSafCert", label: "Test Cert No.", type: "text" },
    { key: "ctSafIdentical", label: "Identical Model", type: "text" },
  ] },
  { sub: true, title: "For Energy Efficiency", fields: [
    { key: "ctIsEup", label: "Is product an Energy-Using Product?", type: "select", options: YES_NO, hint: "No = energy efficiency and COE details are not needed" },
    { key: "ctEeStd", label: "Std Ref No.", type: "text", eup: true },
    { key: "ctEeReport", label: "Test Report No.", type: "text", eup: true },
    { key: "ctEeCert", label: "Test Cert No.", type: "text", eup: true },
    { key: "ctEeIdentical", label: "Identical Model", type: "text", eup: true },
    { key: "ctEeStar", label: "Star rating", type: "text", eup: true },
    { key: "ctEeYear", label: "Year of Rating", type: "text", eup: true },
    { key: "ctEeAec", label: "AEC (kWh/year)", type: "text", eup: true },
    { key: "ctEeSaving", label: "Energy saving percentage", type: "text", eup: true },
    { key: "ctEeTesting", label: "Testing Standard", type: "text", eup: true },
  ] },
  { sec: "B", title: "Inspection Information", fields: [
    { key: "ctLocName", label: "Select Location of Inspection / Warehouse Name", type: "location" },
    { label: "Location of Inspection", hint: "as selected from above", type: "lines", keys: ["ctLocAddr1", "ctLocAddr2", "ctLocAddr3"] },
    { label: "Contact Person", type: "pair", keys: ["ctContactA", "ctContactB"] },
    { label: "Telephone No.", type: "pair", keys: ["ctTelA", "ctTelB"] },
    { label: "Email Address", type: "pair", input: "email", keys: ["ctEmailA", "ctEmailB"] },
    { label: "H/P No.", type: "pair", keys: ["ctHpA", "ctHpB"] },
    { key: "estArrival", label: "Estimate Arrival Date", type: "date" },
    { label: "Requested date and time", type: "datetime", keys: ["estInspection", "ctReqTime"],
      note: "The actual inspection date will be confirmed after payment done." },
  ] },
];
// one entry per stored value (a row with a) / b) or 3 address lines stores several values)
const SIRIM_FIELDS = CT_GROUPS.flatMap(g => g.fields.flatMap(it => !it.keys ? [{ ...it, group: g.title }] : it.keys.map((k, i) => ({
  key: k, group: g.title,
  label: it.type === "pair" ? `${it.label} (${"ab"[i]})` : it.type === "lines" ? `${it.label} – line ${i + 1}` : i ? "Requested time" : "Requested date",
  type: it.type === "datetime" ? (i ? "time" : "date") : (it.input || "text") }))));
const SIRIM_DOCS = [
  { key: "invoice", label: "Invoice", hint: "Import invoice" },
  { key: "packingList", label: "Packing List", hint: "Import packing list" },
  { key: "bol", label: "Bill of Lading (BOL)", hint: "Import BOL / AWB" },
  { key: "k1Form", label: "Customs Form (K1)", hint: "K1 form document" },
  { key: "serialFile", label: "Serial Number", hint: "PDF, Excel (.xlsx) or CSV – serial numbers in Excel / CSV are listed automatically" },
];
const CT_ORDER = {};
SIRIM_FIELDS.forEach((f, i) => { CT_ORDER[f.key] = i; });
SIRIM_DOCS.forEach((d, i) => { CT_ORDER[d.key] = 100 + i; });
// labels for the audit trail / versions (group name added where the same label is used twice)
const CT_INFO = {};
SIRIM_FIELDS.forEach(f => {
  CT_INFO[f.key] = { label: /^(Std Ref No\.|Test Report No\.|Test Cert No\.|Identical Model)$/.test(f.label) ? `${f.label} (${f.group.replace("For ", "")})` : f.label, type: f.type };
});
CT_INFO.estInspection = { label: "Requested Inspection Date", type: "date" };
CT_INFO.ctLocName.label = "Location of Inspection / Warehouse";
SIRIM_DOCS.forEach(d => { CT_INFO[d.key] = { label: d.label, type: "file" }; });
CT_INFO.serialFile.label = "Serial Number file";
CT_INFO.serials = { label: "Serial numbers", type: "text" };
Object.entries(CT_INFO).forEach(([k, v]) => { if (!FIELD_INFO[k] || k.startsWith("ct") || k === "k1Form" || k === "estInspection") FIELD_INFO[k] = v; });
let sirimCur = null, sirimPending = {}, sirimTimer = null, sirimSaving = null;

// ---- Quantity must match the serial numbers
function serialRangeOne(s) {
  const re = /\s*(?:-|~|\u2013|\bTO\b)\s*/gi;
  let m;
  while ((m = re.exec(s))) {
    const a = s.slice(0, m.index).trim(), b = s.slice(m.index + m[0].length).trim();
    const ma = a.match(/^(.*?)(\d+)$/), mb = b.match(/^(.*?)(\d+)$/);
    if (ma && mb && (mb[1] === "" || mb[1] === ma[1]) && (mb[1] === "" || ma[2].length === mb[2].length)) {
      const n = +mb[2] - +ma[2] + 1;
      if (n >= 1) return n;
    }
  }
  return 1;
}
function serialRangeCount(text) {
  if (/SEE IMPORTED LIST/i.test(text || "")) return null;       // summary line written by the import
  const parts = String(text || "").split(/[\n,;]+/).map(x => x.trim()).filter(Boolean);
  return parts.length ? parts.reduce((t, x) => t + serialRangeOne(x), 0) : null;
}
// { ok, problems[], note } – same rules as the server uses on Submit
function qtyCheck(d) {
  const qty = String(d.ctQty || "").trim();
  const listed = new Set(d.serials || []).size || null, ranged = serialRangeCount(d.ctSerialRange);
  const problems = [];
  if (!qty && (listed || ranged)) problems.push(`Fill in Quantity (${listed || ranged} serial numbers).`);
  else if (qty) {
    if (!/^\d+$/.test(qty)) problems.push("Quantity must be a whole number.");
    else {
      if (listed !== null && listed !== +qty) problems.push(`Quantity is ${qty} but the uploaded serial number list has ${listed}.`);
      if (ranged !== null && ranged !== +qty) problems.push(`Quantity is ${qty} but the Serial No. range covers ${ranged}.`);
    }
  }
  const src = [listed !== null ? "uploaded list" : "", ranged !== null ? "Serial No. range" : ""].filter(Boolean).join(" and ");
  const note = problems.length ? "" : qty && src ? `Matches ${qty} serial numbers (${src})`
    : qty ? "Serial numbers not counted yet – type the Serial No. range or upload the Excel / CSV list" : "";
  return { ok: !problems.length && !!src, problems, note };
}
// imported serial list -> "P0001-P0870, P0901-P0950": runs of consecutive numbers with the same prefix
function serialsToRanges(list) {
  const uniq = [...new Set(list)], out = [];
  let run = null;
  const close = () => { if (run) out.push(run.first === run.last ? run.first : `${run.first}-${run.last}`); };
  for (const s of uniq) {
    const m = s.match(/^(.*?)(\d+)$/);
    if (run && m && m[1] === run.prefix && m[2].length === run.len && +m[2] === run.n + 1) {
      run.n++; run.last = s;
      continue;
    }
    close();
    run = m ? { prefix: m[1], len: m[2].length, n: +m[2], first: s, last: s } : { prefix: null, first: s, last: s };
  }
  close();
  return out;
}
// after an import: put the serial numbers into the Serial No. field
async function fillSerialRange() {
  const serials = sirimCur.data.serials || [];
  if (!serials.length) return;
  const ranges = serialsToRanges(serials);
  const text = ranges.length <= 30 ? ranges.join("\n")
    : `${serials.length} SERIAL NUMBERS – SEE IMPORTED LIST (${serials[0]} … ${serials[serials.length - 1]})`;
  const cur = (sirimCur.data.ctSerialRange || "").trim();
  if (cur === text) return;
  if (cur && !await ask(`Replace the Serial No. field with the imported serial numbers?\n\nNow: ${cur.slice(0, 200)}\nImported: ${text.slice(0, 200)}`)) return;
  ctSetValue("ctSerialRange", text);
  if ($("#sSavebar")) $("#sSavebar").textContent = "Saving…";
  clearTimeout(sirimTimer);
  sirimTimer = setTimeout(flushSirim, 300);
  drawQtyCheck();
  toast(`Imported ${new Set(serials).size} serial numbers`);
}
function drawQtyCheck() {
  const box = $("#ctQtyMsg");
  if (!box || !sirimCur) return;
  const r = qtyCheck(sirimCur.data);
  box.className = "ct-qty-msg " + (r.problems.length ? "bad" : r.ok ? "good" : "muted");
  box.innerHTML = r.problems.length ? r.problems.map(x => "⚠ " + esc(x)).join("<br>") : r.note ? (r.ok ? "✔ " : "") + esc(r.note) : "";
}

function sirimStatus(f) {
  if (f.cancelled) return { label: "Cancelled", cls: "cancelled" };
  if (f.perms.status === "submitted") return { label: "Submitted", cls: "submitted" };
  if (f.perms.count > 0) return { label: "Reopened", cls: "review" };
  return { label: "Draft", cls: "draft" };
}
const sirimKey = f => f.cancelled ? "Cancelled" : sirimStatus(f).label;

// ---------------- dashboard
async function renderSirimList() {
  const prevQ = $("#sq")?.value || "", prevS = $("#sStatus")?.value || "";
  const { forms, canCreate: canNew } = await api("GET", "/api/sirim");
  forms.sort((a, b) => formNum(b) - formNum(a));
  const soon = f => !f.cancelled && f.data.estInspection && daysUntil(f.data.estInspection) >= 0 && daysUntil(f.data.estInspection) <= 7;
  const count = fn => forms.filter(fn).length;
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <h1>${CT_NAME}</h1>
        <div class="sub">Consignment test (SIRIM inspection) forms for imported goods</div>
      </div>
      <div class="actions">${canNew ? `<a class="btn btn-primary" href="#/sirim/new">+ New Application</a>` : ""}</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${forms.length}</div><div class="l">Total</div></div>
      <div class="stat"><div class="n">${count(f => sirimKey(f) === "Draft" || sirimKey(f) === "Reopened")}</div><div class="l">Draft</div></div>
      <div class="stat"><div class="n">${count(f => sirimKey(f) === "Submitted")}</div><div class="l">Submitted</div></div>
      <div class="stat"><div class="n">${count(soon)}</div><div class="l">Requested inspection in next 7 days</div></div>
      <div class="stat"><div class="n">${count(f => f.cancelled)}</div><div class="l">Cancelled</div></div>
    </div>
    <div class="card">
      <div class="toolbar">
        <input type="text" id="sq" placeholder="Search form no., COA no., product, model, K1, serial number…" value="${esc(prevQ)}" />
        <select id="sStatus"><option value="">All statuses</option>${["Draft", "Reopened", "Submitted", "Cancelled"].map(s => `<option ${s === prevS ? "selected" : ""}>${s}</option>`).join("")}</select>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Form No.</th><th>COA No.</th><th>Product / Model</th><th>Qty</th><th>Est. Arrival</th><th>Requested Insp.</th><th>Documents</th><th>Serial Nos.</th><th>Status</th><th>Last Updated</th></tr></thead>
        <tbody id="srows"></tbody>
      </table></div>
    </div>`;
  const draw = () => {
    const q = $("#sq").value.toLowerCase().trim(), fs = $("#sStatus").value;
    const list = forms.filter(f => (!fs || sirimKey(f) === fs) &&
      (!q || [f.formNo, f.data.coaNo, f.data.ctProductName, f.data.ctModel, f.data.ctBrand, f.data.ctK1, f.data.ctSerialRange].some(v => (v || "").toLowerCase().includes(q))
        || (f.data.serials || []).some(x => x.toLowerCase().includes(q))));
    $("#srows").innerHTML = list.length ? list.map(f => {
      const docList = SIRIM_DOCS.filter(d => d.key !== "serialFile");
      const st = sirimStatus(f), docs = docList.filter(d => (f.files[d.key] || []).length).length;
      const insp = f.data.estInspection ? fmtDate(f.data.estInspection) + (soon(f) ? ` <span class="badge expiring">in ${daysUntil(f.data.estInspection)}d</span>` : "") : "—";
      return `<tr data-sid="${f.id}">
        <td><strong>${esc(f.formNo)}</strong></td><td>${esc(f.data.coaNo || "—")}</td>
        <td>${esc(f.data.ctProductName || "—")}${f.data.ctModel ? `<div class="muted" style="font-size:12px">${esc(f.data.ctModel)}</div>` : ""}</td>
        <td>${esc(f.data.ctQty || "—")}${qtyCheck(f.data).problems.length ? ` <span class="badge expired" title="${esc(qtyCheck(f.data).problems.join(" "))}">≠ serials</span>` : ""}</td>
        <td>${f.data.estArrival ? fmtDate(f.data.estArrival) : "—"}</td><td>${insp}</td>
        <td>${docs}/${docList.length}</td><td>${(f.data.serials || []).length}</td>
        <td><span class="badge ${st.cls}">${st.label}</span></td>
        <td class="muted" style="font-size:12px">${esc(f.updatedBy || "")}<br>${fmtTime(f.updatedAt)}</td></tr>`;
    }).join("") : `<tr><td colspan="10" class="empty">${forms.length ? "No matching forms." : "No applications yet." + (canNew ? " Click <strong>+ New Application</strong> to start." : "")}</td></tr>`;
  };
  draw();
  $("#sq").oninput = draw;
  $("#sStatus").onchange = draw;
  $("#srows").onclick = e => { const tr = e.target.closest("tr[data-sid]"); if (tr) location.hash = "#/sirim/" + tr.dataset.sid; };
}

async function createSirim() {
  try {
    const { form } = await api("POST", "/api/sirim", {});
    toast("Created " + form.formNo);
    location.replace("#/sirim/" + form.id);
  } catch (ex) { toast(ex.message); location.replace("#/sirim"); }
}

// ---------------- one form
async function renderSirimForm(id) {
  try {
    sirimCur = (await api("GET", `/api/sirim/${id}`)).form;
    OPTIONS = (await api("GET", "/api/options")).options;      // latest Inspection Location Master List
  }
  catch (ex) { toast(ex.status === 404 ? "Form not found" : ex.message); location.replace("#/sirim"); return; }
  sirimPending = {};
  drawSirimForm();
}

function drawSirimForm() {
  const f = sirimCur, p = f.perms, st = sirimStatus(f);
  if (!f._base) f._base = Object.fromEntries(SIRIM_FIELDS.map(x => [x.key, f.data[x.key] ?? ""]));
  let n = 0;
  const dis = p.edit ? "" : "disabled";
  const fieldInput = it => {
    const v = esc(f.data[it.key] || ""), up = ["date", "number", "time", "email"].includes(it.type) ? "" : "ct-upper";
    if (it.type === "select") return `<select data-skey="${it.key}" ${dis}><option value="">— Select —</option>
        ${it.options.map(o => `<option ${o === f.data[it.key] ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    if (it.type === "location") {
      const locs = OPTIONS.inspLocations || [], cur = f.data[it.key] || "";
      return `<select data-skey="${it.key}" ${dis}><option value="">— Select location —</option>
          ${locs.map(l => `<option ${l.name === cur ? "selected" : ""}>${esc(l.name)}</option>`).join("")}
          ${cur && !locs.some(l => l.name === cur) ? `<option selected>${esc(cur)}</option>` : ""}</select>
        <div class="ct-note no-print">Please select Location of Inspection from the list above.
          ${canManageLocations() ? `Add new location / edit / delete: <a href="#/settings/cta/locations">Inspection Location Master List</a>` : "Ask an Admin to add a new location to the Inspection Location Master List."}</div>`;
    }
    if (it.type === "lines") return `<div class="ct-lines">${it.keys.map(k => fieldInput({ key: k, type: "text" })).join("")}</div>`;
    if (it.type === "pair") return `<div class="ct-pair">${it.keys.map((k, i) =>
      `<div class="ct-ab"><span>${"ab"[i]})</span>${fieldInput({ key: k, type: it.input || "text" })}</div>`).join("")}</div>`;
    if (it.type === "datetime") return `<div class="ct-dt">${fieldInput({ key: it.keys[0], type: "date" })}${fieldInput({ key: it.keys[1], type: "time" })}</div>
        ${it.note ? `<div class="ct-note">${esc(it.note)}</div>` : ""}
        ${p.edit ? `<div class="no-print" style="margin-top:10px"><button type="button" class="btn btn-sm" id="ctLocReset">↺ Back to saved location / Clear</button></div>` : ""}`;
    if (it.type === "textarea") return `<textarea rows="2" class="${up}" data-skey="${it.key}" placeholder="${esc(it.placeholder || "")}" ${dis}>${v}</textarea>`
      + (it.key === "ctSerialRange" ? `<div class="ct-import no-print">
          <label class="btn btn-sm upload-btn"><span>📥 Import Serial Numbers</span><input type="file" accept=".xlsx,.csv,.txt,.pdf" multiple data-supload="serialFile" ${dis} /></label>
          <span class="muted">Excel (.xlsx) or CSV – the serial numbers are read and filled in above.</span></div>
        <div class="files" data-sfiles="serialFile"><div class="file-list"></div></div>
        <div class="serial-panel" id="serialPanel"></div>` : "");
    const inp = `<input type="${it.type}" class="${up}" data-skey="${it.key}" value="${v}" placeholder="${esc(it.placeholder || "")}" ${it.type === "number" ? 'min="0" step="1"' : ""} ${dis} />`;
    if (it.unit) return `<div class="ct-unit">${inp}<span>${esc(it.unit)}</span></div>${it.key === "ctQty" ? `<div id="ctQtyMsg"></div>` : ""}`;
    if (it.lookup) return `<div class="ct-lookup">
        <div class="combo" id="ctCoaCombo" style="flex:1 1 240px">
          <input type="text" class="${up}" data-skey="${it.key}" value="${v}" autocomplete="off" placeholder="🔍 Type or search COA No., product or model…" ${dis} />
          <div class="combo-list" hidden></div>
        </div>
        ${p.edit ? `<button type="button" class="btn btn-sm no-print" id="ctFill" title="Copy product, COA/COE and safety details from the COA Application with this COA No.">⇩ Fill from COA</button>` : ""}</div>
      ${p.edit ? `<div class="combo-hint muted no-print" id="ctCoaHint">Type the COA No., or choose one from the submitted COA Applications.</div>` : ""}`;
    return inp;
  };
  const fieldRow = it => `
    <div class="row nocheck" ${it.eup ? "data-eup" : ""}><div class="no">${++n}</div><div class="label">${esc(it.label)}${it.hint ? `<span class="hint">${esc(it.hint)}</span>` : ""}</div>
      <div class="input-cell">${fieldInput(it)}</div></div>`;
  const groupHead = g => g.sub ? `<div class="ct-group ct-sub">${esc(g.title)}</div>` : `<div class="ct-group">${g.sec ? g.sec + ". " : ""}${esc(g.title)}</div>`;
  const docRow = d => `
    <div class="row nocheck"><div class="no">${++n}</div><div class="label">${esc(d.label)}<span class="hint">${esc(d.hint)}</span></div>
      <div class="input-cell"><div class="files" data-sfiles="${d.key}"><div class="file-list"></div>
        <label class="btn btn-sm upload-btn"><span>📎 Upload</span><input type="file" multiple data-supload="${d.key}" ${p.edit ? "" : "disabled"} /></label>
      </div></div></div>`;
  $("#app").innerHTML = `
    <div class="page-head no-print">
      <div>
        <a href="#/sirim" style="text-decoration:none;font-weight:600">← Back to Consignment Test Dashboard</a>
        <h1 style="margin-top:6px">${esc(f.formNo)} <span class="badge ${st.cls}" style="vertical-align:middle">${st.label}</span></h1>
        <div class="savebar">Created by ${esc(f.createdBy || "—")} · Last updated by ${esc(f.updatedBy || "—")}, ${fmtTime(f.updatedAt)} · <span id="sSavebar">All changes saved</span></div>
      </div>
      <div class="actions">
        ${canAudit() ? `<a class="btn" href="#/sirim-audit/${f.id}">Audit Trail</a><a class="btn" href="#/versions/sirim/${f.id}">Versions</a>` : ""}
        <button class="btn" id="sPrint">Print / PDF</button>
        ${f.canCancel ? `<button class="btn btn-danger" id="sCancel">Cancel Form</button>` : ""}
        ${f.canDelete ? `<button class="btn btn-danger" id="sDelete" title="Super Admin: delete a Draft made by mistake">🗑 Delete</button>` : ""}
      </div>
    </div>
    ${f.cancelled ? `<div class="cancel-banner"><strong>CANCELLED</strong> – cancelled by ${esc(f.cancelledBy)} on ${fmtTime(f.cancelledAt)}.
      <div>Reason: ${esc(f.cancelReason)}</div></div>` : ""}
    ${p.viewOnly ? `<div class="banner readonly-note no-print">You have view-only access to Consignment Test forms.</div>` : ""}
    <table class="print-frame">
      <thead class="print-only"><tr><td><img class="letterhead" src="letterhead.png" alt="Company Name Sdn. Bhd." /></td></tr></thead>
      <tbody><tr><td>
        <section class="card ${p.edit ? "" : "no-edit"}" id="sirimCard">
          <div class="form-title"><div class="t1">CONSIGNMENT TEST APPLICATION</div><div class="t2">Form No. ${esc(f.formNo)}</div></div>
          <div class="card-body">
            ${CT_GROUPS.map(g => groupHead(g) + g.fields.map(fieldRow).join("")).join("")}
            ${groupHead({ sec: "C", title: "Documents" })}
            ${SIRIM_DOCS.filter(d => d.key !== "serialFile").map(docRow).join("")}
            <div class="sec-bar no-print" id="sSecBar"></div>
          </div>
        </section>
        <div class="submit-all no-print" id="sSubmitBar"></div>
      </td></tr></tbody>
    </table>`;
  SIRIM_DOCS.forEach(d => drawSirimFiles(d.key));
  drawSerials();
  drawSirimBars();
  applyEup();
  loadCoaPick();
  bindSirim();
}

// "Is product an Energy-Using Product?" = No: the energy efficiency / COE rows are not needed (same as the COA form)
function applyEup() {
  const no = sirimCur.data.ctIsEup === "No", edit = sirimCur.perms.edit;
  document.querySelectorAll("#sirimCard [data-eup]").forEach(row => {
    row.classList.toggle("disabled", no);
    row.querySelectorAll("[data-skey]").forEach(el => { el.disabled = no || !edit; });
  });
}

function drawSirimFiles(key) {
  const box = document.querySelector(`[data-sfiles="${key}"] .file-list`);
  if (!box) return;
  const files = sirimCur.files[key] || [];
  if (key === "serialFile") box.parentElement.style.display = files.length ? "" : "none";   // under Serial No.: only when something is imported
  box.innerHTML = files.length ? files.map(f => {
    const b = fileButtons(f, "/api/sirim/files/");
    return `<span class="file-chip">${b.name}<span class="fbtns">${b.btns}
      <button type="button" class="frm" data-srm="${f.id}" title="Remove">× Remove</button></span></span>`;
  }).join("") : `<span class="muted no-files">No document uploaded</span>`;
}

let serialOpen = false;                   // the full serial number list is hidden until "Show serial numbers"

// copy text to the clipboard (also works when the site is opened by http://<server-ip>, where the Clipboard API is not allowed)
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall back below */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
  document.body.append(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}

function drawSerials() {
  drawQtyCheck();
  const box = $("#serialPanel");
  if (!box) return;
  const serials = sirimCur.data.serials || [], problems = sirimCur.data.serialProblems || [], docs = sirimCur.data.serialDocs || [];
  const seen = {};
  serials.forEach(x => { seen[x] = (seen[x] || 0) + 1; });
  const dups = Object.keys(seen).filter(k => seen[k] > 1);
  if (!serials.length && !problems.length) {
    box.innerHTML = docs.length ? `<div class="serial-note">📄 The serial numbers are in ${docs.map(esc).join(", ")} – open it with <strong>View</strong>.
      <span class="muted">To get a searchable list with duplicate check, also upload the Excel (.xlsx) or CSV version.</span></div>` : "";
    return;
  }
  box.innerHTML = `
    <div class="serial-head">
      <strong>${serials.length} serial number${serials.length === 1 ? "" : "s"}</strong>
      ${dups.length ? `<span class="badge expired">${dups.length} duplicate${dups.length > 1 ? "s" : ""}</span>` : `<span class="badge approved">no duplicates</span>`}
      ${serials.length ? `<span class="serial-btns no-print">
        <button type="button" class="btn btn-sm" id="serialToggle">${serialOpen ? "🙈 Hide serial numbers" : "👁 Show serial numbers"}</button>
        <button type="button" class="btn btn-sm" id="serialCopy" title="Copy every serial number on one line, joined with - (e.g. A0001-A0002-A0003)">📋 Copy all</button>
      </span>` : ""}
    </div>
    ${problems.length ? `<div class="alert bad">Could not read: ${problems.map(esc).join(", ")} – please save it as .xlsx or .csv and upload again.</div>` : ""}
    <div class="serial-body no-print" id="serialBody" ${serialOpen ? "" : "hidden"}>
      <input type="text" id="serialQ" placeholder="🔍 Search serial number…" />
      <div class="serial-grid" id="serialGrid"></div>
    </div>`;
  if ($("#serialToggle")) $("#serialToggle").onclick = () => {
    serialOpen = !serialOpen;
    $("#serialBody").hidden = !serialOpen;
    $("#serialToggle").textContent = serialOpen ? "🙈 Hide serial numbers" : "👁 Show serial numbers";
  };
  if ($("#serialCopy")) $("#serialCopy").onclick = async () => {
    const ok = await copyText(serials.join("-"));        // one line, joined with "-" (as the SIRIM portal expects)
    toast(ok ? `Copied ${serials.length} serial numbers` : "Could not copy – please use Show serial numbers and select them");
  };
  const draw = () => {
    const q = ($("#serialQ")?.value || "").toLowerCase().trim();
    const list = serials.map((x, i) => ({ x, i })).filter(o => !q || o.x.toLowerCase().includes(q));
    const shown = list.slice(0, 1000);
    $("#serialGrid").innerHTML = shown.map(o => `<span class="serial ${seen[o.x] > 1 ? "dup" : ""}" title="#${o.i + 1}${seen[o.x] > 1 ? " – duplicate" : ""}">${esc(o.x)}</span>`).join("")
      + (list.length > shown.length ? `<div class="muted" style="grid-column:1/-1;font-size:12px">Showing first 1000 of ${list.length} – use the search box.</div>` : "")
      + (!list.length ? `<div class="muted" style="grid-column:1/-1;font-size:12px">No serial number matches.</div>` : "");
  };
  draw();
  $("#serialQ").oninput = draw;
}

function drawSirimBars() {
  const f = sirimCur, p = f.perms;
  const parts = [];
  if (p.status === "submitted") parts.push(`<span>Last submitted by <strong>${esc(p.by)}</strong>, ${fmtTime(p.at)}</span>`);
  else if (p.count > 0) parts.push(`<span>Reopened for changes – last submitted by <strong>${esc(p.by)}</strong>, ${fmtTime(p.at)}</span>`);
  else parts.push(`<span class="muted">Not submitted by anyone yet</span>`);
  if (!p.viewOnly && me.role !== "viewer") {
    if (p.myStatus === "submitted") parts.push(`<span>🔒 <strong>You</strong> have submitted this form</span>`);
    else if (p.submit) parts.push(`<span><strong>You</strong> have not submitted this form yet</span>`);
  }
  if (me.role === "user" && !p.viewOnly) parts.push(`<span class="muted">You Save – an Admin submits this form</span>`);
  const btns = [];
  if (p.resubmit) btns.push(`<button class="btn btn-sm" data-sact="resubmit">Unlock to resave (${p.resubmitsLeft} left)</button>`);
  if (p.reopen) btns.push(`<button class="btn btn-sm" data-sact="reopen">Reopen form</button>`);
  if (me.role === "user" && !p.viewOnly && p.status === "submitted") btns.push(`<span class="muted" style="font-size:12px">Locked – ask an Admin to reopen</span>`);
  $("#sSecBar").innerHTML = `<div class="sec-info">${parts.join("")}</div><div class="sec-btns">${btns.join("")}</div>`;
  const bar = $("#sSubmitBar");
  const saveBtn = p.edit && !f.cancelled ? `<button class="btn" data-ssave title="Save your changes and keep working (the form is not submitted)">💾 Save</button>` : "";
  if (p.submit) {
    bar.hidden = false;
    bar.innerHTML = `<div><strong>Ready to submit?</strong><div class="muted" style="font-size:12px;margin-top:2px">Submitting locks the form${me.role === "user" ? " for you" : ""}.</div>
        <div class="muted" style="font-size:12px">Not finished yet? Press <strong>Save</strong> and continue later.</div></div>
      <div class="submit-btns">${saveBtn}<button class="btn btn-primary" data-sact="submit">Submit</button></div>`;
  } else if (p.myStatus === "submitted" && !f.cancelled) {
    bar.hidden = false;
    bar.innerHTML = `<div class="muted">✔ You have submitted this form.</div>${saveBtn ? `<div class="submit-btns">${saveBtn}</div>` : ""}`;
  } else if (saveBtn) {
    bar.hidden = false;
    bar.innerHTML = `<div class="muted">${me.role === "user" ? "Press <strong>Save</strong> when you finish – an Admin will submit this form." : "Changes are saved automatically – press Save to save now."}</div><div class="submit-btns">${saveBtn}</div>`;
  } else { bar.hidden = true; bar.innerHTML = ""; }
}

function bindSirim() {
  const root = $("#app");
  root.oninput = e => {
    const t = e.target;
    if (!t.dataset.skey) return;
    if (t.classList.contains("ct-upper") && t.value !== t.value.toUpperCase()) {
      const a = t.selectionStart, b = t.selectionEnd;
      t.value = t.value.toUpperCase();
      try { t.setSelectionRange(a, b); } catch { /* not a text box */ }
    }
    sirimCur.data[t.dataset.skey] = t.value;
    sirimPending[t.dataset.skey] = t.value;
    if (t.dataset.skey === "ctQty" || t.dataset.skey === "ctSerialRange") drawQtyCheck();
    if (t.dataset.skey === "ctIsEup") applyEup();
    $("#sSavebar").textContent = "Saving…";
    clearTimeout(sirimTimer);
    sirimTimer = setTimeout(flushSirim, 600);
  };
  root.onchange = async e => {
    const t = e.target;
    if (t.dataset.skey === "ctLocName") {
      const loc = (OPTIONS.inspLocations || []).find(l => l.name === t.value);
      if (loc || !t.value) ctSetLocation(loc || {});
      return;
    }
    if (!t.dataset.supload) return;
    const key = t.dataset.supload, files = [...t.files];
    t.value = "";
    await flushSirim();
    const label = t.previousElementSibling, old = label.textContent;
    for (const [i, file] of files.entries()) {
      label.textContent = `Uploading ${i + 1}/${files.length}…`;
      try {
        const { form } = await api("POST", `/api/sirim/${sirimCur.id}/files?field=${encodeURIComponent(key)}&name=${encodeURIComponent(file.name)}`, file);
        Object.assign(sirimCur, { files: form.files, updatedAt: form.updatedAt, updatedBy: form.updatedBy });
        Object.assign(sirimCur.data, { serials: form.data.serials, serialProblems: form.data.serialProblems, serialDocs: form.data.serialDocs });
      } catch (ex) { toast(`Upload failed (${file.name}): ${ex.message}`); }
    }
    label.textContent = old;
    drawSirimFiles(key);
    if (key === "serialFile") {
      drawSerials();
      fillSerialRange();
    }
  };
  root.onclick = async e => {
    const rm = e.target.closest("[data-srm]"), act = e.target.closest("[data-sact]");
    if (e.target.closest("[data-ssave]")) {
      await flushSirim();
      if ($("#sSavebar")) $("#sSavebar").textContent = "All changes saved";
      const r = await api("POST", `/api/sirim/${sirimCur.id}/saved`, {}).catch(() => ({}));
      toast(`${sirimCur.formNo} saved${r.notified ? " – Admins are notified by email" : ""}`);
      return;
    }
    if (e.target.closest("#ctLocReset")) {
      const name = sirimCur.data.ctLocName || "", loc = (OPTIONS.inspLocations || []).find(l => l.name === name);
      if (loc ? !await ask(`Load the saved details of ${name} again?\n\nThe address and contact persons below are replaced.`)
              : !await ask("Clear the location, address and contact persons?")) return;
      if (!loc) ctSetValue("ctLocName", "");
      ctSetLocation(loc || {});
      return;
    }
    if (e.target.closest("#ctFill")) { ctFillFromCoa(); return; }
    if (rm) {
      if (!await ask("Remove this file?")) return;
      try {
        const { form } = await api("DELETE", `/api/sirim/files/${rm.dataset.srm}`);
        sirimCur.files = form.files;
        Object.assign(sirimCur.data, { serials: form.data.serials, serialProblems: form.data.serialProblems, serialDocs: form.data.serialDocs });
        SIRIM_DOCS.forEach(d => drawSirimFiles(d.key));
        drawSerials();
      } catch (ex) { toast(ex.message); }
    } else if (act) {
      const a = act.dataset.sact;
      if (a === "submit") {
        const q = qtyCheck(sirimCur.data);
        if (q.problems.length) {
          tell("Quantity must match the serial numbers before submitting:\n\n" + q.problems.join("\n"));
          document.querySelector('[data-skey="ctQty"]')?.focus();
          return;
        }
      }
      const msg = { submit: "Submit this Consignment Test form?" + (me.role === "user" ? "\n\nIt will be locked for you after submitting." : ""),
        resubmit: "Unlock this form to make changes? This uses 1 of your resaves.",
        reopen: "Reopen this form? Everyone who submitted it can edit it again." }[a];
      if (!await ask(msg)) return;
      await flushSirim();
      try {
        sirimCur = (await api("POST", `/api/sirim/${sirimCur.id}/${a}`, {})).form;
        if (a === "submit") {                 // back to the Consignment Test dashboard
          toast(`${sirimCur.formNo} submitted`);
          location.hash = "#/sirim";
          return;
        }
        drawSirimForm();
        toast({ submit: "Form submitted", resubmit: "Form unlocked – press Save when done", reopen: "Form reopened" }[a]);
      } catch (ex) { toast(ex.message); }
    }
  };
  $("#sPrint").onclick = () => printAs(sirimCur.formNo);
  if ($("#sDelete")) $("#sDelete").onclick = () => openDialog(`
      <h3>🗑 Delete ${esc(sirimCur.formNo)} completely?</h3>
      <p style="margin:0">For a Draft made by mistake: the form, its uploaded files and its history are removed for good – this cannot be undone.
        Only a Draft that was never submitted can be deleted.</p>
      <label class="field"><span>Type <strong>${esc(sirimCur.formNo)}</strong> to confirm</span><input type="text" name="confirm" required autocomplete="off" /></label>`,
    async form => {
      await flushSirim();
      const no = sirimCur.formNo;
      await api("POST", `/api/sirim/${sirimCur.id}/delete`, { confirm: form.confirm.value });
      sirimCur = null;
      $("#dialog").close();
      toast(`${no} deleted`);
      location.hash = "#/sirim";
    }, "Delete for good");
  if ($("#sCancel")) $("#sCancel").onclick = () => openDialog(`
      <h3>Cancel ${esc(sirimCur.formNo)}?</h3>
      <p class="muted" style="margin:0">The form is not deleted. It stays in the system for record, marked as Cancelled, and nobody can change it any more.</p>
      <label class="field"><span>Reason for cancelling</span><textarea name="reason" rows="3" required maxlength="500"></textarea></label>`,
    async form => {
      await flushSirim();
      sirimCur = (await api("POST", `/api/sirim/${sirimCur.id}/cancel`, { reason: form.reason.value })).form;
      drawSirimForm();
      toast(`${sirimCur.formNo} cancelled`);
    }, "Cancel Form");
}

// copy the details of the COA Application with this COA No. into the empty fields
async function ctFillFromCoa() {
  const coaNo = (sirimCur.data.coaNo || "").trim();
  if (!coaNo) { toast("Type or select the COA No. first"); return; }
  let res;
  try { res = await api("GET", `/api/sirim/coa-lookup?coaNo=${encodeURIComponent(coaNo)}`); }
  catch (ex) { toast(ex.message); return; }
  const empty = Object.entries(res.data).filter(([k]) => !(sirimCur.data[k] || "").trim());
  const filled = Object.keys(res.data).length - empty.length;
  if (!empty.length) { toast(filled ? "All these fields already have a value – nothing to fill" : `${res.formNo} has no details to copy`); return; }
  if (!await ask(`Copy ${empty.length} detail${empty.length > 1 ? "s" : ""} from COA Application ${res.formNo}?` +
    (filled ? `\n\nFields that already have a value are kept (${filled}).` : ""))) return;
  for (const [k, v] of empty) ctSetValue(k, v);
  await flushSirim();
  applyEup();
  drawQtyCheck();
  toast(`Filled ${empty.length} field${empty.length > 1 ? "s" : ""} from ${res.formNo}`);
}

// COA No.: searchable list of the submitted COA Applications (works like Port of Arrival)
async function loadCoaPick() {
  const combo = $("#ctCoaCombo");
  if (!combo || !sirimCur.perms.edit) return;
  const input = combo.querySelector("input"), box = combo.querySelector(".combo-list");
  let items = [];
  try { items = (await api("GET", "/api/sirim/coa-list")).items; } catch { return; }
  if (!document.body.contains(combo)) return;
  if ($("#ctCoaHint")) $("#ctCoaHint").textContent = items.length
    ? `Type the COA No., or choose one of the ${items.length} submitted COA Application${items.length > 1 ? "s" : ""}.`
    : "No submitted COA Application yet – type the COA No.";
  const show = () => {
    if (input.disabled || !items.length) return;
    const q = input.value.toLowerCase().trim();
    const hits = items.filter(i => !q || [i.coaNo, i.product, i.model, i.formNo].some(x => (x || "").toLowerCase().includes(q)));
    box.innerHTML = hits.length ? hits.map(i => `<div class="combo-opt ct-coa-opt" data-ctcoa="${esc(i.coaNo)}">
        <strong>${esc(i.coaNo)}</strong><span>${esc([i.product, i.model].filter(Boolean).join(" · ") || i.formNo)}</span>
        <span class="muted">${i.expiry ? "exp. " + fmtDate(i.expiry) : esc(i.formNo)}</span></div>`).join("")
      : `<div class="combo-empty muted">No submitted COA matches. You can keep what you typed.</div>`;
    box.hidden = false;
  };
  input.addEventListener("focus", show);
  input.addEventListener("input", show);
  input.addEventListener("blur", () => setTimeout(() => { box.hidden = true; }, 150));
  box.addEventListener("mousedown", async e => {
    const opt = e.target.closest("[data-ctcoa]");
    if (!opt) return;
    e.preventDefault();
    ctSetValue("coaNo", opt.dataset.ctcoa);
    input.blur();
    box.hidden = true;
    await flushSirim();
    box.hidden = true;
    ctFillFromCoa();
  });
}

function ctSetValue(k, v) {
  sirimCur.data[k] = v;
  sirimPending[k] = v;
  const el = document.querySelector(`[data-skey="${k}"]`);
  if (el) el.value = v;
}
// copy one master list location into Section B (an empty object clears it)
function ctSetLocation(loc) {
  for (const [from, to] of Object.entries(LOC_MAP)) ctSetValue(to, loc[from] || "");
  if ($("#sSavebar")) $("#sSavebar").textContent = "Saving…";
  clearTimeout(sirimTimer);
  sirimTimer = setTimeout(flushSirim, 300);
}

async function flushSirim() {
  clearTimeout(sirimTimer);
  sirimTimer = null;
  if (sirimSaving) await sirimSaving;
  if (!sirimCur || !Object.keys(sirimPending).length) return;
  const rec = sirimCur, sent = sirimPending;
  sirimPending = {};
  sirimSaving = (async () => {
    try {
      const { form, conflicts } = await api("PUT", `/api/sirim/${rec.id}`, { data: sent, base: { data: pickBase(rec._base, sent) } });
      Object.assign(rec, { updatedAt: form.updatedAt, updatedBy: form.updatedBy, perms: form.perms });
      if (rec._base) mergeSirimSave(rec, form, sent, conflicts);
      if (rec === sirimCur && $("#sSavebar")) $("#sSavebar").textContent = "All changes saved";
    } catch (ex) {
      if (ex.status === 403 || ex.status === 400) { tell("Could not save: " + ex.message); if (rec === sirimCur) renderSirimForm(rec.id); }
      else if (ex.status !== 401) {
        sirimPending = { ...sent, ...sirimPending };
        if ($("#sSavebar")) $("#sSavebar").textContent = "Save failed – retrying…";
        sirimTimer = setTimeout(flushSirim, 4000);
      }
    }
  })();
  await sirimSaving;
  sirimSaving = null;
}

// ---------------- Settings > Email Alerts
async function renderEmailSettings() {
  let info;
  try { info = await api("GET", "/api/email-settings"); } catch (ex) { toast(ex.message); return; }
  const statusHtml = st => !st ? `<span class="muted">No check yet.</span>`
    : `<span class="badge ${st.ok ? "approved" : "expired"}">${st.ok ? "OK" : "Problem"}</span> ${fmtTime(st.at)} – ${esc(st.message)}`;
  const withMail = info.recipients.filter(r => r.email), without = info.recipients.filter(r => !r.email);
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/settings">Settings</a> › <span>Email Alerts</span></div>
        <h1 style="margin-top:6px">Email Alerts <a class="btn btn-sm" href="#/settings/email-templates" style="margin-left:8px;vertical-align:middle">✏ Edit email templates</a></h1>
        <div class="sub">The system checks every 30 minutes. Tick for each person which alerts they receive.
          Super Admin and Admins get alerts about all forms; a User only about the forms they created or worked on.</div>
      </div>
    </div>
    <div class="card as-card">
      <h3>Status</h3>
      <div id="emStatus">${statusHtml(info.status)}</div>
      <div style="margin-top:12px"><button class="btn btn-primary" id="emRun" ${info.ready ? "" : "disabled"}>✉ Check &amp; send now</button></div>
      ${info.ready ? "" : `<div class="muted" style="font-size:12px;margin-top:6px">⚠ The mail server is not set up yet${info.canServer ? " – fill in “Mail server” below" : " – ask the Super Admin"}.</div>`}
    </div>
    <form class="card as-card" id="emForm">
      <h3>When to send</h3>
      <label class="check-line"><input type="checkbox" name="enabled" ${info.enabled ? "checked" : ""} /> Turn on email alerts
        <span class="muted" style="font-weight:400">(main switch)</span></label>
      <div class="em-rules">
        <label class="em-rule"><span>🕑 <strong>Unsettled job</strong> – a COA Application / Consignment Test form still in <strong>Draft</strong> (not submitted) with no change for
          <input type="number" name="unsettledDays" min="1" max="60" value="${info.unsettledDays}" style="width:70px" /> days.
          <span class="muted">Reminded again every same number of days until it is submitted.</span></span></label>
        <label class="em-rule"><span>📅 <strong>COA expiry</strong> – the COA expires in
          <input type="text" name="expiryDays" value="${esc(info.expiryDays)}" style="width:120px" /> days
          <span class="muted">(each once, e.g. 30, 15, 5 days before the COA Expiry Date; not for renewed COAs).</span></span></label>
        <label class="em-rule"><span>💾 <strong>Saved</strong> – someone pressed <strong>Save</strong> on a form: who saved, which form and what was changed.
          <span class="muted">Sent right away (never to the person who saved). Automatic saves while typing do not count.</span></span></label>
      </div>

      <h3 style="margin-top:20px">Who receives which alert</h3>
      <div class="table-wrap"><table class="em-people">
        <thead><tr><th>Person</th><th>Email</th>
          <th style="text-align:center">🕑 Unsettled job<br><button type="button" class="linkish" data-colall="unsettled">all</button></th>
          <th style="text-align:center">📅 COA expiry<br><button type="button" class="linkish" data-colall="expiry">all</button></th>
          <th style="text-align:center">💾 Saved<br><button type="button" class="linkish" data-colall="saved">all</button></th>
          <th style="text-align:center" title="A batch finished, is waiting for the daily limit, or was paused (the person who pressed Send always gets it)">📧 Email Batch<br><button type="button" class="linkish" data-colall="ebatch">all</button></th></tr></thead>
        <tbody>${[...withMail, ...without].map(r => `
          <tr data-person="${r.id}" style="cursor:default">
            <td><strong>${esc(r.name)}</strong><br><span class="muted" style="font-size:12px">${esc(ROLE_LABEL[r.role] || r.role)}${r.role === "user" ? " · own forms only" : " · all forms"}</span></td>
            <td style="font-size:12px">${r.email ? esc(r.email) : `<span style="color:var(--bad)">⚠ no email</span>`}</td>
            ${["unsettled", "expiry", "saved", "ebatch"].map(k => `<td style="text-align:center"><input type="checkbox" data-pref="${k}" ${(r.prefs || { unsettled: true, expiry: true, saved: r.role !== "user", ebatch: r.role !== "user" })[k] ? "checked" : ""} ${r.email ? "" : "disabled"} /></td>`).join("")}
          </tr>`).join("") || `<tr><td colspan="6" class="empty">No Super Admin, Admin or User yet.</td></tr>`}</tbody>
      </table></div>
      <div class="muted" style="font-size:12px;margin-top:4px">${info.canServer ? `Add or change email addresses under <a href="#/users">Administration › Users</a> (Edit).`
        : "Email addresses are set by the Super Admin under Administration › Users."}</div>
      ${info.canServer ? `
      <h3 style="margin-top:20px">Mail server (SMTP)</h3>
      <div class="em-grid">
        <label class="field"><span>Mail server</span><input type="text" name="host" value="${esc(info.host)}" placeholder="e.g. mail.example.com or smtp.office365.com" /></label>
        <label class="field"><span>Port</span><input type="number" name="port" value="${info.port}" min="1" max="65535" /></label>
        <label class="field"><span>Security</span><select name="security">
          ${[["starttls", "STARTTLS (port 587)"], ["ssl", "SSL/TLS (port 465)"], ["none", "None (port 25)"]].map(([v, l]) => `<option value="${v}" ${v === info.security ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="field"><span>Login (user name)</span><input type="text" name="user" value="${esc(info.user)}" autocomplete="off" placeholder="usually the email address" /></label>
        <label class="field"><span>Password ${info.hasPassword ? `<span class="muted" style="font-weight:400">(saved – leave empty to keep)</span>` : ""}</span>
          <input type="password" name="password" autocomplete="new-password" placeholder="${info.hasPassword ? "••••••••" : ""}" /></label>
        <label class="field"><span>From address</span><input type="email" name="from" value="${esc(info.from)}" placeholder="coa-system@example.com" /></label>
      </div>
      <div class="muted" style="font-size:12px;margin:4px 0 12px">Office 365: smtp.office365.com, 587, STARTTLS. Gmail: smtp.gmail.com, 587, STARTTLS with a Google <em>App password</em>.
        The password is stored on this server so it can send the emails.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn btn-primary">Save</button>
        <span style="flex:1"></span>
        <input type="email" id="emTo" value="${esc(info.myEmail)}" placeholder="send test to…" style="width:220px" />
        <button type="button" class="btn" id="emTest">Send test email</button>
      </div>` : `<div style="margin-top:16px"><button class="btn btn-primary">Save</button></div>`}
    </form>`;
  const people = () => Object.fromEntries([...document.querySelectorAll("[data-person]")].map(tr =>
    [tr.dataset.person, Object.fromEntries([...tr.querySelectorAll("[data-pref]")].map(x => [x.dataset.pref, x.checked]))]));
  const switches = f => ({ unsettledDays: +f.unsettledDays.value, expiryDays: f.expiryDays.value, enabled: f.enabled.checked, people: people() });
  document.querySelectorAll("[data-colall]").forEach(b => b.onclick = () => {
    const boxes = [...document.querySelectorAll(`[data-pref="${b.dataset.colall}"]:not(:disabled)`)];
    const on = !boxes.every(x => x.checked);
    boxes.forEach(x => { x.checked = on; });
  });
  const body = f => ({ ...switches(f), host: f.host.value, port: +f.port.value, security: f.security.value, user: f.user.value,
    password: f.password.value, from: f.from.value });
  $("#emForm").onsubmit = async e => {
    e.preventDefault();
    try {
      if (info.canServer) await api("PUT", "/api/email-settings", body(e.target));
      else await api("PUT", "/api/email-settings/alerts", switches(e.target));
      toast("Saved");
      renderEmailSettings();
    } catch (ex) { toast(ex.message); }
  };
  if ($("#emTest")) $("#emTest").onclick = async () => {
    const b = $("#emTest");
    b.disabled = true; b.textContent = "Sending…";
    try {
      await api("PUT", "/api/email-settings", body($("#emForm")));          // use what is typed now
      await api("POST", "/api/email-settings/test", { to: $("#emTo").value });
      toast("Test email sent – check the inbox (and spam folder)");
    } catch (ex) { tell("Test email failed:\n\n" + ex.message); }
    b.disabled = false; b.textContent = "Send test email";
  };
  $("#emRun").onclick = async () => {
    const b = $("#emRun");
    b.disabled = true; b.textContent = "Checking…";
    try { const { status } = await api("POST", "/api/email-settings/run", {}); $("#emStatus").innerHTML = statusHtml(status); }
    catch (ex) { toast(ex.message); }
    b.disabled = false; b.textContent = "✉ Check & send now";
  };
}

// ---------------- Email Alerts > Edit email templates (Super Admin + Admin)
const TPL_PARTS = [
  { title: "General", rows: [
    { key: "subject_prefix", label: "Subject starts with", type: "input", hint: "The rest is added automatically, e.g. “2 COA expiring, 1 unsettled job”" },
    { key: "greeting", label: "Greeting (top of every alert email)", type: "area" },
    { key: "footer", label: "Footer (bottom of every alert email)", type: "area" }] },
  { title: "📅 COA expiry", rows: [
    { key: "expiry_heading", label: "Heading", type: "input" },
    { key: "expiry_line", label: "Line for each COA", type: "area" }] },
  { title: "💾 Saved", rows: [
    { key: "saved_heading", label: "Heading", type: "input" },
    { key: "saved_line", label: "Line for each saved form", type: "area" }] },
  { title: "🕑 Unsettled job", rows: [
    { key: "unsettled_heading", label: "Heading", type: "input" },
    { key: "unsettled_line", label: "Line for each form", type: "area" }] },
  { title: "✉ Test email", rows: [
    { key: "test_text", label: "Text of the test email", type: "area" }] },
];
const TPL_FIELD_HELP = { formNo: "Form No.", title: "product · model", program: "COA Application / Consignment Test", coaNo: "COA No.",
  expiryDate: "COA expiry date", days: "number of days", level: "30 / 15 / 5", user: "person", time: "date and time", changes: "what was changed" };

async function renderEmailTemplates() {
  let data;
  try { data = await api("GET", "/api/email-templates"); } catch (ex) { toast(ex.message); return; }
  const field = (r, v) => r.type === "input"
    ? `<input type="text" data-tpl="${r.key}" value="${esc(v)}" maxlength="200" />`
    : `<textarea data-tpl="${r.key}" rows="${r.key.endsWith("_line") ? 2 : 3}" maxlength="1000">${esc(v)}</textarea>`;
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/settings">Settings</a> › <a href="#/settings/email">Email Alerts</a> › <span>Email templates</span></div>
        <h1 style="margin-top:6px">Email templates</h1>
        <div class="sub">Change the wording of the emails. Words in <code>{curly brackets}</code> are filled in by the system –
          click a field under a text to add it. The preview on the right updates as you type.</div>
      </div>
      <div class="actions"><button class="btn" id="tplReset">Reset to default</button><button class="btn btn-primary" id="tplSave">Save</button></div>
    </div>
    <div class="tpl-layout">
      <div class="tpl-edit">
        ${TPL_PARTS.map(g => `<div class="card as-card"><h3>${esc(g.title)}</h3>
          ${g.rows.map(r => `<label class="field"><span>${esc(r.label)}${r.hint ? ` <span class="muted" style="font-weight:400">– ${esc(r.hint)}</span>` : ""}</span>
            ${field(r, data.tpl[r.key])}</label>
            ${data.fields[r.key] ? `<div class="tpl-chips">${data.fields[r.key].map(f => `<button type="button" class="tpl-chip" data-ins="${r.key}" data-f="${f}" title="${esc(TPL_FIELD_HELP[f] || f)}">{${f}}</button>`).join("")}</div>` : ""}`).join("")}
        </div>`).join("")}
      </div>
      <div class="tpl-preview card">
        <div class="tpl-pv-head"><strong>Preview</strong> <span class="muted">– example data</span>
          <select id="tplWhich"><option value="alert">Alert email (all 3 types)</option><option value="test">Test email</option></select></div>
        <div class="tpl-subject" id="tplSubject"></div>
        <iframe id="tplFrame" title="Email preview" sandbox=""></iframe>
      </div>
    </div>`;
  const values = () => Object.fromEntries([...document.querySelectorAll("[data-tpl]")].map(x => [x.dataset.tpl, x.value]));
  let timer = null, last = null;
  const preview = async () => {
    try {
      last = await api("POST", "/api/email-templates/preview", { tpl: values() });
      const test = $("#tplWhich").value === "test";
      $("#tplSubject").textContent = "Subject: " + (test ? last.testSubject : last.subject);
      $("#tplFrame").srcdoc = `<body style="margin:12px;background:#fff">${test ? last.testHtml : last.html}</body>`;
    } catch (ex) { $("#tplSubject").textContent = ex.message; }
  };
  $("#app").querySelector(".tpl-edit").oninput = () => { clearTimeout(timer); timer = setTimeout(preview, 400); };
  $("#tplWhich").onchange = preview;
  $("#app").querySelector(".tpl-edit").onclick = e => {
    const chip = e.target.closest("[data-ins]");
    if (!chip) return;
    const box = document.querySelector(`[data-tpl="${chip.dataset.ins}"]`), ins = `{${chip.dataset.f}}`;
    const a = box.selectionStart ?? box.value.length, b = box.selectionEnd ?? box.value.length;
    box.value = box.value.slice(0, a) + ins + box.value.slice(b);
    box.focus();
    box.setSelectionRange(a + ins.length, a + ins.length);
    preview();
  };
  $("#tplSave").onclick = async () => {
    try { await api("PUT", "/api/email-templates", { tpl: values() }); toast("Email templates saved – used from the next email"); }
    catch (ex) { tell(ex.message); }
  };
  $("#tplReset").onclick = async () => {
    if (!await ask("Put all texts back to the original wording?\n\nPress Save afterwards to keep it.")) return;
    document.querySelectorAll("[data-tpl]").forEach(x => { x.value = data.defaults[x.dataset.tpl]; });
    preview();
  };
  preview();
}

// ---------------- Settings > AppSheet (copy of the data in a Google Sheet)
async function renderAppSheet() {
  let info;
  try { info = await api("GET", "/api/appsheet"); } catch (ex) { toast(ex.message); return; }
  const statusHtml = st => !st ? `<span class="muted">Not synced yet.</span>`
    : `<span class="badge ${st.ok ? "approved" : "expired"}">${st.ok ? "OK" : "Problem"}</span> ${fmtTime(st.at)} – ${esc(st.message)}
       ${st.rows ? `<div class="muted" style="margin-top:4px;font-size:12px">${Object.entries(st.rows).map(([k, v]) => `${esc(k)}: <strong>${v}</strong>`).join(" · ")}</div>` : ""}
       ${st.access && st.access.ok ? `<div class="muted" style="margin-top:4px;font-size:12px">${st.access.mode === "restricted" ? "🔒 Access list applied" : "🌐 Link sharing applied"}:
         ${st.access.added} added · ${st.access.removed} removed${st.access.filesFixed ? ` · ${st.access.filesFixed} document(s) updated` : ""}</div>` : ""}
       ${st.drive ? `<div class="muted" style="margin-top:4px;font-size:12px">📁 Google Drive: <strong>${st.drive.inDrive}</strong> documents
         ${st.drive.uploaded ? ` · ${st.drive.uploaded} copied now` : ""}${st.drive.waiting ? ` · <strong>${st.drive.waiting}</strong> waiting for the next sync` : ""}
         ${st.drive.notShared ? ` · <span style="color:var(--bad)">${st.drive.notShared} could not be shared as “Anyone with the link” (Google Workspace setting)</span>` : ""}</div>` : ""}`;
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/settings">Settings</a> › <a href="#/settings/integration">Integration</a> › <span>AppSheet</span></div>
        <h1 style="margin-top:6px">AppSheet – Google Sheet sync</h1>
        <div class="sub">A read-only copy of the COA Applications, Consignment Test forms, serial numbers and document list is sent
          to a Google Sheet. Build your AppSheet app on that Sheet. Nothing comes back from AppSheet into this system.</div>
      </div>
    </div>
    <div class="card as-card">
      <h3>Status</h3>
      <div id="asStatus">${statusHtml(info.status)}</div>
      <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary" id="asSync" ${info.url ? "" : "disabled"}>⟳ Sync now</button>
      </div>
    </div>
    <div class="card as-card">
      <h3>1. Create the Google Sheet and paste the script</h3>
      <ol class="as-steps">
        <li>Open <strong>sheets.google.com</strong> with the company Google account and create a new blank sheet, e.g. <em>Company COA Data</em>.</li>
        <li>In the sheet: <strong>Extensions › Apps Script</strong>. Delete what is there, paste the script below, press <strong>Save</strong> (💾).</li>
        <li><strong>Deploy › New deployment</strong> › ⚙ type <strong>Web app</strong> › Execute as <strong>Me</strong> › Who has access <strong>Anyone</strong> › <strong>Deploy</strong>.
          Google asks you to <em>Authorize access</em> – choose your account › Advanced › Go to project › Allow.</li>
        <li>Copy the <strong>Web app URL</strong> (ends with <code>/exec</code>) and paste it in step 2 below.</li>
      </ol>
      <div class="as-note">🔄 <strong>Updating the script</strong> (e.g. after “New secret key” or a new system version): paste the new script, <strong>Save</strong>,
        then <strong>Deploy › Manage deployments › ✏ Edit › Version: New version › Deploy</strong>. The /exec URL stays the same.
        <br>First time with documents: in Apps Script choose the function <strong>authorizeDrive</strong> at the top, press <strong>▶ Run</strong> and <strong>Allow</strong> (Google Drive access) – then deploy the new version.</div>
      <div class="as-script-head"><strong>Script</strong> <span class="muted">(contains your secret key – do not share it)</span>
        <button class="btn btn-sm" id="asCopy">📋 Copy script</button></div>
      <textarea id="asScript" readonly rows="10" class="as-script">${esc(info.script)}</textarea>
      ${info.secretCheck ? `<div class="muted" style="font-size:12px;margin-top:6px">🔑 Secret check code of this server: <code>${esc(info.secretCheck)}</code>
        – open your Web app URL (…/exec) in the browser: it must show <code>"version":3</code> and <code>"check":"${esc(info.secretCheck)}"</code>.
        If not, Google is running an old version or a script from another server.</div>` : ""}
    </div>
    <form class="card as-card" id="asForm">
      <h3>2. Connect</h3>
      <label class="field"><span>Web app URL</span>
        <input type="text" name="url" value="${esc(info.url)}" placeholder="https://script.google.com/macros/s/…/exec" /></label>
      <div class="as-row">
        <label class="field"><span>Sync every</span>
          <select name="minutes">${[5, 10, 15, 30, 60, 120, 240].map(m => `<option value="${m}" ${m === info.minutes ? "selected" : ""}>${m < 60 ? m + " minutes" : m / 60 + " hour" + (m > 60 ? "s" : "")}</option>`).join("")}</select></label>
      </div>
      <label class="check-line"><input type="checkbox" name="enabled" ${info.enabled ? "checked" : ""} /> Turn on automatic sync</label>
      <label class="check-line" style="margin-top:8px"><input type="checkbox" name="drive" ${info.drive ? "checked" : ""} />
        Copy the documents to Google Drive <span class="muted" style="font-weight:400">– “Drive Link” column</span></label>

      <h3 style="margin-top:18px">Who can see the Google Sheet and the documents</h3>
      <label class="check-line"><input type="radio" name="access" value="restricted" ${info.access === "restricted" ? "checked" : ""} />
        🔒 Only these email addresses <span class="muted" style="font-weight:400">(recommended)</span></label>
      <label class="check-line" style="margin-top:6px"><input type="radio" name="access" value="link" ${info.access !== "restricted" ? "checked" : ""} />
        🌐 Anyone who has the link <span class="muted" style="font-weight:400">(documents only; the Sheet keeps its own sharing)</span></label>
      <label class="field" style="margin-top:10px"><span>Email addresses allowed to see them – one per line
        <span class="muted" style="font-weight:400">(any Google account; they do not need to be users of this system)</span></span>
        <textarea name="viewers" rows="5" placeholder="ict@example.com&#10;manager@example.com">${esc((info.viewers || []).join("\n"))}</textarea></label>
      <div class="muted" style="font-size:12px;margin:-4px 0 10px">Applied at the next sync (or press ⟳ Sync now): people added get view access to the Sheet
        and the <em>Company COA Documents</em> folder, people removed lose it. The owner of the Sheet always keeps access.
        In AppSheet, also add the same people under <strong>Share app</strong>.</div>
      <div class="muted" style="font-size:12px;margin:6px 0 12px">Documents go to the Drive folder <em>Company COA Documents</em> (one folder per Form No.),
        up to 20 files / 150 MB per sync – the rest follow at the next syncs. Files over 35 MB stay only in this system.
        The “Open in Website” links open the form in this website, so they only work on the office network.
        The sheet only gets new data when something changed (and at least every 6 hours).</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary">Save</button>
        <button type="button" class="btn" id="asNewSecret" title="Makes a new secret key. You must paste the new script into Apps Script and deploy again.">New secret key</button>
      </div>
    </form>
    <div class="card as-card">
      <h3>3. Build the app in AppSheet</h3>
      <ol class="as-steps">
        <li>After the first sync, open <strong>appsheet.com</strong> › <strong>Create › App › Start with existing data</strong> › choose the Google Sheet.</li>
        <li>Add the tables <strong>COA Applications</strong>, <strong>Consignment Test</strong>, <strong>Serial Numbers</strong>, <strong>Documents</strong>
          and <strong>Email Batch</strong> (Data › Add table). Keys: <em>Form No</em> for the first two, <em>Key</em> for the others.
          HR Dept and General are in the Sheet too: <strong>Memo</strong> (key <em>Memo No</em>), <strong>MC Request</strong> (key <em>Document Number</em>),
          <strong>Transfer Form</strong> and <strong>Time Adjustment</strong> (key <em>Key</em> – one row per staff line); their files are in <em>Documents</em>.
          IC numbers are not sent to Google.
          <em>Email Batch</em> = every email sent out by Email Batch (customer, subject, details, sent time) – it is only in the Google Sheet.
          <em>Document Versions</em> = every version of every form (who, when, what changed) and <em>Version Changes</em> = each changed item
          with its old and new value – link <em>Version Changes › Version Key</em> as Ref to <em>Document Versions</em>.</li>
        <li>Set every table to <strong>Read-Only</strong> (Data › table › Are updates allowed? › Read-Only) – changes are made in this website.
          Only exception: <strong>Memo Approval</strong> (next step).</li>
        <li><strong>Approve memos in AppSheet</strong> (needs script version 4 – copy the script above again and deploy a new version):
          add the table <strong>Memo Approval</strong> (key <em>Memo No</em>) with <em>Are updates allowed? › Updates</em>.
          Column <em>Decision</em>: type <em>Enum</em> with the value <code>Approve</code> – the only editable column (switch <em>Editable</em> off for the others).
          Column <em>Decided By</em>: <em>App formula</em> <code>USEREMAIL()</code>.
          Add a view with the filter <code>AND([Person in Charge Email] = USEREMAIL(), [Status] = "Processing")</code>.
          The person in charge chooses <em>Approve</em> → at the next sync this system approves the memo with their saved signature.
          It only works when their <strong>email in Administration › Users is the same Google account</strong> they use in AppSheet, and they have
          saved a signature (name menu › ✍ My signature). The <em>Result</em> column shows what happened.</li>
        <li>Useful column types: <em>Drive Link</em> and <em>Open in Website</em> = URL, the dates = Date, <em>COA Alert</em> and <em>Status</em> = Enum.
          Link <em>Serial Numbers › Form No</em> and <em>Documents › Form No</em> as Ref to their form table.</li>
      </ol>
    </div>`;
  $("#asCopy").onclick = async () => toast(await copyText(info.script) ? "Script copied" : "Could not copy – select the text and press Ctrl+C");
  $("#asForm").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      info = await api("PUT", "/api/appsheet", { url: f.url.value, minutes: +f.minutes.value, enabled: f.enabled.checked, drive: f.drive.checked,
        access: f.access.value, viewers: f.viewers.value });
      toast("Saved");
      renderAppSheet();
    } catch (ex) { toast(ex.message); }
  };
  $("#asNewSecret").onclick = async () => {
    if (!await ask("Make a new secret key?\n\nThe old script stops working. You must copy the new script into Apps Script and deploy it again (Deploy › Manage deployments › Edit › New version).")) return;
    const f = $("#asForm");
    try {
      await api("PUT", "/api/appsheet", { url: f.url.value, minutes: +f.minutes.value, enabled: f.enabled.checked, drive: f.drive.checked,
        access: f.access.value, viewers: f.viewers.value, newSecret: true });
      toast("New secret key made – copy the script again");
      renderAppSheet();
    } catch (ex) { toast(ex.message); }
  };
  $("#asSync").onclick = async () => {
    const b = $("#asSync");
    b.disabled = true;
    b.textContent = "Syncing… (documents can take a few minutes)";
    try {
      const { status } = await api("POST", "/api/appsheet/sync", {});
      $("#asStatus").innerHTML = statusHtml(status);
      toast(status.ok ? "Synced to Google Sheet" : "Sync problem – see Status");
    } catch (ex) { toast(ex.message); }
    b.disabled = false;
    b.textContent = "⟳ Sync now";
  };
}

/* =========================================================
   EMAIL BATCH (Marketing Dept)
   #/eb          batches        #/eb/new   new batch
   #/eb/<id>     one batch: template, customers, preview, send
   ========================================================= */
const EB_STATUS = { draft: ["Draft", "draft"], sending: ["Sending…", "review"], stopped: ["Stopped", "review"],
  sent: ["Sent", "approved"], partial: ["Sent – some failed", "expired"], cancelled: ["Cancelled", "cancelled"] };
const ebBadge = (st, b) => {
  if (b && st === "sending" && b.waitUntil) return `<span class="badge review" title="${esc(b.note)}">⏳ Waiting (daily limit)</span>`;
  if (b && st === "stopped" && b.note) return `<span class="badge expired" title="${esc(b.note)}">⏸ Paused</span>`;
  const [l, c] = EB_STATUS[st] || [st, "draft"]; return `<span class="badge ${c}">${esc(l)}</span>`;
};
const ebQuotaLine = q => q ? (q.limit
  ? `<strong>${q.sent24h}</strong> of <strong>${q.limit}</strong> emails sent in the last 24 hours – <strong>${q.left}</strong> more can go out now`
  : `<strong>${q.sent24h}</strong> emails sent in the last 24 hours (no limit set)`) : "";
let ebCur = null, ebRows = [], ebDirty = false, ebPoll = null, ebPrev = 0, ebFind = { id: null, q: "", st: "" };

async function renderEbList() {
  let data;
  try { data = await api("GET", "/api/eb"); } catch (ex) { toast(ex.message); location.replace("#/"); return; }
  const list = data.batches;
  const count = f => list.filter(f).length;
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <h1>Email Batch</h1>
        <div class="sub">One template, one personal email for every customer – sent from the company mail account. Marketing Dept.</div>
      </div>
      <div class="actions">${data.canEdit ? `<button class="btn btn-primary" id="ebNew">+ New Batch</button>` : ""}</div>
    </div>
    <div class="stats">
      <div class="stat"><div class="n">${list.length}</div><div class="l">Batches</div></div>
      <div class="stat"><div class="n">${count(b => b.status === "draft")}</div><div class="l">Draft</div></div>
      <div class="stat"><div class="n">${list.reduce((n, b) => n + b.sent, 0)}</div><div class="l">Emails sent</div></div>
      <div class="stat"><div class="n">${list.reduce((n, b) => n + b.failed, 0)}</div><div class="l">Failed</div></div>
    </div>
    <div class="card eb-quota">
      <div>📨 ${ebQuotaLine(data.quota)}.
        <span class="muted" style="font-size:12px">About ${Math.round(60 / (data.quota?.gap || 2))} emails per minute. When the limit is reached,
        sending waits and continues by itself. You get an email when a batch finishes or pauses.</span></div>
      ${data.canSetLimit ? `<div class="eb-quota-set"><label>Limit per 24 hours
        <input type="number" id="ebLimit" min="0" max="100000" value="${data.quota?.limit ?? 2000}" style="width:100px" /></label>
        <button class="btn btn-sm" id="ebLimitSave">Save</button>
        <span class="muted" style="font-size:12px">0 = no limit · Office 365 allows about 10,000 a day per mailbox</span></div>` : ""}
    </div>
    <div class="card">
      <div class="toolbar"><input type="text" id="ebQ" placeholder="Search batch no., title, subject…" /></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Batch No.</th><th>Title</th><th>Email subject</th><th>Customers</th><th>Sent</th><th>Failed</th><th>Status</th><th>Created</th></tr></thead>
        <tbody id="ebRows"></tbody>
      </table></div>
    </div>`;
  const draw = () => {
    const q = $("#ebQ").value.toLowerCase().trim();
    const rows = list.filter(b => !q || [b.batchNo, b.title, b.subject].some(v => (v || "").toLowerCase().includes(q)));
    $("#ebRows").innerHTML = rows.length ? rows.map(b => `
      <tr data-eb="${b.id}">
        <td><strong>${esc(b.batchNo)}</strong></td><td>${esc(b.title || "—")}</td><td>${esc(b.subject || "—")}</td>
        <td>${b.total}</td><td>${b.sent}</td><td>${b.failed ? `<span style="color:var(--bad);font-weight:700">${b.failed}</span>` : 0}</td>
        <td>${ebBadge(b.status, b)}</td>
        <td class="muted" style="font-size:12px">${esc(b.createdBy)}<br>${fmtTime(b.createdAt)}</td></tr>`).join("")
      : `<tr><td colspan="8" class="empty">${list.length ? "No matching batch." : "No batch yet." + (data.canEdit ? " Click <strong>+ New Batch</strong> to start." : "")}</td></tr>`;
  };
  draw();
  $("#ebQ").oninput = draw;
  $("#ebRows").onclick = e => { const tr = e.target.closest("[data-eb]"); if (tr) location.hash = "#/eb/" + tr.dataset.eb; };
  if ($("#ebNew")) $("#ebNew").onclick = () => ebNewDialog(list);
  if ($("#ebLimitSave")) $("#ebLimitSave").onclick = async () => {
    try { await api("PUT", "/api/eb-limit", { limit: +$("#ebLimit").value }); toast("Sending limit saved"); renderEbList(); }
    catch (ex) { tell(ex.message); }
  };
}

function ebNewDialog(list) {
  const olds = list.filter(b => b.subject || b.body);
  openDialog(`
    <h3>New email batch</h3>
    <label class="field"><span>Title (for yourself, e.g. "TNG Reward August 2026")</span><input type="text" name="title" maxlength="200" required /></label>
    <div class="field"><span>Template</span>
      <label class="check-line" style="font-weight:500"><input type="radio" name="from" value="blank" ${olds.length ? "" : "checked"} /> Start empty (you can import a Word template next)</label>
      ${olds.length ? `<label class="check-line" style="font-weight:500;margin-top:6px"><input type="radio" name="from" value="copy" checked /> Reuse the template of
        <select name="copyFrom" style="width:auto;margin-left:6px">${olds.map(b => `<option value="${b.id}">${esc(b.batchNo)} – ${esc(b.title || b.subject)}</option>`).join("")}</select></label>` : ""}
    </div>`, async form => {
    const copy = form.from.value === "copy";
    const { batch } = await api("POST", "/api/eb", { title: form.title.value, copyFrom: copy ? form.copyFrom.value : "" });
    toast(`${batch.batchNo} created`);
    location.hash = "#/eb/" + batch.id;
  }, "Create");
}

async function renderEbBatch(id) {
  clearInterval(ebPoll);
  let data;
  try { data = await api("GET", `/api/eb/${id}`); } catch (ex) { toast(ex.message); location.replace("#/eb"); return; }
  ebCur = data.batch;
  ebCur.canEdit = data.canEdit;
  if (ebFind.id !== id) ebFind = { id, q: "", st: "" };        // the search stays while you work on the same batch
  ebRows = ebCur.recipients.map(r => ({ ...r, fields: { ...r.fields } }));
  ebDirty = false;
  ebPrev = Math.min(ebPrev, Math.max(0, ebRows.length - 1));
  drawEbBatch();
}

function drawEbBatch() {
  const b = ebCur, edit = b.canEdit && b.status === "draft", canAct = b.canEdit && b.status !== "cancelled";
  const ready = ebRows.filter(r => r.status === "pending" && !(r.problems || []).length).length;
  const notReady = ebRows.filter(r => r.status === "pending" && (r.problems || []).length).length;
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <a href="#/eb" style="text-decoration:none;font-weight:600">← Back to Email Batch</a>
        <h1 style="margin-top:6px">${esc(b.batchNo)} ${ebBadge(b.status, b)}</h1>
        <div class="savebar">${esc(b.title || "")} · created by ${esc(b.createdBy)}, ${fmtTime(b.createdAt)}${b.startedAt ? ` · sending started by ${esc(b.sentBy)}, ${fmtTime(b.startedAt)}` : ""}</div>
      </div>
      <div class="actions">${canAct && b.status !== "sending" && !b.sent ? `<button class="btn btn-danger" id="ebCancel">Cancel batch</button>` : ""}</div>
    </div>
    ${!edit && b.canEdit && b.status !== "cancelled" ? `<div class="banner readonly-note">Emails of this batch have been sent, so the template and the customer list are locked.
      For a new round, create a new batch and reuse this template.</div>` : ""}

    <section class="card eb-card">
      <div class="card-head"><h2>1. Template</h2></div>
      <div class="card-body eb-pad">
        <div class="eb-grid">
          <label class="field"><span>Title</span><input type="text" id="ebTitle" value="${esc(b.title)}" ${edit ? "" : "disabled"} /></label>
          <label class="field"><span>Sender name <span class="muted" style="font-weight:400">(customers see this as “From”)</span></span>
            <input type="text" id="ebFrom" value="${esc(b.fromName)}" placeholder="Company Name" ${edit ? "" : "disabled"} /></label>
        </div>
        <label class="field"><span>Subject</span><input type="text" id="ebSubject" value="${esc(b.subject)}" ${edit ? "" : "disabled"} /></label>
        <div class="field"><span>Email text <span class="muted" style="font-weight:400">– <code>[Field Name]</code> = each customer's own text</span></span>
          ${edit ? `<div class="eb-toolbar">
            <button type="button" class="eb-tool" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
            <button type="button" class="eb-tool" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
            <button type="button" class="eb-tool" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
            <label class="eb-tool eb-color" title="Text colour"><span style="border-bottom:3px solid #d0021b">A</span>
              <input type="color" id="ebColor" value="#d0021b" /></label>
            <label class="eb-tool eb-color" title="Highlight"><span style="background:#ffe600;padding:0 3px">ab</span>
              <input type="color" id="ebHilite" value="#ffe600" /></label>
            <select id="ebSize" class="eb-tool" title="Text size">
              <option value="">Size</option><option value="2">Small</option><option value="3">Normal</option>
              <option value="4">Large</option><option value="5">Larger</option><option value="6">Huge</option></select>
            <button type="button" class="eb-tool" data-cmd="justifyLeft" title="Align left">⯇</button>
            <button type="button" class="eb-tool" data-cmd="justifyCenter" title="Centre">≡</button>
            <button type="button" class="eb-tool" data-cmd="removeFormat" title="Clear formatting of the selected text">⌫ Clear</button>
            <span class="eb-tool-sep"></span>
            <span class="muted" style="font-size:12px">Click to add a field:</span>
            <span id="ebFieldChips"></span>
            <button type="button" class="eb-tool" id="ebNewField">+ New field</button>
          </div>` : ""}
          <div id="ebBody" class="eb-editor ${edit ? "" : "readonly"}" ${edit ? 'contenteditable="true"' : ""}>${b.bodyHtml || ""}</div></div>
        ${edit ? "" : `<div class="eb-fields">Fields: ${b.fields.length ? b.fields.map(f => `<code>[${esc(f)}]</code>`).join(" ") : `<span class="muted">none</span>`}</div>`}
        ${edit ? `<div class="eb-btns">
          <button class="btn btn-primary" id="ebSaveTpl">💾 Save template</button>
          <label class="btn upload-btn"><span>📄 Import Word template (.docx)</span><input type="file" id="ebDocx" accept=".docx" /></label>
          <span class="muted" style="font-size:12px">Word: a line “Subject : …” becomes the subject, the text below it the email – bold, italic, underline, colours, highlight, size, font and links are kept (pictures are not imported).</span>
        </div>` : ""}
      </div>
    </section>

    <section class="card eb-card">
      <div class="card-head"><h2>2. Customers (${ebRows.length})</h2>
        <span class="muted" style="font-size:12px">${b.sent} sent · ${b.failed} failed · ${b.pending} waiting</span></div>
      <div class="card-body eb-pad">
        <div class="eb-btns">
          ${edit ? `<button class="btn" id="ebImport">📥 Import customers</button>` : ""}
          ${ebRows.length ? `<a class="btn" href="/api/eb/${b.id}/customers.csv" download>⬇ Download list</a>` : ""}
          ${edit ? `<button class="btn" id="ebAddRow">+ Add customer</button><button class="btn btn-primary" id="ebSaveRows">💾 Save list</button>
          <span class="muted" id="ebDirtyNote" style="font-size:12px"></span>` : ""}
        </div>
        ${ebRows.length ? `<div class="eb-find">
          <input type="search" id="ebFind" placeholder="🔍 Search customers – email, name, any detail…" value="${esc(ebFind.q)}" />
          <select id="ebFindSt" title="Show only">
            ${[["", "All"], ["ready", "Ready"], ["notready", "Not ready"], ["sent", "Sent"], ["failed", "Failed"]].map(([v, l]) =>
              `<option value="${v}" ${ebFind.st === v ? "selected" : ""}>${l}</option>`).join("")}</select>
          <span class="muted" id="ebFindCount" style="font-size:12px"></span>
        </div>` : ""}
        <div class="table-wrap eb-table-wrap"><table class="eb-table">
          <thead><tr id="ebHeadRow"></tr></thead>
          <tbody id="ebBodyRows"></tbody>
        </table></div>
      </div>
    </section>

    <section class="card eb-card">
      <div class="card-head"><h2>3. Preview</h2>
        <span class="muted" style="font-size:12px">every email exactly as the customer gets it – sent emails show the copy that was sent</span></div>
      <div class="card-body eb-pad">
        <div class="eb-btns">
          <button class="btn btn-sm" id="ebPrevBtn">◀</button>
          <select id="ebWho" style="width:auto;max-width:100%"></select>
          <button class="btn btn-sm" id="ebNextBtn">▶</button>
          ${b.canEdit ? `<span style="flex:1"></span><input type="email" id="ebTestTo" value="${esc(me.email || "")}" placeholder="your email" style="width:220px" />
          <button class="btn" id="ebTest">✉ Send test to me</button>` : ""}
        </div>
        <div class="eb-mail">
          <div class="eb-mail-head" id="ebMailHead"></div>
          <iframe id="ebFrame" title="Email preview" sandbox=""></iframe>
        </div>
      </div>
    </section>

    ${b.canEdit ? `<section class="card eb-card">
      <div class="card-head"><h2>4. Send</h2></div>
      <div class="card-body eb-pad" id="ebSendBox"></div>
    </section>` : ""}`;

  drawEbRows(edit);
  drawEbWho();
  ebShowPreview();
  drawEbSend(ready, notReady);
  bindEb(edit);
  if (b.status === "sending") ebPoll = setInterval(ebRefresh, 3000);
}

function drawEbRows(edit) {
  const b = ebCur;
  $("#ebHeadRow").innerHTML = `<th>#</th><th>Email</th>${b.fields.map(f => `<th>${esc(f)}</th>`).join("")}<th>Status</th><th></th>`;
  const cell = (r, i, key, val) => edit && r.status !== "sent"
    ? (key === "__email" ? `<input type="email" data-r="${i}" data-f="__email" value="${esc(val || "")}" />`
      : `<textarea class="eb-cell" rows="${Math.min(6, String(val || "").split("\n").length)}" data-r="${i}" data-f="${esc(key)}"
          title="Enter = new line inside this value">${esc(val || "")}</textarea>`)   // keeps line breaks (e.g. PIN / Expiry)
    : esc(val || "—").replace(/\n/g, "<br>");
  // search: every word must be found in the email, a detail or the status (row number: "#12")
  const words = ebFind.q.toLowerCase().split(/\s+/).filter(Boolean);
  const stOf = r => r.status === "sent" ? "sent" : r.status === "failed" ? "failed" : (r.problems || []).length ? "notready" : "ready";
  const shown = ebRows.map((r, i) => [r, i]).filter(([r, i]) => {
    if (ebFind.st && stOf(r) !== ebFind.st) return false;
    const hay = [r.email, ...Object.values(r.fields || {}), r.error, (r.problems || []).join(" "),
      { sent: "sent", failed: "failed", notready: "not ready", ready: "ready" }[stOf(r)]].join(" ").toLowerCase();
    return words.every(w => w === `#${i + 1}` || hay.includes(w));
  });
  if ($("#ebFindCount")) $("#ebFindCount").textContent = words.length || ebFind.st ? `${shown.length} of ${ebRows.length} shown` : "";
  $("#ebBodyRows").innerHTML = ebRows.length && !shown.length
    ? `<tr><td colspan="${b.fields.length + 4}" class="empty">No customer matches the search.</td></tr>`
    : ebRows.length ? shown.map(([r, i]) => `
    <tr class="${i === ebPrev ? "eb-sel" : ""}" style="cursor:default">
      <td>${i + 1}</td>
      <td>${cell(r, i, "__email", r.email)}</td>
      ${b.fields.map(f => `<td>${cell(r, i, f, r.fields[f])}</td>`).join("")}
      <td style="white-space:nowrap">${r.status === "sent" ? `<span class="badge approved">Sent</span><div class="muted" style="font-size:11px">${fmtTime(r.sentAt)}</div>`
        : r.status === "failed" ? `<span class="badge expired" title="${esc(r.error)}">Failed</span><div style="font-size:11px;color:var(--bad)">${esc(r.error).slice(0, 80)}</div>`
        : (r.problems || []).length ? `<span class="badge review">Not ready</span><div style="font-size:11px;color:var(--bad)">${esc(r.problems.join("; "))}</div>`
        : `<span class="badge draft">Ready</span>`}</td>
      <td style="white-space:nowrap"><button class="btn btn-sm" data-view="${i}">👁 View</button>
        ${edit && r.status !== "sent" ? `<button class="btn btn-sm" data-del="${i}" title="Remove">✕</button>` : ""}</td>
    </tr>`).join("") : `<tr><td colspan="${b.fields.length + 4}" class="empty">No customers yet – import an Excel / CSV file or click + Add customer.</td></tr>`;
}

function drawEbWho() {
  const sel = $("#ebWho");
  sel.innerHTML = ebRows.length ? ebRows.map((r, i) => `<option value="${i}" ${i === ebPrev ? "selected" : ""}>${i + 1}. ${esc(r.email || "(no email)")}${r.status === "sent" ? " ✔ sent" : r.status === "failed" ? " ✖ failed" : ""}</option>`).join("")
    : `<option>No customers yet</option>`;
}

async function ebShowPreview() {
  const r = ebRows[ebPrev];
  if (!r || !r.id) {
    $("#ebMailHead").innerHTML = r ? `<span class="muted">Save the customer list to see the preview.</span>` : `<span class="muted">Add customers to see their emails.</span>`;
    $("#ebFrame").srcdoc = "";
    return;
  }
  try {
    const p = await api("GET", `/api/eb/${ebCur.id}/preview?r=${r.id}`);
    $("#ebMailHead").innerHTML = `
      <div><b>From</b> ${esc(p.from || "Company Name")}</div><div><b>To</b> ${esc(p.to || "—")}</div>
      <div><b>Subject</b> <strong>${esc(p.subject)}</strong></div>
      ${p.sent ? `<div class="eb-sent">✔ Copy of the email sent on ${fmtTime(p.sentAt)}</div>` : ""}
      ${(p.problems || []).length ? `<div class="eb-warn">⚠ ${esc(p.problems.join("; "))}</div>` : ""}`;
    $("#ebFrame").srcdoc = `<body style="margin:14px;background:#fff">${p.html}</body>`;
  } catch (ex) { $("#ebMailHead").textContent = ex.message; }
}

function drawEbSend(ready, notReady) {
  const box = $("#ebSendBox");
  if (!box) return;
  const b = ebCur, done = b.sent + b.failed, pct = b.total ? Math.round(100 * done / b.total) : 0;
  if (b.status === "cancelled") { box.innerHTML = `<span class="muted">This batch is cancelled.</span>`; return; }
  const q = b.quota, mins = n => { const m = Math.ceil(n * (q?.gap || 2) / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
  const tellMe = me.email ? `You get an email at <strong>${esc(me.email)}</strong> when it finishes or pauses.`
    : `<span style="color:var(--bad)">Add your email address (Administration › Users) to get an email when it finishes or pauses.</span>`;
  if (b.status === "sending") {
    box.innerHTML = `<div><strong>${b.waitUntil ? "Waiting…" : "Sending…"}</strong> ${b.sent} sent · ${b.failed} failed · ${b.pending} waiting
        ${b.waitUntil ? "" : `<span class="muted" style="font-size:12px">– about ${mins(b.pending)} left</span>`}</div>
      <div class="progress" style="margin:10px 0"><div style="width:${pct}%"></div></div>
      ${b.waitUntil ? `<div class="eb-warn">⏳ ${esc(b.note)}</div>` : ""}
      <button class="btn" id="ebStop">⏸ Stop</button> <span class="muted" style="font-size:12px">You can leave this page – sending continues on the server. ${tellMe}</span>`;
    return;
  }
  const parts = [];
  if (b.status === "stopped" && b.note) parts.push(`<div class="eb-paused"><strong>⏸ Sending paused</strong><div style="white-space:pre-line;margin-top:4px">${esc(b.note)}</div></div>`);
  if (b.sent || b.failed) parts.push(`<div style="margin-bottom:10px"><strong>${b.sent}</strong> sent${b.failed ? ` · <strong style="color:var(--bad)">${b.failed}</strong> failed` : ""}${b.finishedAt ? ` · finished ${fmtTime(b.finishedAt)}` : ""}</div>`);
  if (ebDirty) parts.push(`<div class="eb-warn">Save the customer list first.</div>`);
  else if (b.pending) parts.push(`<div style="margin-bottom:10px">${ready} ready${notReady ? ` · <span style="color:var(--bad)">${notReady} not ready – fix the red rows first</span>` : ""}
        ${ready ? `<span class="muted" style="font-size:12px">– takes about ${mins(ready)}</span>` : ""}</div>
      ${q ? `<div class="muted" style="font-size:12px;margin-bottom:8px">📨 ${ebQuotaLine(q)}. ${tellMe}</div>` : ""}
      ${q && q.limit && ready > q.left ? `<div class="eb-warn">Only ${q.left} can go out now – the other ${ready - q.left} wait and go out by
        themselves when the 24-hour limit allows (you get an email).</div>` : ""}
      <button class="btn btn-primary" id="ebSend" ${ready && !notReady ? "" : "disabled"}>📤 ${b.status === "stopped" ? "Continue sending" : `Send to ${ready} customer${ready === 1 ? "" : "s"}`}</button>`);
  if (b.failed && b.status !== "draft") parts.push(`<button class="btn" id="ebRetry" style="margin-left:6px">↻ Send the failed ones again</button>`);
  if (!parts.length) parts.push(`<span class="muted">Add customers and save the list, then send.</span>`);
  box.innerHTML = parts.join("");
}

async function ebRefresh() {
  if (!ebCur || !location.hash.startsWith("#/eb/")) { clearInterval(ebPoll); return; }
  try {
    const { batch } = await api("GET", `/api/eb/${ebCur.id}`);
    const was = ebCur.status;
    ebCur = { ...batch, canEdit: ebCur.canEdit };
    ebRows = ebCur.recipients.map(r => ({ ...r, fields: { ...r.fields } }));
    if (batch.status !== "sending") {
      clearInterval(ebPoll);
      if (was === "sending") {
        if (batch.status === "stopped" && batch.note) tell(`${batch.batchNo}: sending paused.\n\n${batch.note}`);
        else toast(`${batch.batchNo}: sending finished – ${batch.sent} sent, ${batch.failed} failed`);
      }
      drawEbBatch(); return;
    }
    drawEbRows(false); drawEbWho(); drawEbSend(0, 0); bindEbSend();
  } catch { /* try again at the next tick */ }
}

function bindEbSend() {
  if ($("#ebStop")) $("#ebStop").onclick = async () => { ebCur = { ...(await api("POST", `/api/eb/${ebCur.id}/stop`, {})).batch, canEdit: ebCur.canEdit }; renderEbBatch(ebCur.id); };
  if ($("#ebSend")) $("#ebSend").onclick = async () => {
    const n = ebRows.filter(r => r.status === "pending").length;
    if (!await ask(`Send the email to ${n} customer${n === 1 ? "" : "s"} now?\n\nFrom: ${ebCur.fromName || "Company Name"}\nSubject: ${ebCur.subject}\n\nThis cannot be undone.`, "Send")) return;
    try { await api("POST", `/api/eb/${ebCur.id}/send`, {}); toast("Sending started"); renderEbBatch(ebCur.id); } catch (ex) { tell(ex.message); }
  };
  if ($("#ebRetry")) $("#ebRetry").onclick = async () => {
    if (!await ask(`Send the ${ebCur.failed} failed email(s) again?`, "Send again")) return;
    try { await api("POST", `/api/eb/${ebCur.id}/retry`, {}); renderEbBatch(ebCur.id); } catch (ex) { tell(ex.message); }
  };
}

function bindEb(edit) {
  const id = ebCur.id;
  const markDirty = () => { ebDirty = true; if ($("#ebDirtyNote")) $("#ebDirtyNote").textContent = "● unsaved changes"; };
  bindEbSend();
  if ($("#ebFind")) {
    $("#ebFind").oninput = e => { ebFind.q = e.target.value; drawEbRows(edit); };
    $("#ebFindSt").onchange = e => { ebFind.st = e.target.value; drawEbRows(edit); };
    drawEbRows(edit);                                          // show the count for a search kept from before
  }
  $("#ebWho").onchange = e => { ebPrev = +e.target.value; drawEbRows(edit); ebShowPreview(); };
  $("#ebPrevBtn").onclick = () => { if (ebPrev > 0) { ebPrev--; drawEbWho(); drawEbRows(edit); ebShowPreview(); } };
  $("#ebNextBtn").onclick = () => { if (ebPrev < ebRows.length - 1) { ebPrev++; drawEbWho(); drawEbRows(edit); ebShowPreview(); } };
  $("#ebBodyRows").oninput = e => {
    const t = e.target;
    if (!t.dataset.f) return;
    const r = ebRows[+t.dataset.r];
    if (t.dataset.f === "__email") r.email = t.value; else r.fields[t.dataset.f] = t.value;
    if (t.tagName === "TEXTAREA") t.rows = Math.min(6, t.value.split("\n").length);
    markDirty();
  };
  $("#ebBodyRows").onclick = async e => {
    const v = e.target.closest("[data-view]"), d = e.target.closest("[data-del]");
    if (v) { ebPrev = +v.dataset.view; drawEbWho(); drawEbRows(edit); ebShowPreview(); $("#ebFrame").scrollIntoView({ block: "center", behavior: "smooth" }); }
    if (d) { ebRows.splice(+d.dataset.del, 1); ebPrev = Math.min(ebPrev, Math.max(0, ebRows.length - 1)); markDirty(); drawEbRows(edit); drawEbWho(); }
  };
  if ($("#ebTest")) $("#ebTest").onclick = async () => {
    try { await api("POST", `/api/eb/${id}/test`, { to: $("#ebTestTo").value, r: ebRows[ebPrev]?.id }); toast("Test email sent – check your inbox"); }
    catch (ex) { tell("Test email failed:\n\n" + ex.message); }
  };
  if ($("#ebCancel")) $("#ebCancel").onclick = async () => {
    if (!await ask(`Cancel ${ebCur.batchNo}? It stays in the list for record.`, "Cancel batch", "Keep")) return;
    try { await api("POST", `/api/eb/${id}/cancel`, {}); renderEbBatch(id); } catch (ex) { tell(ex.message); }
  };
  if (!edit) return;
  // ---- formatted-text editor: toolbar + click to add a field (into the subject or the text, where the cursor was last)
  const editor = $("#ebBody"), subjBox = $("#ebSubject");
  let savedRange = null, lastBox = editor;
  document.execCommand("styleWithCSS", false, true);        // colours / sizes as style="" (kept by the server)
  const keepRange = () => {
    const sel = window.getSelection();
    if (sel.rangeCount && editor.contains(sel.anchorNode)) { savedRange = sel.getRangeAt(0).cloneRange(); lastBox = editor; }
  };
  const useRange = () => {
    editor.focus();
    if (savedRange) { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange); }
  };
  editor.addEventListener("keyup", keepRange);
  editor.addEventListener("mouseup", keepRange);
  editor.addEventListener("input", keepRange);
  editor.addEventListener("focus", () => { lastBox = editor; });
  subjBox.addEventListener("focus", () => { lastBox = subjBox; });
  const cmd = (name, value = null) => { useRange(); document.execCommand(name, false, value); keepRange(); drawChipsSoon(); };
  document.querySelectorAll(".eb-toolbar [data-cmd]").forEach(b => {
    b.onmousedown = e => e.preventDefault();                 // keep the selection in the text
    b.onclick = () => cmd(b.dataset.cmd);
  });
  $("#ebColor").onchange = e => cmd("foreColor", e.target.value);
  $("#ebHilite").onchange = e => cmd("hiliteColor", e.target.value);
  $("#ebSize").onchange = e => { if (e.target.value) cmd("fontSize", e.target.value); e.target.value = ""; };
  const fieldsNow = () => {
    const out = [];
    for (const m of (subjBox.value + "\n" + editor.innerText).matchAll(/\[([^\[\]\n]{1,60})\]/g)) {
      const f = m[1].trim();
      if (f && !out.some(x => x.toLowerCase() === f.toLowerCase())) out.push(f);
    }
    return out;
  };
  const drawChips = () => {
    const fs = fieldsNow();
    const key = a => a.map(x => x.toLowerCase()).sort().join("|");
    if (key(fs) !== key(ebCur.fields)) {                        // customer table columns follow the template
      ebCur.fields = fs;
      drawEbRows(edit);
    }
    $("#ebFieldChips").innerHTML = fs.length ? fs.map(f => `<button type="button" class="eb-chip" data-ins="${esc(f)}" title="Add [${esc(f)}] at the cursor">[${esc(f)}]</button>`).join("")
      : `<span class="muted" style="font-size:12px">none yet –</span>`;
  };
  let chipTimer = null;
  const drawChipsSoon = () => { clearTimeout(chipTimer); chipTimer = setTimeout(drawChips, 300); };
  drawChips();
  subjBox.addEventListener("input", drawChipsSoon);
  editor.addEventListener("input", drawChipsSoon);
  const insertField = text => {
    if (lastBox === subjBox) {
      const a = subjBox.selectionStart ?? subjBox.value.length, z = subjBox.selectionEnd ?? subjBox.value.length;
      subjBox.value = subjBox.value.slice(0, a) + text + subjBox.value.slice(z);
      subjBox.focus();
      subjBox.setSelectionRange(a + text.length, a + text.length);
    } else {
      useRange();
      document.execCommand("insertText", false, text);
      keepRange();
    }
    drawChipsSoon();
  };
  $("#ebFieldChips").onmousedown = e => e.preventDefault();
  $("#ebFieldChips").onclick = e => { const c = e.target.closest("[data-ins]"); if (c) insertField(`[${c.dataset.ins}]`); };
  $("#ebNewField").onmousedown = e => e.preventDefault();
  $("#ebNewField").onclick = () => openDialog(`<h3>New field</h3>
      <label class="field"><span>Field name (e.g. Voucher Code, Expiry Date)</span><input type="text" name="f" maxlength="60" required /></label>
      <p class="muted" style="margin:0;font-size:12px">It is added as [Field name] at the cursor, and becomes a column in the import template.</p>`,
    async form => {
      const f = form.f.value.replace(/[\[\]\n]/g, "").trim();
      if (!f) throw new Error("Type a name.");
      $("#dialog").close();
      insertField(`[${f}]`);
    }, "Add field");

  const bodyNow = () => editor.innerHTML;
  const saveTpl = async () => {
    const { batch } = await api("PUT", `/api/eb/${id}`, { title: $("#ebTitle").value, fromName: $("#ebFrom").value, subject: subjBox.value, bodyHtml: bodyNow() });
    return batch;
  };
  const saveRows = () => api("PUT", `/api/eb/${id}/recipients`, { rows: ebRows.filter(r => r.status !== "sent").map(r => ({ email: r.email, fields: r.fields })) });
  const tplChanged = () => subjBox.value !== ebCur.subject || bodyNow() !== ebCur.bodyHtml;
  $("#ebSaveTpl").onclick = async () => {
    try {
      await saveTpl();
      if (ebDirty) await saveRows();                       // keep what was typed in the customer table too
      toast(ebDirty ? "Template and customer list saved" : "Template saved"); renderEbBatch(id);
    } catch (ex) { tell(ex.message); }
  };
  $("#ebDocx").onchange = async e => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if ((ebCur.subject || ebCur.body) && !await ask("Replace the subject and email text with the Word template?")) return;
    try {
      await api("POST", `/api/eb/${id}/template?name=${encodeURIComponent(f.name)}`, f);
      toast("Word template imported");
      renderEbBatch(id);
    } catch (ex) { tell(ex.message); }
  };
  const importFile = async (f, mode) => {
    try {
      if (tplChanged()) await saveTpl();   // columns follow the saved template
      const r = await api("POST", `/api/eb/${id}/recipients/import?mode=${mode}&name=${encodeURIComponent(f.name)}`, f);
      let msg = `Imported ${r.imported} customer${r.imported === 1 ? "" : "s"}${r.foundIn ? ` – found in ${r.foundIn}` : ""}.`;
      if (r.noEmail) msg += `

${r.noEmail} customer(s) have no email address – type it in the table.`;
      if (r.missingColumns.length) msg += `\n\nNo column for: ${r.missingColumns.map(x => "[" + x + "]").join(", ")} – fill them in the table.`;
      if (r.unusedColumns.length) msg += `\n\nColumns not used (not in the template): ${r.unusedColumns.join(", ")}`;
      await tell(msg);
      renderEbBatch(id);
    } catch (ex) { tell(ex.message); }
  };
  $("#ebImport").onclick = async () => {
    if (tplChanged()) {                                   // the import template (.xlsx) has a column for every field
      try { const bt = await saveTpl(); ebCur.subject = bt.subject; ebCur.bodyHtml = bt.bodyHtml; ebCur.fields = bt.fields; }
      catch (ex) { tell(ex.message); return; }
    }
    const fields = ebCur.fields;
    openDialog(`
      <h3>📥 Import customers</h3>
      <ol class="eb-steps">
        <li>Download the import template – an Excel file with the right columns for this batch:
          <div style="margin:8px 0"><a class="btn btn-primary" href="/api/eb/${id}/import-template.xlsx" download>⬇ Download import template (.xlsx)</a></div>
          <div class="muted" style="font-size:12px">Columns: <strong>Email</strong>${fields.map(f => ` · <strong>${esc(f)}</strong>`).join("")}
            ${fields.length ? "" : " – save the template with [Fields] first"}</div></li>
        <li>Fill in one row per customer (first row = the headings, leave them as they are). Save it.</li>
        <li>Choose the file and press Import. <span class="muted" style="font-size:12px">(Excel .xlsx, CSV or Word .docx)</span></li>
      </ol>
      <div class="eb-word-note"><strong>📄 Details already in Word?</strong> Choose the Word (.docx) file – the system finds each
        customer's details by itself, using this template. The Word file can have:
        <ul><li>a table with the headings <strong>Email</strong>${fields.slice(0, 3).map(f => `, <strong>${esc(f)}</strong>`).join("")}${fields.length > 3 ? " …" : ""}, or</li>
          <li>lines like <code>Email : ali@example.com</code>, <code>${esc(fields[0] || "Name")} : …</code> for each customer, or</li>
          <li>the emails already written from this template, one per customer – what stands where the template has a
            <code>[Field]</code> is taken as that customer's value (the email address is taken from a line like <code>To: ali@example.com</code>).</li></ul></div>
      <label class="field"><span>File</span><input type="file" name="file" accept=".xlsx,.xlsm,.csv,.docx" required /></label>
      ${ebRows.length ? `<div class="field"><span>The list already has ${ebRows.length} customer(s)</span>
        <label class="check-line" style="font-weight:500"><input type="radio" name="mode" value="replace" checked /> Replace the list with the file</label>
        <label class="check-line" style="font-weight:500;margin-top:4px"><input type="radio" name="mode" value="append" /> Add the file's customers to the list</label></div>` : ""}`,
    async form => {
      const f = form.file.files[0];
      if (!f) throw new Error("Choose the Excel / CSV / Word file first.");
      $("#dialog").close();
      await importFile(f, form.mode ? form.mode.value : "replace");
    }, "Import");
  };
  $("#ebAddRow").onclick = () => {
    ebRows.push({ email: "", fields: {}, status: "pending", problems: [] });
    ebFind.q = ebFind.st = "";                                   // show the new row
    if ($("#ebFind")) { $("#ebFind").value = ""; $("#ebFindSt").value = ""; }
    markDirty(); drawEbRows(edit); drawEbWho();
    document.querySelector(`#ebBodyRows [data-r="${ebRows.length - 1}"]`)?.focus();
  };
  $("#ebSaveRows").onclick = async () => {
    try {
      const tpl = tplChanged();
      if (tpl) await saveTpl();                            // new fields in the template become saved columns
      await saveRows();
      toast(tpl ? "Template and customer list saved" : "Customer list saved"); renderEbBatch(id);
    } catch (ex) { tell(ex.message); }
  };
}

// New logins: their first passwords, shown ONCE (copy / download / print, then give each person theirs)
function showLoginPasswords(list, note = "") {
  const csv = "Username,Name,Outlet,First password\r\n" + list.map(x => [x.username, x.name, x.outlet || "", x.password]
    .map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  return new Promise(res => {
    openDialog(`<h3>👤 ${list.length} login${list.length > 1 ? "s" : ""} created</h3>
      <p class="pw-warn">${new Set(list.map(x => x.password)).size === 1
        ? `First password for ${list.length > 1 ? "all of them" : "this login"}: <strong>${esc(list[0].password)}</strong>.`
        : `⚠ These first passwords are shown <strong>only now</strong> – give each person their own.`}
        Everyone must choose a new password at the first sign-in. No access yet – give it in Settings › Access Control.</p>
      <div class="table-wrap pw-table"><table><thead><tr><th>Username</th><th>Name</th><th>Outlet</th><th>First password</th></tr></thead>
        <tbody>${list.map(x => `<tr style="cursor:default"><td><strong>${esc(x.username)}</strong></td><td>${esc(x.name)}</td><td>${esc(x.outlet || "")}</td>
          <td><code class="pw-code">${esc(x.password)}</code></td></tr>`).join("")}</tbody></table></div>
      ${note ? `<p class="muted" style="font-size:12px">${esc(note)}</p>` : ""}
      <div class="pw-btns"><button type="button" class="btn btn-sm" id="pwCopy">📋 Copy all</button>
        <button type="button" class="btn btn-sm" id="pwCsv">⬇ Download (.csv)</button>
        <button type="button" class="btn btn-sm" id="pwPrint">🖨 Print</button></div>`, async () => { $("#dialog").close(); }, "Done");
    const dlg = $("#dialog");
    dlg.addEventListener("close", () => res(), { once: true });
    $("#pwCopy").onclick = async () => toast(await copyText(list.map(x => `${x.username}\t${x.name}\t${x.password}`).join("\n")) ? "Copied" : "Could not copy");
    $("#pwCsv").onclick = () => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
      a.download = `New logins ${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    };
    $("#pwPrint").onclick = () => {
      const w = window.open("", "_blank");
      w.document.write(`<title>New logins</title><style>body{font-family:Segoe UI,Arial;padding:20px}td,th{border:1px solid #999;padding:6px 10px;text-align:left}
        table{border-collapse:collapse}.slip{page-break-inside:avoid}</style><h3>Company Portal – new logins</h3>
        <p>Sign in with this password, then choose your own (at least 10 characters with letters and numbers).</p>
        <table><tr><th>Username</th><th>Name</th><th>Outlet</th><th>First password</th></tr>${list.map(x =>
          `<tr class="slip"><td>${esc(x.username)}</td><td>${esc(x.name)}</td><td>${esc(x.outlet || "")}</td><td><b>${esc(x.password)}</b></td></tr>`).join("")}</table>`);
      w.document.close(); w.print();
    };
  });
}

// ---------------- HR Dept: Staff Master Data (BR, Staff Code, Staff Name, Position, Email, Joined Date, Resigned Date)
let hrFind = { q: "", outlet: "", role: "", st: "active" };
let hrSel = new Set();                                          // ticked staff (batch actions)
let hrSort = { key: "staffId", dir: 1 };                        // click a column heading: 1 = A→Z, -1 = Z→A
const HR_COLS = [["outletCode", "BR"], ["staffId", "Staff Code"], ["fullName", "Staff Name"], ["icNo", "IC No."], ["role", "Position"],
  ["coverBranches", "Coverage Branch"], ["email", "Email"],
  ["joinedDate", "Joined Date"], ["resignedDate", "Resigned Date"], ["hasLogin", "Login"], ["updatedAt", "Last updated"]];
async function renderHrStaff() {
  let data;
  try { data = await api("GET", "/api/hr/staff"); } catch (ex) { toast(ex.message); location.replace("#/"); return; }
  const list = data.staff, edit = data.canEdit, isHR = data.isHR !== false, cover = data.coverage;
  const uniq = k => [...new Set(list.map(s => s[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const outlets = uniq("outletCode"), roles = uniq("role");
  const setRoles = data.roles || [], setOutlets = data.outlets || [];            // HR Setting lists
  const outletName = Object.fromEntries(setOutlets.map(o => [o.code, o.name]));
  const roleKnown = r => !setRoles.length || setRoles.some(x => x.toLowerCase() === (r || "").toLowerCase());
  const outletKnown = c => !setOutlets.length || c in outletName;
  const pickRoles = [...new Set([...setRoles, ...roles])];
  const pickOutlets = data.coverage?.branches?.length ? data.coverage.branches : [...new Set([...setOutlets.map(o => o.code), ...outlets])];
  const canSel = (edit && isHR) || data.canCreateLogin;
  const newcomers = list.filter(s => s.active && !s.hasLogin);         // active staff without a login yet
  hrSel = new Set([...hrSel].filter(id => list.some(s => s.id === id)));
  let shown = [];
  const noEmail = list.filter(s => s.active && !s.email).length, badEmail = list.filter(s => s.active && !s.emailOk).length;
  const nActive = list.filter(s => s.active).length;
  $("#app").innerHTML = `
    <div class="page-head">
      <div><h1>Staff Master Data</h1>
        <div class="sub">${isHR ? "HR Dept · BR, Staff Code, Staff Name, Position, Coverage, Email, Joined Date and Resigned Date of every staff."
          : "The staff of your coverage – you can add and edit them."}</div></div>
      <div class="actions">
        ${edit && isHR ? `<button class="btn" id="hrImport">📥 Import Excel</button>` : ""}
        ${list.length ? `<a class="btn" href="/api/hr/staff.xlsx" download>⬇ Export Excel</a>` : ""}
        ${edit ? `<button class="btn btn-primary" id="hrAdd">+ Add staff</button>` : ""}
      </div>
    </div>
    ${cover ? `<div class="memo-wait">🗺 <strong>Your coverage</strong> –
      Branch: <strong>${cover.branches.map(b => esc(b + (outletName[b] ? " " + outletName[b] : ""))).join(", ")}</strong>.
      You see and manage only the staff of these branches; HR sets the coverage.</div>` : ""}
    <div class="stats">
      <div class="stat"><div class="n">${nActive}</div><div class="l">Active staff</div></div>
      <div class="stat"><div class="n">${list.length - nActive}</div><div class="l">Resigned</div></div>
      <div class="stat"><div class="n">${outlets.length}</div><div class="l">BR (outlets)</div></div>
      <div class="stat"><div class="n" style="${noEmail + badEmail ? "color:var(--bad)" : ""}">${noEmail + badEmail}</div><div class="l">No / wrong email</div></div>
    </div>
    <div class="card">
      <div class="toolbar hr-toolbar">
        <input type="search" id="hrQ" placeholder="🔍 Search staff code, name, email…" value="${esc(hrFind.q)}" />
        <select id="hrSt">${[["active", "Active staff"], ["resigned", "Resigned"], ["", "All staff"]].map(([v, l]) =>
          `<option value="${v}" ${hrFind.st === v ? "selected" : ""}>${l}</option>`).join("")}</select>
        <select id="hrOutlet"><option value="">All BR</option>${outlets.map(o => `<option value="${esc(o)}" ${o === hrFind.outlet ? "selected" : ""}>${esc(o)}${outletName[o] ? " – " + esc(outletName[o]) : ""}</option>`).join("")}</select>
        <select id="hrRole"><option value="">All positions</option>${roles.map(o => `<option ${o === hrFind.role ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>
        <span class="muted" id="hrCount" style="font-size:12px"></span>
        ${data.canCreateLogin && newcomers.length ? `<button class="btn btn-sm hr-new" id="hrNewcomers" title="Tick every active staff shown who has no login yet (follows the search and filters)">✨ Select newcomers (${newcomers.length})</button>` : ""}
      </div>
      <div class="hr-batch" id="hrBatch" hidden>
        <strong id="hrSelN"></strong>
        ${data.canCreateLogin ? `<button class="btn btn-sm btn-primary" id="hrBLogin">👤 Create logins</button>` : ""}
        ${edit ? `<button class="btn btn-sm" id="hrBUpd">✎ Update selected</button>` : ""}
        <button class="btn btn-sm" id="hrBClear">Clear selection</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>${canSel ? `<th class="hr-selcol"><input type="checkbox" id="hrAll" title="Tick all staff shown" /></th>` : ""}${HR_COLS.map(([k, l]) => `<th class="sortable" data-sort="${k}" title="Sort by ${l}">${l}<span class="sort-arrow"></span></th>`).join("")}${edit ? "<th></th>" : ""}</tr></thead>
        <tbody id="hrRows"></tbody>
      </table></div>
    </div>`;
  const draw = () => {
    const words = hrFind.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = list.filter(s => (!hrFind.outlet || s.outletCode === hrFind.outlet) && (!hrFind.role || s.role === hrFind.role)
      && (!hrFind.st || (hrFind.st === "active") === s.active)
      && words.every(w => [s.staffId, s.fullName, s.role, s.email, s.outletCode, outletName[s.outletCode], s.coverBranches].join(" ").toLowerCase().includes(w)));
    const { key, dir } = hrSort, empty = v => v === "" || v == null;
    rows.sort((a, b) => {                                       // empty values always last; numbers in codes sort as numbers (2 < 10)
      const x = a[key], y = b[key];
      if (empty(x) !== empty(y)) return empty(x) ? 1 : -1;
      const c = typeof x === "string" ? x.localeCompare(y, undefined, { numeric: true, sensitivity: "base" }) : (x > y) - (x < y);
      return c * dir || a.staffId.localeCompare(b.staffId, undefined, { numeric: true });
    });
    document.querySelectorAll("th[data-sort]").forEach(th => {
      const on = th.dataset.sort === key;
      th.classList.toggle("sorted", on);
      th.querySelector(".sort-arrow").textContent = on ? (dir === 1 ? " ▲" : " ▼") : "";
    });
    $("#hrCount").textContent = rows.length === list.length ? `${list.length} staff` : `${rows.length} of ${list.length} shown`;
    shown = rows.map(s => s.id);
    const vis = new Set(shown);
    hrSel = new Set([...hrSel].filter(id => vis.has(id)));     // only staff shown on screen stay selected
    $("#hrRows").innerHTML = rows.length ? rows.map(s => `
      <tr data-hr="${s.id}" style="${edit ? "" : "cursor:default"}" class="${s.active ? "" : "hr-resigned"}${hrSel.has(s.id) ? " hr-picked" : ""}">
        ${canSel ? `<td class="hr-selcol"><input type="checkbox" data-sel="${s.id}" ${hrSel.has(s.id) ? "checked" : ""} /></td>` : ""}
        <td>${s.outletCode ? (outletKnown(s.outletCode) ? `<span class="badge draft">${esc(s.outletCode)}</span>${outletName[s.outletCode] ? `<div class="muted" style="font-size:11px">${esc(outletName[s.outletCode])}</div>` : ""}`
          : `<span class="badge review" title="Not in the Outlet list (Settings › HR Setting)">⚠ ${esc(s.outletCode)}</span>`) : "—"}</td>
        <td><strong>${esc(s.staffId)}</strong></td><td>${esc(s.fullName || "—")}</td><td style="white-space:nowrap">${esc(s.icNo || "—")}</td>
        <td>${s.role ? (roleKnown(s.role) ? esc(s.role) : `<span style="color:#b45309" title="Not in the Position list (Settings › HR Setting)">⚠ ${esc(s.role)}</span>`) : "—"}</td>
        <td class="hr-cover">${s.coverBranches ? esc(s.coverBranches) : `<span class="muted">—</span>`}</td>
        <td>${s.email ? (s.emailOk ? esc(s.email) : `<span style="color:var(--bad)" title="Not a valid email address">⚠ ${esc(s.email)}</span>`) : `<span class="muted">—</span>`}</td>
        <td style="white-space:nowrap">${s.joinedDate ? fmtDate(s.joinedDate) : "—"}</td>
        <td style="white-space:nowrap">${s.resignedDate ? `${fmtDate(s.resignedDate)}${s.active ? `<div class="muted" style="font-size:11px">leaving</div>` : `<div><span class="badge rejected">Resigned</span></div>`}` : "—"}</td>
        <td style="white-space:nowrap">${s.hasLogin ? `<span class="badge approved" title="A system login with username ${esc(s.staffId)} exists">✓ Yes</span>`
          : data.canCreateLogin && s.active ? `<button class="btn btn-sm" data-login="${s.id}" title="Make a system login for this staff">👤 Create login</button>`
          : `<span class="muted">—</span>`}</td>
        <td class="muted" style="font-size:12px">${esc(s.updatedBy)}<br>${s.updatedAt ? fmtTime(s.updatedAt) : ""}</td>
        ${edit ? `<td style="white-space:nowrap"><button class="btn btn-sm" data-edit="${s.id}">✎ Edit</button>
          ${isHR ? `<button class="btn btn-sm" data-del="${s.id}" title="Remove">✕</button>` : ""}</td>` : ""}
      </tr>`).join("")
      : `<tr><td colspan="13" class="empty">${list.length ? "No staff matches the search." : "No staff yet." + (edit ? " Click <strong>📥 Import Excel</strong> or <strong>+ Add staff</strong>." : "")}</td></tr>`;
  };
  const drawSel = () => {
    if (!canSel) return;
    $("#hrBatch").hidden = !hrSel.size;
    $("#hrSelN").textContent = `${hrSel.size} staff selected`;
    const nb = $("#hrNewcomers");
    if (nb) {                                                   // newcomers among the staff shown (follows the filters)
      const vis = new Set(shown), n = newcomers.filter(s => vis.has(s.id)).length;
      nb.hidden = !n;
      nb.textContent = `✨ Select newcomers (${n})`;
    }
    const all = $("#hrAll");
    all.checked = shown.length > 0 && shown.every(id => hrSel.has(id));
    all.indeterminate = !all.checked && shown.some(id => hrSel.has(id));
  };
  const redraw = () => { draw(); drawSel(); };
  redraw();
  $("#hrRows").closest("table").querySelector("thead").onclick = e => {   // click a heading: sort; click again: reverse
    const th = e.target.closest("th[data-sort]");
    if (!th) return;
    hrSort = hrSort.key === th.dataset.sort ? { key: hrSort.key, dir: -hrSort.dir } : { key: th.dataset.sort, dir: 1 };
    redraw();
  };
  if (canSel) {
    $("#hrAll").onchange = e => { shown.forEach(id => e.target.checked ? hrSel.add(id) : hrSel.delete(id)); redraw(); };
    $("#hrRows").addEventListener("click", e => {                // tick box: select only (not "edit staff")
      const cell = e.target.closest(".hr-selcol");
      if (!cell) return;
      e.stopImmediatePropagation();
      const box = cell.querySelector("[data-sel]");
      if (e.target !== box) box.checked = !box.checked;
      box.checked ? hrSel.add(box.dataset.sel) : hrSel.delete(box.dataset.sel);
      box.closest("tr").classList.toggle("hr-picked", box.checked);
      drawSel();
    }, true);
    $("#hrBClear").onclick = () => { hrSel.clear(); redraw(); };
  }
  if ($("#hrNewcomers")) $("#hrNewcomers").onclick = () => {
    const vis = new Set(shown), pick = newcomers.filter(s => vis.has(s.id));   // only within the current search / filters
    hrSel = new Set(pick.map(s => s.id));
    redraw();
    toast(`${pick.length} newcomer(s) selected – press "Create logins"`);
    $("#hrBatch").scrollIntoView({ block: "center", behavior: "smooth" });
  };
  if ($("#hrBLogin")) $("#hrBLogin").onclick = async () => {
    const pick = list.filter(s => hrSel.has(s.id));
    const ok = pick.filter(s => s.active && !s.hasLogin), no = pick.length - ok.length;
    if (!ok.length) { tell("None of the selected staff can get a new login – they already have one or have resigned."); return; }
    if (!await ask(`Create logins for ${ok.length} staff?${no ? ` (${no} selected already have a login or have resigned – they are skipped.)` : ""}\n\n`
      + `• Username = Staff Code, Name = Staff Name, Position linked\n• Password: ${data.defaultPassword} (must be changed at the first sign-in)\n`
      + `• Access: none – give it later in Settings › Access Control`, `Create ${ok.length} login${ok.length > 1 ? "s" : ""}`)) return;
    toast("Creating logins… (a few seconds for many staff)");
    try {
      const r = await api("POST", "/api/hr/logins", { ids: ok.map(s => s.id) });
      hrSel.clear();
      const notes = r.skipped.length ? `Not created (${r.skipped.length}): ` + r.skipped.slice(0, 10).map(x => x.reason).join(" · ") : "";
      if (r.created.length) await showLoginPasswords(r.created, notes); else await tell(notes || "No login was created.");
      renderHrStaff();
    } catch (ex) { tell(ex.message); }
  };
  if ($("#hrBUpd")) $("#hrBUpd").onclick = () => {
    const n = hrSel.size;
    openDialog(`<h3>✎ Update ${n} selected staff</h3>
      <p class="muted" style="margin:0 0 8px;font-size:12px">Tick what to change – it is set the same for all ${n} staff. Everything not ticked stays as it is.</p>
      <div class="hr-bulk">
        <label class="check-line"><input type="checkbox" name="cOutlet" /> <span>BR</span></label>
        <input type="text" name="outletCode" list="hrBOutlets" style="text-transform:uppercase" placeholder="e.g. KL01" />
        <label class="check-line"><input type="checkbox" name="cRole" /> <span>Position</span></label>
        <input type="text" name="role" list="hrBRoles" placeholder="e.g. Cashier" />
        <label class="check-line"><input type="checkbox" name="cJoined" /> <span>Joined Date</span></label>
        <input type="date" name="joinedDate" />
        <label class="check-line"><input type="checkbox" name="cResigned" /> <span>Resigned Date</span></label>
        <div><input type="date" name="resignedDate" /><div class="muted" style="font-size:11px">empty = not resigned (clears the date)</div></div>
      </div>
      <datalist id="hrBRoles">${pickRoles.map(r => `<option value="${esc(r)}">`).join("")}</datalist>
      <datalist id="hrBOutlets">${pickOutlets.map(r => `<option value="${esc(r)}">${esc(outletName[r] || "")}</option>`).join("")}</datalist>`,
      async form => {
        const set = {};
        if (form.cOutlet.checked) set.outletCode = form.outletCode.value;
        if (form.cRole.checked) set.role = form.role.value;
        if (form.cJoined.checked) set.joinedDate = form.joinedDate.value;
        if (form.cResigned.checked) set.resignedDate = form.resignedDate.value;
        if (!Object.keys(set).length) throw new Error("Tick at least one thing to change.");
        const r = await api("POST", "/api/hr/staff/bulk", { ids: [...hrSel], set });
        $("#dialog").close();
        toast(`${r.changed} staff updated${r.unchanged ? `, ${r.unchanged} already had it` : ""}`);
        hrSel.clear();
        renderHrStaff();
      }, "Update");
    const dlg = $("#dialog");                                    // typing a value ticks its box
    [["outletCode", "cOutlet"], ["role", "cRole"], ["joinedDate", "cJoined"], ["resignedDate", "cResigned"]].forEach(([f, c]) =>
      dlg.querySelector(`[name="${f}"]`).addEventListener("input", () => { dlg.querySelector(`[name="${c}"]`).checked = true; }));
  };
  $("#hrQ").oninput = e => { hrFind.q = e.target.value; redraw(); };
  $("#hrOutlet").onchange = e => { hrFind.outlet = e.target.value; redraw(); };
  $("#hrRole").onchange = e => { hrFind.role = e.target.value; redraw(); };
  $("#hrSt").onchange = e => { hrFind.st = e.target.value; redraw(); };
  // one click: a system login for a staff (Super Admin) - no access until it is given in Access Control
  $("#hrRows").addEventListener("click", async e => {
    const b = e.target.closest("[data-login]");
    if (!b) return;
    e.stopImmediatePropagation();                              // not the "edit staff" click of the row
    const s = list.find(x => x.id === b.dataset.login);
    if (!await ask(`Create a login for ${s.staffId}${s.fullName ? " – " + s.fullName : ""}?

• Username: ${s.staffId}
• Name: ${s.fullName || s.staffId}`
      + `
• Position: ${s.role || "—"}
• Password: ${data.defaultPassword} (must be changed at the first sign-in)
• Access: none – give it later in Settings › Access Control`, "Create login")) return;
    try {
      const r = await api("POST", `/api/hr/staff/${s.id}/login`, {});
      await showLoginPasswords([{ username: r.user.username, name: r.user.name, outlet: s.outletCode, password: r.password }],
        r.position ? `Position "${r.position}" is linked – press Apply in Settings › Access Control to give its rights.` : "");
      renderHrStaff();
    } catch (ex) { tell(ex.message); }
  }, true);
  if (!edit) return;

  const staffDialog = s => openDialog(`<h3>${s ? "Edit staff" : "Add staff"}</h3>
      <div class="hr-form">
        <label class="field"><span>BR (Outlet Code)</span><input type="text" name="outletCode" maxlength="200" list="hrOutlets" value="${esc(s?.outletCode || "")}" style="text-transform:uppercase" /></label>
        <label class="field"><span>Staff Code <b class="req">*</b></span><input type="text" name="staffId" maxlength="200" required value="${esc(s?.staffId || "")}" /></label>
        <label class="field"><span>Staff Name</span><input type="text" name="fullName" maxlength="200" value="${esc(s?.fullName || "")}" /></label>
        <label class="field"><span>IC No.</span><input type="text" name="icNo" maxlength="40" value="${esc(s?.icNo || "")}" placeholder="e.g. 900101-10-1234" /></label>
        <label class="field"><span>Position</span><input type="text" name="role" maxlength="200" list="hrRoles" value="${esc(s?.role || "")}" /></label>
        <label class="field" style="grid-column:1/-1"><span>Email</span><input type="email" name="email" maxlength="200" value="${esc(s?.email || "")}" /></label>
        <label class="field"><span>Joined Date</span><input type="date" name="joinedDate" value="${esc(s?.joinedDate || "")}" /></label>
        <label class="field"><span>Resigned Date</span><input type="date" name="resignedDate" value="${esc(s?.resignedDate || "")}" /></label>
      </div>
      ${isHR ? coverPicker(s) : ""}
      <datalist id="hrRoles">${pickRoles.map(r => `<option value="${esc(r)}">`).join("")}</datalist>
      <datalist id="hrOutlets">${pickOutlets.map(r => `<option value="${esc(r)}">${esc(outletName[r] || "")}</option>`).join("")}</datalist>
      ${setRoles.length || setOutlets.length ? `<p class="muted" style="margin:0;font-size:12px">Positions and BR come from Settings › HR Setting – click the box to choose. Leave Resigned Date empty while the staff is working.</p>` : ""}`,
    async form => {
      const body = { staffId: form.staffId.value, fullName: form.fullName.value, role: form.role.value, email: form.email.value, outletCode: form.outletCode.value,
        joinedDate: form.joinedDate.value, resignedDate: form.resignedDate.value, icNo: form.icNo.value };
      if (isHR) {
        body.coverBranches = [...form.querySelectorAll('[data-cov="b"]:checked')].map(x => x.value).join(", ");
      }
      if (s) await api("PUT", `/api/hr/staff/${s.id}`, body); else await api("POST", "/api/hr/staff", body);
      $("#dialog").close();
      toast(s ? "Staff saved" : "Staff added");
      renderHrStaff();
    }, s ? "Save" : "Add");
  // Coverage Branch (HR only): the outlets whose staff this person manages
  const coverPicker = st => {
    const has = (txt, v) => (txt || "").split(",").map(x => x.trim().toLowerCase()).includes(String(v).toLowerCase());
    const bl = [...new Set([...setOutlets.map(o => o.code), ...(st?.coverBranches || "").split(",").map(x => x.trim()).filter(Boolean)])];
    const nb = bl.filter(b => has(st?.coverBranches, b)).length;
    return `<details class="hr-cov" ${nb ? "open" : ""}><summary>🗺 Coverage Branch – for managers <span class="muted" id="covN">(${nb} branch)</span></summary>
      <p class="muted" style="margin:4px 0 8px;font-size:12px">This person (e.g. Operation Manager, Branch / Area Manager) will see and manage the staff of the ticked branches in Staff Master Data. Leave empty for normal staff.</p>
      <div class="hr-cov-h"><strong>Coverage Branch</strong><input type="search" id="covQ" placeholder="Search outlet / state…" />
        <button type="button" class="btn btn-sm" id="covAll">Tick shown</button><button type="button" class="btn btn-sm" id="covNone">Clear</button></div>
      <div class="mm-checks scroll" id="covB">${bl.map(b => { const o = setOutlets.find(x => x.code === b) || {};
        return `<label class="mm-check"><input type="checkbox" data-cov="b" value="${esc(b)}" ${has(st?.coverBranches, b) ? "checked" : ""} /> <span>${esc(b)}${o.name ? " – " + esc(o.name) : ""}${o.state ? ` <span class="muted">(${esc(o.state)})</span>` : ""}</span></label>`; }).join("")
        || `<span class="muted">No outlets in Settings › HR Setting yet.</span>`}</div></details>`;
  };
  const wireCover = () => {
    const dlg = $("#dialog"), q = dlg.querySelector("#covQ");
    if (!q) return;
    const count = () => { dlg.querySelector("#covN").textContent = `(${dlg.querySelectorAll('[data-cov="b"]:checked').length} branch)`; };
    q.oninput = () => dlg.querySelectorAll('[data-cov="b"]').forEach(x => { const l = x.closest(".mm-check"); l.hidden = !l.textContent.toLowerCase().includes(q.value.toLowerCase()); });
    dlg.querySelector("#covAll").onclick = () => { dlg.querySelectorAll('[data-cov="b"]').forEach(x => { if (!x.closest(".mm-check").hidden) x.checked = true; }); count(); };
    dlg.querySelector("#covNone").onclick = () => { dlg.querySelectorAll('[data-cov="b"]').forEach(x => { x.checked = false; }); count(); };
    dlg.querySelector(".hr-cov").addEventListener("change", count);
  };
  $("#hrAdd").onclick = () => { staffDialog(null); wireCover(); };
  $("#hrRows").onclick = async e => {
    const d = e.target.closest("[data-del]"), tr = e.target.closest("[data-hr]");
    if (d) {
      const s = list.find(x => x.id === d.dataset.del);
      if (!await ask(`Remove ${s.staffId}${s.fullName ? " – " + s.fullName : ""} from the staff list?\n\nIt is kept in the audit trail and comes back if it is imported or added again.`, "Remove")) return;
      try { await api("POST", `/api/hr/staff/${s.id}/remove`, {}); toast("Staff removed"); renderHrStaff(); } catch (ex) { tell(ex.message); }
      return;
    }
    if (tr) { staffDialog(list.find(x => x.id === tr.dataset.hr)); wireCover(); }
  };
  $("#hrImport").onclick = () => openDialog(`
      <h3>📥 Import staff from Excel</h3>
      <ol class="eb-steps">
        <li>Download the import template, or use your own Excel file:
          <div style="margin:8px 0"><a class="btn btn-primary" href="/api/hr/import-template.xlsx" download>⬇ Download import template (.xlsx)</a></div>
          <div class="muted" style="font-size:12px">Columns taken: <strong>BR</strong> · <strong>Staff Code</strong> · <strong>Staff Name</strong> · <strong>IC No.</strong> ·
            <strong>Position</strong> · <strong>Email</strong> · <strong>Joined Date</strong> · <strong>Resigned Date</strong> · <strong>Coverage Branch</strong>
            – any other column is ignored, and a column that is not in the file is left as it is (e.g. a file without Email keeps the emails).
            The heading row must be the first row. Dates like 30/09/2026, 2026-09-30, 30-Sep-26 or Excel dates are all fine.</div>
          <div class="hr-imp-cov">🗺 <strong>Coverage Branch</strong> (managers): the outlets whose staff this person looks after, separated by commas –
            e.g. <code>E01, E04, F02</code>. Leave it empty for normal staff. To set only the coverage, a file with just
            <strong>Staff Code</strong> + <strong>Coverage Branch</strong> is enough – everything else stays as it is.
            An empty Coverage Branch cell clears the coverage of that staff.</div></li>
        <li>One row per staff. A Staff Code already in the list is <strong>updated</strong>, a new one is <strong>added</strong>.</li>
        <li>Choose the file and press Import. <span class="muted" style="font-size:12px">(Excel .xlsx or CSV)</span></li>
      </ol>
      <label class="field"><span>File</span><input type="file" name="file" accept=".xlsx,.xlsm,.csv" required /></label>
      ${list.length ? `<label class="check-line" style="font-weight:500;align-items:flex-start"><input type="checkbox" name="sync" style="margin-top:3px" />
        <span>Also remove staff who are <strong>not</strong> in this file<br><span class="muted" style="font-size:12px;font-weight:400">Use this when the file is the full, up-to-date staff list.</span></span></label>` : ""}`,
    async form => {
      const f = form.file.files[0];
      if (!f) throw new Error("Choose the Excel / CSV file first.");
      if (form.sync?.checked && !await ask("Staff who are not in the file will be removed from the list. Continue?", "Import")) return;
      $("#dialog").close();
      try {
        const r = await api("POST", `/api/hr/import?mode=${form.sync?.checked ? "sync" : "add"}&name=${encodeURIComponent(f.name)}`, f);
        let msg = `Import finished:\n• ${r.added} added\n• ${r.updated} updated\n• ${r.unchanged} unchanged` + (r.removed ? `\n• ${r.removed} removed` : "");
        if (r.skipped.length) msg += `\n\nSkipped / note (${r.skipped.length}):\n` + r.skipped.slice(0, 10).map(x => `• row ${x.row}: ${x.reason}`).join("\n") + (r.skipped.length > 10 ? "\n• …" : "");
        if (r.badEmails.length) msg += `\n\nNot a valid email (${r.badEmails.length}) – shown in red, please correct: ${r.badEmails.slice(0, 5).join(", ")}${r.badEmails.length > 5 ? " …" : ""}`;
        if (r.unknownRoles?.length) msg += `\n\nPositions not in the Position list (HR Setting): ${r.unknownRoles.join(", ")}`;
        if (r.unknownOutlets?.length) msg += `\n\nOutlet Codes not in the Outlet list (HR Setting): ${r.unknownOutlets.join(", ")}`;
        if (r.missingColumns.length) msg += `\n\nColumn not in the file (left as it was): ${r.missingColumns.join(", ")}`;
        if (r.unusedColumns.length) msg += `\n\nColumns ignored: ${r.unusedColumns.join(", ")}`;
        await tell(msg);
      } catch (ex) { await tell(ex.message); }
      renderHrStaff();
    }, "Import");
}

// ---------------- HR Dept: Transfer Form (PRO-2603-011) - form, list, view, letter
const TR_TIME_LABELS = [["timeIn", "Time In"], ["timeOut", "Time Out"], ["lunchIn", "Lunch In"], ["lunchOut", "Lunch Out"], ["dinnerIn", "Dinner In"], ["dinnerOut", "Dinner Out"]];
const TR_STATUS = { drafted: ["Drafted", "trs-drafted"], submitted: ["Submitted", "trs-submitted"], processing: ["Processing", "trs-processing"], completed: ["Completed", "trs-completed"],
  checked: ["Checked", "trs-checked"], cancelled: ["Cancelled", "trs-cancelled"] };
const trBadge = st => { const [l, c] = TR_STATUS[st] || [st, ""]; return `<span class="mcs ${c}">${esc(l)}</span>`; };
const trType = t => t === "permanent" ? "Permanent" : "Temporary";
const t12 = v => { if (!v) return "—"; const [h, m] = v.split(":").map(Number); return `${String((h % 12) || 12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; };
let trFind = { status: "", doc: "", type: "", staff: "", name: "", outlet: "", page: 1 };

async function renderTrForm(id) {
  let ref, form = null;
  try {
    ref = await api("GET", "/api/tr/staff");
    if (id) { const d = await api("GET", `/api/tr/${id}`); form = d.form; if (!["drafted", "submitted"].includes(form.status)) { toast("HR is already processing this form – it cannot be changed now"); location.replace(`#/tr/${id}`); return; } }
  } catch (ex) { toast(ex.message); location.replace("#/tr"); return; }
  const LOGINS = ["Manager", "Asst. Manager", "Cashier", "Sales Asst."];
  const outlets = ref.outlets || [], hoursOf = code => (outlets.find(o => o.code === (code || "").toUpperCase()) || {}).hours || {};
  const staffOpts = `<datalist id="trStaffList">${ref.staff.map(x => `<option value="${esc(x.code)}">${esc(x.name)} · ${esc(x.outlet)}</option>`).join("")}</datalist>
    <datalist id="trOutletList">${outlets.map(o => `<option value="${esc(o.code)}">${esc(o.name)}</option>`).join("")}</datalist>
    <datalist id="trPosList">${(ref.positions || []).map(p => `<option value="${esc(p)}">`).join("")}</datalist>`;
  const trToday = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  // no backdating for the outlet (HR is not limited); a date already saved on the form may stay
  const trMin = v => me.trHR ? "" : `min="${v && v < trToday ? v : trToday}" title="Today or a later date – no backdating"`;
  let type = form?.type || "permanent";
  const perm = form?.type === "permanent" ? form.data : {};
  let lines = form?.type === "temporary" ? form.data.lines.map(x => ({ ...x })) : [{}];
  const timesHtml = (t, pre) => `<div class="tr-times">${TR_TIME_LABELS.map(([k, l]) => `<label class="field"><span>${l}</span>
      <input type="time" data-time="${k}" ${pre} value="${esc(t?.[k] || "")}" title="Filled in from the To outlet – can be changed" /></label>`).join("")}</div>`;
  const staffHtml = (x, i) => `
      <div class="tr-grid">
        <label class="field"><span>Staff ID <b class="req">*</b></span><input type="text" data-f="staffId" list="trStaffList" value="${esc(x.staffId || "")}" required placeholder="Staff ID" /></label>
        <label class="field"><span>Staff Name</span><input type="text" data-f="staffName" value="${esc(x.staffName || "")}" disabled placeholder="Auto after Staff ID" /></label>
        <label class="field"><span>IC No.</span><input type="text" data-f="icNo" value="${esc(x.icNo || "")}" disabled placeholder="Auto after Staff ID" /></label>
        <label class="field"><span>Outlet</span><input type="text" data-f="outlet" value="${esc(x.outlet || "")}" disabled placeholder="Auto after Staff ID" /></label>
      </div>`;
  const lineHtml = (x, i) => `<div class="tr-line" data-line="${i}">
      <div class="tr-line-head"><strong>Staff ${i + 1}</strong>${lines.length > 1 ? `<button type="button" class="btn btn-sm" data-rmline="${i}">✕ Remove</button>` : ""}</div>
      ${staffHtml(x, i)}
      <div class="tr-grid">
        <label class="field"><span>From Date <b class="req">*</b></span><input type="date" data-f="fromDate" value="${esc(x.fromDate || "")}" ${trMin(x.fromDate)} required /></label>
        <label class="field"><span>To Date <b class="req">*</b></span><input type="date" data-f="toDate" value="${esc(x.toDate || "")}" ${trMin(x.toDate)} required /></label>
      </div>
      <div class="field"><span>Transfer Outlet</span><div class="tr-fromto"><span>From</span><input type="text" data-f="outletFrom" list="trOutletList" value="${esc(x.outletFrom || "")}" />
        <span>To <b class="req">*</b></span><input type="text" data-f="outletTo" list="trOutletList" value="${esc(x.outletTo || "")}" required /></div></div>
      ${timesHtml(x.times, `data-l="${i}"`)}
      <div class="field"><span>Request For ID Login SBClient System</span><div class="tr-logins">${LOGINS.map(v =>
        `<label class="check-line"><input type="checkbox" data-login="${esc(v)}" ${(x.idLogin || []).includes(v) ? "checked" : ""} /> <span>${esc(v)}</span></label>`).join("")}</div></div>
      <label class="field"><span>Remarks</span><input type="text" data-f="remarks" maxlength="1000" value="${esc(x.remarks || "")}" /></label>
    </div>`;
  $("#app").innerHTML = `
    <div class="page-head"><div>${id ? `<a href="#/tr/${id}" style="text-decoration:none;font-weight:600">← ${esc(form.docNo)}</a>` : ""}
      <h1 style="margin-top:6px">Transfer Form${id ? " – edit" : ""}</h1>
      <div class="sub">Department / position change or outlet transfer. Save keeps it as Drafted; Submit finishes it and opens the letter to print and sign.</div></div></div>
    <form class="card mc-form" id="trForm" autocomplete="off">
      <div class="card-head"><h2>General</h2></div>
      <div class="card-body tr-grid">
        <label class="field"><span>Document ID</span><input type="text" value="${esc(form?.docNo || "TRF-yymm-### (auto)")}" disabled /></label>
        <label class="field"><span>Type <b class="req">*</b></span><select id="trType" ${id ? "disabled" : ""}>
          <option value="permanent" ${type === "permanent" ? "selected" : ""}>Permanent</option><option value="temporary" ${type === "temporary" ? "selected" : ""}>Temporary</option></select></label>
      </div>
      <div class="card-head"><h2 id="trSecTitle"></h2></div>
      <div class="card-body" id="trBody"></div>
      <div class="card-body mc-actions" style="border-top:1px solid var(--line)">
        <a class="btn" href="${id ? `#/tr/${id}` : "#/tr"}">✕</a>
        <button type="button" class="btn btn-primary" id="trSave">Save</button>
        <button type="submit" class="btn btn-success" id="trSubmit">Submit</button>
      </div>
    </form>${staffOpts}`;
  const body = $("#trBody");
  const drawBody = () => {
    $("#trSecTitle").textContent = type === "permanent" ? "Permanent Transfer" : "Temporary Transfer";
    body.innerHTML = type === "permanent" ? `
      <div data-line="p">${staffHtml(perm, 0)}
      <div class="tr-grid"><label class="field"><span>Effective From Date <b class="req">*</b></span><input type="date" data-f="effectiveDate" value="${esc(perm.effectiveDate || "")}" ${trMin(perm.effectiveDate)} required /></label></div>
      <div class="field"><span>Department / Position Change</span><div class="tr-fromto"><span>From</span><input type="text" data-f="posFrom" list="trPosList" value="${esc(perm.posFrom || "")}" />
        <span>To</span><input type="text" data-f="posTo" list="trPosList" value="${esc(perm.posTo || "")}" /></div></div>
      <div class="field"><span>Transfer Outlet</span><div class="tr-fromto"><span>From</span><input type="text" data-f="outletFrom" list="trOutletList" value="${esc(perm.outletFrom || "")}" />
        <span>To</span><input type="text" data-f="outletTo" list="trOutletList" value="${esc(perm.outletTo || "")}" /></div></div>
      ${timesHtml(perm.times, 'data-l="p"')}
      <label class="field"><span>Remarks</span><input type="text" data-f="remarks" maxlength="1000" value="${esc(perm.remarks || "")}" /></label></div>`
      : lines.map(lineHtml).join("") + `<div style="text-align:center;margin-top:10px"><button type="button" class="btn btn-primary btn-sm" id="trAdd">+ Add staff</button></div>`;
    if ($("#trAdd")) $("#trAdd").onclick = () => { collect(); lines.push({}); drawBody(); };
  };
  const box = el => el.closest("[data-line]");
  const val = (b, f) => b.querySelector(`[data-f="${f}"]`)?.value || "";
  const read = b => ({ staffId: val(b, "staffId"), staffName: val(b, "staffName"), icNo: val(b, "icNo"), outlet: val(b, "outlet"),
    outletFrom: val(b, "outletFrom"), outletTo: val(b, "outletTo"), remarks: val(b, "remarks"),
    times: Object.fromEntries(TR_TIME_LABELS.map(([k]) => [k, b.querySelector(`[data-time="${k}"]`)?.value || ""])) });
  const collect = () => {
    if (type === "permanent") { const b = body.querySelector('[data-line="p"]'); Object.assign(perm, read(b), { effectiveDate: val(b, "effectiveDate"), posFrom: val(b, "posFrom"), posTo: val(b, "posTo") }); }
    else lines = [...body.querySelectorAll(".tr-line")].map(b => ({ ...read(b), fromDate: val(b, "fromDate"), toDate: val(b, "toDate"),
      idLogin: [...b.querySelectorAll("[data-login]:checked")].map(x => x.dataset.login) }));
  };
  drawBody();
  $("#trType").onchange = e => { collect(); type = e.target.value; drawBody(); };
  body.addEventListener("change", async e => {                   // auto prompt: staff details, and times from the To outlet
    const f = e.target.dataset.f, b = box(e.target);
    if (f === "staffId") {
      const code = e.target.value.trim();
      let one = null;
      if (code) { try { one = (await api("GET", `/api/tr/staff?code=${encodeURIComponent(code)}`)).one; } catch { /* ignore */ } }
      b.querySelector('[data-f="staffName"]').value = one?.name || (code ? "⚠ not in Staff Master Data" : "");
      b.querySelector('[data-f="icNo"]').value = one?.icNo || "";
      b.querySelector('[data-f="outlet"]').value = one?.outlet || "";
      const of = b.querySelector('[data-f="outletFrom"]'); if (one && !of.value) of.value = one.outlet;
      const pf = b.querySelector('[data-f="posFrom"]'); if (one && pf && !pf.value) pf.value = one.position || "";
    }
    if (f === "outletTo") {
      e.target.value = e.target.value.toUpperCase();
      const hrs = hoursOf(e.target.value);
      TR_TIME_LABELS.forEach(([k]) => { const t = b.querySelector(`[data-time="${k}"]`); if (t && hrs[k]) t.value = hrs[k]; });
      if (!Object.values(hrs).some(Boolean) && e.target.value) toast(`No working hours set for ${e.target.value} – type them, or set them in Settings › HR Setting`);
    }
  });
  body.addEventListener("click", e => { const b = e.target.closest("[data-rmline]"); if (b) { collect(); lines.splice(+b.dataset.rmline, 1); drawBody(); } });
  const save = async () => {
    collect();
    const payload = { type, data: type === "permanent" ? perm : { lines } };
    const r = id ? await api("PUT", `/api/tr/${id}`, payload) : await api("POST", "/api/tr", payload);
    return r.form;
  };
  $("#trSave").onclick = async () => {
    const f = $("#trForm"); f.classList.add("tried");
    if (!f.reportValidity()) return;
    try { const fm = await save(); toast(`${fm.docNo} saved – Drafted`); if (!id) location.replace(`#/tr/${fm.id}/edit`); }
    catch (ex) { tell(ex.message); }
  };
  $("#trForm").onsubmit = async e => {
    e.preventDefault();
    const w = window.open("", "_blank");                   // opened now (at the click) so the browser allows it
    if (w) w.document.write("Preparing the letter…");
    try { const fm = await save(); toast(`${fm.docNo} submitted – print the letter, get it signed and upload it`); location.hash = `#/tr/${fm.id}`; trPrint(fm, w); }
    catch (ex) { if (w) w.close(); tell(ex.message); }
  };
}

function trPrint(f, win) {                                   // win: a window opened at the click (pop-up blockers)
  const d = f.data, os = f.outletSign || {}, hs = f.hrSign || {};
  const box = (title, x = {}) => `<div class="sig"><div class="sig-t">${title}</div><div class="sig-line">Signature</div>
    <table><tr><td>Name</td><td>${esc(x.name || "")}</td></tr><tr><td>ID No.</td><td>${esc(x.idNo || "")}</td></tr><tr><td>Date</td><td>${x.date ? fmtDate(x.date) : ""}</td></tr></table></div>`;
  const times = t => `<table class="grid"><tr>${TR_TIME_LABELS.map(([, l]) => `<th>${l}</th>`).join("")}</tr><tr>${TR_TIME_LABELS.map(([k]) => `<td>${t12(t?.[k])}</td>`).join("")}</tr></table>`;
  const head = `<img src="/letterhead.png" style="width:100%;max-height:110px;object-fit:contain" onerror="this.remove()" />
    <h2>TRANSFER FORM – ${trType(f.type).toUpperCase()}</h2><p class="meta">Document ID: <b>${esc(f.docNo)}</b> &nbsp; · &nbsp; Printed ${new Date().toLocaleDateString("en-GB")}</p>`;
  const body = f.type === "permanent" ? `
    <table class="kv"><tr><td>Staff Name</td><td>${esc(d.staffName)}</td><td>Staff ID</td><td>${esc(d.staffId)}</td></tr>
      <tr><td>IC No.</td><td>${esc(d.icNo || "")}</td><td>Outlet</td><td>${esc(d.outlet || "")}</td></tr>
      <tr><td>Effective From Date</td><td colspan="3">${fmtDate(d.effectiveDate)}</td></tr>
      <tr><td>Department / Position</td><td colspan="3">From <b>${esc(d.posFrom || "—")}</b> &nbsp; To <b>${esc(d.posTo || "—")}</b></td></tr>
      <tr><td>Transfer Outlet</td><td colspan="3">From <b>${esc(d.outletFrom || "—")}</b> &nbsp; To <b>${esc(d.outletTo || "—")}</b></td></tr>
      <tr><td>Remarks</td><td colspan="3">${esc(d.remarks || "")}</td></tr></table>${times(d.times)}
    <div class="sigs">${box("Approved By: Branch / Area Manager / Director", os.approver)}${box("Filled in by the transferred employee", os.employee)}</div>`
    : `<table class="grid"><tr><th>No</th><th>Staff Name</th><th>Staff ID</th><th>From Outlet</th><th>To Outlet</th><th>From Date</th><th>To Date</th>
        ${TR_TIME_LABELS.map(([, l]) => `<th>${l}</th>`).join("")}<th>Request for ID Login SBClient System</th></tr>
      ${d.lines.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.staffName)}</td><td>${esc(x.staffId)}</td><td>${esc(x.outletFrom)}</td><td>${esc(x.outletTo)}</td>
        <td>${fmtDate(x.fromDate)}</td><td>${fmtDate(x.toDate)}</td>${TR_TIME_LABELS.map(([k]) => `<td>${x.times?.[k] || "—"}</td>`).join("")}
        <td>${esc((x.idLogin || []).join(", ") || "—")}</td></tr>`).join("")}</table>
    ${d.lines.some(x => x.remarks) ? `<p><b>Remarks:</b> ${d.lines.filter(x => x.remarks).map(x => `${esc(x.staffId)}: ${esc(x.remarks)}`).join(" · ")}</p>` : ""}
    <div class="sigs">${box("Approved By: Branch / Area Manager / Director", os.approver)}</div>`;
  const w = win || window.open("", "_blank");
  if (!w) { tell("Allow pop-ups for this site to print the letter."); return; }
  w.document.open();
  w.document.write(`<!doctype html><title>${esc(f.docNo)} Transfer Form</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#111;padding:18px 26px;font-size:13px} h2{margin:6px 0 2px;color:#1e3a8a} .meta{margin:0 0 12px;color:#444}
    table{border-collapse:collapse;width:100%;margin:8px 0} td,th{border:1px solid #888;padding:6px 8px;text-align:left;vertical-align:top}
    .kv td:nth-child(odd){background:#f1f5f9;font-weight:600;width:18%} .grid th{background:#f1f5f9;font-size:12px} .grid td{font-size:12px}
    .sigs{display:flex;gap:24px;margin-top:22px;page-break-inside:avoid} .sig{flex:1} .sig-t{font-weight:700;text-decoration:underline;margin-bottom:6px}
    .sig-line{height:70px;border-bottom:1px solid #111;margin-bottom:6px;color:#888;font-size:11px;display:flex;align-items:flex-start}
    .sig table td:first-child{width:28%;background:#f8fafc} .hr{margin-top:22px;page-break-inside:avoid} @page{size:${f.type === "temporary" ? "A4 landscape" : "A4"};margin:12mm}
  </style>${head}${body}<div class="hr sigs">${box("For HR Use", hs)}<div class="sig"><div class="sig-t">Remarks</div><div style="border:1px solid #888;min-height:120px;padding:6px">${esc(hs.remarks || "")}</div></div></div>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

async function renderTrList() {
  let d;
  try { d = await api("GET", "/api/tr"); } catch (ex) { toast(ex.message); location.replace("#/"); return; }
  const list = d.forms, count = st => list.filter(f => f.status === st).length;
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>Transfer List</h1>
      <div class="sub">${d.hr ? "All transfer forms (HR)." : "Your transfer forms."} Drafted → upload the signed letter → Submitted (can still be changed) → HR opens it: Processing → Completed → open it → Checked.</div></div>
      <div class="actions">${d.canFill ? `<a class="btn btn-primary" href="#/tr/new">+ Transfer Form</a>` : ""}</div></div>
    <div class="stats mc-stats">${Object.entries(TR_STATUS).map(([k, [l]]) => `<div class="stat"><div class="n">${count(k)}</div><div class="l">${l}</div></div>`).join("")}</div>
    <div class="card">
      <div class="table-wrap"><table class="mc-table tr-table">
        <thead><tr><th></th><th></th><th>Status</th><th>Document ID</th><th>Document Type</th><th>Staff ID</th><th>Staff Name</th><th>Outlet</th></tr>
          <tr class="tr-search"><th></th><th></th>
            <th><select data-s="status"><option value="">All</option>${Object.entries(TR_STATUS).map(([k, [l]]) => `<option value="${k}" ${trFind.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></th>
            ${[["doc", "Document ID"], ["type", "Document Type"], ["staff", "Staff ID"], ["name", "Staff Name"], ["outlet", "Outlet"]].map(([k, l]) =>
              `<th><input type="search" data-s="${k}" placeholder="Search ${l}" value="${esc(trFind[k])}" /></th>`).join("")}</tr></thead>
        <tbody id="trRows"></tbody>
      </table></div>
      <div class="mc-pager"><span class="muted" id="trInfo"></span><span id="trPages"></span></div>
    </div>`;
  const PER = 25, me_ = me.id;
  const canEdit = f => ["drafted", "submitted"].includes(f.status) && (d.hr || f.createdById === me_);
  const canCancel = f => d.hr && !["cancelled", "checked"].includes(f.status);
  const canUpload = f => (["drafted", "submitted"].includes(f.status) && (f.createdById === me_ || d.hr)) || (f.status === "processing" && d.hr);
  const draw = () => {
    const has = (v, q) => !q || String(v).toLowerCase().includes(q.toLowerCase());
    const rows = list.filter(f => (!trFind.status || f.status === trFind.status) && has(f.docNo, trFind.doc) && has(trType(f.type), trFind.type)
      && has(f.staffIds.join(" "), trFind.staff) && has(f.staffNames.join(" "), trFind.name) && has(f.outlets.join(" "), trFind.outlet));
    const pages = Math.max(1, Math.ceil(rows.length / PER)); trFind.page = Math.min(trFind.page, pages);
    const from = (trFind.page - 1) * PER, part = rows.slice(from, from + PER);
    const more = a => a.length > 1 ? ` <span class="muted">+${a.length - 1}</span>` : "";
    $("#trRows").innerHTML = part.length ? part.map(f => `<tr data-tr="${f.id}">
      <td class="tr-menu-cell"><button type="button" class="btn btn-sm tr-dots" data-menu="${f.id}" title="View / Edit / Cancel / Print">⋮</button>
        <div class="tr-menu" hidden><a href="#/tr/${f.id}">View</a>${canEdit(f) ? `<a href="#/tr/${f.id}/edit">Edit</a>` : ""}
          ${canCancel(f) ? `<button type="button" data-cancel="${f.id}">Cancel</button>` : ""}<button type="button" data-print="${f.id}">Print</button></div></td>
      <td>${canUpload(f) ? `<a class="btn btn-sm" href="#/tr/${f.id}" title="Upload the signed letter">⬆</a>` : ""}</td>
      <td>${trBadge(f.status)}</td><td><a href="#/tr/${f.id}"><strong>${esc(f.docNo)}</strong></a></td><td>${trType(f.type)}</td>
      <td>${esc(f.staffIds[0] || "")}${more(f.staffIds)}</td><td>${esc(f.staffNames[0] || "")}${more(f.staffNames)}</td><td>${esc(f.outlets[0] || "")}</td></tr>`).join("")
      : `<tr><td colspan="8" class="empty">${list.length ? "No form matches." : "No transfer form yet."}</td></tr>`;
    $("#trInfo").textContent = rows.length ? `Showing ${from + 1} to ${from + part.length} of ${rows.length} entries` : "";
    $("#trPages").innerHTML = pages > 1 ? `<button class="btn btn-sm" data-pg="${trFind.page - 1}" ${trFind.page === 1 ? "disabled" : ""}>Previous</button>
      <strong style="margin:0 8px">${trFind.page} / ${pages}</strong><button class="btn btn-sm" data-pg="${trFind.page + 1}" ${trFind.page === pages ? "disabled" : ""}>Next</button>` : "";
  };
  draw();
  document.querySelector(".tr-search").addEventListener("input", e => { const k = e.target.dataset.s; if (k) { trFind[k] = e.target.value; trFind.page = 1; draw(); } });
  $("#trPages").onclick = e => { const b = e.target.closest("[data-pg]"); if (b && !b.disabled) { trFind.page = +b.dataset.pg; draw(); } };
  $("#trRows").onclick = async e => {
    const m = e.target.closest("[data-menu]");
    document.querySelectorAll(".tr-menu").forEach(x => { if (!m || x !== m.nextElementSibling) x.hidden = true; });
    if (m) { m.nextElementSibling.hidden = !m.nextElementSibling.hidden; return; }
    const pr = e.target.closest("[data-print]"), cn = e.target.closest("[data-cancel]");
    if (pr) {
      const w = window.open("", "_blank");
      if (w) w.document.write("Preparing the letter…");
      try { trPrint((await api("GET", `/api/tr/${pr.dataset.print}`)).form, w); } catch (ex) { if (w) w.close(); tell(ex.message); }
      return;
    }
    if (cn) { trCancel(cn.dataset.cancel, renderTrList); return; }
    const tr = e.target.closest("[data-tr]");
    if (tr && !e.target.closest("a,button")) location.hash = "#/tr/" + tr.dataset.tr;
  };
}

function trCancel(id, after) {
  openDialog(`<h3>Cancel this transfer form?</h3><label class="field"><span>Reason (optional)</span><input type="text" name="reason" maxlength="300" /></label>`,
    async form => { await api("POST", `/api/tr/${id}/cancel`, { reason: form.reason.value }); $("#dialog").close(); toast("Transfer form cancelled"); after(); }, "Cancel form");
}

async function renderTrView(id) {
  let d;
  try { d = await api("GET", `/api/tr/${id}`); } catch (ex) { toast(ex.message); location.replace("#/tr"); return; }
  const f = d.form, data = f.data, os = f.outletSign || {}, hs = f.hrSign || {};
  const ro = (l, v) => `<label class="field"><span>${l}</span><input type="text" value="${esc(v || "")}" disabled /></label>`;
  const times = t => `<div class="tr-times">${TR_TIME_LABELS.map(([k, l]) => ro(l, t12(t?.[k]))).join("")}</div>`;
  const signBox = (title, x = {}) => `<div class="tr-sign"><div class="tr-sign-t">${title}</div>${ro("Name", x.name)}${ro("ID No.", x.idNo)}${ro("Date", x.date ? fmtDate(x.date) : "")}</div>`;
  const files = kind => f.files.filter(x => x.kind === kind).map(x => `<a class="mc-pdfbox" href="/api/tr/files/${x.id}" target="_blank" rel="noopener">📄 ${esc(x.name)}</a>`).join(" ");
  const hrStage = d.hr && (f.status === "processing" || (f.status === "submitted" && d.mine));
  const outletStage = !hrStage && ["drafted", "submitted"].includes(f.status) && (d.mine || d.hr), resign = f.status === "submitted";
  const signInputs = (pre, who) => `<div class="tr-sign"><div class="tr-sign-t">${who}</div>
      <label class="field"><span>Name</span><input type="text" name="${pre}Name" maxlength="120" /></label>
      <label class="field"><span>ID No. <span class="muted" style="font-weight:400">(User ID)</span></span><input type="text" name="${pre}Id" maxlength="120" list="trSignIds" data-signid="${pre}" placeholder="User ID – the name fills in" /></label>
      <label class="field"><span>Date</span><input type="date" name="${pre}Date" /></label></div>`;
  $("#app").innerHTML = `
    <div class="page-head"><div><a href="#/tr" style="text-decoration:none;font-weight:600">← Transfer List</a>
      <h1 style="margin-top:6px">${esc(f.docNo)} ${trBadge(f.status)}</h1>
      <div class="sub">${trType(f.type)} transfer · made by ${esc(f.createdBy)} on ${fmtTime(f.createdAt)}
        ${f.cancelledAt ? ` · cancelled by ${esc(f.cancelledBy)}${f.cancelReason ? ` – ${esc(f.cancelReason)}` : ""}` : ""}
        ${f.checkedAt ? ` · checked by ${esc(f.checkedBy)} ${fmtTime(f.checkedAt)}` : ""}</div></div>
      <div class="actions">
        ${["drafted", "submitted"].includes(f.status) && (d.mine || d.hr) ? `<a class="btn" href="#/tr/${id}/edit">✎ Edit</a>` : ""}
        <button class="btn" id="trPrintBtn">🖨 Print letter</button>
        ${d.hr && !["cancelled", "checked"].includes(f.status) ? `<button class="btn btn-danger" id="trCancelBtn">Cancel</button>` : ""}</div></div>
    <div class="card mc-form">
      <div class="card-head"><h2>Transfer Form – ${trType(f.type)}</h2></div>
      <div class="card-body">
        ${f.type === "permanent" ? `<div class="tr-grid">${ro("Document ID", f.docNo)}${ro("Staff ID", data.staffId)}${ro("Staff Name", data.staffName)}${ro("IC No.", data.icNo)}
            ${ro("Outlet", data.outlet)}${ro("Type", "Permanent")}${ro("Effective From Date", fmtDate(data.effectiveDate))}</div>
          <div class="tr-grid">${ro("Department / Position – From", data.posFrom)}${ro("To", data.posTo)}${ro("Transfer Outlet – From", data.outletFrom)}${ro("To", data.outletTo)}</div>
          ${times(data.times)}${ro("Remarks", data.remarks)}`
        : `<div class="table-wrap"><table class="tr-tmp"><thead><tr><th>No</th><th>Staff Name</th><th>Staff ID</th><th>IC No.</th><th>From Outlet</th><th>To Outlet</th><th>From Date</th><th>To Date</th>
            ${TR_TIME_LABELS.map(([, l]) => `<th>${l}</th>`).join("")}<th>Request For ID Login SBClient</th><th>Remarks</th></tr></thead>
            <tbody>${data.lines.map((x, i) => `<tr style="cursor:default"><td>${i + 1}</td><td>${esc(x.staffName)}</td><td>${esc(x.staffId)}</td><td>${esc(x.icNo || "")}</td>
              <td>${esc(x.outletFrom)}</td><td>${esc(x.outletTo)}</td><td>${fmtDate(x.fromDate)}</td><td>${fmtDate(x.toDate)}</td>
              ${TR_TIME_LABELS.map(([k]) => `<td>${x.times?.[k] || "—"}</td>`).join("")}<td>${esc((x.idLogin || []).join(", ") || "—")}</td><td>${esc(x.remarks || "")}</td></tr>`).join("")}</tbody></table></div>`}
        <div class="tr-signs">${signBox("Approved By: Branch / Area Manager / Director", os.approver)}${f.type === "permanent" ? signBox("Filled in by the transferred employee", os.employee) : ""}</div>
        ${files("outlet") ? `<div class="field"><span>Signed letter (outlet)</span><div>${files("outlet")}</div></div>` : ""}
        ${["completed", "checked"].includes(f.status) || hs.name ? `<div class="tr-signs">${signBox("For HR Use", hs)}<div class="tr-sign"><div class="tr-sign-t">Remarks</div>
          <textarea disabled rows="4">${esc(hs.remarks || "")}</textarea></div></div>` : ""}
        ${files("hr") ? `<div class="field"><span>Signed letter (HR)</span><div>${files("hr")}</div></div>` : ""}
      </div>
    </div>
    ${outletStage || hrStage ? `<form class="card mc-form" id="trStageForm">
      <div class="card-head"><h2>⬆ ${outletStage ? (resign ? "Signed letter (outlet) – can still be changed until HR opens it" : "Upload the signed letter (outlet)") : "HR: upload the signed letter and complete"}</h2></div>
      <div class="card-body">
        <p class="muted" style="margin-top:0">${outletStage ? "Print the letter, get it signed, scan or photograph it and upload it here. The form then goes to HR (Processing)."
          : "Approve and print the letter, sign it, upload the signed copy and press Complete."}</p>
        <label class="mc-drop" id="trDrop"><input type="file" id="trFile" accept="image/*,.pdf" multiple hidden />
          <span class="mc-drop-icon">📄</span><strong>Drag the signed letter here or click in this area.</strong><span class="muted" style="font-size:12px">PDF or photo</span></label>
        <div id="trPicked" class="mc-picked"></div>
        <div class="tr-signs">${outletStage ? signInputs("ap", "Approved By: Branch / Area Manager / Director") + (f.type === "permanent" ? signInputs("em", "Filled in by the transferred employee") : "")
          : signInputs("hr", "For HR Use") + `<div class="tr-sign"><div class="tr-sign-t">Remarks</div><textarea name="hrRemarks" rows="4" maxlength="1000"></textarea></div>`}</div>
        <div class="mc-actions"><a class="btn" href="#/tr">✕</a><button class="btn btn-primary">${outletStage ? (resign ? "Save changes" : "Submit signed letter") : "Complete"}</button></div>
      </div></form>` : ""}
    <div class="card"><div class="card-head"><h2>History</h2></div>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
      ${d.history.map(h => `<tr style="cursor:default"><td class="muted" style="white-space:nowrap">${fmtTime(h.at)}</td><td>${esc(h.by)}</td>
        <td>${esc((h.field ? h.field + ": " : "") + (h.old ? h.old + " → " : "") + (h.new || h.action))}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#trPrintBtn").onclick = () => trPrint(f);
  if ($("#trCancelBtn")) $("#trCancelBtn").onclick = () => trCancel(id, () => renderTrView(id));
  const sf = $("#trStageForm");
  if (!sf) return;
  if (f.type === "permanent" && outletStage) { sf.emName.value = data.staffName || ""; sf.emId.value = data.staffId || ""; }
  if (outletStage && resign) {                                     // already submitted: show the signers given
    const a = os.approver || {}, m = os.employee || {};
    sf.apName.value = a.name || ""; sf.apId.value = a.idNo || ""; sf.apDate.value = a.date || "";
    if (sf.emName) { sf.emName.value = m.name || sf.emName.value; sf.emId.value = m.idNo || sf.emId.value; sf.emDate.value = m.date || ""; }
  }
  if (hrStage) { sf.hrName.value = me.name || ""; sf.hrId.value = me.username || ""; }
  sf.addEventListener("change", async e => {                       // ID No. = User ID: fill in the name from Staff Master Data
    const pre = e.target.dataset.signid;
    if (!pre || !e.target.value.trim()) return;
    try {
      const one = (await api("GET", `/api/tr/staff?code=${encodeURIComponent(e.target.value.trim())}`)).one;
      if (one) { e.target.value = one.code; sf[pre + "Name"].value = one.name; }
    } catch { /* leave as typed */ }
  });
  const picked = [];
  const drawPicked = () => { $("#trPicked").innerHTML = picked.map((x, i) => `<div class="mc-file"><span>📄 ${esc(x.name)}</span><button type="button" class="btn btn-sm" data-rm="${i}">✕</button></div>`).join("")
    + f.files.filter(x => x.kind === (outletStage ? "outlet" : "hr")).map(x => `<div class="mc-file"><span>✔ ${esc(x.name)} (uploaded)</span></div>`).join(""); };
  const add = l => { for (const x of l) if (x.type.startsWith("image/") || x.type === "application/pdf") picked.push(x); drawPicked(); $("#trDrop").classList.remove("missing"); };
  $("#trFile").onchange = e => { add(e.target.files); e.target.value = ""; };
  const drop = $("#trDrop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files); };
  $("#trPicked").onclick = e => { const b = e.target.closest("[data-rm]"); if (b) { picked.splice(+b.dataset.rm, 1); drawPicked(); } };
  drawPicked();
  sf.onsubmit = async e => {
    e.preventDefault();
    const already = f.files.some(x => x.kind === (outletStage ? "outlet" : "hr"));
    if (!picked.length && !already) { $("#trDrop").classList.add("missing"); tell("Upload the signed letter first."); return; }
    try {
      for (const x of picked) await api("POST", `/api/tr/${id}/files?name=${encodeURIComponent(x.name)}${hrStage ? "&stage=hr" : ""}`, x);
      const sign = outletStage ? { approver: { name: sf.apName.value, idNo: sf.apId.value, date: sf.apDate.value },
          employee: f.type === "permanent" ? { name: sf.emName.value, idNo: sf.emId.value, date: sf.emDate.value } : {} }
        : { name: sf.hrName.value, idNo: sf.hrId.value, date: sf.hrDate.value, remarks: sf.hrRemarks.value };
      await api("POST", `/api/tr/${id}/stage`, { sign, stage: hrStage ? "hr" : "outlet" });
      toast(outletStage ? (resign ? "Changes saved – still Submitted" : "Signed letter uploaded – Submitted (waiting for HR)") : "Transfer completed");
      renderTrView(id);
    } catch (ex) { tell(ex.message); }
  };
}

// ---------------- HR Dept: Time Adjustment (PRO-2603-004) - form, listing, details
const TA_TIMES = [["timeIn", "Time In"], ["lunchIn", "Lunch In"], ["lunchOut", "Lunch Out"], ["dinnerIn", "Dinner In"], ["dinnerOut", "Dinner Out"],
  ["offOut", "Time Off Out"], ["offIn", "Time Off In"], ["timeOut", "Time Out"]];
const TA_STATUS = { draft: ["Draft", "tas-draft"], submitted: ["Submitted", "tas-submitted"], processing: ["Processing", "tas-processing"],
  incomplete: ["Incomplete", "tas-incomplete"], completed: ["Completed", "tas-completed"], acknowledged: ["Acknowledged", "tas-ack"],
  cancelled: ["Cancelled", "tas-cancelled"] };
const taBadge = st => { const [l, c] = TA_STATUS[st] || [st, ""]; return `<span class="mcs ${c}">${esc(l)}</span>`; };
const taDay = ts => ts ? new Date(ts * 1000).toLocaleDateString("en-GB") : "";
const taClock = ts => ts ? new Date(ts * 1000).toLocaleTimeString("en-GB") : "";
const TA_AGREE = "I agree and accept the change of working hours as stated above.";
// the maker may change a form until HR opens it (Processing); after that only the lines HR declines
const taMineEdit = f => f.createdById === me.id && (f.status === "draft" || f.status === "submitted" || (f.status === "incomplete" && f.returnedBy === "hr"));
const taHrTurn = f => f.status === "submitted" || f.status === "processing" || (f.status === "incomplete" && f.returnedBy === "user");
let taFind = { status: "", q: "", page: 1 };
function taHead(f) {
  const at = f?.createdAt || Date.now() / 1000;
  return `<div class="table-wrap"><table class="ta-head"><thead><tr><th>Document ID</th><th>Status</th><th>Created ID</th><th>Created Date</th>
      <th>Created Time</th><th>Completed ID</th></tr></thead>
    <tbody><tr style="cursor:default"><td><strong>${esc(f?.docNo || "(given when saved)")}</strong></td><td>${taBadge(f?.status || "draft")}</td>
      <td>${esc(f?.createdUser || me.username)}</td><td>${taDay(at)}</td><td>${taClock(at)}</td><td>${esc(f?.completedUser || "")}</td></tr></tbody></table></div>`;
}

async function renderTaForm(id) {
  let ref, form = null;
  try {
    ref = await api("GET", "/api/ta/staff");
    if (id) {
      form = (await api("GET", `/api/ta/${id}`)).form;
      if (!taMineEdit(form)) { toast("This form cannot be changed now"); location.replace(`#/ta/${id}`); return; }
    }
  } catch (ex) { toast(ex.message); location.replace("#/ta"); return; }
  const fix = form?.status === "incomplete";                    // only the lines HR declined can change
  const blank = () => ({ times: {}, branch: (ref.myOutlet || "").toUpperCase(), date: rows?.at(-1)?.date || "", files: [], pending: [] });
  let rows = null;
  rows = form ? form.rows.map(x => ({ ...x, times: { ...x.times }, pending: [] })) : [blank()];
  const locked = x => fix && x.hrAck !== "declined";
  const outletOpts = sel => `<option value=""></option>` + [...new Set([...ref.outlets.map(o => o.code), ...(sel ? [sel] : [])])]
    .map(c => `<option value="${esc(c)}" ${c === sel ? "selected" : ""}>${esc(c)}</option>`).join("");
  const reasonOpts = sel => `<option value="">-</option>` + [...new Set([...(ref.reasons || []), ...(sel ? [sel] : [])])]
    .map(r => `<option ${r === sel ? "selected" : ""}>${esc(r)}</option>`).join("");
  $("#app").innerHTML = `
    <div class="page-head"><div>${id ? `<a href="#/ta/${id}" style="text-decoration:none;font-weight:600">← ${esc(form.docNo)}</a>` : ""}
      <h1 style="margin-top:6px">Time Adjustment Form</h1>
      <div class="sub">${fix ? "HR declined the lines marked in orange – correct them (see HR's remark) and submit again."
        : "One line per staff and day. Staff Name and IC fill in from Staff Master Data. Save keeps it as Draft; Submit sends it to HR."}</div></div></div>
    <form class="card mc-form" id="taForm" autocomplete="off" novalidate>
      <div class="card-body">${taHead(form)}
        <div class="table-wrap"><table class="ta-grid"><thead><tr><th>Staff ID</th><th>Staff Name</th><th>IC</th><th>Date</th><th>Branch</th>
          ${TA_TIMES.map(([, l]) => `<th>${l}</th>`).join("")}<th>Reason Code</th><th>Remark</th><th>Evidence</th><th></th></tr></thead>
          <tbody id="taLines"></tbody></table></div>
        ${fix ? "" : `<button type="button" class="ta-add" id="taAdd" title="Add a line">＋</button>`}
        <label class="check-line ta-agree"><input type="checkbox" id="taAgree" ${form?.agreed && !fix ? "checked" : ""} /> <span>${TA_AGREE}</span></label>
      </div>
      <div class="card-body mc-actions" style="border-top:1px solid var(--line)">
        <a class="btn" href="${id ? `#/ta/${id}` : "#/ta"}">Back</a>
        <button type="button" class="btn btn-primary" id="taSave">Save</button>
        <button type="submit" class="btn btn-success">Submit</button>
      </div>
    </form>
    <datalist id="taStaffList">${ref.staff.map(x => `<option value="${esc(x.code)}">${esc(x.name)} · ${esc(x.outlet || "")}</option>`).join("")}</datalist>
    <input type="file" id="taFile" accept="image/*,.pdf" multiple hidden />`;
  const tb = $("#taLines"), cols = TA_TIMES.length + 9;
  const draw = () => {
    tb.innerHTML = rows.map((x, i) => {
      const lk = locked(x), dis = lk ? "disabled" : "";
      const ev = [...(x.files || []).map(f => `<a href="/api/ta/files/${f.id}" target="_blank" rel="noopener" class="ta-file" title="${esc(f.name)}">📎</a>`
          + (lk ? "" : `<button type="button" class="ta-x" data-rmfile="${f.id}" data-i="${i}" title="Remove ${esc(f.name)}">✕</button>`)),
        ...x.pending.map((p, k) => `<span class="ta-file" title="${esc(p.name)} – uploads when you save">🕓</span><button type="button" class="ta-x" data-rmpend="${i}:${k}">✕</button>`)].join("");
      return `<tr data-i="${i}" class="${fix && !lk ? "ta-declined" : ""}" style="cursor:default">
        <td><input type="text" data-f="staffId" list="taStaffList" value="${esc(x.staffId || "")}" ${dis} placeholder="Staff ID" /></td>
        <td class="ta-auto">${esc(x.staffName || "")}</td><td class="ta-auto">${esc(x.icNo || "")}</td>
        <td><input type="date" data-f="date" value="${esc(x.date || "")}" ${dis} /></td>
        <td><select data-f="branch" ${dis}>${outletOpts(x.branch)}</select></td>
        ${TA_TIMES.map(([k]) => `<td><input type="time" data-t="${k}" value="${esc(x.times?.[k] || "")}" ${dis} /></td>`).join("")}
        <td><select data-f="reason" ${dis}>${reasonOpts(x.reason)}</select></td>
        <td><input type="text" data-f="remark" maxlength="500" value="${esc(x.remark || "")}" ${dis} /></td>
        <td class="ta-ev">${ev}${lk ? "" : `<button type="button" class="ta-up" data-up="${i}" title="Add evidence (photo / PDF)">⬆</button>`}</td>
        <td>${fix ? (lk ? `<span class="muted" title="Ticked by HR">✔</span>` : "") : rows.length > 1 ? `<button type="button" class="ta-x" data-rm="${i}" title="Remove this line">🗑</button>` : ""}</td></tr>
        ${fix && !lk && x.hrNote ? `<tr class="ta-note"><td colspan="${cols}">HR: ${esc(x.hrNote)}</td></tr>` : ""}`;
    }).join("");
  };
  const sync = () => tb.querySelectorAll("tr[data-i]").forEach(tr => {
    const x = rows[+tr.dataset.i];
    if (locked(x)) return;
    tr.querySelectorAll("[data-f]").forEach(el => { x[el.dataset.f] = el.dataset.f === "staffId" ? el.value.trim() : el.value; });
    tr.querySelectorAll("[data-t]").forEach(el => { x.times[el.dataset.t] = el.value; });
  });
  draw();
  if ($("#taAdd")) $("#taAdd").onclick = () => { sync(); rows.push(blank()); draw(); };
  tb.addEventListener("change", async e => {                     // Staff ID -> name, IC and branch from Staff Master Data
    if (e.target.dataset.f !== "staffId") return;
    sync();
    const x = rows[+e.target.closest("tr").dataset.i], code = x.staffId;
    let one = null;
    if (code) { try { one = (await api("GET", `/api/ta/staff?code=${encodeURIComponent(code)}`)).one; } catch { /* leave as typed */ } }
    x.staffId = one?.code || code; x.staffName = one ? one.name : code ? "⚠ not in your staff list" : ""; x.icNo = one?.icNo || "";
    if (one?.outlet) x.branch = one.outlet.toUpperCase();
    draw();
  });
  tb.addEventListener("click", async e => {
    const rm = e.target.closest("[data-rm]"), up = e.target.closest("[data-up]"), rp = e.target.closest("[data-rmpend]"), rf = e.target.closest("[data-rmfile]");
    if (rm) { sync(); rows.splice(+rm.dataset.rm, 1); draw(); }
    if (up) { sync(); $("#taFile").dataset.i = up.dataset.up; $("#taFile").click(); }
    if (rp) { sync(); const [i, k] = rp.dataset.rmpend.split(":").map(Number); rows[i].pending.splice(k, 1); draw(); }
    if (rf) {
      sync();
      try { await api("POST", `/api/ta/files/${rf.dataset.rmfile}/remove`); const x = rows[+rf.dataset.i]; x.files = x.files.filter(f => f.id !== rf.dataset.rmfile); draw(); }
      catch (ex) { tell(ex.message); }
    }
  });
  $("#taFile").onchange = e => {
    const x = rows[+e.target.dataset.i];
    for (const f of e.target.files) if (f.type.startsWith("image/") || f.type === "application/pdf") x.pending.push(f);
    e.target.value = ""; draw();
  };
  const save = async submit => {
    sync();
    const body = (s, list) => ({ submit: s, agreed: $("#taAgree").checked, rows: list.map(({ pending, files, ...x }) => x) });
    const hasPend = rows.some(x => x.pending.length);
    let fm = (id ? await api("PUT", `/api/ta/${id}`, body(submit && !hasPend, rows)) : await api("POST", "/api/ta", body(submit && !hasPend, rows))).form;
    if (hasPend) {                                             // evidence picked before saving: upload it to its line, then submit
      for (const [i, x] of rows.entries()) {
        for (const p of x.pending) fm = (await api("POST", `/api/ta/${fm.id}/files?row=${fm.rows[i].uid}&name=${encodeURIComponent(p.name)}`, p)).form;
        x.pending = [];
      }
      if (submit) fm = (await api("PUT", `/api/ta/${fm.id}`, body(true, fm.rows))).form;
    }
    return fm;
  };
  $("#taSave").onclick = async () => {
    try { const fm = await save(false); toast(`${fm.docNo} saved – ${fm.status === "draft" ? "Draft" : fm.status === "submitted" ? "still Submitted" : "not submitted yet"}`);
      if (!id) location.replace(`#/ta/${fm.id}/edit`); else renderTaForm(id); }
    catch (ex) { tell(ex.message); }
  };
  $("#taForm").onsubmit = async e => {
    e.preventDefault();
    if (!$("#taAgree").checked) { tell(`Tick “${TA_AGREE}” to submit.`); return; }
    try { const fm = await save(true); toast(`${fm.docNo} submitted – waiting for HR`); location.hash = `#/ta/${fm.id}`; }
    catch (ex) { tell(ex.message); }
  };
}

async function renderTaList() {
  let d;
  try { d = await api("GET", "/api/ta"); } catch (ex) { toast(ex.message); location.replace("#/"); return; }
  const list = d.forms, count = st => list.filter(f => f.status === st).length;
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>Time Adjustment Listing</h1>
      <div class="sub">${d.hr ? "Every submitted form (HR sees a form once it is submitted) and your own." : "Your time adjustment forms."}
        Draft → Submitted → Processing → Completed → Acknowledged · a declined line → Incomplete.</div></div>
      <div class="actions">${d.hr ? `<button class="btn" id="taReasonBtn">⚙ Reason codes</button>` : ""}
        ${d.canFill ? `<a class="btn btn-primary" href="#/ta/new">+ Time Adjustment Form</a>` : ""}</div></div>
    <div class="stats mc-stats">${Object.entries(TA_STATUS).map(([k, [l]]) => `<div class="stat ta-stat ${taFind.status === k ? "on" : ""}" data-st="${k}"
      title="Show ${l} only"><div class="n">${count(k)}</div><div class="l">${l}</div></div>`).join("")}</div>
    <div class="card">
      <div class="card-head ta-tools"><input type="search" id="taQ" placeholder="Search document ID, staff, branch, created ID…" value="${esc(taFind.q)}" />
        <select id="taSt"><option value="">All status</option>${Object.entries(TA_STATUS).map(([k, [l]]) => `<option value="${k}" ${taFind.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="table-wrap"><table class="mc-table tr-table">
        <thead><tr><th></th><th>Status</th><th>Document ID</th><th>Staff</th><th>Branch</th><th>Created ID</th><th>Created Date</th><th>Created Time</th><th>Completed ID</th></tr></thead>
        <tbody id="taList"></tbody></table></div>
      <div class="mc-pager"><span class="muted" id="taInfo"></span><span id="taPages"></span></div>
    </div>`;
  const PER = 25;
  const canCancel = f => (d.hr && ["submitted", "processing", "incomplete"].includes(f.status))
    || (f.createdById === me.id && (["draft", "submitted"].includes(f.status) || (f.status === "incomplete" && f.returnedBy === "hr")));
  const waits = f => (d.hr && taHrTurn(f)) || (taMineEdit(f) && f.status !== "submitted") || (f.createdById === me.id && f.status === "completed");
  const draw = () => {
    const q = taFind.q.trim().toLowerCase();
    const rows = list.filter(f => (!taFind.status || f.status === taFind.status) && (!q || [f.docNo, f.staffIds.join(" "), f.staffNames.join(" "),
      f.branches.join(" "), f.createdUser, f.createdBy, f.completedUser].join(" ").toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(rows.length / PER)); taFind.page = Math.min(taFind.page, pages);
    const from = (taFind.page - 1) * PER, part = rows.slice(from, from + PER);
    $("#taList").innerHTML = part.length ? part.map(f => `<tr data-ta="${f.id}">
      <td class="tr-menu-cell"><button type="button" class="btn btn-sm tr-dots" data-menu="${f.id}" title="View / Edit / Cancel">⋮</button>
        <div class="tr-menu" hidden><a href="#/ta/${f.id}">View</a>${taMineEdit(f) ? `<a href="#/ta/${f.id}/edit">Edit</a>` : ""}
          ${d.hr && taHrTurn(f) ? `<a href="#/ta/${f.id}">Check / Complete</a>` : ""}${f.createdById === me.id && f.status === "completed" ? `<a href="#/ta/${f.id}">Acknowledge</a>` : ""}
          ${canCancel(f) ? `<button type="button" data-cancel="${f.id}">Cancel</button>` : ""}</div></td>
      <td>${taBadge(f.status)}${waits(f) ? ` <span class="ta-dot" title="Waiting for you">●</span>` : ""}</td>
      <td><a href="#/ta/${f.id}"><strong>${esc(f.docNo)}</strong></a></td>
      <td>${esc(f.staffNames[0] || f.staffIds[0] || "")}${f.lines > 1 ? ` <span class="muted">+${f.lines - 1}</span>` : ""}</td>
      <td>${esc(f.branches.join(", "))}</td><td>${esc(f.createdUser)}</td><td>${taDay(f.createdAt)}</td><td>${taClock(f.createdAt)}</td><td>${esc(f.completedUser)}</td></tr>`).join("")
      : `<tr><td colspan="9" class="empty">${list.length ? "No form matches." : "No time adjustment form yet."}</td></tr>`;
    $("#taInfo").textContent = rows.length ? `Showing ${from + 1} to ${from + part.length} of ${rows.length} entries` : "";
    $("#taPages").innerHTML = pages > 1 ? `<button class="btn btn-sm" data-pg="${taFind.page - 1}" ${taFind.page === 1 ? "disabled" : ""}>Previous</button>
      <strong style="margin:0 8px">${taFind.page} / ${pages}</strong><button class="btn btn-sm" data-pg="${taFind.page + 1}" ${taFind.page === pages ? "disabled" : ""}>Next</button>` : "";
    document.querySelectorAll(".ta-stat").forEach(x => x.classList.toggle("on", x.dataset.st === taFind.status));
    $("#taSt").value = taFind.status;
  };
  draw();
  $("#taQ").oninput = e => { taFind.q = e.target.value; taFind.page = 1; draw(); };
  $("#taSt").onchange = e => { taFind.status = e.target.value; taFind.page = 1; draw(); };
  document.querySelector(".stats").onclick = e => { const s = e.target.closest("[data-st]"); if (s) { taFind.status = taFind.status === s.dataset.st ? "" : s.dataset.st; taFind.page = 1; draw(); } };
  $("#taPages").onclick = e => { const b = e.target.closest("[data-pg]"); if (b && !b.disabled) { taFind.page = +b.dataset.pg; draw(); } };
  if ($("#taReasonBtn")) $("#taReasonBtn").onclick = taReasonDialog;
  $("#taList").onclick = e => {
    const m = e.target.closest("[data-menu]");
    document.querySelectorAll(".tr-menu").forEach(x => { if (!m || x !== m.nextElementSibling) x.hidden = true; });
    if (m) { m.nextElementSibling.hidden = !m.nextElementSibling.hidden; return; }
    const cn = e.target.closest("[data-cancel]");
    if (cn) { taCancel(cn.dataset.cancel, renderTaList); return; }
    const tr = e.target.closest("[data-ta]");
    if (tr && !e.target.closest("a,button,.tr-menu")) location.hash = "#/ta/" + tr.dataset.ta;
  };
}

async function taReasonDialog() {
  let reasons = [];
  try { reasons = (await api("GET", "/api/ta/staff")).reasons || []; } catch (ex) { tell(ex.message); return; }
  openDialog(`<h3>⚙ Reason codes</h3><p class="muted" style="margin-top:0">One per line – the choices of “Reason Code” on the Time Adjustment Form.</p>
    <textarea name="items" rows="10" style="width:100%">${esc(reasons.join("\n"))}</textarea>`,
    async form => { await api("PUT", "/api/ta/reasons", { items: form.items.value.split("\n") }); toast("Reason codes saved"); }, "Save");
}

function taCancel(id, after) {
  openDialog(`<h3>Cancel this time adjustment form?</h3><label class="field"><span>Reason (optional)</span><input type="text" name="reason" maxlength="300" /></label>`,
    async form => { await api("POST", `/api/ta/${id}/cancel`, { reason: form.reason.value }); $("#dialog").close(); toast("Time adjustment form cancelled"); after(); }, "Cancel form");
}

async function renderTaView(id) {
  let d;
  try { d = await api("GET", `/api/ta/${id}`); } catch (ex) { toast(ex.message); location.replace("#/ta"); return; }
  const f = d.form;
  const hrStage = d.hr && (f.status === "processing" || (f.status === "submitted" && d.mine) || (f.status === "incomplete" && f.returnedBy === "user"));
  const hrFix = hrStage && f.status === "incomplete";            // the outlet declined after Completed: HR may correct the times
  const ackStage = d.mine && f.status === "completed";
  const canCancel = (d.hr && ["submitted", "processing", "incomplete"].includes(f.status))
    || (d.mine && (["draft", "submitted"].includes(f.status) || (f.status === "incomplete" && f.returnedBy === "hr")));
  const showUser = ackStage || ["completed", "acknowledged"].includes(f.status) || f.rows.some(x => x.userAck);
  const dec = Object.fromEntries(f.rows.map(x => [x.uid, hrStage ? { ack: x.hrAck, note: x.hrNote, times: { ...x.times } } : { ack: "", note: "" }]));
  const pill = (a, note) => a === "ok" ? `<span class="ta-pill ok">Acknowledged</span>`
    : a === "declined" ? `<span class="ta-pill bad">Declined</span>${note ? `<div class="ta-why">${esc(note)}</div>` : ""}` : `<span class="muted">—</span>`;
  const pick = uid => `<div class="ta-ack"><button type="button" class="ta-ok ${dec[uid].ack === "ok" ? "on" : ""}" data-ack="ok" data-uid="${uid}" title="Acknowledge">✔</button>
      <button type="button" class="ta-no ${dec[uid].ack === "declined" ? "on" : ""}" data-ack="declined" data-uid="${uid}" title="Decline">⊖</button></div>
    ${dec[uid].ack === "declined" ? `<input type="text" class="ta-why-in" data-why="${uid}" maxlength="500" placeholder="${hrStage ? "Why is it declined?" : "What is wrong in SBClient?"}" value="${esc(dec[uid].note || "")}" />` : ""}`;
  const rowsHtml = () => f.rows.map(x => `<tr style="cursor:default" class="${x.hrAck === "declined" && !hrStage ? "ta-declined" : ""}">
      <td>${esc(x.staffId)}</td><td>${esc(x.staffName)}</td><td>${esc(x.icNo)}</td><td>${fmtDate(x.date)}</td><td>${esc(x.branch)}</td>
      ${TA_TIMES.map(([k]) => `<td>${hrFix ? `<input type="time" data-t="${k}" data-uid="${x.uid}" value="${esc(dec[x.uid].times[k] || "")}" />` : esc(x.times[k] || "-")}</td>`).join("")}
      <td>${esc(x.reason || "-")}</td><td>${esc(x.remark || "-")}</td>
      <td class="ta-ev">${x.files.map(fl => `<a href="/api/ta/files/${fl.id}" target="_blank" rel="noopener" class="ta-evlink">📎 ${esc(fl.name)}</a>`).join("") || "-"}</td>
      <td>${hrStage ? pick(x.uid) : pill(x.hrAck, x.hrNote)}</td>
      ${showUser ? `<td>${ackStage ? pick(x.uid) : pill(x.userAck, x.userNote)}</td>` : ""}</tr>`).join("");
  const note = hrStage ? (hrFix ? "The outlet checked SBClient and declined line(s) – see “User Acknowledge”. Correct SBClient (and the times here if needed), tick every line and press Complete again."
      : "Check each line: ✔ acknowledge or ⊖ decline it (type why). Declined lines go back to the outlet (Incomplete). When every line is ticked, change the times in SBClient and press Complete.")
    : ackStage ? "HR has completed this form. Check the times in SBClient: ✔ acknowledge each line, or ⊖ decline it and type what is wrong. Without an answer it is acknowledged automatically 24 hours after completion."
    : taMineEdit(f) && f.status === "incomplete" ? "HR declined some lines – press ✎ Edit, correct them and submit again."
    : d.mine && f.status === "submitted" ? "Waiting for HR. You can still ✎ Edit the form until HR opens it (Processing)."
    : d.mine && f.status === "processing" ? "HR is processing this form – it can no longer be changed." : "";
  $("#app").innerHTML = `
    <div class="page-head"><div><a href="#/ta" style="text-decoration:none;font-weight:600">← Time Adjustment Listing</a>
      <h1 style="margin-top:6px">Time Adjustment Details</h1>
      <div class="sub">${esc(f.docNo)} · made by ${esc(f.createdBy)} on ${fmtTime(f.createdAt)}
        ${f.completedAt ? ` · completed by ${esc(f.completedBy)} ${fmtTime(f.completedAt)}` : ""}
        ${f.acknowledgedAt ? ` · acknowledged by ${esc(f.acknowledgedBy)} ${fmtTime(f.acknowledgedAt)}` : ""}
        ${f.cancelledAt ? ` · cancelled by ${esc(f.cancelledBy)}${f.cancelReason ? ` – ${esc(f.cancelReason)}` : ""}` : ""}</div></div>
      <div class="actions">${taMineEdit(f) ? `<a class="btn" href="#/ta/${id}/edit">✎ Edit</a>` : ""}<button class="btn" id="taPrintBtn">🖨 Print</button>
        ${canCancel ? `<button class="btn btn-danger" id="taCancelBtn">Cancel</button>` : ""}</div></div>
    ${note ? `<div class="card ta-stage"><div class="card-body">${esc(note)}</div></div>` : ""}
    <div class="card mc-form"><div class="card-body">${taHead(f)}
      <div class="table-wrap"><table class="ta-grid ta-view"><thead><tr><th>Staff ID</th><th>Staff Name</th><th>IC</th><th>Date</th><th>Branch</th>
        ${TA_TIMES.map(([, l]) => `<th>${l}</th>`).join("")}<th>Reason Code</th><th>Remark</th><th>Evidence</th><th>HR Acknowledge</th>
        ${showUser ? "<th>User Acknowledge</th>" : ""}</tr></thead><tbody id="taView">${rowsHtml()}</tbody></table></div>
      <label class="check-line ta-agree"><input type="checkbox" disabled ${f.agreed ? "checked" : ""} /> <span>${TA_AGREE}</span></label>
      ${hrStage ? `<div class="mc-actions"><a class="btn" href="#/ta">Back</a><button type="button" class="btn" id="taAllOk">✔ Tick all</button>
          <button type="button" class="btn btn-primary" id="taHrSave">Save</button>
          <button type="button" class="btn btn-success" id="taComplete" title="Every line ticked and SBClient updated">✔ Complete</button></div>`
        : ackStage ? `<div class="mc-actions"><a class="btn" href="#/ta">Back</a><button type="button" class="btn" id="taAllOk">✔ Acknowledge all</button>
          <button type="button" class="btn btn-success" id="taAckSend">Submit</button></div>` : `<div class="mc-actions"><a class="btn" href="#/ta">Back</a></div>`}
    </div></div>
    <div class="card"><div class="card-head"><h2>History</h2></div>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
      ${d.history.map(h => `<tr style="cursor:default"><td class="muted" style="white-space:nowrap">${fmtTime(h.at)}</td><td>${esc(h.by)}</td>
        <td>${esc((h.field ? h.field + ": " : "") + (h.old ? h.old + " → " : "") + (h.new || h.action))}</td></tr>`).join("")}</tbody></table></div></div>`;
  $("#taPrintBtn").onclick = () => taPrint(f);
  if ($("#taCancelBtn")) $("#taCancelBtn").onclick = () => taCancel(id, () => renderTaView(id));
  if (!hrStage && !ackStage) return;
  const redraw = () => {
    $("#taView").innerHTML = rowsHtml();
    if ($("#taHrSave")) $("#taHrSave").textContent = Object.values(dec).some(v => v.ack === "declined") ? "Return as Incomplete" : "Save";
  };
  redraw();
  const view = $("#taView");
  view.addEventListener("click", e => {
    const b = e.target.closest("[data-ack]");
    if (!b) return;
    const v = dec[b.dataset.uid];
    v.ack = v.ack === b.dataset.ack ? "" : b.dataset.ack;
    redraw();
    if (v.ack === "declined") view.querySelector(`[data-why="${b.dataset.uid}"]`)?.focus();
  });
  view.addEventListener("input", e => {
    if (e.target.dataset.why) dec[e.target.dataset.why].note = e.target.value;
    if (e.target.dataset.t) dec[e.target.dataset.uid].times[e.target.dataset.t] = e.target.value;
  });
  $("#taAllOk").onclick = () => { Object.values(dec).forEach(v => { v.ack = "ok"; v.note = ""; }); redraw(); };
  const lines = () => Object.fromEntries(Object.entries(dec).map(([k, v]) => [k, { ack: v.ack, note: v.note, ...(hrFix ? { times: v.times } : {}) }]));
  if (hrStage) {
    const send = async action => {
      try {
        const fm = (await api("POST", `/api/ta/${id}/hr`, { action, lines: lines() })).form;
        toast(fm.status === "completed" ? `${fm.docNo} completed – the outlet will check SBClient` : fm.status === "incomplete" ? `${fm.docNo} returned to the outlet – Incomplete` : "Saved");
        renderTaView(id);
      } catch (ex) { tell(ex.message); }
    };
    $("#taHrSave").onclick = () => send("save");
    $("#taComplete").onclick = () => send("complete");
  } else {
    $("#taAckSend").onclick = async () => {
      try {
        const fm = (await api("POST", `/api/ta/${id}/ack`, { lines: lines() })).form;
        toast(fm.status === "acknowledged" ? `${fm.docNo} acknowledged` : `${fm.docNo} returned to HR – Incomplete`);
        renderTaView(id);
      } catch (ex) { tell(ex.message); }
    };
  }
}

function taPrint(f) {
  const w = window.open("", "_blank");
  if (!w) { tell("Allow pop-ups for this site to print."); return; }
  w.document.write(`<!doctype html><title>${esc(f.docNo)} Time Adjustment</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#111;padding:14px 20px;font-size:12px} h2{margin:6px 0 2px;color:#1e3a8a}
    table{border-collapse:collapse;width:100%;margin:8px 0} td,th{border:1px solid #888;padding:4px 6px;text-align:left;vertical-align:top} th{background:#f1f5f9}
    @page{size:A4 landscape;margin:10mm}</style>
    <img src="/letterhead.png" style="width:100%;max-height:100px;object-fit:contain" onerror="this.remove()" />
    <h2>TIME ADJUSTMENT FORM</h2>
    <table><tr><th>Document ID</th><th>Status</th><th>Created ID</th><th>Created Date</th><th>Created Time</th><th>Completed ID</th></tr>
      <tr><td>${esc(f.docNo)}</td><td>${esc((TA_STATUS[f.status] || [f.status])[0])}</td><td>${esc(f.createdUser)}</td><td>${taDay(f.createdAt)}</td><td>${taClock(f.createdAt)}</td><td>${esc(f.completedUser)}</td></tr></table>
    <table><tr><th>Staff ID</th><th>Staff Name</th><th>IC</th><th>Date</th><th>Branch</th>${TA_TIMES.map(([, l]) => `<th>${l}</th>`).join("")}<th>Reason Code</th><th>Remark</th><th>HR</th><th>User</th></tr>
      ${f.rows.map(x => `<tr><td>${esc(x.staffId)}</td><td>${esc(x.staffName)}</td><td>${esc(x.icNo)}</td><td>${fmtDate(x.date)}</td><td>${esc(x.branch)}</td>
        ${TA_TIMES.map(([k]) => `<td>${esc(x.times[k] || "-")}</td>`).join("")}<td>${esc(x.reason || "-")}</td><td>${esc(x.remark || "-")}</td>
        <td>${x.hrAck === "ok" ? "Acknowledged" : x.hrAck === "declined" ? "Declined" : ""}</td><td>${x.userAck === "ok" ? "Acknowledged" : x.userAck === "declined" ? "Declined" : ""}</td></tr>`).join("")}</table>
    <p>${f.agreed ? "☑" : "☐"} ${TA_AGREE}</p><p style="color:#666">Printed ${new Date().toLocaleString("en-GB")}</p>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// ---------------- Warehouse Dept: Online Shop Delivery (Carrier Manifest) - list, basic info, scan, print
const WH_STATUS = { open: ["Scanning", "mcs-processing"], locked: ["Locked", "mcs-completed"], cancelled: ["Cancelled", "mcs-rejected"] };
const whBadge = st => { const [l, c] = WH_STATUS[st] || [st, ""]; return `<span class="mcs ${c}">${esc(l)}</span>`; };
const whDate = v => v ? fmtDate(v.slice(0, 10)) + (v.length > 10 ? " " + v.slice(11, 16) : "") : "";
const whNow = () => { const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
let whFind = { status: "", q: "", tracking: "", page: 1 };
const whPref = (k, v) => { try { if (v === undefined) return localStorage.getItem("portal.wh." + k) === "1"; localStorage.setItem("portal.wh." + k, v ? "1" : "0"); } catch { return false; } };
let whAudio;
function whBeep(ok) {                                          // short high beep = added, low double beep = refused
  try {
    whAudio = whAudio || new (window.AudioContext || window.webkitAudioContext)();
    const tone = (f, t0, len) => {
      const o = whAudio.createOscillator(), g = whAudio.createGain();
      o.frequency.value = f; o.type = ok ? "sine" : "square"; g.gain.value = ok ? 0.15 : 0.2;
      o.connect(g); g.connect(whAudio.destination); o.start(whAudio.currentTime + t0); o.stop(whAudio.currentTime + t0 + len);
    };
    if (ok) tone(1400, 0, 0.08); else { tone(300, 0, 0.18); tone(300, 0.25, 0.18); }
  } catch { /* no sound on this browser */ }
  if (!ok && navigator.vibrate) navigator.vibrate([150, 80, 150]);
}

async function renderWhList() {
  let d;
  try { d = await api("GET", "/api/wh" + (whFind.tracking ? "?tracking=" + encodeURIComponent(whFind.tracking) : "")); }
  catch (ex) { toast(ex.message); location.replace("#/general"); return; }
  const list = d.manifests, count = st => list.filter(m => m.status === st).length;
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>Carrier Manifest List</h1>
      <div class="sub">Online Shop Delivery – Warehouse Dept · the parcels handed over to each courier, scanned by tracking number.</div></div>
      <div class="actions">${d.edit ? `<button class="btn" id="whSetBtn">⚙ Couriers &amp; channels</button>
        <a class="btn btn-primary" href="#/wh/new">+ New Carrier Manifest</a>` : ""}</div></div>
    <div class="stats mc-stats">${Object.entries(WH_STATUS).map(([k, [l]]) => `<div class="stat wh-stat ${whFind.status === k ? "on" : ""}" data-st="${k}"
      title="Show ${l} only"><div class="n">${count(k)}</div><div class="l">${l}</div></div>`).join("")}</div>
    <div class="card">
      <div class="card-head ta-tools"><input type="search" id="whQ" placeholder="Search manifest no, title, courier, channel…" value="${esc(whFind.q)}" />
        <form id="whTrForm" class="wh-trfind"><input type="search" id="whTr" placeholder="Find a tracking number…" value="${esc(whFind.tracking)}" />
          <button class="btn btn-sm" type="submit">Find</button></form></div>
      ${whFind.tracking ? `<div class="wh-note">Manifests with tracking number <strong>${esc(whFind.tracking)}</strong> · <a href="#" id="whTrClear">show all</a></div>` : ""}
      <div class="table-wrap"><table class="mc-table">
        <thead><tr><th>Manifest No</th><th>Title</th><th>Date</th><th>Courier Company</th><th>Channel</th><th style="text-align:center">Parcels</th><th>Status</th><th>Created By</th>${isSuper() ? "<th></th>" : ""}</tr></thead>
        <tbody id="whList"></tbody></table></div>
      <div class="mc-pager"><span class="muted" id="whInfo"></span><span id="whPages"></span></div>
    </div>`;
  const PER = 25;
  const draw = () => {
    const q = whFind.q.trim().toLowerCase();
    const rows = list.filter(m => (!whFind.status || m.status === whFind.status)
      && (!q || [m.docNo, m.title, m.docTitle, m.courier, m.channel, m.createdBy, m.remark].join(" ").toLowerCase().includes(q)));
    const pages = Math.max(1, Math.ceil(rows.length / PER)); whFind.page = Math.min(whFind.page, pages);
    const from = (whFind.page - 1) * PER, part = rows.slice(from, from + PER);
    $("#whList").innerHTML = part.length ? part.map(m => `<tr data-wh="${m.id}">
      <td><a href="#/wh/${m.id}"><strong>${esc(m.docNo)}</strong></a></td><td>${esc(m.title)}</td><td>${whDate(m.date)}</td>
      <td>${esc(m.courier || "-")}</td><td>${esc(m.channel || "-")}</td><td style="text-align:center"><strong>${m.count}</strong></td>
      <td>${whBadge(m.status)}</td><td>${esc(m.createdBy)}</td>
      ${isSuper() ? `<td><button type="button" class="btn btn-sm btn-danger" data-del="${m.id}" title="Delete ${esc(m.docNo)} for good (Super Admin)">🗑</button></td>` : ""}</tr>`).join("")
      : `<tr><td colspan="9" class="empty">${list.length ? "No manifest matches." : whFind.tracking ? "This tracking number is not on any manifest." : "No carrier manifest yet."}</td></tr>`;
    $("#whInfo").textContent = rows.length ? `Showing ${from + 1} to ${from + part.length} of ${rows.length} entries` : "";
    $("#whPages").innerHTML = pages > 1 ? `<button class="btn btn-sm" data-pg="${whFind.page - 1}" ${whFind.page === 1 ? "disabled" : ""}>Previous</button>
      <strong style="margin:0 8px">${whFind.page} / ${pages}</strong><button class="btn btn-sm" data-pg="${whFind.page + 1}" ${whFind.page === pages ? "disabled" : ""}>Next</button>` : "";
    document.querySelectorAll(".wh-stat").forEach(x => x.classList.toggle("on", x.dataset.st === whFind.status));
  };
  draw();
  $("#whQ").oninput = e => { whFind.q = e.target.value; whFind.page = 1; draw(); };
  $("#whTrForm").onsubmit = e => { e.preventDefault(); whFind.tracking = $("#whTr").value.trim(); whFind.page = 1; renderWhList(); };
  if ($("#whTrClear")) $("#whTrClear").onclick = e => { e.preventDefault(); whFind.tracking = ""; renderWhList(); };
  document.querySelector(".stats").onclick = e => { const s = e.target.closest("[data-st]"); if (s) { whFind.status = whFind.status === s.dataset.st ? "" : s.dataset.st; whFind.page = 1; draw(); } };
  $("#whPages").onclick = e => { const b = e.target.closest("[data-pg]"); if (b && !b.disabled) { whFind.page = +b.dataset.pg; draw(); } };
  $("#whList").onclick = e => {
    const del = e.target.closest("[data-del]");
    if (del) { whDelete(list.find(m => m.id === del.dataset.del), renderWhList); return; }
    const tr = e.target.closest("[data-wh]"); if (tr && !e.target.closest("a")) location.hash = "#/wh/" + tr.dataset.wh;
  };
  if ($("#whSetBtn")) $("#whSetBtn").onclick = () => { location.hash = "#/settings/wh"; };
}

// Settings > Program Settings > Warehouse Dept: courier companies (+ start of their tracking numbers) and channels
async function renderWhSettings() {
  let d;
  try { d = await api("GET", "/api/wh/settings"); } catch (ex) { toast(ex.message); location.replace("#/settings"); return; }
  const cs = d.couriers.map(x => ({ name: x.name, pre: x.prefixes.join(", ") })), ch = [...d.channels];
  const back = isSuper() || me.role === "admin" ? `<a href="#/settings">Settings</a>` : `<a href="#/wh">Carrier Manifest List</a>`;
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs">${back} › <span>Courier &amp; Channel Setting</span></div>
        <h1 style="margin-top:6px">Courier &amp; Channel Setting</h1>
        <div class="sub">Warehouse Dept › Online Shop Delivery – the choices of Courier Company and Channel on the Carrier Manifest.</div>
      </div>
      <div class="actions"><button class="btn btn-primary" id="whsSave">💾 Save</button></div>
    </div>
    <div class="hrs-grid">
      <div class="card">
        <div class="prog-title">🚚 Courier Company list <span class="muted" id="whsCN" style="font-weight:400;font-size:12px"></span></div>
        <div class="hrs-body">
          <div class="hrs-note">Tracking numbers start with (optional, separate with commas) – e.g. <strong>7027, 7028</strong> for DHL Ecommerce. A scanned number that does not start like that
            is refused (“does not belong to the courier”). Leave it empty to accept every number.</div>
          <div class="hrs-row hrs-head"><span style="flex:1">Courier Company</span><span style="flex:1">Tracking numbers start with</span><span style="width:34px"></span></div>
          <div id="whsC"></div>
          <div class="hrs-btns"><button class="btn btn-sm" id="whsAddC">+ Add courier company</button></div>
        </div>
      </div>
      <div class="card">
        <div class="prog-title">🛒 Channel list <span class="muted" id="whsHN" style="font-weight:400;font-size:12px"></span></div>
        <div class="hrs-body">
          <div class="hrs-note">Where the orders come from – e.g. Shopee, Lazada, TikTok Shop.</div>
          <div id="whsH"></div>
          <div class="hrs-btns"><button class="btn btn-sm" id="whsAddH">+ Add channel</button></div>
        </div>
      </div>
    </div>`;
  const draw = () => {
    $("#whsC").innerHTML = cs.map((x, i) => `<div class="hrs-row"><input type="text" data-cn="${i}" value="${esc(x.name)}" maxlength="100" placeholder="e.g. DHL Ecommerce" style="flex:1" />
      <input type="text" data-cp="${i}" value="${esc(x.pre)}" maxlength="200" placeholder="e.g. 7027, 7028" style="flex:1" />
      <button class="btn btn-sm" data-delc="${i}" title="Remove">✕</button></div>`).join("") || `<div class="muted" style="padding:6px 0">No courier company yet.</div>`;
    $("#whsH").innerHTML = ch.map((x, i) => `<div class="hrs-row"><input type="text" data-hn="${i}" value="${esc(x)}" maxlength="100" placeholder="e.g. Shopee" />
      <button class="btn btn-sm" data-delh="${i}" title="Remove">✕</button></div>`).join("") || `<div class="muted" style="padding:6px 0">No channel yet.</div>`;
    $("#whsCN").textContent = `(${cs.length})`; $("#whsHN").textContent = `(${ch.length})`;
  };
  draw();
  $(".hrs-grid").oninput = e => {
    const t = e.target, ds = t.dataset;
    if (ds.cn !== undefined) cs[+ds.cn].name = t.value;
    else if (ds.cp !== undefined) cs[+ds.cp].pre = t.value;
    else if (ds.hn !== undefined) ch[+ds.hn] = t.value;
  };
  $(".hrs-grid").onclick = e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.id === "whsAddC") { cs.push({ name: "", pre: "" }); draw(); $(`[data-cn="${cs.length - 1}"]`).focus(); }
    else if (b.id === "whsAddH") { ch.push(""); draw(); $(`[data-hn="${ch.length - 1}"]`).focus(); }
    else if (b.dataset.delc !== undefined) { cs.splice(+b.dataset.delc, 1); draw(); }
    else if (b.dataset.delh !== undefined) { ch.splice(+b.dataset.delh, 1); draw(); }
  };
  $("#whsSave").onclick = async () => {
    try {
      const r = await api("PUT", "/api/wh/settings", { couriers: cs.map(x => ({ name: x.name, prefixes: x.pre.split(/[,\s]+/).filter(Boolean) })), channels: ch });
      cs.splice(0, cs.length, ...r.couriers.map(x => ({ name: x.name, pre: x.prefixes.join(", ") }))); ch.splice(0, ch.length, ...r.channels);
      draw(); toast("Courier & channel setting saved");
    } catch (ex) { tell(ex.message); }
  };
}

async function renderWhForm(id) {
  let d, m = null;
  try {
    if (id) { d = await api("GET", `/api/wh/${id}`); m = d.manifest; }
    else d = await api("GET", "/api/wh");
  } catch (ex) { toast(ex.message); location.replace("#/wh"); return; }
  if (!d.edit) { location.replace(id ? `#/wh/${id}` : "#/wh"); return; }
  if (m && m.status === "cancelled") { location.replace(`#/wh/${id}`); return; }
  const opt = (list, v) => `<option value="">${list === d.channels ? "Please select a channel" : "Any courier (no check)"}</option>`
    + list.map(x => { const n = x.name || x; return `<option ${n === v ? "selected" : ""}>${esc(n)}</option>`; }).join("");
  $("#app").innerHTML = `
    <div class="page-head"><div>${m ? `<a href="#/wh/${id}" style="text-decoration:none;font-weight:600">← ${esc(m.docNo)}</a>` : `<a href="#/wh" style="text-decoration:none;font-weight:600">← Carrier Manifest List</a>`}
      <h1>${m ? "Edit Carrier Manifest" : "New Carrier Manifest"}</h1></div></div>
    <form class="card wh-form" id="whForm" autocomplete="off">
      <h2 class="wh-h">Basic Info</h2>
      <label class="field"><span>Title <b class="req">*</b></span><input type="text" name="title" maxlength="200" required value="${esc(m?.title || "")}" />
        <small class="muted">Title of the Carrier Manifest list used for your reference. Eg: Shopee Pos Laju 25-01 - Steven</small></label>
      <label class="field"><span>Document Title <b class="req">*</b></span><input type="text" name="docTitle" maxlength="200" required value="${esc(m?.docTitle || "")}" />
        <small class="muted">Title of the Carrier Manifest list that will appear on the document by clicking "Print". Eg: Shopee Pos Laju 25-01</small></label>
      <div class="wh-2">
        <label class="field"><span>Date <b class="req">*</b></span><input type="datetime-local" name="date" required value="${esc(m?.date || whNow())}" /></label>
        <label class="field"><span>Channel</span><select name="channel">${opt(d.channels, m?.channel)}</select></label>
        <label class="field"><span>Courier Company</span><select name="courier">${opt(d.couriers, m?.courier)}</select>
          <small class="muted">It will verify each parcel scanned to ensure you hand over the right parcels to the courier company. It will alert you if the tracking number scanned does not belong to the selected courier company.</small></label>
        <div class="field"><span>Allow Edit</span><label class="wh-switch"><input type="checkbox" name="allowEdit" ${m ? (m.allowEdit ? "checked" : "") : "checked"} /><i></i></label>
          <small class="muted">You can disable it after finished scanning for this batch of parcels, to prevent further changes on the Carrier Manifest list.</small></div>
        <label class="field"><span>Remark</span><input type="text" name="remark" maxlength="500" value="${esc(m?.remark || "")}" /></label>
      </div>
      <div class="form-error" id="whErr"></div>
      ${m ? `<div class="mc-actions"><a class="btn" href="#/wh/${id}">Back</a><button class="btn btn-primary" type="submit">Save</button></div>`
        : `<button class="btn wh-start" type="submit">▥ Start Scan</button>`}
    </form>`;
  const f = $("#whForm");
  let docTouched = !!m;                                         // Document Title follows Title until it is typed in itself
  f.docTitle.oninput = () => { docTouched = true; };
  f.title.oninput = () => { if (!docTouched) f.docTitle.value = f.title.value; };
  if (!m) f.title.focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const body = { title: f.title.value, docTitle: f.docTitle.value, date: f.date.value, channel: f.channel.value, courier: f.courier.value,
      allowEdit: f.allowEdit.checked, remark: f.remark.value };
    const btn = f.querySelector('[type="submit"]'); btn.disabled = true; $("#whErr").textContent = "";
    try {
      const r = await api(m ? "PUT" : "POST", m ? `/api/wh/${id}` : "/api/wh", body);
      toast(m ? "Saved" : `${r.manifest.docNo} created – start scanning`);
      location.hash = `#/wh/${r.manifest.id}`;
    } catch (ex) { $("#whErr").textContent = ex.message; btn.disabled = false; }
  };
}

async function renderWhScan(id) {
  let d;
  try { d = await api("GET", `/api/wh/${id}`); } catch (ex) { toast(ex.message); location.replace("#/wh"); return; }
  let m = d.manifest;
  const canScan = () => d.edit && m.status === "open";
  $("#app").innerHTML = `
    <div class="page-head"><div><a href="#/wh" style="text-decoration:none;font-weight:600">← Carrier Manifest List</a>
      <h1>${esc(m.docNo)} <span id="whBadge">${whBadge(m.status)}</span></h1>
      <div class="sub" id="whInfoLine"></div></div>
      <div class="actions">${d.edit && m.status !== "cancelled" ? `<a class="btn" href="#/wh/${id}/edit">✎ Edit info</a>` : ""}
        ${d.edit && m.status !== "cancelled" ? `<button class="btn" id="whLock"></button>` : ""}
        ${d.edit && m.status !== "cancelled" ? `<button class="btn btn-danger" id="whCancel">Cancel</button>` : ""}
        ${isSuper() ? `<button class="btn btn-danger" id="whDelBtn" title="Super Admin">🗑 Delete</button>` : ""}</div></div>
    ${m.status === "cancelled" ? `<div class="cancel-banner"><strong>Cancelled by:</strong> ${esc(m.cancelledBy)} · ${taDay(m.cancelledAt)} ${taClock(m.cancelledAt)}<br>
      <strong>Reason:</strong> ${m.cancelReason ? esc(m.cancelReason) : `<span style="opacity:.75">(no reason given)</span>`}</div>` : ""}
    <div class="card wh-scan">
      <div class="wh-scan-head"><h2 class="wh-h">${esc(m.title)} <span class="wh-count" id="whCount"></span></h2>
        <div class="wh-tools">${d.edit && m.status !== "cancelled" ? `
          <label class="wh-pill" title="On = tap ✕ on a tracking number to take it off"><input type="checkbox" id="whDel" /><i></i><span></span></label>
          <label class="wh-pill" title="Off = only the barcode scanner can enter numbers (no typing by hand)"><input type="checkbox" id="whType" /><i></i><span></span></label>` : ""}
          <button class="btn btn-sm wh-print" id="whPrint">🖨 Print</button></div></div>
      <label class="field wh-input"><span>Tracking Number</span>
        <span class="wh-inrow"><input type="text" id="whIn" inputmode="text" autocomplete="off" autocapitalize="characters" spellcheck="false" />
          ${d.edit && m.status !== "cancelled" ? `<button type="button" class="btn wh-cambtn" id="whCam" title="Scan barcodes with the phone camera">📷 Camera</button>` : ""}</span></label>
      <div class="wh-msg" id="whMsg" role="status"></div>
      <div class="wh-grid" id="whGrid"></div>
    </div>`;
  const inp = $("#whIn");
  const info = () => {
    $("#whInfoLine").innerHTML = [whDate(m.date), m.courier ? "🚚 " + esc(m.courier) : "Any courier", m.channel ? "🛒 " + esc(m.channel) : "",
      "Document Title: " + esc(m.docTitle), m.remark ? "Remark: " + esc(m.remark) : ""].filter(Boolean).join(" · ");
    $("#whBadge").innerHTML = whBadge(m.status);
    $("#whCount").textContent = `${m.count} parcel${m.count === 1 ? "" : "s"}`;
    if ($("#whLock")) $("#whLock").textContent = m.allowEdit ? "🔒 Finish & lock" : "🔓 Allow Edit";
    inp.disabled = !canScan();
    if ($("#whCam")) $("#whCam").hidden = !canScan();
    inp.placeholder = canScan() ? "Scan the barcode and press Enter"
      : m.status === "locked" ? "Locked – Allow Edit is off" : m.status === "cancelled" ? "Cancelled" : "View only";
  };
  const draw = () => {
    const del = $("#whDel")?.checked && canScan(), n = m.parcels.length;
    $("#whGrid").innerHTML = n ? m.parcels.map((p, i) => ({ p, i })).reverse().map(({ p, i }) => `<div class="wh-cell" title="${esc(p.by)} · ${taDay(p.at)} ${taClock(p.at)}">
        <span class="wh-no">${i + 1}.</span><span class="wh-tr">${esc(p.tracking)}</span>
        ${del ? `<button type="button" class="wh-x" data-rm="${p.id}" title="Take ${esc(p.tracking)} off">✕</button>` : ""}</div>`).join("")
      : `<div class="empty" style="grid-column:1/-1">No parcel scanned yet.</div>`;
    info();
  };
  const msg = (text, ok) => {
    const el = $("#whMsg"); el.className = "wh-msg " + (ok ? "ok" : "bad"); el.textContent = text;
    whBeep(ok);
    if (!ok) { el.classList.remove("shake"); void el.offsetWidth; el.classList.add("shake"); }
  };
  const pills = () => document.querySelectorAll(".wh-pill").forEach(l => {
    const on = l.querySelector("input").checked;
    l.classList.toggle("on", on);
    l.querySelector("span").textContent = (l.querySelector("#whDel") ? "Delete " : "Typing ") + (on ? "On" : "Off");
  });
  if ($("#whDel")) { $("#whDel").checked = whPref("delete"); $("#whType").checked = whPref("typing"); pills();
    $("#whDel").onchange = e => { whPref("delete", e.target.checked); pills(); draw(); inp.focus(); };
    $("#whType").onchange = e => { whPref("typing", e.target.checked); pills(); inp.focus(); }; }
  draw();
  if (canScan()) inp.focus();

  // Typing Off: only a barcode scanner may fill the box - a scanner sends all characters within a few milliseconds each
  let keys = [], busy = false;
  inp.addEventListener("keydown", e => { if (e.key.length === 1) { if (!inp.value) keys = []; keys.push(performance.now()); } });
  inp.addEventListener("paste", e => { if (!$("#whType")?.checked) { e.preventDefault(); msg("Typing is Off – pasting is not allowed. Scan the barcode, or turn Typing On.", false); } });
  inp.addEventListener("keydown", async e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const val = inp.value.trim();
    if (!val || busy) return;
    const gaps = keys.slice(1).map((t, i) => t - keys[i]), slow = gaps.length >= 3 && gaps.sort((a, b) => a - b)[Math.floor(gaps.length / 2)] > 40;
    if (!$("#whType")?.checked && (slow || keys.length < val.length)) {
      inp.value = ""; keys = [];
      msg("Typing is Off – scan the barcode with the scanner, or turn Typing On to type the number.", false); return;
    }
    await add(val);
    inp.value = ""; keys = []; inp.focus();
  });
  // one tracking number to the server - from the scanner / keyboard or from the camera
  async function add(val) {
    if (busy) return null;
    busy = true;
    let ok = false, text;
    try {
      const r = await api("POST", `/api/wh/${id}/scan`, { tracking: val });
      m = r.manifest; draw(); text = `✔ ${r.added} added – No. ${m.count}`; ok = true;
    } catch (ex) { text = "✖ " + ex.message; }
    msg(text, ok);
    busy = false;
    return { ok, text };
  }
  if ($("#whCam")) $("#whCam").onclick = () => whCamera(add);
  $("#whGrid").onclick = async e => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    const p = m.parcels.find(x => x.id === b.dataset.rm);
    if (!await ask(`Take ${p.tracking} off this manifest?`, "Take off")) return;
    try { m = (await api("POST", `/api/wh/${id}/remove`, { parcelId: p.id })).manifest; draw(); toast(`${p.tracking} taken off`); }
    catch (ex) { tell(ex.message); }
    inp.focus();
  };
  $("#whPrint").onclick = () => whPrint(m);
  if ($("#whDelBtn")) $("#whDelBtn").onclick = () => whDelete(m, () => { location.hash = "#/wh"; });
  if ($("#whLock")) $("#whLock").onclick = async () => {
    if (m.allowEdit && !await ask(`Finish ${m.docNo} with ${m.count} parcel(s)? Allow Edit is turned off – no more scanning or taking off until it is turned on again.`, "Finish & lock")) return;
    try { m = (await api("PUT", `/api/wh/${id}`, { allowEdit: !m.allowEdit })).manifest; draw(); toast(m.allowEdit ? "Allow Edit is on" : `${m.docNo} locked`); if (canScan()) inp.focus(); }
    catch (ex) { tell(ex.message); }
  };
  if ($("#whCancel")) $("#whCancel").onclick = () => openDialog(`<h3>Cancel ${esc(m.docNo)}?</h3>
      <p class="muted" style="margin-top:0">Its ${m.count} tracking number(s) can then be scanned on another manifest.</p>
      <label class="field"><span>Reason for cancelling <b class="req">*</b></span><input type="text" name="reason" maxlength="300" required /></label>`,
    async form => { await api("POST", `/api/wh/${id}/cancel`, { reason: form.reason.value }); toast(`${m.docNo} cancelled`); renderWhScan(id); }, "Cancel manifest");
}

// Phone camera scanning: the browser's own barcode reader (Android Chrome) or the ZXing library (iPhone and others).
// It keeps scanning - every barcode read goes straight to the manifest; the same code is not sent twice within 3 seconds.
let whZx;
function whLoadZxing() {
  if (window.ZXing) return Promise.resolve();
  return whZx = whZx || new Promise((ok, bad) => {
    const sc = document.createElement("script");
    sc.src = "https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js";
    sc.onload = ok; sc.onerror = () => { whZx = null; bad(new Error("The barcode reader could not be loaded – check the internet connection.")); };
    document.head.appendChild(sc);
  });
}
async function whCamera(add) {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    tell("The phone camera only works on the secure address https://portal.example.com (not on an http:// address). Open the portal there, or use a barcode scanner.");
    return;
  }
  const ov = document.createElement("div");
  ov.className = "wh-cam";
  ov.innerHTML = `<div class="wh-cam-top"><strong>📷 Scan barcode</strong><button type="button" class="btn btn-sm" data-close>✕ Close</button></div>
    <div class="wh-cam-view"><video playsinline muted></video><div class="wh-cam-line"></div></div>
    <div class="wh-cam-msg">Starting the camera…</div>
    <div class="wh-cam-hint">Hold the barcode inside the frame, about 10–20 cm away. Each parcel is added by itself.</div>`;
  document.body.appendChild(ov);
  const video = ov.querySelector("video"), out = ov.querySelector(".wh-cam-msg");
  let stream = null, timer = null, zx = null, closed = false, last = "", lastAt = 0, wait = false;
  const close = () => {
    if (closed) return; closed = true;
    clearInterval(timer); try { zx?.reset(); } catch { /* already stopped */ }
    stream?.getTracks().forEach(t => t.stop());
    ov.remove(); window.removeEventListener("hashchange", close);
    $("#whIn")?.focus();
  };
  ov.querySelector("[data-close]").onclick = close;
  window.addEventListener("hashchange", close);
  const got = async code => {
    code = String(code || "").trim();
    const now = Date.now();
    if (!code || wait || closed || (code === last && now - lastAt < 3000)) return;
    last = code; lastAt = now; wait = true;
    out.textContent = code + " …";
    const r = await add(code);
    if (r) { out.textContent = r.text; out.className = "wh-cam-msg " + (r.ok ? "ok" : "bad"); }
    setTimeout(() => { wait = false; }, 900);
  };
  try {
    let fmts = [];
    if ("BarcodeDetector" in window) { try { fmts = await BarcodeDetector.getSupportedFormats(); } catch { fmts = []; } }
    if (fmts.length) {                                         // Android Chrome: built in, fast
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
      if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
      video.srcObject = stream; await video.play();
      const det = new BarcodeDetector({ formats: fmts.filter(f => f !== "unknown") });
      out.textContent = "Point the camera at a barcode";
      let running = false;
      timer = setInterval(async () => {
        if (running || wait || closed || video.readyState < 2) return;
        running = true;
        try { const res = await det.detect(video); if (res.length) got(res[0].rawValue); } catch { /* next frame */ }
        running = false;
      }, 200);
    } else {                                                   // iPhone and others: ZXing
      await whLoadZxing();
      if (closed) return;
      zx = new ZXing.BrowserMultiFormatReader();
      out.textContent = "Point the camera at a barcode";
      await zx.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video, res => { if (res) got(res.getText()); });
      stream = video.srcObject;
    }
  } catch (ex) {
    out.className = "wh-cam-msg bad";
    out.textContent = ex.name === "NotAllowedError" ? "Camera permission was refused – allow the camera for this site in the browser settings, then try again."
      : ex.name === "NotFoundError" ? "No camera found on this device." : ex.message || String(ex);
  }
}

function whDelete(m, after) {
  openDialog(`<h3>🗑 Delete ${esc(m.docNo)} completely?</h3>
    <p style="margin:0">The manifest <strong>${esc(m.title)}</strong>, its ${m.count} scanned tracking number(s) and its history are removed for good – this cannot be undone.
      To keep it for record, use Cancel instead.</p>
    <label class="field"><span>Type <strong>${esc(m.docNo)}</strong> to confirm</span><input type="text" name="confirm" required autocomplete="off" /></label>`,
    async form => {
      await api("POST", `/api/wh/${m.id}/delete`, { confirm: form.confirm.value });
      $("#dialog").close(); toast(`${m.docNo} deleted`); after();
    }, "Delete for good");
}

function whPrint(m) {
  const w = window.open("", "_blank");
  if (!w) { tell("Allow pop-ups for this site to print."); return; }
  const cols = 3, per = Math.ceil(m.parcels.length / cols) || 1;
  const rows = Array.from({ length: per }, (_, r) => Array.from({ length: cols }, (_, c) => {
    const i = c * per + r, p = m.parcels[i];
    return p ? `<td class="n">${i + 1}</td><td>${esc(p.tracking)}</td>` : `<td class="n"></td><td></td>`;
  }).join("")).map(r => `<tr>${r}</tr>`).join("");
  w.document.write(`<!doctype html><title>${esc(m.docNo)} ${esc(m.docTitle)}</title><style>
    body{font-family:Segoe UI,Arial,sans-serif;color:#111;padding:10px 16px;font-size:12px} h2{margin:6px 0 4px;color:#1e3a8a;font-size:20px}
    table{border-collapse:collapse;width:100%;margin:8px 0} td,th{border:1px solid #888;padding:4px 6px;text-align:left} th{background:#f1f5f9}
    td.n{width:34px;color:#555;text-align:right} .info td{border:none;padding:2px 10px 2px 0} .total{font-size:15px;font-weight:700}
    .sign{display:flex;gap:24px;margin-top:26px} .sign div{flex:1;border:1px solid #888;padding:8px 10px;min-height:110px}
    .sign b{display:block;margin-bottom:46px} @page{size:A4;margin:10mm}
    .head{margin-bottom:6px}
    .head img{height:46px;width:auto;flex:none}</style>
    <div class="head"><img src="/logo.png" alt="Company" onerror="this.remove()" /></div><h2>${esc(m.docTitle)}</h2>
    <table class="info"><tr><td><b>Manifest No:</b> ${esc(m.docNo)}</td><td><b>Date:</b> ${whDate(m.date)}</td><td><b>Courier Company:</b> ${esc(m.courier || "-")}</td>
      <td><b>Channel:</b> ${esc(m.channel || "-")}</td></tr></table>
    ${m.remark ? `<p><b>Remark:</b> ${esc(m.remark)}</p>` : ""}
    <p class="total">Total parcels: ${m.count}</p>
    <table><tr>${"<th>No</th><th>Tracking Number</th>".repeat(cols)}</tr>${m.parcels.length ? rows : `<tr><td colspan="${cols * 2}">No parcel.</td></tr>`}</table>
    <div class="sign"><div><b>Handed over by (Company)</b>Name / Signature:<br><br>Date &amp; Time:</div>
      <div><b>Received by (${esc(m.courier || "courier")})</b>Name / Signature:<br><br>Date &amp; Time:</div></div>
    <p style="color:#666">Printed ${new Date().toLocaleString("en-GB")}${m.status === "cancelled" ? " · CANCELLED" : ""}</p>`);
  w.document.close();
  setTimeout(() => w.print(), 400);
}

// ---------------- Management: BI - Collection dashboard (demo: sample receipts, generated in the browser)
//   In a real install the server reads today's receipts from the ERP database (read-only login) every 30-60 seconds
//   and keeps past days in its own copy; this demo makes up receipts so the page can be tried without an ERP.
let biTimer = null;
function renderBiCollection() {
  clearTimeout(biTimer);
  let seed = 20261006;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  const pick = (arr, w) => { let x = rnd() * w.reduce((a, b) => a + b, 0); for (let i = 0; i < arr.length; i++) { x -= w[i]; if (x < 0) return arr[i]; } return arr[arr.length - 1]; };
  const OUTLETS = [["HQ", "HQ Showroom"], ["KPG", "Kepong"], ["PCG", "Puchong"], ["JB", "Johor Bahru"], ["PG", "Penang"], ["WEB", "Online Store"]];
  const OW = [1.6, 1.1, 1, 0.9, 0.8, 1.3];
  const METHODS = ["DuitNow QR", "Card", "Cash", "TNG eWallet", "Bank transfer", "Cheque"], MW = [30, 26, 18, 14, 9, 3];
  const B2B = ["Sample Trading Sdn Bhd", "Example Electrical Enterprise", "Demo Hardware & Lighting", "Test Home Appliances", "Placeholder Retail Sdn Bhd", "Mock Aircond Services"];
  const RETAIL = ["Cash Sale", "Walk-in Customer", "Online Order"];
  const OPEN = 8, CLOSE = 22;
  const now = new Date(), dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime(), yStart = dayStart - 86400e3;
  const LAST = dayStart + (CLOSE - 0.1) * 3600e3;
  let simNow = Math.min(Math.max(now.getTime(), dayStart + 11 * 3600e3), LAST - 3600e3);
  const ymd = d => `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const amount = m => m === "Bank transfer" || m === "Cheque" ? Math.round((1500 + rnd() ** 2 * 18000) * 100) / 100 : Math.round((25 + rnd() ** 2.4 * 2600) * 100) / 100;
  const rate = h => { const t = (h - OPEN) / (CLOSE - OPEN); return 0.25 + Math.sin(Math.PI * t) ** 1.4 + (h >= 19 && h < 21 ? 0.3 : 0); };
  const receipt = (t, no) => {
    const m = pick(METHODS, MW), o = pick(OUTLETS, OW);
    return { t, no, outlet: o[0], m, amt: amount(m), cust: m === "Bank transfer" || m === "Cheque" ? pick(B2B, B2B.map(() => 1)) : o[0] === "WEB" ? "Online Order" : pick(RETAIL, [6, 3, 1]) };
  };
  const makeDay = (start, until, prefix) => {
    const out = []; let t = start + OPEN * 3600e3;
    while (true) {
      const d = new Date(t); t += (60 + rnd() * 240) * 1000 / rate(d.getHours() + d.getMinutes() / 60);
      if (t >= Math.min(until, start + CLOSE * 3600e3)) break;
      out.push(receipt(t, `${prefix}-${String(out.length + 1).padStart(4, "0")}`));
    }
    return out;
  };
  const yday = makeDay(yStart, yStart + 86400e3, "OR" + ymd(new Date(yStart)));
  const today = makeDay(dayStart, simNow, "OR" + ymd(now));
  const mtdBefore = Array.from({ length: now.getDate() - 1 }, () => 26000 + rnd() * 16000).reduce((a, b) => a + b, 0), TARGET = 1150000;

  const rm = v => v.toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rm0 = v => v.toLocaleString("en-MY", { maximumFractionDigits: 0 });
  const hm = t => new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const pct = (a, b) => b ? (a - b) / b * 100 : 0;
  const delta = (a, b) => { const p = pct(a, b); return `<span class="${p >= 0 ? "bi-up" : "bi-down"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(1)}%</span> vs yesterday same time`; };
  let outletSel = "", paused = false;

  $("#app").innerHTML = `
    <div class="page-head"><div><h1>Collection</h1>
      <div class="sub">${now.toLocaleDateString("en-GB", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })} · amounts in RM</div></div>
      <div class="actions bi-tools"><span class="bi-live" id="biLive"><i></i><span id="biLiveTxt">Live</span></span>
        <select id="biOutlet"><option value="">All outlets</option>${OUTLETS.map(([c, n]) => `<option value="${c}">${c} – ${n}</option>`).join("")}</select>
        <button type="button" class="btn" id="biPause">Pause</button></div></div>
    <div class="bi-demo"><strong>Demo with sample data.</strong> Outlets, customers and amounts are made up. A real install reads the receipts from the ERP database (read-only) and refreshes every 30–60 seconds.</div>
    <div class="bi-kpis">
      <div class="bi-kpi"><div class="l">Collected today</div><div class="n" id="biToday"></div><div class="d" id="biTodayD"></div></div>
      <div class="bi-kpi"><div class="l">Receipts today</div><div class="n" id="biCount"></div><div class="d" id="biCountD"></div></div>
      <div class="bi-kpi"><div class="l">Average receipt</div><div class="n" id="biAvg"></div><div class="d" id="biAvgD"></div></div>
      <div class="bi-kpi"><div class="l">Month to date</div><div class="n" id="biMtd"></div><div class="d" id="biMtdD"></div><div class="bi-bar"><b id="biMtdBar"></b></div></div>
    </div>
    <div class="bi-grid">
      <div class="bi-col">
        <div class="card"><div class="bi-ch"><h2>Today by hour</h2><div class="bi-legend"><span>Today</span><span class="y">Yesterday</span></div></div>
          <div class="bi-cb"><svg id="biChart" viewBox="0 0 640 250" width="100%" role="img" aria-label="Cumulative collection today compared with yesterday"></svg></div></div>
        <div class="card"><div class="bi-ch"><h2>By payment method</h2><span class="muted" id="biPmTotal"></span></div><div class="bi-cb bi-rows" id="biMethods"></div></div>
      </div>
      <div class="bi-col">
        <div class="card"><div class="bi-ch"><h2>By outlet</h2><span class="muted">today vs yesterday same time</span></div>
          <div class="table-wrap"><table class="bi-table"><thead><tr><th>Outlet</th><th class="r">Receipts</th><th class="r">Collected (RM)</th><th class="r bi-hide">vs yday</th></tr></thead><tbody id="biOutlets"></tbody></table></div></div>
        <div class="card"><div class="bi-ch"><h2>Latest receipts</h2><span class="muted" id="biFeedN"></span></div>
          <div class="table-wrap bi-feed"><table class="bi-table"><thead><tr><th>Time</th><th>Receipt No</th><th class="bi-hide">Customer</th><th>Method</th><th class="r">RM</th></tr></thead><tbody id="biFeed"></tbody></table></div></div>
      </div>
    </div>`;

  const sum = a => a.reduce((s, r) => s + r.amt, 0);
  function draw(newNo) {
    if (!$("#biChart")) return;
    const f = r => !outletSel || r.outlet === outletSel, clock = simNow - dayStart;
    const T = today.filter(f), Y = yday.filter(f), Yat = Y.filter(r => r.t - yStart <= clock), tSum = sum(T), ySum = sum(Yat);
    $("#biToday").innerHTML = `<small>RM</small>${rm(tSum)}`; $("#biTodayD").innerHTML = delta(tSum, ySum);
    $("#biCount").textContent = T.length.toLocaleString("en-MY"); $("#biCountD").innerHTML = delta(T.length, Yat.length);
    const avg = T.length ? tSum / T.length : 0, yavg = Yat.length ? ySum / Yat.length : 0;
    $("#biAvg").innerHTML = `<small>RM</small>${rm(avg)}`; $("#biAvgD").innerHTML = delta(avg, yavg);
    const share = outletSel ? OW[OUTLETS.findIndex(o => o[0] === outletSel)] / OW.reduce((a, b) => a + b, 0) : 1;
    const mtd = mtdBefore * share + tSum, tgt = TARGET * share;
    $("#biMtd").innerHTML = `<small>RM</small>${rm0(mtd)}`; $("#biMtdD").textContent = `${(mtd / tgt * 100).toFixed(1)}% of RM ${rm0(tgt)} target`;
    $("#biMtdBar").style.width = Math.min(100, mtd / tgt * 100) + "%";
    // chart: cumulative by time of day, one scale for both days
    const W = 640, H = 250, L = 58, R = 12, Tp = 12, Bt = 28;
    const x = ms => L + (ms / 3600e3 - OPEN) / (CLOSE - OPEN) * (W - L - R);
    const cum = (rows, start) => { let s = 0; const pts = [[OPEN * 3600e3, 0]]; rows.forEach(r => { s += r.amt; pts.push([r.t - start, s]); }); return pts; };
    const tp = cum(T, dayStart); tp.push([clock, tSum]);
    const yp = cum(Y, yStart); yp.push([CLOSE * 3600e3, sum(Y)]);
    const maxV = Math.max(sum(Y), tSum) * 1.05 || 1;
    const step = [1000, 2000, 5000, 10000, 20000, 25000, 50000, 100000].find(s => maxV / s <= 5) || 200000, top = Math.ceil(maxV / step) * step;
    const y = v => H - Bt - v / top * (H - Tp - Bt);
    let g = "";
    for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#edf0f5" fill="none"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v >= 1000 ? rm0(v / 1000) + "k" : v}</text>`;
    for (let h = OPEN; h <= CLOSE; h += 2) g += `<text x="${x(h * 3600e3)}" y="${H - 8}" text-anchor="middle">${String(h).padStart(2, "0")}:00</text>`;
    const path = pts => pts.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join("");
    const tPath = path(tp), ex = x(clock), ey = y(tSum);
    g += `<path d="${path(yp)}" fill="none" stroke="#a3abc4" stroke-width="2" stroke-dasharray="5 4"/>`;
    g += `<path d="${tPath}L${ex.toFixed(1)},${y(0)}L${x(OPEN * 3600e3)},${y(0)}Z" fill="var(--primary)" fill-opacity=".1" stroke="none"/>`;
    g += `<path d="${tPath}" fill="none" stroke="var(--primary)" stroke-width="2.5"/>`;
    g += `<line x1="${ex}" x2="${ex}" y1="${Tp}" y2="${H - Bt}" stroke="var(--primary)" stroke-opacity=".35" stroke-dasharray="2 3" fill="none"/>`;
    g += `<circle cx="${ex}" cy="${ey}" r="4.5" fill="var(--primary)" stroke="#fff" stroke-width="2"/>`;
    const right = ex + 8 > W - 120;
    g += `<text x="${right ? ex - 8 : ex + 8}" y="${Math.max(Tp + 10, ey - 8)}" text-anchor="${right ? "end" : "start"}" style="fill:var(--text);font-weight:600">RM ${rm0(tSum)}</text>`;
    $("#biChart").innerHTML = g;
    // payment methods
    const byM = METHODS.map(m => { const rows = T.filter(r => r.m === m); return { m, n: rows.length, v: sum(rows) }; }).sort((a, b) => b.v - a.v);
    const maxM = Math.max(...byM.map(r => r.v), 1);
    $("#biMethods").innerHTML = byM.map(r => `<div class="bi-row"><span class="t">${r.m}</span><span class="bi-track"><b style="width:${r.v / maxM * 100}%"></b></span>
      <span class="v">${rm0(r.v)}<small>${tSum ? (r.v / tSum * 100).toFixed(1) : 0}% · ${r.n}</small></span></div>`).join("");
    $("#biPmTotal").textContent = `RM ${rm(tSum)}`;
    // outlets
    $("#biOutlets").innerHTML = OUTLETS.map(([c, n]) => {
      const tr = today.filter(r => r.outlet === c), yr = yday.filter(r => r.outlet === c && r.t - yStart <= clock), p = pct(sum(tr), sum(yr));
      return `<tr style="cursor:default;${outletSel === c ? "background:var(--primary-soft)" : ""}"><td><strong>${c}</strong> <span class="muted bi-hide">${n}</span></td>
        <td class="r">${tr.length}</td><td class="r">${rm(sum(tr))}</td><td class="r bi-hide ${p >= 0 ? "bi-up" : "bi-down"}">${p >= 0 ? "▲" : "▼"} ${Math.abs(p).toFixed(0)}%</td></tr>`;
    }).join("");
    // latest receipts
    $("#biFeed").innerHTML = T.slice(-25).reverse().map(r => `<tr style="cursor:default" class="${r.no === newNo ? "bi-new" : ""}"><td>${hm(r.t).slice(0, 5)}</td><td class="bi-no">${r.no}</td>
      <td class="bi-hide">${esc(r.cust)}<div class="muted" style="font-size:11.5px">${r.outlet}</div></td><td><span class="bi-chip">${r.m}</span></td><td class="r"><strong>${rm(r.amt)}</strong></td></tr>`).join("");
    $("#biFeedN").textContent = `${T.length} today · newest first`;
    $("#biLiveTxt").textContent = `${paused ? "Paused" : "Live"} · updated ${hm(Date.now())}`;
  }
  const tick = () => {
    if (!$("#biChart")) return;                               // left the page: stop
    if (!paused) {
      const stepMs = 3000 + rnd() * 5000;
      simNow = Math.min(simNow + stepMs, LAST);
      const r = receipt(simNow, `OR${ymd(now)}-${String(today.length + 1).padStart(4, "0")}`);
      today.push(r); draw(r.no);
      biTimer = setTimeout(tick, stepMs);
    } else biTimer = setTimeout(tick, 1000);
  };
  $("#biOutlet").onchange = e => { outletSel = e.target.value; draw(); };
  $("#biPause").onclick = () => { paused = !paused; $("#biPause").textContent = paused ? "Resume" : "Pause"; $("#biLive").classList.toggle("paused", paused); draw(); };
  draw();
  biTimer = setTimeout(tick, 3500);
}

// ---------------- HR Dept: MC Request (PRO-2603-012) - form, list, view
const MC_STATUS = { submitted: ["Submitted", "mcs-submitted"], processing: ["Processing", "mcs-processing"], approved: ["Approved", "mcs-approved"], completed: ["Completed", "mcs-completed"], rejected: ["Rejected", "mcs-rejected"] };
const mcBadge = st => { const [l, c] = MC_STATUS[st] || [st, ""]; return `<span class="mcs ${c}">${esc(l)}</span>`; };
const MC_OPEN = ["submitted", "processing", "approved"];
const mcLead = r => {                                         // e.g. "9 / 30": days left of the lead time for the original copy
  const run = MC_OPEN.includes(r.status), low = run && r.leadLeft <= 10;
  return `<span class="mc-leadcell ${low ? "low" : run ? "" : "done"}" title="${run ? `${r.leadLeft} of ${r.leadDays} days left to hand in the original MC`
    : r.status === "completed" ? "Original MC received – stopped" : "Stopped"}"><strong>${r.leadLeft}</strong> / ${r.leadDays}</span>`
    + (r.status === "completed" ? `<div class="muted" style="font-size:11px">received</div>` : "");
};
let mcFind = { outlet: "", status: "", date: "", q: "", page: 1 };

async function renderMcForm() {
  let d;
  try { d = await api("GET", "/api/mc"); } catch (ex) { toast(ex.message); location.replace("#/"); return; }
  const st = d.staff;
  let staffList = [];
  if (d.hr) { try { staffList = (await api("GET", "/api/hr/staff")).staff.filter(s => s.active); } catch { /* HR without Staff Master Data access */ } }
  else if (d.team?.length) {                                    // a manager: himself first, then the staff under him in his branches
    staffList = [...(st ? [{ staffId: st.code, fullName: `${st.name} (me)`, outletCode: st.outlet }] : []),
      ...d.team.map(t => ({ staffId: t.code, fullName: `${t.name} – ${t.position}`, outletCode: t.outlet }))];
  }
  const pickStaff = d.hr || staffList.length > 1;
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const bh = d.settings.backdateHours || 48;                   // staff must submit within 48 hours (HR is not limited)
  const earliest = new Date(Date.now() - bh * 3600000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const files = [];
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>MC Request Form</h1>
      <div class="sub">Submit your medical certificate (MC) within ${d.settings.backdateHours || 48} hours. HR checks it; hand in the original copy within ${d.settings.leadDays} days.</div></div></div>
    ${!st && !d.hr ? `<div class="card" style="padding:16px;color:var(--bad)">Your login (${esc(me.username)}) is not in Staff Master Data – ask HR to add Staff Code <strong>${esc(me.username)}</strong> before you can submit.</div>` : ""}
    <div class="card mc-form">
      <div class="card-head"><h2>MC Request Form</h2></div>
      <form id="mcForm" class="card-body mc-grid" autocomplete="off">
        <label class="field"><span>Document Number <span class="muted" style="font-weight:400">(made by the system when you submit)</span></span>
          <input type="text" id="mcDocNo" value="MC-yymm-### (auto)" disabled /></label>
        <label class="field"><span>Document Type <b class="req">*</b></span>
          <select name="docType" required>${(d.settings.docTypes || [{ code: "MC" }, { code: "OMC" }]).map(t =>
            `<option value="${esc(t.code)}">${esc(t.code)}${t.name ? ` – ${esc(t.name)}` : ""}</option>`).join("")}</select></label>
        <label class="field"><span>Staff Code</span>
          ${pickStaff ? `<input type="text" name="staffCode" list="mcStaff" value="${esc(st?.code || "")}" placeholder="Staff Code – type a code or name" />
            <datalist id="mcStaff">${staffList.map(s => `<option value="${esc(s.staffId)}">${esc(s.fullName)} · ${esc(s.outletCode)}</option>`).join("")}</datalist>`
            : `<input type="text" value="${esc(st?.code || me.username)}" disabled />`}</label>
        <label class="field"><span>Leave Number <b class="req">*</b></span><input type="text" name="leaveNo" maxlength="100" required placeholder="Leave application number" /></label>
        <label class="field"><span>Outlet</span><input type="text" id="mcOutlet" value="${esc(st?.outlet || "")}" disabled placeholder="From the staff record" /></label>
        <label class="field"><span>Date Apply <b class="req">*</b> <span class="muted" style="font-weight:400">${d.hr ? "" : `(backdated at most ${bh} hours)`}</span></span>
          <input type="date" name="dateApply" value="${today}" required ${d.hr ? "" : `min="${earliest}" max="${today}"`} /></label>
        <div class="field" style="grid-column:1/-1"><span>MC <b class="req">*</b></span>
          <label class="mc-drop" id="mcDrop">
            <input type="file" id="mcFiles" accept="image/*,.pdf" multiple hidden />
            <span class="mc-drop-icon">🖼</span><strong>Drag your files here or click in this area.</strong>
            <span class="muted" style="font-size:12px">Photo (JPG / PNG) or PDF of the MC</span></label>
          <div id="mcPicked" class="mc-picked"></div></div>
        <div class="mc-actions" style="grid-column:1/-1">
          <a class="btn" href="#/mc">✕</a>
          <button class="btn btn-success" id="mcSubmit">Submit</button>
        </div>
      </form>
    </div>`;
  const form = $("#mcForm");
  const yymm = today.slice(2, 4) + today.slice(5, 7);
  form.docType.onchange = () => { $("#mcDocNo").value = `${form.docType.value}-${yymm}-### (auto)`; };   // OMC-2610-### / MC-2610-###
  form.docType.onchange();
  $("#mcSubmit").onclick = () => {                              // show the empty compulsory fields (and the MC box) in red
    form.classList.add("tried");
    $("#mcDrop").classList.toggle("missing", !files.length);
  };
  if (form.staffCode) form.staffCode.oninput = () => {
    const s = staffList.find(x => x.staffId.toLowerCase() === form.staffCode.value.trim().toLowerCase());
    $("#mcOutlet").value = s ? `${s.outletCode}${s.fullName ? " · " + s.fullName : ""}` : "";
  };
  const drawPicked = () => {
    $("#mcPicked").innerHTML = files.map((f, i) => `<div class="mc-file">${f.type.startsWith("image/") ? `<img src="${URL.createObjectURL(f)}" alt="" />` : `<span class="mc-pdf">PDF</span>`}
      <span>${esc(f.name)}</span><button type="button" class="btn btn-sm" data-rm="${i}" title="Remove">✕</button></div>`).join("");
  };
  const add = list => { for (const f of list) if (f.type.startsWith("image/") || f.type === "application/pdf") files.push(f); drawPicked();
    if (files.length) $("#mcDrop").classList.remove("missing"); };
  $("#mcFiles").onchange = e => { add(e.target.files); e.target.value = ""; };
  const drop = $("#mcDrop");
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files); };
  $("#mcPicked").onclick = e => { const b = e.target.closest("[data-rm]"); if (b) { files.splice(+b.dataset.rm, 1); drawPicked(); } };
  form.onsubmit = async e => {
    e.preventDefault();
    if (!files.length) { $("#mcDrop").classList.add("missing"); tell("Add the MC picture (photo or PDF) first – it is compulsory."); return; }
    const btn = $("#mcSubmit"); btn.disabled = true; btn.textContent = "Submitting…";
    try {
      const { request } = await api("POST", "/api/mc", { docType: form.docType.value, leaveNo: form.leaveNo.value,
        dateApply: form.dateApply.value, staffCode: form.staffCode ? form.staffCode.value : "" });
      for (const f of files) await api("POST", `/api/mc/${request.id}/files?name=${encodeURIComponent(f.name)}`, f);
      toast(`${request.docNo} submitted – waiting for HR`);
      location.hash = `#/mc/${request.id}`;
    } catch (ex) { tell(ex.message); btn.disabled = false; btn.textContent = "Submit"; }
  };
}

async function renderMcList() {
  let d;
  try { d = await api("GET", "/api/mc"); } catch (ex) { toast(ex.message); location.replace("#/"); return; }
  mcNotices = { reminders: d.reminders || [], waiting: d.hr ? d.requests.filter(r => r.status === "submitted").length : 0 }; updateBell();
  const list = d.requests, outlets = [...new Set(list.map(r => r.outlet).filter(Boolean))].sort();
  const count = st => list.filter(r => r.status === st).length;
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>MC Request List</h1>
      <div class="sub">${d.hr ? "All MC requests (HR)." : "Your MC requests."} Lead Time = days left to hand in the original MC (from ${d.settings.leadDays}; rejected automatically at 0).</div></div>
      <div class="actions">${d.canSubmit ? `<a class="btn btn-primary" href="#/mc/new">+ MC Request Form</a>` : ""}</div></div>
    ${d.reminders.length ? `<div class="card mc-remind">🩺 Please hand in the <strong>original MC</strong> to HR: ${d.reminders.map(r =>
      `<a href="#/mc/${r.id}"><strong>${esc(r.docNo)}</strong> – ${r.leadLeft} day${r.leadLeft === 1 ? "" : "s"} left</a>`).join(" · ")}</div>` : ""}
    <div class="stats mc-stats">
      <div class="stat"><div class="n">${count("submitted")}</div><div class="l">Submitted</div></div>
      <div class="stat"><div class="n">${count("processing")}</div><div class="l">Processing</div></div>
      <div class="stat"><div class="n">${count("approved")}</div><div class="l">Approved</div></div>
      <div class="stat"><div class="n">${count("completed")}</div><div class="l">Completed</div></div>
      <div class="stat"><div class="n">${count("rejected")}</div><div class="l">Rejected</div></div>
    </div>
    <div class="card">
      <div class="toolbar hr-toolbar">
        <input type="search" id="mcQ" placeholder="🔍 Search document ID, staff, leave no…" value="${esc(mcFind.q)}" />
        <label class="mc-flt">Outlet <select id="mcOutletF"><option value="">All</option>${outlets.map(o => `<option ${o === mcFind.outlet ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
        <label class="mc-flt">Status <select id="mcStatusF"><option value="">All</option>${Object.entries(MC_STATUS).map(([k, [l]]) => `<option value="${k}" ${k === mcFind.status ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label class="mc-flt">Date <input type="date" id="mcDateF" value="${esc(mcFind.date)}" /></label>
      </div>
      <div class="table-wrap"><table class="mc-table">
        <thead><tr><th>Status</th><th style="text-align:center" title="Days left to hand in the original MC / lead time">Lead Time for<br>Original Copy (Days)</th>
          <th>Document ID</th><th>Document Type</th><th>Leave Application ID</th><th>Staff ID</th><th>Staff Name</th>
          <th>Outlet</th><th>Approved By</th><th>Approval Date</th><th>Last Updated By</th></tr></thead>
        <tbody id="mcRows"></tbody>
      </table></div>
      <div class="mc-pager"><span class="muted" id="mcInfo"></span><span id="mcPages"></span></div>
    </div>`;
  const PER = 25;
  const draw = () => {
    const w = mcFind.q.toLowerCase().split(/\s+/).filter(Boolean);
    const rows = list.filter(r => (!mcFind.outlet || r.outlet === mcFind.outlet) && (!mcFind.status || r.status === mcFind.status)
      && (!mcFind.date || r.dateApply === mcFind.date)
      && w.every(x => [r.docNo, r.docType, r.leaveNo, r.staffCode, r.staffName, r.outlet].join(" ").toLowerCase().includes(x)));
    const pages = Math.max(1, Math.ceil(rows.length / PER));
    mcFind.page = Math.min(mcFind.page, pages);
    const from = (mcFind.page - 1) * PER, part = rows.slice(from, from + PER);
    $("#mcRows").innerHTML = part.length ? part.map(r => `<tr data-mc="${r.id}">
      <td>${mcBadge(r.status)}</td><td style="text-align:center">${mcLead(r)}</td><td><a href="#/mc/${r.id}"><strong>${esc(r.docNo)}</strong></a></td>
      <td>${esc(r.docType)}</td><td>${esc(r.leaveNo)}</td>
      <td>${esc(r.staffCode)}</td><td>${esc(r.staffName || "—")}</td><td>${esc(r.outlet || "—")}</td>
      <td>${esc(r.approvedBy || "----")}</td><td>${r.approvedAt ? fmtDate(new Date(r.approvedAt * 1000).toISOString().slice(0, 10)) : "--/--/----"}</td>
      <td>${esc(r.updatedBy || "—")}</td></tr>`).join("")
      : `<tr><td colspan="11" class="empty">${list.length ? "No request matches." : "No MC request yet."}</td></tr>`;
    $("#mcInfo").textContent = rows.length ? `Showing ${from + 1} to ${from + part.length} of ${rows.length} entries` : "";
    $("#mcPages").innerHTML = pages > 1 ? `<button class="btn btn-sm" data-pg="${mcFind.page - 1}" ${mcFind.page === 1 ? "disabled" : ""}>Previous</button>
      <strong style="margin:0 8px">${mcFind.page} / ${pages}</strong>
      <button class="btn btn-sm" data-pg="${mcFind.page + 1}" ${mcFind.page === pages ? "disabled" : ""}>Next</button>` : "";
  };
  draw();
  $("#mcQ").oninput = e => { mcFind.q = e.target.value; mcFind.page = 1; draw(); };
  $("#mcOutletF").onchange = e => { mcFind.outlet = e.target.value; mcFind.page = 1; draw(); };
  $("#mcStatusF").onchange = e => { mcFind.status = e.target.value; mcFind.page = 1; draw(); };
  $("#mcDateF").onchange = e => { mcFind.date = e.target.value; mcFind.page = 1; draw(); };
  $("#mcPages").onclick = e => { const b = e.target.closest("[data-pg]"); if (b && !b.disabled) { mcFind.page = +b.dataset.pg; draw(); } };
  $("#mcRows").onclick = e => { const tr = e.target.closest("[data-mc]"); if (tr && !e.target.closest("a")) location.hash = "#/mc/" + tr.dataset.mc; };
}

async function renderMcView(id) {
  let d;
  try { d = await api("GET", `/api/mc/${id}`); } catch (ex) { toast(ex.message); location.replace("#/mc"); return; }
  const r = d.request, hr = d.hr, open = MC_OPEN.includes(r.status);
  const amend = r.submittedById === me.id && r.status === "submitted";      // until HR opens it (Processing)
  const amendNote = amend ? "You can still change this request until HR opens it (Processing)."
    : d.mine && !hr && r.status === "processing" ? "HR is processing this request – it can no longer be changed." : "";
  const ro = (label, v) => `<label class="field"><span>${label}</span><input type="text" value="${esc(v || "")}" disabled /></label>`;
  const fileUrl = f => `/api/mc/files/${f.id}`;
  $("#app").innerHTML = `
    <div class="page-head"><div><a href="#/mc" style="text-decoration:none;font-weight:600">← MC Request List</a>
      <h1 style="margin-top:6px">${esc(r.docNo)} ${mcBadge(r.status)}</h1>
      <div class="sub">Submitted by ${esc(r.submittedBy || "—")} on ${fmtTime(r.submittedAt)}
        ${r.approvedAt ? ` · approved by ${esc(r.approvedBy)} on ${fmtTime(r.approvedAt)}` : ""}
        ${r.rejectedAt ? ` · rejected by ${esc(r.rejectedBy || "System")} on ${fmtTime(r.rejectedAt)}${r.rejectReason ? ` – ${esc(r.rejectReason)}` : ""}` : ""}</div></div>
      <div class="actions">${amend ? `<button class="btn" id="mcEdit">✎ Edit</button>` : ""}</div></div>
    ${amendNote ? `<div class="card ta-stage"><div class="card-body">${esc(amendNote)}</div></div>` : ""}
    <div class="card mc-form">
      <div class="card-head"><h2>MC Request Form</h2>
        <span class="mc-leadbox ${open && r.leadLeft <= 10 ? "low" : ""}">Lead Time for Original Copy: <strong>${r.leadLeft}</strong> day${r.leadLeft === 1 ? "" : "s"}
          ${r.received ? ` · original MC received${r.receivedBy ? " by " + esc(r.receivedBy) : ""} ${fmtTime(r.receivedAt)}` : open ? " left" : ""}</span></div>
      <div class="card-body mc-grid">
        ${ro("Document Number", r.docNo)}${ro("Document Type", r.docType)}
        ${ro("Staff Code", r.staffCode + (r.staffName ? " – " + r.staffName : ""))}${ro("Leave Number", r.leaveNo)}
        ${ro("Outlet", r.outlet)}${ro("Date Apply", fmtDate(r.dateApply))}
        <div class="field" style="grid-column:1/-1"><span>MC</span>
          <div class="mc-shots">${r.files.length ? r.files.map(f => f.type?.startsWith("image/")
            ? `<a href="${fileUrl(f)}" target="_blank" rel="noopener" title="${esc(f.name)}"><img src="${fileUrl(f)}" alt="${esc(f.name)}" /></a>`
            : `<a class="mc-pdfbox" href="${fileUrl(f)}" target="_blank" rel="noopener">📄 ${esc(f.name)}</a>`).join("") : `<span class="muted">No MC picture uploaded.</span>`}</div>
          ${(hr || amend) && r.files.length && r.status !== "rejected" ? `<div class="mc-rmlist">${r.files.map(f =>
            `<button type="button" class="btn btn-sm" data-rmmc="${f.id}" title="Take this file off">✕ ${esc(f.name)}</button>`).join(" ")}</div>` : ""}
          ${(hr || amend) && r.status !== "rejected" ? `<label class="btn btn-sm upload-btn" style="margin-top:8px"><span>+ Add MC file</span><input type="file" id="mcMore" accept="image/*,.pdf" multiple /></label>` : ""}
        </div>
        ${hr && r.status !== "rejected" ? `<div class="mc-hr" style="grid-column:1/-1">
          <label class="check-line"><input type="checkbox" id="mcReceived" ${r.received ? "checked" : ""} /> <span><strong>Click when receive original MC</strong>
            <span class="muted" style="font-weight:400">(lead time stops; approved + received = Completed)</span></span></label>
          <div class="mc-actions">
            <a class="btn" href="#/mc">✕</a>
            ${r.status !== "completed" ? `<button class="btn btn-danger" id="mcReject">Reject</button>` : ""}
            ${["submitted", "processing"].includes(r.status) ? `<button class="btn btn-primary" id="mcApprove">Approve</button>` : `<button class="btn btn-primary" id="mcSave">Save</button>`}
          </div></div>` : ""}
      </div>
    </div>
    <div class="card"><div class="card-head"><h2>History</h2></div>
      <div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
      ${d.history.map(h => `<tr style="cursor:default"><td class="muted" style="white-space:nowrap">${fmtTime(h.at)}</td><td>${esc(h.by)}</td>
        <td>${esc((h.field ? h.field + ": " : "") + (h.old ? h.old + " → " : "") + (h.new || h.action))}</td></tr>`).join("")}</tbody></table></div></div>`;
  const decide = async body => {
    try { await api("POST", `/api/mc/${id}/decide`, body); toast("Saved"); renderMcView(id); loadMcNotices(); }
    catch (ex) { tell(ex.message); }
  };
  if ($("#mcApprove")) $("#mcApprove").onclick = () => decide({ action: "approve", received: $("#mcReceived").checked });
  if ($("#mcSave")) $("#mcSave").onclick = () => decide({ action: "save", received: $("#mcReceived").checked });
  if ($("#mcReject")) $("#mcReject").onclick = () => openDialog(`<h3>Reject ${esc(r.docNo)}?</h3>
      <label class="field"><span>Reason (optional – the staff sees it)</span><input type="text" name="reason" maxlength="300" /></label>`,
    async form => { $("#dialog").close(); await decide({ action: "reject", reason: form.reason.value }); }, "Reject");
  if ($("#mcEdit")) $("#mcEdit").onclick = () => openDialog(`<h3>✎ Edit ${esc(r.docNo)}</h3>
      <label class="field"><span>Leave Number <b class="req">*</b></span><input type="text" name="leaveNo" maxlength="100" value="${esc(r.leaveNo)}" required /></label>
      <label class="field"><span>Date Apply <b class="req">*</b></span><input type="date" name="dateApply" value="${esc(r.dateApply)}" required /></label>`,
    async form => { await api("PUT", `/api/mc/${id}`, { leaveNo: form.leaveNo.value, dateApply: form.dateApply.value }); toast("MC request changed"); renderMcView(id); }, "Save");
  document.querySelectorAll("[data-rmmc]").forEach(b => b.onclick = async () => {
    try { await api("POST", `/api/mc/files/${b.dataset.rmmc}/remove`); toast("MC file removed"); renderMcView(id); } catch (ex) { tell(ex.message); }
  });
  if ($("#mcMore")) $("#mcMore").onchange = async e => {
    try { for (const f of e.target.files) await api("POST", `/api/mc/${id}/files?name=${encodeURIComponent(f.name)}`, f); toast("MC file added"); renderMcView(id); }
    catch (ex) { tell(ex.message); }
  };
}

// ---------------- Settings › HR Setting: Role list + Outlet list (Super Admin / Admin)
// ================================================================ General – User Manual (text in manual.json)
const mdLite = t => esc(t).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\\\*/g, "*");
let manualAll = false, manualQ = "";
async function renderManual() {
  let list = [], canAll = false;
  try { ({ manual: list, canShowAll: canAll } = await api("GET", `/api/manual?lang=${LANG}${manualAll ? "&all=1" : ""}`)); } catch (ex) { toast(ex.message); }
  if (!canAll) manualAll = false;
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>📘 User Manual</h1>
      <div class="sub">How to use Company Portal, step by step.</div></div>
      <div class="actions"><button class="btn" id="manPrint">🖨 Print / Save as PDF</button></div></div>
    <div class="card man-tools">
      <input type="search" id="manQ" placeholder="🔍 Search the manual – e.g. password, signature, approve, import…" value="${esc(manualQ)}" />
      ${canAll ? `<label class="check-line"><input type="checkbox" id="manAll" ${manualAll ? "checked" : ""} /> <span>Show every part (Admin – also programs this account does not use)</span></label>` : ""}
    </div>
    <div class="man-wrap"><nav class="card man-toc no-tr" id="manToc"></nav><div id="manBody" class="no-tr"></div></div>`;
  const draw = () => {
    const q = manualQ.trim().toLowerCase();
    const secs = list.map(s => {                            // the server only sends the parts this account may see
      if (!q) return s;
      const hit = x => String(x || "").toLowerCase().includes(q);
      if (hit(s.title) || hit(s.intro)) return s;
      const parts = (s.parts || []).map(p => hit(p.h) ? p : { ...p, steps: (p.steps || []).filter(hit) }).filter(p => p.steps.length);
      return parts.length ? { ...s, parts } : null;
    }).filter(Boolean);
    $("#manToc").innerHTML = `<div class="man-toc-h">${L3("Contents", "Kandungan", "目录")}</div>` + (secs.map(s => `<a href="#man-${esc(s.id)}" data-go="${esc(s.id)}">${s.icon || ""} ${esc(s.title)}</a>`).join("")
      || `<span class="muted">${L3("Nothing found.", "Tiada ditemui.", "没有找到。")}</span>`);
    $("#manBody").innerHTML = secs.map(s => `<section class="card man-sec" id="man-${esc(s.id)}">
        <h2>${s.icon || ""} ${esc(s.title)}</h2>${s.intro ? `<p class="man-intro">${mdLite(s.intro)}</p>` : ""}
        ${(s.parts || []).map(p => `<h3>${esc(p.h)}</h3><ol>${(p.steps || []).map(x => `<li>${mdLite(x)}</li>`).join("")}</ol>`).join("")}</section>`).join("")
      || `<div class="card"><div class="empty">${L3("Nothing in the manual matches", "Tiada dalam manual sepadan", "手册中没有符合的内容")} “${esc(manualQ)}”.</div></div>`;
  };
  draw();
  $("#manQ").oninput = e => { manualQ = e.target.value; draw(); };
  if ($("#manAll")) $("#manAll").onchange = e => { manualAll = e.target.checked; renderManual(); };
  $("#manToc").onclick = e => { const a = e.target.closest("[data-go]"); if (a) { e.preventDefault(); document.getElementById("man-" + a.dataset.go)?.scrollIntoView({ behavior: "smooth" }); } };
  $("#manPrint").onclick = () => {
    const w = window.open("", "_blank");
    if (!w) { tell("Allow pop-ups for this site to print the manual."); return; }
    w.document.write(`<!doctype html><title>Company Portal – User Manual</title><style>
      body{font-family:Segoe UI,Arial,sans-serif;color:#111;padding:10px 26px;font-size:13px;line-height:1.5} h1{color:#1e3a8a;margin:4px 0}
      h2{color:#1e3a8a;border-bottom:2px solid #c7d2fe;padding-bottom:4px;margin:22px 0 6px;page-break-after:avoid} h3{margin:12px 0 4px;font-size:14px}
      ol{margin:0 0 6px;padding-left:22px} li{margin-bottom:3px} .man-intro{color:#475569;margin:0 0 6px} @page{size:A4;margin:14mm}
      </style><img src="/letterhead.png" style="width:100%;max-height:100px;object-fit:contain" onerror="this.remove()" />
      <h1>Company Portal – ${L3("User Manual", "Manual Pengguna", "用户手册")}</h1><p style="color:#475569">${L3("Printed", "Dicetak", "打印于")} ${new Date().toLocaleDateString("en-GB")}${manualAll ? "" : ` · ${L3("the parts for", "bahagian untuk", "适用于")} ${esc(me.name)}`}</p>
      ${$("#manBody").innerHTML.replace(/<section[^>]*>/g, "<div>").replace(/<\/section>/g, "</div>")}`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  };
}

// ================================================================ General – Dashboard: New Memo + New System Update
const gdSeenKey = () => `gd.updateSeen.${me?.id}`;
const verNum = v => String(v || "0").split(".").map(Number).reduce((a, x, i) => a + x / Math.pow(1000, i), 0);   // 4.10 > 4.9
async function markNewUpdates() {                         // "NEW" next to General Dashboard when there is an update not seen yet
  let list = [];
  try { list = (await api("GET", "/api/updates")).updates; } catch { return; }
  let seen = "";
  try { seen = localStorage.getItem(gdSeenKey()) || ""; } catch { /* private window */ }
  const b = $("#gdNewN");
  if (b) b.hidden = !(list[0] && verNum(list[0].version) > verNum(seen));
}
// everything waiting for this person, from every module they have: approvals and things still to submit / send
async function gdTasks(memoData) {
  const groups = [], add = (icon, mod, label, items, more) => { if (items.length) groups.push({ icon, mod, label, items, more }); };
  const get = url => api("GET", url).catch(() => null);
  const [sirim, eb, mc, tr, ta] = await Promise.all([
    me.sirimAccess ? get("/api/sirim") : null, me.ebEdit ? get("/api/eb") : null,
    me.mcSubmit || me.mcHR ? get("/api/mc") : null, me.trFill || me.trHR ? get("/api/tr") : null,
    me.taFill || me.taHR ? get("/api/ta") : null]);
  // Memo
  const memos = memoData?.memos || [];
  if (memoData?.approve) add("✔", "Memo", "Waiting for your approval", memos.filter(m => m.status === "processing" && m.approverId === me.id)
    .map(m => ({ t: mmTitle(m), s: `${m.docNo} · from ${m.createdBy} · ${tsDate(m.createdAt)}`, href: `#/memo/${m.id}` })), "#/memo/approval");
  if (memoData?.hr) add("📢", "Memo", "Approved – ready to post", memos.filter(m => m.status === "approved")
    .map(m => ({ t: mmTitle(m), s: `${m.docNo} · approved by ${m.approvedBy} · ${tsDate(m.approvedAt)}`, href: `#/memo/${m.id}` })), "#/memo/list");
  // COA Application: sections you can submit now
  if (me.coaAccess !== false) add("📋", "COA Application", "Sections to submit", (apps || []).filter(a => !a.cancelled && !a.summary?.completed)
    .map(a => ({ a, secs: Object.entries(a.sections || {}).filter(([, x]) => x.submit).map(([k]) => k) })).filter(x => x.secs.length)
    .map(({ a, secs }) => ({ t: `${a.formNo} · ${a.summary?.equipmentName || a.data?.equipmentName || "—"}`, s: `Section ${secs.join(", ")} not submitted yet`, href: `#/app/${a.id}` })), "#/");
  if (me.coaAccess !== false) add("⚠", "COA Application", "COA expiring / expired", coaAlerts()
    .map(({ a, c, days }) => ({ t: `${a.formNo} · ${c.kind} COA ${c.no || "—"}`, s: daysText(days) + " – start the renewal", href: `#/app/${a.id}` })), "#/");
  // Consignment Test
  if (sirim?.forms) add("🔎", CT_NAME, "Forms to submit", sirim.forms.filter(f => !f.cancelled && f.perms?.submit)
    .map(f => ({ t: f.formNo, s: "not submitted yet", href: `#/sirim/${f.id}` })), "#/sirim");
  // Email Batch
  if (eb?.batches) {
    add("✉", "Email Batch", "Not sent yet", eb.batches.filter(b => b.status === "draft" && !b.cancelled)
      .map(b => ({ t: `${b.batchNo} · ${b.title || b.subject || "—"}`, s: `${b.total || 0} customer(s) – press Send when ready`, href: `#/eb/${b.id}` })), "#/eb");
    add("⛔", "Email Batch", "Stopped – needs checking", eb.batches.filter(b => ["stopped", "paused"].includes(b.status) && !b.cancelled)
      .map(b => ({ t: `${b.batchNo} · ${b.title || b.subject || "—"}`, s: `${b.sent || 0} sent · ${b.failed || 0} failed · ${b.pending || 0} waiting`, href: `#/eb/${b.id}` })), "#/eb");
  }
  // MC Request
  if (mc?.requests) {
    if (mc.hr) add("🩺", "MC Request", "Waiting for HR", mc.requests.filter(r => ["submitted", "processing"].includes(r.status))
      .map(r => ({ t: `${r.docNo} · ${r.staffName || r.staffCode}`, s: `${r.status === "submitted" ? "new" : "opened"} · ${r.outlet || ""}`, href: `#/mc/${r.id}` })), "#/mc");
    add("🩺", "MC Request", "Hand in your original MC", (mc.reminders || [])
      .map(r => ({ t: `${r.docNo}`, s: `${r.leadLeft} day(s) left – bring the original MC to HR`, href: `#/mc/${r.id}` })), "#/mc");
  }
  // Transfer Form
  if (tr?.forms) {
    add("🔁", "Transfer Form", "Upload the signed letter", tr.forms.filter(f => f.status === "drafted" && f.createdById === me.id)
      .map(f => ({ t: `${f.docNo} · ${f.staffNames[0] || ""}${f.staffNames.length > 1 ? ` +${f.staffNames.length - 1}` : ""}`, s: "drafted – print, sign and upload", href: `#/tr/${f.id}` })), "#/tr");
    if (tr.hr) add("🔁", "Transfer Form", "Waiting for HR", tr.forms.filter(f => ["submitted", "processing"].includes(f.status))
      .map(f => ({ t: `${f.docNo} · ${f.staffNames[0] || ""}${f.staffNames.length > 1 ? ` +${f.staffNames.length - 1}` : ""}`, s: "signed by the outlet – HR to sign and complete", href: `#/tr/${f.id}` })), "#/tr");
  }
  // Time Adjustment
  if (ta?.forms) {
    const who = f => `${f.docNo} · ${f.staffNames[0] || ""}${f.lines > 1 ? ` +${f.lines - 1}` : ""}`;
    if (ta.hr) add("⏱", "Time Adjustment", "Waiting for HR", ta.forms.filter(taHrTurn)
      .map(f => ({ t: who(f), s: f.status === "incomplete" ? "declined by the outlet after Completed" : f.status === "submitted" ? "new" : "opened", href: `#/ta/${f.id}` })), "#/ta");
    add("⏱", "Time Adjustment", "Check SBClient and acknowledge", ta.forms.filter(f => f.createdById === me.id && f.status === "completed")
      .map(f => ({ t: who(f), s: `completed by ${f.completedBy} – acknowledged automatically after 24 hours`, href: `#/ta/${f.id}` })), "#/ta");
    add("⏱", "Time Adjustment", "Declined by HR – correct and submit", ta.forms.filter(f => f.createdById === me.id && f.status === "incomplete" && f.returnedBy === "hr")
      .map(f => ({ t: who(f), s: "Incomplete", href: `#/ta/${f.id}/edit` })), "#/ta");
    add("⏱", "Time Adjustment", "Drafts to submit", ta.forms.filter(f => f.createdById === me.id && f.status === "draft")
      .map(f => ({ t: who(f), s: "Draft – not sent to HR yet", href: `#/ta/${f.id}/edit` })), "#/ta");
  }
  groups.lists = { sirim, eb, mc, tr, ta };
  return groups;
}
// My Document Status: only the documents this person submitted / created, with where each one is now
const GD_ST = { ok: "gds-ok", run: "gds-run", wait: "gds-wait", bad: "gds-bad", off: "gds-off" };
function gdMyDocs(memoData, lists) {
  const rows = [], add = (mod, icon, no, title, status, tone, at, href) => rows.push({ mod, icon, no, title, status, tone, at: at || 0, href });
  const L = s => s.charAt(0).toUpperCase() + s.slice(1);
  for (const m of (memoData?.memos || []).filter(m => m.createdById === me.id))
    add("Memo", "📢", m.docNo, mmTitle(m), L(m.status) + (m.status === "processing" ? ` – waiting for ${m.approverName}` : ""),
      { processing: "wait", approved: "run", posted: "ok", cancelled: "bad" }[m.status] || "run", m.updatedAt, `#/memo/${m.id}`);
  if (me.coaAccess !== false) for (const a of apps || []) {
    const mine = Object.entries(a.sections || {}).filter(([, x]) => x.myStatus === "submitted").map(([k]) => k);
    if (!mine.length) continue;
    const st = statusKey(a);
    add("COA Application", "📋", a.formNo, a.summary?.equipmentName || a.data?.equipmentName || "", `${st} · you submitted Section ${mine.join(", ")}`,
      a.cancelled ? "bad" : st === "Completed" ? "ok" : "run", a.updatedAt, `#/app/${a.id}`);
  }
  for (const f of (lists.sirim?.forms || []).filter(f => f.perms?.myStatus === "submitted"))
    add(CT_NAME, "🔎", f.formNo, f.data?.equipmentName || f.data?.ctProduct || "", f.cancelled ? "Cancelled" : "Submitted",
      f.cancelled ? "bad" : "ok", f.updatedAt, `#/sirim/${f.id}`);
  for (const b of (lists.eb?.batches || []).filter(b => b.createdById === me.id))
    add("Email Batch", "✉", b.batchNo, b.title || b.subject || "", L(b.status) + (b.status === "sending" ? ` – ${b.sent} of ${b.total}` : b.total ? ` – ${b.sent} sent, ${b.failed} failed` : ""),
      { sent: "ok", sending: "run", draft: "wait", stopped: "bad", paused: "wait", cancelled: "off" }[b.status] || "run", b.updatedAt, `#/eb/${b.id}`);
  for (const r of (lists.mc?.requests || []).filter(r => r.submittedById === me.id || String(r.staffCode).toLowerCase() === String(me.username).toLowerCase()))
    add("MC Request", "🩺", r.docNo, r.staffName || r.staffCode, L(r.status) + (MC_OPEN.includes(r.status) && !r.received ? ` – ${r.leadLeft} day(s) left for the original` : ""),
      { submitted: "wait", processing: "run", approved: "run", completed: "ok", rejected: "bad" }[r.status] || "run", r.updatedAt || r.submittedAt, `#/mc/${r.id}`);
  for (const f of (lists.tr?.forms || []).filter(f => f.createdById === me.id))
    add("Transfer Form", "🔁", f.docNo, (f.staffNames || []).join(", "), L(f.status),
      { drafted: "wait", submitted: "run", processing: "run", completed: "ok", checked: "ok", cancelled: "bad" }[f.status] || "run", f.updatedAt, `#/tr/${f.id}`);
  for (const f of (lists.ta?.forms || []).filter(f => f.createdById === me.id))
    add("Time Adjustment", "⏱", f.docNo, (f.staffNames || []).join(", "), (TA_STATUS[f.status] || [f.status])[0]
      + (f.status === "incomplete" ? (f.returnedBy === "hr" ? " – declined by HR, correct it" : " – back with HR") : f.status === "completed" ? " – check SBClient" : ""),
      { draft: "wait", submitted: "run", processing: "run", incomplete: "bad", completed: "run", acknowledged: "ok", cancelled: "off" }[f.status] || "run", f.updatedAt, `#/ta/${f.id}`);
  return rows.sort((a, b) => b.at - a.at);
}
let gdDocFind = { mod: "", q: "", all: false };
async function renderGeneralDash() {
  let memos = [], d = {}, updates = [];
  try { d = await api("GET", "/api/memo"); memos = d.memos || []; } catch { /* no memo access */ }
  try { updates = (await api("GET", "/api/updates")).updates; } catch { /* none */ }
  let seen = "";
  try { seen = localStorage.getItem(gdSeenKey()) || ""; } catch { /* private window */ }
  const posted = memos.filter(m => m.status === "posted").sort((a, b) => (b.read === a.read ? b.postedAt - a.postedAt : a.read ? 1 : -1));
  const unread = posted.filter(m => !m.read).length;
  const waiting = d.approve ? memos.filter(m => m.status === "processing" && m.approverId === me.id).length : 0;
  const toPost = d.hr ? memos.filter(m => m.status === "approved").length : 0;
  const newUpd = updates.filter(u => verNum(u.version) > verNum(seen)).length;
  const tasks = await gdTasks(d), taskN = tasks.reduce((n, g) => n + g.items.length, 0);
  const upd = (u, i) => `<div class="gd-upd ${verNum(u.version) > verNum(seen) ? "is-new" : ""}">
      <div class="gd-upd-h"><strong>V${esc(u.version)}</strong><span class="muted">${fmtDate(u.date)}</span>${verNum(u.version) > verNum(seen) ? `<span class="memo-new static">NEW</span>` : ""}</div>
      <ul>${(u.items || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>General Dashboard</h1>
      <div class="sub">Hello, ${esc(me.name)} – what is new for you.</div></div></div>
    <div class="stats gd-stats">
      ${taskN ? `<a class="stat gd-hot" href="#gdTasks" id="gdTaskStat"><div class="n">${taskN}</div><div class="l">Action needed</div></a>` : ""}
      <a class="stat" href="#/memo"><div class="n">${unread}</div><div class="l">New memo${unread === 1 ? "" : "s"}</div></a>
      ${d.approve ? `<a class="stat" href="#/memo/approval"><div class="n">${waiting}</div><div class="l">Waiting for your approval</div></a>` : ""}
      ${d.hr ? `<a class="stat" href="#/memo/list"><div class="n">${toPost}</div><div class="l">Approved – ready to post</div></a>` : ""}
      <div class="stat"><div class="n">${newUpd}</div><div class="l">New system update${newUpd === 1 ? "" : "s"}</div></div>
    </div>
    <div class="gd-grid">
      <section class="card">
        <div class="prog-title gd-title"><span>📢 New Memo</span><a href="#/memo" class="gd-more">View all memos ›</a></div>
        <div class="gd-list">${posted.slice(0, 8).map(m => `<a class="gd-memo" href="#/memo/${m.id}">
            <span class="gd-memo-t">${m.read ? "" : `<span class="memo-new static">NEW</span> `}<strong>${esc(mmTitle(m))}</strong></span>
            <span class="muted">${esc(m.docNo)} · ${tsDate(m.postedAt)} · ${esc(m.createdBy)}${m.kind === "upload" ? " · 📄 PDF" : ""}</span></a>`).join("")
          || `<div class="empty">No memo for you yet.</div>`}</div>
        ${waiting ? `<a class="gd-note" href="#/memo/approval">✔ ${waiting} memo${waiting > 1 ? "s are" : " is"} waiting for your approval ›</a>` : ""}
        ${toPost ? `<a class="gd-note" href="#/memo/list">📢 ${toPost} approved memo${toPost > 1 ? "s are" : " is"} ready to post ›</a>` : ""}
      </section>
      <section class="card">
        <div class="prog-title gd-title"><span>🆕 New System Update</span>${updates[0] ? `<span class="muted" style="font-weight:400;font-size:12px">now V${esc(updates[0].version)}</span>` : ""}</div>
        <div class="gd-list">${updates.slice(0, 4).map(upd).join("") || `<div class="empty">No update notes.</div>`}
          ${updates.length > 4 ? `<details class="gd-older"><summary>Older updates (${updates.length - 4})</summary>${updates.slice(4).map(upd).join("")}</details>` : ""}</div>
      </section>
    </div>
    ${taskN ? `<section class="card gd-tasks" id="gdTasks">
      <div class="prog-title gd-title"><span>✅ Action needed – approvals and things to submit / send</span><span class="muted" style="font-weight:400;font-size:12px">${taskN} item${taskN === 1 ? "" : "s"}</span></div>
      <div class="gd-task-grid">${tasks.map(g => `<div class="gd-task">
          <div class="gd-task-h"><span>${g.icon} <strong>${esc(g.mod)}</strong> – ${esc(g.label)}</span><span class="gd-count">${g.items.length}</span></div>
          ${g.items.slice(0, 5).map(x => `<a class="gd-memo" href="${x.href}"><span><strong>${esc(x.t)}</strong></span><span class="muted">${esc(x.s)}</span></a>`).join("")}
          ${g.items.length > 5 ? `<a class="gd-more" href="${g.more}">+${g.items.length - 5} more ›</a>` : ""}</div>`).join("")}</div>
    </section>` : ""}`;   // only when this account has something to do
  if ($("#gdTaskStat")) $("#gdTaskStat").onclick = e => { e.preventDefault(); $("#gdTasks").scrollIntoView({ behavior: "smooth" }); };
  // ---- My Document Status (only own submitted)
  const docs = gdMyDocs(d, tasks.lists), mods = [...new Set(docs.map(x => x.mod))];
  $("#app").insertAdjacentHTML("beforeend", `<section class="card gd-docs" id="gdDocs">
      <div class="prog-title gd-title"><span>📄 My Document Status <span class="muted" style="font-weight:400;font-size:12px">– only the documents you submitted</span></span>
        <span class="gd-doc-tools"><select id="gdDocMod"><option value="">All modules</option>${mods.map(x => `<option ${gdDocFind.mod === x ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
          <input type="search" id="gdDocQ" placeholder="Search document no. or title" value="${esc(gdDocFind.q)}" /></span></div>
      <div class="table-wrap"><table class="gd-doc-table"><thead><tr><th>Module</th><th>Document</th><th>Title / Staff</th><th>Status</th><th>Last update</th></tr></thead>
        <tbody id="gdDocRows"></tbody></table></div>
      <div class="gd-doc-foot" id="gdDocFoot"></div></section>`);
  const drawDocs = () => {
    const q = gdDocFind.q.toLowerCase();
    const rows = docs.filter(x => (!gdDocFind.mod || x.mod === gdDocFind.mod) && (!q || `${x.no} ${x.title}`.toLowerCase().includes(q)));
    const part = gdDocFind.all ? rows : rows.slice(0, 10);
    $("#gdDocRows").innerHTML = part.map(x => `<tr data-href="${x.href}"><td>${x.icon} ${esc(x.mod)}</td><td><a href="${x.href}"><strong>${esc(x.no)}</strong></a></td>
        <td>${esc(x.title)}</td><td><span class="gds ${GD_ST[x.tone]}">${esc(x.status)}</span></td><td class="muted">${x.at ? fmtTime(x.at) : "—"}</td></tr>`).join("")
      || `<tr><td colspan="5" class="empty">${docs.length ? "No document matches." : "You have not submitted any document yet."}</td></tr>`;
    $("#gdDocFoot").innerHTML = rows.length > 10 ? `<button class="btn btn-sm" id="gdDocAll">${gdDocFind.all ? "Show the latest 10" : `Show all ${rows.length}`}</button>` : "";
    if ($("#gdDocAll")) $("#gdDocAll").onclick = () => { gdDocFind.all = !gdDocFind.all; drawDocs(); };
  };
  drawDocs();
  $("#gdDocMod").onchange = e => { gdDocFind.mod = e.target.value; drawDocs(); };
  $("#gdDocQ").oninput = e => { gdDocFind.q = e.target.value; drawDocs(); };
  $("#gdDocRows").onclick = e => { const tr = e.target.closest("tr[data-href]"); if (tr && !e.target.closest("a")) location.hash = tr.dataset.href; };
  if (updates[0]) {                                         // seen now: the NEW marks go away next time
    try { localStorage.setItem(gdSeenKey(), updates[0].version); } catch { /* private window */ }
    if ($("#gdNewN")) $("#gdNewN").hidden = true;
  }
}

// ================================================================ General – Memo (PRO-2603-010)
//   HR creates a memo (uploads a PDF or types it in) and chooses who can view it → Processing → the person in charge
//   approves it (their e-signature goes into the memo) → Approved → HR posts it → Posted: the chosen staff see it.
const MM_STATUS = { processing: ["Processing", "mms-processing"], approved: ["Approved", "mms-approved"], posted: ["Posted", "mms-posted"],
  cancelled: ["Cancelled", "mms-cancelled"] };
const mmBadge = st => { const [l, c] = MM_STATUS[st] || [st, ""]; return `<span class="mcs ${c}">${esc(l)}</span>`; };
const tsDate = ts => ts ? new Date(ts * 1000).toLocaleDateString("en-GB") : "—";
const MM_AUD = [["states", "State"], ["outlets", "Outlet"], ["departments", "Department"], ["positions", "Position"]];
let mmFind = { status: "", doc: "", title: "", user: "", date: "", appr: "", q: "", page: 1, per: 10 };
let mmApFind = { doc: "", title: "", user: "", date: "", q: "", page: 1, per: 10 };
let memoNotices = { unread: 0, approvals: 0 };
const memoYearsOpen = new Set();

async function loadMemoNotices() {
  if (!me) return;
  try {
    const d = await api("GET", "/api/memo");
    memoNotices = { unread: d.memos.filter(m => m.status === "posted" && !m.read).length,
      approvals: d.approve ? d.memos.filter(m => m.status === "processing" && m.approverId === me.id).length : 0 };
  } catch { /* keep the last */ }
  const a = $("#memoNewN"), b = $("#memoApprN");
  if (a) { a.hidden = !memoNotices.unread; a.textContent = memoNotices.unread; }
  if (b) { b.hidden = !memoNotices.approvals; b.textContent = memoNotices.approvals; }
  updateBell();
}

const memoPdf = m => (m.files || []).filter(f => f.kind === "signed").pop() || (m.files || []).filter(f => f.kind === "memo").pop();

// a memo is written in English, Bahasa Melayu or 中文; HR may also type it in the other two languages - staff read their own
const MEMO_LANG_NAMES = { en: "English", ms: "Bahasa Melayu", zh: "中文" };
const MEMO_L = {
  en: { memo: "MEMO", no: "Memo No.", date: "Date", from: "From", to: "To", subj: "Subject", dept: "Human Resource Department", appr: "Approved by", uid: "User ID", wait: "Waiting for approval" },
  ms: { memo: "MEMO", no: "No. Memo", date: "Tarikh", from: "Daripada", to: "Kepada", subj: "Perkara", dept: "Jabatan Sumber Manusia", appr: "Diluluskan oleh", uid: "ID Pengguna", wait: "Menunggu kelulusan" },
  zh: { memo: "备忘录", no: "备忘录编号", date: "日期", from: "发件人", to: "收件人", subj: "主题", dept: "人力资源部", appr: "批准人", uid: "用户 ID", wait: "等待批准" } };
const memoLangs = m => [m.lang || "en", ...["en", "ms", "zh"].filter(k => k !== (m.lang || "en") && (m.translations || {})[k])];
const memoLangOf = (m, want) => (m.translations && memoLangs(m).includes(want)) || (m.titles && m.titles[want]) ? want : (m.lang || "en");
function memoIn(m, l) {                                    // the memo in language l (its own text when there is no translation)
  if (!l || l === (m.lang || "en")) return m;
  const t = (m.translations || {})[l] || {};
  return { ...m, title: t.title || m.titles?.[l] || m.title, content: t.content || m.content };
}
const mmTitle = m => m.titles?.[LANG] || m.title;          // lists and cards: the title in the reader's language
function memoSignBlock(m, l = "en") {
  const L = MEMO_L[l] || MEMO_L.en;
  return `<div class="memo-sign"><div class="memo-sign-t">${L.appr}</div>
    <div class="memo-sign-img">${m.signature ? `<img src="${m.signature}" alt="signature" />` : `<span class="muted">${m.status === "processing" ? L.wait : ""}</span>`}</div>
    <div class="memo-sign-line"></div>
    <div><strong>${esc(m.approvedBy || m.approverName || "")}</strong></div>
    <div class="muted">${L.uid}: ${esc(m.approvedUser || m.approverUser || "")}${m.approvedAt ? ` &nbsp;·&nbsp; ${tsDate(m.approvedAt)}` : ""}</div></div>`;
}
function memoLetter(m, lang) {                             // a typed-in memo, laid out as a letter (the page and the print)
  const l = memoLangOf(m, lang || LANG), v = memoIn(m, l), L = MEMO_L[l] || MEMO_L.en;
  return `<div class="memo-letter" lang="${l === "zh" ? "zh-CN" : l}">
    <img src="/letterhead.png" class="memo-lh" alt="" onerror="this.remove()" />
    <div class="memo-title">${L.memo}</div>
    <table class="memo-meta">
      <tr><td>${L.no}</td><td>${esc(m.docNo || "")}</td><td>${L.date}</td><td>${tsDate(m.postedAt || m.createdAt || Date.now() / 1000)}</td></tr>
      <tr><td>${L.from}</td><td colspan="3">${L.dept}</td></tr>
      <tr><td>${L.to}</td><td colspan="3">${esc(m.audienceText || "")}</td></tr>
      <tr><td>${L.subj}</td><td colspan="3"><strong>${esc(v.title || "")}</strong></td></tr></table>
    <div class="memo-content">${v.content || ""}</div>
    ${memoSignBlock(m, l)}
  </div>`;
}
const MEMO_PRINT_CSS = `body{margin:0;background:#fff} .memo-letter{color:#111;max-width:none;margin:0;padding:0;font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5}
  .memo-lh{width:100%;max-height:110px;object-fit:contain;display:block;margin-bottom:8px} .memo-title{text-align:center;font-size:26px;font-weight:800;letter-spacing:6px;color:#1e3a8a;margin:6px 0 12px}
  .memo-meta{width:100%;border-collapse:collapse;margin-bottom:14px} .memo-meta td{border:1px solid #cbd5e1;padding:6px 10px;vertical-align:top}
  .memo-meta td:nth-child(odd){background:#f1f5f9;font-weight:600;width:16%;white-space:nowrap} .memo-content{min-height:120px;overflow-wrap:anywhere}
  .memo-sign{width:240px;margin-top:28px;page-break-inside:avoid} .memo-sign-t{font-weight:700;text-decoration:underline}
  .memo-sign-img{height:70px;display:flex;align-items:flex-end} .memo-sign-img img{max-height:70px;max-width:230px}
  .memo-sign-line{border-bottom:1px solid #111;margin:2px 0 6px} .muted{color:#64748b} @page{size:A4;margin:14mm}`;
function memoPrint(m, win, lang) {                         // win: a window opened at the click (pop-up blockers)
  const w = win || window.open("", "_blank");
  if (!w) { tell("Allow pop-ups for this site to print the memo."); return; }
  if (m.kind === "upload") {
    const f = memoPdf(m);
    if (!f) { w.close(); tell("No PDF has been uploaded for this memo yet."); return; }
    w.location.href = `/api/memo/files/${f.id}`;            // the PDF opens – print it from there
    return;
  }
  w.document.open();
  w.document.write(`<!doctype html><title>${esc(m.docNo)} ${esc(memoIn(m, memoLangOf(m, lang || LANG)).title)}</title><style>${MEMO_PRINT_CSS}</style>${memoLetter(m, lang)}`);
  w.document.close();
  setTimeout(() => w.print(), 500);
}
async function memoPrintId(id) {
  const w = window.open("", "_blank");
  if (w) w.document.write("Preparing the memo…");
  try { memoPrint((await api("GET", `/api/memo/${id}`)).memo, w); } catch (ex) { if (w) w.close(); tell(ex.message); }
}

function memoNewChoice() {
  openDialog(`<h3>New memo</h3>
    <div class="memo-choice">
      <a href="#/memo/new/upload" class="memo-choice-b" data-close-dialog><span class="memo-choice-i">☁️</span><strong>Upload</strong><span class="muted">a memo that is already a PDF</span></a>
      <a href="#/memo/new/manual" class="memo-choice-b" data-close-dialog><span class="memo-choice-i">＋</span><strong>Manual Create</strong><span class="muted">type it in (or import from Word)</span></a>
    </div>`, async () => {}, "Close", true);
  $("#dialog").querySelectorAll("[data-close-dialog]").forEach(l => l.onclick = () => $("#dialog").close());
}

// ---------------- View Memo: the posted memos meant for me, by year (cards or a list)
async function renderMemoHome() {
  let d;
  try { d = await api("GET", "/api/memo"); } catch (ex) { toast(ex.message); return; }
  let mode = "grid";
  try { mode = localStorage.getItem("memo.view") || "grid"; } catch { /* private window */ }
  const posted = d.memos.filter(m => m.status === "posted").sort((a, b) => b.postedAt - a.postedAt);
  const yearOf = m => new Date(m.postedAt * 1000).getFullYear(), thisYear = new Date().getFullYear();
  const years = [...new Set([...(d.hr ? [thisYear] : []), ...posted.map(yearOf)])].sort((a, b) => b - a);
  if (!memoYearsOpen.size && years.length) memoYearsOpen.add(years[0]);
  const waiting = d.memos.filter(m => m.status === "processing" && m.approverId === me.id).length;
  $("#app").innerHTML = `
    <div class="page-head"><div><h1 class="memo-h1">MEMO
        <span class="memo-modes"><button class="btn btn-sm ${mode === "grid" ? "on" : ""}" data-mode="grid" title="Cards">▦</button><button class="btn btn-sm ${mode === "list" ? "on" : ""}" data-mode="list" title="List – read the memos one below the other">☰</button></span></h1>
      <div class="sub">Memos posted to you${d.hr ? " – as HR you see every posted memo here; all memos (any status) are in Memo Listings" : ""}.</div></div>
      <div class="actions">${d.hr ? `<button class="btn btn-primary" id="memoNew">New</button>` : ""}</div></div>
    ${waiting ? `<div class="memo-wait">✔ ${waiting} memo${waiting > 1 ? "s are" : " is"} waiting for your approval – <a href="#/memo/approval">open Memo Approval</a></div>` : ""}
    <div id="memoBody"></div>`;
  const card = m => `<a class="memo-card" href="#/memo/${m.id}">
      <div class="memo-thumb" data-thumb="${m.id}" data-v="${m.updatedAt}">${m.read ? "" : `<span class="memo-new">NEW</span>`}<span class="memo-ph">MEMO</span>
        <span class="memo-thumb-no">${m.kind === "upload" ? "📄 " : ""}${esc(m.docNo)}</span></div>
      <div class="memo-cap"><span>Title:</span><span>${esc(mmTitle(m))}</span><span>Created By:</span><span>${esc(m.createdBy)}</span>
        <span>Created Date:</span><span>${tsDate(m.postedAt)}</span></div></a>`;
  const draw = () => {
    if (!years.length) { $("#memoBody").innerHTML = `<div class="card"><div class="empty">No memo for you yet.</div></div>`; return; }
    if (mode === "grid") {
      $("#memoBody").innerHTML = years.map((y, i) => {
        const list = posted.filter(m => yearOf(m) === y), open = memoYearsOpen.has(y);
        return `<section class="memo-year"><button type="button" class="memo-yh" data-year="${y}">${y} <span class="chev">${open ? "▾" : "▸"}</span>
            <span class="muted" style="font-size:13px;font-weight:400">${list.length} memo${list.length === 1 ? "" : "s"}</span></button>
          ${open ? `<div class="memo-grid">${d.hr && i === 0 && y === thisYear ? `<button type="button" class="memo-card memo-add" id="memoPlus" title="New memo"><div class="memo-thumb"><span class="memo-plus">+</span></div><div class="memo-cap"><span></span><span>New memo</span></div></button>` : ""}
            ${list.map(card).join("") || (d.hr ? "" : `<div class="muted">No memo.</div>`)}</div>` : ""}</section>`;
      }).join("");
      memoThumbs();
      return;
    }
    const shown = posted.slice(0, mmListShow);
    $("#memoBody").innerHTML = (shown.map(m => {
      const f = memoPdf(m);
      return `<div class="memo-li"><div class="memo-li-h"><span>${tsDate(m.postedAt)}</span><span class="grow">${m.read ? "" : `<span class="memo-new static">NEW</span> `}${esc(mmTitle(m))}</span>
          <a class="btn btn-sm" href="#/memo/${m.id}">Open</a></div>
        <div class="memo-li-body">${m.kind === "upload" ? (f ? `<iframe class="memo-pdf" loading="lazy" src="/api/memo/files/${f.id}#view=FitH"></iframe>` : "")
          : `<div class="memo-li-load" data-load="${m.id}"><span class="muted">Loading…</span></div>`}</div></div>`;
    }).join("") || `<div class="card"><div class="empty">No memo for you yet.</div></div>`)
      + (posted.length > shown.length ? `<div style="text-align:center"><button class="btn" id="memoMore">Show more (${posted.length - shown.length} older)</button></div>` : "");
    document.querySelectorAll("[data-load]").forEach(async el => {      // typed memos: fetch the text
      try { const { memo } = await api("GET", `/api/memo/${el.dataset.load}`); el.outerHTML = memoLetter(memo); } catch { el.innerHTML = `<span class="muted">Cannot load.</span>`; }
    });
    if ($("#memoMore")) $("#memoMore").onclick = () => { mmListShow += 10; draw(); };
  };
  draw();
  if (mode === "list") setTimeout(loadMemoNotices, 1500);              // the list marks them as read
  $("#memoBody").onclick = e => {
    const y = e.target.closest("[data-year]");
    if (y) { const n = +y.dataset.year; memoYearsOpen.has(n) ? memoYearsOpen.delete(n) : memoYearsOpen.add(n); draw(); return; }
    if (e.target.closest("#memoPlus")) memoNewChoice();
  };
  document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
    mode = b.dataset.mode;
    try { localStorage.setItem("memo.view", mode); } catch { /* private window */ }
    renderMemoHome();
  });
  if ($("#memoNew")) $("#memoNew").onclick = memoNewChoice;
}
let mmListShow = 10;

// ---- card pictures: the memo itself on the front (typed memo = the letter, PDF = its first page)
const memoThumbCache = new Map();
let pdfjsLoading = null;
function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  return pdfjsLoading ||= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js"; res(); };
    s.onerror = () => { pdfjsLoading = null; rej(new Error("PDF tool not loaded")); };
    document.head.appendChild(s);
  });
}
const fitThumbs = () => document.querySelectorAll(".memo-thumb-scale").forEach(x => { x.style.transform = `scale(${x.parentElement.clientWidth / 820})`; });
window.addEventListener("resize", fitThumbs);
async function memoThumbOne(el) {
  const key = el.dataset.thumb + ":" + el.dataset.v;
  let html = memoThumbCache.get(key);
  if (!html) {
    const { memo } = await api("GET", `/api/memo/${el.dataset.thumb}?peek=1`);
    if (memo.kind === "manual") html = `<div class="memo-thumb-pv"><div class="memo-thumb-scale">${memoLetter(memo)}</div></div>`;
    else {
      const f = memoPdf(memo);
      if (!f) return;
      await loadPdfJs();
      const doc = await pdfjsLib.getDocument({ url: `/api/memo/files/${f.id}` }).promise;
      const page = await doc.getPage(1), v1 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: 520 / v1.width });
      const c = document.createElement("canvas");
      c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      html = `<div class="memo-thumb-pv${c.width > c.height ? " wide" : ""}"><img src="${c.toDataURL("image/jpeg", 0.85)}" alt="" /></div>`;
      doc.destroy();
    }
    memoThumbCache.set(key, html);
  }
  if (!el.isConnected || el.classList.contains("has-pv")) return;
  el.insertAdjacentHTML("afterbegin", html);
  el.classList.add("has-pv");
  fitThumbs();
}
function memoThumbs() {
  const io = new IntersectionObserver(list => list.forEach(x => {
    if (!x.isIntersecting) return;
    io.unobserve(x.target);
    memoThumbOne(x.target).catch(() => { /* no picture: the card keeps "MEMO" */ });
  }), { rootMargin: "200px" });
  document.querySelectorAll(".memo-thumb[data-thumb]").forEach(el => io.observe(el));
}

function renderMemoNewPage() {
  $("#app").innerHTML = `
    <div class="page-head"><div><div class="crumbs"><a href="#/memo">Memo</a> › <span>New</span></div><h1 style="margin-top:6px">Memo Create Form</h1>
      <div class="sub">Upload a memo that is already a PDF, or type it in – the system lays it out as a memo letter.</div></div></div>
    <div class="card" style="padding:24px"><div class="memo-choice">
      <a href="#/memo/new/upload" class="memo-choice-b"><span class="memo-choice-i">☁️</span><strong>Upload</strong><span class="muted">PDF only</span></a>
      <a href="#/memo/new/manual" class="memo-choice-b"><span class="memo-choice-i">＋</span><strong>Manual Create</strong><span class="muted">type it in, or import from Word (.docx)</span></a>
    </div></div>`;
}

// ---------------- Memo Upload Form / Memo Create Form (also Edit)
async function renderMemoForm(id, kind) {
  let ch, m = null;
  try {
    ch = await api("GET", "/api/memo/choices");
    if (id) { m = (await api("GET", `/api/memo/${id}`)).memo; kind = m.kind; }
  } catch (ex) { toast(ex.message); location.replace("#/memo"); return; }
  if (m && !["processing", "approved"].includes(m.status)) { await tell("A Posted or Cancelled memo cannot be edited."); location.replace(`#/memo/${id}`); return; }
  const upload = kind === "upload", pdf = m && (m.files || []).filter(f => f.kind === "memo").pop();
  const aud = m?.audience || { all: false };
  const sel = (k, v) => (aud[k] || []).some(x => x.toLowerCase() === String(v).toLowerCase());
  const canSetup = isSuper() || me.role === "admin";
  const items = {
    states: ch.states.map(s => [s, s]),
    outlets: ch.outlets.map(o => [o.code, `${o.code}${o.name ? " – " + o.name : ""}`]),
    departments: ch.departments.map(s => [s, s]), positions: ch.positions.map(s => [s, s]) };
  const group = (key, label) => `<div class="mm-group" data-group="${key}"><div class="mm-gt">${label}
      ${items[key].length > 8 ? `<span class="mm-gtools"><input type="search" class="mm-gsearch" data-gs="${key}" placeholder="Search ${label.toLowerCase()}…" />
        <button type="button" class="btn btn-sm" data-gall="${key}">Tick shown</button><button type="button" class="btn btn-sm" data-gnone="${key}">Clear</button></span>` : ""}</div>
    <div class="mm-checks ${items[key].length > 24 ? "scroll" : ""}">${items[key].map(([v, l]) => `<label class="mm-check"><input type="checkbox" data-g="${key}" value="${esc(v)}" ${sel(key, v) ? "checked" : ""} /> <span>${esc(l)}</span></label>`).join("")
      || `<span class="muted" style="font-size:12px">None in HR Setting yet${canSetup ? ` – <a href="#/settings/hr">add them in Settings › HR Setting</a>` : ""}.</span>`}</div></div>`;
  $("#app").innerHTML = `
    <div class="page-head"><div><div class="crumbs"><a href="#/memo">Memo</a> › ${m ? `<a href="#/memo/${m.id}">${esc(m.docNo)}</a> › <span>Edit</span>` : `<span>New</span>`}</div>
      <h1 style="margin-top:6px">${upload ? "MEMO Upload Form" : "MEMO Create Form"}</h1></div></div>
    ${m?.status === "approved" ? `<div class="memo-wait warn">⚠ This memo is already approved. Saving a change sends it back to <strong>Processing</strong> – the person in charge approves it again.</div>` : ""}
    <form class="card mm-form" id="mmForm" novalidate>
      <div class="mm-grid">
        <label class="field"><span>Document ID</span><input type="text" value="${esc(m?.docNo || "Auto Generated")}" disabled /></label>
        <label class="field"><span>Title <b class="req">*</b></span><input type="text" name="title" maxlength="200" required value="${esc(m?.title || "")}" /></label>
        <label class="field"><span>Written in</span><select name="mlang" class="no-tr">${Object.entries(MEMO_LANG_NAMES).map(([k, n]) =>
          `<option value="${k}" ${(m?.lang || LANG) === k ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        <label class="field"><span>User ID</span><input type="text" value="${esc(m?.createdUser || me.username)}" disabled /></label>
        <label class="field"><span>Created Date</span><input type="text" value="${tsDate(m?.createdAt || Date.now() / 1000)}" disabled /></label>
        <label class="field"><span>Person in Charge (approves the memo) <b class="req">*</b></span>
          <select name="approver" required><option value="">– choose –</option>${ch.approvers.map(a => `<option value="${a.id}" ${m?.approverId === a.id ? "selected" : ""}>${esc(a.name)} (${esc(a.username)})</option>`).join("")}</select>
          ${ch.approvers.length ? "" : `<small class="muted">Nobody can approve memos yet – tick “Memo – Approve” for the person in charge in Settings › Access Control.</small>`}</label>
      </div>
      ${upload ? `<div class="field"><span>MEMO <b class="req">*</b></span>
          <label class="mc-drop" id="mmDrop"><input type="file" id="mmFile" accept=".pdf,application/pdf" hidden />
            <span class="mc-drop-icon">📁</span><strong>Drag your files here or click in this area.</strong><span class="muted" style="font-size:12px">(.pdf only)</span>
            <span id="mmFileName" class="mm-file">${pdf ? `Current: 📄 ${esc(pdf.name)} – choose a file to replace it` : ""}</span></label></div>`
      : `<div class="field"><span>Content <b class="req">*</b> <span class="muted" style="font-weight:400">– laid out in the memo letter (Memo No., Date, From, To, Subject are filled in by the system)</span></span>
          <div class="eb-toolbar" id="mmTools">
            <button type="button" class="eb-tool" data-cmd="bold" title="Bold (Ctrl+B)"><b>B</b></button>
            <button type="button" class="eb-tool" data-cmd="italic" title="Italic (Ctrl+I)"><i>I</i></button>
            <button type="button" class="eb-tool" data-cmd="underline" title="Underline (Ctrl+U)"><u>U</u></button>
            <label class="eb-tool eb-color" title="Text colour"><span style="border-bottom:3px solid #d0021b">A</span><input type="color" id="mmColor" value="#d0021b" /></label>
            <select id="mmSize" class="eb-tool" title="Text size"><option value="">Size</option><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">Larger</option><option value="6">Huge</option></select>
            <button type="button" class="eb-tool" data-cmd="justifyLeft" title="Align left">⯇</button>
            <button type="button" class="eb-tool" data-cmd="justifyCenter" title="Centre">≡</button>
            <button type="button" class="eb-tool" data-cmd="justifyRight" title="Align right">⯈</button>
            <button type="button" class="eb-tool" data-cmd="insertUnorderedList" title="Bullet list">• List</button>
            <button type="button" class="eb-tool" data-cmd="insertOrderedList" title="Numbered list">1. List</button>
            <button type="button" class="eb-tool" data-cmd="removeFormat" title="Clear formatting of the selected text">⌫ Clear</button>
            <span class="eb-tool-sep"></span>
            <label class="eb-tool" title="Take the text (with its formatting) from a Word file"><span>📄 Import Word (.docx)</span><input type="file" id="mmDocx" accept=".docx" hidden /></label>
          </div>
          <div id="mmBody" class="eb-editor mm-editor" contenteditable="true">${m?.content || ""}</div></div>`}
      <div class="field mm-trans" id="mmTrans"><span>🌐 Other languages <span class="muted" style="font-weight:400">– optional: type the memo in the other two languages as well. Staff read it in their own language; where a language is empty they see the main one.${upload ? "" : " The toolbar above works on the text box you clicked last."}</span></span>
        <div id="mmTrPanes" class="mm-tr-panes"></div></div>
      <div class="field mm-aud" id="mmAud"><span>Who can view <b class="req">*</b> <span class="muted" style="font-weight:400">– <strong>where</strong>: tick a State to see only its outlets (State only = all its outlets; tick outlets to narrow) ·
          <strong>who</strong>: tick a Department to see only its positions (Department only = all its positions) · both chosen = the staff must match both</span></span>
        <div class="mm-group mm-all"><label class="mm-check"><input type="checkbox" id="mmAll" ${aud.all ? "checked" : ""} /> <strong>All</strong></label></div>
        ${MM_AUD.map(([k, l]) => group(k, l)).join("")}
        <div class="muted" style="font-size:12px;margin-top:6px">State, Outlet, Department and Position lists come from Settings › HR Setting.</div>
      </div>
      <div class="mm-btns"><a class="btn" href="${m ? `#/memo/${m.id}` : "#/memo"}" title="Close without saving">✕</a><button type="submit" class="btn btn-primary" id="mmSave">Save</button></div>
    </form>
    <section class="card mm-preview">
      <div class="prog-title">👁 Preview <span class="muted" style="font-weight:400;font-size:12px">– how the memo will look and who gets it (updates as you type; nothing is saved until you press Save)</span></div>
      <div class="memo-kv mm-pv-info" id="mmPvInfo"></div>
      <div class="mm-pv-body" id="mmPvBody"></div>
    </section>`;
  const form = $("#mmForm");
  // ---- who can view: All switches the other boxes off; search / tick shown / clear per list
  const allBox = $("#mmAll");
  const syncAll = () => $("#mmAud").classList.toggle("disabled", allBox.checked);
  allBox.onchange = syncAll; syncAll();
  // State -> only its outlets; Department -> only its positions (a ticked outlet / position outside the choice is unticked)
  const ticked = k => [...document.querySelectorAll(`[data-g="${k}"]:checked`)].map(x => x.value.toLowerCase());
  const posDept = Object.fromEntries(Object.entries(ch.posDept || {}).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
  const narrow = (key, by, keyOf, empty) => {
    const sel = ticked(by), boxes = [...document.querySelectorAll(`[data-g="${key}"]`)];
    let shown = 0;
    for (const x of boxes) {
      const ok = !sel.length || sel.includes(keyOf(x.value));
      x.closest(".mm-check").classList.toggle("off", !ok);
      if (!ok) x.checked = false;
      shown += ok;
    }
    const grp = document.querySelector(`[data-group="${key}"]`);
    let note = grp.querySelector(".mm-cnote");
    if (!note) { note = document.createElement("div"); note.className = "mm-cnote muted"; grp.appendChild(note); }
    note.textContent = !sel.length ? "" : shown ? `Showing ${shown} of ${boxes.length} – only the ticked ${empty}. None ticked here = all of them.` : `None in the ticked ${empty} (set it in Settings › HR Setting).`;
  };
  const cascade = () => {
    narrow("outlets", "states", code => (ch.outlets.find(o => o.code === code)?.state || "").toLowerCase(), "state(s)");
    narrow("positions", "departments", pos => posDept[pos.toLowerCase()] || "", "department(s)");
  };
  $("#mmAud").addEventListener("change", e => { if (["states", "departments"].includes(e.target.dataset.g)) cascade(); });
  cascade();
  $("#mmAud").addEventListener("input", e => {
    const k = e.target.dataset.gs;
    if (k) { const q = e.target.value.toLowerCase(); document.querySelectorAll(`[data-g="${k}"]`).forEach(x => { x.closest(".mm-check").hidden = !x.closest(".mm-check").textContent.toLowerCase().includes(q); }); }
    $("#mmAud").classList.remove("missing");
  });
  $("#mmAud").addEventListener("click", e => {
    const a = e.target.closest("[data-gall]"), n = e.target.closest("[data-gnone]");
    if (a) document.querySelectorAll(`[data-g="${a.dataset.gall}"]`).forEach(x => { const l = x.closest(".mm-check"); if (!l.hidden && !l.classList.contains("off")) x.checked = true; });
    if (a || n) cascade();
    if (n) document.querySelectorAll(`[data-g="${n.dataset.gnone}"]`).forEach(x => { x.checked = false; });
  });
  const audience = () => {
    const out = { all: allBox.checked };
    for (const [k] of MM_AUD) out[k] = allBox.checked ? [] : [...document.querySelectorAll(`[data-g="${k}"]:checked`)].map(x => x.value);
    return out;
  };
  // ---- the PDF (upload) or the text editor (manual)
  let file = null;
  if (upload) {
    const drop = $("#mmDrop"), pick = f => {
      if (!f) return;
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { tell("Upload the memo as a PDF file (.pdf only)."); return; }
      file = f; $("#mmFileName").textContent = `📄 ${f.name} (${fmtSize(f.size)})`; drop.classList.remove("missing");
    };
    $("#mmFile").onchange = e => pick(e.target.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
    drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); pick(e.dataTransfer.files[0]); };
  } else {
    const editor = $("#mmBody");
    let range = null, activeEd = editor;                     // the toolbar works on the text box clicked last
    document.execCommand("styleWithCSS", false, true);
    const keep = () => { const s = window.getSelection(); if (s.rangeCount && activeEd.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); };
    form.addEventListener("focusin", e => { const ed = e.target.closest?.("#mmBody, [data-trc]"); if (ed && ed !== activeEd) { activeEd = ed; range = null; } });
    ["keyup", "mouseup", "input"].forEach(ev => form.addEventListener(ev, e => { if (e.target.closest?.("#mmBody, [data-trc]")) keep(); }));
    const cmd = (name, value = null) => {
      if (!activeEd.isConnected) activeEd = editor;
      activeEd.focus();
      if (range) { const s = window.getSelection(); s.removeAllRanges(); s.addRange(range); }
      document.execCommand(name, false, value); keep();
    };
    document.querySelectorAll("#mmTools [data-cmd]").forEach(b => { b.onmousedown = e => e.preventDefault(); b.onclick = () => cmd(b.dataset.cmd); });
    $("#mmColor").onchange = e => cmd("foreColor", e.target.value);
    $("#mmSize").onchange = e => { if (e.target.value) cmd("fontSize", e.target.value); e.target.value = ""; };
    editor.addEventListener("input", () => editor.classList.remove("missing"));
    $("#mmDocx").onchange = async e => {
      const f = e.target.files[0];
      e.target.value = "";
      if (!f) return;
      if (editor.innerText.trim() && !await ask("Replace the memo text with the Word file?", "Replace")) return;
      try {
        const r = await api("POST", `/api/memo/word?name=${encodeURIComponent(f.name)}`, f);
        editor.innerHTML = r.content;
        if (r.title && !form.title.value.trim()) form.title.value = r.title;
        toast("Word file imported – check the text, then Save");
      } catch (ex) { tell(ex.message); }
    };
  }
  // ---- translations: one pane per other language (title, and the text of a typed memo)
  const trv = JSON.parse(JSON.stringify(m?.translations || {}));
  const srcLang = () => form.mlang.value;
  const readPanes = () => document.querySelectorAll("#mmTrPanes [data-trl]").forEach(p => {
    const l = p.dataset.trl;
    trv[l] = { title: p.querySelector("[data-trt]").value, content: upload ? "" : p.querySelector("[data-trc]").innerHTML };
  });
  const drawPanes = () => {
    $("#mmTrPanes").innerHTML = Object.keys(MEMO_LANG_NAMES).filter(l => l !== srcLang()).map(l => `<div class="mm-tr-pane" data-trl="${l}">
      <div class="mm-tr-h no-tr">${MEMO_LANG_NAMES[l]}</div>
      <input type="text" data-trt="${l}" maxlength="200" placeholder="Title – ${MEMO_LANG_NAMES[l]}" value="${esc(trv[l]?.title || "")}" />
      ${upload ? "" : `<div class="eb-editor mm-editor mm-tr-editor" contenteditable="true" data-trc="${l}">${trv[l]?.content || ""}</div>`}</div>`).join("");
  };
  drawPanes();
  form.mlang.onchange = () => { readPanes(); delete trv[srcLang()]; drawPanes(); pvSoon(); };
  const translations = () => { readPanes(); const out = {}; for (const [l, v] of Object.entries(trv)) if (l !== srcLang()) out[l] = v; return out; };

  // ---- preview (below the form): every detail + the memo as it will look
  const audText = a => {
    if (a.all) return "All staff";
    const where = a.outlets.length ? `Outlet: ${a.outlets.join(", ")}` : a.states.length ? `State: ${a.states.join(", ")}` : "";
    const who = a.positions.length ? `Position: ${a.positions.join(", ")}` : a.departments.length ? `Department: ${a.departments.join(", ")}` : "";
    return [where, who].filter(Boolean).join(" + ");
  };
  const todo = t => `<span class="mm-pv-todo">${t}</span>`;
  let pvFile, pvUrl = "", reachKey = "", reachText = "", reachTimer = null, pvTimer = null, pvLang = m?.lang || LANG;
  $("#mmPvBody").addEventListener("click", e => { const b = e.target.closest("[data-pvl]"); if (b) { pvLang = b.dataset.pvl; drawPreview(); } });
  const drawPreview = () => {
    const a = audience(), appr = ch.approvers.find(x => x.id === +form.approver.value), at = audText(a);
    const memo = { docNo: m?.docNo || "(given on Save)", title: form.title.value.trim(), createdAt: m?.createdAt || Date.now() / 1000, audienceText: at,
      content: upload ? "" : $("#mmBody").innerHTML, status: "processing", approverName: appr?.name || "", approverUser: appr?.username || "" };
    const key = JSON.stringify(a);
    $("#mmPvInfo").innerHTML = `
      <span>Document ID</span><span>${m ? esc(m.docNo) : `<span class="muted">given by the system when you Save (MEMO-YYMM-###)</span>`}</span>
      <span>Title</span><span>${memo.title ? `<strong>${esc(memo.title)}</strong>` : todo("type the Title")}</span>
      <span>Type</span><span>${upload ? `Uploaded PDF – ${file ? `📄 ${esc(file.name)} (${fmtSize(file.size)})` : pdf ? `📄 ${esc(pdf.name)}` : todo("choose the PDF")}` : "Typed in (memo letter)"}</span>
      <span>Created by</span><span>${esc(m?.createdBy || me.name)} (${esc(m?.createdUser || me.username)}) · ${tsDate(memo.createdAt)}</span>
      <span>Person in charge</span><span>${appr ? `${esc(appr.name)} (${esc(appr.username)}) – approves with e-signature` : todo("choose the Person in Charge")}</span>
      <span>Who can view</span><span>${at ? esc(at) : todo("choose who can view")}</span>
      <span>Reaches</span><span id="mmPvReach">${!at ? "–" : key === reachKey && reachText ? reachText : `<span class="muted">counting…</span>`}</span>
      <span>After Save</span><span>Processing → ${appr ? esc(appr.name) : "the person in charge"} approves → HR posts → the staff above see it</span>`;
    if (at && key !== reachKey) {
      reachKey = key; reachText = ""; clearTimeout(reachTimer);
      reachTimer = setTimeout(async () => {
        try {
          const r = await api("POST", "/api/memo/reach", { audience: a });
          if (reachKey !== key) return;
          reachText = r.staff ? `<strong>${r.staff} staff</strong> at ${r.outlets} outlet${r.outlets === 1 ? "" : "s"} (from Staff Master Data)` +
            (r.staff > r.logins ? ` – <span class="mm-pv-todo">${r.staff - r.logins} of them have no login yet and cannot read it</span>` : " – all have a login")
            : todo("nobody in Staff Master Data matches – check the ticks (and the States / Departments in HR Setting)");
          if ($("#mmPvReach")) $("#mmPvReach").innerHTML = reachText;
        } catch { /* leave it */ }
      }, 400);
    }
    if (!at) reachKey = "";
    memo.lang = srcLang(); memo.translations = translations();
    if (!upload) {
      const langs = memoLangs(memo).filter(l => l === memo.lang || memo.translations[l]?.title || (memo.translations[l]?.content || "").replace(/<[^>]*>/g, "").trim());
      if (!langs.includes(pvLang)) pvLang = memo.lang;
      $("#mmPvBody").innerHTML = (langs.length > 1 ? `<div class="mm-langs no-tr">👁 ${langs.map(l => `<button type="button" class="btn btn-sm ${l === pvLang ? "btn-primary" : ""}" data-pvl="${l}">${MEMO_LANG_NAMES[l]}</button>`).join("")}</div>` : "")
        + memoLetter(memo, pvLang);
      return;
    }
    if (file !== pvFile || !$("#mmPvBody").innerHTML) {             // the PDF only reloads when another file is chosen
      pvFile = file;
      if (pvUrl) URL.revokeObjectURL(pvUrl);
      pvUrl = file ? URL.createObjectURL(file) : "";
      $("#mmPvBody").innerHTML = (pvUrl || pdf ? `<iframe class="memo-pdf" src="${pvUrl || `/api/memo/files/${pdf.id}`}#view=FitH" title="PDF preview"></iframe>`
        : `<div class="empty">Choose the PDF above – it shows here.</div>`) + `<div class="memo-stamp" id="mmPvSign"></div>`;
    }
    $("#mmPvSign").innerHTML = memoSignBlock(memo) + `<div class="muted" style="font-size:12px;align-self:flex-end;margin-left:12px">The signature is added at the bottom right of the PDF's last page when approved.</div>`;
  };
  const pvSoon = () => { clearTimeout(pvTimer); pvTimer = setTimeout(drawPreview, 250); };
  form.addEventListener("input", pvSoon);
  form.addEventListener("change", pvSoon);
  form.addEventListener("click", e => { if (e.target.closest("[data-gall],[data-gnone]")) pvSoon(); });
  if (!upload) new MutationObserver(pvSoon).observe($("#mmBody"), { childList: true, subtree: true, characterData: true, attributes: true });
  if (upload) $("#mmDrop").addEventListener("drop", () => setTimeout(pvSoon, 50));
  drawPreview();

  form.onsubmit = async e => {
    e.preventDefault();
    form.classList.add("tried");
    const a = audience(), problems = [];
    if (!form.title.value.trim()) problems.push("Title");
    if (!form.approver.value) problems.push("Person in Charge");
    if (upload && !file && !pdf) { problems.push("MEMO (PDF)"); $("#mmDrop").classList.add("missing"); }
    if (!upload && !$("#mmBody").innerText.trim()) { problems.push("Content"); $("#mmBody").classList.add("missing"); }
    if (!a.all && !MM_AUD.some(([k]) => a[k].length)) { problems.push("Who can view"); $("#mmAud").classList.add("missing"); }
    if (problems.length) { tell("Please fill in: " + problems.join(", ") + "."); return; }
    const btn = $("#mmSave"); btn.disabled = true; btn.textContent = "Saving…";
    let saved;
    try {
      const body = { kind, title: form.title.value, approverId: +form.approver.value, audience: a, content: upload ? "" : $("#mmBody").innerHTML,
        lang: srcLang(), translations: translations() };
      saved = (await api(id ? "PUT" : "POST", id ? `/api/memo/${id}` : "/api/memo", body)).memo;
    } catch (ex) { btn.disabled = false; btn.textContent = "Save"; tell(ex.message); return; }
    if (file) {
      try { await api("POST", `/api/memo/${saved.id}/files?name=${encodeURIComponent(file.name)}`, file); }
      catch (ex) { await tell(`${saved.docNo} is saved, but the PDF did not upload: ${ex.message}\n\nChoose the PDF again and Save.`); location.hash = `#/memo/${saved.id}/edit`; return; }
    }
    toast(`${saved.docNo} saved – waiting for ${saved.approverName}'s approval`);
    location.hash = `#/memo/${saved.id}`;
  };
}

// ---------------- one memo: read it; approve / post / edit / cancel / print
async function renderMemoOpen(id) {
  let d;
  try { d = await api("GET", `/api/memo/${id}`); } catch (ex) { toast(ex.message); location.replace("#/memo"); return; }
  const m = d.memo, hr = d.hr, pdf = memoPdf(m), signed = (m.files || []).some(f => f.kind === "signed");
  if (m.status === "posted") loadMemoNotices();
  const back = hr ? "#/memo/list" : d.canApprove ? "#/memo/approval" : "#/memo";
  $("#app").innerHTML = `
    <div class="page-head"><div><div class="crumbs"><a href="#/memo">Memo</a>${hr ? ` › <a href="#/memo/list">Memo Listings</a>` : ""} › <span>${esc(m.docNo)}</span></div>
        <h1 style="margin-top:6px" id="mmH1">${esc(mmTitle(m))}</h1>
        <div class="sub">${mmBadge(m.status)} &nbsp;${esc(m.docNo)} · created by ${esc(m.createdBy)} (${esc(m.createdUser)}) on ${tsDate(m.createdAt)}${m.postedAt ? ` · posted ${tsDate(m.postedAt)}` : ""}</div></div>
      <div class="actions">
        <button class="btn" id="mmPrint">🖨 Print</button>
        ${hr && ["processing", "approved"].includes(m.status) ? `<a class="btn" href="#/memo/${m.id}/edit">✎ Edit</a>` : ""}
        ${hr && m.status !== "cancelled" ? `<button class="btn btn-danger" id="mmCancel">Cancel</button>` : ""}
        ${d.canApprove ? `<button class="btn btn-primary" id="mmApprove">✔ Approve</button>` : ""}
        ${hr && m.status === "approved" ? `<button class="btn btn-success" id="mmPost">📢 Post</button>` : ""}
      </div></div>
    ${d.canApprove ? `<div class="memo-wait">✔ This memo is waiting for your approval. Read it, then press <strong>Approve</strong> – your e-signature is added to the memo.</div>` : ""}
    ${hr && m.status === "approved" ? `<div class="memo-wait ok">Approved by ${esc(m.approvedBy)} (${esc(m.approvedUser)}) on ${tsDate(m.approvedAt)}. Check the memo and press <strong>Post</strong> – it then shows to: <strong>${esc(m.audienceText)}</strong>.</div>` : ""}
    ${m.status === "cancelled" ? `<div class="memo-wait bad">Cancelled by ${esc(m.cancelledBy)} on ${tsDate(m.cancelledAt)}${m.cancelReason ? ` – ${esc(m.cancelReason)}` : ""}.</div>` : ""}
    ${d.canSign && !signed ? `<div class="memo-wait warn">Your signature is not in the PDF yet. <button class="btn btn-sm" id="mmSignPdf">Add my signature to the PDF</button></div>` : ""}
    ${memoLangs(m).length > 1 || Object.keys(m.titles || {}).length > 1 ? `<div class="mm-langs no-tr" id="mmLangs">🌐 ${[...new Set([...memoLangs(m), ...["en", "ms", "zh"].filter(k => (m.titles || {})[k])])]
      .map(k => `<button type="button" class="btn btn-sm" data-ml="${k}">${MEMO_LANG_NAMES[k]}${k === (m.lang || "en") ? " ✎" : ""}</button>`).join("")}
      <span class="muted">✎ = written in · the others are translations checked by HR</span></div>` : ""}
    <div class="memo-page">
      <div class="card memo-paper" id="mmPaper">${m.kind === "upload"
        ? (pdf ? `<iframe class="memo-pdf" src="/api/memo/files/${pdf.id}#view=FitH" title="${esc(m.title)}"></iframe>` : `<div class="empty">No PDF has been uploaded yet.</div>`)
          + (m.signature && !signed ? `<div class="memo-stamp">${memoSignBlock(m)}</div>` : "")
        : memoLetter(m)}</div>
      ${hr || d.canApprove ? `<div class="card memo-side">
        <div class="prog-title">Details</div>
        <div class="memo-kv"><span>Who can view</span><span>${esc(m.audienceText)}</span>
          <span>Person in charge</span><span>${esc(m.approverName)} (${esc(m.approverUser)})</span>
          <span>Approval ID</span><span>${esc(m.approvedUser || "–")}</span>
          <span>Type</span><span>${m.kind === "upload" ? `Uploaded PDF${pdf ? ` · <a href="/api/memo/files/${pdf.id}" target="_blank" rel="noopener">open</a>` : ""}` : "Typed in"}</span></div>
        ${d.history.length ? `<details class="memo-hist"><summary>History (${d.history.length})</summary>${d.history.map(h => `<div><span class="muted">${fmtTime(h.at)}</span> · ${esc(h.by)} – ${esc(h.new || h.field || h.action)}</div>`).join("")}</details>` : ""}
      </div>` : ""}
    </div>`;
  let showLang = memoLangOf(m, LANG);
  const showIn = l => {
    showLang = l;
    document.querySelectorAll("#mmLangs [data-ml]").forEach(b => b.classList.toggle("btn-primary", b.dataset.ml === l));
    $("#mmH1").textContent = memoIn(m, l).title;
    if (m.kind !== "upload") $("#mmPaper").innerHTML = memoLetter(m, l);
  };
  if ($("#mmLangs")) { $("#mmLangs").onclick = e => { const b = e.target.closest("[data-ml]"); if (b) showIn(b.dataset.ml); }; showIn(showLang); }
  $("#mmPrint").onclick = () => memoPrint(m, window.open("", "_blank"), showLang);
  if ($("#mmCancel")) $("#mmCancel").onclick = () => openDialog(`<h3>Cancel ${esc(m.docNo)}?</h3>
      <p class="muted" style="margin:0 0 8px">${m.status === "posted" ? "It stops showing to the staff. " : ""}It stays in Memo Listings for record.</p>
      <label class="field"><span>Reason (optional)</span><input type="text" name="reason" maxlength="300" /></label>`,
    async f => { await api("POST", `/api/memo/${id}/cancel`, { reason: f.reason.value }); $("#dialog").close(); toast("Memo cancelled"); renderMemoOpen(id); }, "Cancel memo");
  if ($("#mmPost")) $("#mmPost").onclick = async () => {
    if (!await ask(`Post ${m.docNo} now?\n\nIt shows to: ${m.audienceText}`, "Post")) return;
    try { await api("POST", `/api/memo/${id}/post`, {}); toast("Memo posted"); renderMemoOpen(id); } catch (ex) { tell(ex.message); }
  };
  if ($("#mmApprove")) $("#mmApprove").onclick = () => memoApprove(m, () => renderMemoOpen(id));
  if ($("#mmSignPdf")) $("#mmSignPdf").onclick = async e => {
    e.target.disabled = true; e.target.textContent = "Adding…";
    try { await memoSignPdf(m); toast("Signature added to the PDF"); } catch (ex) { tell("The signature could not be added to the PDF: " + ex.message); }
    renderMemoOpen(id);
  };
}

// ---------------- approve: draw / upload / reuse the e-signature
async function memoApprove(m, after) {
  let saved = "";
  try { saved = (await api("GET", "/api/memo/signature")).signature; } catch { /* none */ }
  openDialog(`<h3>Approve ${esc(m.docNo)}</h3>
    <p class="muted" style="margin:0 0 10px">Your e-signature is added to the memo. HR then posts it.</p>
    ${saved ? `<label class="check-line"><input type="radio" name="how" value="saved" checked /> <span>Use my saved signature</span></label>
      <div class="sig-saved"><img src="${saved}" alt="saved signature" /></div>` : ""}
    <div class="sig-new">${SIG_INPUT_HTML(!saved)}</div>
    <label class="check-line"><input type="checkbox" name="remember" checked /> <span>Save this signature for next time (Users › Signature)</span></label>`,
    async form => {
      const how = form.how.value;
      const sig = how === "saved" ? saved : how === "draw" ? inp.drawn() : inp.uploaded();
      if (!sig) throw new Error(how === "upload" ? "Choose the picture of your signature." : "Draw your signature in the box.");
      const r = await api("POST", `/api/memo/${m.id}/approve`, { signature: sig, remember: how !== "saved" && form.remember.checked });
      $("#dialog").close();
      if (r.memo.kind === "upload") {
        try { await memoSignPdf(r.memo); } catch (ex) { await tell("Approved. The signature could not be added into the PDF (" + ex.message + ") – it shows with the memo; try “Add my signature to the PDF” later."); }
      }
      toast(`${m.docNo} approved`);
      loadMemoNotices();
      after();
    }, "Approve");
  const dlg = $("#dialog"), inp = sigInput(dlg.querySelector(".sig-new"), how => { dlg.querySelector(`[name="how"][value="${how}"]`).checked = true; });
}
// draw (mouse / finger) or upload a signature; get() -> PNG data URL or "" ("which" says which one is used)
function sigInput(root, onPick = () => {}) {
  const pad = root.querySelector(".sig-pad"), ctx = pad.getContext("2d"), file = root.querySelector(".sig-file");
  let drawn = false, down = false, upl = "";
  ctx.lineWidth = 5; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0b1f66";
  const pos = e => { const b = pad.getBoundingClientRect(); return [(e.clientX - b.left) * pad.width / b.width, (e.clientY - b.top) * pad.height / b.height]; };
  pad.onpointerdown = e => { down = true; pad.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); onPick("draw"); };
  pad.onpointermove = e => { if (!down) return; ctx.lineTo(...pos(e)); ctx.stroke(); drawn = true; };
  pad.onpointerup = pad.onpointercancel = () => { down = false; };
  root.querySelector(".sig-clear").onclick = () => { ctx.clearRect(0, 0, pad.width, pad.height); drawn = false; };
  file.onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    onPick("upload");
    const img = new Image();
    img.onload = () => {                                     // make it small (max 600 × 200)
      const k = Math.min(1, 600 / img.width, 200 / img.height), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      upl = c.toDataURL("image/png"); URL.revokeObjectURL(img.src);
      const pv = root.querySelector(".sig-upl-pv");
      if (pv) pv.innerHTML = `<img src="${upl}" alt="" />`;
    };
    img.src = URL.createObjectURL(f);
  };
  return { drawn: () => drawn ? trimCanvas(pad) : "", uploaded: () => upl };
}
const SIG_INPUT_HTML = (drawChecked = true) => `
  <label class="check-line"><input type="radio" name="how" value="draw" ${drawChecked ? "checked" : ""} /> <span>Draw the signature (mouse or finger)</span></label>
  <div class="sig-wrap"><canvas class="sig-pad" width="920" height="300"></canvas><button type="button" class="btn btn-sm sig-clear">Clear</button></div>
  <label class="check-line"><input type="radio" name="how" value="upload" /> <span>Upload a picture of the signature (PNG / JPG)</span></label>
  <input type="file" class="sig-file" accept="image/png,image/jpeg" style="margin:4px 0 4px 26px" /><div class="sig-upl-pv sig-saved"></div>`;
// Users > Signature, or the user menu > My signature
function signatureDialog(u, after = () => {}) {
  const own = !u || u.id === me.id, base = own ? "/api/me/signature" : `/api/users/${u.id}/signature`;
  const has = own ? null : !!u.signatureAt;
  openDialog(`<h3>✍ ${own ? "My signature" : `Signature – ${esc(u.name)}`}</h3>
    <p class="muted" style="margin:0 0 8px">Used when ${own ? "you approve" : "this person approves"} a memo – it is inserted into the memo.</p>
    <div class="sig-current"><span class="muted" style="font-size:12px">Saved signature:</span>
      <div class="sig-saved" id="sigNow"><span class="muted">${has === false ? "none yet" : "loading…"}</span></div>
      <button type="button" class="btn btn-sm btn-danger" id="sigDel" hidden>Remove</button></div>
    <div class="sig-new">${SIG_INPUT_HTML()}</div>`,
    async form => {
      const sig = form.how.value === "upload" ? inp.uploaded() : inp.drawn();
      if (!sig) throw new Error(form.how.value === "upload" ? "Choose the picture of the signature." : "Draw the signature in the box.");
      await api("PUT", base, { signature: sig });
      $("#dialog").close(); toast("Signature saved"); after();
    }, "Save signature");
  const dlg = $("#dialog"), inp = sigInput(dlg.querySelector(".sig-new"), how => { dlg.querySelector(`[name="how"][value="${how}"]`).checked = true; });
  if (has !== false) {
    const img = new Image();
    img.onload = () => { $("#sigNow").innerHTML = ""; $("#sigNow").appendChild(img); $("#sigDel").hidden = false; };
    img.onerror = () => { $("#sigNow").innerHTML = `<span class="muted">none yet</span>`; };
    img.src = `${base}?v=${Date.now()}`;
  }
  $("#sigDel").onclick = async () => {
    if (!await ask("Remove the saved signature? (Memos already approved keep theirs.)", "Remove")) return;
    try { await api("DELETE", base); toast("Signature removed"); after(); } catch (ex) { tell(ex.message); }
  };
}
function trimCanvas(c) {                                    // the drawn signature without the empty border
  const ctx = c.getContext("2d"), { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < x0) return "";
  const out = document.createElement("canvas"), pad = 8;
  out.width = x1 - x0 + pad * 2; out.height = y1 - y0 + pad * 2;
  out.getContext("2d").drawImage(c, x0 - pad, y0 - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
// uploaded memo: put the signature, name, User ID and date at the bottom right of the last page (made in the approver's browser)
async function memoSignPdf(m) {
  const src = (m.files || []).filter(f => f.kind === "memo").pop();
  if (!src || !m.signature) throw new Error("no PDF or signature");
  if (!window.PDFLib) await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js";
    s.onload = res; s.onerror = () => rej(new Error("the PDF tool could not be loaded (internet needed)"));
    document.head.appendChild(s);
  });
  const bytes = await (await fetch(`/api/memo/files/${src.id}`, { credentials: "same-origin" })).arrayBuffer();
  const doc = await PDFLib.PDFDocument.load(bytes, { ignoreEncryption: true });
  const img = m.signature.startsWith("data:image/png") ? await doc.embedPng(m.signature) : await doc.embedJpg(m.signature);
  const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
  const page = doc.getPages().at(-1), box = page.getMediaBox();          // some PDFs do not start at 0,0
  const ascii = t => String(t || "").replace(/[^\x20-\x7E]/g, "?");
  const bw = 170, x = box.x + box.width - 36 - bw, y = box.y + 18, k = Math.min(bw / img.width, 46 / img.height), iw = img.width * k, ih = img.height * k;
  page.drawImage(img, { x: x + (bw - iw) / 2, y: y + 24, width: iw, height: ih });
  page.drawLine({ start: { x, y: y + 22 }, end: { x: x + bw, y: y + 22 }, thickness: 0.6 });
  page.drawText(ascii(`Approved by: ${m.approvedBy}`), { x, y: y + 12, size: 7.5, font });
  page.drawText(ascii(`User ID: ${m.approvedUser}   Date: ${tsDate(m.approvedAt)}`), { x, y: y + 2, size: 7.5, font });
  const out = await doc.save();
  await api("POST", `/api/memo/${m.id}/files?kind=signed&name=${encodeURIComponent(src.name.replace(/\.pdf$/i, "") + " (signed).pdf")}`,
    new Blob([out], { type: "application/pdf" }));
}

// ---------------- Memo Listings (HR): every memo, any status
function memoTable(rows, cols, find, menu, empty) {
  const per = find.per, pages = Math.max(1, Math.ceil(rows.length / per));
  find.page = Math.min(find.page, pages);
  const from = (find.page - 1) * per, part = rows.slice(from, from + per);
  return { body: part.length ? part.map(m => `<tr data-mm="${m.id}">
      <td class="tr-menu-cell"><button type="button" class="btn btn-sm tr-dots" data-menu="${m.id}">⋮</button><div class="tr-menu" hidden>${menu(m)}</div></td>
      ${cols.map(c => `<td>${c(m)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${cols.length + 1}" class="empty">${empty}</td></tr>`,
    info: rows.length ? `Showing ${from + 1} to ${from + part.length} of ${rows.length} entries` : "",
    pager: pages > 1 ? `<button class="btn btn-sm" data-pg="${find.page - 1}" ${find.page === 1 ? "disabled" : ""}>Previous</button>
      <strong style="margin:0 8px">${find.page} / ${pages}</strong><button class="btn btn-sm" data-pg="${find.page + 1}" ${find.page === pages ? "disabled" : ""}>Next</button>` : "" };
}
const memoTop = find => `<div class="mm-top"><label>Show <select data-per>${[10, 25, 50, 100].map(n => `<option ${find.per === n ? "selected" : ""}>${n}</option>`).join("")}</select> entries</label>
  <label>Search: <input type="search" data-s="q" value="${esc(find.q)}" /></label></div>`;
function memoWire(find, draw, extra) {
  const app = $("#app");
  app.querySelector(".tr-search").addEventListener("input", e => { const k = e.target.dataset.s; if (k) { find[k] = e.target.value; find.page = 1; draw(); } });
  app.querySelector("[data-s='q']").oninput = e => { find.q = e.target.value; find.page = 1; draw(); };
  app.querySelector("[data-per]").onchange = e => { find.per = +e.target.value; find.page = 1; draw(); };
  $("#mmPages").onclick = e => { const b = e.target.closest("[data-pg]"); if (b && !b.disabled) { find.page = +b.dataset.pg; draw(); } };
  $("#mmRows").onclick = async e => {
    const m = e.target.closest("[data-menu]");
    document.querySelectorAll(".tr-menu").forEach(x => { if (!m || x !== m.nextElementSibling) x.hidden = true; });
    if (m) { m.nextElementSibling.hidden = !m.nextElementSibling.hidden; return; }
    if (await extra(e)) return;
    const tr = e.target.closest("[data-mm]");
    if (tr && !e.target.closest("a,button,.tr-menu")) location.hash = "#/memo/" + tr.dataset.mm;
  };
}
const mmHas = (v, q) => !q || String(v || "").toLowerCase().includes(q.toLowerCase());

async function renderMemoList() {
  let d;
  try { d = await api("GET", "/api/memo"); } catch (ex) { toast(ex.message); location.replace("#/memo"); return; }
  if (!d.hr) { location.replace("#/memo"); return; }
  const list = d.memos, count = st => list.filter(m => m.status === st).length;
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>MEMO Listing</h1>
      <div class="sub">Every memo. Processing = waiting for the person in charge · Approved = ready to post · Posted = shown to the chosen staff · Cancelled by HR.</div></div>
      <div class="actions"><button class="btn btn-primary" id="memoNew">+ New memo</button></div></div>
    <div class="stats mc-stats">${Object.entries(MM_STATUS).map(([k, [l]]) => `<div class="stat"><div class="n">${count(k)}</div><div class="l">${l}</div></div>`).join("")}</div>
    <div class="card">${memoTop(mmFind)}
      <div class="table-wrap"><table class="mc-table tr-table">
        <thead><tr><th></th><th>Status</th><th>Document ID</th><th>Title</th><th>Created ID</th><th>Created Date</th><th>Approval ID</th></tr>
          <tr class="tr-search"><th></th>
            <th><select data-s="status"><option value="">Select All</option>${Object.entries(MM_STATUS).map(([k, [l]]) => `<option value="${k}" ${mmFind.status === k ? "selected" : ""}>${l}</option>`).join("")}</select></th>
            ${[["doc", "Document ID"], ["title", "Title"], ["user", "Created ID"], ["date", "Created Date"], ["appr", "Approval ID"]].map(([k, l]) =>
              `<th><input type="search" data-s="${k}" placeholder="Search ${l}" value="${esc(mmFind[k])}" /></th>`).join("")}</tr></thead>
        <tbody id="mmRows"></tbody></table></div>
      <div class="mc-pager"><span class="muted" id="mmInfo"></span><span id="mmPages"></span></div></div>`;
  const menu = m => `<a href="#/memo/${m.id}">View</a>${["processing", "approved"].includes(m.status) ? `<a href="#/memo/${m.id}/edit">Edit</a>` : ""}
    ${m.status === "approved" ? `<a href="#/memo/${m.id}">Post</a>` : ""}<button type="button" data-print="${m.id}">Print</button>
    ${m.status !== "cancelled" ? `<button type="button" data-cancel="${m.id}">Cancel</button>` : ""}`;
  const cols = [m => mmBadge(m.status), m => `<a href="#/memo/${m.id}"><strong>${esc(m.docNo)}</strong></a>`, m => esc(mmTitle(m)), m => esc(m.createdUser),
    m => tsDate(m.createdAt), m => esc(m.approvedUser || "-")];
  const draw = () => {
    const f = mmFind, rows = list.filter(m => (!f.status || m.status === f.status) && mmHas(m.docNo, f.doc) && mmHas(m.title, f.title)
      && mmHas(m.createdUser, f.user) && mmHas(tsDate(m.createdAt), f.date) && mmHas(m.approvedUser, f.appr)
      && (!f.q || [m.docNo, m.title, m.createdUser, m.createdBy, tsDate(m.createdAt), m.approvedUser, MM_STATUS[m.status]?.[0]].some(v => mmHas(v, f.q))));
    const t = memoTable(rows, cols, f, menu, list.length ? "No memo matches." : "No memo yet.");
    $("#mmRows").innerHTML = t.body; $("#mmInfo").textContent = t.info; $("#mmPages").innerHTML = t.pager;
  };
  draw();
  $("#memoNew").onclick = memoNewChoice;
  memoWire(mmFind, draw, async e => {
    const pr = e.target.closest("[data-print]"), cn = e.target.closest("[data-cancel]");
    if (pr) { memoPrintId(pr.dataset.print); return true; }
    if (cn) {
      const id = cn.dataset.cancel, m = list.find(x => x.id === id);
      openDialog(`<h3>Cancel ${esc(m.docNo)}?</h3><label class="field"><span>Reason (optional)</span><input type="text" name="reason" maxlength="300" /></label>`,
        async f => { await api("POST", `/api/memo/${id}/cancel`, { reason: f.reason.value }); $("#dialog").close(); toast("Memo cancelled"); renderMemoList(); }, "Cancel memo");
      return true;
    }
    return false;
  });
}

// ---------------- Memo Approval: the Processing memos waiting for me
async function renderMemoApproval() {
  let d;
  try { d = await api("GET", "/api/memo"); } catch (ex) { toast(ex.message); location.replace("#/memo"); return; }
  if (!d.approve) { location.replace("#/memo"); return; }
  const list = d.memos.filter(m => m.status === "processing" && (m.approverId === me.id || d.superadmin));
  const others = d.superadmin && list.some(m => m.approverId !== me.id);
  $("#app").innerHTML = `
    <div class="page-head"><div><h1>MEMO Approval</h1>
      <div class="sub">This page only shows the memos that are <strong>Processing</strong> – waiting for ${others ? "a person in charge (as Super Admin you see everyone's)" : "your approval"}.</div></div></div>
    <div class="card">${memoTop(mmApFind)}
      <div class="table-wrap"><table class="mc-table tr-table">
        <thead><tr><th></th><th>Document ID</th><th>Title</th><th>Created ID</th><th>Created Date</th>${others ? "<th>Person in charge</th>" : ""}</tr>
          <tr class="tr-search"><th></th>${[["doc", "Document ID"], ["title", "Title"], ["user", "Created ID"], ["date", "Created Date"]].map(([k, l]) =>
            `<th><input type="search" data-s="${k}" placeholder="Search ${l}" value="${esc(mmApFind[k])}" /></th>`).join("")}${others ? "<th></th>" : ""}</tr></thead>
        <tbody id="mmRows"></tbody></table></div>
      <div class="mc-pager"><span class="muted" id="mmInfo"></span><span id="mmPages"></span></div></div>`;
  const cols = [m => `<a href="#/memo/${m.id}"><strong>${esc(m.docNo)}</strong></a>`, m => esc(mmTitle(m)), m => esc(m.createdUser), m => tsDate(m.createdAt),
    ...(others ? [m => esc(m.approverName)] : [])];
  const draw = () => {
    const f = mmApFind, rows = list.filter(m => mmHas(m.docNo, f.doc) && mmHas(m.title, f.title) && mmHas(m.createdUser, f.user) && mmHas(tsDate(m.createdAt), f.date)
      && (!f.q || [m.docNo, m.title, m.createdUser, m.createdBy, tsDate(m.createdAt)].some(v => mmHas(v, f.q))));
    const t = memoTable(rows, cols, f, m => `<a href="#/memo/${m.id}">Approve</a>`, list.length ? "No memo matches." : "Nothing is waiting for your approval.");
    $("#mmRows").innerHTML = t.body; $("#mmInfo").textContent = t.info; $("#mmPages").innerHTML = t.pager;
  };
  draw();
  memoWire(mmApFind, draw, async () => false);
}

async function renderHrSettings() {
  let opts, staff = [];
  try { opts = (await api("GET", "/api/options")).options; } catch (ex) { toast(ex.message); return; }
  try { staff = (await api("GET", "/api/hr/staff")).staff; } catch { /* no HR access: the "from staff list" button just finds nothing */ }
  let roles = [...(opts.hrRoles || [])], outlets = (opts.hrOutlets || []).map(o => ({ ...o }));
  let depts = [...(opts.hrDepartments || [])], posDept = { ...(opts.hrPosDept || {}) }, posParent = { ...(opts.hrPosParent || {}) };
  const STATES = ["Johor", "Kedah", "Kelantan", "Melaka", "Negeri Sembilan", "Pahang", "Penang", "Perak", "Perlis", "Sabah", "Sarawak", "Selangor",
    "Terengganu", "Kuala Lumpur", "Putrajaya", "Labuan"];
  const deptOf = r => { const k = Object.keys(posDept).find(x => x.toLowerCase() === String(r).trim().toLowerCase()); return k ? posDept[k] : ""; };
  try { const m = (await api("GET", "/api/mc")).settings; opts.mcLead = m.leadDays; opts.mcRemind = m.remindDays; opts.mcBack = m.backdateHours; opts.mcTypes = m.docTypes; } catch { /* no MC access */ }
  $("#app").innerHTML = `
    <div class="page-head">
      <div>
        <div class="crumbs"><a href="#/settings">Settings</a> › <span>HR Setting</span></div>
        <h1 style="margin-top:6px">HR Setting</h1>
        <div class="sub">Lists used by Staff Master Data – the Staff form offers them to choose, and the Excel import reports values that are not in them.</div>
      </div>
      <div class="actions">
        <a class="btn" href="/api/hr/settings-all.xlsx" download title="One Excel file: Positions (with Department), Departments, Outlets (with State and hours), MC Setting">⬇ Export all</a>
        <button class="btn" id="hrsImportAll" title="Load the Excel file made by Export all (e.g. from another server)">📥 Import all</button>
        <button class="btn btn-primary" id="hrsSave">💾 Save</button></div>
    </div>
    <div class="hrs-grid">
      <div class="card">
        <div class="prog-title">🧑‍💼 Position list <span class="muted" id="hrsRoleN" style="font-weight:400;font-size:12px"></span></div>
        <div class="hrs-body">
          <div class="hrs-note">🧩 The same list as the <strong>Positions</strong> in Settings › Access Control (where each position's rights are set) – a position added here
            is there too${isSuper() ? ` (<a href="#/access">set its rights</a>)` : ""}. To rename a position and keep its people, rename it in Access Control.</div>
          <div class="hrs-row hrs-head"><span style="flex:1">Position</span><span style="width:190px">Department <span class="muted" style="font-weight:400">(Memo)</span></span><span style="width:34px"></span></div>
          <div id="hrsRoles"></div>
          <div class="hrs-btns"><button class="btn btn-sm" id="hrsAddRole">+ Add position</button>
            <button class="btn btn-sm" data-hrsimport="roles">📥 Import Excel</button>
            <button class="btn btn-sm" id="hrsRoleFrom" title="Add every position used in the staff list that is not here yet">⤵ Add positions used in the staff list</button></div>
        </div>
      </div>
      <div class="card">
        <div class="prog-title">🏛 Department list <span class="muted" id="hrsDeptN" style="font-weight:400;font-size:12px"></span></div>
        <div class="hrs-body">
          <div class="hrs-note">📢 Used by <strong>Memo › Who can view</strong>. Give each position its department in the Position list – a staff's department comes from their position.</div>
          <div id="hrsDepts"></div>
          <div class="hrs-btns"><button class="btn btn-sm" id="hrsAddDept">+ Add department</button></div>
        </div>
      </div>
      <div class="card" style="grid-column:1/-1">
        <div class="prog-title">🩺 MC Request</div>
        <div class="hrs-body hrs-mc">
          <label>Lead time for the original MC <input type="number" id="mcLead" min="1" max="365" value="${opts.mcLead || 30}" /> days</label>
          <label>Remind the staff when <input type="number" id="mcRemind" min="0" max="364" value="${opts.mcRemind ?? 10}" /> days are left</label>
          <label>Staff must submit within <input type="number" id="mcBack" min="1" max="720" value="${opts.mcBack || 48}" /> hours <span class="muted">(Date Apply can be backdated this much; HR is not limited)</span></label>
          <div class="mc-types"><strong>Document Type</strong> <span class="muted" style="font-size:12px">– the choices on the MC Request Form; the code also starts the Document Number (e.g. MC-2610-001)</span>
            <div id="mcTypes"></div><button type="button" class="btn btn-sm" id="mcTypeAdd">+ Add document type</button></div>
          <button class="btn btn-sm" id="mcSetSave">Save</button>
          <span class="muted" style="font-size:12px">Counting starts when the request is submitted; at 0 days the request is rejected automatically.</span>
        </div>
      </div>
      <div class="card hrs-wide">
        <div class="prog-title">🏬 Outlet list <span class="muted" id="hrsOutN" style="font-weight:400;font-size:12px"></span></div>
        <div class="hrs-body">
          <div class="hrs-outlet hrs-head"><span>Outlet Code</span><span>Outlet Name</span><span>State</span><span>Working hours</span><span></span></div>
          <div id="hrsOutlets"></div>
          <div class="hrs-btns"><button class="btn btn-sm" id="hrsAddOut">+ Add outlet</button>
            <button class="btn btn-sm" data-hrsimport="outlets">📥 Import Excel</button>
            <button class="btn btn-sm" id="hrsOutFrom" title="Add every Outlet Code used in the staff list that is not here yet">⤵ Add outlet codes used in the staff list</button></div>
        </div>
      </div>
    </div>`;
  const draw = () => {
    const dOpts = cur => `<option value="">– department –</option>${[...depts, ...(cur && !depts.some(x => x.toLowerCase() === cur.toLowerCase()) ? [cur] : [])]
      .map(x => `<option ${x.toLowerCase() === (cur || "").toLowerCase() ? "selected" : ""}>${esc(x)}</option>`).join("")}${NEW_DEPT_OPT}`;
    $("#hrsRoles").innerHTML = roles.map((r, i) => `<div class="hrs-row"><input type="text" data-role="${i}" value="${esc(r)}" maxlength="100" placeholder="e.g. Cashier" />
      <select data-rdept="${i}" style="width:190px">${dOpts(deptOf(r))}</select>
      <button class="btn btn-sm" data-delrole="${i}" title="Remove">✕</button></div>`).join("") || `<div class="muted" style="padding:6px 0">No position yet.</div>`;
    $("#hrsDepts").innerHTML = depts.map((x, i) => `<div class="hrs-row"><input type="text" data-dept="${i}" value="${esc(x)}" maxlength="100" placeholder="e.g. Operation" />
      <button class="btn btn-sm" data-deldept="${i}" title="Remove">✕</button></div>`).join("") || `<div class="muted" style="padding:6px 0">No department yet.</div>`;
    $("#hrsDeptN").textContent = `(${depts.length})`;
    $("#hrsOutlets").innerHTML = outlets.map((o, i) => `<div class="hrs-outlet"><input type="text" data-oc="${i}" value="${esc(o.code)}" maxlength="50" placeholder="e.g. KL01" style="text-transform:uppercase" />
      <input type="text" data-on="${i}" value="${esc(o.name)}" maxlength="200" placeholder="e.g. Company Kuala Lumpur" />
      <select data-ost="${i}" title="State – used by Memo › Who can view"><option value="">– state –</option>${[...STATES, ...(o.state && !STATES.includes(o.state) ? [o.state] : [])]
        .map(x => `<option ${x === o.state ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>
      <button class="btn btn-sm hrs-hours" data-hours="${i}" title="Time In / Out, Lunch, Dinner – filled in on the Transfer Form">⏱ ${o.hours?.timeIn ? `${esc(o.hours.timeIn)}–${esc(o.hours.timeOut || "?")}` : "Set"}</button>
      <button class="btn btn-sm" data-delout="${i}" title="Remove">✕</button></div>`).join("") || `<div class="muted" style="padding:6px 0">No outlet yet.</div>`;
    $("#hrsRoleN").textContent = `(${roles.length})`;
    $("#hrsOutN").textContent = `(${outlets.length})`;
  };
  draw();
  const setDept = (r, v) => { for (const k of Object.keys(posDept)) if (k.toLowerCase() === r.trim().toLowerCase()) delete posDept[k]; if (v && r.trim()) posDept[r.trim()] = v; };
  $("#hrsRoles").oninput = e => {
    const i = e.target.dataset.role;
    if (i !== undefined) { const d_ = deptOf(roles[+i]); setDept(roles[+i], ""); roles[+i] = e.target.value; setDept(roles[+i], d_); }
  };
  $("#hrsRoles").onchange = e => {
    const i = e.target.dataset.rdept;
    if (i === undefined) return;
    if (e.target.value !== NEW_DEPT) { setDept(roles[+i], e.target.value); return; }
    e.target.value = deptOf(roles[+i]);                        // stays as it was if the box is closed
    askNewDept(depts, name => {
      if (!depts.some(x => x.toLowerCase() === name.toLowerCase())) depts.push(name);
      setDept(roles[+i], name); draw();
      toast(`${name} added – press Save to keep it`);
    });
  };
  $("#hrsDepts").oninput = e => { const i = e.target.dataset.dept; if (i !== undefined) depts[+i] = e.target.value; };
  $("#hrsDepts").onchange = () => draw();
  $("#hrsDepts").onclick = e => { const b = e.target.closest("[data-deldept]"); if (b) { depts.splice(+b.dataset.deldept, 1); draw(); } };
  $("#hrsAddDept").onclick = () => { depts.push(""); draw(); document.querySelector(`[data-dept="${depts.length - 1}"]`).focus(); };
  $("#hrsOutlets").oninput = e => {
    if (e.target.dataset.oc) outlets[+e.target.dataset.oc].code = e.target.value;
    if (e.target.dataset.on) outlets[+e.target.dataset.on].name = e.target.value;
  };
  $("#hrsOutlets").onchange = e => { if (e.target.dataset.ost) outlets[+e.target.dataset.ost].state = e.target.value; };
  $("#hrsRoles").onclick = e => { const b = e.target.closest("[data-delrole]"); if (b) { roles.splice(+b.dataset.delrole, 1); draw(); } };
  $("#hrsOutlets").onclick = e => {
    const b = e.target.closest("[data-delout]"), h = e.target.closest("[data-hours]");
    if (b) { outlets.splice(+b.dataset.delout, 1); draw(); return; }
    if (!h) return;
    const o = outlets[+h.dataset.hours], hr = o.hours || {};
    openDialog(`<h3>⏱ Working hours – ${esc(o.code || "outlet")}</h3>
      <p class="muted" style="margin:0 0 8px;font-size:12px">Filled in on the Transfer Form when this outlet is the "To" outlet.</p>
      <div class="tr-times">${TR_TIME_LABELS.map(([k, l]) => `<label class="field"><span>${l}</span><input type="time" name="${k}" value="${esc(hr[k] || "")}" /></label>`).join("")}</div>`,
      async form => { o.hours = Object.fromEntries(TR_TIME_LABELS.map(([k]) => [k, form[k].value])); $("#dialog").close(); draw(); toast("Press Save to keep the hours"); }, "OK");
  };
  $("#hrsAddRole").onclick = () => { roles.push(""); draw(); document.querySelector(`[data-role="${roles.length - 1}"]`).focus(); };
  $("#hrsAddOut").onclick = () => { outlets.push({ code: "", name: "" }); draw(); document.querySelector(`[data-oc="${outlets.length - 1}"]`).focus(); };
  $("#hrsRoleFrom").onclick = () => {
    const have = new Set(roles.map(r => r.trim().toLowerCase()));
    const add = [...new Set(staff.map(s => s.role).filter(r => r && !have.has(r.toLowerCase())))].sort();
    roles.push(...add); draw();
    toast(add.length ? `${add.length} position(s) added – press Save` : "Every position in the staff list is already here");
  };
  $("#hrsOutFrom").onclick = () => {
    const have = new Set(outlets.map(o => o.code.trim().toUpperCase()));
    const add = [...new Set(staff.map(s => s.outletCode).filter(c => c && !have.has(c)))].sort();
    outlets.push(...add.map(code => ({ code, name: "" }))); draw();
    toast(add.length ? `${add.length} outlet code(s) added – type their names, then Save` : "Every outlet code in the staff list is already here");
  };
  const save = async (msg = "HR Setting saved") => {
    let r;
    const departments = depts.map(x => x.trim()).filter(Boolean);
    try { r = await api("PUT", "/api/hr/settings", { roles, outlets, departments, posDept, posParent }); }
    catch (ex) {
      if (!ex.data?.needConfirm || !await ask(ex.message + "\n\nRemove them anyway?", "Remove")) throw ex;
      r = await api("PUT", "/api/hr/settings", { roles, outlets, departments, posDept, posParent, confirm: true });
    }
    roles = r.roles; outlets = r.outlets; depts = r.departments; posDept = r.posDept; posParent = r.posParent || posParent; draw();
    toast(msg);
  };
  $("#hrsSave").onclick = async () => { try { await save(); } catch (ex) { tell(ex.message); } };
  // MC Document Types (code + name)
  let mcTypes = (opts.mcTypes || [{ code: "MC", name: "" }, { code: "OMC", name: "" }]).map(t => ({ ...t }));
  const drawTypes = () => {
    $("#mcTypes").innerHTML = mcTypes.map((t, i) => `<div class="mc-type-row">
      <input type="text" data-tc="${i}" value="${esc(t.code)}" maxlength="10" placeholder="Code e.g. MC" />
      <input type="text" data-tn="${i}" value="${esc(t.name || "")}" maxlength="60" placeholder="Name (optional) e.g. Medical Certificate" />
      <button type="button" class="btn btn-sm" data-trm="${i}" title="Remove" ${mcTypes.length < 2 ? "disabled" : ""}>✕</button></div>`).join("");
  };
  drawTypes();
  $("#mcTypes").oninput = e => {
    const i = e.target.dataset.tc ?? e.target.dataset.tn;
    if (i === undefined) return;
    if (e.target.dataset.tc !== undefined) { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); mcTypes[i].code = e.target.value; }
    else mcTypes[i].name = e.target.value;
  };
  $("#mcTypes").onclick = e => { const b = e.target.closest("[data-trm]"); if (b) { mcTypes.splice(+b.dataset.trm, 1); drawTypes(); } };
  $("#mcTypeAdd").onclick = () => { mcTypes.push({ code: "", name: "" }); drawTypes(); $("#mcTypes").querySelector(`[data-tc="${mcTypes.length - 1}"]`).focus(); };
  $("#mcSetSave").onclick = async () => {
    try {
      const r = await api("PUT", "/api/mc/settings", { leadDays: +$("#mcLead").value, remindDays: +$("#mcRemind").value, backdateHours: +$("#mcBack").value,
        docTypes: mcTypes.filter(t => t.code.trim()) });
      mcTypes = r.settings.docTypes.map(t => ({ ...t })); drawTypes(); toast("MC Request setting saved");
    }
    catch (ex) { tell(ex.message); }
  };
  // ---- Import all: the Excel file made by "Export all" (Positions, Departments, Outlets, MC Setting) - e.g. from another server
  $("#hrsImportAll").onclick = () => openDialog(`<h3>📥 Import all HR Setting</h3>
      <p class="muted" style="margin:0 0 8px;font-size:13px">Choose the Excel file made by <strong>⬇ Export all</strong> (on this or another server).
        It has the sheets Positions, Departments, Outlets and MC Setting – the sheets that are in the file are loaded.</p>
      <label class="field"><span>File</span><input type="file" name="file" accept=".xlsx,.xlsm" required /></label>
      <div class="field"><span>How</span>
        <label class="check-line" style="font-weight:500"><input type="radio" name="mode" value="add" checked />
          <span>Add to the lists – what is in the file is added or updated (Department of a position, name / State / hours of an outlet); nothing is removed</span></label>
        <label class="check-line" style="font-weight:500;margin-top:4px"><input type="radio" name="mode" value="replace" />
          <span>Replace the lists with the file (positions, departments and outlets not in the file are removed)</span></label></div>`,
    async form => {
      const f = form.file.files[0];
      if (!f) throw new Error("Choose the Excel file first.");
      const r = await api("POST", `/api/hr/settings/read-all?name=${encodeURIComponent(f.name)}`, f);
      const replace = form.mode.value === "replace", done = [];
      if (r.roles) {
        if (replace) { roles = r.roles; posDept = {}; }
        else { const have = new Set(roles.map(x => x.trim().toLowerCase())); for (const x of r.roles) if (!have.has(x.toLowerCase())) { roles.push(x); have.add(x.toLowerCase()); } }
        for (const [k, v] of Object.entries(r.posDept || {})) setDept(k, v);
        if (replace) posParent = {};
        Object.assign(posParent, r.posParent || {});
        done.push(`${r.roles.length} position(s)`);
      }
      if (r.departments) {
        if (replace) depts = [...r.departments];
        else for (const x of r.departments) if (!depts.some(d => d.trim().toLowerCase() === x.toLowerCase())) depts.push(x);
        done.push(`${r.departments.length} department(s)`);
      }
      if (r.outlets) {
        if (replace) outlets = r.outlets;
        else for (const o of r.outlets) {
          const cur = outlets.find(x => x.code.trim().toUpperCase() === o.code);
          if (!cur) outlets.push(o);
          else {
            if (o.name) cur.name = o.name;
            if (o.state) cur.state = o.state;
            if (Object.values(o.hours || {}).some(Boolean)) cur.hours = o.hours;
          }
        }
        done.push(`${r.outlets.length} outlet(s)`);
      }
      await save(`Imported ${done.join(", ") || "nothing"} – saved`);
      if (r.mc && (r.mc.leadDays || r.mc.remindDays || r.mc.backdateHours || r.mc.docTypes)) {
        const lead = r.mc.leadDays || +$("#mcLead").value, remind = r.mc.remindDays ?? +$("#mcRemind").value, back = r.mc.backdateHours || +$("#mcBack").value;
        await api("PUT", "/api/mc/settings", { leadDays: lead, remindDays: remind, backdateHours: back, ...(r.mc.docTypes?.length ? { docTypes: r.mc.docTypes } : {}) });
        $("#mcLead").value = lead; $("#mcRemind").value = remind; $("#mcBack").value = back;
        done.push(`MC Setting (${lead} days, remind at ${remind}, submit within ${back} hours)`);
      }
      $("#dialog").close();
      tell(`Imported from ${f.name}:\n\n• ${done.join("\n• ")}\n\nSheets found: ${r.found.join(", ")}.`);
    }, "Import");
  // ---- import a Role list / Outlet list from Excel or CSV
  document.querySelectorAll("[data-hrsimport]").forEach(b => b.onclick = () => {
    const kind = b.dataset.hrsimport, isRole = kind === "roles";
    openDialog(`<h3>📥 Import ${isRole ? "Position" : "Outlet"} list</h3>
      <ol class="eb-steps">
        <li>Download the template (it already has the current list), or use your own Excel file:
          <div style="margin:8px 0"><a class="btn btn-primary" href="/api/hr/settings-list.xlsx?kind=${kind}" download>⬇ Download ${isRole ? "Position" : "Outlet"} list (.xlsx)</a></div>
          <div class="muted" style="font-size:12px">${isRole ? "Column <strong>Position</strong> (one position per row); <strong>Department</strong> is optional."
            : "Columns: <strong>Outlet Code</strong> and <strong>Outlet Name</strong>; <strong>State</strong> and the working hours are optional. Other columns are ignored."} First row = the headings.</div></li>
        <li>Choose the file and press Import. <span class="muted" style="font-size:12px">(Excel .xlsx or CSV)</span></li>
      </ol>
      <label class="field"><span>File</span><input type="file" name="file" accept=".xlsx,.xlsm,.csv" required /></label>
      <div class="field"><span>How</span>
        <label class="check-line" style="font-weight:500"><input type="radio" name="mode" value="add" checked />
          <span>Add to the list${isRole ? "" : " – an Outlet Code already in the list gets the name from the file"}</span></label>
        <label class="check-line" style="font-weight:500;margin-top:4px"><input type="radio" name="mode" value="replace" />
          <span>Replace the whole list with the file</span></label></div>`,
      async form => {
        const f = form.file.files[0];
        if (!f) throw new Error("Choose the Excel / CSV file first.");
        const r = await api("POST", `/api/hr/settings/read?kind=${kind}&name=${encodeURIComponent(f.name)}`, f);
        const replace = form.mode.value === "replace";
        let added = 0, renamed = 0;
        if (isRole) {
          if (replace) { added = r.roles.length; roles = r.roles; }
          else {
            const have = new Set(roles.map(x => x.trim().toLowerCase()));
            for (const x of r.roles) if (!have.has(x.toLowerCase())) { roles.push(x); have.add(x.toLowerCase()); added++; }
          }
          for (const [k, v] of Object.entries(r.posDept || {})) setDept(k, v);       // departments from the file
          Object.assign(posParent, r.posParent || {});                               // "Reports To" from the file
        } else if (replace) { added = r.outlets.length; outlets = r.outlets; }
        else {
          for (const o of r.outlets) {
            const cur = outlets.find(x => x.code.trim().toUpperCase() === o.code);
            if (!cur) { outlets.push(o); added++; }
            else {
              if (o.name && o.name !== cur.name) { cur.name = o.name; renamed++; }
              if (o.state) cur.state = o.state;
              if (Object.values(o.hours || {}).some(Boolean)) cur.hours = o.hours;      // working hours from the file
            }
          }
        }
        await save(replace ? `${isRole ? "Position" : "Outlet"} list replaced – ${added} imported and saved`
          : `${added} added${renamed ? `, ${renamed} name(s) updated` : ""} – saved`);
        $("#dialog").close();
      }, "Import");
  });
}

// ---------------- Inspection Location Master List (Admin / Super Admin)
const LOC_MAP = { addr1: "ctLocAddr1", addr2: "ctLocAddr2", addr3: "ctLocAddr3", contactA: "ctContactA", contactB: "ctContactB",
  telA: "ctTelA", telB: "ctTelB", emailA: "ctEmailA", emailB: "ctEmailB", hpA: "ctHpA", hpB: "ctHpB" };
const canManageLocations = () => isSuper() || me.role === "admin";

async function renderLocations() {
  OPTIONS = (await api("GET", "/api/options")).options;
  const draw = () => {
    const list = OPTIONS.inspLocations || [];
    $("#app").innerHTML = `
      <div class="page-head">
        <div>
          <div class="crumbs"><a href="#/settings">Settings</a> › Program Settings › <span>Inspection Location Master List</span></div>
          <h1 style="margin-top:6px">Inspection Location Master List</h1>
          <div class="sub">Locations of inspection / warehouses shown in Section B of the Consignment Test Application.</div>
        </div>
        <div class="actions"><button class="btn btn-primary" id="locAdd">+ Add New Location</button></div>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Warehouse / Location Name</th><th>Address</th><th>Contact Person</th><th>Telephone / H/P</th><th>Email</th><th style="width:140px"></th></tr></thead>
        <tbody>${list.length ? list.map((l, i) => `
          <tr style="cursor:default">
            <td><strong>${esc(l.name)}</strong></td>
            <td style="font-size:12px">${[l.addr1, l.addr2, l.addr3].filter(Boolean).map(esc).join("<br>") || "—"}</td>
            <td style="font-size:12px">${["a) " + (l.contactA || "—"), "b) " + (l.contactB || "—")].map(esc).join("<br>")}</td>
            <td style="font-size:12px">${[`a) ${l.telA || "—"} / ${l.hpA || "—"}`, `b) ${l.telB || "—"} / ${l.hpB || "—"}`].map(esc).join("<br>")}</td>
            <td style="font-size:12px">${["a) " + (l.emailA || "—"), "b) " + (l.emailB || "—")].map(esc).join("<br>")}</td>
            <td style="white-space:nowrap"><button class="btn btn-sm" data-ledit="${i}">Edit</button> <button class="btn btn-sm btn-danger" data-ldel="${i}">Delete</button></td>
          </tr>`).join("") : `<tr><td colspan="6" class="empty">No locations yet. Click <strong>+ Add New Location</strong>.</td></tr>`}</tbody>
      </table></div></div>
      <p class="muted dd-note">Changing or deleting a location does not change forms that already used it – use "Back to saved location" in a form to load the new details.</p>`;
    $("#locAdd").onclick = () => edit(-1);
    $("#app").querySelector("tbody").onclick = async e => {
      const ed = e.target.closest("[data-ledit]"), del = e.target.closest("[data-ldel]");
      if (ed) edit(+ed.dataset.ledit);
      if (del) {
        const l = list[+del.dataset.ldel];
        if (!await ask(`Delete location "${l.name}" from the master list?`)) return;
        try { await save(list.filter((_, i) => i !== +del.dataset.ldel)); toast("Deleted"); } catch (ex) { toast(ex.message); }
      }
    };
  };
  const save = async items => {
    OPTIONS.inspLocations = (await api("PUT", "/api/inspection-locations", { items })).items;
    draw();
  };
  const edit = i => {
    const list = OPTIONS.inspLocations || [], l = list[i] || {};
    const inp = (name, ph, type = "text") => `<input name="${name}" type="${type}" maxlength="200" value="${esc(l[name] || "")}" placeholder="${ph}" ${type === "email" ? "" : 'style="text-transform:uppercase"'} />`;
    openDialog(`
      <h3>${i < 0 ? "Add New Location" : "Edit Location"}</h3>
      <label class="field"><span>Warehouse / Location Name</span>${inp("name", "e.g. COMPANY NAME SDN BHD").replace("<input", "<input required")}</label>
      <div class="field"><span style="display:block;font-size:12px;font-weight:600;color:var(--muted);margin-bottom:4px">Location of Inspection (address)</span>
        <div class="ct-lines">${inp("addr1", "Address line 1")}${inp("addr2", "Address line 2")}${inp("addr3", "Postcode, city, state")}</div></div>
      <div class="loc-grid">
        <div class="loc-h"></div><div class="loc-h">a)</div><div class="loc-h">b)</div>
        <span>Contact Person</span>${inp("contactA", "")}${inp("contactB", "")}
        <span>Telephone No.</span>${inp("telA", "")}${inp("telB", "")}
        <span>Email Address</span>${inp("emailA", "", "email")}${inp("emailB", "", "email")}
        <span>H/P No.</span>${inp("hpA", "")}${inp("hpB", "")}
      </div>`, async form => {
      const v = {};
      ["name", "addr1", "addr2", "addr3", "contactA", "contactB", "telA", "telB", "emailA", "emailB", "hpA", "hpB"].forEach(k => { v[k] = form[k].value.trim(); });
      if (list.some((x, j) => j !== i && x.name.toUpperCase() === v.name.toUpperCase())) throw new Error(`"${v.name}" is already in the list`);
      const items = [...list];
      if (i < 0) items.push(v); else items[i] = v;
      await save(items);
      toast("Saved");
    }, "Save");
    $("#dialog").classList.add("wide");
  };
  draw();
}

// ---------------- audit trail list for SIRIM forms
async function renderSirimAuditList() {
  $("#app").innerHTML = `
    <div class="page-head"><div>
      <h1>Audit Trail – Consignment Test Application</h1>
      <div class="sub">Every Consignment Test form with its full history. Click a form to see who changed what, and when.</div>
    </div></div>
    <div class="card">
      <div class="toolbar"><input type="text" id="aq" placeholder="Search form no., COA no…" /></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Form No.</th><th>COA No.</th><th>Created</th><th style="text-align:center">Amendments</th><th>Last Change</th><th></th></tr></thead>
        <tbody id="arows"><tr><td colspan="6" class="empty">Loading…</td></tr></tbody>
      </table></div>
    </div>`;
  const { docs } = await api("GET", "/api/sirim-audit");
  const draw = () => {
    const q = $("#aq").value.toLowerCase().trim();
    const list = docs.filter(d => !q || [d.formNo, d.coaNo].some(v => (v || "").toLowerCase().includes(q)));
    $("#arows").innerHTML = list.length ? list.map(d => `
      <tr data-aid="${d.id}">
        <td><strong>${esc(d.formNo)}</strong>${d.cancelled ? ' <span class="badge cancelled">Cancelled</span>' : ""}</td>
        <td>${esc(d.coaNo || "—")}</td>
        <td class="muted" style="font-size:12px">${esc(d.createdBy)}<br>${fmtTime(d.createdAt)}</td>
        <td style="text-align:center"><strong>${d.changes}</strong></td>
        <td class="muted" style="font-size:12px">${d.lastAt ? fmtTime(d.lastAt) : "—"}</td>
        <td style="text-align:right"><button class="btn btn-sm">View ›</button></td>
      </tr>`).join("") : `<tr><td colspan="6" class="empty">${docs.length ? "No matching forms." : "No Consignment Test forms yet."}</td></tr>`;
  };
  draw();
  $("#aq").oninput = draw;
  $("#arows").onclick = e => { const tr = e.target.closest("tr[data-aid]"); if (tr) location.hash = "#/sirim-audit/" + tr.dataset.aid; };
}

/* =========================================================
   VERSIONS: a full copy of the document after each amendment
   #/versions/coa/<id>   #/versions/sirim/<id>
   ========================================================= */
const VERSION_ACTION = { baseline: "Starting version", create: "Created", edit: "Amended", submit: "Submitted",
  resubmit: "Unlocked to resave", reopen: "Reopened", cancel: "Cancelled" };
const FIELD_ORDER = (() => { const m = {}; let i = 0; for (const s of SECTIONS) for (const it of s.items) m[it.key] = i++; return m; })();

// one comparable row per field / tick / remark / file list / section status
function versionRows(snap, prog) {
  const rows = {};
  const sec = k => prog === "sirim" ? "SIRIM" : (FIELD_INFO[k]?.sec || "");
  const lab = k => FIELD_INFO[k]?.label || k;
  const order = k => (prog === "sirim" ? CT_ORDER[k] : FIELD_ORDER[k]) ?? 9000;
  const add = (key, s, label, value, ord, cmp) => { rows[key] = { sec: s, label, value: value ?? "", ord, cmp: cmp ?? value ?? "" }; };
  add("formNo", "", "Form No.", snap.formNo, -2);
  if (prog === "coa") add("dateApply", "", "Date Apply", snap.dateApply ? fmtDate(snap.dateApply) : "", -1);
  for (const [k, v] of Object.entries(snap.data || {})) add("data." + k, sec(k), lab(k), FIELD_INFO[k]?.type === "date" && v ? fmtDate(v) : v, order(k));
  for (const [k, v] of Object.entries(snap.remarks || {})) add("remarks." + k, sec(k), lab(k) + " – remark", v, order(k) + 0.1);
  for (const [k, v] of Object.entries(snap.checks || {})) if (v) add("checks." + k, sec(k), lab(k) + " – checklist", "✔ Done", order(k) + 0.2);
  for (const [k, v] of Object.entries(snap.files || {})) {
    const base = k.replace(/__att$/, "");
    const names = (v || []).map(x => typeof x === "string" ? x : x.name + (x.note ? ` – ${x.note}` : ""));
    add("files." + k, sec(base), (k.endsWith("__att") ? lab(k) : lab(base)) + " – files", names.join("\n"), order(base) + 0.3);
  }
  for (const [k, v] of Object.entries(snap.sections || {}))
    add("sections." + k, k, "Section status", v === "submitted" ? "Submitted" : "Draft / open", -0.5 + (prog === "sirim" ? 9999 : FIELD_ORDER[SECTIONS.find(s => s.id === k)?.items[0]?.key] ?? 0) - 0.01);
  if (snap.cancelled) add("cancelled", "", "Cancelled – reason", snap.cancelled, 99999);
  if (prog === "sirim") add("serials", "SIRIM", "Serial numbers", `${snap.serialCount || 0} numbers`, 9000, `${snap.serialCount || 0}|${snap.serialsHash || ""}`);
  return rows;
}

// short name of one change, e.g. "Colours", "Colours (checklist)", "Section B status"
function changeLabel(k) {
  const [group, raw] = k.includes(".") ? k.split(/\.(.+)/) : ["", k];
  const f = (raw || "").replace(/__att$/, ""), lab = FIELD_INFO[f]?.label || f;
  if (group === "sections") return raw === "SIRIM" ? "Form status" : `Section ${raw} status`;
  if (group === "checks") return `${lab} (checklist)`;
  if (group === "remarks") return `${lab} (remark)`;
  if (group === "files") return `${lab} (files)`;
  return { serialsHash: "Serial numbers", formNo: "Form No.", dateApply: "Date Apply", cancelled: "Cancelled" }[k] || lab;
}

// ---- the whole document exactly as it was at one version (fields, ticks, remarks, status and its own files)
function versionFileLinks(list) {
  const st = verState;
  return (list || []).map(x => {
    const f = typeof x === "string" ? { name: x } : x;
    if (!f.id) return `<div class="vd-file">📄 ${esc(f.name)}</div>`;
    const url = `/api/versions/${st.prog}/${st.id}/files/${f.id}`;
    return `<div class="vd-file">📄 ${esc(f.name)}${f.note ? ` <span class="muted">– ${esc(f.note)}</span>` : ""}
      <span class="fbtns">${VIEWABLE.includes(f.type) ? `<a class="fbtn" href="${url}" target="_blank" rel="noopener">👁 View</a>` : ""}
      <a class="fbtn" href="${url}?dl=1" download="${esc(f.name)}">⬇ Download</a></span></div>`;
  }).join("") || '<span class="muted">No document</span>';
}

function versionDocHtml(ver) {
  const st = verState, snap = ver.snapshot, coa = st.prog === "coa";
  const d = snap.data || {}, files = snap.files || {}, checks = snap.checks || {}, remarks = snap.remarks || {};
  const val = (it, v) => {
    if (it.type === "computed") v = it.compute(d);
    if (!v) return '<span class="muted">—</span>';
    return esc(it.type === "date" || it.type === "computed" ? fmtDate(v) : v);
  };
  const row = (n, it) => {
    let cell = it.type === "file" || it.type === "doclist" ? versionFileLinks(files[it.key]) : val(it, d[it.key]);
    if (it.type === "verify" && remarks[it.key]) cell += ` <span class="muted">– ${esc(remarks[it.key])}</span>`;
    if (it.attach) cell += `<div style="margin-top:4px">${versionFileLinks(files[it.key + "__att"])}</div>`;
    return `<div class="row"><div class="no">${n}</div><div class="label">${esc(it.label)}</div>
      <div class="input-cell vd-val">${cell}</div><div class="check-cell">${checks[it.key] ? '<span class="vd-tick">✔ Done</span>' : ""}</div></div>`;
  };
  const head = `
    <div class="card"><div class="form-title">
      <div class="t1">${coa ? "COA APPLICATION FORM" : "CONSIGNMENT TEST APPLICATION"}</div>
      <div class="t2">Form No. ${esc(snap.formNo || "")}${coa && snap.dateApply ? " · Date Apply " + fmtDate(snap.dateApply) : ""}</div>
      <div class="vd-ver">Version v${ver.no} · ${esc(VERSION_ACTION[ver.action] || ver.action)} · ${fmtTime(ver.at)} · ${esc(ver.by || "—")}</div>
    </div></div>
    ${snap.cancelled ? `<div class="cancel-banner"><strong>CANCELLED</strong> – reason: ${esc(snap.cancelled)}</div>` : ""}`;
  const secBadge = id => (snap.sections || {})[id] === "submitted" ? '<span class="badge submitted">Submitted</span>' : '<span class="badge draft">Open</span>';
  if (coa) {
    return head + SECTIONS.map(s => `
      <section class="card"><div class="card-head"><h2>${esc(s.title)}</h2>${secBadge(s.id)}</div>
        <div class="card-body">${s.items.filter(it => !it.only || isApplicable(it, d)).map((it, i) => row(i + 1, it)).join("")}</div></section>`).join("");
  }
  const serials = snap.serials;
  return head + `
    <section class="card"><div class="card-head"><h2>CONSIGNMENT TEST APPLICATION</h2>${secBadge("SIRIM")}</div>
      <div class="card-body">
        ${SIRIM_FIELDS.map((it, i) => row(i + 1, { ...it, label: CT_INFO[it.key]?.label || it.label })).join("")}
        ${SIRIM_DOCS.map((dd, i) => row(SIRIM_FIELDS.length + i + 1, { ...dd, type: "file" })).join("")}
        <div class="row"><div class="no"></div><div class="label">Serial numbers</div><div class="input-cell vd-val">
          <strong>${snap.serialCount || 0}</strong> serial number${snap.serialCount === 1 ? "" : "s"}
          ${serials && serials.length ? `<details class="no-print" style="margin-top:6px"><summary style="cursor:pointer">👁 Show / hide serial numbers</summary>
            <div class="serial-grid" style="margin-top:6px">${serials.map(x => `<span class="serial">${esc(x)}</span>`).join("")}</div></details>` : ""}
        </div><div></div></div>
      </div></section>`;
}

let verState = null;
async function renderVersions(prog, id) {
  let res;
  try { res = await api("GET", `/api/versions/${prog}/${id}`); } catch (ex) { toast(ex.message); history.back(); return; }
  const { doc, versions } = res;
  const back = prog === "coa" ? `#/app/${id}` : `#/sirim/${id}`;
  verState = { prog, id, doc, versions, cache: {}, b: versions[0]?.no, a: versions[1]?.no ?? versions[0]?.no, onlyChanges: true, view: "doc" };
  $("#app").innerHTML = `
    <div class="page-head no-print">
      <div>
        <a href="${back}" style="text-decoration:none;font-weight:600">← Back to ${prog === "coa" ? "application" : "form"}</a>
        <h1 style="margin-top:6px">Versions – ${esc(doc.formNo)} ${doc.cancelled ? '<span class="badge cancelled" style="vertical-align:middle">Cancelled</span>' : ""}</h1>
        <div class="sub">${esc(doc.title || "")}${doc.title ? " · " : ""}${versions.length} version${versions.length === 1 ? "" : "s"}.
          A version is saved after every amendment; edits by the same person within 10 minutes are grouped together.</div>
      </div>
      <div class="actions">
        ${canAudit() ? `<a class="btn" href="${prog === "coa" ? "#/audit/" : "#/sirim-audit/"}${id}">Audit Trail</a>` : ""}
        <button class="btn" id="verPrint">Print / PDF</button>
      </div>
    </div>
    <div class="ver-layout">
      <div class="card ver-list no-print" id="verList"></div>
      <div>
        <table class="print-frame">
          <thead class="print-only"><tr><td><img class="letterhead" src="letterhead.png" alt="Company Name Sdn. Bhd." /></td></tr></thead>
          <tbody><tr><td>
            <div class="ver-tabs no-print">
              <button class="ver-tab active" data-view="doc">📄 Full document</button>
              <button class="ver-tab" data-view="cmp">⇄ Compare two versions</button>
            </div>
            <div id="verDocView"></div>
            <div class="card" id="verCmpView" hidden>
              <div class="toolbar ver-bar">
                <span>Compare</span><select id="verA"></select><span>with</span><select id="verB"></select>
                <label class="check-inline no-print"><input type="checkbox" id="verOnly" checked /> Only show changes</label>
              </div>
              <div class="table-wrap"><table class="ver-table">
                <thead><tr><th>Section</th><th>Item</th><th id="verHA"></th><th id="verHB"></th></tr></thead>
                <tbody id="verRows"><tr><td colspan="4" class="empty">Loading…</td></tr></tbody>
              </table></div>
            </div>
          </td></tr></tbody>
        </table>
      </div>
    </div>`;
  const opt = v => `<option value="${v.no}">v${v.no} – ${fmtTime(v.at)} – ${esc(v.by || "—")}</option>`;
  $("#verA").innerHTML = versions.map(opt).join("");
  $("#verB").innerHTML = versions.map(opt).join("");
  $("#verA").onchange = e => { verState.a = +e.target.value; drawVersionCompare(); };
  $("#verB").onchange = e => { verState.b = +e.target.value; drawVersionCompare(); };
  $("#verOnly").onchange = e => { verState.onlyChanges = e.target.checked; drawVersionCompare(); };
  $("#verPrint").onclick = () => printAs(`${verState.doc?.formNo || ""} Version v${verState.b ?? ""}`);
  document.querySelector(".ver-tabs").onclick = e => {
    const b = e.target.closest("[data-view]");
    if (!b) return;
    verState.view = b.dataset.view;
    document.querySelectorAll(".ver-tab").forEach(t => t.classList.toggle("active", t === b));
    drawVersionCompare();
  };
  $("#verList").onclick = e => {
    const it = e.target.closest("[data-vno]");
    if (!it || e.target.closest(".ver-pdf")) return;          // the PDF link just opens the PDF
    verState.b = +it.dataset.vno;
    verState.a = Math.max(1, verState.b - 1);
    drawVersionCompare();
  };
  drawVersionCompare();
}

async function loadVersion(no) {
  const st = verState;
  if (!st.cache[no]) st.cache[no] = (await api("GET", `/api/versions/${st.prog}/${st.id}/${no}`)).version;
  return st.cache[no];
}

async function drawVersionCompare() {
  const st = verState;
  if (!st.versions.length) { $("#verRows").innerHTML = `<tr><td colspan="4" class="empty">No versions yet.</td></tr>`; return; }
  $("#verA").value = st.a; $("#verB").value = st.b;
  $("#verList").innerHTML = st.versions.map(v => {
    const labels = [...new Set(v.changes.map(changeLabel))].slice(0, 3);
    return `<div class="ver-item ${v.no === st.b ? "active" : ""}" data-vno="${v.no}">
      <div class="ver-top"><span class="ver-no">v${v.no}</span><span class="badge ${ACTION_CLS[v.action] || ""}">${VERSION_ACTION[v.action] || v.action}</span>
        <a class="ver-pdf" href="/api/versions/${st.prog}/${st.id}/${v.no}.pdf" target="_blank" rel="noopener" title="PDF of this version">⬇ PDF</a></div>
      <div class="muted" style="font-size:12px">${fmtTime(v.at)} · ${esc(v.by || "—")}</div>
      ${v.changes.length ? `<div class="ver-changes">${v.changes.length} change${v.changes.length > 1 ? "s" : ""}: ${labels.map(esc).join(", ")}${v.changes.length > 3 ? " …" : ""}</div>` : ""}
    </div>`;
  }).join("");
  $("#verDocView").hidden = st.view !== "doc";
  $("#verCmpView").hidden = st.view !== "cmp";
  if (st.view === "doc") { $("#verDocView").innerHTML = versionDocHtml(await loadVersion(st.b)); return; }
  const [A, B] = await Promise.all([loadVersion(st.a), loadVersion(st.b)]);
  $("#verHA").textContent = `v${A.no} – ${fmtTime(A.at)} (${A.by || "—"})`;
  $("#verHB").textContent = `v${B.no} – ${fmtTime(B.at)} (${B.by || "—"})`;
  const ra = versionRows(A.snapshot, st.prog), rb = versionRows(B.snapshot, st.prog);
  const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])]
    .sort((x, y) => ((ra[x] || rb[x]).ord - (ra[y] || rb[y]).ord) || x.localeCompare(y));
  let changed = 0;
  const html = keys.map(k => {
    const a = ra[k], b = rb[k], diff = String(a?.cmp ?? "") !== String(b?.cmp ?? "");
    if (diff) changed++;
    if (st.onlyChanges && !diff) return "";
    const r = a || b;
    let bv = esc(b?.value ?? "");
    if (k === "serials" && diff && A.snapshot.serials && B.snapshot.serials) {       // which serial numbers changed
      const sa = new Set(A.snapshot.serials), sb = new Set(B.snapshot.serials);
      const add = [...sb].filter(x => !sa.has(x)), del = [...sa].filter(x => !sb.has(x));
      bv += `<div class="muted" style="font-size:12px">${add.length ? `+ ${add.slice(0, 20).map(esc).join(", ")}${add.length > 20 ? " …" : ""}` : ""}
        ${del.length ? `<br>− ${del.slice(0, 20).map(esc).join(", ")}${del.length > 20 ? " …" : ""}` : ""}</div>`;
    }
    return `<tr class="${diff ? "ver-diff" : ""}">
      <td style="white-space:nowrap">${r.sec ? esc(secName(r.sec)) : "Form header"}</td><td>${esc(r.label)}</td>
      <td class="ver-a">${esc(a?.value ?? "") || '<span class="muted">—</span>'}</td>
      <td class="ver-b">${bv || '<span class="muted">—</span>'}</td></tr>`;
  }).join("");
  $("#verRows").innerHTML = html || `<tr><td colspan="4" class="empty">${st.a === st.b ? "Choose two different versions to compare." : "No differences between these two versions."}</td></tr>`;
  if (st.onlyChanges && html) $("#verRows").insertAdjacentHTML("afterbegin", `<tr><td colspan="4" class="muted" style="font-size:12px">${changed} difference${changed === 1 ? "" : "s"} between v${A.no} and v${B.no}</td></tr>`);
}

/* ---------- Start ---------- */
// ================================================================ Language: English (as written), Bahasa Melayu or 中文
//   The screen text is translated as it appears (public/i18n-ms.js, public/i18n-zh.js); data - names, positions,
//   memo / email text, anything typed - is never translated.  Each person's choice is kept in this browser.
const LANGS = { en: ["English", "EN"], ms: ["Bahasa Melayu", "BM"], zh: ["中文", "中文"] };
let LANG = "en";
try { const v = localStorage.getItem("portal.lang"); LANG = LANGS[v] ? v : "en"; } catch { /* private window */ }
const L3 = (en, ms, zh) => LANG === "ms" ? ms : LANG === "zh" ? zh : en;      // a few texts built in the code
const i18nDict = () => LANG === "zh" ? [window.I18N_ZH, window.I18N_ZH_RX] : LANG === "ms" ? [window.I18N_MS, window.I18N_MS_RX] : [null, null];
const I18N_SKIP = "script,style,textarea,code,pre,[contenteditable],.eb-editor,.memo-content,.memo-letter,.combo-box,.no-tr,.eb-preview,.eb-mail";
function loadI18n() {
  if (LANG === "en" || i18nDict()[0]) return Promise.resolve();
  const v = (document.querySelector('script[src^="app.js"]')?.getAttribute("src") || "").split("v=")[1] || Date.now();
  return new Promise(res => {
    const s = document.createElement("script");
    s.src = `i18n-${LANG}.js?v=` + v;
    s.onload = res; s.onerror = res;                               // without the file the portal simply stays in English
    document.head.appendChild(s);
  });
}
function trLine(line) {
  const [d, rx] = i18nDict(), D = d || {}, RX = rx || [];
  const m = line.match(/^(\s*)([\s\S]*?)(\s*)$/), lead = m[1], body = m[2].replace(/\s+/g, " "), tail = m[3];
  if (!body || !/[A-Za-z]/.test(body)) return line;
  if (D[body]) return lead + D[body] + tail;
  const p = body.match(/^([^A-Za-z(]*)(.*?)([\s:*›▾▸⋮✕×]*)$/);       // keep icons in front and ":" / "›" behind
  if (p && p[2] && D[p[2]]) return lead + p[1] + D[p[2]] + p[3] + tail;
  for (const [rx, rep] of RX) {
    if (rx.test(body)) return lead + body.replace(rx, rep) + tail;
    if (p && p[2] && rx.test(p[2])) return lead + p[1] + p[2].replace(rx, rep) + p[3] + tail;
  }
  return line;
}
const trText = s => s.includes("\n") ? s.split("\n").map(trLine).join("\n") : trLine(s);
function trEl(el) {
  for (const a of ["placeholder", "title", "aria-label"]) {
    const v = el.getAttribute?.(a);
    if (v) { const t = trText(v); if (t !== v) el.setAttribute(a, t); }
  }
}
function trNode(n) {
  if (LANG === "en" || !i18nDict()[0] || !n) return;
  if (n.nodeType === 3) {
    const p = n.parentElement;
    if (p && !p.closest(I18N_SKIP)) { const v = n.nodeValue, t = trText(v); if (t !== v) n.nodeValue = t; }
    return;
  }
  if (n.nodeType !== 1 || n.closest(I18N_SKIP)) return;
  trEl(n);
  const w = document.createTreeWalker(n, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    { acceptNode: x => x.nodeType === 1 && x.matches(I18N_SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let x = w.nextNode(); x; x = w.nextNode()) {
    if (x.nodeType === 1) trEl(x);
    else { const v = x.nodeValue, t = trText(v); if (t !== v) x.nodeValue = t; }
  }
}
function startI18n() {
  if (LANG === "en" || !i18nDict()[0]) return;
  document.documentElement.lang = LANG === "zh" ? "zh-CN" : "ms";
  trNode(document.body);
  document.title = trText(document.title);
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === "childList") m.addedNodes.forEach(trNode);
      else if (m.type === "characterData") trNode(m.target);
      else if (m.type === "attributes") trEl(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title", "aria-label"] });
}
// the 🌐 button (top bar) and the name menu open a small list: English / Bahasa Melayu / 中文
function langMenu(anchor) {
  let m = document.getElementById("langMenu");
  if (m) { m.remove(); return; }
  m = document.createElement("div");
  m.id = "langMenu"; m.className = "lang-menu no-tr";
  m.innerHTML = Object.entries(LANGS).map(([k, [name]]) => `<button type="button" data-setlang="${k}" class="${k === LANG ? "on" : ""}">${k === LANG ? "✔ " : ""}${name}</button>`).join("");
  document.body.appendChild(m);
  const r = (anchor || document.getElementById("langTop")).getBoundingClientRect();
  m.style.top = (r.bottom + 6) + "px";
  m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + "px";
}
document.addEventListener("click", e => {
  const pick = e.target.closest("[data-setlang]");
  if (pick) { setLang(pick.dataset.setlang); return; }
  if (e.target.closest("#langTop")) { langMenu(e.target.closest("#langTop")); return; }
  if (!e.target.closest("#langMenu, #langBtn")) document.getElementById("langMenu")?.remove();
});
function setLang(l) {
  try { localStorage.setItem("portal.lang", l); } catch { /* private window */ }
  location.reload();
}

// ---- installable as an app: the browser offers "Install" (Chrome / Edge on phone and computer); iPhone: Share › Add to Home Screen
let installEvt = null;
if ("serviceWorker" in navigator && window.isSecureContext) navigator.serviceWorker.register("/sw.js").catch(() => {});
// on a phone the portal offers itself as an app by itself (a bar at the bottom); "Not now" hides it for 7 days
const isPhone = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isInstalled = () => window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const installLater = () => { try { return Date.now() - (+localStorage.getItem("portal.installLater") || 0) < 7 * 86400000; } catch { return false; } };
function installBar(ios) {
  if (!isPhone || isInstalled() || installLater() || document.getElementById("installBar")) return;
  const bar = document.createElement("div");
  bar.id = "installBar"; bar.className = "install-bar";
  bar.innerHTML = `<img src="icon-192.png" alt="" /><div class="ib-text"><strong>Install the Company Portal app</strong>
      <span>${ios ? "Tap Share ⬆ at the bottom of Safari, then Add to Home Screen." : "Open it from your home screen like an app – full screen, same as the website."}</span></div>
    ${ios ? "" : `<button type="button" class="btn btn-sm btn-primary" id="ibInstall">Install</button>`}
    <button type="button" class="ib-x" id="ibLater" title="Not now" aria-label="Not now">✕</button>`;
  document.body.appendChild(bar);
  bar.querySelector("#ibLater").onclick = () => { try { localStorage.setItem("portal.installLater", Date.now()); } catch { /* private window */ } bar.remove(); };
  if (!ios) bar.querySelector("#ibInstall").onclick = () => { bar.remove(); installApp(); };
}
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); installEvt = e;
  if ($("#installBtn")) $("#installBtn").hidden = false;
  installBar(false);
});
if (isIOS && !isInstalled()) setTimeout(() => installBar(true), 1500);      // iPhone / iPad: no install button - show the 2 taps
window.addEventListener("appinstalled", () => {
  installEvt = null; document.getElementById("installBar")?.remove();
  if ($("#installBtn")) $("#installBtn").hidden = true; toast("Company Portal installed – open it from your home screen");
});
async function installApp() {
  if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => null); installEvt = null; if ($("#installBtn")) $("#installBtn").hidden = true; return; }
  tell("To install: on iPhone / iPad press Share › Add to Home Screen. In Chrome press ⋮ › Install app (or Add to Home screen). " +
    "It must be opened at https://portal.example.com.");
}

async function boot() {
  if (LANG !== "en") { await loadI18n(); startI18n(); }
  bindShell();
  try {
    const { needed } = await api("GET", "/api/setup");
    if (needed) return showAuth("setup");
    const r = await fetch("/api/me", { credentials: "same-origin" });
    if (r.ok) {
      me = (await r.json()).user;
      return enterApp();
    }
    showAuth("login");
  } catch (e) {
    const auth = $("#auth");
    auth.hidden = false;
    auth.innerHTML = `<div class="auth-card"><img class="logo" src="logo.png" alt="Company" /><h1>Cannot connect</h1><p class="sub">${esc(e.message)}<br>Start the server with <strong>start_server.bat</strong> and open the address it shows.</p></div>`;
  }
}
boot();

// automatic sign-out after a while without using the page (minutes set under Settings > Server)
let idleLast = Date.now(), idleWarned = false;
["mousedown", "keydown", "scroll", "touchstart", "wheel"].forEach(ev => document.addEventListener(ev, () => { idleLast = Date.now(); idleWarned = false; }, { passive: true, capture: true }));
setInterval(async () => {
  const mins = me?.idleMinutes;
  if (!mins) return;
  const left = mins * 60000 - (Date.now() - idleLast);
  if (left <= 60000 && left > 0 && !idleWarned) { idleWarned = true; toast("You will be signed out in 1 minute – move the mouse or press a key to stay"); }
  if (left <= 0) {
    try { await flushSave(); } catch { /* nothing to save */ }
    try { await api("POST", "/api/logout", {}); } catch { /* already signed out */ }
    me = null;
    showAuth("login", `Signed out after ${mins} minutes without activity.`);
  }
}, 15000);

// any form: after pressing its Submit / Save button, empty compulsory fields are shown in red
document.addEventListener("click", e => {
  const b = e.target.closest("form button:not([type=button]), form input[type=submit]");
  if (b && b.form) b.form.classList.add("tried");
}, true);
