---
description: Onboard a salon from a Planity page into Glaura (scrape services, agents, images)
argument-hint: <planity-url>
allowed-tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_evaluate, mcp__playwright__browser_take_screenshot, Bash(curl:*,node:*), Read, Write, Glob, Grep, Edit
---

# Onboard Salon from Planity

You are onboarding a salon from a Planity competitor page into Glaura. The user provided this URL: $ARGUMENTS

## Confirmation Policy

- **Phase 1-2 (scraping, images):** Run automatically — NO user confirmation needed. Just do it.
- **Phase 3 (dry run):** Present data, then ask ONLY about:
  - **Category mappings** that may be wrong (user can correct)
  - **Final go/no-go** to proceed with Firestore writes
- **Phase 4 (creation):** Execute all writes after the single Phase 3 confirmation

## Phase 1: Scrape the Planity Page

1. Navigate to the URL using `mcp__playwright__browser_navigate`
2. Save snapshot to file: `mcp__playwright__browser_snapshot` with `filename: /tmp/planity-snapshot.md`
3. **Dismiss the cookie consent banner** — search the snapshot file for "Continuer sans accepter" ref and click it
4. **Expand all hidden services** — search snapshot for `Voir les.*autres prestations` buttons and click every one until none remain. After each click, re-check for new expand buttons.
5. Save a final snapshot to `/tmp/planity-final.md`

### Extract Salon Info (JS evaluation)

Run this to get salon name, phone, address, hours, images:

```js
() => {
  const data = { salon: {}, hours: {}, images: [] };

  // Salon name
  const h1 = document.querySelector('h1');
  data.salon.name = h1 ? h1.textContent.trim() : '';

  // Address
  data.salon.address = '';
  const allText = document.body.innerText;

  // Phone (French format: 0X XX XX XX XX or 0XXXXXXXXX)
  const phoneMatch = allText.match(/0[0-9]\s?\d{2}\s?\d{2}\s?\d{2}\s?\d{2}/);
  data.salon.phone = phoneMatch ? phoneMatch[0] : '';

  // Instagram
  const instaLinks = document.querySelectorAll('a[href*="instagram"]');
  data.salon.instagram = instaLinks.length > 0 ? instaLinks[0].href : '';

  // Images - background images from Cloudinary
  const imageUrls = new Set();
  document.querySelectorAll('*').forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg && bg.includes('cloudinary.com/planity')) {
      const match = bg.match(/url\(["']?(.*?)["']?\)/);
      if (match) imageUrls.add(match[1]);
    }
  });
  document.querySelectorAll('img[src*="cloudinary.com/planity"]').forEach(img => {
    imageUrls.add(img.src);
  });
  data.images = [...imageUrls];

  // Hours
  const dayMap = { 'Lundi': 'Mon', 'Mardi': 'Tue', 'Mercredi': 'Wed', 'Jeudi': 'Thu', 'Vendredi': 'Fri', 'Samedi': 'Sat', 'Dimanche': 'Sun' };
  document.querySelectorAll('li').forEach(li => {
    const text = li.textContent.trim();
    for (const [fr, en] of Object.entries(dayMap)) {
      if (text.startsWith(fr)) {
        const timeMatches = [...text.matchAll(/(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/g)];
        if (timeMatches.length > 0) {
          data.hours[en] = timeMatches.map(m => ({ open: m[1], close: m[2] }));
        } else if (text.includes('Ferm')) {
          data.hours[en] = null;
        }
      }
    }
  });

  // Bio/Presentation
  const presMatch = allText.match(/Présentation\n([\s\S]*?)(?=\nHoraires|\nCollaborat|\nAvis)/);
  data.salon.bio = presMatch ? presMatch[1].trim().substring(0, 1000) : '';

  // Reviews from "Avis" section
  data.reviews = [];
  const reviewSection = allText.match(/Avis\s*\((\d+)\)/);
  data.reviewCount = reviewSection ? parseInt(reviewSection[1]) : 0;

  return data;
}
```

### Extract Services WITH Descriptions (JS evaluation)

This extracts service name, duration, price, Planity category, AND the original French description text. **Never translate descriptions — use the exact original text from Planity.**

