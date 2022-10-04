import { ts, Project } from "ts-morph";
import * as nodePath from "node:path";

export module hotModuleReload {
    let testFilename: string;
    let testFnContents: string;
    
    export async function init(filename: string, testFnDecl: string, executingLine: string) {
        testFilename = filename;
        testFnContents = (await _extractFnContents(filename, testFnDecl, executingLine))!;
    }

    /** test file is a special case - we're not loading a module into the executing environment, instead we:
     * ensure all imports are included
     * given a test method starting line,
     * compare the new content with the old content to determine what needs to be executed
     */
    export async function reloadTestFile(filename: string, testFnDecl: string, executingLine: string, repl: (s: string) => Promise<void> | any) {
        const newTestFnContents = await (_extractFnContents(filename, testFnDecl, executingLine)) ?? '';

        const blockToExecute = _getBlockToExecute(testFnContents, newTestFnContents);
        //get script preamble: all the dependencies declared before the blockToExecute
        console.log({blockToExecute});
        await repl(`${_emitScriptPreamble(filename)}\n\n${_wrapAsyncAsPromise(blockToExecute, _extractVariableListFrom(blockToExecute))}`);

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

    export function _extractImports(filename: string) {
        //initialize the files in the project
        const project = new Project();
        const ast = project.addSourceFileAtPath(filename);

        //find the test function block within the test file
        const allImports = ast.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration);
        return allImports;
    }

    export function _emitScriptPreamble(filename: string) {
        const testFilename = nodePath.resolve(filename);
  
        let proj = new Project(); //todo: figure out options that make this faster...
        proj.addSourceFileAtPath(testFilename);
        const allFiles = proj.emitToMemory().getFiles().map(f => f.filePath.replace(/\.js$/, '.ts')); //get dependency graph in dependency order

        proj = new Project({compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false }});
        allFiles.forEach(path => proj.addSourceFileAtPath(path));
        
        proj.getSourceFiles().map(f => f.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration).forEach(x => x.remove())); //snip all interdependencies
        const r = proj.emitToMemory();
        const files = r.getFiles();
        
        const ambientCode = files
            .filter(f => nodePath.resolve(f.filePath).replace(/\.js$/, '.ts') !== testFilename) //exclude the test file from the ambient code
            .map(f => `//${f.filePath} transpiled\n${f.text.replace(/^export\s?/gm, '')}`)
            .join('\n\n');

        return ambientCode;
    }

    export function _wrapAsyncAsPromise(codeBlock: string, variables: string[]) {
        return `(async function() {
${codeBlock}
    //return { ${variables.join(', ')} };
    Object.assign(globalThis, { ${variables.join(', ')}});
})()`;
    }

    export function _extractVariableListFrom(blockToExecute: string) {
        const proj = new Project();
        const srcFile = proj.createSourceFile('./blockToExecute.ts', blockToExecute);
        const variableNames = srcFile.getChildrenOfKind(ts.SyntaxKind.VariableStatement).map(x => {
            const syntaxList = x.getChildren()[0].getChildren()[1];
            const assignmentStatement = blockToExecute.slice(syntaxList.compilerNode.pos, syntaxList.compilerNode.end);
            const varBlock = /\s*\{?(.+)\}?\s*=/.exec(assignmentStatement)![1];
            const listOfVars =  varBlock.trim().replace(/}$/m, '').split(',').map(x => x.trim());
            return listOfVars;
        });
        return variableNames.flat();
    }

    const _NEWLINE = /\r\n|\n|\r/;
}