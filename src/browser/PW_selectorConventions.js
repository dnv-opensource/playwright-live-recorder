/**
 * PW_live_recorderRules contract:
 * array of { match(el) => resultType | undefined, output(x: resultType) => code: string, <optional>isPageObjectModel: boolean}
 * notes:
 *   match(el) => null/undefined inidicates not a match
 *   rules are evaluated in order (top to bottom)
 *   currently hovered element is passed into each match
 */

var PW_selector_PageObjectModel_conventions = [
  {
    match: (el) => el.getAttribute("data-page-object-model") ?? undefined,
    output: (command) => `await ${command};`,
    isPageObjectModel: true,
  },
];

var PW_selectorConventions = [];

var PW_selector_base_conventions = [
  {
    match: (el) => playwright.selector(el),
    output: (selector) => `await page.locator('${selector}').click();`,
  },
];
