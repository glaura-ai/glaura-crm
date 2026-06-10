---
description: Onboard a salon from an Acuity Scheduling page into Glaura
argument-hint: <acuity-url>
allowed-tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_evaluate, mcp__playwright__browser_run_code, mcp__playwright__browser_take_screenshot, Bash(curl:*,node:*), Read, Write, Glob, Grep, Edit
---

# Onboard Salon from Acuity Scheduling

You are onboarding a salon from an Acuity Scheduling page into Glaura. The user provided this URL: $ARGUMENTS

## Confirmation Policy

- **Phase 1-2 (scraping, images):** Run automatically — NO user confirmation needed. Just do it.
- **Phase 3 (dry run):** Present data, then ask ONLY about:
  - **Category mappings** that may be wrong (user can correct)
  - **Missing info** (phone, address, hours — Acuity pages often don't have these)
  - **Final go/no-go** to proceed with Firestore writes
- **Phase 4 (creation):** Execute all writes after the single Phase 3 confirmation

## Phase 1: Scrape the Acuity Page

1. Navigate to the URL using `mcp__playwright__browser_navigate`
2. Take a snapshot to see the page structure
3. **Click "Afficher tous les rendez-vous"** (or "Show all appointments") to reveal all services in all categories at once
4. Take a snapshot after expanding

5. Extract ALL structured data using `mcp__playwright__browser_evaluate`:

```js
() => {
  const data = { salon: {}, services: [], images: [], categories: [] };

  // Salon name - from the h1 or page title
  const h1 = document.querySelector('h1');
  data.salon.name = h1 ? h1.textContent.trim() : document.title.replace(' - Prendre rendez-vous', '').trim();

  // Images - Acuity hosts images on cdn-s.acuityscheduling.com
  document.querySelectorAll('img').forEach(img => {
    const src = img.src || '';
    if (src.includes('acuityscheduling.com/upload-')) {
      data.images.push(src);
    }
  });

  // Services - grouped by category paragraphs
  const mainList = document.querySelector('ul, [role="list"]');
  if (mainList) {
    let currentCategory = '';
    mainList.querySelectorAll(':scope > li').forEach(li => {
      const categoryEl = li.querySelector('p[class*="category"], [class*="group-name"]');
      if (categoryEl) {
        currentCategory = categoryEl.textContent.trim();
      }

      const nestedItems = li.querySelectorAll('li');
      nestedItems.forEach(item => {
        const nameEl = item.querySelector('[class*="name"], [class*="title"]');
        const fullText = item.textContent;
        const name = nameEl ? nameEl.textContent.trim() : '';

        const durationMatch = fullText.match(/(\d+)\s*heure[s]?\s*(?:(\d+)\s*minute[s]?)?/);
        const minMatch = fullText.match(/(\d+)\s*minute[s]?/);
        const priceMatch = fullText.match(/(\d+[,.]?\d*)\s*€/);

        if (name) {
          data.services.push({
            name: name,
            category: currentCategory,
            duration_hours: durationMatch ? parseInt(durationMatch[1]) : 0,
            duration_minutes: durationMatch && durationMatch[2] ? parseInt(durationMatch[2]) : (minMatch ? parseInt(minMatch[1]) : 0),
            price: priceMatch ? parseFloat(priceMatch[1].replace(',', '.')) : 0,
            description: '',
          });
        }
      });
    });
  }

  return data;
}
```

**IMPORTANT**: Acuity pages have varying DOM structures. The JS extraction above is a starting point. After running it, **always cross-reference against the snapshot**. The snapshot is the source of truth. If services are missing or malformed, manually build the correct list from the snapshot.

6. Extract descriptions for services that have them. In the snapshot, descriptions appear as paragraph text below service names.

### Acuity-specific parsing rules

**Duration format**: `"X heures Y minutes"` → convert to total minutes
- `"3 heures 10 minutes"` → 190
- `"1 heure 30 minutes"` → 90
- `"30 minutes"` → 30
- `"4 heures"` → 240
- `"1 heure 10 minutes"` → 70

**Price format**: `"à Z,00 €"` → numeric
- `"à 81,00 €"` → 81
- `"à 125,00 €"` → 125

**Categories**: Acuity uses bold Unicode text for category names (e.g., `𝐅𝐄𝐌𝐌𝐄`, `𝐇𝐎𝐌𝐌𝐄`). Normalize these to plain text for subcategory names using NFKD: `name.normalize('NFKD')`.

## Phase 2: Get Images

Acuity images are hosted on `cdn-s.acuityscheduling.com/upload-*.{png,jpeg}`. These URLs are directly downloadable — no transform stripping needed.

Verify each URL is accessible with `curl -sI <url>`.

## Phase 3: Present Data for Review (DRY RUN)

**IMPORTANT**: Acuity booking pages often do NOT expose salon address, phone, or opening hours. Still inspect visible page text, account metadata, links, footers, and map/contact links first. Ask the user to provide anything still missing:
1. **Phone number**
2. **Address** (street, city, postal code)
3. **Opening hours** per day

**Email and password will be auto-generated** — no need to ask.

Present the extracted data:

### Salon Info
| Field | Value |
|-|-|
| Name | ... |
| Images | X photos found |
| Address | Not available — ask user |
| Phone | Not available — ask user |
| Hours | Not available — ask user |

### Category Mapping Table

Show each Acuity category → Glaura category + subcategory name, with service count.

### Glaura Category IDs

| ID | Name |
|-|-|
| `qlwRNcbICdWVZd0CfJ7z` | Beauté visage |
| `pCMUpz8GoD4md1Rqt2cs` | Epilation |
| `SceVTrEpBGjSrHO7pwFS` | Bien Etre |
| `vZQNDw2KCuEUSyXTTZMf` | Nails |
| `W3em4NFLX2aRAu1BFNNN` | Barber |
| `ixgMn0e5RlzAztxVhfgm` | Coiffure |
| `XGA7rpOhgHFMr3W3sCnU` | Makeup |

### Category Mapping Strategy

**Map each Acuity category heading as a Glaura subcategory** under the best-fit Glaura category:
- Face treatments / peeling / microneedling / anti-âge / regard → **Beauté visage**
- Body treatments / body contouring → **Bien Etre**
- Massage / spa / sauna → **Bien Etre**
- Prestations homme → **Bien Etre** (NOT Barber)
- Épilation / cire → **Epilation**
- Onglerie / mains / pieds → **Nails**
- Coiffure → **Coiffure**
- Maquillage → **Makeup**

### Services to Always Skip
- **Carte cadeau** — gift cards, not real services
- **"Coaching" / "RDV diagnostic" / "Suivi contrôle"** — consultations

### Service Description Rules
- **Never translate descriptions** — use the exact original French text
- **Keep service names exactly as on Acuity** (original spacing, punctuation, accents)

### Services (grouped by category)
| # | Service | Duration | Price | Category → Glaura Category |
|-|-|-|-|-|
| 1 | ... | ... min | ... € | ... → ... |

### Services to Skip
List all skipped services with reasons.

### Ask the user to:
1. **Provide** phone, address, opening hours
2. **Review category mappings** — flag any that look wrong
3. **Confirm** to proceed with creation

Do NOT ask about read-only data — just show it.

## Phase 4: Create the Profile in Glaura

**NEVER proceed without user confirmation from Phase 3.**

### 4a. Upload Images to Firebase Storage

Download all scraped images and upload to Firebase Storage:

```bash
cd /Users/henryg/Documents/dev/glaura/goglow-firebase/functions && node -e "
const upload = require('./helpers/uploadSalonImages');
const urls = [
  '<IMAGE_URL_1>',
  '<IMAGE_URL_2>',
];
upload('<SALON_SLUG>', urls).then(result => {
  console.log('FIREBASE_IMAGES:', result);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Use the `FIREBASE_IMAGES:` output for `salon_images` in the profile below.

### 4b. Create Service Provider

Before running the profile creation script, resolve `<SP_LOCATION_OR_NULL>`:
- Use any scraped Acuity/account/contact location first, then CRM/user-provided hints.
- If coordinates are missing, geocode the address with `https://api-adresse.data.gouv.fr/search/?limit=1&q=<encoded address>`.
- Use the location object shape from the headless policy when coordinates are known; otherwise use `null` and record a warning.

Use `firebase-admin` called locally via node:

```bash
cd /Users/henryg/Documents/dev/glaura/goglow-firebase/functions && node -e "
const admin = require('firebase-admin');
const crypto = require('crypto');
if (!admin.apps.length) admin.initializeApp({ projectId: 'beauty-984c8' });
const auth = admin.auth();
const db = admin.firestore();

(async () => {
  // Generate credentials
  const businessName = '<SALON_NAME>';
  let base = businessName.toLowerCase().trim().replace(/\\s+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-+/g, '-').replace(/^-+|-+$/g, '') || 'service-provider';
  let username = base;
  let counter = 1;
  while (!(await db.collection('userProfile').where('companyUserName', '==', username).limit(1).get()).empty) {
    username = base + '-' + counter++;
  }

  const generatedEmail = username + '@glaura.fr';
  const generatedPassword = crypto.randomBytes(5).toString('hex');

  // Create Firebase Auth user
  const userRecord = await auth.createUser({
    email: generatedEmail,
    password: generatedPassword,
    displayName: businessName,
    disabled: false,
    emailVerified: true,
  });
  const uid = userRecord.uid;
  console.log('Created auth user:', uid);
  console.log('Email:', generatedEmail);
  console.log('Password:', generatedPassword);

  // Generate search keywords
  const name = '<SALON_NAME>';
  function extractKeywords(...strings) {
    const keywords = new Set();
    strings.forEach(str => {
      if (!str) return;
      const norm = str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      for (let i = 1; i <= norm.length; i++) keywords.add(norm.substring(0, i));
      norm.split(/[\s\-_/().,]+/).forEach(word => {
        if (word.length >= 2) for (let i = 1; i <= word.length; i++) keywords.add(word.substring(0, i));
      });
    });
    return Array.from(keywords).sort();
  }

  const ts = admin.firestore.Timestamp.now();
  await db.collection('userProfile').doc(uid).set({
    id: uid,
    email: generatedEmail,
    name: name,
    companyName: businessName,
    companyUserName: username,
    phone: '<PHONE>',
    countryCode: '+33',
    address: '<ADDRESS>',
    spLocation: <SP_LOCATION_OR_NULL>,
    userRole: 2,
    initialUserRole: 2,
    enable: true,
    isActive: true,
    available: true,
    isSubscribed: true,
    isDeleted: false,
    createdAt: ts,
    updatedAt: ts,
    profileImg: '',
    avg_ratting: 0.0,  // Acuity pages don't have reviews — leave at 0
    total_review: 0,   // Acuity pages don't have reviews — leave at 0
    platform: 'web',
    loginType: 'email',
    salonBio: '<BIO>',
    salon_images: '<COMMA_SEPARATED_IMAGE_URLS>',
    days: [<WORKING_DAY_INDICES>],
    insta: '',
    blockedUsers: [],
    bookmarks: [],
    favoriteCategories: [],
    favoriteServiceProviders: [],
    favoriteServices: [],
    followers: [],
    following: [],
    interests: [],
    recentlyViewed: [],
    searchNameList: extractKeywords(businessName, name, username, base),
  });
  console.log('Created profile:', uid, 'username:', username);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"
```

### 4c. Upload Services

```bash
curl -s -X POST "https://us-central1-beauty-984c8.cloudfunctions.net/uploadServicesFromJSON" \
  -H "Content-Type: application/json" \
  -d @/tmp/services_payload.json
```

The payload format:
```json
{
  "ownerId": "<PROFILE_ID>",
  "services": [
    {
      "service_name": "<name — exact original text>",
      "service_details": "<description — exact original French text>",
      "service_price": 70,
      "duration_minutes": 45,
      "category_id": "<glaura-category-id>",
      "subcategory_name": "<acuity-category-name-normalized>",
      "subcategory_description": ""
    }
  ]
}
```

**Unicode normalization for subcategory names:**
- `𝐅𝐄𝐌𝐌𝐄` → `FEMME` → `Femme`
- `𝐇𝐎𝐌𝐌𝐄` → `HOMME` → `Homme`
- Use NFKD normalization: `name.normalize('NFKD')`

### 4d. Create Agents with Service Mappings

Acuity pages typically don't list staff separately. Create a **single default agent** with the salon name, assigned all services.

After services are created, query Firestore to build the mappings:

```bash
cd /Users/henryg/Documents/dev/glaura/goglow-firebase/functions && node -e "
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'beauty-984c8' });
const db = admin.firestore();

(async () => {
  const ownerId = '<PROFILE_ID>';

  // Get services grouped by subcategory_id
  const servSnap = await db.collection('services').where('ownerId', '==', ownerId).get();
  const subToServices = {};
  const subToCat = {};
  servSnap.forEach(d => {
    const s = d.data();
    if (!subToServices[s.subcategory_id]) subToServices[s.subcategory_id] = [];
    subToServices[s.subcategory_id].push(d.id);
    subToCat[s.subcategory_id] = s.category_id;
  });

  // Build category → subcategories map
  const catSubs = {};
  for (const [subId, catId] of Object.entries(subToCat)) {
    if (!catSubs[catId]) catSubs[catId] = [];
    catSubs[catId].push(subId);
  }

  const salonDays = [<WORKING_DAY_INDICES>];
  const salonTiming = { <DAY_KEY>: [<OPEN_SECONDS>, <CLOSE_SECONDS>] };

  const agentRef = db.collection('agents').doc();
  await agentRef.set({
    id: agentRef.id,
    ownerId: ownerId,
    name: '<SALON_NAME>',
    email: '',
    password: '',
    phoneNumber: '',
    imageUrl: '',
    categorySubcategories: catSubs,
    subcategoryServices: subToServices,
    applyToAllDays: false,
    days: salonDays,
    timing: salonTiming,
    isActive: true,
    isDeleted: false,
    breakTime: [],
    createdAt: admin.firestore.Timestamp.now(),
    acuityBookingUrl: '',
    planityBookingUrl: '',
    assignedProfession: '',
    serviceId: '',
    loginStatus: false,
    loginType: 'email',
    order: 0,
  });
  console.log('Created agent:', agentRef.id, '|', servSnap.size, 'services assigned');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"
```

**Agent working hours:** Convert user-provided hours to **seconds from midnight**: `HH * 3600 + MM * 60`. These represent **UTC time** (France local minus 1h CET / minus 2h CEST).

Day mapping:
- Lundi=1, Mardi=2, Mercredi=3, Jeudi=4, Vendredi=5, Samedi=6, Dimanche=0
- Timing keys: Mon, Tue, Wed, Thu, Fri, Sat, Sun
- Exclude closed days from both `days` array and `timing` object

### 4e. Upload Instagram Reels (optional)

If an Instagram handle was found during scraping, or if the user provides one:

#### Step 1: Discover reels and extract captions

Navigate to the Instagram profile page and extract reel URLs + alt text:

```
mcp__playwright__browser_navigate → https://www.instagram.com/<INSTA_HANDLE>/
```

- Dismiss the cookie consent banner if it appears (click "Decline optional cookies")
- Check if the account is private — if the snapshot contains "This account is private", skip entirely
- From the snapshot, collect all `link` elements with `/reel/` in the URL (up to 12 visible without login)
- Note the alt text of each reel's image — it often contains the caption/title

#### Step 2: Extract full captions for service mapping

For each reel, navigate directly to the reel page to read the full caption:

```
mcp__playwright__browser_navigate → https://www.instagram.com/<INSTA_HANDLE>/reel/<REEL_ID>/
```

From the snapshot, extract the caption text (appears after the username in the post content area). Use the caption to determine which salon service the video showcases.

**Service mapping strategy:**
- Read each caption for keywords matching the salon's service names/subcategories
- Group reels by service — aim for 1-2 videos per service category
- Skip "general" or off-topic reels if better service-specific ones are available
- If a reel doesn't clearly match a service, assign it to the salon's most popular service

#### Step 3: Resolve downloadable MP4 URLs

First try direct public Instagram MP4 extraction from each reel page. This is the
preferred headless path because downloader sites frequently redirect, CAPTCHA, or hang.
Use `mcp__playwright__browser_run_code` on each reel page after the caption is loaded:

```js
async (page) => {
  const reelIds = ['REEL_ID_1', 'REEL_ID_2'];
  const results = {};
  for (const reelId of reelIds) {
    await page.goto(`https://www.instagram.com/<INSTA_HANDLE>/reel/${reelId}/`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await page.waitForTimeout(5000);
    const html = await page.content();
    const endTokens = ['\\u003C', '\\\\u003C', '&lt;', '<', '\\"', '"', "'", '\\n'];
    const urls = [];
    let from = 0;
    while (true) {
      const mp4 = html.indexOf('.mp4', from);
      if (mp4 < 0) break;
      const start = html.lastIndexOf('https:', mp4);
      if (start >= 0) {
        const ends = endTokens.map((token) => html.indexOf(token, mp4)).filter((idx) => idx > mp4);
        const end = ends.length ? Math.min(...ends) : Math.min(html.length, mp4 + 6000);
        let url = html.slice(start, end);
        url = url
          .replaceAll('\\\\/', '/')
          .replaceAll('\\/', '/')
          .replaceAll('&amp;', '&')
          .replaceAll('\\u0026', '&')
          .replaceAll('\\u003d', '=')
          .replaceAll('\\u003D', '=')
          .replaceAll('\\u00253D', '%3D')
          .replaceAll('\\u00252F', '%2F')
          .replaceAll('\\u0025', '%');
        try { url = decodeURIComponent(url); } catch (e) {}
        if (url.startsWith('https://') && url.includes('.mp4') && !urls.includes(url)) urls.push(url);
      }
      from = mp4 + 4;
    }
    const preferred = urls.find((url) => url.includes('progressive') || url.includes('720')) || urls[0] || null;
    results[reelId] = preferred;
  }
  return results;
}
```

If direct extraction returns no MP4 URLs and this is an interactive/manual onboarding,
try SnapInsta as a bounded fallback:

- Use `https://snapinsta.to/en2` or the current Instagram reels downloader page.
- Wait no more than 30 seconds per reel and no more than 90 seconds total.
- If it redirects to a private downloader, CAPTCHA, or fails to return a downloadable
  MP4 URL, record a warning and continue with zero videos instead of blocking.
