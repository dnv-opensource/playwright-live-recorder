/******** UI Elements ********/

if (window.PW_statusbar) PW_statusbar.remove();
window.PW_statusbar = document.createElement("div");
PW_statusbar.classList.add("PW");

PW_statusbar.innerHTML = `
<div style="text-align:center;">
  <div id="PW-statusbar" class="PW-statusbar">
    <div>
      <span id="PW-drag-element">⋮⋮</span>
      
      <div class="dropdown__category">
        <li style="margin:-4px 0 1px 0; user-select:none; cursor:pointer;"><span title="static helper methods from page object model file"><span style="font-size:24px;margin:-2px">ƒ</span><span style="font-size:16px;margin:-2px">𝓍</span></span>
          <ul id="PLR_pom_methods_dropdown" class="dropdown__menu" style="text-align:left;">
          </ul>
        </li>
      </div>

      <span class="PW-checkbox-recording" title="Toggle Record\nCtrl+Alt+Shift R">
        <input type="checkbox" id="PW-record-checkbox" onchange="toggleRecordMode(this.checked)">
        <label for="PW-record-checkbox"></label>
      </span>
    </div>
  <span class="input" role="textbox" id="PW-page-object-model-filename" style="color:gray;font-size:10px;">Playwright Live Recorder</span>
  </div>

  <div id="PW_PLR_toast"><div id="PW_PLR_toast_img">icon</div><div id="PW_PLR_toast_desc">message...</div></div>
</div>
`;

document.body.prepend(PW_statusbar);

window.PW_page_object_model_filename = document.getElementById("PW-page-object-model-filename");
window.PLR_pom_methods_dropdown = document.getElementById("PLR_pom_methods_dropdown");

var PLR_dragElement = document.getElementById('PW-drag-element');
var PLR_statusBar = document.getElementById('PW-statusbar');

var _pw_drag_startX, pw_drag_initialTransformX;

PLR_dragElement.addEventListener('mousedown', (event) => {
  const tx  = PLR_statusBar.style.transform;
  pw_drag_initialTransformX = parseInt(tx.substring(tx.indexOf('(') + 1, tx.indexOf('px')), 10);
  if (isNaN(pw_drag_initialTransformX)) pw_drag_initialTransformX = 0;
  
  _pw_drag_startX = event.clientX;

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  PLR_dragElement.style.cursor = 'grabbing';
});

function onMouseMove(event) {
  const currentX = event.clientX;
  const deltaX = currentX - _pw_drag_startX;
  PLR_statusBar.style.transform = `translateX(${deltaX + pw_drag_initialTransformX}px)`;
}

function onMouseUp() {
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);

  PLR_dragElement.style.cursor = 'grab';
}

if (window.PW_tooltip) PW_tooltip.remove();
var PW_tooltip = document.createElement("div");
PW_tooltip.setAttribute("id", "PW_tooltip");
PW_tooltip.classList.add("PW-tooltip");
document.body.appendChild(PW_tooltip);
window.PW_tooltip = PW_tooltip;

/******** behavior ********/

if (window.PW_pages === undefined) window.PW_pages = {};
var mouse_x = 0;
var mouse_y = 0;

if (recordModeOn === undefined) var recordModeOn = false;
PW_config().then((c) => {
  window.config = c;
  //functions serialize through as text, try to create them as functions once again
  config.pageObjectModel.overlay.on = eval(config.pageObjectModel.overlay.on);
  config.pageObjectModel.overlay.off = eval(config.pageObjectModel.overlay.off);
  config.pageObjectModel.generatePropertyTemplate = eval(config.pageObjectModel.generatePropertyTemplate);
  config.pageObjectModel.generateMethodTemplate = eval(config.pageObjectModel.generateMethodTemplate);
});

function keyChord_toggleRecordMode(event) {
  if (!(event.ctrlKey && event.altKey && event.shiftKey && event.key === "R")) return;

  const chkbox = document.getElementById("PW-record-checkbox");
  chkbox.checked = !chkbox.checked; //this doesn't fire the changed event handler, so call toggleRecordMode manually
  toggleRecordMode(chkbox.checked);
}

