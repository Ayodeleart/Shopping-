# Order tracking and customer notifications

Built on the existing tables (`orders`, `order_items`, `vendors`, `push_subscriptions`); nothing was replaced. Needs the tracking SQL run once in the
Supabase SQL editor (SQL is pasted in the chat when a change needs it, never stored in this repo). Until it is run, the storefront, vendor board and admin
panel fall back to the old order lists.

**How it fits together**

- `shipments`: one row per seller per order (a seller sub-order). Holds the current status, carrier, tracking number, estimated delivery, shipped/delivered
  times, and reserved columns for live delivery (`rider_id`, `current_lat`, `current_lng`, `last_location_at`, `eta_at`). Created by a trigger when order lines are inserted.
- `tracking_events`: append-only history (order placed, payment confirmed, processing, preparing shipment, shipped, in transit, out for delivery, delivered,
  cancelled, delivery failed, returned, refunded, plus `tracking_updated` for corrections). `shipment_id` null = applies to the whole order. Nothing can update or delete an event.
  The order's overall status (partially shipped, in transit, delivered ...) is derived from its shipments and stored on `orders.fulfillment_status`.
- All status changes go through `record_tracking_event()` (sellers, admin; a courier integration later), `record_order_event()` (payment, admin only) and
  `cancel_order()` (admin only). The server checks who you are, that the shipment is yours, that the move is allowed (no going backwards, no shipping without
  a carrier and tracking number), and ignores repeats (same status, or the same idempotency key). Row level security means customers see only their own orders and
  sellers only their own shipments; nobody can write these tables directly.
- Checkout calls `place_order()`: prices, names and sellers come from `products`, the buyer from the login, and the order, lines and shipments are created in one transaction.
- Notifications: a trigger on `tracking_events` writes the in-app notification (`notifications`) and one delivery row per channel (`notification_deliveries`),
  applying the customer's `notification_preferences`. It never raises, so a notification problem cannot fail an order update. `/api/notify-dispatch` then sends the
  queued pushes and emails and records sent / failed / skipped (with the reason) on each delivery row; failures are retried with a growing delay.
  Order, delivery and payment notices always exist in the app; the settings only decide whether they are also pushed or emailed, and the Promotions switch never affects them.
- Emails: `api/_lib/email/layout.js` (logo, colours, footer, order table, tracking box, button) and `api/_lib/email/templates.js` (one row of data per event).
  To change wording, edit the row. To add an event, add a row and a branch in `notification_copy()` in the database.
- Couriers: `carriers` table (`provider` = manual / own / api) and `api/_lib/carriers.js`. Manual updates work today; `own` generates a tracking number (`MT` + shipment id);
  no courier API is connected. A future integration implements `fetchUpdates()` and calls `applyCarrierUpdate()`, which uses the same server function.

**Environment variables (Vercel)**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL` (push; already used),
`RESEND_API_KEY` and `EMAIL_FROM` (email; nothing is emailed and nothing claims to be until both are set), `SITE_URL` (used for links and the logo in emails; defaults to the request host),
`CRON_SECRET` (optional, lets a scheduler call `/api/notify-dispatch` to retry failures; retries also happen on every order update).

**Where things are**: customer tracking page `components/order-tracking.js` (`#order=ID`), notification center and settings `components/notification-center.js` (`#notifications`),
shared helpers `data/tracking.js`, vendor fulfilment `vendor/orders.js`, admin orders/shipments `admin/orders.js`, engine `api/_lib/dispatch.js`, endpoint `api/notify-dispatch.js`.

# Store - PWA with Supabase

## Always fresh (service workers) and seller sign-up

- **Updates show on the first open.** The service workers are network-first for pages, scripts and styles (the cache only answers offline or
  when the network takes over 4 s), never touch Supabase, `/api/` or other origins, and serve images cache-first. A new version reloads the app
  once by itself (`components/sw-register.js`: right away if just opened, otherwise when the app goes to the background).
- **Admin**: a splash shows while the session is checked, so a signed-in admin never sees the login page flash by.
- **Sell on Maccato** (`/vendor/`): opens on **Create account** (email + password), with a Sign in tab, Forgot password and a confirm-email screen. No Google button.
  Turn on *Confirm email* in Supabase (Authentication > Providers > Email) and add `https://YOUR-DOMAIN/vendor/` to Authentication > URL Configuration > Redirect URLs.

## Storefront v2: brands with logos, favorites, search, new product page

The SQL for this (brands, favorites, real rating summaries, vendor logo uploads, category tidy-up) is pasted in the chat when it is needed, never stored in this repo.
It creates `brands` (+ `products.brand_id`), `favorites`, the `product_ratings` view and the storage policy that lets a vendor upload their logo.