```js
() => {
  const services = [];
  const h3s = document.querySelectorAll('h3');

  h3s.forEach(h3 => {
    const category = h3.textContent.trim();
    if (category === 'Contact' || category.length < 2 || category === 'À-propos') return;

    let container = h3.parentElement;
    for (let i = 0; i < 5; i++) {
      if (container.querySelector('ul')) break;
      container = container.parentElement;
      if (!container) break;
    }
    if (!container) return;

    const ul = container.querySelector('ul');
    if (!ul) return;

    ul.querySelectorAll(':scope > li').forEach(item => {
      const leaves = [...item.querySelectorAll('div, span')].filter(el => el.children.length === 0);
      let name = '', duration = '', price = '', description = '';

      for (const leaf of leaves) {
        const t = leaf.textContent.trim();
        if (!t || t === 'Choisir' || t === 'Plus de détails' || t === 'de' || t === 'à' || t.includes('Voir moins') || t.includes('Voir les')) continue;
        if (/^\d+h(\s*\d+min)?$/.test(t) || /^\d+min$/.test(t)) { if (!duration) duration = t; continue; }
        if (/^\d+\s*€$/.test(t) || t === 'Sur devis') { if (!price) price = t; continue; }
        if (t.includes('prestation ne peut pas')) continue;
        if (!name && t.length > 1 && t.length < 200) { name = t; continue; }
        if (name && t.length > 30 && !description) { description = t; continue; }
      }

      if (name && name !== 'Choisir') {
        services.push({ name, duration, price, category, description: description || '' });
      }
    });
  });

  return services;
}
```

### Extract Agents

Agents are found in the snapshot under the "Collaborateurs" section. Search the snapshot file for lines containing agent names — they appear as initials + full name patterns near the bottom of the page. Example from snapshot:
```
SE | Solene Experte estheticienne
TE | Tayna estheticienne
ES | ESPACE SPA BIEN ETRE
```

Do NOT rely on JS extraction for agents — it picks up garbage. Parse the snapshot file instead.

**Important:** The snapshot may only show the first collaborator. Check the Planity page screenshot or the full collaborateurs section to confirm ALL agents are captured.

### Discover Agent-to-Service Mapping

For each main Planity category (subcategory), click "Choisir" on one service from that category. The booking page will show either:
- **"Choisir avec qui ?"** — lists which agents can perform that service
- **"avec <AGENT_NAME>"** — auto-assigned to a single agent (no choice)

Check ALL subcategories, not just a few. Record the mapping:

| Subcategory | Agent 1 | Agent 2 | Agent 3 | ... |
|-|-|-|-|-|

Navigate back to the salon page (`browser_navigate` to the URL) between each check since clicking "Choisir" navigates to the reservation page.

To extract agents from the result, grep for the agent names:
```bash
grep -o 'Sans préférence\|Agent1Name\|Agent2Name\|...' <result-file> | sort -u
```

### Extract Reviews

Navigate to the "Avis" (reviews) section of the Planity page. Reviews are typically shown at the bottom. Click "Voir plus d'avis" buttons to load more reviews if available.

Extract reviews using JS:

```js
() => {
  const reviews = [];
  // Planity reviews appear in a list with rating stars + text + author name
  // Look for review containers near the "Avis" section
  const allText = document.body.innerText;
  const reviewBlocks = allText.match(/Avis[\s\S]*$/);
  if (!reviewBlocks) return reviews;

  // Parse individual reviews from the text — each review has:
  // - A star rating (shown as filled/empty stars or a number)
  // - Review text
  // - Author name
  // - Date
  document.querySelectorAll('[class*="review"], [class*="avis"], [class*="comment"]').forEach(el => {
    const text = el.textContent.trim();
    const stars = el.querySelectorAll('[class*="star"][class*="fill"], [class*="star"][class*="active"], svg[class*="fill"]');
    const rating = stars.length || 5; // default to 5 if can't detect
    
    // Try to find author name and review text
    const parts = text.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    if (parts.length >= 2) {
      reviews.push({
        userName: parts[0].length < 50 ? parts[0] : 'Client',
        review: parts.slice(1).join(' ').substring(0, 500),
        rating: Math.min(rating, 5),
      });
    }
  });
  return reviews;
}
```

**IMPORTANT**: Planity review DOM varies between salons. The JS above is a starting point. **Always cross-reference with the snapshot** — if the JS misses reviews, manually extract them from the snapshot text. Look for patterns like:
- Star rating (number or visual stars)
- Review text
- Author first name
- Date

Collect up to **20 reviews** maximum.

## Phase 2: Get Full-Resolution Images

