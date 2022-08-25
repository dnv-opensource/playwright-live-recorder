import('https://medv.io/finder/finder.js').then(m => window.finder = m.finder);
var $ = document.querySelector.bind(document);
var $$ = document.querySelectorAll.bind(document);

/**
 * RecorderRules contract:
 * array of { match(el) => resultType | undefined, output(x: matchType) => code: string}
 * notes: 
 *   match(el) => undefined inidicates not a match
 *   rules are evaluated in order (top to bottom)
 *   currently hovered element is passed into each match
 */
var RecorderRules = [
    {
        match: (el) => [...$$('.nav-link')].includes(el) ? `.nav-link:has-text("${el.text}")` : undefined,
        output: (selector) => `await page.locator('${selector}').click();`
    },
    {
        match: (el) => {
            const dataTestId = el.getAttribute('data-testid');
            if (!dataTestId) return undefined;

            elements = [...$$(`[data-testid="${dataTestId}"]`)];
            return elements.length === 1 ? `data-testid=${dataTestId}` : {selector: `data-testid=${dataTestId}`, nth: elements.indexOf(el)};
        },
        output: (x) => x.nth === undefined ? `await page.locator('${x}').click();` : `await page.locator('${x.selector}').nth(${x.nth}).click();`
    },
    {
        match: (el) => finder(el),
        output: (selector) => `await page.locator('${selector}').click();`
    }
];