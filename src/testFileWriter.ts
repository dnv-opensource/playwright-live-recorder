import { Page } from "@playwright/test";
import * as fs from "fs/promises";
import { TestCallingLocation } from "./types";

export module testFileWriter {
    export async function init(page: Page, testCallingLocation: TestCallingLocation) {
        await page.exposeFunction('PW_appendToTest', async (testEval: string) => await _appendToTest(testCallingLocation, testEval));
    }

    export async function _appendToTest(t: TestCallingLocation, str: string) {
        const indentation = /(\s*)/.exec(t.executingLine)![1];
        const testFileSrcLines = (await fs.readFile(t.file, 'utf-8')).split(_NEWLINE);

        const testLineNumber = testFileSrcLines.indexOf(t.testLine);
        const insertLineNumber = testFileSrcLines.indexOf(t.executingLine, testLineNumber);

        testFileSrcLines.splice(insertLineNumber, 0, `${indentation}${str}`);

        const newFileContent = testFileSrcLines.join('\n');
        await fs.writeFile(t.file, newFileContent);
    }
    const _NEWLINE = /\r\n|\n|\r/;
}

