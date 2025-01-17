import { ts, Project, ImportDeclaration } from "ts-morph";
import nodePath from "node:path";
import chokidar from "chokidar";
import AsyncLock from "async-lock";
import fs from "node:fs/promises";
import { register } from "node:module";

import { TestCallingLocation } from "./types";

type hotModuleReloadState = {
    t: TestCallingLocation;
    testFnContents: string;
    imports: ImportDeclaration[];
    pageEvaluate: (pageFunction: string) => Promise<unknown>;
    evalScope: (s: string) => any;
}

export module hotModuleReload {
    export const _state: hotModuleReloadState = <any>{};
    const lock = new AsyncLock();

    export async function init(testCallingLocation: TestCallingLocation, importerCustomizationHooks: string, pageEvaluate: (pageFunction: string) => (Promise<unknown> | any), evalScope: (s: string) => any) {
        _state.t = testCallingLocation;
        _state.pageEvaluate = pageEvaluate;
        _state.evalScope = evalScope;

        register(importerCustomizationHooks);
        await _initialTestFileLoad(_state);

        const testFileWatcher = chokidar.watch(nodePath.resolve(_state.t.file));
        testFileWatcher.on('change', async () => await hotModuleReload._reloadTestFile(_state));
    }

    export async function _initialTestFileLoad(s: hotModuleReloadState) {
        s.testFnContents = (await _extractFnContents(s.t.file, s.t.testLine, s.t.testLineNumber, s.t.executingLine))!;
        s.imports = _extractImports(s.t.file);
    }

    export async function _reloadTestFile(s: hotModuleReloadState) {
        await lock.acquire('reloadTestFile', async (release) => {
            try {
                s.imports = _extractImports(s.t.file);        
                const newTestFnContents = await (_extractFnContents(s.t.file, s.t.testLine, s.t.testLineNumber, s.t.executingLine)) ?? '';
                const blockToExecute = _getBlockToExecute(s.testFnContents, newTestFnContents);
                s.testFnContents = newTestFnContents;
                if (blockToExecute === '')
                    return;
                await evalLines(blockToExecute);
            } finally {
                release();
            }
        });
    }

    async function evalLines(lines: string) {
        const importsBlock = _rewriteAsDynamicImports(_state.imports).join('\n');
        const wrappedEvalLines = _wrapAsyncAsPromise(importsBlock + '\n\n' + lines, _extractVariableListFrom(lines));
        return _evalCore(_state.evalScope, _state.pageEvaluate, wrappedEvalLines, lines);
    }

    function _rewriteAsDynamicImports(imports: ImportDeclaration[]) 
    {
        return imports.map(importDecl => {
            const namedImports = importDecl.getNamedImports().map(namedImport => namedImport.getName()).join(', ');
            const moduleSpecifier = importDecl.getModuleSpecifier().getLiteralText();
            return `${(namedImports.length > 0) ? `const { ${namedImports} } = ` : ''} await import('${moduleSpecifier}');`;
        });
    }

    export function _wrapAsyncAsPromise(codeBlock: string, variables: string[]) {
        return `(async function() {
  try {
${codeBlock}
${variables.length === 0 ? `` : `Object.assign(globalThis, { ${variables.join(', ')}});`}
  } catch (err) {
    console.error(err);
  }
})()`;
    }

    export function _extractVariableListFrom(blockToExecute: string) {
        const proj = new Project();
        const srcFile = proj.createSourceFile('./blockToExecute.ts', blockToExecute);
        const variableNames = srcFile.getChildrenOfKind(ts.SyntaxKind.VariableStatement).map(x => {
            const syntaxList = x.getChildren()[0].getChildren()[1];
            const assignmentStatement = blockToExecute.slice(syntaxList.compilerNode.pos, syntaxList.compilerNode.end);
            const varBlock = /\s*\{?(.+)\}?\s*=/.exec(assignmentStatement)![1];
            const listOfVars = varBlock.trim().replace(/}$/m, '').split(',').map(x => x.trim());
            return listOfVars;
        });
        return variableNames.flat();
    }

    let _evalCoreCount = 1;
    export async function _evalCore(evalScope: (s: string) => any, pageEvaluate: (pageFunction: string) => Promise<unknown>, codeBlock: string, codeBlockDescription: string) {
        const i = _evalCoreCount++;
        
        let result;
        try {
            await pageEvaluate(`PW_callback_begin_executing(${i}, \`${codeBlockDescription}\`, \`${codeBlock}\`)`);
            result = await evalScope(codeBlock);
            await pageEvaluate(`PW_callback_finished_executing(${i}, true, ${JSON.stringify(result)}, \`${codeBlockDescription}\`, \`${codeBlock}\`)`);
        } catch (error) {
            if (error instanceof Error) {
                await pageEvaluate(`PW_callback_finished_executing(${i}, false, ${error.message}, \`${codeBlockDescription}\`, \`${codeBlock}\`)`);
                console.warn(error);
            } else {
                await pageEvaluate(`PW_callback_finished_executing(${i}, false, \`${JSON.stringify(error)}\`, \`${codeBlockDescription}\`, \`${codeBlock}\`)`);
                console.error(error);
            }
        }
        return result;
    }

    export function _extractImports(filename: string) {
        const project = new Project();
        const ast = project.addSourceFileAtPath(filename);
        const allImports = ast.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration);
        return allImports;
    }

    export async function _extractFnContents(filename: string, fnDecl: string, fnDeclLineNumber: number, executingLine: string) {
        const src = (await fs.readFile(filename, 'utf-8'));
        const fnDeclIndex = src.indexOf(fnDecl); if (fnDeclIndex === -1) return undefined;
        const endIndex = src.indexOf(executingLine, fnDeclIndex! + fnDecl.length); if (endIndex === -1) return undefined;
        const fnContents = src.slice(fnDeclIndex! + fnDecl.length, endIndex);
        return fnContents;
    }

    export function _getBlockToExecute(oldSrc: string, newSrc: string) {
        if (oldSrc === undefined) return '';

        const oldLines = oldSrc.split(_NEWLINE);
        const newLines = newSrc.split(_NEWLINE);

        if (oldLines.length == 0) return newSrc;
        const firstLineWithChange = newLines.find((s, index) => oldLines.length < index || oldLines[index] !== s);
        if (firstLineWithChange == null) return '';

        const linesToExecute = newLines.slice(newLines.indexOf(firstLineWithChange));

        const blockToExecute = linesToExecute.join('\n');
        return blockToExecute;
    }

    const _NEWLINE = /\r\n|\n|\r/;
}