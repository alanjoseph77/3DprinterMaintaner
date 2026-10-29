# Print Lab

Web app for sharing two Bambu Lab printers (P1S, P2S).

- **Two user types:** `csd` prints free, `individual` pays by UPI QR. Admin assigns the type.
- Upload a **sliced `.3mf`** (exact filament grams + time from the file) or `.stl` (rough estimate).
- Price = max(min_price, grams x rate_per_gram + hours x rate_per_hour). Each QR amount has unique paise to match payments.
- Individuals scan the QR, enter the UPI transaction ID; an admin confirms it against the bank app.
- Admin: confirm/reject payments, start/finish jobs, manage users, rates and UPI id, see totals per printer.
- Full history for every user (own jobs) and for admins (all jobs).

## Run

    npm install
    npm start          # http://localhost:3000 (Node 18+)

The first registered user becomes admin. Set the UPI id and rates under Admin > Settings.
Data lives in `data/app.db`, uploads in `uploads/`.

## Live printer status

Admin > Printer connections: enter each printer's IP, serial and LAN access code (LAN Mode on). The site then shows
online/idle/printing, progress, temperatures, and marks the running job done/failed automatically (read-only MQTT).

## Printer control

`src/printer.js` is a mock. Real start (MQTT + FTPS over LAN, needs LAN mode / Developer Mode on the P1S and P2S)
is the next step; per-printer `ip`, `serial`, `access_code` columns already exist.
