import { hotModuleReload } from '../../src/hotModuleReload';

test('hotModuleReload reloadTestFile', async () => {
  const testDecl = `test('simple test', async ({ page }) => {`;
  const executingLine = `    await PlaywrightLiveRecorder.start(page, s => eval(s));`;
  
  await hotModuleReload.reloadTestFile('./tests/example-test-project/example.spec.before.ts', testDecl, executingLine, s => {});
  
  let newSrcBlock!: string;
  await hotModuleReload.reloadTestFile('./tests/example-test-project/example.spec.after.ts', testDecl, executingLine, s => newSrcBlock = s);


  expect(newSrcBlock).toBe(
`    await expect(page).toHaveTitle('Google');
    `);
});

test('hotModuleReload _getBlockToExecute', async () => {
  const testDecl = `test('simple test', async ({ page }) => {`;

  const fnContents = (await hotModuleReload._extractFnContents('./tests/example-test-project/example.spec.before.ts', testDecl, '    await PlaywrightLiveRecorder.start(page, s => eval(s));'))!;
  const newFnContents = (await hotModuleReload._extractFnContents('./tests/example-test-project/example.spec.after.ts', testDecl, '    await PlaywrightLiveRecorder.start(page, s => eval(s));'))!;
 
  const blockToExecute = hotModuleReload._getBlockToExecute(fnContents, newFnContents);
  const expectedNewBlock =
`    await expect(page).toHaveTitle('Google');
    `;

  expect(blockToExecute).toBe(expectedNewBlock);
});
