import { pomLoader } from '../src/pageObjectModel';
import {test, expect} from '@jest/globals';



test('1st test', async () => {
    const {deps, content } = pomLoader._transpile('cascade/assets_page.ts', 'assets_page', `import { Page } from "@playwright/test";
    import { forecast_page } from './assets/forecast_page';
    
    export class assets_page {
    
        static inputBox_selector = '#newButtonName';
        static inputBox(page: Page) { return page.locator(this.inputBox_selector); }
    
        //convention for nested components
        static forecast_dialog = forecast_page;
    }`);
 
    expect(deps).toEqual(['forecast_page']);
    expect(content).toEqual('abc123');
})