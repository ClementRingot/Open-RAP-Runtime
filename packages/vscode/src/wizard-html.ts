/** The page of the creation wizard (D61): no VS Code API, so that it can be checked in a browser. */

export function wizardHtml(nonce: string, cspSource: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style nonce="${nonce}">
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 20px 20px; }
  h1 { font-size: 1.3em; font-weight: 600; margin: 16px 0 4px; }
  .sub { color: var(--vscode-descriptionForeground); margin-bottom: 14px; }
  .layout { display: grid; grid-template-columns: minmax(220px, 320px) 1fr; gap: 20px; }
  input, select, textarea { width: 100%; box-sizing: border-box; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border, transparent); padding: 5px 6px; font: inherit; }
  select[multiple] { min-height: 7em; }
  .list { border: 1px solid var(--vscode-panel-border); max-height: 62vh; overflow: auto; margin-top: 8px; }
  .cat { padding: 6px 8px 2px; font-size: .85em; text-transform: uppercase; letter-spacing: .04em; color: var(--vscode-descriptionForeground); }
  .item { padding: 5px 8px 5px 18px; cursor: pointer; }
  .item:hover { background: var(--vscode-list-hoverBackground); }
  .item.sel { background: var(--vscode-list-activeSelectionBackground); color: var(--vscode-list-activeSelectionForeground); }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  .hint { color: var(--vscode-descriptionForeground); font-size: .9em; margin-top: 3px; }
  .desc { margin: 4px 0 10px; }
  .files { font-family: var(--vscode-editor-font-family); font-size: .9em; color: var(--vscode-descriptionForeground); }
  .error { color: var(--vscode-errorForeground); margin-top: 12px; min-height: 1.2em; }
  .buttons { margin-top: 18px; display: flex; gap: 8px; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 6px 14px; cursor: pointer; font: inherit; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: .5; cursor: default; }
</style></head>
<body>
<h1>New RAP object</h1>
<div class="sub">Choose the type of object, as in ADT (New ABAP Repository Object). The abapGit files are written with the object.</div>
<div class="layout">
  <div>
    <input id="filter" placeholder="Filter the types (view, BDEF, service…)" aria-label="Filter">
    <div id="list" class="list" role="listbox" aria-label="Object types"></div>
  </div>
  <div id="form"><div class="hint">Select a type of object on the left.</div></div>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  let catalog = [], objects = {}, current;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  function renderList() {
    const q = $("filter").value.toLowerCase();
    let html = "", last = "";
    for (const e of catalog) {
      if (q && !(e.label + " " + e.description + " " + e.kind + " " + e.category).toLowerCase().includes(q)) continue;
      if (e.category !== last) { html += '<div class="cat">' + esc(e.category) + "</div>"; last = e.category; }
      html += '<div class="item' + (current && current.kind === e.kind ? " sel" : "") + '" role="option" data-kind="' + e.kind + '">' + esc(e.label) + "</div>";
    }
    $("list").innerHTML = html || '<div class="hint" style="padding:8px">No type</div>';
    for (const el of document.querySelectorAll(".item")) el.addEventListener("click", () => select(el.dataset.kind));
  }
  function inputHtml(input) {
    const id = "in_" + input.option.slice(2);
    let control;
    if (input.of) {
      const options = (objects[input.of] || []).map((o) => '<option value="' + esc(o) + '">' + esc(o) + "</option>").join("");
      control = '<select id="' + id + '"' + (input.multiple ? " multiple" : "") + ">" + (input.multiple || input.required ? "" : '<option value=""></option>') + options + "</select>";
      if (!(objects[input.of] || []).length) control += '<div class="hint">No object of this type in the project.</div>';
    } else if (input.values) {
      control = '<select id="' + id + '">' + input.values.map((v) => '<option value="' + esc(v) + '"' + (v === input.default ? " selected" : "") + ">" + esc(v === "true" ? "yes" : v === "false" ? "no" : v) + "</option>").join("") + "</select>";
    } else {
      control = '<input id="' + id + '" value="' + esc(input.default || "") + '">';
    }
    return "<label for=\\"" + id + "\\">" + esc(input.label) + (input.required ? " *" : "") + "</label>" + control;
  }
  function select(kind) {
    current = catalog.find((e) => e.kind === kind);
    renderList();
    const prefix = current.kind === "bo" ? '<label for="in_prefix">Object prefix</label><input id="in_prefix" value="Z"><div class="hint">ZRT gives zrt_travel, ZRT_R_Travel…</div>' : "";
    $("form").innerHTML =
      '<h2 style="margin:0">' + esc(current.label) + '</h2><div class="desc">' + esc(current.description) + '</div><div class="files">' + esc(current.files) + "</div>" +
      '<label for="name">Name *</label><input id="name" value="' + esc(current.namePattern) + '" maxlength="' + current.maxLength + '"><div class="hint">' + current.maxLength + " characters at most; letters, digits and _.</div>" +
      '<label for="description">Description</label><input id="description" placeholder="Label (EndUserText.label)">' +
      prefix + current.inputs.map(inputHtml).join("") +
      '<div id="error" class="error"></div><div class="buttons"><button id="finish">Create</button><button id="cancel" class="secondary">Cancel</button></div>';
    $("finish").addEventListener("click", finish);
    $("cancel").addEventListener("click", () => vscode.postMessage({ type: "cancel" }));
    $("name").focus();
    $("name").select();
  }
  function finish() {
    const values = {};
    for (const input of current.inputs) {
      const el = $("in_" + input.option.slice(2));
      values[input.option] = input.multiple ? Array.from(el.selectedOptions).map((o) => o.value) : el.value;
    }
    if ($("in_prefix")) values["--prefix"] = $("in_prefix").value;
    $("finish").disabled = true;
    $("error").textContent = "";
    vscode.postMessage({ type: "finish", answer: { kind: current.kind, name: $("name").value.trim(), description: $("description").value.trim(), values } });
  }
  window.addEventListener("message", (event) => {
    const m = event.data;
    if (m.type === "init") { catalog = m.catalog; objects = m.objects; renderList(); if (m.kind) select(m.kind); }
    if (m.type === "error") { $("error").textContent = m.message; $("finish").disabled = false; }
  });
  $("filter").addEventListener("input", renderList);
  vscode.postMessage({ type: "ready" });
</script>
</body></html>`;
}
