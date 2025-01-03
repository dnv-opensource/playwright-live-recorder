import { test } from "@playwright/test";
import ErrorStackParser from "error-stack-parser";
import fs from "fs/promises";
import url from "url";
import { TestCallingLocation } from "./types";

export async function getTestCallingLocation() {
    const testInfo = test.info();
    const fileUrl = url.pathToFileURL(testInfo.file).toString();
    const stack = ErrorStackParser.parse(new Error()).find(s => s.fileName === fileUrl)!;
    const testFileSrcLines = (await fs.readFile(testInfo.file, 'utf-8')).split(_NEWLINE);
    const testCallingLocation = <TestCallingLocation>{ file: testInfo.file, testLine: testFileSrcLines[testInfo.line - 1], testLineNumber: testInfo.line, executingLine: testFileSrcLines[stack.lineNumber! - 1] };
    return testCallingLocation;
}

export const _NEWLINE = /\r\n|\n|\r/;
