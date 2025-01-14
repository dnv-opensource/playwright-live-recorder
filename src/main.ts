import { Page, test } from "@playwright/test";

import chokidar from "chokidar";
import _ from "lodash";
import nodePath from "node:path";

import { recorder } from "./recorder";
import { testFileWriter } from "./testFileWriter";
import { hotModuleReload } from "./hotModuleReload";
import { pageObjectModel } from "./pageObjectModel";
import { getTestCallingLocation } from "./utility";
import fs from 'fs/promises';
import process from 'node:process';
import { ts } from "ts-morph";
import { PlaywrightLiveRecorderConfig, PlaywrightLiveRecorderConfigFile, PlaywrightLiveRecorderConfig_recorder, PlaywrightLiveRecorderConfig_pageObjectModel, PlaywrightLiveRecorderConfig_diagnostic, TestCallingLocation } from "./types";
export { PlaywrightLiveRecorderConfig, PlaywrightLiveRecorderConfigFile, PlaywrightLiveRecorderConfig_recorder, PlaywrightLiveRecorderConfig_pageObjectModel, PlaywrightLiveRecorderConfig_diagnostic, TestCallingLocation };

export module PlaywrightLiveRecorder {
    export const defaultConfig: PlaywrightLiveRecorderConfig = {
        recorder: {
            path: './PW_selectorConventions.js',
            basepath: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_selectorConventions.js'
        },
        pageObjectModel: {
            enabled: true,
            path: './tests/',
            filenameConvention: '**/*_page.ts',
            baseUrl: <string | undefined>undefined,
            actionTimeout: 5000,
            urlToFilePath: (url: string, aliases: {[key: string]: string}) => {
                let filePath = url
                    .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
                    .replaceAll(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
                    .replaceAll(/\/\d+(?=\/)/g, '/') // cut out /###/ fragments
                    .replaceAll(/\/\d+\//g, '/') // cut out /###/ fragments if there were any left over
                    .replaceAll(/\/\d+$/g, '/') // cut out /### fragments at end
                    .replaceAll('-', '_') //replace all hyphens with underscores, valid classname
                    .replaceAll(/\/\/+/g, '/') // if we end up with two // in a row, replace it with one
                    .replace(/\/$/, '') // clear trailing /
                    .replace(/^\//, ''); // clear leading /
                if (filePath in aliases) filePath = aliases[filePath]; //apply aliases
                return filePath + '_page.ts';
            },
            aliases: {},
            propertySelectorRegex: /(.+)_selector/,
            primaryActionByCssSelector: [
                ['input[type="text"], input[type=""], textarea', 'await $1.fill("");'],
                ['*', 'await $1.click();']
            ],
            secondaryActionByCssSelector: [
                ['input[type="text"], textarea', 'await expect($1.innerText()).toContain("");'],
                /// available on all element types
                ['*', 'await expect($1.innerText()).toContain("");'],
                ['*', 'await expect($1).toBeVisible();'],
                ['*', 'await expect($1).toBeEnabled();']
            ],
            generateClassTemplate: (className: string) =>
                `import type { Page } from '@playwright/test';

export class ${className} {

}`,
            generatePropertyTemplate: (name: string, selector: string) =>
                `    private static ${name}_selector = \`${selector}\`;\r\n` +
                `    static ${name}(page: Page) { return page.locator(this.${name}_selector); }\r\n\r\n`,
            overlay: {
                color: 'salmon',
                on: (el: HTMLElement, color: string) => {
                    el.setAttribute('data-background', el.style.background);
                    el.style.background = color ?? 'salmon';
                },
                off: (el: HTMLElement) => el.style.background = el.getAttribute('data-background') ?? '',
            },
            importerCustomizationHooks: `data:text/javascript,
                import { promises as fs } from 'fs';
                import { fileURLToPath } from 'url';
                
                const resolvedFilenames = new Set();
                
                export async function resolve(specifier, context, nextResolve) {
                  const resolved = await nextResolve(specifier, context);
                  if (!resolved.url.endsWith('.ts')) return resolved;
                
                  const urlFilename = fileURLToPath(resolved.url);
                  const modifyMs = await fs.stat(urlFilename).then(stat => Math.floor(stat.mtimeMs));
                  resolved.url = resolved.url.replace(/.ts$/, '.cachebust.' + modifyMs + '.ts');
                  return resolved;
                }
                
                export async function load(url, context, nextLoad) {
                  const original = url.replace(/\\.cachebust\\.\\d+.ts$/, '.ts');
                  if (original === url || resolvedFilenames.has(url)) return await nextLoad(url, context);
                  const urlFilename = fileURLToPath(url);
                  const originalFilename = fileURLToPath(original);
                  await fs.copyFile(originalFilename, urlFilename);
                  const result = await nextLoad(url, context);
                  await fs.rm(urlFilename);
                  resolvedFilenames.add(url);
                  return result;
                }
                `
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
     * @param evalScope pass value of `s => eval(s)`, this provides the test's execution scope so eval'd lines have local scope variables, relative import paths, etc
     */
    export async function start(page: Page, evalScope: (s: string) => any) {
        const pageState = <pageState><any>page;
        if (pageState.PlaywrightLiveRecorder_started === true) {
            return;
        }
        pageState.PlaywrightLiveRecorder_started = true;

        const isHeadless = test.info().project.use.headless;
        const pwdebug = process.env.PWDEBUG == 'console';
        if (isHeadless !== false && !pwdebug) {
            console.error('startLiveCoding called while running headless or env variable PWDEBUG=console not set');
            return;
        }
        config = _mergeConfig(defaultConfig, await _configFromFile(), configOverrides);
        if (!config.pageObjectModel.path.endsWith('/')) config.pageObjectModel.path +='/';

        page.setDefaultTimeout(config.pageObjectModel.actionTimeout);

        const testCallingLocation = await getTestCallingLocation();
        await testFileWriter.init(page, testCallingLocation);

        await hotModuleReload.init(testCallingLocation, config.pageObjectModel.importerCustomizationHooks, (str: string) => page.evaluate(str), evalScope);
        await page.exposeFunction('PW_eval', (codeBlock: string) => hotModuleReload._evalCore(evalScope, s => page.evaluate(s), codeBlock));

        await recorder.init(config.recorder, page);

        await page.exposeFunction('PW_config', () => PW_config()); //expose config to browser
        await page.addScriptTag({ path: config.diagnostic.browserCodeJSPath }); //loading these scripts first, pageObjectModel.init watchers are dependent upon methods exposed here
        await page.addStyleTag({ path: config.diagnostic.browserCodeCSSPath });

        if (config.pageObjectModel.enabled) {
            config.pageObjectModel.baseUrl = config.pageObjectModel.baseUrl ?? test.info().project.use.baseURL!;
            await pageObjectModel.init(nodePath.dirname(testCallingLocation.file), config.pageObjectModel, evalScope, page);
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
        //todo - try rewriting to use dynamic import instead
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