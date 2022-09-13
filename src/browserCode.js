/******** UI Elements ********/

window.PW_statusbar = document.createElement("div");
PW_statusbar.classList.add('PW-statusbar');
window.PW_statusbar_recordToggleBtn = document.createElement("button");
PW_statusbar_recordToggleBtn.innerHTML = `<button class="PW_statusbar-item" title="Click to toggle on Record Mode" onclick="toggleRecordMode()">⬤</button>`;
window.PW_statusbar_repl = document.createElement("input");
PW_statusbar_repl.innerHTML = `<input style="PW_statusbar-item" placeholder="last executed line (modify and press enter to re-evaluate)"></input>`;
window.PW_statusbar_pageObjectModelName = document.createElement("span");
PW_statusbar_pageObjectModelName.innerHTML = `<span class="PW-statusbar-item" title="page object model filename"></span>`;
window.PW_statusbar_title = document.createElement("span");
PW_statusbar_title.innerHTML = `<span class="PW-statusbar-item" style="font-size:1.5em; color:rgba(0,0,0,.15)">Playwright Live Recorder</span>`;

PW_statusbar.appendChild(PW_statusbar_title);
PW_statusbar.appendChild(PW_statusbar_pageObjectModelName);
PW_statusbar.appendChild(PW_statusbar_repl);
PW_statusbar.appendChild(PW_statusbar_recordToggleBtn);
document.body.prepend(PW_statusbar);


var PW_tooltip = document.createElement("div");
PW_tooltip.setAttribute('id', 'PW_tooltip');
PW_tooltip.classList.add('PW-tooltip');
document.body.appendChild(PW_tooltip);
window.PW_tooltip = PW_tooltip;


/******** styles ********/
var style = document.createElement('style');
document.head.appendChild(style);
style.sheet.insertRule(`.PW-tooltip {
    position: absolute;
    left: 0;
    top: 0;
    padding: 4px;
    background: LavenderBlush;
    outline: 1px solid black;
    border-radius: 4px;
    z-index: 2147483647;
    visibility: hidden;
}`);
style.sheet.insertRule(`.PW-page-object-model-overlay {
    position: absolute;
    background-color: #ff8080;
    opacity: 0.7;
}`); //todo: add border, z-index

style.sheet.insertRule(`.PW-statusbar {
    position: sticky;
    border-bottom: 1px solid #A0A0A0;
    background: rgb(220, 220, 220);
    display: flex;
    justify-content: flex-end;
}`);
style.sheet.insertRule(`.PW-statusbar-item {
    display: flex;
}`);

/******** behavior ********/
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
        PW_statusbar_recordToggleBtn.title = "Recording, click to toggle off"
        PW_statusbar_recordToggleBtn.style.color = "red";

        updateTooltipPosition(mouse_x, mouse_y);
        const element = document.elementFromPoint(mouse_x, mouse_y);
        updateTooltipContents(element);
        window.PW_tooltip.style.visibility = 'visible';
        if(config.pageObjectModel.enabled) {
            reload_page_object_model_elements();
            for (const overlayEl of window.PW_overlays) overlayEl.style.visibility = 'visible';
        }
    } else {
        PW_statusbar_recordToggleBtn.style.color = "gray";
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
    PW_statusbar_pageObjectModelName.innerText = pageObjectName;
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
