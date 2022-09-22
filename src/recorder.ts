import { Page } from "@playwright/test";
import * as fs from "fs/promises";
import { PlaywrightLiveRecorderConfig_recorder } from "./types";

//exposes recorderRules pieces (load, watch and reload, prependRecordingRule method)
export module recorder {
    export async function init(config: PlaywrightLiveRecorderConfig_recorder, page: Page) {
        await page.exposeFunction('PW_addRule', (matcherCode: string) => prependRecordingRule(config.path, matcherCode));
        await page.addScriptTag({ path: config.path });

        // tslint:disable-next-line: no-floating-promises
        (async () => { for await (const event of fs.watch(config.path)) event.eventType === 'change' ? await page.addScriptTag({ path: config.path }) : {}; })(); //fire-and-forget the watcher
    }

    async function prependRecordingRule(config_recorder_path: string, matcherCode: string) {
        //todo: this code is ugly and cumbersome, find a more idomatic way to splice file content
        const matcherCodeLines = matcherCode.split(_NEWLINE).length;
        const recorderRulesText = await fs.readFile(config_recorder_path, 'utf-8');
        const lines = recorderRulesText.split(_NEWLINE);
        const insertLineIndex = lines.indexOf('var RecorderRules = [') + 1;
        lines.splice(insertLineIndex, 0,
            `    {
        match: (el) => ${matcherCodeLines == 1 ? matcherCode : '{\n            ' + matcherCode.split('\n').join('\n            ') + '\n        }'},
        output: (selector) => \`await page.locator('\${selector}').click();\`
    },`);

        await fs.writeFile(config_recorder_path, lines.join('\n'));
    }
}
const _NEWLINE = /\r\n|\n|\r/;