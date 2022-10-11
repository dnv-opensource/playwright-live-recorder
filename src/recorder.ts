import { Page } from "@playwright/test";
import * as fs from "fs/promises";
import * as chokidar from "chokidar";
import { PlaywrightLiveRecorderConfig_recorder } from "./types";

//exposes selectorConventions pieces (load, watch and reload, prependRecordingRule method)
export module recorder {
    export async function init(config: PlaywrightLiveRecorderConfig_recorder, page: Page) {
        await page.exposeFunction('PW_addRule', (matcherCode: string) => prependRecordingRule(config.path, matcherCode));
        await page.addScriptTag({ path: './node_modules/@dnvgl/playwright-live-recorder/dist/browser/PW_selectorConventions.js' });
        try { await page.addScriptTag({ path: config.path }); } catch(err) { if ((<any>err).code='ENOENT') return; throw err;}

        const watch = chokidar.watch(config.path);
        watch.on('change', async path => await page.addScriptTag({ path }));
    }

    async function prependRecordingRule(config_recorder_path: string, matcherCode: string) {
        //todo: this code is ugly and cumbersome, find a more idomatic way to splice file content
        const matcherCodeLines = matcherCode.split(_NEWLINE).length;
        const selectorConventionsSrc = await fs.readFile(config_recorder_path, 'utf-8');
        const lines = selectorConventionsSrc.split(_NEWLINE);
        const insertLineIndex = lines.indexOf('var PW_selectorConventions = [') + 1;
        lines.splice(insertLineIndex, 0,
            `    {
        match: (el) => ${matcherCodeLines == 1 ? matcherCode : '{\n            ' + matcherCode.split('\n').join('\n            ') + '\n        }'},
        output: (selector) => \`await page.locator('\${selector}').click();\`
    },`);

        await fs.writeFile(config_recorder_path, lines.join('\n'));
    }
}
const _NEWLINE = /\r\n|\n|\r/;