function toggleRecordMode(checked) {
  recordModeOn = checked;

  if (recordModeOn) {
    updateTooltipPosition(mouse_x, mouse_y);
    const element = document.elementFromPoint(mouse_x, mouse_y);
    updateTooltipContents(element);
    window.PW_tooltip.style.visibility = "visible";
    if (config.pageObjectModel.enabled) {
      reload_page_object_model_elements();
    }
  } else {
    window.PW_tooltip.style.visibility = "hidden";
    if (config.pageObjectModel.enabled) {
      clearPageObjectModelElements();
    }
  }
}

function updateTooltipContents(element) {
  const convention = PW_getSelectorConventionForElement(element);
  if (convention == undefined) return;

  const matcher = convention.match(element);
  if (matcher == undefined) return;

  if (!convention.isPageObjectModel) {
    PW_tooltip.innerText = typeof matcher === "string" ? matcher : JSON.stringify(matcher, undefined, "\t");
  } else {
    const primaryAction = element.closest('[data-page-object-model-primary-action]').getAttribute("data-page-object-model-primary-action");
    if (primaryAction == undefined) return;

    //todo - secondary actions
    //const secondaryActions = element.closest('[data-page-object-model-secondary-actions]').getAttribute("data-page-object-model-secondary-actions");
    const output = convention.output ? convention.output(matcher) : matcher;
    PW_tooltip.innerText = primaryAction.replaceAll('$1', output);
    //todo - secondary actions
  }
}

function updateTooltipPosition(x, y) {
  let xOffset = 0;
  let yOffset = 16;
  if (x > window.visualViewport.width * 0.75) xOffset = -xOffset - PW_tooltip.getBoundingClientRect().width;
  if (y > window.visualViewport.height * 0.75) yOffset = -yOffset - PW_tooltip.getBoundingClientRect().height;
  PW_tooltip.style.left = x + xOffset + "px";
  PW_tooltip.style.top = y + yOffset + "px";
}

window.mousemove_updateToolTip_running = false;
function mousemove_updateTooltip(event) {
  if (mousemove_updateToolTip_running === true) return; //exit early so we don't swamp the CPU
  try {
    mousemove_updateToolTip_running = true;
    const element = document.elementFromPoint(event.x, event.y);
    if (element == null) return;

    mouse_x = event.x;
    mouse_y = event.y;
    window.PW_tooltip.style.visibility = !recordModeOn || element.closest(".PW")  ? "hidden" : "visible";
    if (!recordModeOn) return;

    updateTooltipPosition(mouse_x, mouse_y);

    if (element == null) return;
    if (window.el === element) return;

    updateTooltipContents(element);
    window.el = element;
  } finally {
    mousemove_updateToolTip_running = false;
  }
}

async function recordModeClickHandler_swallowClick(event) {
  if (!recordModeOn) return;
  if (window.PW_executing) return;

  const element = document.elementFromPoint(event.x, event.y);
  if (element == null) return;
  if (element.closest(".PW")) return;

  event.preventDefault();
  event.stopImmediatePropagation();
  return element;
}

async function recordModeClickHandler(event) {
  const element = await recordModeClickHandler_swallowClick(event);
  if (element == null) return;
  
  let newItemName;
  const selectorConvention = PW_getSelectorConventionForElement(element);
  if (config.pageObjectModel.enabled && !selectorConvention.isPageObjectModel) {
    dataTestId = element.closest('[data-testid]')?.getAttribute('data-testid');
    newItemName = window.prompt("Page object model item name?", dataTestId);
    if (newItemName != null) {
      const selector = selectorConvention.match(element);
      const nestedPages = getNestedPages(pageObjectFilePath).concat(getNestedPages('global_page.ts'));
      const nestedPageObjectFilePath = nestedPages.find(x => element.closest(x.selector) !== null)?.filePath;
      await PW_appendToPageObjectModel(nestedPageObjectFilePath ?? pageObjectFilePath, config.pageObjectModel.generatePropertyTemplate(newItemName, selector));
    } else {
      const selector = selectorConvention.match(element);
      navigator.clipboard.writeText(selector); //navigator.clipboard is undefined when running? troubleshoot me
    }
    return;
  }

  const resultOutput = selectorConvention.output ? selectorConvention.output(selectorConvention.match(element)) : selectorConvention.match(element);
  const primaryAction = element.closest('[data-page-object-model-primary-action]').getAttribute("data-page-object-model-primary-action");
  //todo - implement secondary actions
  const replLine = primaryAction.replaceAll('$1', resultOutput);
  //PW_repl.value = replLine;
  //PW_repl.disabled = false;

  if (selectorConvention.isPageObjectModel) {
    await PW_appendToTest(replLine, element.closest('[data-page-object-model-import]').getAttribute("data-page-object-model-import"));
  } else {
    await PW_appendToTest(replLine);
  }
}

