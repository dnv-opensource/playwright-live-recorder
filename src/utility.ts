import { test } from "@playwright/test";
import ErrorStackParser from "error-stack-parser";
import fs from "fs/promises";
import path from "node:path";
import url from "node:url";
import { TestCallingLocation } from "./types";

export async function getTestCallingLocation() {
    const testInfo = test.info();
    const testInfoFile = path.normalize(testInfo.file);
    const fileUrl = url.pathToFileURL(testInfoFile).toString();
    const stack = ErrorStackParser.parse(new Error()).find(s => s.fileName === fileUrl)!;
    const testFileSrcLines = (await fs.readFile(testInfoFile, 'utf-8')).split(_NEWLINE);
    const testCallingLocation = <TestCallingLocation>{ file: testInfoFile, testLine: testFileSrcLines[testInfo.line - 1], testLineNumber: testInfo.line, executingLine: testFileSrcLines[stack.lineNumber! - 1] };
    return testCallingLocation;
}

export const _NEWLINE = /\r\n|\n|\r/;
