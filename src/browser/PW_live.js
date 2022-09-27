/******** UI Elements ********/

if (window.PW_statusbar) PW_statusbar.remove();
window.PW_statusbar = document.createElement("div");
PW_statusbar.classList.add('PW');

PW_statusbar.innerHTML= `
    <div class="PW-statusbar">
        <input id="PW-repl" spellcheck="false" style="width:100%" disabled="true" placeholder="Playwright Live Recorder" title="Last executed line (modify and press enter to re-evaluate)">
        <input id="PW-page-object-model-filename" class="PW-statusbar-item" disabled="true" title="page object model filename">
        <span class="PW-checkbox-recording PW-statusbar-item" title="Playwright Live Recorder">
            <input type="checkbox" id="PW-record-checkbox" onchange="toggleRecordMode(this.checked)">
            <label for="PW-record-checkbox" style="margin:8px"/>
        </span>
    </div>
    <div id="PW-eval-error">
        <details>
            <summary id="PW-eval-error-summary" style="visibility:collapsed">
            </summary>
            <div id = "PW-eval-error-details"></div>
        </details>
    </div>
`;


document.body.prepend(PW_statusbar);

window.PW_repl = document.getElementById('PW-repl');
PW_repl.addEventListener('keyup', event => (event.code || event.key) === 'Enter' ? PW_updateAndRerunLastCommand(PW_repl.value) : {})

window.PW_eval_error = document.getElementById('PW-eval-error');
PW_eval_error.style.display = "none";
window.PW_eval_error_summary = document.getElementById('PW-eval-error-summary');
window.PW_eval_error_details = document.getElementById('PW-eval-error-details');

window.PW_page_object_model_filename = document.getElementById('PW-page-object-model-filename');

if (window.PW_tooltip) PW_tooltip.remove();
var PW_tooltip = document.createElement("div");
PW_tooltip.setAttribute('id', 'PW_tooltip');
PW_tooltip.classList.add('PW-tooltip');
document.body.appendChild(PW_tooltip);
window.PW_tooltip = PW_tooltip;

/******** behavior ********/

if (window.PW_pages === undefined) window.PW_pages = {};
var mouse_x = 0;
var mouse_y = 0;

if (recordModeOn === undefined) var recordModeOn = false;
PW_config().then(c => window.config = c);

function keyChord_toggleRecordMode(event) {
    if (!(event.ctrlKey && event.altKey && event.shiftKey && event.key === 'R')) return;

    const chkbox = document.getElementById('PW-record-checkbox')
    chkbox.checked = !chkbox.checked; //this doesn't fire the changed event handler, so call toggleRecordMode manually
    toggleRecordMode(chkbox.checked);
}

function toggleRecordMode(checked) {
    recordModeOn = checked;

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
    let xOffset = 0;
    let yOffset = 16;
    if (x > window.visualViewport.width * 0.75) xOffset = -xOffset - PW_tooltip.getBoundingClientRect().width;
    if (y > window.visualViewport.height * 0.75) yOffset = -yOffset - PW_tooltip.getBoundingClientRect().height;
    PW_tooltip.style.left = x + xOffset + 'px';
    PW_tooltip.style.top = y + yOffset + 'px';
}

function mousemove_updateTooltip(event) {
    const element = document.elementFromPoint(event.x, event.y);
    if (element == null) return;

    mouse_x = event.x;
    mouse_y = event.y;
    window.PW_tooltip.style.visibility = (!recordModeOn || element.closest(".PW")) ? 'hidden' : 'visible';
    if (!recordModeOn) return;

    updateTooltipPosition(mouse_x, mouse_y);
    
    if (element == null) return;
    if (window.el === element) return;

    updateTooltipContents(element);
    window.el = element;
}

var handlingClick = false;
async function recordModeClickHandler(event) {
    if (!recordModeOn) return;
    if (handlingClick) return;

    const element = document.elementFromPoint(event.x, event.y);
    if (element == null) return;
    if (element.closest(".PW")) return;

    try {
        handlingClick = true;

        event.preventDefault();
        event.stopImmediatePropagation();

        let newItemName;
        const result = document.PW_getRuleForElement(element);
        if (result.isPageObjectModel) pageObjectModelOnClick(element);
        else if (config.pageObjectModel.enabled) {
            newItemName = window.prompt('Page object model item name?');
            if (newItemName != null) {
                const selector = result.match(element);
                await PW_appendToPageObjectModel(pageObjectFilePath, _buildPomCodeBlock(newItemName, selector));
            }
        }
        if (newItemName != null) return;

        const resultOutput = result.output(result.match(element));
        PW_repl.value = resultOutput;
        PW_repl.disabled = false;
        await window.PW_eval(resultOutput, true);
    } finally {
        handlingClick = false;
    }
}

