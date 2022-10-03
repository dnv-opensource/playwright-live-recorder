import * as ts from "typescript";
import * as nodePath from "node:path";
import { Project } from "ts-morph";


export module hotModuleReload {
    type TrackedFile = { path: string, transpiledContent: string };

    let testFilename: string;
    let testFnContents: string | undefined;
    
    const trackedFilesInDependencyOrder: {[path: string]: TrackedFile} = {};

    /** test file is a special case - we're not loading a module into the executing environment, instead we:
     * ensure all imports are included
     * given a test method starting line,
     * compare the new content with the old content to determine what needs to be executed
     */
    export async function reloadTestFile(filename: string, testFnDecl: string, executingLine: string, repl: (s: string) => Promise<void> | any) {
        testFilename = filename;
        if (testFnContents === undefined) { //first time in, nothing to execute, just cache it and return
            testFnContents = await _extractFnContents(filename, testFnDecl, executingLine);
            return;
        }

        const newTestFnContents = await (_extractFnContents(filename, testFnDecl, executingLine)) ?? '';

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
        //initialize the files in the project
        const project = new Project();
        const ast = project.addSourceFileAtPath(filename);

        const projectResult = project.emitToMemory();
        for (const x of projectResult.getFiles()) {
            trackedFilesInDependencyOrder[x.filePath] = { path: x.filePath, transpiledContent: x.text /* todo, clean this up so it works in eval context */ };
        }

        //find the test function block within the test file
        const allExpressions = ast.getChildrenOfKind(ts.SyntaxKind.ExpressionStatement);
        const fnNode = allExpressions.find(x => x.print().includes(fnDecl));
        if (fnNode == null) return undefined;

        //extract the function block after the declaration, before the executing line's text
        const fnBlock = fnNode.print();
        const wholeFunctionContents = fnBlock.slice(fnBlock.indexOf(fnDecl) + fnDecl.length, fnBlock.lastIndexOf('}') - 1).split(_NEWLINE);
        const functionContentsUpToExecutingLine = wholeFunctionContents.slice(0, wholeFunctionContents.indexOf(executingLine)).join('\n');
        return functionContentsUpToExecutingLine;
    }

    export function getDepsSource() {
        const transpiledTestFilename = testFilename.replaceAll('\\', '/').replace(/\.ts$/, '.js');
        return Object.values(trackedFilesInDependencyOrder).filter(x => x.path !== transpiledTestFilename).map(x => `//${x.path}\n${x.transpiledContent}`).join('\n\n\n');
    }

    const _NEWLINE = /\r\n|\n|\r/;
}