import * as fs from "node:fs/promises";
import * as ts from "typescript";
import { Project } from "ts-morph";


export module hotModuleReload {
    let testFnContents: string|undefined;

    /** test file is a special case - we're not loading a module into the executing environment,instead we:
     * ensure all imports are included
     * given a test method starting line,
     * compare the new content with the old content to determin what needs to be executed
     */
    export async function reloadTestFile(filename: string, testFnDecl: string, executingLine: string, repl: (s: string) => Promise<void>|any) {
        if(testFnContents === undefined) { //first time in, nothing to execute, just cache it and return
            testFnContents = await _extractFnContents(filename, testFnDecl, executingLine);
            return;
        }

        const newTestFnContents = await(_extractFnContents(filename, testFnDecl, executingLine)) ?? '';
        
        const blockToExecute = _getBlockToExecute(testFnContents, newTestFnContents);
        await repl(blockToExecute);

        testFnContents = newTestFnContents;
    }

    export function _getBlockToExecute(oldSrc: string, newSrc: string) {
        const oldLines = oldSrc.split(_NEWLINE);
        const newLines = newSrc.split(_NEWLINE);
        
        if (oldLines.length == 0) return newSrc;
        const firstLineWithChange = newLines.find((s, index) => oldLines.length < index || oldLines[index] !== s);
        if (firstLineWithChange == null) return '';
        
        const linesToExecute = newLines.slice(newLines.indexOf(firstLineWithChange));

        const blockToExecute = linesToExecute.join('\n');
        return blockToExecute;
    }

    export async function _extractFnContents(filename: string, fnDecl: string, executingLine: string) {
        const project = new Project();

        const ast = project.addSourceFileAtPath(filename);
        const src = await fs.readFile(filename, 'utf-8');
        const allExpressions = ast.getChildrenOfKind(ts.SyntaxKind.ExpressionStatement);
      
        const fnNode = allExpressions.find(x => src.slice(x.compilerNode.pos, x.compilerNode.end).includes(fnDecl));

        if (fnNode == null)  return undefined;

        const fnBlock = src.slice(fnNode.compilerNode.pos, fnNode.compilerNode.end);
        const wholeFunctionContents = fnBlock.slice(fnBlock.indexOf(fnDecl) + fnDecl.length, fnBlock.lastIndexOf('}') - 1).split(_NEWLINE);
        const functionContentsUpToExecutingLine = wholeFunctionContents.slice(0, wholeFunctionContents.indexOf(executingLine)).join('\n');
        return functionContentsUpToExecutingLine;
    }
    
    const _NEWLINE = /\r\n|\n|\r/;
}