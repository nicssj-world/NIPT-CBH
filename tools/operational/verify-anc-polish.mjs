import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chromium, expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Uses existing synthetic Owner UAT records; never creates or submits clinical work.
const out = path.resolve('.local/anc-polish');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
const accounts = JSON.parse(await fs.readFile('.local/owner-local-uat-1.0.2/secrets/uat-accounts.json', 'utf8'));
const fixture = JSON.parse(await fs.readFile('.local/anc-date-evidence/browser-case.json', 'utf8'));
const account = accounts.find(a => a.username === 'uat.anc');
const browser = await chromium.launch();
const checks = [], errors = [];
await fs.mkdir(out, {recursive: true});
try {
  const context = await browser.newContext({baseURL: 'https://127.0.0.1:19548', ignoreHTTPSErrors: true});
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login');
  await page.getByLabel('ชื่อผู้ใช้', {exact: true}).fill(account.username);
  await page.getByLabel('รหัสผ่าน', {exact: true}).fill(account.password);
  await page.getByRole('button', {name: 'เข้าสู่ระบบ', exact: true}).click();
  await expect(page).not.toHaveURL(/\/login$/);
  for (const theme of ['light', 'dark']) {
    for (const width of [1440, 768, 375]) {
      await page.setViewportSize({width, height: 960});
      for (const [surface, route, ready] of [
        ['overview', '/', '.anc-stages button'],
        ['registry', '/cases', '.registry-row'],
        ['case', '/cases/' + fixture.caseId, '.document-grid']
      ]) {
        await page.goto(route);
        await expect(page.locator(ready).first()).toBeVisible();
        await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
        // Theme colors transition for 150 ms; measure the settled rendered state.
        await page.waitForTimeout(250);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${surface}/${width}/${theme}: page overflow`);
        if (surface === 'overview') {
          const text = await page.locator('body').innerText();
          assert.ok(!text.includes('เคสอยู่ขั้นตอนไหน'));
          assert.ok(!text.includes('ทุกปี · เคสละหนึ่งขั้นตอน · Attention Flags ไม่นับเพิ่ม'));
          await expect(page.getByRole('button', {name: 'ดูทุกเคส', exact: true})).toBeVisible();
          await expect(page.locator('.anc-stages button')).toHaveCount(7);
        }
        if (surface === 'registry') {
          const group = page.locator('.registry-statuses').filter({hasText: 'Paper Consent'}).first();
          await expect(group).toBeVisible();
          await group.screenshot({path: path.join(out, `badges-${width}-${theme}.png`)});
          const badges = await group.locator('.status, .badge').evaluateAll(nodes => nodes.map(e => {
            const r = e.getBoundingClientRect(), s = getComputedStyle(e);
            return {text: e.textContent, top: r.top, height: r.height, font: s.font, margin: s.margin, radius: s.borderRadius};
          }));
          assert.ok(badges.length >= 2);
          assert.equal(badges[0].height, badges[1].height, 'badge heights');
          assert.equal(badges[0].font, badges[1].font, 'badge typography');
          assert.equal(badges[0].margin, badges[1].margin, 'badge margins');
          assert.equal(badges[0].radius, badges[1].radius, 'badge radius');
          if (width === 375) assert.ok(Math.abs(badges[0].top - badges[1].top) < 1, 'mobile badge alignment');
          const link = page.locator('.registry-ln-link').first();
          await link.focus(); await expect(link).toBeFocused();
          await page.keyboard.press('Enter'); await expect(page.locator('.page-header h1')).toContainText('LN');
          await page.goto('/cases'); await expect(page.locator('.registry-row').first()).toBeVisible();
          await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
          await page.waitForTimeout(250);
          checks.push({surface: 'badges', width, theme, badges});
        }
        const axe = await new AxeBuilder({page}).include('.workspace').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
        assert.deepEqual(axe.violations.map(v => ({id: v.id, impact: v.impact})), [], `${surface}/${width}/${theme}: accessibility`);
        await page.screenshot({path: path.join(out, `after-${surface}-${width}-${theme}.png`), fullPage: surface !== 'registry'});
        checks.push({surface, width, theme, overflow: false, accessibilityViolations: 0});
      }
      await page.getByRole('button', {name: 'เปิดแบบขอส่งตรวจ 5 หมวด', exact: true}).click();
      const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
      const steps = dialog.locator('.request-steps button'); await expect(steps).toHaveCount(5);
      for (let step = 0; step < 5; step++) {
        await steps.nth(step).click(); await expect(steps.nth(step)).toHaveAttribute('aria-current', 'step');
        assert.equal(await dialog.evaluate(e => e.scrollWidth > e.clientWidth), false, `request step ${step + 1} overflow`);
        await page.screenshot({path: path.join(out, `after-request-${step + 1}-${width}-${theme}.png`)});
      }
      const axe = await new AxeBuilder({page}).include('.p2-dialog').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
      assert.deepEqual(axe.violations.map(v => ({id: v.id, impact: v.impact})), [], `request/${width}/${theme}: accessibility`);
      await dialog.getByRole('button', {name: 'ปิด', exact: true}).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByRole('button', {name: 'เปิดแบบขอส่งตรวจ 5 หมวด', exact: true})).toBeFocused();
      checks.push({surface: 'request-five-categories', width, theme, keyboardFocusRestored: true, accessibilityViolations: 0});
    }
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({status: 'PASS', revision, checks, errors}, null, 2));
  console.log(JSON.stringify({status: 'PASS', revision, checks: checks.length}));
} catch (e) {
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify({status: 'FAIL', revision, checks, errors: [...errors, e.message]}, null, 2));
  throw e;
} finally {await browser.close();}
