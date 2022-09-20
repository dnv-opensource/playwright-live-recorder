import { Page, test } from "@playwright/test";
import * as fs from "fs/promises";
import * as chokidar from "chokidar";
import { pomLoader } from "./pomLoader";

export module PlaywrightLiveRecorder {
    export const config = {
        /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/example/recorderRules.js' */
        recorderRulesPath: './node_modules/@dnvgl/playwright-live-recorder/dist/example/recorderRules.js',
        /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browserCode.js' */
        browserCodeJSPath: './node_modules/@dnvgl/playwright-live-recorder/dist/browserCode.js',
        /** @default './node_modules/@dnvgl/playwright-live-recorder/dist/browserCode.css' */
        browserCodeCSSPath: './node_modules/@dnvgl/playwright-live-recorder/dist/browserCode.css',
        /** @default false */
        watchLibFiles: false,
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
                .replaceAll('//', '/') // if we end up with two // in a row, replace it with one
                .replace(/\/$/, '') // clear trailing /
                 + '_page.ts',
             */
            urlToFilePath: (url: string) => url
                .replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') //cut out base url
                .replaceAll(/[a-fA-F0-9]{8}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{4}-?[a-fA-F0-9]{12}/g, '') //cut out guids
                .replaceAll(/\/d+\//g, '/') // cut out /###/ fragments
                .replaceAll('//', '/') // if we end up with two // in a row, replace it with one
                .replace(/\/$/, '') // clear trailing /
                 + '_page.ts',
            /** @remarks Use this to find list of all selectors, and lookup property from selector @default /(.+)_selector/*/
            propertySelectorRegex: /(.+)_selector/,
        }
    }

    /**
     * @param evalScope pass value of `s => eval(s)`, this provides the test's execution scope so eval'd lines have local scope variables, etc
     */
    export async function start(page: Page, evalScope: (s: string) => any) {
        const isHeadless = test.info().config.projects[0].use.headless; //hack: using projects[0] since can't find 'use.*' otherwise
        config.pageObjectModel.baseUrl = config.pageObjectModel.baseUrl ?? test.info().config.projects[0].use.baseURL!; //hack: using projects[0] since can't find 'use.*' otherwise
        if (isHeadless !== false) {
            console.error('startLiveCoding called while running headless');
            return;
        }

        //get stacktrace to find startLiveCoding calling location (file and line)
        const callingLocationStr = new Error().stack!.split('\n')[2]; //line 0,1,2 2 is the immediate calling location of startLiveCoding
        const fileAndLineRegex = /    at (?:.+\()?(.+):(\d+):\d+\)?/.exec(callingLocationStr)!;
        const testCallingLocation = { file: fileAndLineRegex[1], line: +fileAndLineRegex[2] };

        //todo: figure out how to log a step to show the 'live coding' is being attached
        await init(page, testCallingLocation, evalScope);
        if (config.pageObjectModel.enabled) await watchAndLoadPageObjectModels(page);
        await page.waitForEvent("close", { timeout: 1000 * 60 * 60 });
    }

    var lastCommand: string = '';
    var commandLineCount = 0;

    async function init(page: Page, testCallingLocation: { file: string, line: number }, evalScope: (s: string) => any) {
        await page.exposeFunction('PW_eval', (testEval: string, record = false) => TestingContext_eval(testCallingLocation, evalScope, page, testEval, record));

        await page.exposeFunction('PW_getLastCommand', () => lastCommand);
        await page.exposeFunction('PW_updateAndRerunLastCommand', async (testEval: string) => await TestingContext_eval(testCallingLocation, evalScope, page, testEval, true, lastCommand));

        await page.exposeFunction('PW_addRule', (matcherCode: string) => prependRecordingRule(matcherCode));
        
        await page.exposeFunction('PW_urlToFilePath', (url: string) => config.pageObjectModel.urlToFilePath(url));
        await page.exposeFunction('PW_config', () => {
            //shenanigans to get regexp and functions to serialize reasonably
            (<any>RegExp.prototype).toJSON = RegExp.prototype.toString;
            (<any>Function.prototype).toJSON = Function.prototype.toString;
            const result = JSON.stringify(config);
            delete (<any>RegExp.prototype).toJSON;
            delete (<any>Function.prototype).toJSON;
          
            return JSON.parse(result);
        });

        await page.addScriptTag({ path: config.recorderRulesPath });
        await page.addScriptTag({ path: config.browserCodeJSPath });
        await page.addStyleTag({ path: config.browserCodeCSSPath});

        page.on('dialog', dialog => {/* allow user interaction for browser interaction with PW_updateAndRunLastCommand */ });

        // tslint:disable: no-floating-promises
        (async () => { for await (const event of fs.watch(config.recorderRulesPath)) event.eventType === 'change' ? await page.addScriptTag({ path: config.recorderRulesPath }) : {}; })(); //fire-and-forget the watcher
        if (config.watchLibFiles) {
            (async () => { for await (const event of fs.watch(config.browserCodeJSPath)) event.eventType === 'change' ? await page.addScriptTag({path: config.browserCodeJSPath}) : {}; })();   //fire-and-forget the watcher
            (async () => { for await (const event of fs.watch(config.browserCodeCSSPath)) event.eventType === 'change' ? await page.addStyleTag({path: config.browserCodeCSSPath}) : {}; })();  //fire-and-forget the watcher
        }
        // tslint:enable: no-floating-promises
        
    }

