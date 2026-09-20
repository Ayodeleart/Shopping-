# Store - PWA with Supabase

## Ads, brand pages and multi-photo products (run `migration_ads_and_images.sql` first)

Run `migration_ads_and_images.sql` once in the Supabase SQL editor. It also fixes admin image uploads
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
