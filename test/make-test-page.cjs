const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'comfyui-params.html'), 'utf8');
const enc = (p) => fs.readFileSync(path.join(root, 'test', 'fixtures', p)).toString('base64');
const defs = [
  ['sample-sdxl.png', enc('sample-sdxl.png')],
  ['workflow-only.png', enc('workflow-only.png')],
  ['sample-tags.webm', enc('sample-tags.webm')],
  ['prompt-api.json', enc('prompt-api.json')],
  ['no-metadata.png', enc('no-metadata.png')]
];
const inject = '<script>\n' +
'window.addEventListener("error", function(e){ (window.__errs=window.__errs||[]).push(e.message); });\n' +
'window.addEventListener("load", async function () {\n' +
'  var results = [];\n' +
'  function assert(c, m) { if (!c) throw new Error(m); }\n' +
'  function q(s) { return document.querySelector(s); }\n' +
'  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }\n' +
'  function step(name, fn) { try { fn(); results.push({ name: name, ok: true }); } catch (e) { results.push({ name: name, ok: false, error: e.message }); } }\n' +
'  function finish() {\n' +
'    var ok = results.filter(function(r){return r.ok}).length;\n' +
'    var pre = document.createElement("pre"); pre.id="testresult";\n' +
'    pre.textContent = "TESTS " + ok + "/" + results.length + "\\n" + JSON.stringify(results, null, 2) + "\\nERRS " + JSON.stringify(window.__errs||[]);\n' +
'    pre.style.cssText="position:fixed;left:0;top:0;z-index:99999;background:#000;color:#0f0;font:11px monospace;padding:8px;max-height:500px;overflow:auto;white-space:pre-wrap";\n' +
'    document.body.appendChild(pre); document.title = "TESTS " + ok + "/" + results.length;\n' +
'  }\n' +
'  function select(n) { window.ComfyApp.select(n); return window.ComfyApp.whenIdle(); }\n' +
'  try {\n' +
'    var files = ' + JSON.stringify(defs) + '.map(function(d){ var bin=Uint8Array.from(atob(d[1]), function(c){return c.charCodeAt(0)}); return new File([bin], d[0]); });\n' +
'    await window.ComfyApp.loadFiles(files);\n' +
'    for (var i=0;i<files.length;i++) { await select(i); }\n' +
'    var s = window.ComfyApp.getState();\n' +
'    step("loaded 5 files", function(){ assert(s.files.length===5, "files="+s.files.length); });\n' +
'    step("all parsed", function(){ assert(s.files.every(function(f){return f.report}), "some report missing"); });\n' +
'    step("detail visible", function(){ assert(document.getElementById("welcome").hidden===true, "welcome visible"); assert(document.getElementById("detail").hidden===false, "detail hidden"); });\n' +
'    await select(0);\n' +
'    step("overview model shown", function(){ assert(q(".overview").textContent.indexOf("dreamshaperXL")>=0, "model missing"); });\n' +
'    step("overview prompt shown", function(){ assert(q(".overview").textContent.indexOf("lighthouse")>=0, "prompt missing"); });\n' +
'    await select(1);\n' +
'    window.ComfyApp.setTab("nodes");\n' +
'    step("workflow-only nodes 10", function(){ assert(qa(".node-card").length===10, "cards="+qa(".node-card").length); });\n' +
'    step("workflow-only widget name", function(){ assert(q(".node-list").textContent.indexOf("ckpt_name")>=0, "ckpt_name missing"); });\n' +
'    step("workflow-only warning", function(){ assert(q(".tab-body").textContent.indexOf("UI workflow")>=0 || q(".tab-body").textContent.indexOf("workflow")>=0, "no wf note"); });\n' +
'    var search = q(".nodes-toolbar input[type=search]");\n' +
'    search.value = "KSampler"; search.dispatchEvent(new Event("input", {bubbles:true}));\n' +
'    step("node search filters", function(){ assert(qa(".node-card").length>=1 && qa(".node-card").length<10, "cards="+qa(".node-card").length); });\n' +
'    search.value = ""; search.dispatchEvent(new Event("input", {bubbles:true}));\n' +
'    var sel = q(".nodes-toolbar select"); sel.value="output"; sel.dispatchEvent(new Event("change",{bubbles:true}));\n' +
'    step("category filter output", function(){ assert(qa(".node-card").length===2, "cards="+qa(".node-card").length); });\n' +
'    sel.value="all"; sel.dispatchEvent(new Event("change",{bubbles:true}));\n' +
'    await select(0);\n' +
'    window.ComfyApp.setTab("nodes");\n' +
'    var search2 = q(".nodes-toolbar input[type=search]");\n' +
'    search2.value = "lighthouse"; search2.dispatchEvent(new Event("input",{bubbles:true}));\n' +
'    step("search by widget value", function(){ assert(qa(".node-card").length===1, "cards="+qa(".node-card").length); });\n' +
'    window.ComfyApp.setTab("workflow");\n' +
'    step("workflow graph rendered", function(){ assert(!!q(".wf-graph-wrap svg"), "no svg"); });\n' +
'    step("workflow stats", function(){ assert(q(".wf-stat .n").textContent==="10", "stat="+q(".wf-stat .n").textContent); });\n' +
'    step("graph controls visible", function(){ assert(!!q(".wf-controls"), "no controls"); assert(q(".wf-pct").textContent==="100%", "pct="+q(".wf-pct").textContent); });\n' +
'    qa(".wf-controls button")[2].click();\n' +
'    step("graph zoom button", function(){ assert(q(".wf-pct").textContent==="125%", "pct="+q(".wf-pct").textContent); });\n' +
'    qa(".wf-controls button")[1].click();\n' +
'    step("graph reset", function(){ assert(q(".wf-pct").textContent==="100%", "pct="+q(".wf-pct").textContent); });\n' +
'    var rep = s.files[0].report;\n' +
'    rep.metadata.workflow.nodes.push({ id: 99, type: "CustomNodeX", title: "自定义节点", pos: [2200, 620], size: [300, 110], mode: 0, inputs: [{ name: "foo", type: "STRING", link: null, widget: { value: "bar" } }, { name: "weird name", type: "INT", link: null }, { name: "alpha beta", type: "FLOAT", link: null, widget: { value: 0.5 } }], widgets_values: ["one", 2, true] });\n' +
'    rep.workflowInfo.nodeCount = 11;\n' +
'    window.ComfyApp.setTab("workflow");\n' +
'    var customG = qa("g[data-node-id]").filter(function(x){ return x.dataset.nodeId === "99"; })[0];\n' +
'    customG.dispatchEvent(new MouseEvent("click", { bubbles: true }));\n' +
'    step("custom node shows all inputs", function(){ assert(q(".wf-inspector").hidden === false, "panel hidden"); assert(q(".wf-insp-title").textContent === "自定义节点", "title="+q(".wf-insp-title").textContent); assert(qa(".wf-insp-table tr").length === 6, "rows="+qa(".wf-insp-table tr").length); var txt=q(".wf-insp-body").textContent; assert(txt.indexOf("weird name")>=0, "weird name missing"); assert(txt.indexOf("widget[0]")>=0, "widget[0] missing"); assert(txt.indexOf("alpha beta")>=0, "alpha beta missing"); });\n' +
'    step("parameter text selectable", function(){ var cell=q(".wf-insp-table td.v"); assert(!!cell, "no value cell"); var us=getComputedStyle(cell).userSelect; assert(us==="text", "userSelect="+us); var range=document.createRange(); range.selectNodeContents(cell); var sel=getSelection(); sel.removeAllRanges(); sel.addRange(range); assert(sel.toString().length>0, "empty selection"); sel.removeAllRanges(); });\n' +
'    q(".wf-insp-close").click();\n' +
'    rep.metadata.workflow.nodes = rep.metadata.workflow.nodes.filter(function(n){ return n.id !== 99; });\n' +
'    rep.workflowInfo.nodeCount = 10;\n' +
'    window.ComfyApp.setTab("nodes");\n' +
'    await new Promise(function(r){ setTimeout(r, 120); });\n' +
'    var tb = q(".tab-body"); var filler = document.createElement("div"); filler.style.height = "1200px"; tb.appendChild(filler); tb.scrollTop = 200; tb.dispatchEvent(new Event("scroll"));\n' +
'    await new Promise(function(r){ setTimeout(r, 150); });\n' +
'    step("content scrolls with custom bar", function(){ assert(tb.scrollHeight > tb.clientHeight, "not scrollable"); assert(tb.scrollTop > 0, "scrollTop="+tb.scrollTop); assert(q(".scroll-rail").hidden === false, "rail hidden"); assert(q(".scroll-thumb").offsetHeight > 0, "thumb missing"); });\n' +
'    tb.scrollTop = 0; filler.remove();\n' +
'    window.ComfyApp.setTab("raw");\n' +
'    step("raw json shown", function(){ assert(!!q("pre.raw-json"), "no raw pre"); assert(q("pre.raw-json").textContent.charAt(0)==="{", "not json"); });\n' +
'    window.ComfyApp.setRawTab("meta");\n' +
'    step("meta entries shown", function(){ assert(qa(".meta-entry").length===2, "entries="+qa(".meta-entry").length); });\n' +
'    await select(2);\n' +
'    step("webm parsed", function(){ assert(s.files[2].report.container==="WebM", "container="+s.files[2].report.container); assert(s.files[2].report.summary.sampler.seed===123456789012345, "seed"); });\n' +
'    await select(3);\n' +
'    step("json parsed", function(){ assert(s.files[3].report.container==="JSON", "container"); assert(s.files[3].report.nodes.length===8, "nodes"); });\n' +
'    await select(4);\n' +
'    window.ComfyApp.setTab("overview");\n' +
'    step("no metadata state", function(){ assert(q(".tab-body").textContent.indexOf("没有找到 ComfyUI 元数据")>=0, "no empty state"); });\n' +
'    step("export object", function(){ var o=window.ComfyApp._test.exportObject(s.files[0].report); assert(o.nodes.length===8, "nodes"); assert(o.prompt, "prompt"); assert(o.workflowInfo.nodeCount===10, "wf"); });\n' +
'    step("markdown export", function(){ var m=window.ComfyApp._test.buildMarkdown(s.files[0].report); assert(m.indexOf("lighthouse")>=0, "prompt"); assert(m.indexOf("## 节点参数")>=0, "nodes"); assert(m.indexOf("KSampler")>=0, "sampler"); });\n' +
'    var ff = document.getElementById("fileFilter"); ff.value="workflow"; ff.dispatchEvent(new Event("input",{bubbles:true}));\n' +
'    step("file filter", function(){ assert(qa(".file-item").length===1, "items="+qa(".file-item").length); });\n' +
'    ff.value=""; ff.dispatchEvent(new Event("input",{bubbles:true}));\n' +
'    step("file count 5", function(){ assert(qa(".file-item").length===5, "items="+qa(".file-item").length); });\n' +
'    document.querySelector(".file-remove").click();\n' +
'    step("remove file", function(){ assert(s.files.length===4, "files="+s.files.length); });\n' +
'    window.ComfyApp.clear();\n' +
'    step("clear list", function(){ assert(s.files.length===0, "files"); assert(document.getElementById("welcome").hidden===false, "welcome hidden"); assert(document.getElementById("detail").hidden===true, "detail visible"); });\n' +
'  } catch (e) { results.push({name:"FATAL", ok:false, error:String(e && e.stack || e)}); }\n' +
'  finish();\n' +
'});\n' +
'</scr'+'ipt>';
const out = html.replace('</body>', inject + '\n</body>');
fs.writeFileSync(path.join(root, 'demo-test.html'), out, 'utf8');
console.log('demo-test.html', (out.length/1024).toFixed(0)+' KB');