    async function watchAndLoadPageObjectModels(page: Page) {
        const watch = chokidar.watch(`${config.pageObjectModel.filenameConvention}`, { cwd: config.pageObjectModel.path });
        //note: watch.getWatched is empty, we're relying on the individual page reload process to ensure everything is loaded

        watch.on('add', path => pomLoader.reload(path, config.pageObjectModel.path, page));
        watch.on('change', path => pomLoader.reload(path, config.pageObjectModel.path, page));
    }

    async function TestingContext_eval(testCallingLocation: { file: string, line: number }, evalScope: (s:string) => any, page: Page, testEval: string, record = true, commandToOverwrite: string | undefined = undefined) {
        try {
            const s = testEval.replaceAll(/\bawait\b/g, ''); //hack - eval doesn't play well with awaits, ideally we'd transpile it into promises... but I don't know how to use `typescript` lib to do this
            //prepend imports from local test file into eval scope
            const testFileSource = await fs.readFile(testCallingLocation.file, 'utf-8');
            //ts.transpile(testFileSource) //todo: figure out how to use typescript to transpile `import` into `require` syntax
            const importToRequireRegex = /\bimport\b\s*({?\s*[^};]+}?)\s*from\s*([^;]*);?/g;  
            const matches = [...testFileSource.matchAll(importToRequireRegex)];
            const imports = matches/* .filter(x => x[2] !== libraryName) */.map(x => `const ${x[1]} = require(${x[2]});`).join('\n');
          
            await evalScope(`${imports}\n${s}`);
            if (record) {
                await recordLineToTestFile(testCallingLocation, testEval, commandToOverwrite);
                commandLineCount += testEval.split('\n').length;
                lastCommand = testEval;
            }
        } catch (error) {
            if (error instanceof Error) {
                await page.evaluate(`console.error(\`${error.name}: ${error.message}\`);`); //todo: toast message instead
                console.warn(error);
            } else {
                await page.evaluate(`console.error(\`non-standard error. See DEBUG CONSOLE in test execution environment for details\`);`); //todo: toast message instead
                console.error(error);
            }

            if (record) {
                await recordLineToTestFile(testCallingLocation, `//${testEval} // failed to execute`, commandToOverwrite);
                commandLineCount += testEval.split('\n').length;
                lastCommand = testEval;
            }
        }
    }

    async function recordLineToTestFile(testCallingLocation: { file: string, line: number }, str: string, commandToOverwrite: string | undefined = undefined) {
        const t = testCallingLocation; //alias for shorthand below

        //todo: this code is ugly and cumbersome, find a more idomatic way to track recorded lines and splice file content
        const lastCommandLines = lastCommand?.split(_NEWLINE).length;
        if (commandToOverwrite) commandLineCount -= lastCommandLines;
        const lineNum = t.line + commandLineCount;
        const fileContents = await fs.readFile(t.file, 'utf-8');
        const lines = fileContents.split(_NEWLINE);
        const linesToOverwrite = commandToOverwrite ? lastCommandLines : 0;
        lines.splice(lineNum, linesToOverwrite, '    ' + str);
        const newFileContent = lines.join('\n');
        await fs.writeFile(t.file, newFileContent);
    }

    async function prependRecordingRule(matcherCode: string) {
        //todo: this code is ugly and cumbersome, find a more idomatic way to splice file content
        const matcherCodeLines = matcherCode.split(_NEWLINE).length;
        const recorderRulesText = await fs.readFile(config.recorderRulesPath, 'utf-8');
        const lines = recorderRulesText.split(_NEWLINE);
        const insertLineIndex = lines.indexOf('var RecorderRules = [') + 1;
        lines.splice(insertLineIndex, 0,
`    {
        match: (el) => ${matcherCodeLines == 1 ? matcherCode : '{\n            ' + matcherCode.split('\n').join('\n            ') + '\n        }'},
        output: (selector) => \`await page.locator('\${selector}').click();\`
    },`);

        await fs.writeFile(config.recorderRulesPath, lines.join('\n'));
    }
}

const _NEWLINE = /\r\n|\n|\r/;

