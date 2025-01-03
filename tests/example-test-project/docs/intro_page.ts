import { Page } from "@playwright/test";
import { createGuid } from '../testHelpers';

const doc = "abc";

export class intro_page {
    private static title_selector = `h1:has-text("Installation")`;
    static title(page: Page) { return page.locator(this.title_selector); }

    private static home_selector = `b:has-text("Playwright")`;
    static home(page: Page) { 
        const iAmGuid = createGuid();
        return page.locator(this.home_selector); 
    }


}