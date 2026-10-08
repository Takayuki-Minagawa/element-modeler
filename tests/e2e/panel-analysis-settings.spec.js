import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { installOfflineRoutes } from './offline.mjs';

test('shear assumption saves, cancels, reloads and participates in Undo', async ({ page, context, baseURL }) => {
  await installOfflineRoutes(context, baseURL);
  await page.goto('/');
  await expect(page.getByRole('status', { name: 'モデルの要素数' })).toContainText('線材 0');
  const open = async () => {
    await page.locator('#menu-analysis-trigger').click();
    await page.locator('#btn-analysis-settings').click();
  };
  const saveModel = async () => {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CAD保存', exact: true }).click();
    return JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  };
  await open();
  const select = page.locator('#analysis-ignore-shear-deformation');
  await expect(select).toHaveValue('');
  await select.selectOption('true');
  await page.locator('#btn-analysis-settings-save').click();
  const saved = await saveModel();
  expect(saved.analysisSettings.ignoreShearDeformation).toBe(true);
  await open();
  await expect(select).toHaveValue('true');
  await select.selectOption('false');
  await page.locator('#btn-analysis-settings-cancel').click();
  expect((await saveModel()).analysisSettings.ignoreShearDeformation).toBe(true);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click();
  expect((await saveModel()).analysisSettings.ignoreShearDeformation).toBeNull();
  await page.locator('#file-import').setInputFiles({ name: 'shear.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await expect(page.locator('.app-notice-success')).toBeVisible();
  await open();
  await expect(select).toHaveValue('true');
  await select.selectOption('false');
  await page.locator('#btn-analysis-settings-save').click();
  expect((await saveModel()).analysisSettings.ignoreShearDeformation).toBe(false);
});
