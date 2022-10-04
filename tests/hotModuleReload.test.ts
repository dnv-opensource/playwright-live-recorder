import { ts, Project, ScriptTarget } from 'ts-morph';
import { hotModuleReload } from '../src/hotModuleReload';
import * as nodePath from 'node:path';

test('hotModuleReload reloadTestFile', async () => {
  const testDecl = `test('simple test', async ({ page }) => {`;
  const executingLine = `    await PlaywrightLiveRecorder.start(page, s => eval(s));`;
  
  await hotModuleReload.init('./tests/example-test-project/example.spec.before.ts', testDecl, executingLine);
  
  let newSrcBlock!: string;
  await hotModuleReload.reloadTestFile('./tests/example-test-project/example.spec.after.ts', testDecl, executingLine, s => newSrcBlock = s);


  expect(newSrcBlock).toEqual(`    await expect(page).toHaveTitle('Google');`);
});

test('hotModuleReload _getBlockToExecute', async () => {
  const testDecl = `test('simple test', async ({ page }) => {`;

  const fnContents = (await hotModuleReload._extractFnContents('./tests/example-test-project/example.spec.before.ts', testDecl, '    await PlaywrightLiveRecorder.start(page, s => eval(s));'))!;
  const newFnContents = (await hotModuleReload._extractFnContents('./tests/example-test-project/example.spec.after.ts', testDecl, '    await PlaywrightLiveRecorder.start(page, s => eval(s));'))!;
 
  const blockToExecute = hotModuleReload._getBlockToExecute(fnContents, newFnContents);
  const expectedNewBlock =
`    await expect(page).toHaveTitle('Google');`;

  expect(blockToExecute).toEqual(expectedNewBlock);
});


test('load dependency graph for test', async () => {
  const newLinesToExecute = 
`    await fnPromise();
    var abc=123;
    await fnPromise();
`


  const testFilename = nodePath.resolve('./tests/example-test-project/example.spec.before.ts');
  
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
  const ambientCode = files.filter(f => f.filePath !== testFilenameJs).map(f => `//${f.filePath}\n${f.text.replace(/^export\s?/gm, '')}`).join('\n\n');
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