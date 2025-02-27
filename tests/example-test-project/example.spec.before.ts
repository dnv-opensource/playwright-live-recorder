import { test } from '@playwright/test';
import { PlaywrightLiveRecorder } from '@dnvgl/playwright-live-recorder';

test.describe('describe block', () => {
    test('simple test', async ({ page }) => {
        await page.goto('www.google.com');
        
        await PlaywrightLiveRecorder.start(page, s => eval(s));
    });
});
