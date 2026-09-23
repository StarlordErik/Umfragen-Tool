import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';

const base = process.env.OLIVE_BASE ?? '';
const path = (route: string) => `${base}${route === '/' ? '' : route}` || '/';

async function mode(request: APIRequestContext, value: string) {
  const response = await request.post(path('/api/oils/event-mode'), {
    data: { password: 'fixture-admin', mode: value },
  });
  expect(response.ok()).toBeTruthy();
}

async function login(page: Page) {
  await page.locator('#participant-name').fill('Testperson Alpha');
  await page.locator('#participant-pin').fill('1234');
  await page.locator('#participant-login').click();
  await expect(page.locator('#participant-state')).toContainText('Angemeldet');
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
}

async function saveComment(page: Page, text: string) {
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/response') &&
      response.request().method() === 'POST',
  );
  await page.locator('textarea[data-field="aroma_profile"]').fill(text);
  // Legacy also saves on change/blur. Await that before following its guarded link.
  await page.locator('textarea[data-field="aroma_profile"]').blur();
  expect((await saved).ok()).toBeTruthy();
  await expect(
    page.locator('.sample-detail-slot [data-save-state]'),
  ).toHaveText('gespeichert');
}

test('preparation: login validation, submission and phase locks', async ({
  page,
  request,
}) => {
  await mode(request, 'preparation');
  await page.goto(path('/'));
  await expect(page.locator('#home-app')).toBeVisible();
  await shot(page, 'preparation-anonymous');
  await page.locator('#participant-name').fill('Testperson Alpha');
  await page.locator('#participant-pin').fill('9999');
  await page.locator('#participant-login').click();
  await expect(page.locator('#participant-state')).toContainText(
    'PIN ist falsch',
  );
  await shot(page, 'login-error');
  await login(page);
  await page.locator('#new-submission summary').click();
  await shot(page, 'preparation-submission');
  await page.locator('#submit-oil-button').click();
  await expect(page.locator('#submission-state')).toHaveClass(/error/);
  await expect(page.locator('.survey-entry-link').first()).toHaveAttribute(
    'aria-disabled',
    'true',
  );
  await expect(page.locator('.result-link-grid')).toHaveCount(0);
  await page.locator('#submission-name').fill('Gemeinsames Testöl');
  await page.locator('#submission-price').fill('23');
  await page.locator('#submission-owner-options input[value="2"]').check();
  const submitted = page.waitForResponse((response) =>
    response.url().endsWith('/api/submissions'),
  );
  await page.locator('#submit-oil-button').click();
  expect((await submitted).ok()).toBeTruthy();
  await expect(
    page
      .locator('.own-submission-item')
      .filter({ hasText: 'Gemeinsames Testöl' }),
  ).toContainText('Testperson Alpha & Testperson Beta');
  await page.reload();
  await expect(
    page
      .locator('.own-submission-item')
      .filter({ hasText: 'Gemeinsames Testöl' }),
  ).toBeVisible();
  const admin = await request.get(path('/api/oils?password=fixture-admin'));
  const oil = (await admin.json()).oils.find(
    (item: { name: string }) => item.name === 'Gemeinsames Testöl',
  );
  expect(oil).toBeTruthy();
  expect(
    (
      await request.post(path('/api/oils/remove'), {
        data: { password: 'fixture-admin', oil_id: oil.id },
      })
    ).ok(),
  ).toBeTruthy();
});

test('execution: three surveys, autosave, reload and navigation', async ({
  page,
  request,
}) => {
  await mode(request, 'execution');
  await page.goto(path('/'));
  await login(page);
  await shot(page, 'execution-home');
  for (const survey of ['geschmack', 'geruch', 'gesamt']) {
    await page.goto(path(`/umfrage/${survey}`));
    await expect(page.locator('.sample-tabs')).toBeVisible();
    await page.locator('[data-action="toggle"]').first().click();
    const comment = page.locator('textarea[data-field="aroma_profile"]');
    await expect(comment).toBeVisible();
    await shot(page, `survey-${survey}`);
    await saveComment(page, 'Regression: gespeichert & wieder geladen.');
    await page.reload();
    await page.locator('[data-action="toggle"]').first().click();
    await expect(comment).toHaveValue(
      'Regression: gespeichert & wieder geladen.',
    );
    await expect(page.locator('#linktree-link')).toHaveAttribute(
      'href',
      path('/'),
    );
    // Restore the deterministic reference state.
    await saveComment(page, 'Fruchtig und frisch.');
  }
  await page.route('**/api/response', (route) => route.abort('failed'));
  await page
    .locator('textarea[data-field="aroma_profile"]')
    .fill('Netzwerkfehler');
  await expect(
    page.locator('.sample-detail-slot [data-save-state]'),
  ).toHaveText('Fehler beim Speichern');
  await page.unroute('**/api/response');
  await saveComment(page, 'Fruchtig und frisch.');
  await expect(page.locator('#linktree-link')).toHaveAttribute(
    'aria-disabled',
    'false',
  );
  await page.locator('#linktree-link').click();
  await expect(page).toHaveURL(
    new RegExp(`${path('/').replaceAll('/', '\\/')}$`),
  );
  await expect(page.locator('#home-app')).toBeVisible();
  const blocked = await request.get(path('/ergebnisse'));
  expect(blocked.status()).toBe(400);
});

test('evaluation: readonly survey, all result modes, admin and logout', async ({
  page,
  request,
}) => {
  await mode(request, 'evaluation');
  await page.goto(path('/'));
  await login(page);
  await shot(page, 'evaluation-home');
  await expect(page.locator('#new-submission')).toHaveCount(0);
  await page.goto(path('/umfrage/geschmack'));
  await page.locator('[data-action="toggle"]').first().click();
  await expect(page.locator('textarea')).toBeDisabled();
  await shot(page, 'evaluation-readonly');
  for (const route of [
    'ergebnisse',
    'einzelne-oel-wertungen',
    'individuelle-ergebnisse',
    'kompetitive-verkostung',
  ]) {
    await page.goto(path(`/${route}`));
    await expect(page.locator('#results-app h1')).toBeVisible();
    await shot(page, route);
    if (route === 'einzelne-oel-wertungen') {
      await page.locator('[data-action="toggle-oil"]').first().click();
      // Desktop also has an open summary card in the left column.
      const box = page.locator('.oil-card.open .cipher-box');
      await expect(box).not.toHaveClass(/revealed/);
      await box.locator('[data-action="reveal"]').click();
      await expect(box).toHaveClass(/revealed/);
    }
  }
  await page.goto(path('/oel-auswahl'));
  await expect(page.locator('#oil-password')).toBeVisible();
  await shot(page, 'admin-login');
  await page.locator('#oil-password').fill('fixture-admin');
  await page.locator('[data-action="login"]').click();
  await expect(page.locator('#oil-password')).toHaveCount(0);
  await shot(page, 'admin-configuration');
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .locator('[data-action="change-event-mode"]')
    .selectOption('preparation');
  await expect(page.locator('[data-action="change-event-mode"]')).toHaveValue(
    'evaluation',
  );
  await page.goto(path('/'));
  await page.locator('#participant-logout').click();
  await expect(page.locator('#participant-state')).toContainText('Abgemeldet');
  const response = await request.post(path('/api/response'), {
    data: { survey_id: 'geschmack', cipher: 'Alpha', answers: {} },
  });
  expect(response.status()).toBe(400);
});
