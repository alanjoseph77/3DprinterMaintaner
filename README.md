# Print Lab

Web app for sharing two Bambu Lab printers (P1S, P2S).

- **Two user types:** `csd` prints free, `individual` pays by UPI QR. Admin assigns the type.
- Upload a **sliced `.3mf`** (exact filament grams + time from the file) or `.stl` (rough estimate).
- Price = max(min_price, grams x rate_per_gram + hours x rate_per_hour). Each QR amount has unique paise to match payments.
- Individuals scan the QR, enter the UPI transaction ID; an admin confirms it against the bank app.
- Admin: confirm/reject payments, start/finish jobs, manage users, rates and UPI id, see totals per printer.
- Full history for every user (own jobs) and for admins (all jobs).

## Request flow (personal use)

1. Log in and choose **Personal** (or **CSD project**, CSD members only, free).
2. Upload the part (`.stl`; a sliced `.3mf` also works and gives exact numbers).
3. The site estimates weight and time; the user sets material, layer height, infill, supports, copies, preferred printer.
4. The bill shows time, weight and cost with a UPI QR code.
5. The user uploads the payment screenshot (and optionally the transaction ID).
6. Submit; every admin gets a notification (bell icon).
7. Admin reviews: checks material availability, schedule, printer and print parameters.
8. Admin approves: the site prints directly, or printing is done manually. The user gets a notification.

Extra parameter changes: contact the admins and come to CSD.

### CSD project request

1. Log in and choose **CSD project** (CSD members only).
2. Select the project (admins manage the list under Admin > CSD projects); enter part name and description.
3. Upload the part (`.stl`).
4. The site estimates weight and time; the user sets print parameters.
5. The bill shows time, weight and cost, with no payment option.
6-8. Submit; admins are notified, verify material/schedule/parameters, and approve (site prints directly or manually).

## Run

    npm install
    npm start          # http://localhost:3000 (Node 18+)

The admin account is fixed: `admin@printlab.local` / `admin123` by default. Copy `.env.example` to `.env` and set
`ADMIN_EMAIL` / `ADMIN_PASSWORD` (the admin is re-created with these on every start, so editing `.env` also resets a forgotten password).
Set the UPI id and rates under Admin > Settings.
Data lives in `data/app.db`, uploads in `uploads/`.

## Live printer status

Admin > Printer connections: enter each printer's IP, serial and LAN access code (LAN Mode on). The site then shows
online/idle/printing, progress, temperatures, and marks the running job done/failed automatically (read-only MQTT).

## Printer control

Pressing **Start** on an approved job (print mode "site prints") sends it to the printer (`src/printer.js`):

1. A sliced `.3mf` is used as-is. An `.stl` is sliced on the server with the **Bambu Studio** command line, using
   Bambu's own profiles for that printer, material and layer height, with the job's infill, supports and copies.
2. The `.gcode.3mf` is uploaded to the printer over FTPS (port 990), then started over MQTT (port 8883).
3. The job's grams, time and preview picture are updated from the real slice; the agreed price does not change.

Needs: Bambu Studio installed on the server PC (path under Admin > Settings, default
`C:\Program Files\Bambu Studio\bambu-studio.exe`), and the printer connected under Admin > Printer connections
(LAN Only Mode, and Developer Mode on newer firmware). Set "Feed filament from the AMS" to 1 if the printer uses an AMS.
Jobs approved as "manual" are not sent; "Mark printing" only records that you started it on the printer.

## Printer log pictures

The Printer log tries to read each model's preview from the printer over FTPS. If a picture is missing,
open Admin > Printer connections > "Check files" and "Raw data" (look for `thumb_error`) to see why.
