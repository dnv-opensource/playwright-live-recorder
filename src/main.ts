import { Page, test } from "@playwright/test";

import * as chokidar from "chokidar";
import * as _ from "lodash";

import { PlaywrightLiveRecorderConfig, TestCallingLocation } from "./types";
import { recorder } from "./recorder";
import { testFileWriter } from "./testFileWriter";
import { hotModuleReload } from "./hotModuleReload";
import { pageObjectModel } from "./pageObjectModel";
import { getTestCallingLocation } from "./utility";

export type { PlaywrightLiveRecorderConfig };
export type PlaywrightLiveRecorderConfigFile = RecursivePartial<PlaywrightLiveRecorderConfig>;

export module PlaywrightLiveRecorder {
    /** {@inheritDoc PlaywrightLiveRecorderConfig} */
    export const defaultConfig: PlaywrightLiveRecorderConfig = { //note: please update types.d.ts when defaults are updated
        recorder: {
            /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live_recorderRules.js' */
            path: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live_recorderRules.js',
        },
        pageObjectModel: {
            enabled: true,
            path: './tests/',
            filenameConvention: '**/*_page.ts',
            baseUrl: <string | undefined>undefined,
            urlToFilePath: (url: string) => url
                .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
                .replaceAll(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
                .replaceAll(/\/d+\//g, '/') // cut out /###/ fragments
                .replaceAll('-', '_') //replace all hyphens with underscores, valid classname
                .replaceAll('//', '/') // if we end up with two // in a row, replace it with one
                .replace(/\/$/, '') // clear trailing /
                + '_page.ts',
            propertySelectorRegex: /(.+)_selector/,
            generateClassTemplate: (className) => 
`import { Page } from "@playwright/test";

export class ${className} {

}`,
            generatePropertyTemplate: (name, selector) => 
            `    private static ${name}_selector = \`${selector}\`;\r\n` + 
            `    static ${name}(page: Page) { return page.locator(this.${name}_selector); }\r\n\r\n`,
            overlay: {
                color: 'salmon',
                on: (el, config) => {
                    el.setAttribute('data-background', el.style.background);
                    el.style.background = config.pageObjectModel.overlay.color;
                },
                off: (el) => el.style.background = el.getAttribute('data-background') ?? '',
            }
        },
        diagnostic: {
            browserCodeJSPath: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.js',
            browserCodeCSSPath: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.css',
            hotReloadBrowserLibFiles: false,
        }
    }

    let config: PlaywrightLiveRecorderConfig;
    export let configOverrides: PlaywrightLiveRecorderConfig = <any><PlaywrightLiveRecorderConfigFile>{ recorder: {}, pageObjectModel: { overlay: {} }, diagnostic: {} };

    /**
     * @param evalScope pass value of `s => eval(s)`, this provides the test's execution scope so eval'd lines have local scope variables, etc
     */
    export async function start(page: Page, evalScope: (s: string) => any) {
        const isHeadless = test.info().project.use.headless;
        if (isHeadless !== false) {
            console.error('startLiveCoding called while running headless');
            return;
        }
        config = _mergeConfig(defaultConfig, await _configFromFile(), configOverrides);

        const testCallingLocation = await getTestCallingLocation();
        await testFileWriter.init(page, testCallingLocation);
        await hotModuleReload.init(testCallingLocation, (str: string) => page.evaluate(str), evalScope);
        
        await recorder.init(config.recorder, page);

        await page.exposeFunction('PW_config', () => PW_config()); //expose config to browser
        await page.addScriptTag({ path: config.diagnostic.browserCodeJSPath }); //loading these scripts first, pageObjectModel.init watchers are dependent upon methods exposed here
        await page.addStyleTag({ path: config.diagnostic.browserCodeCSSPath });

        if (config.pageObjectModel.enabled) {
            config.pageObjectModel.baseUrl = config.pageObjectModel.baseUrl ?? test.info().project.use.baseURL!;
            await pageObjectModel.init(config.pageObjectModel, page);
        }

        page.on('framenavigated', async frame => {
            await frame.addScriptTag({ path: config.recorder.path });
            await frame.addScriptTag({ path: config.diagnostic.browserCodeJSPath });
            await frame.addStyleTag({ path: config.diagnostic.browserCodeCSSPath });
            await pageObjectModel.reloadAll(config.pageObjectModel.path, frame.page());
        });

        page.on('dialog', dialog => {/* allow user interaction for browser input dialog interaction */ });

        if (config.diagnostic.hotReloadBrowserLibFiles) {
            const watch = chokidar.watch([config.diagnostic.browserCodeJSPath, config.diagnostic.browserCodeCSSPath]);
            watch.on('change', async path => await page.addScriptTag({ path }));
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

    export let configFilePath = '../../../../live-recorder.config.ts';
    async function _configFromFile() {
        try {
            const fileConfig = (await import(configFilePath))?.default;
            return <PlaywrightLiveRecorderConfig | undefined>fileConfig;
        } catch (err) {
            if ((<any>err).code === 'MODULE_NOT_FOUND') return;
            console.error(err);
        }
    }

    /** _.merge({}, defaultConfig, configFromFile, configOverrides) */
    function _mergeConfig(defaultConfig: PlaywrightLiveRecorderConfig, configFromFile: PlaywrightLiveRecorderConfig | undefined, configOverrides: PlaywrightLiveRecorderConfig) {
        return _.merge({}, defaultConfig, configFromFile, configOverrides);
    }
}

type RecursivePartial<T> = {
    [P in keyof T]?:
    T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    T[P] extends object ? RecursivePartial<T[P]> :
    T[P];
};