For each Cloudinary image URL found, strip transforms to get full resolution:
- Original: `https://res.cloudinary.com/planity/image/upload/t_d_main,f_auto/sdykxqa1f1xwe45znfwi`
- Full-res: `https://res.cloudinary.com/planity/image/upload/sdykxqa1f1xwe45znfwi`
- Also strip crop params like `c_crop,w_4032,h_2399,x_0,y_312/`

## Phase 3: Present Data for Review (DRY RUN)

Present extracted data in tables. Show the **complete mapping** before creating anything:

### Category Mapping Table

Show each Planity category → Glaura category + subcategory name, with service count.

### Agent-to-Subcategory Mapping Table

Show which agents handle which subcategories (from Phase 1 discovery).

### Services to Skip

List all skipped services with reasons.

### Reviews Scraped
| # | Author | Rating | Review (truncated) |
|-|-|-|-|
| 1 | ... | 5/5 | ... |

If no reviews were found, note "No reviews found on Planity page."

### Ask the user to:
1. **Review category mappings** — flag any that look wrong
2. **Confirm** to proceed with creation

Do NOT ask about agent mappings or other read-only data — just show it. **Email and password will be auto-generated** — no need to ask.

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

**Map each Planity category heading as a Glaura subcategory** under the best-fit Glaura category. This preserves the salon's own grouping logic. Common mappings:
- Face treatments / peeling / microneedling / anti-âge / regard → **Beauté visage**
- Body treatments / body contouring → **Bien Etre**
- Massage / spa / sauna → **Bien Etre**
- Mariage packs → **Bien Etre**
- Prestations homme → **Bien Etre** (NOT Barber — these are beauty institute services, not barbershop)
- Épilation / cire → **Epilation**
- Onglerie / mains / pieds → **Nails**
- Coiffure → **Coiffure**
- Maquillage → **Makeup**

### Services to Always Skip

- **Carte cadeau** — gift cards, not real services (skip in ANY category)
- **"Choisir à l'institut"** — placeholder
- **"Devenir modèle"** — discounted promo services
- **"Coaching" / "RDV diagnostic" / "Suivi contrôle"** — consultations
- **"Packs"** with "Sur devis" pricing — combo packs without fixed price

### Service Description Rules

- **Never translate descriptions** — use the exact original French text from Planity
- **Keep service names exactly as on Planity** (original spacing, punctuation, accents)
- If `price === "Sur devis"`, set `service_price: 0` and prepend "Prix sur devis. " to `service_details`

## Phase 4: Create the Profile in Glaura

**NEVER proceed without user confirmation from Phase 3.**

### 4a. Upload Images to Firebase Storage

Before creating the profile, download all scraped images and upload them to Firebase Storage so Glaura owns them:

```bash
cd /Users/henryg/Documents/dev/glaura/goglow-firebase/functions && node -e "
const upload = require('./helpers/uploadSalonImages');
const urls = [
  '<IMAGE_URL_1>',
  '<IMAGE_URL_2>',
];
upload('<OWNER_ID_PLACEHOLDER>', urls).then(result => {
  console.log('FIREBASE_IMAGES:', result);
  process.exit(0);
}).catch(e => { console.error(e); process.exit(1); });
"
```

Use a temporary placeholder for owner ID (e.g., the salon slug). The output `FIREBASE_IMAGES:` line contains comma-separated Firebase Storage URLs — use these for `salon_images` in the profile below.

### 4b. Create Service Provider

Before running the profile creation script, resolve `<SP_LOCATION_OR_NULL>`:
- Use the scraped Planity address when available.
- If coordinates are missing, geocode the address with `https://api-adresse.data.gouv.fr/search/?limit=1&q=<encoded address>`.
- Use the location object shape from the headless policy when coordinates are known; otherwise use `null` and record a warning.

Use `firebase-admin` called locally via node (NOT via HTTP — avoids auth token requirement):

```bash
cd /Users/henryg/Documents/dev/glaura/goglow-firebase/functions && node -e "
const admin = require('firebase-admin');
const crypto = require('crypto');
if (!admin.apps.length) admin.initializeApp({ projectId: 'beauty-984c8' });
const auth = admin.auth();
const db = admin.firestore();

(async () => {
  // Generate credentials
  const name = '<SALON_NAME>';
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
    avg_ratting: <SCRAPED_AVG_RATING>,  // Use real average from scraped reviews, or 0.0 if none
    total_review: <SCRAPED_REVIEW_COUNT>,  // Use real count from scraped reviews, or 0 if none
    platform: 'web',
    loginType: 'email',
    salonBio: '<BIO>',
    salon_images: '<COMMA_SEPARATED_IMAGE_URLS>',
    days: [<WORKING_DAY_INDICES>],  // 0=Sun,1=Mon,...,6=Sat
    insta: '<INSTAGRAM>',
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

**Credentials are auto-generated**: email = `<username>@glaura.fr`, password = random 10-char hex string. Both are displayed in Phase 5.

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
      "service_name": "<name — exact original text from Planity>",
      "service_details": "<description — exact original French text>",
      "service_price": 70,
      "duration_minutes": 45,
      "category_id": "<glaura-category-id>",
      "subcategory_name": "<planity-category-heading>",
      "subcategory_description": ""
    }
  ]
}
```

