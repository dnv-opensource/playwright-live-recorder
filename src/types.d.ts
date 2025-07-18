import { Page } from "@playwright/test"

export type PlaywrightLiveRecorderConfig = {
    recorder: PlaywrightLiveRecorderConfig_recorder,
    pageObjectModel: PlaywrightLiveRecorderConfig_pageObjectModel,
    diagnostic: PlaywrightLiveRecorderConfig_diagnostic,
};

type RecursivePartial<T> = {
    [P in keyof T]?:
    T[P] extends (infer U)[] ? RecursivePartial<U>[] :
    T[P] extends object ? RecursivePartial<T[P]> :
    T[P];
};


export type PlaywrightLiveRecorderConfigFile = RecursivePartial<PlaywrightLiveRecorderConfig>;

export type PlaywrightLiveRecorderConfig_pageObjectModel = {
    /** @default true */
    enabled: boolean,
    /** @default './tests/' */
    path: string,
    /** @default '**\/*_page.ts' */
    filenameConvention: string,
    /** @default use.baseURL value from Playwright config */
    baseUrl: string|undefined,
    /** @default 5000 */
    actionTimeout: number,
    /** @default 'global_page.ts' */
    globalPageFilePath: string,
    /** @default (url: string, aliases: {[key: string]: string}) => {
                let filePath = url
                    .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
                    .replace(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
                    .replace(/\/\d+(?=\/)/g, '/')   // cut out /###/ fragments
                    .replace(/\d+\//g, '/')         // cut out /###/ fragments if there were any left over
                    .replace(/\/\d+$/g, '/')        // cut out /### fragments at end
                    .replace(/-/g, '_')             //replace all hyphens with underscores, valid classname
                    .replace(/\/\/+/g, '/')         // if we end up with two // in a row, replace it with one
                    .replace(/\/$/, '')             // clear trailing /
                    .replace(/^\//, '');            // clear leading /

                if (filePath in aliases) filePath = aliases[filePath]; //apply aliases
                return filePath + '_page.ts';
            }
    */
    urlToFilePath: (url: string, aliases: {[key: string]: string}) => string,
    /**
     * @remarks use to override/alias url fragments to page object model name
     * @example { '': 'home', 'login/corporate' : 'login', 'login/personal' : 'login' } //redirect from root address to 'home' pom. use same pom for login/corporate and login/personal
    */    aliases: {[key: string]: string},
    /** @remarks Use this to find list of all selectors, and lookup method from selector @default /(.+)_selector\b/*/
    propertySelectorRegex: RegExp,
    /** @remarks Use this to find list of nested page objects within a given page object model file @default /(.+)_page\b/*/
    propertyNestedTypeRegex: RegExp,
    /** @remarks Use this to specify the text appended when LEFT clicked on in record mode @default [ ["input[type="text"]", 'fill()'], ["textarea", 'fill()'], ["/.*\/", "click()"] ] */
    primaryActionByCssSelector: [string, string][],
    /** @remarks Use this to specify the text appended when RIGHT clicked on in record mode @default [ ["input[type="text"]", "await expect($1.innerText()).toContain('')"], ["textarea", "innerText().toContain('')"], ["/.*\/", ""]]*/
    secondaryActionByCssSelector: [string, string][],
    /** @default (className) => 
    `import { Page } from "@playwright/test";

    export class ${className} {

    }`,
    */
    generateClassTemplate: (className: string) => string,
    /** @default  (name, selector) => 
    `    private static ${name}_selector = \`${selector}\`;\r\n` + 
    `    static ${name}(page: Page) { return page.locator(\`this.${name}_selector\`); }\r\n\r\n`,
    */
    generatePropertyTemplate: (name: string, selector: string) => string,
    
    /** @default  (name) => 
    `    static async ${name}(page: Page) {\r\n        \r\n    }\r\n\r\n`,
    */
    generateMethodTemplate: (name: string) => string,
    overlay: {
        /** @default 'salmon' */
        color: string,
        /** @default (el, color) => {
            el.setAttribute('data-background', el.style.background);
            el.style.background = color;
        },
        */
        on: (el: HTMLElement, color: string) => void,
        /** @default (el) => el.style.background = el.getAttribute('data-background') ?? '', */
        off: (el: HTMLElement) => void,
    },
    importerCustomizationHooks: string,
}

export type PlaywrightLiveRecorderConfig_recorder = {
    /** @default './PW_selectorConventions.js' */
    path: string,
    /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_selectorConventions.js' */
    basepath: string,
}

export type PlaywrightLiveRecorderConfig_diagnostic = {
    /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.js' */
    browserCodeJSPath: string,
    /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.css' */
    browserCodeCSSPath: string,
    /** @default false */
    hotReloadBrowserLibFiles: boolean,
}

export type TestCallingLocation = { file: string, testLine: string, testLineNumber: number, executingLine: string };