# Print Lab

Web app for sharing two Bambu Lab printers (P1S, P2S).

- **Two user types:** `csd` prints free, `individual` pays by UPI QR. Admin assigns the type.
- Upload a **sliced `.3mf`** (exact filament grams + time from the file) or `.stl` (rough estimate).
- Price = max(min_price, grams x rate_per_gram + hours x rate_per_hour). Each QR amount has unique paise to match payments.
- Individuals scan the QR, enter the UPI transaction ID; an admin confirms it against the bank app.
- Admin: confirm/reject payments, start/finish jobs, manage users, rates and UPI id, see totals per printer.
- Full history for every user (own jobs) and for admins (all jobs).

## Accounts and CSD verification

- The **admin account** is for administration only: it sees Live printers, Printer log and Admin, and cannot submit print requests.
- Everyone else (including CSD staff) creates a normal account and starts as a regular user (personal requests, paid).
- CSD staff tick **I am CSD staff** at sign-up (or use **Request verification** later) and give their staff ID or department.
- An admin checks them under **Admin > CSD staff verification** and clicks **Verify** or **Reject**. Verified staff can submit free **CSD project** requests; the user is notified either way.
- Admins can also set a user's type manually in Admin > Users.

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

`src/printer.js` is a mock. Real start (MQTT + FTPS over LAN, needs LAN mode / Developer Mode on the P1S and P2S)
is the next step; per-printer `ip`, `serial`, `access_code` columns already exist.

## Printer log pictures

The Printer log tries to read each model's preview from the printer over FTPS. If a picture is missing,
open Admin > Printer connections > "Check files" and "Raw data" (look for `thumb_error`) to see why.