**Price parsing rules:**
- `"70 €"` → `70`
- `"Sur devis"` → `0` (add "Prix sur devis" to service_details)
- `"de 70 € à 120 €"` → `70` (add "70-120€" to service_details)

**Duration parsing rules:**
- `"45min"` → `45`
- `"1h"` → `60`
- `"1h 30min"` → `90`
- `"2h 10min"` → `130`

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

**Step 2:** Build per-agent `categorySubcategories` and `subcategoryServices` maps using the agent-to-subcategory mapping from Phase 1:

```js
// categorySubcategories: { category_id: [subcategory_ids] }
// subcategoryServices: { subcategory_id: [service_ids] }
```

**Step 3:** Create agents directly in Firestore (not via HTTP — gives full control over the document):

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
  categorySubcategories: catSubs,    // from step 2
  subcategoryServices: subServs,      // from step 2
  applyToAllDays: false,
  days: salonDays,       // e.g. [2,3,4,5,6] for Tue-Sat — match salon profile
  timing: salonTiming,   // e.g. { Tue: [34200, 70200], ... } — seconds from midnight, match salon profile
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

**Agent working hours:** Set `days` and `timing` on agents to match the salon's opening hours. The salon profile stores timing as Unix timestamps, but agents use **seconds from midnight**. To convert: `unixTimestamp % 86400` gives seconds from midnight. These seconds represent **UTC time**, which is France local time minus 1 hour (CET) or minus 2 hours (CEST). For example, `34200` = 09:30 UTC = 10:30 France time. Copy the exact same values for all agents — they should match the salon.

Day mapping:
- French → index: Lundi=1, Mardi=2, Mercredi=3, Jeudi=4, Vendredi=5, Samedi=6, Dimanche=0
- French → timing key: Lundi=Mon, Mardi=Tue, Mercredi=Wed, Jeudi=Thu, Vendredi=Fri, Samedi=Sat, Dimanche=Sun
- Exclude closed days from both `days` array and `timing` object

### 4e. Upload Instagram Reels (optional)

If an Instagram handle was found during scraping (`data.salon.instagram`), or if the user provides one:

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

Use `mcp__playwright__browser_run_code` to process all reels in one batch. This is much faster than navigating one by one:

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

  // Get services grouped by subcategory
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
      // ... more videos for this service
    ]
  );
  console.log('Group 1:', JSON.stringify(result1));

  // Upload group 2 — mapped to service B (repeat for each service group)
  // ...

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

2. Report summary: profile ID, username, agent count, service count
2. List any services skipped or with errors
3. Show agent summary: name, number of subcategories, number of services assigned
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

- **Never proceed with creation without user confirmation** (Phase 3 must get explicit approval)
- **Always do a dry run first** — present the full mapping before creating anything
- **Never translate service names or descriptions** — use exact original French text from Planity
- **Upload images to Firebase Storage** using `helpers/uploadSalonImages.js` — don't hotlink external CDNs
- **Use node with firebase-admin for Firestore writes** — `admin.initializeApp({ projectId: 'beauty-984c8' })` uses local Application Default Credentials
- **Services store `subcategory_id`** (not `subcategory_name`) — the `uploadServicesFromJSON` function handles the mapping
- **Agent service mappings use IDs** — `categorySubcategories: { category_id: [subcategory_ids] }` and `subcategoryServices: { subcategory_id: [service_ids] }`
- **Create services BEFORE agents** — agents need service IDs and subcategory IDs which are created by `uploadServicesFromJSON`
- **Check ALL subcategories for agent mapping** — don't skip any, even if there's only 1 service
- **Snapshot files can be huge** — save to file with `filename` param, then grep for specific data instead of reading the whole thing
- **Prestations homme → Bien Etre** — beauty institute homme services are NOT barber services
- **When re-onboarding** (account exists), delete old services first, then recreate. Also clean up stale subcategories.
