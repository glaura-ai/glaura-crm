---
description: Onboard a salon from a Treatwell page into Glaura
argument-hint: <treatwell-url>
allowed-tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_evaluate, mcp__playwright__browser_take_screenshot, Bash(curl:*,node:*), Read, Write, Glob, Grep, Edit
---

# Onboard Salon from Treatwell

You are onboarding a salon from a Treatwell page into Glaura. The user provided this URL: $ARGUMENTS

## Confirmation Policy

- **Phase 1-2 (scraping, images):** Run automatically — NO user confirmation needed. Just do it.
- **Phase 3 (dry run):** Present data, then ask ONLY about:
  - **Category mappings** that may be wrong (user can correct)
  - **Final go/no-go** to proceed with Firestore writes
- **Phase 4 (creation):** Execute all writes after the single Phase 3 confirmation

## Phase 1: Scrape the Treatwell Page

1. Navigate to the URL using `mcp__playwright__browser_navigate`
2. Take a snapshot to see the page structure
3. **Dismiss the cookie banner** — click "Autoriser tous les cookies" or equivalent
4. **Expand ALL service categories** — click each category in the sidebar to reveal its services. Categories appear as clickable items with service counts like `"Massage Classique (10)"`. Click each one and snapshot to capture the services.

5. Extract structured data using `mcp__playwright__browser_evaluate`:

```js
() => {
  const data = { salon: {}, hours: {}, agents: [], services: [], images: [], categories: [] };

  // Salon name
  const h1 = document.querySelector('h1');
  data.salon.name = h1 ? h1.textContent.trim() : '';

  // Address
  const addressEls = document.querySelectorAll('[class*="address"], [class*="location"]');
  const addressParts = [];
  addressEls.forEach(el => {
    const text = el.textContent.trim();
    if (text && text.length < 200) addressParts.push(text);
  });
  data.salon.address = addressParts.join(', ');

  // Rating
  const ratingEl = document.querySelector('[class*="rating"]');
  data.salon.rating = ratingEl ? ratingEl.textContent.trim() : '';

  // Images - Treatwell CDN
  document.querySelectorAll('img').forEach(img => {
    const src = img.src || '';
    const alt = img.alt || '';
    if (src.includes('cdn1.treatwell.net') && alt.includes(data.salon.name.split(' ')[0])) {
      data.images.push(src);
    }
  });

  // Hours - parse from the hours section
  const dayMap = { 'Lundi': 'Mon', 'Mardi': 'Tue', 'Mercredi': 'Wed', 'Jeudi': 'Thu', 'Vendredi': 'Fri', 'Samedi': 'Sat', 'Dimanche': 'Sun' };
  const allText = document.body.innerText;
  for (const [fr, en] of Object.entries(dayMap)) {
    const regex = new RegExp(fr + '\\s*(\\d{1,2}:\\d{2})\\s*[–-]\\s*(\\d{1,2}:\\d{2})', 'i');
    const match = allText.match(regex);
    if (match) {
      data.hours[en] = { open: match[1], close: match[2] };
    } else if (allText.match(new RegExp(fr + '\\s*Ferm', 'i'))) {
      data.hours[en] = null;
    }
  }

  // Team/Agents - from "Rencontrez l'équipe" section
  document.querySelectorAll('[role="tab"]').forEach(tab => {
    const headings = tab.querySelectorAll('h3');
    headings.forEach(h => {
      const name = h.textContent.trim();
      if (name && name !== 'Prestations') data.agents.push({ name });
    });
  });

  // Bio
  const aboutSection = document.querySelector('[class*="about"]');
  data.salon.bio = aboutSection ? aboutSection.textContent.trim().substring(0, 2000) : '';

  // Reviews
  data.reviews = [];
  document.querySelectorAll('[class*="review-item"], [class*="ReviewCard"], [class*="review_card"]').forEach(el => {
    const text = el.textContent.trim();
    const ratingEl = el.querySelector('[class*="rating"], [class*="star"]');
    const rating = ratingEl ? parseFloat(ratingEl.textContent) || 5 : 5;
    const parts = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (parts.length >= 2) {
      data.reviews.push({
        userName: parts[0].length < 50 ? parts[0] : 'Client',
        review: parts.slice(1).join(' ').substring(0, 500),
        rating: Math.min(rating, 5),
      });
    }
  });

  return data;
}
```

