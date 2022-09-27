import * as _ from "lodash";
import * as fs from "fs/promises";
import * as nodePath from "node:path";
import * as ts from "typescript";
import * as chokidar from "chokidar";
import { PlaywrightLiveRecorderConfig_pageObjectModel } from "./types";
import { Page } from "@playwright/test";

const TrackedPoms: { [name: string]: PomEntry } = {};

export interface PomEntry {
    name: string;
    deps: string[];
    content: string;
    isLoaded: boolean;
}

//scans and watches page object model files, transpiles and exposes page object models to the browser context
export module pageObjectModel {
    export async function init(config: PlaywrightLiveRecorderConfig_pageObjectModel, page: Page) {
        await page.exposeFunction('PW_urlToFilePath', (url: string) => config.urlToFilePath(url));
        
        await page.exposeFunction('PW_ensurePageObjectModelCreated', (path: string) => _ensurePageObjectModelCreated(fullRelativePath(path, config), classNameFromPath(path)));
        await page.exposeFunction('PW_appendToPageObjectModel', (path: string, codeBlock: string) => _appendToPageObjectModel(fullRelativePath(path, config), classNameFromPath(path), codeBlock));

        const watch = chokidar.watch(`${config.filenameConvention}`, { cwd: config.path });
        
        //note: watch.getWatched is empty so we can't init all here, instead the individual page reload process ensures everything is loaded
        watch.on('add', path => reload(path, config.path, page));
        watch.on('change', path => reload(path, config.path, page));
    }

    export async function reload(path: string, config_pageObjectModel_path: string, page: Page) {
        const pom = await _reload(path, config_pageObjectModel_path);
        TrackedPoms[pom.name] = pom;
        await _attemptLoadPom(pom, page);
        await page.evaluate('reload_page_object_model_elements()');
    }

    export async function _attemptLoadPom(pom: PomEntry, page: Page) {
        if (pom.deps.some(dep => TrackedPoms[dep]?.isLoaded !== true))
            return; //not all dependencies are loaded, don't load the script yet, it'll get automatically loaded when the last thing it's dependent upon is loaded

        try {
            await page.addScriptTag({ content: pom.content });
            pom.isLoaded = true; //it loaded successfully, mark it as loaded

            //attempt reload of any TrackedPoms dependent upon it
            for (const otherPom of _.filter(TrackedPoms, (otherPom) => otherPom.name !== pom.name && otherPom.deps.includes(pom.name)))
                await _attemptLoadPom(otherPom, page);
        } catch (e) {
            console.error(`error calling page.addScriptTag for pom ${pom.name}`);
            throw e; //todo: check if this causes recorder to stop working, if so, console log the error instead of rethrowing
        }
    }

    export async function _reload(path: string, config_pageObjectModel_path: string) {
        const fileContents = await fs.readFile(`${config_pageObjectModel_path}${path}`, { encoding: 'utf8' });
        const className = /\\?([^\\]+?)\.ts/.exec(path)![1]; //extract filename without extension as module name

        const pom = _transpile(path.replaceAll('\\', '/'), className, fileContents);
        return pom;
    }

    export function _transpile(normalizedFilePath: string, className: string, fileContents: string): PomEntry {
        const transpiled = ts.transpile(fileContents, { module: ts.ModuleKind.ESNext, strict: false });
        const deps = _getDeps(transpiled);
        const content = _cleanUpTranspiledSource(normalizedFilePath, className, transpiled);
        return { name: className, deps, content, isLoaded: false };
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

    async function _appendToPageObjectModel(fullRelativePath: string, className: string, codeBlock: string) {
        await _ensurePageObjectModelCreated(fullRelativePath, className);
        try {
            let content = await fs.readFile(fullRelativePath, 'utf-8');
            const position_endOfClass = content.lastIndexOf('}');
            const before = content.slice(0, position_endOfClass - 1);
            const after = content.slice(position_endOfClass - 1);
            content =  before + codeBlock + after;
            await fs.writeFile(fullRelativePath, content);
        } catch (error) {
            /*todo: bubble up error */
        }
    }

    async function _ensurePageObjectModelCreated(fullRelativePath: string, className: string) {
        try {
            await fs.mkdir(nodePath.dirname(fullRelativePath), { recursive: true });
            await fs.writeFile(fullRelativePath, _defaultClassTemplate(className), { flag: 'wx'}); //if file is non-existant emit the standard template
        } catch (error) {
            if ((<any>error).code === 'EEXIST') return;
            throw error;
        }
    }
    function _defaultClassTemplate(className: string) {
return `import { Page } from "@playwright/test";

export class ${className} {

}
`;
    }

    function classNameFromPath(path: string) { return /([^/]+).ts/.exec(path)![1]; }
    function fullRelativePath(path: string, config: { path: string }) { return nodePath.join(config.path, path); }
}
