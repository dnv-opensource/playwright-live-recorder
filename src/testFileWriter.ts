import { Page } from "@playwright/test";
import * as fs from "fs/promises";
import { Project, ts } from "ts-morph";
import { TestCallingLocation } from "./types";

export module testFileWriter {
    export async function init(page: Page, testCallingLocation: TestCallingLocation) {
        await page.exposeFunction('PW_appendToTest', async (testEval: string, importStatement: string|undefined) => await _appendToTest(testCallingLocation, testEval, importStatement));
    }

    export async function _appendToTest(t: TestCallingLocation, str: string, importStatement: string|undefined = undefined) {
        const indentation = /(\s*)/.exec(t.executingLine)![1];
        const testFileSrcLines = (await fs.readFile(t.file, 'utf-8')).split(_NEWLINE);

        if (importStatement !== undefined && !testFileSrcLines.includes(importStatement)){
            let proj = new Project({ compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false, skipDefaultLibCheck: true } });
            const ast = proj.addSourceFileAtPath(t.file);
            const imports = ast.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration);
            const lastImportLine = Math.max(...imports.map(i => i.getEndLineNumber()));
            testFileSrcLines.splice(lastImportLine + 1, 0, importStatement);
        }

        const testLineNumber = testFileSrcLines.indexOf(t.testLine);
        const insertLineNumber = testFileSrcLines.indexOf(t.executingLine, testLineNumber);

        testFileSrcLines.splice(insertLineNumber, 0, `${indentation}${str}`);

        const newFileContent = testFileSrcLines.join('\n');
        await fs.writeFile(t.file, newFileContent);
    }
    const _NEWLINE = /\r\n|\n|\r/;
}

