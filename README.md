# Lodge Desk

A web app for running a small lodge: room availability, bookings, check-in and
check-out, GST invoices, extra charges, payments and monthly reports.

There are two views:

- **Guests** see the rooms, check dates and send a booking request (Google sign-in).
- **Staff** get the front desk, billing, rooms, reports and settings.

## Features

- Room list with rates, AC / non-AC, floor and capacity
- Availability check by date range, with clash detection
- Booking requests from guests, confirmed or declined by staff
- Walk-in bookings, check-in, check-out
- Bills with extra charges (food, laundry, extra bed), each with its own GST rate
- GST on rooms by nightly rate band (configurable in Settings)
- Payments by cash, UPI, card or bank transfer, with advance and balance due
- Numbered tax invoices you can copy or save
- Monthly report: invoiced total, GST, collections by mode, occupancy, dues

## Tech

Plain HTML, CSS and JavaScript. No build step.
Firebase (Google sign-in and Firestore) for login and data.

```
index.html
css/style.css
js/config.js      Firebase settings and staff emails
js/backend.js     Firebase connection
js/app.js         The app
firestore.rules   Database security rules
```

## Setup

1. Create a project at https://console.firebase.google.com
2. Add a **Web app** and copy its config values into `js/config.js`.
3. **Authentication**: turn on the Google sign-in provider.
4. **Firestore Database**: create a database, then paste `firestore.rules`
   into the Rules tab and publish.
5. Put your staff Google email(s) in two places: `staffEmails` in
   `js/config.js` and the list in `firestore.rules`.
6. Open the site, sign in with a staff account, then add your rooms under
   **Rooms** and your lodge details under **Settings**.

## Run locally

Open the folder in VS Code and use the Live Server extension on `index.html`,
or run:

```
python3 -m http.server 5500
```

then visit http://localhost:5500. Google sign-in needs `localhost` to be listed
under Firebase Authentication > Settings > Authorized domains (it is by default).

## Deploy on GitHub Pages

1. Push the folder to a GitHub repository.
2. Repository **Settings > Pages**: deploy from the `main` branch, root folder.
3. Add `your-username.github.io` under Firebase Authentication > Settings >
   Authorized domains.

The Firebase web config in `js/config.js` is meant to be public. Access is
controlled by the rules in `firestore.rules`, so publish those before going live.

## GST note

Room GST bands default to no GST up to Rs 1,000, 5% up to Rs 7,500 and 18%
above. Confirm the current rates with your accountant and change them in
Settings if needed.
