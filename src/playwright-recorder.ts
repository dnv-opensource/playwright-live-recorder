import { Page, test } from "@playwright/test";
import * as fs from "fs/promises";


export module PlaywrightRecorder {
    //todo: figure out how to decorate .d.ts with default paths
    export const config = {
        recorderRulesPath: './src/recorderRules.js',
        browserCodePath: './node_modules/@dnvgl-electricgrid/playwright-recorder/dist/browserCode.js',
    }

    /**
     * @param evalScope pass value of `s => eval(s)`, this provides the test's execution scope so eval'd lines have local scope variables, etc
     */
    export async function startLiveCoding(page: Page, evalScope: (s: string) => any) {
        const isHeadless = test.info().config.projects[0].use.headless; //hack: using projects[0] since can't find 'use.*' otherwise
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
        await page.waitForEvent("close", {timeout: 1000 * 60 * 60});
    }

    var lastCommand: string = '';
    var commandLineCount = 0;

    async function init(page: Page, testCallingLocation: { file: string, line: number }, evalScope: (s: string) => any) {
        await page.exposeFunction('PW_eval', (testEval: string, record = false) => TestingContext_eval(testCallingLocation, evalScope, page, testEval, record));

        await page.exposeFunction('PW_getLastCommand', () => lastCommand);
        await page.exposeFunction('PW_updateAndRerunLastCommand', async (testEval: string) => await TestingContext_eval(testCallingLocation, evalScope, page, testEval, true, lastCommand));

        await page.exposeFunction('PW_addRule', (matcherCode: string) => prependRecordingRule(matcherCode));

        await page.addScriptTag({ path: config.recorderRulesPath });
        await page.addScriptTag({ path: config.browserCodePath });

        page.on('dialog', dialog => {/* allow user interaction for browser interaction with PW_updateAndRunLastCommand */ });

        // tslint:disable-next-line: no-floating-promises
        (async () => { for await (const event of fs.watch(config.recorderRulesPath)) event.eventType === 'change' ? await page.addScriptTag({ path: config.recorderRulesPath }) : {}; })(); //fire-and-forget the watcher

        // tslint:disable-next-line: no-floating-promises
        //(async () => { for await (const event of fs.watch(config.browserCodePath)) event.eventType === 'change' ? await page.addScriptTag({path: config.browserCodePath}) : {}; })();
        // uncomment line above if live reloading of browserCode.js needed
    }

    async function TestingContext_eval(testCallingLocation: { file: string, line: number }, evalScope: (s:string) => any, page: Page, testEval: string, record = true, commandToOverwrite: string | undefined = undefined) {
        try {
            const s = testEval.replace(/^await /, '');
            await evalScope(s);
            lastCommand = testEval;
            if (record) {
                await recordLineToTestFile(testCallingLocation, testEval, commandToOverwrite);
                commandLineCount += testEval.split('\n').length;
            }
        } catch (error) {
            if (error instanceof Error) {
                await page.evaluate(`console.error(\`${error.name}: ${error.message}\`);`); //todo: toast message instead
                console.warn(error);
            } else {
                await page.evaluate(`console.error(\`non-standard error. See DEBUG CONSOLE in test execution environment for details\`);`); //todo: toast message instead
                console.error(error);
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
