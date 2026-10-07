COMPANY PORTAL - EXTEND
======================

REQUIREMENTS
  Windows PC with Python 3.9 or newer (https://www.python.org - tick "Add Python to PATH" when installing).
  Nothing else needs to be installed.

INSTALL ON A NEW SERVER
  1. Unzip this folder anywhere, e.g. C:\COA Application Website
  2. Double-click start_server.bat and keep the black window open.
     The first start picks a random free port and saves it in config.txt.
     The window shows two addresses, e.g.:
       This PC:         http://localhost:37214
       Office network:  http://<this-PC-IP>:37214   <- give this to colleagues
  3. Open the address. The first time, you are asked to create the SUPER ADMIN account.
  4. Windows Firewall may ask about Python - allow it on "Private networks" so colleagues can connect.

FIRST SET-UP (as Super Admin)
  Administration > Users          add everyone and choose their account type.
                                    Each person must change their password at their first sign-in
                                    (and again after you reset it).
  Administration > Access Control > Positions: a named set of rights (e.g. "Purchase Clerk").
                                    Give it to a person on their page: "Add the position's rights - keep this
                                    person's own" or "Exactly the position's rights". When a position is changed later,
                                    ONLY the rights that were changed are given to / taken from its people -
                                    each person's own other settings stay. Deleting a position keeps their rights.
                                    The Positions are the same list as the staff Positions (Settings > HR
                                    Setting): a position added in either place is in both; renaming it in Access
                                    Control also renames it on the staff; deleting takes it out of both.
  Administration > Access Control click a person > tick per section:
                                    View Only / Submit Detail / Tick Checklist / Resave Allowed
                                    and "Create New Application"
  Administration > Settings       Settings > COA Application > Setting for Drop Down
                                    (Application Type, Purpose, Product Category, Class, Country, Ports, ST Status)

PROGRAMS
  COA Application    - COA forms (sections A-I), checklist, submit, COA expiry alert.
                       Section I has two tabs, ST and eCOS, each with the whole Section I (e-Permit, fees,
                       status, TER fee, COA No. and dates). Section B "ST / eCOS" decides which tabs are
                       shown: ST, eCOS or both (nothing ticked = ST). The eCOS COA has its own expiry alerts.
  Consignment Test   - Consignment Test Application (SIRIM inspection):
                       A. Product Information (with COA / COE, For Safety, For Energy Efficiency)
                       B. Inspection Information (location, contact persons a/b, requested date and time)
                       C. Documents: Invoice, Packing List, BOL, Customs Form (K1) and Serial Number
                          (serial numbers are read from .xlsx / .csv files).
                       Locations for Section B are kept in the Inspection Location Master List
                       (Settings, or the link in Section B - Admin and Super Admin).
                       "Fill from COA" copies the details from the COA Application with the same COA No.
  Email Batch        - (Marketing Dept) one template, one personal email for every customer.
                       Template: type it, reuse an earlier batch's template, or import a Word (.docx) file
                       (a line "Subject : ..." becomes the subject; bold, italic, underline, text colour,
                       highlight, size, font, alignment and links are kept - pictures are not imported).
                       The editor has a toolbar for the same formatting (B / I / U, colour, highlight, size,
                       align, Clear). [Field Name] = filled per customer - click a field button to add it
                       at the cursor, "+ New field" makes a new one.
                       Customers: type them in, or import Excel (.xlsx) / CSV with the columns Email + one per
                       [Field] ("Download import template" gives the right columns) - or a Word (.docx) file:
                       the system finds each customer's details by itself, from a Word table with those headings,
                       lines like "Name : Ali", or the emails already written from the template (one per customer;
                       the text standing where the template has a [Field] becomes the value, and the email address
                       comes from a line like "To: ali@example.com"). Letters whose wording differs too much from
                       the template are reported, so those customers can be added by hand. Preview every email, send a
                       test to yourself, then Send - from the mail server under Settings > Email Alerts, about
                       2 seconds per email. A copy of every sent email is kept; failed ones can be sent again.
                       Sending limit: the Email Batch page shows how many emails went out in the last 24 hours;
                       Admin / Super Admin set the limit there (default 2000, 0 = none; Office 365 allows about
                       10,000 a day per mailbox). At the limit, sending waits and continues by itself.
                       If the mail server stops accepting emails (its limit, login or connection problem) or
                       10 emails in a row fail, sending PAUSES - no customer is lost - and "Continue sending"
                       goes on later. Notices by email (finished / waiting / paused) go to the person who pressed
                       Send and to everyone with "Email Batch" ticked under Email Alerts; the bell shows them too.
  Staff Master Data  - (HR Dept) one row per staff, like the HR Excel: BR (outlet code), Staff Code, Staff Name, IC No.,
                       Position, Email, Joined Date, Resigned Date. Staff with a Resigned Date that has passed
                       show as Resigned (filter: Active staff / Resigned / All staff).
                       Add / edit by hand, or "Import Excel" (.xlsx or CSV): only those columns are taken, any
                       other column is ignored, and a column missing from the file is left as it is. Dates may be
                       30/09/2026, 2026-09-30, 30-Sep-26 or Excel dates.
                       A Staff Code already in the list is updated, a new one is added; tick "Also remove staff who
                       are not in this file" when the file is the full list.
                       "Create login" (Super Admin, Login column): one click makes a system login for the staff -
                       username = Staff Code, name = Staff Name, email copied, Position linked, password DAR.0166
                       (must be changed at the first sign-in) and NO access until it is given in Access Control.
                       Batch: tick staff (or the box in the heading = all staff shown), then "Create logins" (Super
                       Admin - same rules, staff with a login / resigned are skipped) or "Update selected" (set BR,
                       Position, Joined Date and/or Resigned Date the same for all ticked staff).
                       "Select newcomers (n)" ticks the active staff shown (search / BR / Position filters apply)
                       who have no login yet - then "Create logins". Only staff shown on screen stay ticked: changing
                       a filter unticks the staff it hides. Removed staff are kept for record and
                       come back when imported again. "Export Excel" downloads the list.
                       Settings > HR Dept > HR Setting (Super Admin / Admin): the Position list and the Outlet (BR) list
                       (Outlet Code + Outlet Name). The Staff form offers them to choose, the staff list shows the
                       outlet name, and positions / BR codes that are not in the lists are marked and reported
                       after an import. "Add ... used in the staff list" fills the lists from the current staff.
                       Both lists can be imported from Excel / CSV (Position list: column Position; Outlet list: Outlet Code
                       + Outlet Name) - add to the list or replace it; the download button gives the current list.
  MC Request         - (HR Dept, PRO-2603-012) staff submit their MC: Document Type (MC / OMC), Leave Number,
                       Date Apply and the MC picture (photo or PDF). The Document Number is made by the system
                       (OMC-2610-001 / MC-2610-001: type - year month - running number). Staff Code and Outlet come from
                       their login (username = Staff Code in Staff Master Data). Status: Submitted (staff submitted)
                       -> Processing (HR opened it) -> Approved (HR) -> Completed (HR ticks "original MC
                       received"), or Rejected.
                       Lead Time for Original Copy: 30 days from the submit day, counting down; at 10 days left the
                       staff get a pop-up (and an email if they have one); at 0 the request is rejected
                       automatically. Days are set in Settings > HR Setting. HR sees every request; staff only
                       their own. Rights: Access Control > MC Request: "Submit own" / "HR - check & approve all".
  Transfer Form      - (HR Dept, PRO-2603-011) department / position change or outlet transfer.
                       Permanent: one staff - Effective From Date, Position From > To, Outlet From > To, working hours.
                       Temporary: one or more staff ("+ Add staff") - From / To Date, Outlet From > To, working hours,
                       Request For ID Login SBClient System (Manager / Asst. Manager / Cashier / Sales Asst.).
                       Staff Name, IC No. and Outlet fill in from Staff Master Data after the Staff ID; the times fill
                       in from the "To" outlet's working hours (Settings > HR Setting > Outlet list > Working hours).
                       Status: Drafted (form saved / submitted - print the letter, get it signed) -> Processing (the
                       outlet uploaded the signed letter) -> Completed (HR uploaded its signed letter) -> Checked (the
                       outlet opened it). HR can cancel any form except Cancelled / Checked. Edit while Drafted.
                       Staff see their own forms; HR sees all. Rights: Access Control > Transfer Form.
                       Signature boxes: "ID No." = the User ID (Staff Code); typing it fills in the name.
  Memo               - (General, PRO-2603-010) memos from HR to the staff. Every login has General > Memo.
                       View Memo: the posted memos meant for you, by year, as cards or as a list (NEW = not read).
                       Memo Create Form (HR): Upload (a PDF) or Manual Create (typed in, or imported from Word .docx -
                       laid out as a memo letter with the letterhead). HR chooses the Person in Charge and
                       "Who can view": All, or WHERE (State; tick outlets to narrow - a ticked State shows only its outlets)
                       and WHO (Department; tick positions to narrow - a ticked Department shows only its positions).
                       Both chosen = the staff must match both (e.g. Johor + Account = Account staff in Johor).
                       Preview (under the form): every detail, how many staff it reaches (and how many have no
                       login yet), and the memo as it will look - updates as you type.
                       Status: Processing (waiting for the person in charge) -> Approved (Memo Approval: the person in
                       charge approves with an e-signature - drawn, uploaded or saved; for a PDF the signature, name,
                       User ID and date are added at the bottom right of the last page) -> Posted (HR posts it; the
                       chosen staff see it). HR can edit while Processing / Approved (an edit after approval needs a
                       new approval) and cancel at any time. Memo Listings (HR) lists every memo.
                       Who-can-view lists come from Settings > HR Setting: Outlet list (State of each outlet),
                       Department list, and the Department of each position. A staff's outlet and position come
                       from Staff Master Data (login User ID = Staff Code).
                       Rights: Access Control > Memo: "HR - create, post, all memos" / "Approve (person in charge)".
                       Signatures: Settings > Users > Signature column (Super Admin: draw or upload anyone's), or
                       the user menu > My signature (each person their own). The saved signature is offered when
                       approving; a signature drawn while approving is saved too (tick "Save this signature").
  Access to each program is set per person under Settings > Access Control.
  Positions in Access Control are grouped under their Department (Department list: Settings > HR Setting).
  Each Position's page has a Department choice - the same as the Department of the position in HR Setting.

HR SETTING - MOVE TO ANOTHER SERVER
  Settings > HR Setting > "Export all": one Excel file with the sheets Positions (Position, Department),
  Departments, Outlets (Outlet Code, Outlet Name, State, working hours) and MC Setting (lead time, reminder).
  On the other server: Settings > HR Setting > "Import all" > choose the file > Add (merge) or Replace > Import.
  Access rights of the positions are not in the file (Access Control).

ACCOUNT TYPES
  Super Admin - everything, incl. users, roles, access control and settings
  Admin       - sees all applications and sections; edits the sections given to them (even after submit);
                can reopen sections and cancel applications; sees the Audit Trail
  User        - sees only the sections given to them; can Save only (an Admin submits);
                a submitted section is locked for Users until an Admin reopens it
  Viewer      - read-only; sees the Audit Trail

AUDIT TRAIL AND VERSIONS (Super Admin, Admin, Viewer)
  Audit Trail - every single change: who, when, before and after.
  Versions    - a full copy of the document after every amendment (edits by the same person within
                10 minutes are grouped). Open "Versions" on a form to see the FULL document as it was at any
                version (with the files it had then), or to compare two versions side by side.
                Removing a file only takes it off the form - it stays stored for the versions.

DATA / BACKUP
  Everything is stored in the "data" folder (created on first start):
    data\coa.db                                  users, applications, access, audit trail
    data\uploads\<Form No>\<Section>\<file>.pdf  attached documents (original file names)
  To back up: stop the server (close the black window) and copy the whole "data" folder.
  Do not rename or move files inside data\uploads - the system links to them.
  Applications are never deleted, only cancelled. The audit trail cannot be changed.

UPDATING TO A NEW VERSION (your data is kept)
  1. Back up the "data" folder.
  2. Unzip the new version over this folder and choose "Replace the files".
     The zip never contains "data" or config.txt, so they are not touched.
  3. Only files in "public" changed?  -> no restart needed, everyone presses Ctrl+F5.
     server.py / sections.json changed? -> Settings > Server > Restart server (Super Admin),
     or close the black window and start start_server.bat again.

EMAIL ALERTS (Administration > Email Alerts - Super Admin and Admin)
  "Who receives which alert": the Super Admin or an Admin ticks per person which alerts they get
  (default: Super Admin / Admin all three, User Unsettled + COA expiry). The mail server is Super Admin only.
  Checked every 30 minutes. Super Admin / Admins hear about all forms; Users only about the forms they
  created or worked on. Email addresses: Administration > Users > Edit > Email.
    Unsettled job - a COA / Consignment Test form still in Draft (not submitted) with no change for
                    2 days (adjustable); reminded again every 2 days until it is submitted.
    COA expiry    - the COA Expiry Date is 30, 15 and 5 days away (adjustable); each alert once.
                    No alert when a renewal application (Previous COA No.) exists.
    Saved         - someone pressed the Save button on a form: who, which form and what changed.
                    Sent right away to the Super Admin / Admins (not to the person who saved).
    Email Batch   - a batch finished, is waiting for the daily sending limit, or was paused.
  Needs the company mail server (SMTP): e.g. smtp.office365.com / 587 / STARTTLS, or
  smtp.gmail.com / 587 / STARTTLS with a Google App password. Use "Send test email" to check.

APPSHEET (phone app, view only)
  Settings > AppSheet sends a read-only copy of the data to a Google Sheet every few minutes;
  an AppSheet app is built on that Sheet. Nothing comes back from AppSheet into this system.
  The server PC needs internet access. Sheets: COA Applications, Consignment Test, Serial Numbers,
  Documents (file list + "Open in Website" link - the link works on the office network only), and
  Email Batch (every email sent out: batch no., customer email, subject, all its details, sent / failed,
  time) - this one is only in the Google Sheet. Document Versions (every version of every COA / Consignment
  Test form: version no., action, who, when, what changed) and Version Changes (one row per changed item with
  the old and the new value). A PDF of every version (what changed + the whole document as it was) is copied
  to Google Drive into the form's folder and linked in the "Version PDF" column (20 files per sync - the rest
  follow at the next syncs). The same PDF: Versions page > "PDF" on a version.
  Documents are also copied to Google Drive (folder "Company COA Documents", one folder per Form No.,
  shared "Anyone with the link") - the "Drive Link" column opens them anywhere. Up to 20 files / 150 MB
  per sync; files over 35 MB stay only in this system. A document removed here goes to the Drive trash.
  After a new version of the script: Apps Script > Deploy > Manage deployments > Edit > New version > Deploy.
  Who can see the Sheet and documents: "Only these email addresses" (list on the AppSheet page, any
  Google account - not only system users) or "Anyone who has the link". The list is applied at the next
  sync: added people get view access, removed people lose it. Also share the AppSheet app with them.
  Set-up: follow steps 1-3 on the Settings > AppSheet page (create sheet, paste script, deploy as
  Web app "Anyone", paste the /exec URL, Save, Sync now, then build the app in appsheet.com).

ON THE INTERNET (staff only) - Cloudflare Tunnel + Cloudflare Access
  The server stays on this PC. A small Cloudflare program (cloudflared) connects OUT to Cloudflare; staff open
  https://portal.example.com . Nothing is opened on the office router. Cloudflare Access asks for a one-time
  code sent to the person's email BEFORE the sign-in page appears (only listed emails / @example.com).
  1. cloudflare.com: create a free account, Add site > example.com. Check every existing DNS record (website,
     Office 365 email MX / TXT / autodiscover) is listed, then change the domain's name servers at the domain
     provider to the two Cloudflare ones. Wait until the site shows "Active".
  2. one.dash.cloudflare.com (Zero Trust, Free plan): Networks > Tunnels > Create a tunnel > Cloudflared >
     name it > Windows: download cloudflared and run the shown "cloudflared.exe service install ..." command in
     an ADMIN Command Prompt on this PC.
     Public hostname: subdomain "portal", domain example.com, Service HTTP, URL localhost:<PORT in config.txt>.
  3. Access > Applications > Add > Self-hosted: domain portal.example.com. Policy "Allow", Include
     "Emails ending in @example.com" (add other staff emails one by one). Login method: One-time PIN.
  4. In this system: Settings > Server Settings > Website address: https://portal.example.com > Save
     (used in emails, the Google Sheet and AppSheet). "Sign out after" = minutes without activity (default 30).
  5. Optional - only through the internet address: add the line  BIND=127.0.0.1  to config.txt and restart
     (then office PCs also use https://portal.example.com).
  Behind Cloudflare the system: sends the sign-in cookie only over HTTPS, tells browsers to always use HTTPS,
  locks a visitor (their real address) for 5 minutes after 8 wrong passwords, signs people out after the idle
  minutes, and requires new passwords of at least 10 characters with letters and numbers.
  Keep this PC on 24/7 (no sleep), use a Windows password, BitLocker and Windows Update, and back up "data".

OPTIONS
  Change the port:   open config.txt, change PORT=37214 to another number (1024-65535),
                     save, and restart the server. Tell colleagues the new address.
  Different data dir: set COA_DATA=D:\COA-data

NOTE
  Meant for the office network only. Do not expose it directly to the internet.