document.PW_getRuleForElement = function (el) {
    return PW_live_recorderRules.find(i => i.match(el) != null /* null or undefined */);
};
window.addEventListener('keydown', keyChord_toggleRecordMode);
window.addEventListener('mousemove', mousemove_updateTooltip);
window.addEventListener('click', recordModeClickHandler, true);

/******** page object model feature ********/

window.navigation.onnavigatesuccess = async () => await reload_page_object_model_elements();

var pageObjectFilePath = '';

async function reload_page_object_model_elements() {
    if (window.PW_overlays !== undefined) for (const el of window.PW_overlays) el.parentNode.removeChild(el);
    window.PW_overlays = [];
    
    //get current page object to reflect across
    pageObjectFilePath = await PW_urlToFilePath(window.location.href);
    PW_page_object_model_filename.value = pageObjectFilePath;

    if (!recordModeOn) return;

    const pageObject = window.PW_pages[pageObjectFilePath];
    if (pageObject === undefined) return;

    const propertyRegex = new RegExp(config.pageObjectModel.propertySelectorRegex.slice(1, -1));
    for (var prop in pageObject.page) {
        if (!propertyRegex.test(prop)) continue;

        const selector = pageObject.page[prop];
        const el = playwright.$$(selector)[0]; //todo: check that there's only one element, otherwise highlight in error

        const overlayWrapperEl = document.createElement('div');
        overlayWrapperEl.style.display = 'grid';

        const overlayEl = document.createElement('div');

        //todo: use a regex instead
        const selectorMethodName = prop.slice(0,prop.length-'_selector'.length);
        const selectorMethod = '' + pageObject.page[selectorMethodName].toString();
        const selectorMethodArgs = selectorMethod.slice(selectorMethod.indexOf('('), selectorMethod.indexOf(')') + 1);
        overlayEl.setAttribute('data-page-object-model', `${pageObject.className}.${selectorMethodName}${selectorMethodArgs}`);
        overlayEl.classList.add('PW-page-object-model-overlay');
        
        overlayEl.classList.add('PW-grid-first-cell');
        el.classList.add('PW-grid-first-cell');

        el.parentNode.insertBefore(overlayWrapperEl, el);
        overlayWrapperEl.appendChild(el);
        overlayWrapperEl.appendChild(overlayEl);
        window.PW_overlays.push(overlayEl);
    }
}

function reportError(summary, errorStack, doNotWrapDetails) {
    if (summary === undefined && errorStack === undefined) {
        PW_eval_error.style.display = "none";
        return;
    }
    PW_eval_error.style.display = "block";
    PW_eval_error_summary.innerHTML = summary;
    PW_eval_error_details.innerHTML = doNotWrapDetails ? errorStack : `<pre class="PW-pre">${errorStack}</pre>`;
}

function pageObjectModelOnClick(el) {
    const origPointerEvents = el.style.pointerEvents;
    el.style.pointerEvents = 'none'; //make the pageObjectModel custom element not hit test visible
    setTimeout(() => el.style.pointerEvents = origPointerEvents, 1000); //and then restore it
}

//todo: add flexibility - provide function impl template to be provided by the recorderRules
function _buildPomCodeBlock(name, selector) {
    return`
    private static ${name}_selector = \`${selector}\`;
    static ${name}(page: Page) { return page.locator(\`${selector}\`); }
    
`;
}

//pageObject selector evaluation requires `playwright` object, warn user if it's not available
if (!window.playwright) {
    reportError('Playwright live recorder will not run without additional configuration', `Add by setting environment variable
<pre class="PW-pre">PWDEBUG=console</pre>
or if using vscode ms-playwright.playwright extension, add the following into <a>.vscode/settings.json</a>
<pre class="PW-pre">"playwright.env": {
  "PWDEBUG": "console"
},</pre>`, true);
}
