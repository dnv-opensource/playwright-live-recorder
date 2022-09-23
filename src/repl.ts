import { Page } from "@playwright/test";
import * as fs from "fs/promises";

//repl with write-to-test-file capabilities
export module repl {
    export var lastCommand: string = '';
    var commandLineCount = 0;

    export async function init(page: Page, evalScope: (s: string) => any){
        //get stacktrace to find startLiveCoding calling location (file and line)
        const callingLocationStr = new Error().stack!.split('\n')[3]; //line 0,1,2,3 3 is the immediate calling location of startLiveCoding
        const fileAndLineRegex = /    at (?:.+\()?(.+):(\d+):\d+\)?/.exec(callingLocationStr)!;
        const testCallingLocation = { file: fileAndLineRegex[1], line: +fileAndLineRegex[2] };

        await page.exposeFunction('PW_eval', (testEval: string, record = false) => repl.TestingContext_eval(testCallingLocation, evalScope, (str: string) => page.evaluate(str), testEval, record));

        await page.exposeFunction('PW_getLastCommand', () => repl.lastCommand);
        await page.exposeFunction('PW_updateAndRerunLastCommand', async (testEval: string) => await repl.TestingContext_eval(testCallingLocation, evalScope, (str: string) => page.evaluate(str), testEval, true, repl.lastCommand));
    }

    export async function TestingContext_eval(testCallingLocation: { file: string, line: number }, evalScope: (s: string) => any, pageEvaluate: (pageFunction: string) => Promise<unknown>, testEval: string, record = true, commandToOverwrite: string | undefined = undefined) {
        try {
            const s = testEval.replaceAll(/\bawait\b/g, ''); //hack - eval doesn't play well with awaits, ideally we'd transpile it into promises... but I don't know how to use `typescript` lib to do this
            //prepend imports from local test file into eval scope
            const testFileSource = await fs.readFile(testCallingLocation.file, 'utf-8');
            //ts.transpile(testFileSource) //todo: figure out how to use typescript to transpile `import` into `require` syntax
            const importToRequireRegex = /\bimport\b\s*({?\s*[^};]+}?)\s*from\s*([^;]*);?/g;
            const matches = [...testFileSource.matchAll(importToRequireRegex)];
            const imports = matches/* .filter(x => x[2] !== libraryName) */.map(x => `const ${x[1]} = require(${x[2]});`).join('\n');

            await evalScope(`${imports}\n${s}`);
            await pageEvaluate(`reportError()`);
            if (record) {
                await writeLineToTestFile(testCallingLocation, testEval, commandToOverwrite);
                commandLineCount += testEval.split('\n').length;
                lastCommand = testEval;
            }
        } catch (error) {
            if (error instanceof Error) {
                await pageEvaluate(`reportError(\`${error.message}\`, \`${error.stack}\`)`);
                console.warn(error);
            } else {
                await pageEvaluate(`reportError(\`Unexpected error during eval - See DEBUG CONSOLE in test execution environment for details\`, \`${JSON.stringify(error)}\`)`);
                console.error(error);
            }

            if (record) {
                await writeLineToTestFile(testCallingLocation, `//${testEval} // failed to execute`, commandToOverwrite);
                commandLineCount += testEval.split('\n').length;
                lastCommand = testEval;
            }
        }
    }

    export async function writeLineToTestFile(testCallingLocation: { file: string, line: number }, str: string, commandToOverwrite: string | undefined = undefined) {
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
    const _NEWLINE = /\r\n|\n|\r/;
}