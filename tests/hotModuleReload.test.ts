import { ts, Project, ScriptTarget } from 'ts-morph';
import { hotModuleReload } from '../src/hotModuleReload';
import nodePath from 'node:path';
import { TestCallingLocation } from '../src/types';
import { expect, test } from 'vitest';

test('typescript transpile performance profiling', async () => {
/*
        const testFilename = nodePath.resolve(filename);
  
        let proj = new Project({compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false }});



        proj.addSourceFileAtPath(testFilename);
        proj.resolveSourceFileDependencies();
        
        proj.getSourceFiles().map(f => f.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration).forEach(x => x.remove())); //snip all interdependencies
        const r = proj.emitToMemory();
        const files = r.getFiles();
        
        const ambientCode = files
            .filter(f => nodePath.resolve(f.filePath).replace(/\.js$/, '.ts') !== testFilename) //exclude the test file from the ambient code
            .reverse()
            .map(f => `//${f.filePath} transpiled\n${f.text.replace(/^export\s?/gm, '')}`)
            .join('\n\n');

        return ambientCode;
*/
  const options = { compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false, skipLibCheck: true } };
  const testFilename = nodePath.resolve('./tests/example-test-project/example.spec.after.ts');
  
  console.time('_emitInlinedDependencies');
  let proj = new Project(options);
  proj.addSourceFileAtPath(testFilename);
  const allFiles = proj.emitToMemory().getFiles().map(f => f.filePath.replace(/\.js$/, '.ts')); //get dependency graph in dependency order
  proj = new Project(options);
  allFiles.forEach(path => proj.addSourceFileAtPath(path));
  proj.getSourceFiles().map(f => f.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration).forEach(x => x.remove())); //snip all interdependencies
  const files = proj.emitToMemory().getFiles();

  const inlinedDependencies = files
          .filter(f => nodePath.resolve(f.filePath).replace(/\.js$/, '.ts') !== testFilename) //exclude the test file from the ambient code
          .map((f, index) => ({ path: f.filePath, src: `//${f.filePath} transpiled\n${f.text.replace(/^export\s?/gm, '')}`, index }))
          .reduce((obj, x) => (obj[x.path] = x, obj), <{[path: string]: {path: string, src: string, index: number}}>{});

  console.timeEnd('_emitInlinedDependencies');
  
  expect(allFiles).toEqual([
    "C:/_dev/playwright-live-recorder/tests/example-test-project/testHelpers.ts",
    "C:/_dev/playwright-live-recorder/tests/example-test-project/docs/intro_page.ts",
    "C:/_dev/playwright-live-recorder/tests/example-test-project/example.spec.after.ts"
  ]);

  expect(Object.values(inlinedDependencies).map(x => x.src)).toEqual([
`//C:/_dev/playwright-live-recorder/tests/example-test-project/testHelpers.js transpiled
const doc = "abc";
function createGuid() {
    return 'b87e0a22-6172-4dab-9643-1c170df1b0cd';
}
async function fnPromise() {
    return await Promise.resolve(createGuid());
}
`,
`//C:/_dev/playwright-live-recorder/tests/example-test-project/docs/intro_page.js transpiled
const doc = "abc";
class intro_page {
    static title_selector = \`h1:has-text("Installation")\`;
    static title(page) { return page.locator(this.title_selector); }
    static home_selector = \`b:has-text("Playwright")\`;
    static home(page) {
        const iAmGuid = createGuid();
        return page.locator(this.home_selector);
    }
}
`,
  ]);
});


