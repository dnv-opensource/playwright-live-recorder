import { test, expect } from '@playwright/test';
import { PlaywrightLiveRecorder } from '@dnvgl/playwright-live-recorder';
import { intro_page } from './docs/intro_page';

test('simple test', async ({ page }) => {
    await page.goto('www.google.com');
    await expect(page).toHaveTitle('Google');
    
    await PlaywrightLiveRecorder.start(page, s => eval(s));
});