import { expect, test } from '@playwright/test';

async function openOperation(page: import('@playwright/test').Page, name: string) {
  const link = page.getByRole('link', { name, exact: true });
  if (!(await link.isVisible())) await page.getByText('Операции', { exact: true }).click();
  await link.click();
}

test('opening stock, sale, debt payment and persistence', async ({ page }) => {
  const consoleErrors: string[] = [];
  const unique = Date.now().toString();
  const partyCode = `E2E-${unique}`;
  const partyName = `Покупатель E2E ${unique}`;
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Логин').fill('smoke-admin');
  await page.getByLabel('Пароль').fill('SmokeTest-2026!');
  await page.getByRole('button', { name: /Войти/ }).click();
  await expect(page.getByRole('heading', { name: 'Касса' })).toBeVisible();
  await page.screenshot({ path: 'test-results/production-ui-final.png', fullPage: true });

  await openOperation(page, 'Контрагенты');
  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByLabel('Код').fill(partyCode);
  await page.getByLabel('Название').fill(partyName);
  await page.getByLabel('Телефон').fill('+996555000001');
  await page.getByRole('button', { name: 'Создать контрагента' }).click();
  const partyCard = page.locator('.party-card').filter({ hasText: partyName });
  await expect(partyCard).toBeVisible();
  await partyCard.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Телефон').fill('+996555000002');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(partyCard.getByText('+996555000002')).toBeVisible();

  await page.getByRole('button', { name: 'Добавить' }).click();
  await page.getByLabel('Код').fill(partyCode);
  await page.getByLabel('Название').fill('Проверка дубля');
  await page.getByRole('button', { name: 'Создать контрагента' }).click();
  await expect(page.getByLabel('Код').locator('xpath=..').getByRole('alert')).toBeVisible();
  expect(consoleErrors.some((message) => message.includes('400'))).toBe(true);
  consoleErrors.length = 0;
  await page.getByRole('button', { name: 'Закрыть' }).click();

  await page.getByRole('link', { name: 'Каталог' }).click();
  const productRow = page.locator('tbody tr').filter({ hasText: 'DEMO-001' });
  await productRow.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Оптовая цена').fill('131');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await page.getByRole('link', { name: 'Ввод остатков' }).click();
  await expect(page.getByRole('heading', { name: 'Ввод начальных остатков' })).toBeVisible();
  const openingRows = page.locator('tbody tr');
  const openingCount = await openingRows.count();
  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByLabel('Товар 1').selectOption({ label: 'Тестовый товар · DEMO-001' });
  await page.getByLabel('Количество 1').fill('10');
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  await expect(openingRows).toHaveCount(openingCount + 1);
  let newestRow = openingRows.first();
  await expect(newestRow.getByText('Черновик')).toBeVisible();
  await newestRow.getByRole('button', { name: 'Изменить' }).click();
  await page.getByLabel('Количество 1').fill('12');
  await page.getByRole('button', { name: 'Сохранить изменения' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  newestRow = page.locator('tbody tr').first();
  await expect(newestRow).toContainText('1 200,00 сом');
  await newestRow.getByRole('button', { name: 'Провести' }).click();
  await expect(newestRow.getByText('Проведён')).toBeVisible();

  await openOperation(page, 'Продажи');
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole('button', { name: 'Создать', exact: true }).click();
    await page.getByLabel('Контрагент').selectOption({ label: partyName });
    await page.getByLabel('Товар 1').selectOption({ label: 'Тестовый товар · DEMO-001' });
    await page.getByLabel('Количество 1').fill('1');
    await page.getByRole('button', { name: 'Сохранить черновик' }).click();
    await expect(page.locator('tbody tr').filter({ hasText: 'Черновик' }).filter({ hasText: partyName })).toHaveCount(index + 1);
  }
  const draftRows = page.locator('tbody tr').filter({ hasText: 'Черновик' }).filter({ hasText: partyName });
  await expect(draftRows).toHaveCount(2);
  await draftRows.first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(draftRows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /Черновик/ })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();
  for (let index = 0; index < 2; index += 1) {
    page.once('dialog', (dialog) => dialog.accept());
    await draftRows.first().getByRole('button', { name: 'Удалить' }).click();
    await expect(draftRows).toHaveCount(1 - index);
  }
  await expect(draftRows).toHaveCount(0);

  await page.getByRole('button', { name: 'Создать', exact: true }).click();
  await page.getByLabel('Контрагент').selectOption({ label: partyName });
  await page.getByLabel('Товар 1').selectOption({ label: 'Тестовый товар · DEMO-001' });
  await page.getByLabel('Количество 1').fill('2');
  await page.getByRole('button', { name: 'Сохранить черновик' }).click();
  const saleRow = page.locator('tbody tr').filter({ hasText: partyName }).filter({ hasText: 'Черновик' });
  await expect(saleRow).toHaveCount(1);
  const paymentAnswers = ['0', 'cash'];
  page.on('dialog', async (dialog) => dialog.accept(paymentAnswers.shift() ?? ''));
  await saleRow.getByRole('button', { name: 'Провести' }).click();
  await expect(page.locator('tbody tr').filter({ hasText: partyName }).filter({ hasText: 'Проведён' })).toHaveCount(1);

  await openOperation(page, 'Взаиморасчёты');
  let obligationRow = page.locator('tbody tr').filter({ hasText: partyName });
  await expect(obligationRow).toContainText('300,00 сом');
  await page.getByRole('button', { name: 'Новая оплата' }).click();
  await page.getByLabel('Контрагент').selectOption({ label: partyName });
  await page.getByLabel('Сумма').fill('100');
  await page.getByLabel('Комментарий').fill('E2E частичная оплата');
  await page.getByRole('button', { name: 'Провести' }).click();
  obligationRow = page.locator('tbody tr').filter({ hasText: partyName });
  await expect(obligationRow).toContainText('200,00 сом');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Взаиморасчёты' })).toBeVisible();
  obligationRow = page.locator('tbody tr').filter({ hasText: partyName });
  await expect(obligationRow).toContainText('200,00 сом');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Касса' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByText('Операции', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'Отчёты', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/production-ui-mobile-final.png', fullPage: true });
  expect(consoleErrors).toEqual([]);
});

