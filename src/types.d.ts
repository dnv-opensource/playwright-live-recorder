import { Page } from "@playwright/test"

type PlaywrightLiveRecorderConfig = {
    recorder: PlaywrightLiveRecorderConfig_recorder,
    pageObjectModel: PlaywrightLiveRecorderConfig_pageObjectModel,
    debug: PlaywrightLiveRecorderConfig_debug,
};

type PlaywrightLiveRecorderConfig_pageObjectModel = {
    /** @default true */
    enabled: boolean,
    /** @default './tests/' */
    path: string,
    /** @default '**\/*_page.ts' */
    filenameConvention: string,
    /** @default (use.baseURL value from Playwright config) */
    baseUrl: string|undefined,
    /** @default (url: string) => url
    .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
    .replaceAll(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
    .replaceAll(/\/d+\//g, '/') // cut out /###/ fragments
    .replaceAll('//', '/') // if we end up with two // in a row, replace it with one
    .replace(/\/$/, '') // clear trailing /
        + '_page.ts',
    */
    urlToFilePath: (url: string) => string,
    /** @remarks Use this to find list of all selectors, and lookup method from selector @default /(.+)_selector/*/
    propertySelectorRegex: RegExp,
    generateClassTemplate: (className: string) => string,
    generatePropertyTemplate: (name: string, selector: string) => string,
    overlay: {
        color: string,
        on: (el: HTMLElement, config: PlaywrightLiveRecorderConfig) => void,
        off: (el: HTMLElement) => void,
    }
}

type PlaywrightLiveRecorderConfig_recorder = {
    /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live_recorderRules.js' */
    path: string,
}

type PlaywrightLiveRecorderConfig_debug = {
    /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.js' */
    browserCodeJSPath: string,
    /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.css' */
    browserCodeCSSPath: string,
    /** @default false */
    watchLibFiles: boolean,
}

//type AddScriptTag_Args = Parameters<Page['addScriptTag']>[0];
//type AddScriptTag_Return = ReturnType<Page['addScriptTag']>;