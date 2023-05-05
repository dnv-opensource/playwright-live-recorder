import { ts, Project, ImportDeclaration } from "ts-morph";
import typescript from "typescript";
import nodePath from "node:path";
import chokidar from "chokidar";
import AsyncLock from "async-lock";
import fs from "node:fs/promises";
import _ from "lodash";

import { TestCallingLocation } from "./types";

type hotModuleReloadState = {
    t: TestCallingLocation;
    testFnContents: string;
    dependenciesWatcher: chokidar.FSWatcher;
    dependencies: InlinedDependencies;
    imports: ImportDeclaration[];
    pageEvaluate: (pageFunction: string) => Promise<unknown>;
    evalScope: (s: string) => any;
}

type InlinedDependency = { path: string, imports: ImportDeclaration[], transpiledSrc: string, index: number };
type InlinedDependencies = { [path: string]: InlinedDependency };

export module hotModuleReload {
    export const _state: hotModuleReloadState = <any>{};
    const lock = new AsyncLock();

    export async function init(testCallingLocation: TestCallingLocation, pageEvaluate: (pageFunction: string) => (Promise<unknown> | any), evalScope: (s: string) => any) {
        _state.t = testCallingLocation;
        _state.pageEvaluate = pageEvaluate;
        _state.evalScope = evalScope;
        _state.dependenciesWatcher = chokidar.watch([]);
        _state.dependenciesWatcher.on('change', async path => await _transpilePass(path, _state));
        _state.dependencies = {};

        await _initialTestFileLoad(_state);

        const testFileWatcher = chokidar.watch(nodePath.resolve(_state.t.file));
        testFileWatcher.on('change', async () => await hotModuleReload._reloadTestFile(_state));
    }

    export async function _initialTestFileLoad(s: hotModuleReloadState) {
        s.testFnContents = (await _extractFnContents(s.t.file, s.t.testLine, s.t.executingLine))!;
        s.imports = _extractImports(s.t.file);
        const depFiles = await _discoveryPass(s.t.file);
        s.dependenciesWatcher.add(depFiles);
        await _updateInlinedDependencies(depFiles, s.dependencies);
    }

    export async function _reloadTestFile(s: hotModuleReloadState) {
        await lock.acquire('reloadTestFile', async (release) => {
            try {
                //todo check if imports changed, if so add em
                //s.imports = _extractImports(s.t.file);
                //const depFiles = await _discoveryPass(s.t.file);
                //s.dependenciesWatcher.add(depFiles);
        
                const newTestFnContents = await (_extractFnContents(s.t.file, s.t.testLine, s.t.executingLine)) ?? '';
                const blockToExecute = _getBlockToExecute(s.testFnContents, newTestFnContents);
                if (blockToExecute === '')
                    return;

                console.debug({ blockToExecute });
                await evalLines(blockToExecute, s);
                s.testFnContents = newTestFnContents;
            } finally {
                release();
            }
        });
    }

    async function evalLines(lines: string, s: hotModuleReloadState) {
        s.imports = _extractImports(s.t.file); //refresh imports
        const { importsBlock, inlinedDependenciesBlock } = _buildEvalContext(s);
        const wrappedEvalLines = _wrapAsyncAsPromise(lines, _extractVariableListFrom(lines));

        await _evalCore(s.evalScope, s.pageEvaluate, [importsBlock + '\n\n', inlinedDependenciesBlock + '\n\n', wrappedEvalLines]);
    }

    export async function _updateInlinedDependencies(filenames: string[], deps: InlinedDependencies) {
        await Promise.all(filenames.map(async (f, index) => {
            if (deps[f] === undefined) deps[f] = await _buildInlinedDependency(f, index);
            else if (_importsChanged(deps[f])) deps[f] = await _buildInlinedDependency(f, index);
            else deps[f].index = index;
        }));
        const depsToRemove = _.difference(Object.keys(deps), filenames);
        depsToRemove.forEach(x => delete (deps[x]));
    }

