import { test, Page } from "@playwright/test";
import * as chokidar from "chokidar";
import * as ErrorStackParser from "error-stack-parser";
import * as fs from "fs/promises";
import * as nodePath from "node:path";
import { hotModuleReload } from "./hotModuleReload";

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

        const watch = chokidar.watch(nodePath.resolve(testCallingLocation.file));
        watch.on('add', async path => await hotModuleReload.init(path, testCallingLocation.testLine, testCallingLocation.executingLine));
        watch.on('change', async path => await hotModuleReload.reloadTestFile(path, testCallingLocation.testLine, testCallingLocation.executingLine, (imports: string, inlinedDependencies: string, codeBlock: string) => _evalCore(evalScope, (str: string) => page.evaluate(str), imports, inlinedDependencies, codeBlock)));

        await page.exposeFunction('PW_appendToTest', async (testEval: string) => await repl.writeLineToTestFile(testCallingLocation, testEval));
        await page.exposeFunction('PW_updateAndRerunLastCommand', async (testEval: string) => await repl.writeLineToTestFile(testCallingLocation, testEval, repl.lastCommand?.split(_NEWLINE)?.length ?? 0));

        //todo, refactor with hotModuleReload code
        await page.exposeFunction('PW_eval', async (testEval: string) => await repl.TestingContext_eval(testCallingLocation, evalScope, (str: string) => page.evaluate(str), testEval));
    }

    export async function TestingContext_eval(t: TestCallingLocation, evalScope: (s: string) => any, pageEvaluate: (pageFunction: string) => Promise<unknown>, testEval: string) {
        try {
            const h = hotModuleReload;
            await _evalCore(evalScope, pageEvaluate, h._importToRequireSyntax(h._extractImports(t.file)), h._emitInlinedDependencies(t.file), h._wrapAsyncAsPromise(testEval, h._extractVariableListFrom(testEval)));
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

    async function _evalCore(evalScope: (s: string) => any, pageEvaluate: (pageFunction: string) => Promise<unknown>, imports: string, inlinedDependencies: string, codeBlock: string) {
        try {
            await pageEvaluate(`PW_executing = true`);
            await evalScope(`${imports}\n\n${inlinedDependencies}\n\n${codeBlock}`);
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