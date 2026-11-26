import { chromium } from 'playwright';

/**
 * Example demonstrating how to connect Playwright to OpenBrowserGrid over CDP.
 * Run OpenBrowserGrid first: npm run dev
 * Then run this script: npx tsx examples/playwright-demo.ts
 */
async function main() {
  console.log('Connecting to OpenBrowserGrid at ws://localhost:3000/connect ...');

  // Connect to the remote self-hosted browser grid
  const browser = await chromium.connectOverCDP('ws://localhost:3000/connect');
  console.log('Connected! Creating new page context...');

  const context = browser.contexts()[0] || await browser.newContext();
  const page = await context.newPage();

  console.log('Navigating to Hacker News (check http://localhost:3000 to watch live)...');
  await page.goto('https://news.ycombinator.com', { waitUntil: 'domcontentloaded' });

  const title = await page.title();
  console.log('Page title:', title);

  // Extract top story title
  const firstHeadline = await page.locator('.titleline > a').first().innerText();
  console.log('Top HN story:', firstHeadline);

  // Keep open for a few seconds so you can see it on the dashboard
  await page.waitForTimeout(3000);

  console.log('Closing browser session...');
  await browser.close();
  console.log('Done!');
}

main().catch(console.error);
