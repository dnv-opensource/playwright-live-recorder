import { Page, test } from "@playwright/test";
import { pageObjectModel } from "./pageObjectModel";
import { recorder } from "./recorder";
import * as fs from "fs/promises";
import { repl } from "./repl";
import { PlaywrightLiveRecorderConfig } from "./types";
export module PlaywrightLiveRecorder {
    export const config : PlaywrightLiveRecorderConfig = {
        recorder: {
            /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live_recorderRules.js' */
            path: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live_recorderRules.js',
        },
        pageObjectModel: {
            /** @default true */
            enabled: true,
            /** @default './tests/' */
            path: './tests/',
            /** @default '**\/*_page.ts' */
            filenameConvention: '**/*_page.ts',
            /** @default (use.baseURL value from Playwright config) */
            baseUrl: <string|undefined>undefined,
            /** @default (url: string) => url
                .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
                .replaceAll(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
                .replaceAll(/\/d+\//g, '/') // cut out /###/ fragments
                .replaceAll('-', '_') //replace all hyphens with underscores, valid classname
                .replaceAll('//', '/') // if we end up with two // in a row, replace it with one
                .replace(/\/$/, '') // clear trailing /
                 + '_page.ts',
             */
            urlToFilePath: (url: string) => url
                .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
                .replaceAll(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
                .replaceAll(/\/d+\//g, '/') // cut out /###/ fragments
                .replaceAll('-', '_') //replace all hyphens with underscores, valid classname
                .replaceAll('//', '/') // if we end up with two // in a row, replace it with one
                .replace(/\/$/, '') // clear trailing /
                 + '_page.ts',
            /** @remarks Use this to find list of all selectors, and lookup property from selector @default /(.+)_selector/*/
            propertySelectorRegex: /(.+)_selector/,
            /** @default (className) => 
            `import { Page } from "@playwright/test";

            export class ${className} {

            }`,*/
            generateClassTemplate: (className) => 
`import { Page } from "@playwright/test";

export class ${className} {

}`,
            /** @default  (name, selector) => 
            `    private static ${name}_selector = \`${selector}\`;\r\n` + 
            `    static ${name}(page: Page) { return page.locator(\`this.${name}_selector\`); }\r\n\r\n`,
             */
            generatePropertyTemplate: (name, selector) => 
            `    private static ${name}_selector = \`${selector}\`;\r\n` + 
            `    static ${name}(page: Page) { return page.locator(this.${name}_selector); }\r\n\r\n`,
            overlay: {
                /** @default 'salmon' */
                color: 'salmon',
                /** @default (el, config) => {
                    el.setAttribute('data-background', el.style.background);
                    el.style.background = config.pageObjectModel.overlay.color;
                },
                */
                on: (el, config) => {
                    el.setAttribute('data-background', el.style.background);
                    el.style.background = config.pageObjectModel.overlay.color;
                },
                /** @default (el) => el.style.background = el.getAttribute('data-background') ?? '', */
                off: (el) => el.style.background = el.getAttribute('data-background') ?? '',
            }
        },
        debug: {
            /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.js' */
            browserCodeJSPath: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.js',
            /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.css' */
            browserCodeCSSPath: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.css',
            /** @default false */
            watchLibFiles: false,
        }
    }

    /**
     * @param evalScope pass value of `s => eval(s)`, this provides the test's execution scope so eval'd lines have local scope variables, etc
     */
    export async function start(page: Page, evalScope: (s: string) => any) {
        const isHeadless = test.info().project.use.headless;
        if (isHeadless !== false) {
            console.error('startLiveCoding called while running headless');
            return;
        }

        await repl.init(page, evalScope);
        await recorder.init(config.recorder, page);

        await page.exposeFunction('PW_config', () => PW_config()); //expose config to browser
        await page.addScriptTag({ path: config.debug.browserCodeJSPath }); //loading these scripts first, pageObjectModel.init watchers are dependent upon methods exposed here
        await page.addStyleTag({ path: config.debug.browserCodeCSSPath });

        if (config.pageObjectModel.enabled) {
            config.pageObjectModel.baseUrl = config.pageObjectModel.baseUrl ?? test.info().project.use.baseURL!;
            await pageObjectModel.init(config.pageObjectModel, page);
        }

        page.on('dialog', dialog => {/* allow user interaction for browser input dialog interaction */ });

        if (config.debug.watchLibFiles) {
            // tslint:disable: no-floating-promises
            (async () => { for await (const event of fs.watch(config.debug.browserCodeJSPath)) event.eventType === 'change' ? await page.addScriptTag({ path: config.debug.browserCodeJSPath }) : {}; })();   //fire-and-forget the watcher
            (async () => { for await (const event of fs.watch(config.debug.browserCodeCSSPath)) event.eventType === 'change' ? await page.addStyleTag({ path: config.debug.browserCodeCSSPath }) : {}; })();  //fire-and-forget the watcher
            // tslint:enable: no-floating-promises
        }
        
        await page.waitForEvent("close", { timeout: 1000 * 60 * 60 });
    }

    async function PW_config() {
        //shenanigans to get regexp and functions to serialize reasonably
        (<any>RegExp.prototype).toJSON = RegExp.prototype.toString;
        (<any>Function.prototype).toJSON = Function.prototype.toString;
        const result = JSON.stringify(config);
        delete (<any>RegExp.prototype).toJSON;
        delete (<any>Function.prototype).toJSON;

        return JSON.parse(result);
    }
}