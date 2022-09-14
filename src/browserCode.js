/******** UI Elements ********/

window.PW_statusbar = document.createElement("div");
PW_statusbar.classList.add('PW-statusbar');

PW_statusbar.innerHTML= `
    <input id="PW-repl" style="width:100%" disabled="true" placeholder="Playwright Live Recorder" title="Last executed line (modify and press enter to re-evaluate)">
    <!-- change visibility back after we figure out layout issues  <span id="PW-page-object-model-filename" class="PW-statusbar-item" style="width:0" title="page object model filename"/> -->
    <span class="PW-checkbox-recording PW-statusbar-item" title="Playwright Live Recorder">
        <input type="checkbox" id="PW-record-checkbox" onchange="toggleRecordMode(this.checked)">
        <label for="PW-record-checkbox" style="margin:8px"/>
    </span>
`;

document.body.prepend(PW_statusbar);

window.PW_repl = document.getElementById('PW-repl');
PW_repl.addEventListener('keyup', event => (event.code || event.key) === 'Enter' ? PW_updateAndRerunLastCommand(PW_repl.value) : {})

var PW_tooltip = document.createElement("div");
PW_tooltip.setAttribute('id', 'PW_tooltip');
PW_tooltip.classList.add('PW-tooltip');
document.body.appendChild(PW_tooltip);
window.PW_tooltip = PW_tooltip;

/******** behavior ********/
var mouse_x = 0;
var mouse_y = 0;

var recordModeOn = false;
PW_config().then(c => window.config = c);

function keyChord_toggleRecordMode(event) {
    if (!(event.ctrlKey && event.altKey && event.shiftKey)) return;

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
    PW_tooltip.style.left = x + 'px';
    PW_tooltip.style.top = y + 16 + 'px';
}

function mousemove_updateTooltip(event) {
    const element = document.elementFromPoint(event.x, event.y);
    if (element == null) return;
    if (element.closest(".PW-statusbar")) return;

    mouse_x = event.x;
    mouse_y = event.y;
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
    if (element.closest(".PW-statusbar")) return;

    try {
        handlingClick = true;

        event.preventDefault();
        event.stopImmediatePropagation();

        const result = document.PW_getRuleForElement(element);
        if (result.onClick) result.onClick(element);
        const resultOutput = result.output(result.match(element));
        
        PW_repl.value = resultOutput;
        PW_repl.disabled = false;
        await window.PW_eval(resultOutput, true);
    } finally {
        handlingClick = false;
    }
}

document.PW_getRuleForElement = function (el) {
    return RecorderRules.find(i => i.match(el) != null /* null or undefined */);
};
window.addEventListener('keydown', keyChord_toggleRecordMode);
window.addEventListener('mousemove', mousemove_updateTooltip);
window.addEventListener('click', recordModeClickHandler, true);

/******** page object model feature ********/

var pageObjectName = '';

async function reload_page_object_model_elements() {
    //var $ = document.querySelector.bind(document);
    var $$ = document.querySelectorAll.bind(document);

    if (window.PW_overlays !== undefined) for (const el of window.PW_overlays) el.parentNode.removeChild(el);
    window.PW_overlays = [];
    
    //get current page object to reflect across
    pageObjectName = await PW_urlToFilePath(window.location.href);
    //todo: re-enabled after figuring out layout issues // document.getElementById("PW-page-object-model-filename").innerText = pageObjectName;
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