function getNestedPages(pageObjectFilePath) {
  const pom = PW_pages[pageObjectFilePath];
  const nestedPages = pom?.nestedPages;
  if (nestedPages === undefined) return [];
  const nestedNestedPages = nestedPages.map(x => getNestedPages(x.filePath))
  return nestedPages.concat(nestedNestedPages.flat());//.uniqueBy(x => x.filePath); //todo - uniqueBy isn't in vanilla JS, fix me
}

PW_getSelectorConventionForElement = function (el) {
  const allSelectorConventions = [...PW_selector_pageObjectModel_conventions, ...(PW_selectorConventions ?? []), ...PW_selector_base_conventions];
  return allSelectorConventions.find((i) => i.match(el) != null /* null or undefined */);
};

window.addEventListener("keydown", keyChord_toggleRecordMode);
window.addEventListener("mousemove", mousemove_updateTooltip);
window.addEventListener("click", recordModeClickHandler, true);
//var _PW_mousedown_element;
//window.addEventListener('pointerdown', function (e) { _PW_mousedown_element = e.target; recordModeClickHandler_swallowClick(e);});//, true);
//document.addEventListener('pointerup', function (e) { if (e.target === _PW_mousedown_element) recordModeClickHandler(e); });//, true);


/******** page object model feature ********/

window.navigation.onnavigatesuccess = async () => await reload_page();
//window.setInterval(async () => await reload_page_object_model_elements(), 5000); //refresh the page object model highlighting every 5 seconds in case on-screen elements have changed


var pageObjectFilePath = "";

async function reload_page() {
  if (PW_urlToFilePath === undefined) return; //test backend hasn't injected functions yet
  //get current page object to reflect across
  pageObjectFilePath = await PW_urlToFilePath(window.location.href);
  PW_page_object_model_filename.innerText = pageObjectFilePath ?? "Playwright Live Recorder";
  await reload_page_object_model_elements();
}

async function reload_page_object_model_elements() {
  clearPageObjectModelElements();

  const globalPageObject = window.PW_pages['global_page.ts'];
  if (globalPageObject !== undefined) await _reload_page_object_model_elements(globalPageObject, 'global_page.ts');
  
  const pageObject = window.PW_pages[pageObjectFilePath];
  await _reload_page_object_model_methods(pageObject, pageObjectFilePath);
  await _reload_page_object_model_elements(pageObject, pageObjectFilePath);
}

async function _reload_page_object_model_methods(pageObject, pageObjectFilePath) {
  window.PLR_pom_methods_dropdown.innerHTML = "";
  for (var meth of pageObject?.methods ?? []) {
    // {name: string, args: string[], body: method.getText() }

    const isAsync = meth.body.includes("async");
    const codeLine = `${isAsync ? 'await ':''}${pageObject.className}.${meth.name}(${meth.args.join(', ')});`
    const el = document.createElement("li");
    el.onclick = () => PW_appendToTest(codeLine, pageObjectModelImportStatement);
    el.innerText = `${meth.name}(${meth.args.join(', ')})`;

    window.PLR_pom_methods_dropdown.appendChild(el);
  }

  {
    const addFunctionEl = document.createElement("li");
    addFunctionEl.innerText = "+";
    addFunctionEl.style = "background:green;color:white;font-size:14px;text-align:center";

    addFunctionEl.onclick = () => {
      const newFunctionName = window.prompt("New function name?");
      if (newFunctionName == null) return;
      PW_appendToPageObjectModel(pageObjectFilePath, config.pageObjectModel.generateMethodTemplate(newFunctionName));
    };
    window.PLR_pom_methods_dropdown.appendChild(addFunctionEl);
  }
}

