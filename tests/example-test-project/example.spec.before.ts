import { test } from '@playwright/test';

test('simple test', async ({ page }) => {
    await page.goto('www.google.com');
    
    await PlaywrightLiveRecorder.start(page, s => eval(s));
});
