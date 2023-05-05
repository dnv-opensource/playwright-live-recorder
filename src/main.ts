import { Page, test } from "@playwright/test";

import chokidar from "chokidar";
import _ from "lodash";
import nodePath from "node:path";

import { PlaywrightLiveRecorderConfig } from "./types";
import { recorder } from "./recorder";
import { testFileWriter } from "./testFileWriter";
import { hotModuleReload } from "./hotModuleReload";
import { pageObjectModel } from "./pageObjectModel";
import { getTestCallingLocation } from "./utility";
import fs from 'fs/promises';
import { ts } from "ts-morph";

export type { PlaywrightLiveRecorderConfig };
export type PlaywrightLiveRecorderConfigFile = RecursivePartial<PlaywrightLiveRecorderConfig>;

export module PlaywrightLiveRecorder {
    /** {@inheritDoc PlaywrightLiveRecorderConfig} */
    export const defaultConfig: PlaywrightLiveRecorderConfig = { //note: please update types.d.ts when defaults are updated
        recorder: {
            path: './PW_selectorConventions.js',
            basepath: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_selectorConventions.js'
        },
        pageObjectModel: {
            enabled: true,
            path: './tests/',
            filenameConvention: '**/*_page.ts',
            baseUrl: <string | undefined>undefined,
            urlToFilePath: (url: string, aliases: {[key: string]: string}) => {
                let filePath = url
                    .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
                    .replaceAll(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
                    .replaceAll(/\/d+\//g, '/') // cut out /###/ fragments
                    .replaceAll('-', '_') //replace all hyphens with underscores, valid classname
                    .replaceAll('//', '/') // if we end up with two // in a row, replace it with one
                    .replace(/\/$/, ''); // clear trailing /
                if (filePath in aliases) filePath = aliases[filePath]; //apply aliases
                return filePath + '_page.ts';
            },
            aliases: {},
            propertySelectorRegex: /(.+)_selector/,
            isElementPropertyRegex: /.+([Ee]lement|[Ll]ocator|[Cc]ombo[Bb]ox|[Bb]utton)$/,
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
     * used to track if `start` already called, if so, don't start again
     */
    type pageState = { PlaywrightLiveRecorder_started: boolean };
    /**
     * @param evalScope pass value of `s => eval(s)`, this provides the test's execution scope so eval'd lines have local scope variables, etc
     */
    export async function start(page: Page, evalScope: (s: string) => any) {
        const pageState = <pageState><any>page;
        if (pageState.PlaywrightLiveRecorder_started === true) {
            return;
        }

        pageState.PlaywrightLiveRecorder_started = true;

        const isHeadless = test.info().project.use.headless;
        if (isHeadless !== false) {
            console.error('startLiveCoding called while running headless');
            return;
        }


        config = _mergeConfig(defaultConfig, await _configFromFile(), configOverrides);

        const testCallingLocation = await getTestCallingLocation();
        await testFileWriter.init(page, testCallingLocation);

        await hotModuleReload.init(testCallingLocation, (str: string) => page.evaluate(str), evalScope);
        await page.exposeFunction('PW_eval', (codeBlocks: string[]) => hotModuleReload._evalCore(evalScope, s => page.evaluate(s), codeBlocks));

        await recorder.init(config.recorder, page);

        await page.exposeFunction('PW_config', () => PW_config()); //expose config to browser
        await page.addScriptTag({ path: config.diagnostic.browserCodeJSPath }); //loading these scripts first, pageObjectModel.init watchers are dependent upon methods exposed here
        await page.addStyleTag({ path: config.diagnostic.browserCodeCSSPath });

        if (config.pageObjectModel.enabled) {
            config.pageObjectModel.baseUrl = config.pageObjectModel.baseUrl ?? test.info().project.use.baseURL!;
            await pageObjectModel.init(nodePath.dirname(testCallingLocation.file), config.pageObjectModel, page);
        }

        page.on('load', async page => {
            await page.addScriptTag({ path: config.recorder.basepath });
            await page.addScriptTag({ path: config.recorder.path });
            await page.addScriptTag({ path: config.diagnostic.browserCodeJSPath });
            await page.addStyleTag({ path: config.diagnostic.browserCodeCSSPath });
            await pageObjectModel.reloadAll(config.pageObjectModel.path, page);
        });

        page.on('dialog', dialog => {/* allow user interaction for browser input dialog interaction */ });

        if (config.diagnostic.hotReloadBrowserLibFiles) {
            const watch = chokidar.watch([config.diagnostic.browserCodeJSPath, config.diagnostic.browserCodeCSSPath]);
            watch.on('change', async path => await page.addScriptTag({ path }));
        }

        await page.waitForEvent("close", { timeout: 1000 * 60 * 60 });
    }


export let configFilePath = './live-recorder.config.ts';
export async function _configFromFile() {
    try {
        const fileContents = await fs.readFile(configFilePath, { encoding: 'utf8' });
        const transpiled = ts.transpileModule(fileContents, { compilerOptions: { module: ts.ModuleKind.ESNext, strict: false } });
        const cleanedUp = _cleanUpTranspiledSource(transpiled.outputText);
        const obj = eval(cleanedUp);
        return <PlaywrightLiveRecorderConfig | undefined>obj;
    } catch (err) {
        if ((<any>err).code === 'MODULE_NOT_FOUND') return;
        console.error(err);
    }
}

function _cleanUpTranspiledSource(transpiled: string) {
    return transpiled
        .replaceAll(/\bimport\b\s*({?\s*[^};]+}?)\s*from\s*([^;]*);?/g, '')
        .replace('export default ', '');
}




    /** _.merge({}, defaultConfig, configFromFile, configOverrides) */
    function _mergeConfig(defaultConfig: PlaywrightLiveRecorderConfig, configFromFile: PlaywrightLiveRecorderConfig | undefined, configOverrides: PlaywrightLiveRecorderConfig) {
        return _.merge({}, defaultConfig, configFromFile, configOverrides);
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

type RecursivePartial<T> = {
    [P in keyof T]?:
    T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    T[P] extends object ? RecursivePartial<T[P]> :
    T[P];
};