async function _reload_page_object_model_elements(pageObject, pageObjectFilePath) {
  if (pageObject === undefined) return;

  const pageObjectModelImportStatement = await PW_importStatement(pageObject.className, pageObjectFilePath);
  if (recordModeOn){
    for (var prop of pageObject.selectors) {
      try {
        const matchingElements = playwright.locator(prop.selector).elements;
        if (matchingElements.length > 1) {
          //todo: non-unique locator - show a warning somehow
        }
        if (matchingElements.length === 0) {
          console.info(`could not find element for selector ${prop.selector}. skipping.`);
          continue;
        }

        const primaryAction = config.pageObjectModel.primaryActionByCssSelector.find(([css]) => matchingElements[0].matches(css))[1];
        const secondaryActions = config.pageObjectModel.secondaryActionByCssSelector.filter(([css]) => matchingElements[0].matches(css)).map(([, action]) => action);
        const dataPageObjectModel = `${pageObject.className}.${prop.selectorMethod.name}(${prop.selectorMethod.args.join(', ')})`;
        for (const el of matchingElements) {
          el.setAttribute("data-page-object-model", dataPageObjectModel);
          el.setAttribute("data-page-object-model-import", pageObjectModelImportStatement);
          
          el.setAttribute("data-page-object-model-primary-action", primaryAction);
          el.setAttribute("data-page-object-model-secondary-actions", encodeURIComponent(JSON.stringify(secondaryActions)));
          config.pageObjectModel.overlay.on(el, config.pageObjectModel.overlay.color);
          PW_overlays.push(el);
        }
      } catch (err) {
        console.log(err);
      }
    }
    
    //recursively load all nested pages
    for (var x of pageObject.nestedPages) await _reload_page_object_model_elements(window.PW_pages[x.filePath], x.filePath);
  }
}

function clearPageObjectModelElements() {
  if (window.PW_overlays !== undefined) for (const el of window.PW_overlays) config.pageObjectModel.overlay.off(el);

  //clean up any rogue elements
  const pageObjectModelAttributes = ['data-page-object-model', 'data-page-object-model-import', 'data-page-object-model-primary-action', 'data-page-object-model-secondary-actions'];
  document.querySelectorAll(pageObjectModelAttributes.map(x => `[${x}]`).join(', ')).forEach(el => {
    pageObjectModelAttributes.forEach(attr => el.removeAttribute(attr));
    config.pageObjectModel.overlay.off(el);
  });
  window.PW_overlays = [];
}

//pageObject selector evaluation requires `playwright` object, warn user if it's not available
if (!window.playwright) {
  PW_reportError(
    "Playwright live recorder will not run without additional configuration",
    `Add by setting environment variable
<pre class="PW-pre">PWDEBUG=console</pre>
or if using vscode ms-playwright.playwright extension, add the following into <a>.vscode/settings.json</a>
<pre class="PW-pre">"playwright.env": {
  "PWDEBUG": "console"
},</pre>`,
    true
  );
}

PW_executionBlocks = [];
function PW_callback_begin_executing(i, code, fullCodeBlock) {
  PW_executing = true;
  PW_executionBlocks.push({i, code, fullCodeBlock, isExecuting: true });

  setToastContent('<div class="PW_PLR_loader"></div>', `<pre class="PW-pre">${code}</pre>`);
  show_toast();
}

function PW_callback_finished_executing(i, success, result, code, fullCodeBlock) {
  window.PW_executing = false;
  const executionBlockResult = {i, code, fullCodeBlock, isExecuting: false, success, result };
  let executionBlockIndex = PW_executionBlocks.findIndex(x => x.i == i);
  if (executionBlockIndex == -1) PW_executionBlocks.push(executionBlockResult);
  else PW_executionBlocks[executionBlockIndex] = {...PW_executionBlocks[executionBlockIndex], ...executionBlockResult};

  console.log(`${success ? '✅' : '❌'}\n${code}\n\n${result == undefined ? '' : JSON.stringify(result, undefined, '  ')}`);
  setToastContent(success ? '<span>✅</span>' : '<span>❌</span>', `<pre class="PW-pre">${code}</pre><pre class="PW-pre">${result == undefined ? '' : encodeURIComponent(JSON.stringify(result, undefined, '  '))}</pre>`);
  show_toast(success && result == undefined ? 2_000 : undefined);
  reload_page_object_model_elements();
}

function setToastContent(img, desc) {
  document.getElementById("PW_PLR_toast_img").innerHTML = img;
  document.getElementById("PW_PLR_toast_desc").innerHTML = desc;
}

var show_toast_timeout;
function show_toast(timeoutMs) {
  var x = document.getElementById("PW_PLR_toast");
  x.classList.add('show');
  if (show_toast_timeout) clearTimeout(show_toast_timeout);
  show_toast_timeout = timeoutMs ? setTimeout(function(){ x.classList.remove('show'); }, timeoutMs) : undefined;
}

clearPageObjectModelElements();
setTimeout(() => reload_page(), 1000);