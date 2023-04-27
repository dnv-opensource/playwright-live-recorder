import { Page } from "@playwright/test"

type PlaywrightLiveRecorderConfig = {
    recorder: PlaywrightLiveRecorderConfig_recorder,
    pageObjectModel: PlaywrightLiveRecorderConfig_pageObjectModel,
    diagnostic: PlaywrightLiveRecorderConfig_diagnostic,
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
    /** @default (url: string, aliases: {[key: string]: string}) => {
                let filePath = url
                    .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
                    .replaceAll(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
                    .replaceAll(/\/d+\//g, '/') // cut out /###/ fragments
                    .replaceAll('-', '_') //replace all hyphens with underscores, valid classname
                    .replaceAll('//', '/') // if we end up with two // in a row, replace it with one
                    .replace(/\/$/, ''); // clear trailing /
                if (filePath in aliases) filePath = aliases[filePath]; //apply aliases
                return filePath + '_page.ts';
            }
    */
    urlToFilePath: (url: string, aliases: {[key: string]: string}) => string,
    /**
     * @remarks use to override/alias url fragments to page object model name
     * @example { '': 'home', 'login/corporate' : 'login', 'login/personal' : 'login' } //redirect from root address to 'home' pom. use same pom for login/corporate and login/personal
    */
    aliases: {[key: string]: string},
    /** @remarks Use this to find list of all selectors, and lookup method from selector @default /(.+)_selector/*/
    propertySelectorRegex: RegExp,
    /** @remarks Use this to identify methods that return elements @default /.+([Ee]lement|[Ll]ocator|[Cc]ombo[Bb]ox)$/*/
    isElementPropertyRegex: RegExp,
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
    overlay: {
        /** @default 'salmon' */
        color: string,
        /** @default (el, config) => {
            el.setAttribute('data-background', el.style.background);
            el.style.background = config.pageObjectModel.overlay.color;
        },
        */
        on: (el: HTMLElement, config: PlaywrightLiveRecorderConfig) => void,
        /** @default (el) => el.style.background = el.getAttribute('data-background') ?? '', */
        off: (el: HTMLElement) => void,
    }
}

type PlaywrightLiveRecorderConfig_recorder = {
    /** @default './PW_selectorConventions.js' */
    path: string,
}

type PlaywrightLiveRecorderConfig_diagnostic = {
    /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.js' */
    browserCodeJSPath: string,
    /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_live.css' */
    browserCodeCSSPath: string,
    /** @default false */
    hotReloadBrowserLibFiles: boolean,
}

type TestCallingLocation = { file: string, testLine: string, executingLine: string };

//type AddScriptTag_Args = Parameters<Page['addScriptTag']>[0];
//type AddScriptTag_Return = ReturnType<Page['addScriptTag']>;