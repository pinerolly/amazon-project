require('dotenv').config();

const { chromium } = require('playwright');
const fs = require('fs');
// const path = require('path'); // Commented out - only used for CSV export

const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;
const headlessMode = process.env.HEADLESS
  ? process.env.HEADLESS.toLowerCase() !== 'false'
  : true;

(async () => {
  const authFile = 'auth.json';
  const launchOptions = { headless: headlessMode };
  if (browserChannel) launchOptions.channel = browserChannel;

  const browser = await chromium.launch(launchOptions);
  let context;

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
  today.setHours(0,0,0,0);
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const dayAfterTomorrow = new Date(tomorrow);
  dayAfterTomorrow.setDate(tomorrow.getDate() + 1);

  const filteredOrderData = orderData
    .filter(order => {
      if (!order.sortKey) return false;
      if (typeof order.distanceMiles !== 'number' || Number.isNaN(order.distanceMiles)) return false;
      if (order.distanceMiles > 500) return false;
      const orderDate = new Date(order.sortKey);
      return orderDate >= today && orderDate < dayAfterTomorrow;
    })
    .sort((a, b) => {
      if (a.sortKey && b.sortKey) return a.sortKey.localeCompare(b.sortKey);
      return 0;
    });

  // CSV EXPORT CODE - COMMENTED OUT FOR NOW (keeping for future reference)
  /*
  const csvRows = [
    ['location', 'date', 'startTime', 'distance', 'equipment', 'leg', 'duration'].join(',')
  ];

  filteredOrderData.forEach(order => {
    const escapeCsv = (value) => {
      if (typeof value !== 'string') value = String(value);
      return '"' + value.replace(/"/g, '""') + '"';
    };

    csvRows.push([
      escapeCsv(order.location),
      escapeCsv(order.date),
      escapeCsv(order.startTime),
      escapeCsv(order.distance),
      escapeCsv(order.equipment),
      escapeCsv(order.leg),
      escapeCsv(order.duration)
    ].join(','));
  });

  const csvPath = path.resolve(__dirname, 'order_data.csv');
  fs.writeFileSync(csvPath, csvRows.join('\r\n'), 'utf8');
  console.log(`Saved order_data.csv with order data at: ${csvPath}`);
  */

  await context.close();
  await browser.close();
})();