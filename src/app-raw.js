  // ---------------------------------------------------------------------------
  // 原始数据
  // ---------------------------------------------------------------------------

  function renderRawTab(report, rec) {
    var wrap = el('div');
    var hasPrompt = !!report.metadata.prompt;
    var hasWf = !!report.metadata.workflow;
    if (state.rawTab === 'prompt' && !hasPrompt) state.rawTab = hasWf ? 'workflow' : 'meta';
    if (state.rawTab === 'workflow' && !hasWf) state.rawTab = hasPrompt ? 'prompt' : 'meta';

    var bar = el('div', 'raw-toolbar');
    function pill(key, label, enabled) {
      var b = el('button', 'pill-tab' + (state.rawTab === key ? ' active' : ''), label);
      b.type = 'button';
      b.disabled = !enabled;
      b.onclick = function () { state.rawTab = key; renderTabs(rec); };
      bar.appendChild(b);
    }
    pill('prompt', 'prompt', hasPrompt);
    pill('workflow', 'workflow', hasWf);
    pill('meta', '全部元数据', true);

    var actions = el('div', 'raw-actions');
    var copy = el('button', 'btn ghost small');
    copy.type = 'button';
    copy.innerHTML = ICON.copy + '<span>复制</span>';
    copy.onclick = function () { copyText(rawText(report, state.rawTab), '已复制原始数据'); };
    actions.appendChild(copy);
    var dl = el('button', 'btn ghost small');
    dl.type = 'button';
    dl.innerHTML = ICON.download + '<span>下载</span>';
    dl.onclick = function () { downloadRaw(report, state.rawTab); };
    actions.appendChild(dl);
    bar.appendChild(actions);
    wrap.appendChild(bar);

    if (state.rawTab === 'meta') {
      if (!report.metadata.entries.length) {
        wrap.appendChild(el('div', 'raw-empty', '没有可展示的文本元数据。'));
        return wrap;
      }
      report.metadata.entries.forEach(function (entry) {
        var d = document.createElement('details');
        d.className = 'meta-entry';
        var summary = document.createElement('summary');
        summary.appendChild(el('span', 'mk', entry.key));
        summary.appendChild(el('span', 'ms', entry.source));
        summary.appendChild(el('span', 'ml', entry.text.length + ' 字符'));
        d.appendChild(summary);
        var txt = entry.text;
        if (txt.length > 200000) txt = txt.slice(0, 200000) + '\n\n…（已截断，完整内容可导出 JSON）';
        d.appendChild(el('pre', '', txt));
        wrap.appendChild(d);
      });
      if (report.metadata.candidates && report.metadata.candidates.length) {
        wrap.appendChild(sectionTitle('识别到的 JSON 候选'));
        var list = el('div');
        report.metadata.candidates.forEach(function (c) {
          var row = el('div', 'mini-row');
          row.appendChild(el('span', 'tag', c.kind));
          row.appendChild(el('span', '', c.source + (c.entryKey ? ' · ' + c.entryKey : '') + ' · ' + c.chars + ' 字符'));
          list.appendChild(row);
        });
        wrap.appendChild(list);
      }
      return wrap;
    }

    var obj = state.rawTab === 'prompt' ? report.metadata.prompt : report.metadata.workflow;
    if (!obj) { wrap.appendChild(el('div', 'raw-empty', '没有 ' + state.rawTab + ' 数据。')); return wrap; }
    var text;
    try { text = JSON.stringify(obj, null, 2); } catch (e) { text = String(obj); }
    if (text.length > 4000000) text = text.slice(0, 4000000) + '\n\n…（内容过大，已截断）';
    wrap.appendChild(el('pre', 'raw-json', text));
    return wrap;
  }

  function rawText(report, tab) {
    if (tab === 'meta') {
      return report.metadata.entries.map(function (e) { return '===== ' + e.key + ' (' + e.source + ') =====\n' + e.text; }).join('\n\n');
    }
    var obj = tab === 'prompt' ? report.metadata.prompt : report.metadata.workflow;
    if (!obj) return '';
    try { return JSON.stringify(obj, null, 2); } catch (e) { return String(obj); }
  }

  function downloadRaw(report, tab) {
    var text = rawText(report, tab);
    if (!text) { toast('没有可下载的数据', 'err'); return; }
    var ext = tab === 'meta' ? 'txt' : 'json';
    downloadText(text, safeBase(report.file.name) + '-' + tab + '.' + ext, 'application/' + (ext === 'json' ? 'json' : 'text'));
    toast('已下载 ' + tab + ' 数据', 'ok');
  }

  // ---------------------------------------------------------------------------
  // 导出
  // ---------------------------------------------------------------------------

  function exportObject(report) {
    return {
      tool: report.tool,
      version: report.version,
      exportedAt: new Date().toISOString(),
      file: { name: report.file.name, size: report.file.size, type: report.file.type, container: report.container },
      detection: report.detection,
      summary: report.summary,
      nodes: report.nodes.map(function (n) {
        return {
          id: n.id, class_type: n.classType, title: n.title, category: n.category, mode: n.mode,
          inputs: n.inputs.map(function (i) { return { key: i.key, value: i.value, link: i.link }; })
        };
      }),
      workflow: report.metadata.workflow,
      workflowInfo: report.workflowInfo ? {
        nodeCount: report.workflowInfo.nodeCount,
        linkCount: report.workflowInfo.linkCount,
        groupCount: report.workflowInfo.groupCount,
        groups: report.workflowInfo.groups,
        muted: report.workflowInfo.muted,
        bypassed: report.workflowInfo.bypassed,
        version: report.workflowInfo.version,
        revision: report.workflowInfo.revision
      } : null,
      prompt: report.metadata.prompt,
      metadata: {
        promptSource: report.metadata.promptSource,
        workflowSource: report.metadata.workflowSource,
        entries: report.metadata.entries.map(function (e) { return { key: e.key, source: e.source, chars: e.text.length }; })
      },
      warnings: report.warnings
    };
  }

  async function exportAll() {
    if (!state.files.length || state.busy) return;
    state.busy = true;
    var btn = els.btnExportAll;
    var oldHtml = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '解析中…';
    try {
      for (var i = 0; i < state.files.length; i++) {
        var rec = state.files[i];
        if (!rec.report && rec.status !== 'error') await parseRecord(rec);
      }
      var out = [];
      state.files.forEach(function (rec) { if (rec.report) out.push(exportObject(rec.report)); });
      if (!out.length) { toast('没有可导出的文件', 'err'); return; }
      downloadJson({ tool: 'ComfyUI Param Inspector', version: CM.VERSION, exportedAt: new Date().toISOString(), files: out }, 'comfyui-params-all.json');
      toast('已导出 ' + out.length + ' 个文件的参数', 'ok');
    } catch (e) {
      toast('导出失败：' + (e.message || e), 'err');
    } finally {
      state.busy = false;
      btn.disabled = !state.files.length;
      btn.innerHTML = oldHtml;
    }
  }
