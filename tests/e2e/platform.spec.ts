import { test, expect } from '@playwright/test';

test('homepage links to the isolated project without loading legacy styles', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Gemeinsam fragen.',
  );
  await expect(page.locator('link[href*="/static/styles.css"]')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Zum Inhalt springen' }),
  ).toBeFocused();
  await page.screenshot({
    path: `test-results/homepage-${test.info().project.name}.png`,
    fullPage: true,
  });
  await page
    .getByRole('link', { name: /Umfrage zum Oliven-Symposium/ })
    .click();
  await expect(page).toHaveURL(/\/projects\/olive-symposium$/);
  await expect(page.locator('#home-app')).toBeVisible();
  expect(await page.locator('link[rel="stylesheet"]').count()).toBe(1);
});

test('old bookmarks and API aliases still work; raw data and other projects are inaccessible', async ({
  request,
}) => {
  const oldPage = await request.get('/oel-auswahl', { maxRedirects: 0 });
  expect(oldPage.status()).toBe(307);
  expect(oldPage.headers().location).toMatch(
    /\/projects\/olive-symposium\/oel-auswahl$/,
  );
  expect((await request.get('/api/config')).ok()).toBeTruthy();
  for (const path of [
    '/data/umfragen.sqlite3',
    '/.env',
    '/Oliven-Symposium-Momentaufnahme-PINs.txt',
    '/projects/olive-symposium/data/umfragen.sqlite3',
    '/projects/missing',
  ]) {
    expect((await request.get(path)).status()).toBe(404);
  }
  const crossSite = await request.post(
    '/projects/olive-symposium/api/participant',
    { headers: { origin: 'https://outside.example' }, data: {} },
  );
  expect(crossSite.status()).toBe(403);
  const invalid = await request.post(
    '/projects/olive-symposium/api/participant',
    { headers: { 'content-type': 'application/json' }, data: '{broken' },
  );
  expect(invalid.status()).toBe(400);
  const huge = await request.post('/projects/olive-symposium/api/participant', {
    data: { value: 'a'.repeat(1_000_001) },
  });
  expect(huge.status()).toBe(413);
});
