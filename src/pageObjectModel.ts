import _ from "lodash";
import fs from "fs/promises";
import process from "node:process";
import nodePath from "node:path";
import chokidar from "chokidar";
import { PlaywrightLiveRecorderConfig_pageObjectModel } from "./types";
import { Page } from "@playwright/test";
import AsyncLock from "async-lock";
import { Project } from "ts-morph";
import { createQueuedRunner } from "./utility";

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
    let _project: Project;
    
    const lock = new AsyncLock();
    export async function init(testFileDir: string, config: PlaywrightLiveRecorderConfig_pageObjectModel, evalScope: (s: string) => any, page: Page) {
        _state = {testFileDir, config, evalScope, page};

        await page.exposeFunction('PW_urlToFilePath', async (url: string) => PW_urlToFilePath(url));

        await page.exposeFunction('PW_importStatement', (className: string, pathFromRoot: string) => _importStatement(className, nodePath.join(process.cwd(), _state.config.path, pathFromRoot), _state.testFileDir));
        
        await page.exposeFunction('PW_ensurePageObjectModelCreated', (path: string) => _ensurePageObjectModelCreated(fullRelativePath(path, config), classNameFromPath(path), config));
        await page.exposeFunction('PW_appendToPageObjectModel', (path: string, codeBlock: string) => _appendToPageObjectModel(fullRelativePath(path, config), classNameFromPath(path), codeBlock, config));
    }

    export async function PW_urlToFilePath(url: string) {
        const newfilePath = _state.config.urlToFilePath(url, _state.config.aliases);
        if (newfilePath === currentPageFilePath) return currentPageFilePath;
        currentPageFilePath = newfilePath;

        await reload(_state.page);
        return currentPageFilePath;
    }

    export function _importStatement(className: string, pathFromRoot: string, testFileDir: string) {
        const x = nodePath.parse(nodePath.relative(testFileDir, pathFromRoot));
        let importPath = nodePath.join(x.dir, x.name).replaceAll('\\', '/'); // relative path without extension
        if (!(importPath.startsWith('.') || importPath.startsWith('/'))) importPath = './' + importPath;
        return `import { ${className} } from '${importPath}';`
    }

    export const reload = createQueuedRunner(async (page) => reload2(page));
    
    export async function reload2(page: Page) {
        console.time('pageObjectModel.reload');
        await lock.acquire('reload', async (release) => {
            try {
                _project = _project ?? new Project({ tsConfigFilePath: await fs.access(nodePath.join(process.cwd(), 'tsconfig.json')).then(() => true).catch(() => false) ? 'tsconfig.json' : undefined });
                const filePathsToWatch = await _reload(page, [_state.config.globalPageFilePath, currentPageFilePath], _project);
                
                await currentPageFilePathWatcher?.close();
                const cwd = nodePath.join(process.cwd(), _state.config.path);
                currentPageFilePathWatcher = chokidar.watch(filePathsToWatch, { cwd, ignoreInitial: true })
                    .on(   'add', /*path*/() => reload(_state.page))
                    .on('change', /*path*/() => reload(_state.page));

                await page.evaluate('if (reload_page_object_model_elements) reload_page_object_model_elements()');
            } catch (e) {
                console.error(`error calling page.addScriptTag for page object model ${currentPageFilePath}`);
                console.error(e);
                await page.evaluate('if (reload_page_object_model_elements) reload_page_object_model_elements()');
            } finally {
                release();
            }
        });
        console.timeEnd('pageObjectModel.reload');
    }

    async function _reload(page: Page, filePaths: string[], project?: Project) {
        const all = await Promise.all(filePaths.map(async filePath => {
            const parsed = nodePath.parse(filePath);
            const absolutePath = nodePath.join(process.cwd(), _state.config.path, parsed.dir, parsed.base);
            const exists = fs.access(absolutePath).then(() => true).catch(() => false);
            return ({ filePath, parsed, absolutePath, exists });
        }));

        const existingPaths = all.filter(x => x.exists);
        if (existingPaths.length === 0) return [];

        project = project ?? new Project({ tsConfigFilePath: await fs.access(nodePath.join(process.cwd(), 'tsconfig.json')).then(() => true).catch(() => false) ? 'tsconfig.json' : undefined });
        
        const resultFilePaths = existingPaths.map(e => e.filePath);
        for(const p of existingPaths) {
            const sourceFile = project.addSourceFileAtPath(p.absolutePath);
            await sourceFile.refreshFromFileSystem();

            const exportedClass = sourceFile.getClasses().find(cls => cls.isExported());
            if (exportedClass === undefined) return [];

            const staticProperties = exportedClass?.getStaticProperties();
            const staticMethods = exportedClass?.getStaticMethods();
        
            //use dynamic import to evaluate selector property values
            const importPath = p.absolutePath.replaceAll('\\', '/'); // absolute path with extension
            const importResult = (await _state.evalScope(`(async function() {
                try {
                    const temporaryEvalResult = await import('${importPath}');
                    return temporaryEvalResult;
                } catch (err) {
                    console.error(err);
                }
                })()`));
            const classInstance = Object.entries(<any>importResult)[0][1] as any;
            
            const nestedTypeProps = staticProperties
                .filter(prop => _state.config.propertyNestedTypeRegex.test(prop.getType().getSymbol()?.getName() ?? ''));

            let selectorProperties = staticProperties
                .filter(prop => _state.config.propertySelectorRegex.test(prop.getName()))
                .map(prop => {
                    const name = prop.getName();
                    const selector = classInstance[name];
                    const selectorMethodName = _state.config.propertySelectorRegex.exec(name)?.[1];
                    const selectorMethodNode = staticMethods.find(m => m.getName() === selectorMethodName);
                    const selectorMethod = selectorMethodNode 
                        ? { name: selectorMethodNode.getName(), args: selectorMethodNode.getParameters().map(p => p.getName()), body: selectorMethodNode.getText() }
                        : { name: selectorMethodName, args: [], body: ''};
                    return { name, selector: selector, selectorMethod };
                });

            const nestedTypeProperties = nestedTypeProps.map(prop => {
                const name = prop.getName();
                //const selectorPropName = _state.config.propertySelectorRegex.exec(name)?.[1]!;
                const selectorProp = selectorProperties.find(p => pageObjectModel._state.config.propertySelectorRegex.exec(p.name)?.[1] == name)!;
                const _type = prop.getType().getSymbol()!;
                const fullFilePath = _type.getDeclarations()[0].getSourceFile().getFilePath();
                const filePath = nodePath.relative(_state.config.path, fullFilePath);
                return { name, selectorPropertyName: selectorProp.name, selector: selectorProp.selector, filePath };
            });

            selectorProperties = selectorProperties.filter(p => !nestedTypeProperties.some(n => n.selectorPropertyName === p.name));

            const helperMethods = staticMethods.filter(m => !selectorProperties.some(p => m.getName() === _state.config.propertySelectorRegex.exec(p.name)?.[1]))
                .map(method => ({name: method.getName(), args: method.getParameters().map(p => p.getName()), body: method.getText()}));

            const evalString = `if (!PW_pages) {PW_pages = {}; } PW_pages[\`${p.filePath}\`] = { className: '${exportedClass.getName()}', selectors: ${JSON.stringify(selectorProperties)}, methods: ${JSON.stringify(helperMethods)}, nestedPages: ${JSON.stringify(nestedTypeProperties)}}`;
            await page.evaluate(evalString);

            if (nestedTypeProperties.length > 0) resultFilePaths.push(...await _reload(page, nestedTypeProperties.map(n => n.filePath), project)); //! recursively reload all nested page objects
        }

        return resultFilePaths;
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
