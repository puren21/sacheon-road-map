(function () {
  "use strict";

  const commonColumns = [
    ["노선번호", "number"], ["구간", "segment"], ["구분", "gubun"],
    ["노선상태", "status"], ["차선", "lane"], ["도로폭(m)", "width"],
    ["연장(km)", "length"], ["기점", "start"], ["종점", "end"],
    ["비고", "remark"], ["기타", "extra"]
  ];
  const cityColumns = commonColumns.concat([["검토", "review"], ["변경사항", "change"]]);
  const editable = new Set(["gubun", "status", "lane", "width", "length", "start", "end", "remark", "extra", "review", "change"]);
  const numeric = new Set(["segment", "lane", "width", "length"]);
  const collator = new Intl.Collator("ko", { numeric:true, sensitivity:"base" });
  const escape = value => String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[char]);

  function valueOf(row, key) {
    const props = row.properties || {};
    if (key === "number") return row.layerId === "city" ? "시도 " + row.number : row.number;
    if (key === "segment") return String(row.index + 1);
    if (key === "gubun") return row.layerId === "city" ? "시도" : (props.GUBUN || props["구분"] || "농도");
    if (key === "status") return row.status;
    if (key === "length") return row.length;
    const fields = { lane:"차선", width:"도로폭", start:"기점", end:"종점",
      remark:"비고", extra:"기타", review:"검토", change:"변경사항" };
    if (key === "start") return props["기점"] || props["시점"] || "";
    return props[fields[key]] == null ? "" : String(props[fields[key]]);
  }

  function initSacheonAttributeTable(api) {
    const launchers = document.querySelector(".road-table-launchers");
    if (!launchers || launchers.dataset.ready === "true") return;
    launchers.dataset.ready = "true";
    const panel = document.createElement("section");
    panel.id = "sacheonAttributeTable";
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "도로 속성테이블");
    panel.innerHTML =
      '<header class="road-table-header"><strong id="roadTableTitle">도로 속성테이블</strong>' +
      '<nav aria-label="도로 종류"><button type="button" data-table-layer="city">시도</button>' +
      '<button type="button" data-table-layer="rural">농어촌도로</button></nav>' +
      '<input id="roadTableSearch" type="search" placeholder="노선·속성 검색" aria-label="노선·속성 검색">' +
      '<span id="roadTableCount" aria-live="polite"></span>' +
      '<button id="roadTableEdit" type="button" aria-pressed="false">✎ 편집</button>' +
      '<button id="roadTableDelete" type="button" disabled>선택 행 삭제</button>' +
      '<button id="roadTableSave" type="button">저장</button>' +
      '<button id="roadTableCancel" type="button">취소</button>' +
      '<button id="roadTableClose" type="button" aria-label="속성테이블 닫기">×</button></header>' +
      '<div class="road-table-message" id="roadTableMessage" role="status" aria-live="polite"></div>' +
      '<div class="road-table-scroll"><table><colgroup></colgroup><thead></thead><tbody></tbody></table></div>';
    document.body.appendChild(panel);

    let layer = "city", editing = false, busy = false, popup = null;
    let sortKey = "number", sortDirection = 1, requestId = 0;
    let widths = {}, changes = new Map(), selected = new Set(), deleted = new Set();
    const $ = selector => panel.querySelector(selector);
    const keyOf = row => row.groupKey + "::" + row.index;
    const columns = () => layer === "city" ? cityColumns : commonColumns;
    const rows = () => api.rows(layer);

    function message(text, error) {
      const el = $("#roadTableMessage");
      el.textContent = text || "";
      el.classList.toggle("error", !!error);
    }
    function currentValue(row, key) {
      const pending = changes.get(keyOf(row));
      return pending && Object.prototype.hasOwnProperty.call(pending, key) ? pending[key] : valueOf(row, key);
    }
    function setEditingUI() {
      $("#roadTableEdit").setAttribute("aria-pressed", String(editing));
      $("#roadTableEdit").disabled = busy;
      $("#roadTableDelete").disabled = busy || !editing || !selected.size;
      $("#roadTableSave").disabled = busy || (!changes.size && !deleted.size);
      $("#roadTableCancel").disabled = busy || (!changes.size && !deleted.size);
      panel.querySelectorAll("tbody [data-field]").forEach(control => {
        const canEdit = editing && !busy && !control.dataset.fixed;
        control.disabled = !canEdit && control.tagName === "SELECT";
        if (control.tagName === "INPUT") control.readOnly = !canEdit;
      });
    }
    function widthFor(key) {
      const saved = Number(widths[key]);
      if (Number.isFinite(saved) && saved >= 60) return Math.min(saved, 650);
      return key === "__select" ? 62 : key === "number" ? 125 : key === "segment" ? 65 :
        ["remark", "extra", "review", "change", "start", "end"].includes(key) ? 200 : 105;
    }
    function applyWidths() {
      let total = 0;
      panel.querySelectorAll("col[data-column]").forEach(col => {
        const width = widthFor(col.dataset.column);
        col.style.width = width + "px";
        total += width;
      });
      panel.querySelector("table").style.width = total + "px";
    }
    function render() {
      if (panel.hidden) return;
      const all = rows();
      const query = $("#roadTableSearch").value.trim().toLocaleLowerCase();
      const filtered = all.filter(row => !deleted.has(keyOf(row)) && (!query || columns().some(([, key]) =>
        String(currentValue(row, key)).toLocaleLowerCase().includes(query))));
      filtered.sort((a, b) => {
        const av = String(currentValue(a, sortKey)).trim(), bv = String(currentValue(b, sortKey)).trim();
        if (!av || !bv) return (!av ? 1 : 0) - (!bv ? 1 : 0);
        const comparison = numeric.has(sortKey) && Number.isFinite(Number(av)) && Number.isFinite(Number(bv))
          ? Number(av) - Number(bv) : collator.compare(av, bv);
        return comparison * sortDirection || collator.compare(a.groupKey, b.groupKey) || a.index - b.index;
      });
      $("#roadTableTitle").textContent = layer === "city" ? "시도 속성테이블" : "농어촌도로 속성테이블";
      panel.querySelectorAll("[data-table-layer]").forEach(button => {
        button.setAttribute("aria-pressed", String(button.dataset.tableLayer === layer));
      });
      $("#roadTableCount").textContent = filtered.length + " / " + all.length + "구간" +
        (deleted.size ? " · 삭제 예정 " + deleted.size : "");
      const cols = columns();
      $("thead").innerHTML = '<tr><th scope="col">선택</th>' + cols.map(([label, key]) =>
        '<th scope="col" aria-sort="' + (sortKey === key ? (sortDirection === 1 ? "ascending" : "descending") : "none") +
        '"><button type="button" data-sort="' + escape(key) + '">' + escape(label) +
        (sortKey === key ? (sortDirection === 1 ? " ▲" : " ▼") : " ↕") +
        '</button><span class="road-table-resize" data-resize="' + escape(key) +
        '" role="separator" tabindex="0" aria-label="' + escape(label) + ' 열 너비 조절"></span></th>').join("") + "</tr>";
      $("colgroup").innerHTML = '<col data-column="__select">' +
        cols.map(([, key]) => '<col data-column="' + escape(key) + '">').join("");
      $("tbody").innerHTML = filtered.map(row => {
        const rowKey = keyOf(row);
        return '<tr data-row="' + escape(rowKey) + '" aria-selected="' + selected.has(rowKey) +
          '" class="' + (changes.has(rowKey) ? "road-table-dirty" : "") + '">' +
          '<td class="road-table-select-cell"><input class="road-table-select" type="checkbox" aria-label="' +
            escape((row.layerId === "city" ? "시도 " : "") + row.number + " " + (row.index + 1) + "구간 선택") +
            '"' + (selected.has(rowKey) ? " checked" : "") + '></td>' + cols.map(([, key]) => {
          const value = currentValue(row, key);
          const fixed = !editable.has(key) || (row.layerId === "city" && ["gubun", "status"].includes(key));
          const opts = key === "status" ? ["개설", "미확장", "미개설"] : key === "gubun" ? ["면도", "리도", "농도"] : null;
          const control = opts && !fixed
            ? '<select data-field="' + key + '" aria-label="' + escape(key) + '">' +
                opts.map(option => '<option' + (option === value ? " selected" : "") + '>' + option + '</option>').join("") + '</select>'
            : '<input type="text" data-field="' + key + '" aria-label="' + escape(key) +
              '" value="' + escape(value) + '"' + (fixed ? ' data-fixed="true"' : "") + '>';
          return "<td>" + control + "</td>";
        }).join("") + "</tr>";
      }).join("");
      applyWidths();
      setEditingUI();
    }

    function close() {
      if (popup && !popup.closed) { popup.close(); return; }
      panel.hidden = true;
      panel.classList.remove("road-table-popup");
    }
    async function open(nextLayer) {
      layer = nextLayer;
      selected.clear();
      $("#roadTableSearch").value = "";
      try { widths = JSON.parse(localStorage.getItem("sacheon-table-widths-" + layer) || "{}"); }
      catch (_) { widths = {}; }
      if (popup && !popup.closed) popup.focus();
      else {
        const opened = window.open("", "sacheonRoadAttributes", "popup=yes,width=1300,height=680,resizable=yes,scrollbars=yes");
        panel.hidden = false;
        if (opened) {
          popup = opened;
          const doc = opened.document;
          doc.title = "사천시 도로 속성테이블";
          doc.documentElement.lang = "ko";
          const style = doc.createElement("link");
          style.rel = "stylesheet";
          style.href = new URL("road-attribute-table.css?v=20261104-2", location.href).href;
          doc.head.appendChild(style);
          doc.body.replaceChildren(panel);
          panel.classList.add("road-table-popup");
          opened.addEventListener("beforeunload", () => {
            document.body.appendChild(panel);
            panel.hidden = true;
            panel.classList.remove("road-table-popup");
            popup = null;
          }, { once:true });
          opened.focus();
        } else message("팝업이 차단되어 지도 안에 속성테이블을 표시했습니다.");
      }
      render();
      const currentRequest = ++requestId;
      message("저장된 속성을 확인하고 있습니다.");
      try {
        await api.load(layer);
        if (currentRequest !== requestId) return;
        render();
        message("행 선택: 지도 이동 · Shift+클릭: 추가 선택 · 삭제한 행은 저장 전 취소할 수 있습니다.");
      } catch (error) {
        if (currentRequest === requestId) message("온라인 속성 확인 실패: " + error.message, true);
      }
    }

    launchers.addEventListener("click", event => {
      const button = event.target.closest("[data-road-table]");
      if (button) open(button.dataset.roadTable);
    });
    $("#roadTableClose").onclick = close;
    $("#roadTableEdit").onclick = () => { editing = !editing; setEditingUI(); };
    $("#roadTableSearch").oninput = render;
    $("#roadTableCancel").onclick = () => {
      changes.clear(); deleted.clear(); selected.clear(); render();
      message("저장하지 않은 수정과 삭제를 취소했습니다.");
    };
    $("#roadTableDelete").onclick = () => {
      if (!editing || busy || !selected.size) return;
      selected.forEach(rowKey => { deleted.add(rowKey); changes.delete(rowKey); });
      const count = selected.size;
      selected.clear();
      render();
      message(count + "개 구간을 삭제 예정으로 표시했습니다. 저장하면 지도에서도 제거됩니다.");
    };
    panel.querySelector("nav").onclick = event => {
      const button = event.target.closest("[data-table-layer]");
      if (button && button.dataset.tableLayer !== layer) open(button.dataset.tableLayer);
    };
    $("thead").onclick = event => {
      const button = event.target.closest("[data-sort]");
      if (!button) return;
      const key = button.dataset.sort;
      sortDirection = key === sortKey ? -sortDirection : 1;
      sortKey = key;
      render();
    };
    $("thead").addEventListener("pointerdown", event => {
      const handle = event.target.closest("[data-resize]");
      if (!handle || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const key = handle.dataset.resize, start = event.clientX, initial = widthFor(key);
      handle.setPointerCapture(event.pointerId);
      const move = e => { widths[key] = Math.max(60, Math.min(650, initial + e.clientX - start)); applyWidths(); };
      const finish = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", finish);
        handle.removeEventListener("pointercancel", finish);
        try { localStorage.setItem("sacheon-table-widths-" + layer, JSON.stringify(widths)); } catch (_) {}
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", finish);
      handle.addEventListener("pointercancel", finish);
    });
    $("tbody").addEventListener("input", updateCell);
    $("tbody").addEventListener("change", updateCell);
    function updateCell(event) {
      const control = event.target.closest("[data-field]");
      const tr = control && control.closest("tr[data-row]");
      if (!tr || !editing || control.readOnly || control.disabled) return;
      const row = rows().find(item => keyOf(item) === tr.dataset.row);
      if (!row) return;
      const pending = Object.assign({}, changes.get(tr.dataset.row) || {});
      if (control.value === String(valueOf(row, control.dataset.field))) delete pending[control.dataset.field];
      else pending[control.dataset.field] = control.value;
      if (Object.keys(pending).length) changes.set(tr.dataset.row, pending);
      else changes.delete(tr.dataset.row);
      tr.classList.toggle("road-table-dirty", changes.has(tr.dataset.row));
      setEditingUI();
    }
    $("tbody").onclick = event => {
      if (event.target.matches(".road-table-select")) {
        const tr = event.target.closest("tr[data-row]");
        if (tr) {
          if (event.target.checked) selected.add(tr.dataset.row);
          else selected.delete(tr.dataset.row);
          tr.setAttribute("aria-selected", String(selected.has(tr.dataset.row)));
          setEditingUI();
        }
        return;
      }
      const control = event.target.closest("input,select");
      if (control && editing && !control.readOnly && !control.disabled) return;
      const tr = event.target.closest("tr[data-row]");
      if (!tr) return;
      const row = rows().find(item => keyOf(item) === tr.dataset.row);
      if (!row) return;
      if (!event.shiftKey) selected.clear();
      selected.add(tr.dataset.row);
      panel.querySelectorAll("tbody tr").forEach(item => item.setAttribute("aria-selected", String(selected.has(item.dataset.row))));
      panel.querySelectorAll("tbody tr").forEach(item => {
        const checkbox = item.querySelector(".road-table-select");
        if (checkbox) checkbox.checked = selected.has(item.dataset.row);
      });
      setEditingUI();
      if (!event.shiftKey) api.select(row.groupKey, row.index);
    };
    $("#roadTableSave").onclick = async () => {
      if ((!changes.size && !deleted.size) || busy) return;
      const all = api.rows("city").concat(api.rows("rural"));
      const edits = [];
      const removals = [];
      for (const [rowKey, values] of changes) {
        const row = all.find(item => keyOf(item) === rowKey);
        if (!row) { message("구간이 변경되었습니다. 테이블을 다시 열어 주세요.", true); return; }
        for (const field of ["lane", "width", "length"]) {
          if (field in values && values[field].trim() !== "" &&
              (!Number.isFinite(Number(values[field])) || Number(values[field]) < 0)) {
            message("차선·도로폭·연장은 0 이상의 숫자로 입력해 주세요.", true); return;
          }
        }
        edits.push({ groupKey:row.groupKey, index:row.index, values:Object.assign({}, values) });
      }
      for (const rowKey of deleted) {
        const row = all.find(item => keyOf(item) === rowKey);
        if (!row) { message("삭제할 구간이 변경되었습니다. 테이블을 다시 열어 주세요.", true); return; }
        removals.push({ groupKey:row.groupKey, index:row.index });
      }
      busy = true;
      setEditingUI();
      message("수정·삭제 내용을 저장하고 있습니다.");
      try {
        await api.save(edits, removals);
        changes.clear();
        deleted.clear();
        selected.clear();
        render();
        message(edits.length + "개 구간 수정, " + removals.length + "개 구간 삭제를 저장했습니다.");
      } catch (error) {
        const savedGroups = new Set(error.savedGroups || []);
        if (savedGroups.size) {
          for (const rowKey of changes.keys()) {
            if (savedGroups.has(rowKey.slice(0, rowKey.lastIndexOf("::")))) changes.delete(rowKey);
          }
          for (const rowKey of deleted) {
            if (savedGroups.has(rowKey.slice(0, rowKey.lastIndexOf("::")))) deleted.delete(rowKey);
          }
          render();
        }
        message((savedGroups.size ? savedGroups.size + "개 노선은 저장됨. 나머지 " : "") +
          "저장 실패: " + error.message, true);
      } finally { busy = false; setEditingUI(); }
    };
    window.addEventListener("pagehide", () => { if (popup && !popup.closed) popup.close(); });
  }

  window.initSacheonAttributeTable = initSacheonAttributeTable;
})();
