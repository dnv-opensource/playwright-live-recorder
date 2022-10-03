import { test, expect } from '@playwright/test';


test('simple test', async ({ page }) => {
    await page.goto('www.google.com');
    await expect(page).toHaveTitle('Google');
    
    await PlaywrightLiveRecorder.start(page, s => eval(s));
});