6. **Extract services by clicking each category**. Treatwell groups services into collapsible categories. For each category in the sidebar:
   - Click the category name
   - Snapshot the expanded service list
   - Parse: service name, duration, price from the list items

### Treatwell service item format:
- **Name**: First text block in the item
- **Duration**: `"30 min"`, `"1 h"`, `"1 h - 2 h"` (range = take first value), `"1 h 30 min"`
- **Price**: `"50 €"`, `"à partir de 67,50 €"` (take the "à partir de" value), `"Économisez jusqu'à 10%"` (ignore discount text)

**IMPORTANT**: The JS extraction is a starting point. After running it, **always cross-reference against the snapshot**. The snapshot is the source of truth. If services are missing, manually build the list from snapshot data.

### Treatwell-specific parsing rules

**Duration format**:
- `"30 min"` → 30
- `"1 h"` → 60
- `"1 h 30 min"` → 90
- `"2 h"` → 120
- `"1 h - 2 h"` → 60 (take minimum for booking purposes)
- `"1 h 55 min"` → 115

**Price format**:
- `"50 €"` → 50
- `"67,50 €"` → 68 (round to nearest integer)
- `"à partir de 76,50 €"` → 77

**Images**: Treatwell CDN URLs have format `https://cdn1.treatwell.net/images/view/v2.iNNNNNNN.wXXXX.hYYYY.xHASH/`
- To get higher resolution: increase w and h values (e.g., `.w1920.h1280.`)
- To get original: try removing w/h params or use very large values

### Extract Reviews

Treatwell shows reviews on the salon page. Scroll down or navigate to the reviews section. The JS above attempts to extract them, but **always cross-reference with the snapshot**.

If the JS extraction missed reviews, navigate to the reviews tab/section and extract manually from the snapshot. Look for:
- Star rating (number like "4.5" or visual stars)
- Review text
- Author first name
- Date

Collect up to **20 reviews** maximum.

**IMPORTANT**: The scraped Treatwell rating should be used for `avg_ratting` on the profile — do NOT hardcode 0.0.

## Phase 2: Get Full-Resolution Images

For each Treatwell CDN image:
- Replace `.w1080.h720.` with `.w1920.h1280.` for higher resolution
- Verify with `curl -sI <url>`

## Phase 3: Present Data for Review (DRY RUN)

Present extracted data in tables. Show the **complete mapping** before creating anything:

### Salon Info
| Field | Value |
|-|-|
| Name | ... |
| Address | ... |
| Phone | (if found, otherwise "Not found — will ask") |
| Rating | ... |
| Bio | (first 200 chars)... |
| Images | X photos found |

### Opening Hours
| Day | Hours |
|-|-|
| Mon | HH:MM - HH:MM |
| Tue | Closed |
| ... | ... |

### Category Mapping Table

Show each Treatwell category → Glaura category + subcategory name, with service count.

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

**Map each Treatwell category heading as a Glaura subcategory** under the best-fit Glaura category:
- Face treatments / peeling / microneedling / anti-âge / regard → **Beauté visage**
- Body treatments / body contouring → **Bien Etre**
- Massage / spa / sauna → **Bien Etre**
- Mariage packs → **Bien Etre**
- Prestations homme → **Bien Etre** (NOT Barber — these are beauty institute services)
- Épilation / cire → **Epilation**
- Onglerie / mains / pieds → **Nails**
- Coiffure → **Coiffure**
- Maquillage → **Makeup**

### Services to Always Skip
- **Carte cadeau** — gift cards, not real services
- **"Choisir à l'institut"** — placeholder
- **"Devenir modèle"** — discounted promo services
- **"Coaching" / "RDV diagnostic" / "Suivi contrôle"** — consultations
- **"Packs"** with "Sur devis" pricing — combo packs without fixed price

