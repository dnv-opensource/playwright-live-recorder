import { Page, test } from "@playwright/test";
import * as fs from "fs/promises";
import * as chokidar from "chokidar";
import * as ts from "typescript";

export module PlaywrightRecorder {
    //todo: figure out how to decorate .d.ts with default paths
    export const config = {
        recorderRulesPath: './src/recorderRules.js',
        browserCodeJSPath: './node_modules/@dnvgl-electricgrid/playwright-recorder/dist/browserCode.js',
        browserCodeCSSPath: './node_modules/@dnvgl-electricgrid/playwright-recorder/dist/browserCode.css',
        pageObjectModel: {
            enabled: true,
            path: './src/page-object-models/',
            filenameConvention: '**/*_page.ts',
            baseUrl: <string|undefined>undefined,
            urlToFilePath: (url: string) => url.replace(new RegExp(`^${config.pageObjectModel.baseUrl}`), '') + '_page', //strip the baseUrl //todo: strip numeric id and guids from url //todo: strip query parameters from url
            propertySelectorRegex: /(.+)_selector/, //use this to find list of all selectors, and lookup property from selector
        }
    }

    /**
     * @param evalScope pass value of `s => eval(s)`, this provides the test's execution scope so eval'd lines have local scope variables, etc
     */
    export async function startLiveCoding(page: Page, evalScope: (s: string) => any) {
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
        if (config.pageObjectModel.enabled) await scanAndLoadPageObjectModels(page);
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
        if ((<any>config).watchLibFiles) {
            (async () => { for await (const event of fs.watch(config.browserCodeJSPath)) event.eventType === 'change' ? await page.addScriptTag({path: config.browserCodeJSPath}) : {}; })();   //fire-and-forget the watcher
            (async () => { for await (const event of fs.watch(config.browserCodeCSSPath)) event.eventType === 'change' ? await page.addStyleTag({path: config.browserCodeCSSPath}) : {}; })();  //fire-and-forget the watcher
        }
        // tslint:enable: no-floating-promises
        
    }

    async function scanAndLoadPageObjectModels(page: Page) {
        const watch = chokidar.watch(`${config.pageObjectModel.path}${config.pageObjectModel.filenameConvention}`);
        watch.on('add', path => reloadPageObjectModel(page, path));
        watch.on('change', path => reloadPageObjectModel(page, path));
        //todo: figure out cleanup of the watcher. Assume current test task being ended is enough.
    }

    async function reloadPageObjectModel(page: Page, path: string) {
        const fileContents = '' + await fs.readFile(path);
        const transpiled = ts.transpile(fileContents, { module: ts.ModuleKind.ESNext });
        //todo: make this work with modules or classes (currently only works with modules)
        //assume module name is same as filename
        const className = /\\([^\\]+?).ts/.exec(path)![1]; //extract filename without extension as module name

        //todo: replace hardcoded string replacements with using typescript lib to walk to AST instead
        const content = transpiled
            //export class fixup
            .replace(`var ${className} = /** @class */ (function () {\r\n    function ${className}() {\r\n    }`, `var ${className} = {};`)
            .replace(`    return ${className};\r\n}());\r\nexport { ${className} };`, `window.${className} = ${className};`)
            //export module fixup
            .replace(`export var ${className};`, `window.PW_pages.${className} = ${className};`)

        await page.addScriptTag({ content });
    }

    async function TestingContext_eval(testCallingLocation: { file: string, line: number }, evalScope: (s:string) => any, page: Page, testEval: string, record = true, commandToOverwrite: string | undefined = undefined) {
        try {
            const s = testEval.replaceAll(/\bawait\b/g, ''); //hack - eval doesn't play well with awaits, ideally we'd transpile it into promises... but I don't know how to use `typescript` lib to do this
            //prepend imports from local test file into eval scope
            const testFileSource = await fs.readFile(testCallingLocation.file, 'utf-8');
            //ts.transpile(testFileSource) //todo: figure out how to use typescript to transpile `import` into `require` syntax
            const importToRequireRegex = /\bimport\b\s*({?\s*[^}]+}?)\s*from\s*([^;]*);?/g;  
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
