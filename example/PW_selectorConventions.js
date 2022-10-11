/**
 * PW_selectorConventions contract:
 * array of { match(el) => resultType | undefined, output(x: resultType) => code: string, <optional>isPageObjectModel: boolean}
 * notes:
 *   match(el) => null/undefined inidicates not a match
 *   rules are evaluated in order (top to bottom)
 *   currently hovered element is passed into each match
 */

var PW_selectorConventions = [
/*  {
    match: (el) => playwright.selector(el),
    output: (selector) => `await page.locator('${selector}').click();`,
  },
*/
];


// built in conventions, should not need to be overridden //
/*
var PW_selector_pageObjectModel_conventions = [
  {
    match: (el) => el.getAttribute("data-page-object-model") ?? undefined,
    output: (command) => `await ${command};`,
    isPageObjectModel: true,
  },
];

var PW_selector_base_conventions = [
  {
    match: (el) => playwright.selector(el),
    output: (selector) => `await page.locator('${selector}').click();`,
  },
];
*/
