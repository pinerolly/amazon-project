require('dotenv').config();

const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

let cachedOrders = [];
let lastScrapeTime = null;
const locationsFile = path.join(__dirname, 'locations.json');
let savedLocations = [];

function loadSavedLocations() {
  try {
    if (fs.existsSync(locationsFile)) {
      const raw = fs.readFileSync(locationsFile, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) savedLocations = parsed.filter(Boolean);
    }
  } catch (e) {
    console.error('Error loading saved locations:', e.message);
    savedLocations = [];
  }
}

function saveSavedLocations() {
  try {
    fs.writeFileSync(locationsFile, JSON.stringify(savedLocations, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving locations:', e.message);
  }
}

loadSavedLocations();

// Normalize location strings to avoid duplicate filters like "MIAMI, FL" vs "MIAMI, FLORIDA"
const stateMap = (() => {
  const map = {};
  const pairs = {
    'ALABAMA':'AL','ALASKA':'AK','ARIZONA':'AZ','ARKANSAS':'AR','CALIFORNIA':'CA','COLORADO':'CO','CONNECTICUT':'CT','DELAWARE':'DE','FLORIDA':'FL','GEORGIA':'GA','HAWAII':'HI','IDAHO':'ID','ILLINOIS':'IL','INDIANA':'IN','IOWA':'IA','KANSAS':'KS','KENTUCKY':'KY','LOUISIANA':'LA','MAINE':'ME','MARYLAND':'MD','MASSACHUSETTS':'MA','MICHIGAN':'MI','MINNESOTA':'MN','MISSISSIPPI':'MS','MISSOURI':'MO','MONTANA':'MT','NEBRASKA':'NE','NEVADA':'NV','NEW HAMPSHIRE':'NH','NEW JERSEY':'NJ','NEW MEXICO':'NM','NEW YORK':'NY','NORTH CAROLINA':'NC','NORTH DAKOTA':'ND','OHIO':'OH','OKLAHOMA':'OK','OREGON':'OR','PENNSYLVANIA':'PA','RHODE ISLAND':'RI','SOUTH CAROLINA':'SC','SOUTH DAKOTA':'SD','TENNESSEE':'TN','TEXAS':'TX','UTAH':'UT','VERMONT':'VT','VIRGINIA':'VA','WASHINGTON':'WA','WEST VIRGINIA':'WV','WISCONSIN':'WI','WYOMING':'WY','DISTRICT OF COLUMBIA':'DC'
  };
  Object.keys(pairs).forEach(full => {
    map[full] = pairs[full];
    map[pairs[full]] = pairs[full];
  });
  return map;
})();

function normalizeLocation(raw) {
  if (!raw || typeof raw !== 'string') return raw;
  let s = raw.trim();
  // collapse whitespace
  s = s.replace(/\s+/g, ' ');
  // split by comma — expect formats like 'City, STATE' or 'City, STATEFULL'
  const parts = s.split(',').map(p => p.trim());
  const city = parts[0] ? parts[0].toUpperCase() : '';
  let state = parts[1] ? parts[1].toUpperCase() : '';
  // remove periods (e.g., 'St.'), normalize full state names to postal codes
  state = state.replace(/\./g, '');
  if (state in stateMap) {
    state = stateMap[state];
  } else {
    // try to match only the last word (handles "FLORIDA" vs "FLORIDA 33101" cases)
    const words = state.split(' ');
    const last = words[words.length - 1];
    if (last in stateMap) state = stateMap[last];
  }
  return state ? `${city}, ${state}` : city;
}

app.use(express.static('public'));
app.use(express.json());

async function scrapeOrders() {
  const authFile = 'auth.json';
  const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
  const headlessMode = process.env.HEADLESS
    ? process.env.HEADLESS.toLowerCase() !== 'false'
    : true;

  const launchOptions = { headless: headlessMode };
  if (browserChannel) launchOptions.channel = browserChannel;

  const browser = await chromium.launch(launchOptions);
  let context;

  try {
    if (fs.existsSync(authFile)) {
      context = await browser.newContext({ storageState: authFile });
    } else {
      context = await browser.newContext();
    }

    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    await page.goto('https://relay.amazon.com/loadboard/orders', { waitUntil: 'domcontentloaded' });

    const continueBtn = page.getByRole('button', { name: 'Continue shopping' });
    if (await continueBtn.isVisible().catch(() => false)) {
      await continueBtn.click();
      await page.waitForTimeout(2000);
    }

    if (await page.locator('input[type="email"]').isVisible().catch(() => false)) {
      await page.fill('input[type="email"]', process.env.AMAZON_EMAIL);
      await page.click('#continue');
      await page.fill('input[type="password"]', process.env.AMAZON_PASSWORD);
      await page.click('#signInSubmit');
      await page.waitForTimeout(3000);
      await context.storageState({ path: authFile });
    }

    await page.goto('https://relay.amazon.com/loadboard/orders', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const expandBtn = page.getByRole('button', { name: 'View all recommended orders' });
    if (await expandBtn.isVisible().catch(() => false)) {
      await expandBtn.click();
      await page.waitForTimeout(3000);
    }

    const orderData = await page.evaluate(() => {
      const orders = [];
      const cards = document.querySelectorAll('#pat-recommendations-listing > div > div > div');

      cards.forEach((card) => {
        const locationEl = card.querySelector('div:nth-child(1) > div:nth-child(1) > div > p.css-13muojn');
        const startTimeEl = card.querySelector('div:nth-child(1) > div:nth-child(2) > div > p');
        const endTimeEl = card.querySelector('div:nth-child(3) > div:nth-child(2) > div > p');
        const distanceEl = card.querySelector('div.css-17jtd1r > div:nth-child(1) > div > p:nth-child(5)');
        const equipmentEl = card.querySelector('div.css-17jtd1r > div:nth-child(1) > div > div > p.css-11m53r7');

        const location = locationEl ? locationEl.textContent.trim() : 'N/A';
        const startRaw = startTimeEl ? startTimeEl.textContent.trim() : 'N/A';
        const endRaw = endTimeEl ? endTimeEl.textContent.trim() : 'N/A';
        const distance = distanceEl ? distanceEl.textContent.trim() : 'N/A';
        const equipment = equipmentEl ? equipmentEl.textContent.trim() : 'N/A';

        const dateMatch = startRaw.match(/\d{2}\/\d{2}/);
        const date = dateMatch ? dateMatch[0] : 'N/A';
        const startTime = startRaw.replace(date, '').trim();
        const endTime = endRaw.replace(date, '').trim();
        const distanceMatch = distance.match(/(\d+)(?:-(\d+))?/);
        const distanceMiles = distanceMatch ? Number(distanceMatch[2] || distanceMatch[1]) : null;

        const parseDateTime = (text, fallbackDate) => {
          const dateMatchLocal = text.match(/(\d{2}\/\d{2})/);
          const timeMatch = text.match(/(\d{2}:\d{2})/);
          const dateToUse = dateMatchLocal ? dateMatchLocal[1] : fallbackDate;
          if (!dateToUse || !timeMatch) return null;

          const [month, day] = dateToUse.split('/').map(v => parseInt(v, 10));
          const [hour, minute] = timeMatch[1].split(':').map(v => parseInt(v, 10));
          const year = new Date().getFullYear();
          return new Date(year, month - 1, day, hour, minute, 0);
        };

        const startDateTime = parseDateTime(startRaw, date);
        const endDateTime = parseDateTime(endRaw, date);
        let duration = 'N/A';
        if (startDateTime && endDateTime) {
          const diffMs = endDateTime - startDateTime;
          if (!Number.isNaN(diffMs) && diffMs >= 0) {
            const diffMinutes = Math.round(diffMs / 60000);
            const days = Math.floor(diffMinutes / 1440);
            const hours = Math.floor((diffMinutes % 1440) / 60);
            const minutes = diffMinutes % 60;
            duration = `${days > 0 ? `${days}d ` : ''}${hours}h ${minutes}m`.trim();
          }
        }

        const legMatch = card.innerText.match(/\b(One-way|Round-trip)\b/i);
        const leg = legMatch ? legMatch[1] : 'N/A';

        if (location !== 'N/A' || startRaw !== 'N/A' || endRaw !== 'N/A') {
          orders.push({
            location,
            date,
            startTime,
            endTime,
            distance,
            distanceMiles,
            equipment,
            duration,
            leg,
            sortKey: startDateTime ? startDateTime.toISOString() : ''
          });
        }
      });

      return orders;
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const dayAfterTomorrow = new Date(tomorrow);
    dayAfterTomorrow.setDate(tomorrow.getDate() + 1);

    const filteredOrderData = orderData
      .filter(order => {
        if (!order.sortKey) return false;
        if (typeof order.distanceMiles !== 'number' || Number.isNaN(order.distanceMiles)) return false;
        if (order.distanceMiles > 500) return false;
        // Exclude equipment types the user doesn't use (e.g. 26')
        if (order.equipment && order.equipment.includes("26'")) return false;
        const orderDate = new Date(order.sortKey);
        return orderDate >= today && orderDate < dayAfterTomorrow;
      })
      .sort((a, b) => {
        if (a.sortKey && b.sortKey) return a.sortKey.localeCompare(b.sortKey);
        return 0;
      });

    await context.close();
    return filteredOrderData;
  } catch (error) {
    console.error('Error scraping orders:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

app.get('/api/locations', (req, res) => {
  // Return union of savedLocations (persisted) and currently scraped locations
  const scraped = [...new Set(cachedOrders.map(order => normalizeLocation(order.location)))]
    .filter(Boolean);
  const unionSet = new Set(savedLocations.concat(scraped).filter(Boolean));
  const locations = Array.from(unionSet).sort();
  res.json(locations);
});

app.get('/api/orders', (req, res) => {
  const { locations } = req.query;
  let filtered = cachedOrders;

  if (locations) {
    let locationList = [];
    try {
      // Client sends a JSON-encoded array for safety (handles commas in names)
      locationList = JSON.parse(locations);
    } catch (e) {
      // Fallback to legacy comma-split (not ideal if names contain commas)
      locationList = locations.split(',').map(loc => loc.trim());
    }
    
      // Normalize requested locations and compare against normalized cached orders
      const normalizedRequested = locationList.map(l => normalizeLocation(l));
      if (!normalizedRequested.includes('all') && normalizedRequested.length > 0) {
        filtered = cachedOrders.filter(order => normalizedRequested.includes(normalizeLocation(order.location)));
    }
  }

  res.json(filtered);
});

app.post('/api/refresh', async (req, res) => {
  try {
    cachedOrders = await scrapeOrders();
    // normalize locations in cached orders so UI and filters stay consistent
    cachedOrders = cachedOrders.map(o => ({ ...o, location: normalizeLocation(o.location) }));
    lastScrapeTime = new Date();
    // Merge scraped locations into savedLocations and persist
    const scraped = [...new Set(cachedOrders.map(order => normalizeLocation(order.location)))]
      .filter(Boolean);
    const beforeCount = savedLocations.length;
    const merged = Array.from(new Set(savedLocations.concat(scraped))).filter(Boolean).sort();
    savedLocations = merged;
    if (savedLocations.length !== beforeCount) saveSavedLocations();

    res.json({ success: true, count: cachedOrders.length, timestamp: lastScrapeTime });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({ ordersCount: cachedOrders.length, lastScrapeTime });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