- In `/onboard-headless`, do not use SnapInsta at all. Skip videos with a warning if
  direct extraction fails.

**Important:** Instagram/SnapInsta download URLs expire quickly. Run the upload
(Step 4) immediately after obtaining URLs.

#### Step 4: Upload videos grouped by service

Query Firestore for the salon's services to get serviceId values, then upload each group:

```bash
cd /Users/henryg/Documents/dev/glaura/goglow-firebase/functions && node -e "
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'beauty-984c8' });
const db = admin.firestore();
const upload = require('./helpers/uploadSalonVideos');

(async () => {
  const ownerId = '<OWNER_ID>';
  const servSnap = await db.collection('services').where('ownerId', '==', ownerId).get();
  const servicesBySubcat = {};
  servSnap.forEach(d => {
    const s = d.data();
    if (!servicesBySubcat[s.subcategory_id]) servicesBySubcat[s.subcategory_id] = { id: d.id, categoryId: s.category_id, slug: s.services_slug };
  });

  // Upload group 1 — mapped to service A
  const result1 = await upload(
    { ownerId, companyUserName: '<USERNAME>', salonName: '<NAME>', profileImg: '', serviceId: '<SERVICE_ID_A>', categoryId: '<CAT_ID>', servicesSlug: '<SLUG>' },
    [
      { url: '<SNAPINSTA_URL_1>', caption: '<CAPTION>', instagramVideoId: '<REEL_ID>' },
    ]
  );
  console.log('Group 1:', JSON.stringify(result1));
  // Repeat for each service group...
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"
```

