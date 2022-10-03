/**
 * PW_live_recorderRules contract:
 * array of { match(el) => resultType | undefined, output(x: resultType) => code: string, <optional>isPageObjectModel: boolean}
 * notes: 
 *   match(el) => null/undefined inidicates not a match
 *   rules are evaluated in order (top to bottom)
 *   currently hovered element is passed into each match
 */

var PW_live_recorderRules = [
    {
        //page object model rule
        match: (el) => el.getAttribute('data-page-object-model') ?? undefined,
        output: (command) => `await ${command}.click();`, //assume page object model returns an element and .click() it by default
        isPageObjectModel: true,
    },
    {
        match: (el) => playwright.selector(el),
        output: (selector) => `await page.locator('${selector}').click();`
    }
];