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
PW_tooltip.style='position:absolute; left:0; top:0; padding:4px; background:LavenderBlush; outline:1px solid black; border-radius:4px;z-index:2147483647; visibility:hidden';
document.body.appendChild(PW_tooltip);
window.PW_tooltip = PW_tooltip;

function keyChord_showTooltip(event) {
    if (event.ctrlKey && event.altKey && event.shiftKey) window.PW_tooltip.style.visibility = 'visible'; //todo: re-calc hover element and tooltip
}

function keyChordUp_hideTooltip (event) {
    if (event.ctrlKey || event.altKey || event.shiftKey) window.PW_tooltip.style.visibility = 'hidden';
}

function keyChord_mousemove_updateTooltip(event) {
    if (!(event.altKey && event.ctrlKey && event.shiftKey)) return;
    window.PW_tooltip.style.left = event.x + 'px';
    window.PW_tooltip.style.top = event.y + 16 + 'px';
    
    const element = document.elementFromPoint(event.x, event.y);
    if (window.el === element) return;

    window.el = element;

    const rule = document.PW_getRuleForElement(element);

    window.PW_tooltip.innerText = typeof rule.matcher === 'string' ? rule.matcher : JSON.stringify(rule.matcher, undefined, '\t');
}

function keyChord_click_eval(event) {
    if (!(event.altKey && event.ctrlKey && event.shiftKey)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const element = document.elementFromPoint(event.x, event.y);

    const result = document.PW_getRuleForElement(element);
    window.PW_eval(result.output, true);
}

function keyChord_lastCommandRepl(event) {
    if (event.ctrlKey && event.altKey && event.shiftKey) {
        if(event.key == ' ') {
            event.preventDefault();
            event.stopImmediatePropagation();
            lastCommandRepl();
        }
    }
}

async function lastCommandRepl() {
    const lastCommand = await PW_getLastCommand();
    const updatedCommand = window.prompt('edit last command', lastCommand);
    if (updatedCommand == null) return;
    PW_updateAndRerunLastCommand(updatedCommand);
}

document.PW_getRuleForElement = function(el) {
    let matcher = undefined;
    const match = RecorderRules.find(i => { matcher = i.match(el); return matcher !== undefined; });
    return { matcher, output: match.output(matcher) };
}

window.addEventListener('keydown', keyChord_showTooltip);
window.addEventListener('mousemove', keyChord_mousemove_updateTooltip);
window.addEventListener('click', keyChord_click_eval, true);
window.addEventListener('keyup', keyChordUp_hideTooltip);

window.addEventListener('keydown', keyChord_lastCommandRepl, true);