    export function _importsChanged(dep: InlinedDependency) {
        let proj = new Project({ compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false, skipDefaultLibCheck: true } });
        const ast = proj.addSourceFileAtPath(dep.path);
        const imports = ast.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration);
        if (dep.imports.length !== imports.length)
            return true;

        const importsText = imports.map(x => x.compilerNode.getText());
        const cachedImportsText = dep.imports.map(x => x.compilerNode.getText());
        if (!importsText.every(x => cachedImportsText.includes(x)))
            return true;

        return false;
    }

    export async function _buildInlinedDependency(filename: string, index: number) {
        let src = await fs.readFile(filename, 'utf-8');

        let proj = new Project({ compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false, skipDefaultLibCheck: true } });
        const ast = proj.addSourceFileAtPath(filename);


        //strip the imports, add comment block around each one
        const imports = ast.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration);
        const exportKeywords = ast.getDescendantsOfKind(ts.SyntaxKind.ExportKeyword);

        let offset = 0;
        for (const x of imports) {
            const start = x.getStart();
            const end = x.getEnd();
            src = src.slice(0, start + offset) + '/*' + src.slice(start + offset, end + offset) + '*/' + src.slice(end + offset);
            offset += ('/*' + '*/').length;
        }
        for (const x of exportKeywords) {
            const start = x.getStart();
            const end = x.getEnd();
            src = src.slice(0, start + offset) + '/*' + src.slice(start + offset, end + offset) + '*/' + src.slice(end + offset);
            offset += ('/*' + '*/').length;
        }

        const result = typescript.transpileModule(src, { compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false, skipLibCheck: true } });
        let transpiledSrc = result.outputText;
        return <InlinedDependency>{ path: filename, imports, transpiledSrc: transpiledSrc, index };
    }

    function _buildEvalContext(s: hotModuleReloadState) {
        const excludedImports = Object.values(s.dependencies).map(x => nodePath.normalize(nodePath.relative(nodePath.dirname(s.t.file), x.path)).replace(/\.ts$/m, ''));
        const importsBlock = _importToRequireSyntax(s.imports.filter(i => !excludedImports.includes(_getImportPath(i))));
        const inlinedDependenciesBlock = Object.values(s.dependencies).map(x => x.transpiledSrc).join('\n\n');
        return { importsBlock, inlinedDependenciesBlock };
    }
    function _importToRequireSyntax(imports: ImportDeclaration[]) {
        return imports.map(x => x.print().replace(/\bimport\b\s*({?\s*[^};]+}?)\s*from\s*([^;]*);?/, 'var $1 = require($2);')).join('\n');
    }
    function _getImportPath(i: ImportDeclaration) {
        return nodePath.normalize(i.getChildren()[3].print().replace(/['"`]/gm, ''));
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

    export async function _evalCore(evalScope: (s: string) => any, pageEvaluate: (pageFunction: string) => Promise<unknown>, codeBlocks: string[]) {
        try {
            await pageEvaluate(`window.PW_executing = true`);
            await evalScope(codeBlocks.join(''));
            await pageEvaluate(`PW_reportError()`);
        } catch (error) {
            if (error instanceof Error) {
                await pageEvaluate(`PW_reportError(\`${error.message}\`, \`${error.stack}\`)`);
                console.warn(error);
            } else {
                await pageEvaluate(`PW_reportError(\`Unexpected error during eval - See DEBUG CONSOLE in test execution environment for details\`, \`${JSON.stringify(error)}\`)`);
                console.error(error);
            }
        } finally {
            await pageEvaluate(`window.PW_executing = false`);
        }
    }

    export function _extractImports(filename: string) {
        const project = new Project();
        const ast = project.addSourceFileAtPath(filename);
        const allImports = ast.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration);
        return allImports;
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

    export async function _discoveryPass(filename: string) {
        filename = nodePath.resolve(filename);
        let proj = new Project({ compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false, skipDefaultLibCheck: true } });
        proj.addSourceFileAtPath(filename);
        const allFiles = proj.emitToMemory().getFiles().map(f => f.filePath.replace(/\.js$/, '.ts')); //get dependency graph in dependency order
        return allFiles
            .map(f => nodePath.resolve(f))
            .filter(f => f !== filename); //exclude the top level test file itself in dependencies
    }

    export async function _transpilePass(filename: string, s: hotModuleReloadState) {
        filename = nodePath.resolve(filename);
        const cached = s.dependencies[filename];
        if (_importsChanged(cached)) {
            const depFiles = await _discoveryPass(s.t.file);
            s.dependenciesWatcher.add(depFiles);
            await _updateInlinedDependencies(depFiles, s.dependencies);
            return;
        }
        s.dependencies[filename] = await _buildInlinedDependency(cached.path, cached.index);
    }

    const _NEWLINE = /\r\n|\n|\r/;
}