### Service Description Rules
- **Never translate descriptions** — use the exact original French text from Treatwell
- **Keep service names exactly as on Treatwell** (original spacing, punctuation, accents)
- If `price === "Sur devis"`, set `service_price: 0` and prepend "Prix sur devis. " to `service_details`

### Team (Agents)
| Name |
|-|
| ... |

**Note on Treatwell agents**: Often shown as generic names ("Employé 1", "Employé 2"). If agents look generic, ask the user if they know real names. If not, use the salon name as a single agent.

### Agent-to-Service Mapping
- If all agents are generic → assign all services to all agents
- If agents have clear specialties (visible on page) → map accordingly
- Otherwise ask user: "Which agents handle which service categories?"

### Services (grouped by category)
| # | Service | Duration | Price | Category → Glaura Category |
|-|-|-|-|-|
| 1 | ... | ... min | ... € | ... → ... |

### Services to Skip
List all skipped services with reasons.

### Reviews Scraped
| # | Author | Rating | Review (truncated) |
|-|-|-|-|
| 1 | ... | 5/5 | ... |

If no reviews were found, note "No reviews found on Treatwell page."

### Ask the user to:
1. **Review category mappings** — flag any that look wrong
2. **Provide phone number** if not found on page
3. **Confirm** to proceed with creation

Do NOT ask about agent mappings or other read-only data — just show it. **Email and password will be auto-generated** — no need to ask.

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
- Use the scraped Treatwell address when available.
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
    avg_ratting: <SCRAPED_AVG_RATING>,  // Use real average from scraped reviews/rating, or 0.0 if none
    total_review: <SCRAPED_REVIEW_COUNT>,  // Use real count from scraped reviews, or 0 if none
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

Call `uploadServicesFromJSON` via HTTP. Build the payload as a JSON file first, then POST it:

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
      "service_name": "<name — exact original text from Treatwell>",
      "service_details": "<description — exact original French text>",
      "service_price": 70,
      "duration_minutes": 45,
      "category_id": "<glaura-category-id>",
      "subcategory_name": "<treatwell-category-heading>",
      "subcategory_description": ""
    }
  ]
}
```

### 4d. Create Agents with Service Mappings

After services are created, create agents with proper service-to-agent mappings.

**Step 1:** Query Firestore to get all service IDs and subcategory IDs for the owner:

```js
// Get services grouped by subcategory_id
const servSnap = await db.collection('services').where('ownerId', '==', ownerId).get();
const subToServices = {};  // subcategory_id -> [service_ids]
const subToCat = {};       // subcategory_id -> category_id
servSnap.forEach(d => {
  const s = d.data();
  if (!subToServices[s.subcategory_id]) subToServices[s.subcategory_id] = [];
  subToServices[s.subcategory_id].push(d.id);
  subToCat[s.subcategory_id] = s.category_id;
});
```

**Step 2:** Build per-agent `categorySubcategories` and `subcategoryServices` maps:

```js
// categorySubcategories: { category_id: [subcategory_ids] }
// subcategoryServices: { subcategory_id: [service_ids] }
```

If all agents get all services, each agent gets the full maps. If agents have specialties, filter by the mapped subcategories.

**Step 3:** Create agents directly in Firestore:

```js
const agentRef = db.collection('agents').doc();
await agentRef.set({
  id: agentRef.id,
  ownerId: ownerId,
  name: '<AGENT_NAME>',
  email: '',
  password: '',
  phoneNumber: '',
  imageUrl: '',
  categorySubcategories: catSubs,
  subcategoryServices: subServs,
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
  order: <0-based-index>,
});
```

**Agent working hours:** Set `days` and `timing` on agents to match the salon's opening hours. Convert hours to **seconds from midnight**: `HH:MM` → `HH * 3600 + MM * 60`. These represent **UTC time** (France local minus 1h CET / minus 2h CEST).

Day mapping:
- French → index: Lundi=1, Mardi=2, Mercredi=3, Jeudi=4, Vendredi=5, Samedi=6, Dimanche=0
- French → timing key: Lundi=Mon, Mardi=Tue, Mercredi=Wed, Jeudi=Thu, Vendredi=Fri, Samedi=Sat, Dimanche=Sun
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

#### Step 3: Batch-download via SnapInsta

Use `mcp__playwright__browser_run_code` to process all reels in one batch:

```js
async (page) => {
  const reelIds = ['REEL_ID_1', 'REEL_ID_2', ...];
  const results = {};

  for (const reelId of reelIds) {
    const url = `https://www.instagram.com/<INSTA_HANDLE>/reel/${reelId}/`;
    await page.goto('https://snapinsta.to/en2');
    await page.waitForSelector('input[type="text"], input[name="url"], [placeholder*="URL"]', { timeout: 10000 });
    const input = page.getByRole('textbox', { name: 'Paste URL Instagram' });
    await input.fill(url);
    await page.getByRole('button', { name: 'Download' }).click();

    try {
      const downloadLink = await page.waitForSelector('a[href*="snapcdn.app"]', { timeout: 30000 });
      results[reelId] = await downloadLink.getAttribute('href');
    } catch (e) {
      try {
        await page.getByRole('button', { name: 'Close' }).click({ timeout: 3000 });
        const downloadLink = await page.waitForSelector('a[href*="snapcdn.app"]', { timeout: 10000 });
        results[reelId] = await downloadLink.getAttribute('href');
      } catch (e2) {
        results[reelId] = null; // skip this reel
      }
    }
    await page.waitForTimeout(2000);
  }
  return results;
}
```

**Important:** SnapInsta download URLs contain JWT tokens that expire in ~1 hour. Run the upload (Step 4) immediately after obtaining URLs.

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

### 4f. Write Reviews to Firestore

If reviews were scraped in Phase 1, write them to the `userProfile/{uid}/reviews` subcollection:

```bash
cd /Users/henryg/Documents/dev/glaura/goglow-firebase/functions && node -e "
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'beauty-984c8' });
const db = admin.firestore();

