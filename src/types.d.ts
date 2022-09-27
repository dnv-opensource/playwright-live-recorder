import { Page } from "@playwright/test"

type PlaywrightLiveRecorderConfig = {
    recorder: PlaywrightLiveRecorderConfig_recorder,
    pageObjectModel: PlaywrightLiveRecorderConfig_pageObjectModel,
    debug: PlaywrightLiveRecorderConfig_debug,
};

type PlaywrightLiveRecorderConfig_pageObjectModel = {
    enabled: boolean,
    path: string,
    filenameConvention: string,
    baseUrl: string|undefined,
    urlToFilePath: (url: string) => string,
    propertySelectorRegex: RegExp,
    generateClassTemplate: (className: string) => string,
    generatePropertyTemplate: (name: string, selector: string) => string,
    overlay: {
        on: (el: HTMLElement) => void,
        off: (el: HTMLElement) => void,
    }
}

type PlaywrightLiveRecorderConfig_recorder = {
    path: string,
}

type PlaywrightLiveRecorderConfig_debug = {
    browserCodeJSPath: string,
    browserCodeCSSPath: string,
    watchLibFiles: boolean,
}

//type AddScriptTag_Args = Parameters<Page['addScriptTag']>[0];
//type AddScriptTag_Return = ReturnType<Page['addScriptTag']>;