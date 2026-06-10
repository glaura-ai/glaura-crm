---
description: Onboard a salon from any website into Glaura (generic scraper)
argument-hint: <website-url>
allowed-tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_evaluate, mcp__playwright__browser_take_screenshot, Bash(curl:*,node:*), Read, Write, Glob, Grep, Edit
---

# Onboard Salon from Website (Generic)

You are onboarding a salon from a website into Glaura. The user provided this URL: $ARGUMENTS

This is a **generic scraper** — the website could be anything. Use your judgment to find and extract salon data.

## Confirmation Policy

- **Phase 1-2 (scraping, images):** Run automatically — NO user confirmation needed. Just do it.
- **Phase 3 (dry run):** Present data, then ask ONLY about:
  - **Category mappings** that may be wrong (user can correct)
  - **Missing info** (phone, address, hours if not found)
  - **Final go/no-go** to proceed with Firestore writes
- **Phase 4 (creation):** Execute all writes after the single Phase 3 confirmation

## Phase 1: Explore the Website

1. Navigate to the URL using `mcp__playwright__browser_navigate`
2. Take a snapshot and screenshot to understand the page structure
3. **Dismiss cookie banners** — look for common patterns: "Accepter", "Accept all", "Continuer sans accepter", "OK", "J'accepte"

### Find salon info
Look for:
- **Name**: h1, title tag, logo text
- **Address**: footer, contact page, "Nous trouver", Google Maps embed
- **Phone**: footer, contact page, tel: links, French format (0X XX XX XX XX)
- **Hours**: "Horaires", "Opening hours", footer, sidebar
- **Instagram**: links containing "instagram.com"
- **Bio/Description**: "À propos", "About", "Présentation" section
- **Images**: gallery, hero images, about section images. Collect high-res URLs.

### Find services
Look for service/pricing pages by clicking navigation links like:
- "Services", "Prestations", "Nos soins", "Tarifs", "Prix", "Carte", "Menu"
- "Coiffure", "Beauté", "Massage", "Épilation", etc.

For each service, extract:
- **Name**: exact text as on the page
- **Duration**: look for "min", "h", "heure", "minutes"
- **Price**: look for "€", numbers near service names
- **Category**: the heading/section the service is grouped under
- **Description**: any text below the service name

### Find team/agents
Look for:
- "L'équipe", "Notre équipe", "Team", "Collaborateurs", "Nos experts"
- Staff photos with names

### Find reviews
Look for:
- "Avis", "Reviews", "Témoignages", "Ce que nos clients disent"
- Google Reviews widget, embedded review sections
- Star ratings with text

For each review, extract: author name, rating (1-5), review text. Collect up to **20 reviews**.

### Check for booking widgets
Note if the site uses an embedded booking system:
- Calendly, SimplyBook, Planity widget, Treatwell widget, Acuity embed, Booksy, Fresha
- If found, note the platform and URL — might be scraped separately with a specialized skill

## Phase 2: Get Full-Resolution Images

For each image found:
- If it has resize parameters in the URL (w=, h=, width=, size=), try removing them
- If it's a CDN URL with transforms, strip the transforms
- Verify with `curl -sI <url>` that the URL returns 200

## Phase 3: Present Data for Review (DRY RUN)

Present everything found with **confidence indicators**:

### Salon Info
| Field | Value | Confidence |
|-|-|-|
| Name | ... | Found in h1 |
| Address | ... | Found in footer |
| Phone | ... | Found in contact page |
| Hours | ... | Not found — please provide |
| Bio | (first 200 chars)... | Found in about section |
| Images | X photos found | ... |

### Opening Hours (if found)
| Day | Hours |
|-|-|
| Mon | HH:MM - HH:MM |
| ... | ... |

### Category Mapping Table

Show each website category → Glaura category + subcategory name, with service count.

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

**Map each website category as a Glaura subcategory** under the best-fit Glaura category:
- Face treatments / peeling / microneedling / anti-âge / regard → **Beauté visage**
- Body treatments / body contouring → **Bien Etre**
- Massage / spa / sauna → **Bien Etre**
- Prestations homme → **Bien Etre** (NOT Barber — these are beauty institute services)
- Épilation / cire → **Epilation**
- Onglerie / mains / pieds → **Nails**
- Coiffure → **Coiffure**
- Maquillage → **Makeup**

### Services to Always Skip
- **Carte cadeau** — gift cards, not real services
- **"Coaching" / "RDV diagnostic" / "Suivi contrôle"** — consultations