- **Brand search when adding a product** (vendor and admin forms): the vendor types a brand, sees brands already
  saved plus results from logo.dev, and can add a brand nobody has listed yet with their own logo, so nobody is ever
  stuck. Chosen brands are saved to `brands` and shown as "Shop by Brand" logo tiles on the home page.
  Code: `components/brand-picker.js`, `api/brand-search.js`.
- **Vercel environment variables** (never in the repo): `LOGO_DEV_SECRET_KEY` (sk_..., search) and
  `LOGO_DEV_PUBLISHABLE_KEY` (pk_..., logo images). `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_EMAIL`
  are the ones `admin-vendors.js` already uses. Only approved vendors and admins can call the search endpoint.
  logo.dev's free plan needs the "Logos provided by Logo.dev" link, which is in the storefront footer.
- **Vendor logo**: Vendor > Settings > Store Logo. Shown next to "Sold by" on product pages and in the vendor row.
- **Home**: the store logo / name is a link to the home page from every page (header, product page, cart, account, category and ad pages).
  The search bar stays visible; once it scrolls away the header search icon appears and the category titles stick under the header.
- **Search** (`data/search.js`, `components/search-page.js`): tapping the bar opens a full-screen search. Empty: recent searches (kept on the
  device) + categories + popular brands. Typing: brand, category and product suggestions with the typed words marked. Enter / "See all":
  every match, with sort, category, brand, price range and "on sale" filters. Every word must match (name, brand, category, seller, description),
  plurals are ignored and close misspellings still find the product.
- **Recently viewed** (this device): shown on the cart page and at the bottom of the product page, after "More from this seller" and "Similar items".
- **Product cards**: favorites (heart); Add to Cart flies the photo to the cart icon and becomes `[-] 1 [+]` (square buttons, quantity between them).
- **Categories**: no emoji anywhere (names are cleaned on load, the icon column is ignored, tiles without a picture show the first letter).
- **Product page**: auto-rotating photos, full-screen viewer (pinch/double-tap zoom), Sold by + View Store, brand,
  real rating and reviews only, delivery and returns text from Admin > Settings, more from this seller, similar items.
  Shared links look like `/?p=PRODUCT_ID`.

## GIF tiles and pages that open from banners

Needs the tiles SQL run once in the Supabase SQL editor (SQL is pasted in the chat when a change needs it, never stored in this repo).

- **Admin > Banners > Tiles**: add a looping GIF (under 4 MB) with a caption. Any shape is accepted and shown whole, uncropped, in its
  own proportions (square is only the default), so you can judge how it looks before deciding on a size. GIFs are uploaded untouched so they keep animating. Choose where it shows: in a row under the hero banner, or
  inside the product feed after N rows. Tiles in the same place share one row (four fit the screen, more slide sideways).
- **Tag each tile (and each hero banner) to what it opens**: a brand's products (brand logo page), products matching filters
  (discount at least 30%, a category and its subcategories, a keyword, max price, flash sale or featured, sort order),
  products you pick by hand, an ad page, or a link. A "30% off" GIF opens every product 30% off or more; an Apple GIF opens only Apple.
- The page is the same layout as an ad page (`#tile=ID` for tiles, `#promo=ID` for banners), so back closes it.
- Vendors pick a product's brand with the brand search in the upload form; a brand tile matches on that brand.
- Code: `components/tile-row.js`, `admin/tiles.js`, `admin/dest-picker.js`, `data/ads.js`.

## Ads, brand pages and multi-photo products

Needs the ads and storage SQL run once in the Supabase SQL editor. It also fixes admin image uploads
(`new row violates row-level security policy`) by adding storage and admin policies.

- **Admin > Banners > Ads**: create an ad, choose how many product rows come before it in the home feed, set a brand
  keyword, and build the brand page (logo, sliding hero banners, product rows, feature cards, banners, video, text).
- **Brand page**: tapping an ad opens `#ad=ID`, a full page showing only that brand's products in a different layout
  from the home grid. Products match by `products.brand` or the brand word in the name.
- **Products**: admin and vendors can add several photos; the first is the main photo. The product page shows a swipe gallery.
- Code: `components/ad-page.js`, `components/multi-image-picker.js`, `data/ads.js`, `admin/ads.js`, `admin/ads-sections.js`.

## ⚡ Multi-vendor upgrade (read this first)

This repo now has three separate installable PWAs:
- `index.html` — buyer storefront
- `/vendor` — vendor board (vendors sign in with Google, list products, manage orders)
- `/admin` — admin panel (approve vendors, moderate products/banners/orders)

### 1. Run the new migration
In Supabase SQL Editor, run `migration_vendors.sql` (adds `vendors`, `order_items`, `vendor_id` columns, and turns RLS back on — the old setup had RLS disabled everywhere).

### 2. Enable Google sign-in
Supabase Dashboard → Authentication → Providers → Google → enable it, and add your Google OAuth Client ID/Secret from Google Cloud Console. Add this site's URL(s) to the provider's authorized redirect URIs.

