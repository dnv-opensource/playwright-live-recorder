console.log('Playwright live coder and configurable recorder, expand for usage details', {
    '1. to preview step': 'hold key chord CTRL+SHIFT+ALT and hover over element',
    '2. to record step': 'hold key chord CTRL+SHIFT+ALT and left mouse click on element',
    '3. to modify last step': 'hold key chord CTRL+SHIFT+ALT and press SPACE',
    '3a. tips': 'use // to add comment, or comment out whole step. Clicking OK will re-run the modified step',
    '4. to author a new recorder rule': 'hold key chord while hovering over element, use console to develop new matcher using variable `el` and fns `$` and `$$` and any other libs referenced in recorderRules. copy+paste working matcher and run PW_addRule(`<string here>`)',
    '5. new recorder rule details': {
        'a. example rule': "`[...$$('.nav-link')].includes(el) ? \\\`.nav-link:has-text(\"${el.text}\")\\\` : undefined",
        'b. example rule will generate code': `    {
        match: (el) => [...$$('.nav-link')].includes(el) ? \`.nav-link:has-text(\"\${el.text}\")\` : undefined,
        output: (selector) => \`await page.locator('\${selector}').click();\`
    },`,
        'c. to add this rule, run': `PW_addRule(\`[...$$('.nav-link')].includes(el) ? \\\`.nav-link:has-text(\"\${el.text}\")\\\` : undefined\`)`
    },
    '6. to live code': 'call PW_eval(`await page.<whatever lines you want to execute here`)',
    '6a. to record live code step': 'call PW_eval(`await page.<whatever lines you want to execute here`, true)'
});
console.log('tip - hover over text objects with \\n in them to see formatted text');

var PW_tooltip = document.createElement("div");
PW_tooltip.setAttribute('id', 'PW_tooltip');
PW_tooltip.classList.add('PW-tooltip');
document.body.appendChild(PW_tooltip);
window.PW_tooltip = PW_tooltip;

var mouse_x = 0;
var mouse_y = 0;

var recordModeOn = false;
PW_config().then(c => window.config = c);

function keyChord_toggleRecordMode(event) {
    if (!(event.ctrlKey && event.altKey && event.shiftKey)) return;

    toggleRecordMode();
}

function toggleRecordMode() {
    recordModeOn = !recordModeOn;

    if (recordModeOn) {
        updateTooltipPosition(mouse_x, mouse_y);
        const element = document.elementFromPoint(mouse_x, mouse_y);
        updateTooltipContents(element);
        window.PW_tooltip.style.visibility = 'visible';
        if(config.pageObjectModel.enabled) {
            reload_page_object_model_elements();
            for (const overlayEl of window.PW_overlays) overlayEl.style.visibility = 'visible';
        }
    } else {
        window.PW_tooltip.style.visibility = 'hidden';
        if(config.pageObjectModel.enabled) {
            for (const overlayEl of window.PW_overlays) overlayEl.style.visibility = 'hidden';
        }
    }
}

function updateTooltipContents(element) {
    const rule = document.PW_getRuleForElement(element);
    const matcher = rule.match(element);
    PW_tooltip.innerText = typeof matcher === 'string' ? matcher : JSON.stringify(matcher, undefined, '\t');
}

function updateTooltipPosition(x,y) {
    PW_tooltip.style.left = x + 'px';
    PW_tooltip.style.top = y + 16 + 'px';
}

function keyChord_mousemove_updateTooltip(event) {
    mouse_x = event.x;
    mouse_y = event.y;
    if (!recordModeOn) return;

    updateTooltipPosition(mouse_x, mouse_y);
    
    const element = document.elementFromPoint(mouse_x, mouse_y);
    if (window.el === element) return;

    updateTooltipContents(element);
    window.el = element;
}

var handlingClick = false;
async function recordModeClickHandler(event) {
    if (!recordModeOn) return;
    if (handlingClick) return;
    try {
        handlingClick = true;

        event.preventDefault();
        event.stopImmediatePropagation();
        const element = document.elementFromPoint(event.x, event.y);

        const result = document.PW_getRuleForElement(element);
        if (result.onClick) result.onClick(element);
        await window.PW_eval(result.output(result.match(element)), true);
    } finally {
        handlingClick = false;
    }
}

async function lastCommandRepl() {
    const lastCommand = await PW_getLastCommand();
    const updatedCommand = window.prompt('edit last command', lastCommand);
    if (updatedCommand == null) return;
    PW_updateAndRerunLastCommand(updatedCommand);
}
document.PW_getRuleForElement = function (el) {
    return RecorderRules.find(i => i.match(el) != null /* null or undefined */);
};
window.addEventListener('keydown', keyChord_toggleRecordMode);
window.addEventListener('mousemove', keyChord_mousemove_updateTooltip);
window.addEventListener('click', recordModeClickHandler, true);



/******** styles ********/
const style = document.createElement('style');
document.head.appendChild(style);
style.sheet.insertRule(`.PW-tooltip {
    position:absolute;
    left:0;
    top:0;
    padding:4px;
    background:LavenderBlush;
    outline:1px solid black;
    border-radius:4px;
    z-index:2147483647;
    visibility:hidden;
}`);

style.sheet.insertRule(`.PW-page-object-model-overlay {
    position: absolute;
    background-color: #ff8080;
    opacity: 0.7;
}`); //todo: add border, z-index


/******** page object model feature ********/

var pageObjectName = '';

async function reload_page_object_model_elements() {
    //var $ = document.querySelector.bind(document);
    var $$ = document.querySelectorAll.bind(document);

    if (window.PW_overlays !== undefined) for (const el of window.PW_overlays) el.parentNode.removeChild(el);
    window.PW_overlays = [];
    
    //get current page object to reflect across
    pageObjectName = await PW_urlToFilePath(window.location.href);
    const pageObject = window[pageObjectName];
    if (pageObject === undefined) return;

    const propertyRegex = new RegExp(config.pageObjectModel.propertySelectorRegex.slice(1, -1));
    for (var prop in pageObject) {
        if (!propertyRegex.test(prop)) continue;

        const selector = pageObject[prop];
        const el = $$(selector)[0]; //todo: check that there's only one element, otherwise highlight in error

        const rect = el.getBoundingClientRect();
        const overlayEl = document.createElement('div');
        overlayEl.style.top = rect.top + 'px';
        overlayEl.style.left = rect.left + 'px';
        overlayEl.style.width = rect.width + 'px';
        overlayEl.style.height = rect.height + 'px';
        //todo: add listener on source element to modify size/position

        //todo: use a regex instead
        const selectorMethodName = prop.slice(0,prop.length-'_selector'.length);
        const selectorMethod = '' + pageObject[selectorMethodName].toString();
        const selectorMethodArgs = selectorMethod.slice(selectorMethod.indexOf('('), selectorMethod.indexOf(')') + 1);
        overlayEl.setAttribute('data-page-object-model', `${pageObjectName}.${selectorMethodName}${selectorMethodArgs}`);

        //todo: extract into css style
        overlayEl.classList.add('PW-page-object-model-overlay');
        el.insertAdjacentElement('afterend', overlayEl);
        window.PW_overlays.push(overlayEl);
    }
}
