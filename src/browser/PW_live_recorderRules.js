/**
 * PW_live_recorderRules contract:
 * array of { match(el) => resultType | undefined, output(x: resultType) => code: string, <optional>onClick(el)}
 * notes: 
 *   match(el) => null/undefined inidicates not a match
 *   rules are evaluated in order (top to bottom)
 *   currently hovered element is passed into each match
 */

const $$ = window.playwright ? window.playwright.$$.bind(this) : document.querySelectorAll.bind(this);

var PW_live_recorderRules = [
    {
        //page object model rule
        match: (el) => el.getAttribute('data-page-object-model') ?? undefined,
        output: (command) => `await ${command}.click();`, //assume page object model returns an element and .click() it by default
        onClick: pageObjectModelOnClick,
    },
    {
        match: (el) => playwright.selector(el),
        output: (selector) => `await page.locator('${selector}').click();`
    }
];

function pageObjectModelOnClick(el) {
    const origPointerEvents = el.style.pointerEvents;
    el.style.pointerEvents = 'none'; //make the pageObjectModel custom element not hit test visible
    setTimeout(() => el.style.pointerEvents = origPointerEvents, 1000); //and then restore it
}