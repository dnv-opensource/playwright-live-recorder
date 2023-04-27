import { test } from 'vitest';
import { pageObjectModel } from '../src/pageObjectModel';
import { PlaywrightLiveRecorderConfig_pageObjectModel } from '../src/types';

test('pageObjectModel _transpile', async () => {
  const normalizedFilePath = 'docs/intro_page.ts';
  const className = 'intro_page';

  pageObjectModel._state = <any>(<Partial<PlaywrightLiveRecorderConfig_pageObjectModel>>{config: {path: 'tests/example-test-project/'}});
  const pomEntry = await pageObjectModel._transpile2(normalizedFilePath, className);

  console.log(pomEntry.content);

});

test('pageObjectModel _transpile with utlity class dep', async () => {
  pageObjectModel._state = <any>(<Partial<PlaywrightLiveRecorderConfig_pageObjectModel>>{config: {path: 'tests/example-test-project/'}});

  const pomEntry = await pageObjectModel._transpile2('docs/intro_page.ts', 'intro_page');
  
});