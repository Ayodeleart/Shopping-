# Store - PWA with Supabase

## Files
- index.html — Customer storefront (PWA)
- admin.html — Admin panel
- sw.js — Service worker (offline support)
- manifest.json — PWA manifest
- icon.svg — App icon
- setup.sql — Database setup (run once)

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

1. Open yoursite.com/admin.html
2. Default password: admin123
3. Change password immediately in Settings tab

### Add Products
- Go to Products tab
- Fill in name, price, and upload image
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
