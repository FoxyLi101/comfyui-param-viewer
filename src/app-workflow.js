  function renderWorkflowGraph(wf) {
    if (!wf || !Array.isArray(wf.nodes)) return null;
    var nodes = wf.nodes.filter(function (n) { return n && Array.isArray(n.pos) && n.pos.length >= 2; });
    if (!nodes.length) return null;
    var ns = 'http://www.w3.org/2000/svg';
    var byId = new Map();
    nodes.forEach(function (n) { byId.set(String(n.id), n); });
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function expand(x, y, w, h) {
      if (!isFinite(x) || !isFinite(y)) return;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + (w || 200)); maxY = Math.max(maxY, y + (h || 80));
    }
    nodes.forEach(function (n) {
      var size = Array.isArray(n.size) ? n.size : [280, 92];
      expand(n.pos[0], n.pos[1], size[0], size[1]);
    });
    (wf.groups || []).forEach(function (g) {
      if (Array.isArray(g.bounding) && g.bounding.length >= 4) expand(g.bounding[0], g.bounding[1], g.bounding[2], g.bounding[3]);
    });
    if (!isFinite(minX)) return null;
    var pad = 52;
    var vw = Math.max(320, maxX - minX + pad * 2);
    var vh = Math.max(220, maxY - minY + pad * 2);
    var svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', (minX - pad) + ' ' + (minY - pad) + ' ' + vw + ' ' + vh);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'ComfyUI 工作流结构图');
    var font = Math.max(20, Math.min(64, vw / 34));
    var titleFont = font * 0.72;

    (wf.groups || []).forEach(function (g) {
      if (!Array.isArray(g.bounding) || g.bounding.length < 4) return;
      var r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', g.bounding[0]);
      r.setAttribute('y', g.bounding[1]);
      r.setAttribute('width', Math.max(20, g.bounding[2]));
      r.setAttribute('height', Math.max(20, g.bounding[3]));
      r.setAttribute('rx', 14);
      r.setAttribute('fill', g.color || '#64748b');
      r.setAttribute('fill-opacity', '0.055');
      r.setAttribute('stroke', g.color || '#64748b');
      r.setAttribute('stroke-opacity', '0.26');
      r.setAttribute('stroke-width', '1.4');
      r.setAttribute('stroke-dasharray', '7 6');
      svg.appendChild(r);
      var label = document.createElementNS(ns, 'text');
      label.setAttribute('x', g.bounding[0] + 12);
      label.setAttribute('y', g.bounding[1] + font + 4);
      label.setAttribute('fill', g.color || '#7b8ba3');
      label.setAttribute('font-size', String(titleFont));
      label.setAttribute('font-weight', '700');
      label.setAttribute('opacity', '0.8');
      label.textContent = truncate(g.title || '分组', Math.max(6, Math.floor(g.bounding[2] / (titleFont * 0.62))));
      svg.appendChild(label);
    });

    (wf.links || []).forEach(function (l) {
      if (!Array.isArray(l) || l.length < 5) return;
      var a = byId.get(String(l[1]));
      var b = byId.get(String(l[3]));
      if (!a || !b) return;
      var as = Array.isArray(a.size) ? a.size : [280, 92];
      var ax = a.pos[0] + as[0];
      var ay = a.pos[1] + 42 + (Number(l[2]) || 0) * 20;
      var bx = b.pos[0];
      var by = b.pos[1] + 42 + (Number(l[4]) || 0) * 20;
      var dx = Math.max(42, Math.abs(bx - ax) * 0.45);
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M' + ax + ',' + ay + ' C' + (ax + dx) + ',' + ay + ' ' + (bx - dx) + ',' + by + ' ' + bx + ',' + by);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', '#5d718c');
      p.setAttribute('stroke-width', '1.6');
      p.setAttribute('stroke-opacity', '0.48');
      p.setAttribute('vector-effect', 'non-scaling-stroke');
      svg.appendChild(p);
    });

    nodes.forEach(function (n) {
      var size = Array.isArray(n.size) ? n.size : [280, 92];
      var w = Math.max(120, size[0] || 280);
      var h = Math.max(54, size[1] || 92);
      var cat = CM.categorize(n.type);
      var color = CM.categoryColor(cat);
      var muted = n.mode === 2 || n.mode === 4;
      var g = document.createElementNS(ns, 'g');
      g.setAttribute('opacity', muted ? '0.45' : '1');
      g.setAttribute('data-node-id', String(n.id));
      g.setAttribute('role', 'button');
      g.setAttribute('tabindex', '0');
      g.setAttribute('aria-label', '查看节点 #' + n.id + ' ' + (n.title || n.type || ''));
      g.style.cursor = 'pointer';
      var r = document.createElementNS(ns, 'rect');
      r.setAttribute('x', n.pos[0]);
      r.setAttribute('y', n.pos[1]);
      r.setAttribute('width', w);
      r.setAttribute('height', h);
      r.setAttribute('rx', '9');
      r.setAttribute('fill', color);
      r.setAttribute('fill-opacity', '0.13');
      r.setAttribute('stroke', color);
      r.setAttribute('stroke-opacity', '0.6');
      r.setAttribute('stroke-width', '1.7');
      r.setAttribute('vector-effect', 'non-scaling-stroke');
      if (muted) r.setAttribute('stroke-dasharray', '6 5');
      g.appendChild(r);
      var title = n.title || n.type || '节点';
      var type = n.type || '';
      var maxChars = Math.max(6, Math.floor((w - 24) / (titleFont * 0.62)));
      var t1 = document.createElementNS(ns, 'text');
      t1.setAttribute('x', n.pos[0] + 12);
      t1.setAttribute('y', n.pos[1] + Math.max(22, h * 0.38));
      t1.setAttribute('fill', '#dbe5f3');
      t1.setAttribute('font-size', String(titleFont));
      t1.setAttribute('font-weight', '650');
      t1.setAttribute('font-family', 'Segoe UI, Microsoft YaHei, sans-serif');
      t1.textContent = truncate(title, maxChars);
      g.appendChild(t1);
      if (type && type !== title) {
        var t2 = document.createElementNS(ns, 'text');
        t2.setAttribute('x', n.pos[0] + 12);
        t2.setAttribute('y', n.pos[1] + Math.max(40, h * 0.38 + titleFont * 1.15));
        t2.setAttribute('fill', '#8193aa');
        t2.setAttribute('font-size', String(titleFont * 0.78));
        t2.setAttribute('font-family', 'Cascadia Code, Consolas, monospace');
        t2.textContent = truncate(type, maxChars + 2);
        g.appendChild(t2);
      }
      var id = document.createElementNS(ns, 'text');
      id.setAttribute('x', n.pos[0] + w - 10);
      id.setAttribute('y', n.pos[1] + 18);
      id.setAttribute('text-anchor', 'end');
      id.setAttribute('fill', color);
      id.setAttribute('fill-opacity', '0.75');
      id.setAttribute('font-size', String(font * 0.62));
      id.setAttribute('font-family', 'Cascadia Code, Consolas, monospace');
      id.textContent = '#' + n.id;
      g.appendChild(id);
      var tip = document.createElementNS(ns, 'title');
      tip.textContent = '#' + n.id + ' ' + title + (type ? ' · ' + type : '') + (muted ? '（不执行）' : '');
      g.appendChild(tip);
      svg.appendChild(g);
    });
    return svg;
  }

  function workflowNodeTitle(report, id) {
    var sid = String(id);
    var nodes = report.nodes || [];
    for (var i = 0; i < nodes.length; i++) {
      if (String(nodes[i].id) === sid) return nodes[i].title || nodes[i].classType || ('#' + sid);
    }
    var wf = report.metadata.workflow;
    if (wf && wf.nodes) {
      for (var j = 0; j < wf.nodes.length; j++) {
        if (String(wf.nodes[j].id) === sid) return wf.nodes[j].title || wf.nodes[j].type || ('#' + sid);
      }
    }
    return '#' + sid;
  }

  function getWorkflowDetail(report, id) {
    var sid = String(id);
    var wf = report.metadata.workflow;
    var wfNode = null;
    if (wf && Array.isArray(wf.nodes)) {
      for (var i = 0; i < wf.nodes.length; i++) {
        if (String(wf.nodes[i].id) === sid) { wfNode = wf.nodes[i]; break; }
      }
    }
    var promptNode = report.metadata.prompt && report.metadata.prompt[sid] ? report.metadata.prompt[sid] : null;
    var base = null;
    var all = report.nodes || [];
    for (var j = 0; j < all.length; j++) {
      if (String(all[j].id) === sid) { base = all[j]; break; }
    }
    if (base) {
      return {
        id: sid,
        title: base.title || (wfNode && (wfNode.title || wfNode.type)) || base.classType,
        classType: base.classType || (wfNode && wfNode.type) || '',
        inputs: base.inputs || [],
        raw: base.raw || (wfNode || null),
        mode: base.mode || (wfNode && wfNode.mode) || 0,
        source: promptNode ? 'API prompt' : 'UI workflow'
      };
    }
    if (!wfNode) return null;

    var links = new Map();
    if (Array.isArray(wf.links)) {
      for (var k = 0; k < wf.links.length; k++) {
        var l = wf.links[k];
        if (Array.isArray(l) && l.length >= 5) links.set(l[0], l);
      }
    }
    var seen = Object.create(null);
    var inputs = [];
    function addInput(key, value, link) {
      key = key || 'input';
      if (seen[key]) return;
      seen[key] = true;
      inputs.push({ key: key, value: value, link: link || null });
    }
    var nodeInputs = Array.isArray(wfNode.inputs) ? wfNode.inputs : [];
    for (var n = 0; n < nodeInputs.length; n++) {
      var inp = nodeInputs[n] || {};
      var key = inp.name || ('input_' + (n + 1));
      var link = null;
      if (inp.link !== null && inp.link !== undefined && links.has(inp.link)) {
        var tuple = links.get(inp.link);
        link = { id: String(tuple[1]), slot: Number(tuple[2]) };
      }
      if (link) addInput(key, null, link);
      else if (inp.widget && inp.widget.value !== undefined) addInput(key, inp.widget.value, null);
      else addInput(key, null, null);
    }
    var widgetNames = (CM.workflowWidgetNames && CM.workflowWidgetNames[wfNode.type]) || [];
    var widgets = Array.isArray(wfNode.widgets_values) ? wfNode.widgets_values : [];
    for (var w = 0; w < widgets.length; w++) {
      addInput(widgetNames[w] || ('widget[' + w + ']'), widgets[w], null);
    }
    return {
      id: sid,
      title: wfNode.title || wfNode.type || ('#' + sid),
      classType: wfNode.type || '',
      inputs: inputs,
      raw: wfNode,
      mode: typeof wfNode.mode === 'number' ? wfNode.mode : 0,
      source: 'UI workflow'
    };
  }

  function createWorkflowInspector(report, onNavigate, onClose) {
    var panel = el('aside', 'wf-inspector');
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '节点参数');

    var head = el('div', 'wf-insp-head');
    var titleBox = el('div', 'wf-insp-titlebox');
    var kicker = el('div', 'wf-insp-kicker');
    var idEl = el('span', 'wf-insp-id', '#');
    var classEl = el('span', 'wf-insp-class', '');
    kicker.appendChild(idEl);
    kicker.appendChild(classEl);
    var titleEl = el('h3', 'wf-insp-title', '');
    titleBox.appendChild(kicker);
    titleBox.appendChild(titleEl);
    head.appendChild(titleBox);

    var actions = el('div', 'wf-insp-actions');
    var copyBtn = el('button', 'wf-insp-btn', '');
    copyBtn.type = 'button';
    copyBtn.title = '复制节点 JSON';
    copyBtn.setAttribute('aria-label', '复制节点 JSON');
    copyBtn.innerHTML = ICON.copy;
    actions.appendChild(copyBtn);
    var closeBtn = el('button', 'wf-insp-btn wf-insp-close', '×');
    closeBtn.type = 'button';
    closeBtn.title = '关闭';
    closeBtn.setAttribute('aria-label', '关闭节点参数');
    actions.appendChild(closeBtn);
    head.appendChild(actions);
    panel.appendChild(head);

    var metaEl = el('div', 'wf-insp-meta');
    panel.appendChild(metaEl);
    var bodyEl = el('div', 'wf-insp-body');
    panel.appendChild(bodyEl);

    var current = null;

    function hide() {
      panel.hidden = true;
      current = null;
      if (onClose) onClose();
    }

    function valueNode(inp) {
      if (inp.link) {
        var wrap = el('div', 'wf-insp-links');
        var list = Array.isArray(inp.link) ? inp.link : [inp.link];
        list.forEach(function (l) {
          var b = el('button', 'wf-insp-link');
          b.type = 'button';
          b.dataset.inspectNode = String(l.id);
          b.title = '查看节点 #' + l.id;
          b.appendChild(el('span', '', '← #' + l.id));
          b.appendChild(el('span', 'lt', ' ' + workflowNodeTitle(report, l.id)));
          if (l.slot) b.appendChild(el('span', 'slot', ' [' + l.slot + ']'));
          wrap.appendChild(b);
        });
        return wrap;
      }
      var v = inp.value;
      if (v === null || v === undefined) return el('span', 'wf-insp-null', 'null');
      if (typeof v === 'number') return el('span', 'wf-insp-num', String(v));
      if (typeof v === 'boolean') return el('span', 'wf-insp-bool', v ? 'true' : 'false');
      if (typeof v === 'string') return el('div', 'wf-insp-text', v);
      var json;
      try { json = JSON.stringify(v, null, 2); } catch (e) { json = String(v); }
      if (json && json.length > 80000) json = json.slice(0, 80000) + '\n…';
      return el('pre', 'wf-insp-json', json);
    }

    function show(id) {
      var detail = getWorkflowDetail(report, id);
      if (!detail) return null;
      current = detail;
      panel.hidden = false;
      idEl.textContent = '#' + detail.id;
      classEl.textContent = detail.classType || '';
      titleEl.textContent = detail.title || detail.classType || '';
      titleEl.title = detail.title || '';
      metaEl.textContent = '';
      metaEl.appendChild(el('span', '', detail.inputs.length + ' 个输入'));
      metaEl.appendChild(el('span', 'dot'));
      metaEl.appendChild(el('span', '', detail.source || 'UI workflow'));
      if (detail.mode === 2) metaEl.appendChild(badge('静音', 'amber'));
      if (detail.mode === 4) metaEl.appendChild(badge('绕过', 'red'));
      copyBtn.disabled = false;

      bodyEl.textContent = '';
      if (!detail.inputs.length) {
        bodyEl.appendChild(el('div', 'wf-insp-empty', '这个节点没有输入参数。'));
      } else {
        var table = el('table', 'wf-insp-table');
        var tbody = document.createElement('tbody');
        detail.inputs.forEach(function (inp) {
          var tr = document.createElement('tr');
          tr.appendChild(el('td', 'k', inp.key));
          var td = el('td', 'v');
          td.appendChild(valueNode(inp));
          tr.appendChild(td);
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        bodyEl.appendChild(table);
      }
      bodyEl.scrollTop = 0;
      return detail;
    }

    copyBtn.onclick = function () {
      if (!current || !current.raw) return;
      copyText(JSON.stringify(current.raw, null, 2), '已复制节点 JSON');
    };
    closeBtn.onclick = hide;
    bodyEl.addEventListener('click', function (e) {
      var b = e.target.closest && e.target.closest('[data-inspect-node]');
      if (b && onNavigate) onNavigate(b.dataset.inspectNode);
    });
    panel.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    panel.addEventListener('wheel', function (e) { e.stopPropagation(); }, { passive: true });
    panel.addEventListener('dblclick', function (e) { e.stopPropagation(); });

    return { el: panel, show: show, hide: hide };
  }

  function createGraphViewport(svg, report) {
    var wrap = el('div', 'wf-graph-wrap');
    wrap.appendChild(svg);

    var bar = el('div', 'wf-controls');
    var k = 1, tx = 0, ty = 0;
    var pct = el('button', 'wf-pct', '100%');

    function apply() {
      svg.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + k + ')';
      pct.textContent = Math.round(k * 100) + '%';
    }

    function resetView() {
      k = 1; tx = 0; ty = 0;
      apply();
    }

    function zoomAt(mx, my, factor) {
      var next = Math.max(0.25, Math.min(5, k * factor));
      if (Math.abs(next - k) < 0.0001) return;
      var gx = (mx - tx) / k;
      var gy = (my - ty) / k;
      tx = mx - gx * next;
      ty = my - gy * next;
      k = next;
      apply();
    }

    function ctrl(label, title, fn, data) {
      var b = el('button', 'wf-ctrl', label);
      b.type = 'button';
      b.title = title;
      b.setAttribute('aria-label', title);
      if (data) b.dataset.zoom = data;
      b.onclick = function (e) { e.stopPropagation(); fn(); };
      return b;
    }

    bar.appendChild(ctrl('−', '缩小', function () {
      zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 0.8);
    }, 'out'));
    pct.type = 'button';
    pct.title = '重置为 100%';
    pct.dataset.zoom = 'reset';
    pct.onclick = function (e) { e.stopPropagation(); resetView(); };
    bar.appendChild(pct);
    bar.appendChild(ctrl('+', '放大', function () {
      zoomAt(wrap.clientWidth / 2, wrap.clientHeight / 2, 1.25);
    }, 'in'));
    bar.appendChild(ctrl('⤢', '适应窗口 / 重置', resetView, 'reset'));
    wrap.appendChild(bar);
    wrap.appendChild(el('div', 'wf-hint', '拖动平移 · 滚轮缩放 · 点击节点看参数'));

    var selected = null;
    var suppressClick = false;
    function clearSelected() {
      if (selected) selected.classList.remove('selected');
      selected = null;
    }
    function selectNode(id) {
      var detail = inspector.show(id);
      if (!detail) return;
      clearSelected();
      var groups = svg.querySelectorAll('g[data-node-id]');
      for (var i = 0; i < groups.length; i++) {
        if (groups[i].dataset.nodeId === String(id)) {
          selected = groups[i];
          selected.classList.add('selected');
          break;
        }
      }
    }
    var inspector = createWorkflowInspector(report, function (id) { selectNode(id); }, function () { clearSelected(); });
    wrap.appendChild(inspector.el);

    wrap.addEventListener('wheel', function (e) {
      if (e.target.closest && e.target.closest('.wf-inspector')) return;
      e.preventDefault();
      var rect = wrap.getBoundingClientRect();
      var dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1);
      zoomAt(e.clientX - rect.left, e.clientY - rect.top, Math.exp(-dy * 0.0012));
    }, { passive: false });

    var drag = null;
    wrap.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('.wf-controls, .wf-inspector')) return;
      var hit = e.target.closest && e.target.closest('g[data-node-id]');
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, tx: tx, ty: ty, moved: false, nodeId: hit ? hit.dataset.nodeId : null };
      wrap.classList.add('dragging');
      try { wrap.setPointerCapture(e.pointerId); } catch (err) {}
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      tx = drag.tx + dx;
      ty = drag.ty + dy;
      apply();
    });
    function endDrag(e) {
      if (!drag) return;
      var moved = drag.moved;
      var nodeId = drag.nodeId;
      drag = null;
      wrap.classList.remove('dragging');
      try { wrap.releasePointerCapture(e.pointerId); } catch (err) {}
      if (moved) {
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 80);
      } else if (nodeId) {
        // 指针捕获会改变 click 的 target，因此在 pointerup 时直接判断点击节点
        suppressClick = true;
        setTimeout(function () { suppressClick = false; }, 80);
        selectNode(nodeId);
      }
    }
    wrap.addEventListener('pointerup', endDrag);
    wrap.addEventListener('pointercancel', endDrag);
    wrap.addEventListener('dblclick', function (e) {
      if (e.target.closest && e.target.closest('.wf-controls, .wf-inspector')) return;
      resetView();
    });
    svg.addEventListener('dragstart', function (e) { e.preventDefault(); });

    svg.addEventListener('click', function (e) {
      if (suppressClick) { suppressClick = false; return; }
      var g = e.target.closest && e.target.closest('g[data-node-id]');
      if (g) selectNode(g.dataset.nodeId);
    });
    svg.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var g = e.target.closest && e.target.closest('g[data-node-id]');
      if (!g) return;
      e.preventDefault();
      selectNode(g.dataset.nodeId);
    });

    apply();
    return wrap;
  }

  function truncate(s, n) {
    var arr = Array.from(String(s || ''));
    if (arr.length <= n) return arr.join('');
    return arr.slice(0, Math.max(1, n - 1)).join('') + '…';
  }