test('typescript transpile performance profiling2', async () => {
  const options = { compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false, skipLibCheck: true } };
  const testFilename = nodePath.resolve('./tests/example-test-project/example.spec.after.ts');

  console.time('_emitInlinedDependencies');
  let proj = new Project(options);

  proj.addSourceFileAtPath(testFilename);
  proj.resolveSourceFileDependencies();
  
  proj.getSourceFiles().map(f => f.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration).forEach(x => x.remove())); //snip all interdependencies
  const r = proj.emitToMemory();
  const files = r.getFiles();
  const allFiles = files.map(x => x.filePath).reverse();
  
  const inlinedDependencies = files
          .filter(f => nodePath.resolve(f.filePath).replace(/\.js$/, '.ts') !== testFilename) //exclude the test file from the ambient code
          .reverse()
          .map((f, index) => ({ path: f.filePath, src: `//${f.filePath} transpiled\n${f.text.replace(/^export\s?/gm, '')}`, index }))
          .reduce((obj, x) => (obj[x.path] = x, obj), <{[path: string]: {path: string, src: string, index: number}}>{});

  console.timeEnd('_emitInlinedDependencies');
  
  expect(allFiles).toEqual([
    "C:/_dev/playwright-live-recorder/tests/example-test-project/testHelpers.js",
    "C:/_dev/playwright-live-recorder/tests/example-test-project/docs/intro_page.js",
    "C:/_dev/playwright-live-recorder/tests/example-test-project/example.spec.after.js"
  ]);

  expect(Object.values(inlinedDependencies).map(x => x.src)).toEqual([
`//C:/_dev/playwright-live-recorder/tests/example-test-project/testHelpers.js transpiled
const doc = "abc";
function createGuid() {
    return 'b87e0a22-6172-4dab-9643-1c170df1b0cd';
}
async function fnPromise() {
    return await Promise.resolve(createGuid());
}
`,
`//C:/_dev/playwright-live-recorder/tests/example-test-project/docs/intro_page.js transpiled
const doc = "abc";
class intro_page {
    static title_selector = \`h1:has-text("Installation")\`;
    static title(page) { return page.locator(this.title_selector); }
    static home_selector = \`b:has-text("Playwright")\`;
    static home(page) {
        const iAmGuid = createGuid();
        return page.locator(this.home_selector);
    }
}
`,
  ]);
});

test('typescript compile performance', async () => {
  const options = { compilerOptions: { target: ts.ScriptTarget.ESNext, strict: false, skipLibCheck: true } };
  
  
/* 2.4s
   let proj = new Project(options);
  const f = proj.addSourceFileAtPath('C:/_dev/playwright-live-recorder/tests/example-test-project/docs/intro_page.ts');
  f.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration).forEach(x => x.remove());
  const transpiled = proj.emitToMemory().getFiles()[0];
 */

  //const src = await fs.readFile('C:/_dev/playwright-live-recorder/tests/example-test-project/docs/intro_page.ts', 'utf-8'); //3ms
  //const result = typescript.transpileModule(src.replace(/^import.*/gm,''), options); //65ms

  console.time('extract imports');
  let proj = new Project(options);
  const f = proj.addSourceFileAtPath('C:/_dev/playwright-live-recorder/tests/example-test-project/docs/intro_page.ts');
  const imports = f.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration);
  console.timeEnd('extract imports');
});

test('hotModuleReload reloadTestFile', async () => {
  const testCallingLocation: TestCallingLocation = {
    file: `./tests/example-test-project/example.spec.before.ts`,
    testLine: `    test('simple test', async ({ page }) => {`,
    testLineNumber: 6,
    executingLine: `    await PlaywrightLiveRecorder.start(page, s => eval(s));`,
  };
  let evalText: string;
  await hotModuleReload.init(testCallingLocation, (str: string) => console.log(`pageEvaluate: ${str}`), (s: string) => evalText = s);
  const s = hotModuleReload._state;
  await hotModuleReload._initialTestFileLoad(s);

  s.t.file = `./tests/example-test-project/example.spec.after.ts`;
  await hotModuleReload._reloadTestFile(s);

  expect(evalText!.replace(/\r\n/g, "\n")).toEqual(
`//######## C:\\_dev\\playwright-live-recorder\\tests\\example-test-project\\docs\\intro_page.ts ########
/*im { Page } from "@playwright/test";*/
/*im { createGuid } from '../testHelpers';*/
var doc = "abc";
/*ex*/ class intro_page {
    static title_selector = \`h1:has-text("Installation")\`;
    static title(page) { return page.locator(this.title_selector); }
    static home_selector = \`b:has-text("Playwright")\`;
    static home(page) {
        const iAmGuid = createGuid();
        return page.locator(this.home_selector);
    }
}


(async function() {
  try {
        await expect(page).toHaveTitle('Google');
        
    

  } catch (err) {
    console.error(err);
  }
})()`);
});

