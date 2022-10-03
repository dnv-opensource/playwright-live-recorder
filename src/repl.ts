import { test, Page } from "@playwright/test";
import * as ErrorStackParser from "error-stack-parser";
import * as fs from "fs/promises";
import { hotModuleReload } from "./hotModuleReload";
import { pageObjectModel } from "./pageObjectModel";

//repl with write-to-test-file capabilities
export module repl {

    var testCallingLocation!: TestCallingLocation;
    export var lastCommand: string;

    export async function init(page: Page, evalScope: (s: string) => any) {
        const testInfo = test.info();
        const stack = ErrorStackParser.parse(new Error())[2];
        if (testInfo.file !== stack.fileName) throw new Error('PlaywrightLiveRecorder.start must be called within same file as running test');

        const testFileSrcLines = (await fs.readFile(testInfo.file, 'utf-8')).split(_NEWLINE);
        testCallingLocation = { file: testInfo.file, testLine: testFileSrcLines[testInfo.line - 1], executingLine: testFileSrcLines[stack.lineNumber! - 1] };

        // tslint:disable-next-line: no-floating-promises
        (async () => { for await (const event of fs.watch(testCallingLocation.file)) event.eventType === 'change' ? await hotModuleReload.reloadTestFile(testCallingLocation.file, testCallingLocation.testLine, testCallingLocation.executingLine, s => _evalCore(testCallingLocation.file, evalScope, (str: string) => page.evaluate(str), s)) : {}; })();   //fire-and-forget the watcher

        await page.exposeFunction('PW_appendToTest', async (testEval: string) => await repl.writeLineToTestFile(testCallingLocation, testEval));
        await page.exposeFunction('PW_updateAndRerunLastCommand', async (testEval: string) => await repl.writeLineToTestFile(testCallingLocation, testEval, repl.lastCommand?.split(_NEWLINE)?.length ?? 0));

        await page.exposeFunction('PW_eval', async (testEval: string) => await repl.TestingContext_eval(testCallingLocation, evalScope, (str: string) => page.evaluate(str), testEval));
    }

    export async function TestingContext_eval(t: TestCallingLocation, evalScope: (s: string) => any, pageEvaluate: (pageFunction: string) => Promise<unknown>, testEval: string) {
        try {
            await _evalCore(t.file, evalScope, pageEvaluate, testEval);
            await pageEvaluate(`PW_reportError()`);
        } catch (error) {
            if (error instanceof Error) {
                await pageEvaluate(`PW_reportError(\`${error.message}\`, \`${error.stack}\`)`);
                console.warn(error);
            } else {
                await pageEvaluate(`PW_reportError(\`Unexpected error during eval - See DEBUG CONSOLE in test execution environment for details\`, \`${JSON.stringify(error)}\`)`);
                console.error(error);
            }
        }
    }

    async function _evalCore(testFilename: string, evalScope: (s: string) => any, pageEvaluate: (pageFunction: string) => Promise<unknown>, testEval: string) {
        const s = testEval.replaceAll(/\bawait\b/g, ''); //hack - eval doesn't play well with awaits, ideally we'd transpile it into promises... but I don't know how to use `typescript` lib to do this
        //prepend imports from local test file into eval scope
        const testFileSource = await fs.readFile(testFilename, 'utf-8'); //todo: pass testFileSource into function since it's already loaded by the caller
        //ts.transpile(testFileSource) //todo: figure out how to use typescript to transpile `import` into `require` syntax
        const importToRequireRegex = /\bimport\b\s*({?\s*[^};]+}?)\s*from\s*([^;]*);?/g;
        const matches = [...testFileSource.matchAll(importToRequireRegex)];
        const imports = matches/* .filter(x => x[2] !== libraryName) */.map(x => `var ${x[1]} = require(${x[2]});`).join('\n');
        const hotReloadedPomsSourceCode = pageObjectModel.hotReloadedPomsSourceCode();
        try {
            await pageEvaluate(`PW_executing = true`);
            await evalScope(`${imports}\n${hotReloadedPomsSourceCode}\n${s}`); //todo, figure out if 'state e.g. globalThis' is a thing within eval contexts, return state and keep to to preload for the next eval
        } finally {
            await pageEvaluate(`PW_executing = false`);
        }
    }

    export async function writeLineToTestFile(t: TestCallingLocation, str: string, linesToOverwrite: number = 0) {
        const indentation = /(\s*)/.exec(t.executingLine)![1];
        const testFileSrcLines = (await fs.readFile(t.file, 'utf-8')).split(_NEWLINE);

        const testLineNumber = testFileSrcLines.indexOf(t.testLine);
        const insertLineNumber = testFileSrcLines.indexOf(t.executingLine, testLineNumber);

        testFileSrcLines.splice(insertLineNumber-linesToOverwrite, linesToOverwrite, `${indentation}${str}`);

        const newFileContent = testFileSrcLines.join('\n');
        await fs.writeFile(t.file, newFileContent);
        lastCommand = str;
    }

    const _NEWLINE = /\r\n|\n|\r/;
}

type TestCallingLocation = { file: string, testLine: string, executingLine: string };