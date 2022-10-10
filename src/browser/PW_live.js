/******** UI Elements ********/

if (window.PW_statusbar) PW_statusbar.remove();
window.PW_statusbar = document.createElement("div");
PW_statusbar.classList.add("PW");

PW_statusbar.innerHTML = `
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

window.PW_repl = document.getElementById("PW-repl");
PW_repl.addEventListener("keyup", (event) =>
  (event.code || event.key) === "Enter"
    ? PW_updateAndRerunLastCommand(PW_repl.value)
    : {}
);

window.PW_eval_error = document.getElementById("PW-eval-error");
PW_eval_error.style.display = "none";
window.PW_eval_error_summary = document.getElementById("PW-eval-error-summary");
window.PW_eval_error_details = document.getElementById("PW-eval-error-details");

window.PW_page_object_model_filename = document.getElementById(
  "PW-page-object-model-filename"
);

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
  config.pageObjectModel.generatePropertyTemplate = eval(
    config.pageObjectModel.generatePropertyTemplate
  ); // note this is done browser side... consider if it should be evaluated in test context instead
});

function keyChord_toggleRecordMode(event) {
  if (!(event.ctrlKey && event.altKey && event.shiftKey && event.key === "R"))
    return;

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
  const convention = document.PW_getSelectorConventionForElement(element);
  const matcher = convention.match(element);
  PW_tooltip.innerText =
    typeof matcher === "string"
      ? matcher
      : JSON.stringify(matcher, undefined, "\t");
}

function updateTooltipPosition(x, y) {
  let xOffset = 0;
  let yOffset = 16;
  if (x > window.visualViewport.width * 0.75)
    xOffset = -xOffset - PW_tooltip.getBoundingClientRect().width;
  if (y > window.visualViewport.height * 0.75)
    yOffset = -yOffset - PW_tooltip.getBoundingClientRect().height;
  PW_tooltip.style.left = x + xOffset + "px";
  PW_tooltip.style.top = y + yOffset + "px";
}

window.mousemove_updateToolTip_running = false;
function mousemove_updateTooltip(event) {
  if (mousemove_updateToolTip_running === true) return; //exit early so we don't sawmp the CPU
  try {
    mousemove_updateToolTip_running = true;
    const element = document.elementFromPoint(event.x, event.y);
    if (element == null) return;

    mouse_x = event.x;
    mouse_y = event.y;
    window.PW_tooltip.style.visibility =
      !recordModeOn || element.closest(".PW") ? "hidden" : "visible";
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

async function recordModeClickHandler(event) {
  if (!recordModeOn) return;
  if (window.PW_executing) return;

  const element = document.elementFromPoint(event.x, event.y);
  if (element == null) return;
  if (element.closest(".PW")) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  let newItemName;
  const selectorConvention = document.PW_getSelectorConventionForElement(element);
  if (config.pageObjectModel.enabled && !selectorConvention.isPageObjectModel) {
    newItemName = window.prompt("Page object model item name?");
    if (newItemName != null) {
      const selector = selectorConvention.match(element);
      await PW_appendToPageObjectModel(
        pageObjectFilePath,
        config.pageObjectModel.generatePropertyTemplate(newItemName, selector)
      );
    }
  }
  if (newItemName != null) return;

  const resultOutput = selectorConvention.output(selectorConvention.match(element));
  PW_repl.value = resultOutput;
  PW_repl.disabled = false;

  if (selectorConvention.isPageObjectModel) {
    await PW_appendToTest(
      resultOutput,
      element.getAttribute("data-pom-import-statement")
    );
  } else {
    await PW_appendToTest(resultOutput);
  }
}

document.PW_getSelectorConventionForElement = function (el) {
  const allSelectorConventions = [...PW_selector_PageObjectModel_conventions, ...PW_selectorConventions ?? [], ...PW_selector_base_conventions];
  return allSelectorConventions.find(
    (i) => i.match(el) != null /* null or undefined */
  );
};
window.addEventListener("keydown", keyChord_toggleRecordMode);
window.addEventListener("mousemove", mousemove_updateTooltip);
window.addEventListener("click", recordModeClickHandler, true);

/******** page object model feature ********/

window.navigation.onnavigatesuccess = async () =>
  await reload_page_object_model_elements();

var pageObjectFilePath = "";

async function reload_page_object_model_elements() {
  clearPageObjectModelElements();

  //get current page object to reflect across
  pageObjectFilePath = await PW_urlToFilePath(window.location.href);
  PW_page_object_model_filename.value = pageObjectFilePath;

  if (!recordModeOn) return;

  const pageObject = window.PW_pages[pageObjectFilePath];
  if (pageObject === undefined) return;

  const propertyRegex = new RegExp(
    config.pageObjectModel.propertySelectorRegex.slice(1, -1)
  );
  for (var prop in pageObject.page) {
    try {
      const selectorMethodName = propertyRegex.exec(prop)?.[1];
      if (!selectorMethodName) continue;

      const selector = pageObject.page[prop];
      const matchingElements = playwright.$$(selector);
      if (matchingElements.length > 1) {
        //todo: show a warning somehow
      }
      if (matchingElements.length === 0) {
        console.info(
          `could not find element for selector ${selector}. skipping.`
        );
        continue;
      }
      for (const el of matchingElements) {
        const selectorMethod =
          "" + pageObject.page[selectorMethodName].toString();
        const selectorMethodArgs = selectorMethod.slice(
          selectorMethod.indexOf("("),
          selectorMethod.indexOf(")") + 1
        );

        el.setAttribute(
          "data-page-object-model",
          `${pageObject.className}.${selectorMethodName}${selectorMethodArgs}`
        );
        el.setAttribute(
          "data-pom-import-statement",
          `import {${
            pageObject.className
          }} from './${pageObjectFilePath.replace(/\.ts$/gm, "")}';`
        );
        config.pageObjectModel.overlay.on(el, config);
        PW_overlays.push(el);
      }
    } catch (err) {
      console.log(err);
    }
  }
}

function clearPageObjectModelElements() {
  if (window.PW_overlays !== undefined)
    for (const el of window.PW_overlays) config.pageObjectModel.overlay.off(el);
  window.PW_overlays = [];
}

function PW_reportError(summary, errorStack, doNotWrapDetails) {
  if (summary === undefined && errorStack === undefined) {
    PW_eval_error.style.display = "none";
    return;
  }
  PW_eval_error.style.display = "block";
  PW_eval_error_summary.innerHTML = summary;
  PW_eval_error_details.innerHTML = doNotWrapDetails
    ? errorStack
    : `<pre class="PW-pre">${errorStack}</pre>`;
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