(async () => {
  const ownerId = '<PROFILE_ID>';
  const reviews = [
    // One object per scraped review:
    { userName: '<AUTHOR>', review: '<REVIEW_TEXT>', ratting: <RATING_NUMBER>, userImage: '', userid: '', jobId: '', serviceId: '', serviceName: '' },
  ];

  const batch = db.batch();
  for (const r of reviews) {
    const ref = db.collection('userProfile').doc(ownerId).collection('reviews').doc();
    batch.set(ref, {
      id: ref.id,
      userName: r.userName,
      review: r.review,
      ratting: r.ratting,  // Note: field name is 'ratting' (matches mobile app model)
      userImage: r.userImage || '',
      userid: r.userid || '',
      jobId: r.jobId || '',
      serviceId: r.serviceId || '',
      serviceName: r.serviceName || '',
      createdAt: admin.firestore.Timestamp.now(),
    });
  }
  await batch.commit();
  console.log('Written', reviews.length, 'reviews to userProfile/' + ownerId + '/reviews');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"
```

Skip this step if no reviews were scraped.

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

2. Report summary: profile ID, username, agent count, service count, **review count**
3. List any services skipped or with errors
4. Show agent summary: name, number of subcategories, number of services assigned
5. Verify the profile exists by reading it back:

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

- **Never proceed without user confirmation** — Phase 3 must get explicit approval
- **Treatwell agent names are often generic** ("Employé 1") — ask user for real names
- **Upload images to Firebase Storage** using `helpers/uploadSalonImages.js` — don't hotlink external CDNs
- **Snapshot is the source of truth** — if JS extraction misses services, build the list from snapshot data
- **Treatwell has LOTS of services** behind category tabs — make sure to click and expand ALL categories before presenting to user
- **Never translate service names or descriptions** — use exact original French text
- **Use node with firebase-admin for Firestore writes** — `admin.initializeApp({ projectId: 'beauty-984c8' })` uses local Application Default Credentials
- **Create services BEFORE agents** — agents need service IDs and subcategory IDs
- **Prestations homme → Bien Etre** — beauty institute homme services are NOT barber services
