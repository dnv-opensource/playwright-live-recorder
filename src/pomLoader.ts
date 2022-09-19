import * as _ from "lodash";
import * as fs from "fs/promises";
import * as ts from "typescript";
import { Page } from "@playwright/test";

export module pomLoader {
    export async function loadAll(allFiles: { [directory: string]: string[] }, config_pageObjectModel_path: string, page: Page) {
        const allPaths = await _getAllPaths(allFiles);
        const poms: { deps: string[], name: string, content: string }[] = [];
        for (const path of allPaths) poms.push(await _reload(path, config_pageObjectModel_path));
        await _loadAll(poms, async x => { await page.addScriptTag(x); })
    }

    export async function _getAllPaths(allFiles: { [directory: string]: string[] }) {
        const paths: string[] = [];
        for (const directory in allFiles)
            for (const file in allFiles[directory])
                paths.push(`${directory}\\${file}`);
        return paths;
    }

    export async function reload(path: string, config_pageObjectModel_path: string, page: Page) {
        const pom = await _reload(path, config_pageObjectModel_path);
        await page.addScriptTag({ content: pom.content });
    }

    export async function _reload(path: string, config_pageObjectModel_path: string) {
        const fileContents = await fs.readFile(`${config_pageObjectModel_path}${path}`, { encoding: 'utf8' });
        const className = /\\([^\\]+?)\.ts/.exec(path)![1]; //extract filename without extension as module name

        const pom = _transpile(path.replaceAll('\\', '/'), className, fileContents);
        return pom;
    }


    export async function _loadAll(poms: { deps: string[], name: string, content: string }[], addScriptTag: (pom: { content: string }) => Promise<void>) {
        const loadedDeps = [];
        //add scripts to page in dependency order
        do {
            const pom = poms[0];
            if (_.difference(pom.deps, loadedDeps).length > 0) { //still need to load more deps
                poms.push(pom);//push it to the end
            } else {
                await addScriptTag({ content: pom.content });
                loadedDeps.push(pom.name);
            }
            poms.splice(0, 1); //pop item off the head of the list, move everything down            
        } while (poms.length > 0)
    }


    export function _transpile(normalizedFilePath: string, className: string, fileContents: string) {
        const transpiled = ts.transpile(fileContents, { module: ts.ModuleKind.ESNext, strict: false });
        const deps = _getDeps(transpiled);
        const content = _cleanUpTranspiledSource(normalizedFilePath, className, transpiled);
        return { deps, name: className, content };
    }

    export function _getDeps(transpiled: string) {
        //todo: replace hardcoded string replacements with using typescript lib to walk to AST instead
        const deps = [...transpiled.matchAll(/\bimport\b\s*{?(\s*[^};]+)}?\s*from\s*([^;]*);?/g)].map(i => i[1].split(',').map(i => i.trim())).flat(); //fetch the variable names
        return deps;
    }

    export function _cleanUpTranspiledSource(normalizedFilePath: string, className: string, transpiled: string) {
        //todo: replace hardcoded string replacements with using typescript lib to walk to AST instead
        const exportReplacementText = `window.PW_pages['${normalizedFilePath}'] = {className: '${className}', page: ${className} };`;
        const content = transpiled
            //.replaceAll(/\bimport\b\s*({?\s*[^};]+}?)\s*from\s*([^;]*);?/g, 'const $1 = require($2);') //convert 'import' to 'require' statements
            .replaceAll(/\bimport\b\s*({?\s*[^};]+}?)\s*from\s*([^;]*);?/g, '') //remove all (local) import statements //todo: extract and track local imports to create a dependency order/hierarchy
            .replace(`var ${className} = /** @class */ (function () {\r\n    function ${className}() {\r\n    }`, `var ${className} = {};`) //export class fixup
            .replace(`    return ${className};\r\n}());\r\nexport { ${className} };`, exportReplacementText)                                //export class fixup
            .replace(`export var ${className};`, exportReplacementText) //export module fixup
        return content;
    }
}