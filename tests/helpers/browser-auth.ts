import {expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {browserFixtureDatabaseUrl} from './browser-database';

/** Real CSRF/session authentication for scoped LAB tests; no mocked principal or security bypass.
 * Login UI itself is outside Task1. Avoid its dev StrictMode duplicate-CSRF fetch race in test setup.
 */
export async function signInSyntheticBrowser(page:Page,username:string){
 browserFixtureDatabaseUrl(); // Explicit matching, loopback-only disposable fixture target.
 const origin=new URL(process.env.E2E_BASE_URL??'http://127.0.0.1:3000').origin;
 const password=process.env.SYNTHETIC_SEED_PASSWORD??readFileSync(process.env.SYNTHETIC_SEED_PASSWORD_FILE??'data/secrets/seed-password','utf8').trim();
 const response=await page.request.get('/api/auth/csrf');expect(response.ok()).toBe(true);
 const {csrf}=await response.json();expect(typeof csrf).toBe('string');
 const login=await page.request.post('/api/auth/login',{headers:{origin},data:{username,password,csrf}});
 expect(login.ok(),`Real fixture login HTTP ${login.status()}`).toBe(true);
 await page.goto('/');await expect(page).toHaveURL(/\/$/);
}