### 3. Set your admin email
In `admin/index.html`, find `ADMIN_EMAILS` near the top of the `<script>` block and replace the placeholder with your real Google account(s).

### 4. Deploy `/api/admin-vendors.js` (needs a Node serverless host, e.g. Vercel)
Set these environment variables in your hosting project (never in the repo):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (Supabase Dashboard → Project Settings → API)
- `ADMIN_EMAIL` (comma-separated, must match `ADMIN_EMAILS` in admin/index.html)

Without this deployed, the admin panel's Vendors tab can't list or approve vendors (by design — the anon key can't bypass RLS for other users' rows).

### 5. Still to do
- Supabase email templates (vendor approval, order confirmation)
- Storefront homepage reorder: featured → categories → vendors → recommended for you → recently viewed → hot deals → per-category scrollable rows (currently: hero → categories → vendors → flash sale → featured → all products)


## Files
- index.html — Customer storefront (PWA)
- /admin — Admin panel (PWA)
- /vendor — Vendor board (PWA)
- /api/admin-vendors.js — Serverless function (list/approve/suspend vendors)
- sw.js — Service worker (offline support, storefront only)
- manifest.json — PWA manifest (storefront)
- icon.svg — App icon
- setup.sql — Original database setup (run once)
- migration_vendors.sql — Multi-vendor migration (run once, after setup.sql)

---

## Step 1 — Supabase Database Setup

1. Go to https://supabase.com/dashboard
2. Open your project
3. Click SQL Editor in the left sidebar
4. Click New Query
5. Copy everything from setup.sql and paste it
6. Click Run
7. You should see "Success" for each statement

---

## Step 2 — Make Storage Bucket Public

1. In Supabase dashboard, click Storage in the left sidebar
2. Click the "avatars" bucket
3. Click the Settings icon (gear) or Policies tab
4. Make sure the bucket is set to Public
5. If not public, click "Make Public" or add a policy:
   - Go to Policies tab
   - Add policy: Allow public read (SELECT) for anon role
   - Allow INSERT, UPDATE, DELETE for anon role

---

## Step 3 — Deploy (Free Options)

### Option A — Netlify Drop (Easiest, works from mobile)
1. Go to https://app.netlify.com/drop on your phone
2. You cannot drag files from mobile easily, so use Option B

### Option B — Netlify via GitHub (Recommended)
1. Create a free account at https://github.com
2. Create a new repository (e.g. "my-store")
3. Upload all 6 files to the repository
4. Go to https://netlify.com and sign up free
5. Click "Add new site" → "Import from Git"
6. Connect GitHub and select your repository
7. Click Deploy
8. Your store is live at a .netlify.app URL

### Option C — Vercel
1. Same as Netlify but at https://vercel.com
2. Import from GitHub and deploy

### Option D — GitHub Pages
1. Upload files to a GitHub repo
2. Go to repo Settings → Pages
3. Set source to main branch
4. Your site is live at username.github.io/repo-name

---

## Step 4 — Custom Domain (Optional)
Both Netlify and Vercel let you add a custom domain free.
Go to your site settings and add your domain.

---

## Using the Admin Panel

1. Open yoursite.com/admin
2. Sign in with an admin Google account (must be listed in `ADMIN_EMAILS` in `admin/index.html` and in the `ADMIN_EMAIL` env var — see the multi-vendor setup steps above)

### Add Products
- Go to Products tab
- Fill in name, price, and upload image

## Using the Vendor Portal

1. Open yoursite.com/vendor
2. Sign in with Google, fill in the store profile form
3. Wait for an admin to approve the application in /admin → Vendors tab
4. Once approved: add products, they show up on the storefront automatically; view/update orders as they come in
- Toggle "Featured" to show in Featured section
- Toggle "Flash Sale" to include in flash sale

### Add Banners
- Go to Banners tab
- Upload a banner image (recommended size: 1200x400px)
- Add title, subtitle, and button text
- Set display order (1 = first, 2 = second, etc.)

### Flash Sale Timer
- Go to Settings tab
- Set "Flash Sale End" date and time
- Make sure products have "Flash Sale" toggled on
- Save settings

### Add Categories
- Go to Settings tab
- Type category name and tap Add
- Categories appear in the storefront filter row
- Assign categories to products when adding them

### Orders
- Customer orders appear in the Orders tab
- Mark orders as Complete when fulfilled
- Dashboard shows total revenue

---

## PWA Install
Customers on Android can tap "Install" in the banner at the top.
On iPhone: tap Share → Add to Home Screen.

---

## Notes
- Images are stored in Supabase Storage (avatars bucket)
- All product/banner/order data is in Supabase database
- Cart is stored locally in the customer's browser
- The admin session stays active until the browser tab is closed
- Service worker caches the app shell for offline access