### Service Description Rules
- **Never translate descriptions** — use the exact original text from the website
- **Keep service names exactly as found** (original spacing, punctuation, accents)
- If no price found, set `service_price: 0` and add "Prix sur demande" to `service_details`
- If no duration found, set `duration_minutes: 30` as default and note it

### Services (grouped by category)
| # | Service | Duration | Price | Category → Glaura Category |
|-|-|-|-|-|
| 1 | ... | ... min | ... € | ... → ... |

### Missing Information

Clearly list what's missing and needs user input:
- Address (if not found)
- Phone (if not found)
- Opening hours (if not found)
- Agent names (if team not found)
- Service durations (if not on site)
- Service prices (if not on site)

### Reviews Scraped
| # | Author | Rating | Review (truncated) |
|-|-|-|-|
| 1 | ... | 5/5 | ... |

If no reviews were found, note "No reviews found on the website."

### Ask the user to:
1. **Provide** any missing information (phone, address, hours)
2. **Review category mappings** — flag any that look wrong
3. **Confirm** to proceed with creation

Do NOT ask about read-only data — just show it. **Email and password will be auto-generated** — no need to ask.

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

### 4b. Resolve Address Location

Before creating `userProfile`, resolve an address location:
- Prefer the scraped address from the website or contact/map pages.
- If an address exists but coordinates are missing, geocode it with:
  `https://api-adresse.data.gouv.fr/search/?limit=1&q=<encoded address>`
- Replace `<SP_LOCATION_OR_NULL>` with:
  ```js
  {
    formatted_address: '<ADDRESS>',
    name: '<ADDRESS>',
    place_id: '',
    geometry: { location: { lat: <LAT>, lng: <LNG> } },
    latitude: <LAT>,
    longitude: <LNG>,
  }
  ```
  Use `null` only if no coordinates can be resolved.

Use the `FIREBASE_IMAGES:` output for `salon_images` in the profile below.

### 4c. Create Service Provider

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
    avg_ratting: <SCRAPED_AVG_RATING>,  // Use real average from scraped reviews, or 0.0 if none
    total_review: <SCRAPED_REVIEW_COUNT>,  // Use real count from scraped reviews, or 0 if none
    platform: 'web',
    loginType: 'email',
    salonBio: '<BIO>',
    salon_images: '<COMMA_SEPARATED_IMAGE_URLS>',
    days: [<WORKING_DAY_INDICES>],
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
      "service_details": "<description — exact original text>",
      "service_price": 70,
      "duration_minutes": 45,
      "category_id": "<glaura-category-id>",
      "subcategory_name": "<website-category-heading>",
      "subcategory_description": ""
    }
  ]
}
```

### 4d. Create Agents with Service Mappings

If team members were found, create one agent per member. If no team found, create a single agent with the salon name.

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

  const agents = [<AGENT_NAMES_ARRAY>]; // e.g. ['Salon Name'] or ['Marie', 'Julie']

  for (let i = 0; i < agents.length; i++) {
    const agentRef = db.collection('agents').doc();
    await agentRef.set({
      id: agentRef.id,
      ownerId: ownerId,
      name: agents[i],
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
      order: i,
    });
    console.log('Created agent:', agentRef.id, agents[i]);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
"
```

**Agent working hours:** Convert hours to **seconds from midnight**: `HH * 3600 + MM * 60`. These represent **UTC time** (France local minus 1h CET / minus 2h CEST).

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
    { userName: '<AUTHOR>', review: '<REVIEW_TEXT>', ratting: <RATING_NUMBER>, userImage: '', userid: '', jobId: '', serviceId: '', serviceName: '' },
  ];

  const batch = db.batch();
  for (const r of reviews) {
    const ref = db.collection('userProfile').doc(ownerId).collection('reviews').doc();
    batch.set(ref, {
      id: ref.id,
      userName: r.userName,
      review: r.review,
      ratting: r.ratting,
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

- **Generic scraping is best-effort** — some sites won't have all data. Always tell the user what's missing.
- **Never proceed without user confirmation** — Phase 3 must get explicit approval
- **Never translate service names or descriptions** — use exact original text
- **Use node with firebase-admin for Firestore writes** — `admin.initializeApp({ projectId: 'beauty-984c8' })` uses local ADC
- **Create services BEFORE agents** — agents need service IDs and subcategory IDs
- **If a booking widget is detected**, suggest using the specialized skill for that platform instead