#### When to skip

- Account is private
- No reels found (all posts are photos/carousels)
- SnapInsta returns errors or CAPTCHAs for all reels
- User explicitly says to skip videos

If no Instagram handle was found during scraping, **ask the user** if they have the salon's Instagram account. If they provide one, use it. If they don't have it or say skip, proceed to Phase 5.

## Phase 5: Verification

After all creation calls succeed:

1. **Display credentials prominently:**
```
═══════════════════════════════════════
  SALON CREDENTIALS (share with owner)
  Email:    <generated>@glaura.fr
  Password: <generated>
═══════════════════════════════════════
```

2. Report summary: profile ID, username, agent count, service count
3. List any services skipped or with errors
4. Verify the profile exists by reading it back:

```bash
cd /Users/henryg/Documents/dev/glaura/goglow-firebase/functions && node -e "
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'beauty-984c8' });
const db = admin.firestore();
(async () => {
  const ownerId = '<PROFILE_ID>';
  const profile = await db.collection('userProfile').doc(ownerId).get();
  const p = profile.data();
  console.log('Name:', p.companyName);
  console.log('Username:', p.companyUserName);

  const services = await db.collection('services').where('ownerId', '==', ownerId).get();
  console.log('Services:', services.size);

  const agents = await db.collection('agents').where('ownerId', '==', ownerId).where('isDeleted', '==', false).get();
  agents.forEach(d => {
    const a = d.data();
    const svcCount = Object.values(a.subcategoryServices || {}).reduce((sum, arr) => sum + arr.length, 0);
    console.log('Agent:', a.name, '|', svcCount, 'services');
  });

  const vids = await db.collection('videos').where('serviceProviderId', '==', ownerId).where('isInstaVideo', '==', true).get();
  console.log('Instagram Videos:', vids.size);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"
```

## Important Notes

- **Acuity pages are minimal** — address, phone, hours, and bio are often missing. Scrape any visible location first, then use CRM/user-provided hints.
- **Always confirm with user before creating** — Phase 3 must get explicit approval
- **Upload images to Firebase Storage** using `helpers/uploadSalonImages.js` — don't hotlink external CDNs
- **Snapshot is the source of truth** — if JS extraction misses services, build the list from snapshot data
- **Never translate service names or descriptions** — use exact original French text
- **Use node with firebase-admin for Firestore writes** — `admin.initializeApp({ projectId: 'beauty-984c8' })` uses local ADC
- **Create services BEFORE agents** — agents need service IDs and subcategory IDs
