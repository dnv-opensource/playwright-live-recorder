import _ from "lodash";
import fs from "fs/promises";
import process from "node:process";
import nodePath from "node:path";
import chokidar from "chokidar";
import { PlaywrightLiveRecorderConfig_pageObjectModel } from "./types";
import { Page } from "@playwright/test";
import AsyncLock from "async-lock";
import { ModuleKind, Project, SyntaxKind } from "ts-morph";

//scans and watches page object model files, transpiles and exposes page object models to the browser context
export module pageObjectModel {
    export let _state: {
        testFileDir: string,
        config: PlaywrightLiveRecorderConfig_pageObjectModel,
        evalScope: (s: string) => Promise<any>,
        page: Page,
    } = <any>{};
    let currentPageFilePath!: string;
    let currentPageFilePathWatcher!: chokidar.FSWatcher;
    
    const lock = new AsyncLock();
    export async function init(testFileDir: string, config: PlaywrightLiveRecorderConfig_pageObjectModel, evalScope: (s: string) => any, page: Page) {
        _state = {testFileDir, config, evalScope, page};

        await page.exposeFunction('PW_urlToFilePath', async (url: string) => {
            const newfilePath = config.urlToFilePath(url, config.aliases);
            if (newfilePath === currentPageFilePath) return currentPageFilePath;
            currentPageFilePath = newfilePath;

            await currentPageFilePathWatcher?.close();
            currentPageFilePathWatcher = chokidar.watch(currentPageFilePath, { cwd: config.path })
                .on(   'add', /*path*/() => reload(page))
                .on('change', /*path*/() => reload(page));
    
            return currentPageFilePath;
        });

        await page.exposeFunction('PW_importStatement', (className: string, pathFromRoot: string) => _importStatement(className, nodePath.join(process.cwd(), _state.config.path, pathFromRoot), _state.testFileDir));
        
        await page.exposeFunction('PW_ensurePageObjectModelCreated', (path: string) => _ensurePageObjectModelCreated(fullRelativePath(path, config), classNameFromPath(path), config));
        await page.exposeFunction('PW_appendToPageObjectModel', (path: string, codeBlock: string) => _appendToPageObjectModel(fullRelativePath(path, config), classNameFromPath(path), codeBlock, config));
    }

    export function _importStatement(className: string, pathFromRoot: string, testFileDir: string) {
        const x = nodePath.parse(nodePath.relative(testFileDir, pathFromRoot));
        let importPath = nodePath.join(x.dir, x.name).replaceAll('\\', '/'); // relative path without extension
        if (!(importPath.startsWith('.') || importPath.startsWith('/'))) importPath = './' + importPath;
        return `import { ${className} } from '${importPath}';`
    }

    export async function reload(page: Page) {
        await lock.acquire('reload', async (release) => {
            try {
                const f = nodePath.parse(currentPageFilePath);
                const absolutePath = nodePath.join(process.cwd(), _state.config.path, f.dir, f.base);
                
                //use ts-morph to parse helper methods including args
                const project = new Project({ tsConfigFilePath: 'tsconfig.json' });
                const sourceFile = project.addSourceFileAtPath(absolutePath);

                const exportedClass = sourceFile.getClasses().find(cls => cls.isExported());
                if (exportedClass === undefined) return;

                const staticProperties = exportedClass?.getStaticProperties();
                const staticMethods = exportedClass?.getStaticMethods();
                
                //use dynamic import to evaluate selector property values
                const importPath = absolutePath.replaceAll('\\', '/'); // absolute path with extension
                const importResult = (await _state.evalScope(`(async function() {
                    try {
                      const temporaryEvalResult = await import('${importPath}');
                      return temporaryEvalResult;
                    } catch (err) {
                      console.error(err);
                    }
                  })()`));
                const classInstance = Object.entries(<any>importResult)[0][1] as Function;
                
                const selectorPropertyValues = _(Object.keys(classInstance).filter(key => _state.config.propertySelectorRegex.test(key))).keyBy(x => x).mapValues(key => (<any>classInstance)[key]).value();
                
                const selectorProperties = staticProperties.filter(prop => _state.config.propertySelectorRegex.test(prop.getName()))
                    .map(prop => {
                        const name = prop.getName();
                        const selector = selectorPropertyValues[name];
                        const selectorMethodName = _state.config.propertySelectorRegex.exec(name)?.[1];
                        const selectorMethodNode = staticMethods.find(m => m.getName() === selectorMethodName);
                        const selectorMethod = selectorMethodNode ? { name: selectorMethodNode.getName(), args: selectorMethodNode.getParameters().map(p => p.getName()), body: selectorMethodNode.getText() } : { name: selectorMethodName, args: [], body: ''};
                        return { name, selector: selector, selectorMethod };
                    });
                const helperMethods = staticMethods.filter(m => !selectorProperties.some(p => m.getName() === _state.config.propertySelectorRegex.exec(p.name)?.[1]))
                    .map(method => ({name: method.getName(), args: method.getParameters().map(p => p.getName()), body: method.getText()}));

                const evalString = `window.PW_pages[\`${currentPageFilePath}\`] = { className: '${exportedClass.getName()}', selectors: ${JSON.stringify(selectorProperties)}, methods: ${JSON.stringify(helperMethods)}}`;
                await page.evaluate(evalString);
            } catch (e) {
                console.error(`error calling page.addScriptTag for page object model ${currentPageFilePath}`);
                console.error(e);
            }
    
            await page.evaluate('reload_page_object_model_elements()');
            release();
        });
    }

    async function _appendToPageObjectModel(fullRelativePath: string, className: string, codeBlock: string, config: { generateClassTemplate: (className: string) => string}) {
        await _ensurePageObjectModelCreated(fullRelativePath, className, config);
        try {
            let content = await fs.readFile(fullRelativePath, 'utf-8');
            const position_endOfClass = content.lastIndexOf('}');
            const before = content.slice(0, position_endOfClass - 1);
            const after = content.slice(position_endOfClass - 1);
            content =  before + codeBlock + after;
            await fs.writeFile(fullRelativePath, content);
        } catch (error) {
            console.error(error);
        }
    }

    async function _ensurePageObjectModelCreated(fullRelativePath: string, className: string, config: { generateClassTemplate: (className: string) => string}) {
        try {
            await fs.mkdir(nodePath.dirname(fullRelativePath), { recursive: true });
            await fs.writeFile(fullRelativePath, config.generateClassTemplate(className), { flag: 'wx'}); //if file is non-existant emit the standard template
        } catch (error) {
            if ((<any>error).code === 'EEXIST') return;
            console.error(error);
        }
    }
    
    function classNameFromPath(path: string) { return /([^/]+).ts/.exec(path)![1]; }
    function fullRelativePath(path: string, config: { path: string }) { return nodePath.normalize(nodePath.join(config.path, path)); }

    export async function reloadAll(configPath: string, page: Page) {
        if (!currentPageFilePath) return;
        await reload(page);
    }
}
