/**
 * PW_selectorConventions contract:
 * array of { match(el) => resultType | undefined, output(x: resultType) => code: string, <optional>isPageObjectModel: boolean}
 * notes:
 *   match(el) => null/undefined inidicates not a match
 *   rules are evaluated in order (top to bottom)
 *   currently hovered element is passed into each match
 */

/* var PW_selector_pageObjectModel_conventions = [
  {
    match: el => el.closest('[data-page-object-model]')?.getAttribute('data-page-object-model'),
    isPageObjectModel: true,
  },
];

var PW_selectorConventions = [
  {
    match: el => {
      const dataTestId = el.closest('[data-testid]')?.getAttribute('data-testid')
      return dataTestId ? `[data-testid="${dataTestId}"]` : undefined;
    },
  }
];

var PW_selector_base_conventions = [
  {
    match: (el) => playwright.selector(el)
  },
];
*/