test('hotModuleReload _getBlockToExecute', async () => {
  const testDecl = `test('simple test', async ({ page }) => {`;

  const fnContents = (await hotModuleReload._extractFnContents('./tests/example-test-project/example.spec.before.ts', testDecl, 6, '    await PlaywrightLiveRecorder.start(page, s => eval(s));'))!;
  const newFnContents = (await hotModuleReload._extractFnContents('./tests/example-test-project/example.spec.after.ts', testDecl, 6, '    await PlaywrightLiveRecorder.start(page, s => eval(s));'))!;
 
  const blockToExecute = hotModuleReload._getBlockToExecute(fnContents, newFnContents);
  const expectedNewBlock = `        await expect(page).toHaveTitle('Google');`;

  expect(blockToExecute.trimEnd()).toEqual(expectedNewBlock);
});


test('load dependency graph for test', async () => {
  const newLinesToExecute = 
`    await fnPromise();
    var abc=123;
    await fnPromise();
`


  const testFilename = nodePath.resolve('./tests/example-test-project/example.spec.after.ts');
  
  let proj = new Project(); //todo: figure out options that make this faster...
  proj.addSourceFileAtPath(testFilename);
  const allFiles = proj.emitToMemory().getFiles().map(f => f.filePath); //get dependency graph in dependency order


  //create a fresh project with every individual dependency added (in order)
  proj = new Project({compilerOptions: { target: ScriptTarget.ESNext, strict: false }});
  allFiles.forEach(path => proj.addSourceFileAtPath(/* nodePath.relative(nodePath.resolve('.'), path) */path.replace(/\.js$/, '.ts')));
  
  proj.getSourceFiles().map(f => f.getChildrenOfKind(ts.SyntaxKind.ImportDeclaration).forEach(x => x.remove())); //snip all interdependencies
  const r = proj.emitToMemory();
  const files = r.getFiles();
  const testFilenameJs = testFilename.replace(/\\/g, '/').replace(/\.ts$/, '.js');
  const ambientCode = files.filter(f => f.filePath !== testFilenameJs).map(f => `//${f.filePath}\n${f.text.replace(/^export\s?/gm, '').replaceAll(/const /gm, 'var ')}`).join('\n\n');
  const testCode = `
//execute test lines here
${wrapAsyncAsPromise(newLinesToExecute, ['abc'])}`;

  //console.log(testCode);
  const awaitedEvalResult = await eval(ambientCode + testCode);
  console.log({ awaitedEvalResult });

  Object.assign(globalThis, awaitedEvalResult);
  const oneTwoThreeOneTwoThree = await eval(`${ambientCode}\n${wrapAsyncAsPromise("var abc123 = abc + '123';", ['abc123'])}`);
  console.log({oneTwoThreeOneTwoThree});
});

function wrapAsyncAsPromise(codeBlock: string, variables: string[]) {
  return `(async function() {
${codeBlock}
    return { ${variables.join(', ')} };
})()`;
}


test('extract var statements', async () => {
  const variables = hotModuleReload._extractVariableListFrom(
`var varABC = 123;
let letABC = 123;
const constABC = 123;
const {abc, def} = {abc: 123, def: 456, xyz: 789};`);

  expect(variables).toEqual(['varABC', 'letABC', 'constABC', 'abc', 'def']);

});

test('extract import statements', async() => {
  const testFilename = nodePath.resolve('./tests/example-test-project/example.spec.before.ts');
  const imports = hotModuleReload._extractImports(testFilename);
  console.log({imports});
});




/* 
single watcher, can have set of files being watched be mutated


initial load
  full dependency graph from test_file.ts
    add files to watcher list
    {[path: string]: {imports: ImportDeclaration[], transpiled: string}}

  Discovery pass - ts-morph.emitToMemory (slow ~4s)
   
   * [test_file.ts]
 / | \
*  *  * [intro_page.ts, home_page.ts]
   |
   *    [gridUtil.ts requires lodash]

transpile pass
  re evaluate imports (ts-morph 20ms)
    if imports list changed, perform discovery pass (on this file)
      if any new files, add to watcher list, and transpile them

  strip imports (replace with commented out line? string manipulation)
  typescript.transpileModule (fast 80ms/file)

*/







































