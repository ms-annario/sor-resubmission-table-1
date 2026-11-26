/**
 * Tender Comparison — Standalone Interactive Application
 */
(function () {
  const COMMENTS_STORAGE_KEY = 'sor_tender_comparison_comments_v1';

  const state = {
    selectedTenderers: TENDERERS.map((t) => t.id),
    crossBasis: 'median',                  // 'median' | 'mean' | 'min'
    threshold: 10,                         // Variance threshold (± %)
    splitTenderers: { apex: ['Orig', 'R1', 'R2', 'R3', 'R4'] },
    reworkMap: {},                         // itemId -> true
    activeCommentItem: null,               // itemId | null
    comments: {}                           // itemId -> [{ id, text }]
  };

  try {
    const saved = JSON.parse(localStorage.getItem(COMMENTS_STORAGE_KEY) || '{}');
    if (saved && typeof saved === 'object') {
      state.comments = saved;
    }
  } catch (e) {}

  function saveComments() {
    try {
      localStorage.setItem(COMMENTS_STORAGE_KEY, JSON.stringify(state.comments));
    } catch (e) {}
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* =========================================================================
   * Helpers & Analytics
   * ========================================================================= */
  function getAvailableSteps(tendererId) {
    return TENDERER_STEPS[tendererId] || STEPS;
  }

  function getLatestStep(tendererId) {
    const steps = getAvailableSteps(tendererId);
    return steps[steps.length - 1];
  }

  function getVisibleTenderers() {
    return TENDERERS.filter((t) => state.selectedTenderers.includes(t.id));
  }

  function isTendererSplit(tendererId) {
    const sel = state.splitTenderers[tendererId];
    return Array.isArray(sel) && sel.length > 0;
  }

  function getDisplayedSteps(tendererId) {
    const avail = getAvailableSteps(tendererId);
    if (isTendererSplit(tendererId)) {
      const sel = state.splitTenderers[tendererId];
      const filtered = avail.filter((s) => sel.includes(s));
      return filtered.length > 0 ? filtered : [avail[avail.length - 1]];
    }
    return [avail[avail.length - 1]];
  }

  function getStepDisplayName(step) {
    return step === 'Orig' ? 'Original' : `Resubmission ${step.replace('R', '')}`;
  }

  function getRate(tenderer, itemId, step, specKey) {
    const obj = tenderer.rates[itemId][step];
    if (specKey === 'BASKET') return obj.SPN + obj.DP + obj.TPN;
    if (specKey === 'AVG') return (obj.SPN + obj.DP + obj.TPN) / 3;
    return obj[specKey];
  }

  function getDeltaPercent(tenderer, itemId, step, specKey) {
    if (step === 'Orig') return 0;
    const curr = getRate(tenderer, itemId, step, specKey);
    const base = getRate(tenderer, itemId, 'Orig', specKey);
    return base === 0 ? 0 : ((curr - base) / base) * 100;
  }

  function formatRate(val) {
    if (Math.abs(val - Math.round(val)) < 0.05) {
      return Math.round(val).toLocaleString('en-SG');
    }
    return val.toFixed(1);
  }

  function formatCurrency(val) {
    if (Math.abs(val - Math.round(val)) < 0.05) {
      return `S$${Math.round(val).toLocaleString('en-SG')}`;
    }
    return `S$${val.toLocaleString('en-SG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  }

  function formatDeltaCompact(pct, isOrig = false) {
    if (isOrig) return 'Base';
    const rounded = Math.round(pct * 10) / 10;
    if (Math.abs(rounded) < 0.05) return '0.0%';
    return rounded < 0 ? `${rounded.toFixed(1)}%` : `+${rounded.toFixed(1)}%`;
  }

  function formatBasisDiff(diff) {
    if (Math.abs(diff) < 0.05) return '$0';
    const sign = diff > 0 ? '+' : '-';
    const abs = Math.abs(diff);
    if (Math.abs(abs - Math.round(abs)) < 0.05) {
      return `${sign}$${Math.round(abs).toLocaleString('en-SG')}`;
    }
    return `${sign}$${abs.toLocaleString('en-SG', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}`;
  }

  function formatBasisPct(pct) {
    const rounded = Math.round(pct * 10) / 10;
    if (Math.abs(rounded) < 0.05) return '0.0%';
    return rounded > 0 ? `+${rounded.toFixed(1)}%` : `${rounded.toFixed(1)}%`;
  }

  function getPillSwatchColor(pct, isOrig = false) {
    if (isOrig) return '#cbd5e1';
    const rounded = Math.round(pct * 10) / 10;
    if (Math.abs(rounded) < 0.05) return '#f1f5f9';
    if (pct <= -11) return '#0f766e';
    if (pct <= -8.5) return '#059669';
    if (pct <= -5.5) return '#10b981';
    if (pct <= -2.5) return '#4ade80';
    if (pct < 0) return '#bbf7d0';
    if (pct <= 2.5) return '#fde68a';
    if (pct <= 5.5) return '#fbbf24';
    if (pct <= 8.5) return '#fb923c';
    if (pct <= 11) return '#f43f5e';
    return '#be123c';
  }

  function getTendererStepSummary(tenderer) {
    const avail = getAvailableSteps(tenderer.id);
    const origTotal = BOQ_ITEMS.reduce((acc, it) => acc + getRate(tenderer, it.id, 'Orig', 'BASKET'), 0);
    const totalsByStep = {};
    const deltasByStep = {};
    avail.forEach((s) => {
      const total = BOQ_ITEMS.reduce((acc, it) => acc + getRate(tenderer, it.id, s, 'BASKET'), 0);
      totalsByStep[s] = total;
      deltasByStep[s] = origTotal > 0 ? ((total - origTotal) / origTotal) * 100 : 0;
    });
    return { totalsByStep, deltasByStep };
  }

  function getCrossRef(itemId, specKey, visibleTenderers) {
    const vals = visibleTenderers.map((t) => getRate(t, itemId, getLatestStep(t.id), specKey));
    if (vals.length === 0) return { val: 0, label: 'Med' };
    if (state.crossBasis === 'mean') {
      return { val: vals.reduce((a, b) => a + b, 0) / vals.length, label: 'Mean' };
    }
    if (state.crossBasis === 'min') {
      return { val: Math.min(...vals), label: 'Min' };
    }
    const sorted = [...vals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const med = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    return { val: med, label: 'Med' };
  }

  /**
   * 17-Rule Cell Colour, Arrow & Unexpected Increase Alert Spec
   */
  function getCellSpec(currVal, origVal, refVal, isOrig) {
    const threshold = Math.max(1, Number(state.threshold) || 10);
    const lowerLimit = refVal * (1 - threshold / 100);
    const upperLimit = refVal * (1 + threshold / 100);

    let zone = 'grey';
    let cellBg = '#f1f5f9';
    let valueColor = '#0f172a';
    if (currVal < lowerLimit - 1e-6) {
      zone = 'green';
      cellBg = '#dcfce7';
      valueColor = '#14532d';
    } else if (currVal > upperLimit + 1e-6) {
      zone = 'red';
      cellBg = '#fee2e2';
      valueColor = '#7f1d1d';
    }

    let arrowDir = 'na';
    let arrowChar = '';
    let arrowColor = '#94a3b8';
    if (!isOrig) {
      if (currVal > origVal + 0.001) {
        arrowDir = 'up';
        arrowChar = '↑';
        arrowColor = '#dc2626';
      } else if (currVal < origVal - 0.001) {
        arrowDir = 'down';
        arrowChar = '↓';
        arrowColor = '#15803d';
      }
    }

    const showAlert = !isOrig
      && origVal <= upperLimit + 1e-6
      && currVal > origVal + 0.001
      && currVal <= upperLimit + 1e-6;

    return { zone, cellBg, valueColor, arrowDir, arrowChar, arrowColor, showAlert, lowerLimit, upperLimit };
  }

  /* =========================================================================
   * 1. Render Toolbar Controls
   * ========================================================================= */
  function renderControls() {
    const filterBar = document.getElementById('tenderer-filter-bar');
    const allSelected = TENDERERS.every((t) => state.selectedTenderers.includes(t.id));
    const someSelected = !allSelected && state.selectedTenderers.length > 0;

    filterBar.innerHTML = `
      <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Tenderers</span>
      <div class="flex flex-wrap items-center gap-1.5">
        <label
          title="${allSelected ? 'Deselect down to 1 tenderer' : 'Select all tenderers'}"
          class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer select-none transition-colors ${
            allSelected
              ? 'bg-blue-50/80 border-blue-200 text-blue-800 font-semibold'
              : 'bg-white border-slate-300 text-slate-700 font-semibold hover:border-blue-300 hover:text-blue-700'
          }"
        >
          <input
            type="checkbox"
            data-select-all="true"
            ${allSelected ? 'checked' : ''}
            class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
          />
          <span>Select All</span>
        </label>
        <span class="w-px h-4 bg-slate-200 mx-0.5" aria-hidden="true"></span>
        ${TENDERERS.map((t) => {
          const checked = state.selectedTenderers.includes(t.id);
          return `
            <label class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs cursor-pointer select-none transition-colors ${
              checked
                ? 'bg-blue-50/80 border-blue-200 text-blue-800 font-semibold'
                : 'bg-slate-50 border-slate-200 text-slate-500 hover:text-slate-800'
            }">
              <input
                type="checkbox"
                data-tenderer-chk="${t.id}"
                ${checked ? 'checked' : ''}
                class="rounded border-slate-300 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
              />
              <span>${t.shortName}</span>
            </label>
          `;
        }).join('')}
      </div>
    `;

    const selectAllChk = filterBar.querySelector('[data-select-all]');
    if (selectAllChk) {
      selectAllChk.indeterminate = someSelected;
      selectAllChk.addEventListener('change', (e) => {
        state.selectedTenderers = e.target.checked
          ? TENDERERS.map((t) => t.id)
          : [TENDERERS[0].id];
        renderAll();
      });
    }

    filterBar.querySelectorAll('[data-tenderer-chk]').forEach((chk) => {
      chk.addEventListener('change', (e) => {
        const id = chk.getAttribute('data-tenderer-chk');
        if (e.target.checked) {
          if (!state.selectedTenderers.includes(id)) state.selectedTenderers.push(id);
        } else {
          if (state.selectedTenderers.length <= 1) {
            e.target.checked = true;
            return;
          }
          state.selectedTenderers = state.selectedTenderers.filter((x) => x !== id);
        }
        renderAll();
      });
    });

    // Row 2: Variance Basis & Threshold
    const varianceRow = document.getElementById('variance-toolbar-row');
    varianceRow.innerHTML = `
      <div class="flex flex-wrap items-center gap-4">
        <div class="inline-flex items-center gap-2">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Variance Basis</span>
          <div class="inline-flex rounded-lg border border-slate-200 overflow-hidden bg-white shadow-2xs" role="group" aria-label="Variance basis">
            ${[
              { id: 'median', label: 'Median' },
              { id: 'mean', label: 'Mean' },
              { id: 'min', label: 'Min Price' }
            ].map((b, i) => `
              <button
                type="button"
                data-cross-basis="${b.id}"
                class="px-2.5 py-1 text-xs font-semibold ${i > 0 ? 'border-l border-slate-200' : ''} transition-colors cursor-pointer ${
                  state.crossBasis === b.id ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'
                }"
              >${b.label}</button>
            `).join('')}
          </div>
        </div>

        <div class="inline-flex items-center gap-2">
          <span class="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Variance Threshold<span class="text-rose-500">*</span></span>
          <div class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg border border-slate-300 bg-white focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100">
            <span class="text-xs font-medium text-slate-500 select-none">±</span>
            <input
              id="variance-threshold-input"
              type="number"
              min="1"
              max="100"
              step="1"
              value="${state.threshold}"
              aria-label="Variance threshold percentage"
              class="w-10 text-xs font-semibold text-slate-900 tabular-nums focus:outline-none bg-transparent"
            />
            <span class="text-xs font-semibold text-slate-500 select-none">%</span>
          </div>
        </div>
      </div>
    `;

    varianceRow.querySelectorAll('[data-cross-basis]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.crossBasis = btn.getAttribute('data-cross-basis');
        renderAll();
      });
    });

    const thrInput = document.getElementById('variance-threshold-input');
    if (thrInput) {
      const applyThr = () => {
        const val = parseFloat(thrInput.value);
        if (!Number.isFinite(val) || val < 1) return;
        state.threshold = Math.min(100, Math.round(val));
        renderAll();
      };
      thrInput.addEventListener('change', applyThr);
      thrInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          applyThr();
        }
      });
    }
  }

  /* =========================================================================
   * 2. Render Table & Header Controls
   * ========================================================================= */
  function buildCellHtml(tenderer, item, specKey, step, crossRef, isLatestSub) {
    const currVal = getRate(tenderer, item.id, step, specKey);
    const origVal = getRate(tenderer, item.id, 'Orig', specKey);
    const isOrig = step === 'Orig';
    const isPrevSub = !isLatestSub;
    const withinPct = isOrig ? 0 : (origVal > 0 ? ((currVal - origVal) / origVal) * 100 : 0);
    const basisDiff = currVal - crossRef.val;
    const basisPct = crossRef.val > 0 ? (basisDiff / crossRef.val) * 100 : 0;
    const basisDiffStr = formatBasisDiff(basisDiff);
    const basisPctStr = formatBasisPct(basisPct);
    const spec = getCellSpec(currVal, origVal, crossRef.val, isOrig);
    const basisTextColor = spec.zone === 'grey' ? '#334155' : spec.valueColor;
    const basisStripCls = spec.zone === 'green'
      ? 'border-green-300/85 divide-green-300/85 bg-white/35'
      : (spec.zone === 'red'
          ? 'border-red-300/85 divide-red-300/85 bg-white/35'
          : 'border-slate-300/80 divide-slate-300/80 bg-white/50');

    const baseChip = isOrig
      ? `<span class="text-[9.5px] font-semibold text-slate-500 bg-white/75 px-1 py-0 rounded border border-black/[0.06]">Base</span>`
      : `<span class="text-[9.5px] font-medium text-slate-600 bg-white/70 px-1 py-0 rounded tabular-nums">Orig ${formatRate(origVal)}</span>`;

    const alertBadge = spec.showAlert
      ? `<span
          class="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 border border-amber-400 text-amber-700 text-[10px] font-bold leading-none shadow-2xs shrink-0"
          title="Alert: Original rate ($${formatRate(origVal)}) was within/below the upper acceptable limit ($${spec.upperLimit.toFixed(1)}), yet the resubmission price increased to $${formatRate(currVal)}."
          aria-label="Unexpected price increase alert"
        >⚠</span>`
      : '';

    const arrowRowHtml = isOrig
      ? ''
      : `<div class="text-[10px] ${isPrevSub ? 'font-medium' : 'font-semibold'} mt-1 leading-none whitespace-nowrap" title="vs Original (${formatRate(origVal)}): ${withinPct > 0 ? '+' : ''}${withinPct.toFixed(1)}%">
          ${spec.arrowDir === 'na'
            ? `<span class="text-slate-400">0.0%</span>`
            : `<span style="color: ${spec.arrowColor};">${spec.arrowChar} ${withinPct > 0 ? '+' : ''}${withinPct.toFixed(1)}%</span>`}
        </div>`;

    return `
      <td
        class="heat-cell p-0 min-w-[106px] tabular-nums align-top border-r border-slate-200/85 ${isPrevSub ? 'c5-prev-sub' : ''}"
        style="background-color: ${spec.cellBg};"
        data-tooltip-trigger="true"
        data-tenderer-id="${tenderer.id}"
        data-col-tenderer="${tenderer.id}"
        data-col-step="${step}"
        data-item-id="${item.id}"
        data-spec-key="${specKey}"
        data-hover-step="${step}"
      >
        <div class="flex flex-col justify-between h-full">
          <div class="flex-1 flex flex-col px-1.5 pt-2 pb-1.5">
            <div class="flex items-center justify-between gap-1 mb-1 min-h-[16px]">
              ${baseChip}
              ${alertBadge}
            </div>
            <div class="flex-1 flex flex-col items-center justify-center text-center">
              <div class="${isPrevSub ? 'text-sm font-semibold' : 'text-[15px] font-bold'} tracking-tight leading-none" style="color: ${spec.valueColor};">
                ${formatRate(currVal)}
              </div>
              ${arrowRowHtml}
            </div>
          </div>
          <div
            class="grid grid-cols-2 divide-x border-t ${basisStripCls} text-[10px] ${isPrevSub ? 'font-medium' : 'font-semibold'} leading-none"
            style="color: ${basisTextColor};"
            title="vs ${crossRef.label} (S$${crossRef.val.toFixed(1)}): ${basisDiffStr} (${basisPctStr})"
          >
            <div class="py-1.5 px-1 text-center whitespace-nowrap">${basisDiffStr}</div>
            <div class="py-1.5 px-1 text-center whitespace-nowrap">${basisPctStr}</div>
          </div>
        </div>
      </td>
    `;
  }

  function renderTable() {
    const table = document.getElementById('evaluation-table');
    const visibleTenderers = getVisibleTenderers();
    const eligible = visibleTenderers.filter((t) => getAvailableSteps(t.id).length > 1);
    const openIds = eligible.filter((t) => isTendererSplit(t.id)).map((t) => t.id);

    // Legend
    const legendEl = document.getElementById('color-legend');
    const thr = Math.max(1, Number(state.threshold) || 10);
    const basisLegendLabel = state.crossBasis === 'mean'
      ? 'Mean'
      : (state.crossBasis === 'min' ? 'Min Price' : 'Median');
    legendEl.innerHTML = `
      <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-[3px] border border-green-300" style="background:#dcfce7"></span><span>&lt; -${thr}%</span></span>
      <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-[3px] border border-slate-300" style="background:#f1f5f9"></span><span>±${thr}%</span></span>
      <span class="inline-flex items-center gap-1"><span class="w-2.5 h-2.5 rounded-[3px] border border-red-300" style="background:#fee2e2"></span><span>&gt; +${thr}%</span></span>
      <span class="text-slate-300">|</span>
      <span class="inline-flex items-center gap-1 font-semibold text-red-600" title="Resubmission increased vs Original submission within the same tenderer"><span>↑</span><span class="font-normal text-slate-500">Up</span></span>
      <span class="inline-flex items-center gap-1 font-semibold text-green-700" title="Resubmission decreased vs Original submission within the same tenderer"><span>↓</span><span class="font-normal text-slate-500">Down</span><span class="font-normal text-slate-400">(vs Orig)</span></span>
      <span class="inline-flex items-center gap-1" title="Original price was within or below upper acceptable limit, yet resubmission increased">
        <span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 border border-amber-400 text-amber-700 text-[9px] font-bold leading-none">⚠</span>
        <span>Unexpected</span>
      </span>
      <span class="text-slate-300">|</span>
      <span class="inline-flex items-center gap-1" title="Bottom split bar on every cell (including Original) shows dollar and percentage difference from ${basisLegendLabel}">
        <span class="inline-flex items-center border border-slate-300 rounded-[3px] bg-white divide-x divide-slate-300 text-[9px] font-semibold text-slate-600 overflow-hidden"><span class="px-1">±$</span><span class="px-1">±%</span></span>
        <span>vs ${basisLegendLabel}</span>
      </span>
    `;

    // Quick View Tabs: Latest Submission Only | All Submissions
    const viewTabsEl = document.getElementById('table-view-tabs');
    const isLatestOnlyActive = openIds.length === 0;
    const isAllSubActive = eligible.length > 0 && openIds.length === eligible.length;
    viewTabsEl.innerHTML = `
      <button
        type="button"
        role="tab"
        aria-selected="${isLatestOnlyActive}"
        data-table-view="latest"
        class="px-2.5 py-1 text-xs font-semibold transition-colors cursor-pointer ${
          isLatestOnlyActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
        }"
      >Latest Submission Only</button>
      <button
        type="button"
        role="tab"
        aria-selected="${isAllSubActive}"
        data-table-view="all"
        class="px-2.5 py-1 text-xs font-semibold border-l border-slate-200 transition-colors cursor-pointer ${
          isAllSubActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'
        }"
      >All Submissions</button>
    `;

    viewTabsEl.querySelectorAll('[data-table-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-table-view');
        if (mode === 'latest') {
          if (openIds.length === 0) return;
          hideTooltip();
          openIds.forEach((tId) => {
            const bar = table.querySelector(`[data-pill-bar="${tId}"]`);
            if (bar) bar.classList.add('c5-bar-closing');
            const keepStep = getLatestStep(tId);
            getDisplayedSteps(tId)
              .filter((s) => s !== keepStep)
              .forEach((st) => {
                table.querySelectorAll(`[data-col-tenderer="${tId}"][data-col-step="${st}"]`).forEach((el) => {
                  el.classList.add('c5-col-closing');
                });
              });
          });
          setTimeout(() => {
            state.splitTenderers = {};
            renderAll();
          }, 185);
        } else if (mode === 'all') {
          const next = {};
          TENDERERS.forEach((t) => {
            const avail = getAvailableSteps(t.id);
            if (avail.length > 1) next[t.id] = [...avail];
          });
          state.splitTenderers = next;
          renderAll();
        }
      });
    });

    // Cross-tenderer Price Statistics
    const crossBasisTitle = state.crossBasis === 'mean'
      ? 'Mean'
      : (state.crossBasis === 'min' ? 'Min Price' : 'Median');
    const crossRefMap = {};
    let statGrandTotal = 0;
    BOQ_ITEMS.forEach((item) => {
      crossRefMap[item.id] = {};
      SPECS.forEach((sp) => {
        const ref = getCrossRef(item.id, sp, visibleTenderers);
        crossRefMap[item.id][sp] = ref;
        statGrandTotal += ref.val;
      });
    });

    const companyMeta = visibleTenderers.map((t) => ({
      tenderer: t,
      stepInfo: getTendererStepSummary(t),
      availSteps: getAvailableSteps(t.id),
      steps: getDisplayedSteps(t.id),
      isSplit: isTendererSplit(t.id)
    }));

    let html = `
      <thead>
        <!-- Row 1: Company Group Headers -->
        <tr class="border-b border-slate-200 bg-slate-50">
          <th rowspan="3" class="sticky-col-sn bg-slate-50 w-[56px] min-w-[56px] py-3 px-2 border-r border-slate-200 text-xs font-semibold text-slate-500">S/N</th>
          <th rowspan="3" class="sticky-col-cap bg-slate-50 w-[166px] min-w-[166px] py-3 px-3 border-r border-slate-200 text-left text-xs font-semibold text-slate-700">
            Capacity<span class="block text-[10px] font-medium text-slate-400">(Ampere)</span>
          </th>
          ${companyMeta.map(({ tenderer: t, stepInfo, availSteps, steps, isSplit }) => {
            const headerBg = isSplit ? 'bg-blue-50/55 border-t-2 border-t-blue-500' : 'bg-slate-50';
            const resubCount = availSteps.length - 1;

            const controlsHtml = isSplit
              ? `
                <div data-pill-bar="${t.id}" class="inline-flex flex-wrap items-center justify-center gap-1.5">
                  <div class="inline-flex flex-wrap items-center justify-center gap-1 bg-white/90 px-1.5 py-1 rounded-lg border border-blue-200/90 shadow-2xs" role="group" aria-label="Select ${t.shortName} resubmissions">
                    ${availSteps.map((s) => {
                      const selected = steps.includes(s);
                      const stepTotal = formatCurrency(stepInfo.totalsByStep[s]);
                      const stepDelta = stepInfo.deltasByStep[s];
                      const swatch = getPillSwatchColor(stepDelta, s === 'Orig');
                      return `
                        <button
                          type="button"
                          aria-pressed="${selected}"
                          data-company-id="${t.id}"
                          data-step-toggle="${s}"
                          title="${s} · ${stepTotal}/d (${formatDeltaCompact(stepDelta, s === 'Orig')}) — click to ${selected ? 'hide' : 'show'}"
                          class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[10px] font-semibold cursor-pointer select-none transition-colors ${
                            selected
                              ? 'bg-blue-600 border-blue-600 text-white shadow-2xs'
                              : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-slate-700 hover:bg-white'
                          }"
                        >
                          <span class="w-2.5 h-2.5 rounded-[3px] border ${selected ? 'border-white/40' : 'border-black/15'} shrink-0" style="background-color: ${swatch};" aria-hidden="true"></span>
                          <span class="leading-none">${s}</span>
                        </button>
                      `;
                    }).join('')}
                  </div>
                  <button
                    type="button"
                    data-split-toggle="${t.id}"
                    aria-label="Close ${t.shortName} breakdown"
                    title="Close breakdown"
                    class="inline-flex items-center justify-center w-6 h-6 rounded-full border border-slate-200 bg-white text-slate-400 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50 text-[11px] font-bold leading-none shadow-2xs transition-colors cursor-pointer shrink-0"
                  >✕</button>
                </div>
              `
              : (resubCount > 0
                  ? `
                    <button
                      type="button"
                      role="switch"
                      aria-checked="false"
                      data-split-toggle="${t.id}"
                      title="Open breakdown to compare from ${availSteps.length} submissions"
                      class="inline-flex items-center gap-1.5 pl-1.5 pr-2 py-0.5 rounded-full border text-[10px] font-semibold transition-colors cursor-pointer bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-800"
                    >
                      <span class="relative inline-flex h-3.5 w-6 shrink-0 items-center rounded-full bg-slate-300 transition-colors">
                        <span class="inline-block h-2.5 w-2.5 transform rounded-full bg-white shadow-sm translate-x-0.5 transition-transform"></span>
                      </span>
                      <span>Breakdown</span>
                    </button>
                  `
                  : `<span class="inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">Orig only</span>`);

            return `
              <th data-group-header="${t.id}" colspan="${steps.length * 3}" class="py-2.5 px-3 border-r-2 border-slate-300/90 ${headerBg}">
                <div class="flex flex-col items-center gap-1.5">
                  <span class="text-xs sm:text-[13px] font-bold text-slate-900 whitespace-nowrap">${t.name}</span>
                  ${controlsHtml}
                </div>
              </th>
            `;
          }).join('')}
          <th colspan="3" class="py-2.5 px-3 bg-slate-100/90 border-l-2 border-slate-300 text-center align-middle">
            <div class="flex flex-col items-center justify-center">
              <span class="text-xs sm:text-[13px] font-bold text-slate-900 whitespace-nowrap">Price Statistics: ${crossBasisTitle}</span>
            </div>
          </th>
        </tr>

        <!-- Row 2: Per-Round Subheaders -->
        <tr class="border-b border-slate-200 bg-slate-50/90 text-[10px] font-semibold text-slate-600">
          ${companyMeta.map(({ tenderer: t, stepInfo, availSteps, steps }) => {
            const latestStep = availSteps[availSteps.length - 1];
            return steps.map((s, sIdx) => {
              const isLastStep = sIdx === steps.length - 1;
              const isLatestSub = s === latestStep;
              const dPct = stepInfo.deltasByStep[s];
              const dCls = dPct < -0.05 ? 'text-emerald-700' : (dPct > 0.05 ? 'text-rose-700' : 'text-slate-400');
              return `
                <th data-col-tenderer="${t.id}" data-col-step="${s}" colspan="3" class="py-1.5 px-2 ${isLastStep ? 'border-r-2 border-slate-300/90' : 'border-r border-slate-200/90'} ${
                  isLatestSub ? 'bg-white' : 'bg-slate-100/80 opacity-75'
                }">
                  <div class="flex items-center justify-center gap-1 whitespace-nowrap">
                    <span class="${isLatestSub ? 'font-bold text-slate-900' : 'font-medium text-slate-400'}">${getStepDisplayName(s)}</span>
                    <span class="text-[9.5px] ${isLatestSub ? `font-semibold ${dCls}` : 'font-medium text-slate-400'}">${s === 'Orig' ? '(Base)' : `(${dPct > 0 ? '+' : ''}${dPct.toFixed(1)}%)`}</span>
                  </div>
                </th>
              `;
            }).join('');
          }).join('')}
          <th colspan="3" class="py-1.5 px-2 bg-slate-100/80 border-l-2 border-slate-300 text-center">
            <div class="flex items-center justify-center gap-1 whitespace-nowrap">
              <span class="font-bold text-slate-700">Rate ($)/unit</span>
              <span class="text-[9.5px] font-medium text-slate-400">· 10/15kA</span>
            </div>
          </th>
        </tr>

        <!-- Row 3: SPN / DP / TPN Subheaders -->
        <tr class="border-b border-slate-200 bg-slate-50/75 text-[10px]">
          ${companyMeta.map(({ tenderer: t, availSteps, steps }) => {
            const latestStep = availSteps[availSteps.length - 1];
            return steps.map((s, sIdx) => {
              const isLastStep = sIdx === steps.length - 1;
              const isLatestSub = s === latestStep;
              return SPECS.map((sp, spIdx) => `
                <th data-col-tenderer="${t.id}" data-col-step="${s}" class="py-1.5 px-1 ${
                  isLatestSub ? 'font-semibold text-slate-600 bg-white/80' : 'font-medium text-slate-400 bg-slate-100/70'
                } ${
                  spIdx === 2
                    ? (isLastStep ? 'border-r-2 border-slate-300/90' : 'border-r border-slate-200/90')
                    : 'border-r border-slate-200/80'
                }">${sp}</th>
              `).join('');
            }).join('');
          }).join('')}
          ${SPECS.map((sp, spIdx) => `
            <th class="py-1.5 px-1 font-semibold text-slate-700 bg-slate-100/65 ${spIdx === 0 ? 'border-l-2 border-slate-300' : ''} ${spIdx < 2 ? 'border-r border-slate-200/90' : ''}">${sp}</th>
          `).join('')}
        </tr>
      </thead>
      <tbody class="divide-y divide-slate-200">
    `;

    const hasAnyReworkRow = BOQ_ITEMS.some((it) => Boolean(state.reworkMap[it.id]));

    BOQ_ITEMS.forEach((item) => {
      const isRowMarkedRework = Boolean(state.reworkMap[item.id]);
      const rowComments = state.comments[item.id] || [];
      const isCommentOpen = state.activeCommentItem === item.id;
      const stickyCellBg = isRowMarkedRework ? 'bg-rose-50' : 'bg-white';
      const rowFocusCls = isRowMarkedRework
        ? 'c5-row-rework-focus'
        : (hasAnyReworkRow ? 'c5-row-dimmed' : '');
      const chatBtnCls = isCommentOpen
        ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
        : (rowComments.length > 0
            ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
            : (isRowMarkedRework
                ? 'bg-white text-rose-600 border-rose-200 hover:bg-rose-50'
                : 'bg-white text-slate-400 border-slate-200 hover:text-slate-700 hover:border-slate-300 hover:bg-slate-50'));

      html += `<tr data-row-item="${item.id}" class="bg-white ${rowFocusCls}">`;
      html += `
        <td class="sticky-col-sn ${stickyCellBg} py-3 px-2 border-r border-slate-200 text-xs font-semibold ${isRowMarkedRework ? 'text-rose-700' : 'text-slate-500'} tabular-nums align-middle">
          <span>${item.sn}</span>
        </td>
        <td class="sticky-col-cap ${stickyCellBg} py-2.5 px-3 border-r border-slate-200 text-left align-middle">
          <div class="text-xs sm:text-[13px] font-bold text-slate-900 tabular-nums">${item.capacity}</div>
          <div class="text-[10px] text-slate-400 mt-0.5">10/15kA</div>
          <div class="mt-2 flex items-center gap-1.5">
            <button
              type="button"
              data-rework-item="${item.id}"
              title="${isRowMarkedRework ? 'Marked Need Rework — click to remove' : 'Mark ' + item.capacity + ' as Need Rework and comment'}"
              class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                isRowMarkedRework
                  ? 'bg-rose-600 text-white border-rose-600 hover:bg-rose-700 shadow-2xs'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-rose-300 hover:text-rose-700 hover:bg-rose-50/70'
              }"
            >${isRowMarkedRework ? '⚠ Need Rework' : 'Need Rework'}</button>
            <button
              type="button"
              data-comment-btn="${item.id}"
              aria-expanded="${isCommentOpen}"
              aria-label="Comment on ${item.capacity}"
              title="${rowComments.length > 0 ? `${rowComments.length} comment${rowComments.length > 1 ? 's' : ''} — click to view or add` : `Add comment on ${item.capacity}`}"
              class="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full border text-[10px] font-semibold transition-colors cursor-pointer shrink-0 ${chatBtnCls}"
            >
              <svg class="w-3 h-3 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M3.5 5.5A2.5 2.5 0 0 1 6 3h8a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 14 14H8.5L5 17v-3H6a2.5 2.5 0 0 1-2.5-2.5v-6Z"/>
              </svg>
              ${rowComments.length > 0 ? `<span class="tabular-nums leading-none">${rowComments.length}</span>` : ''}
            </button>
          </div>
        </td>
      `;

      companyMeta.forEach(({ tenderer: t, availSteps, steps }) => {
        const latestStep = availSteps[availSteps.length - 1];
        steps.forEach((s, sIdx) => {
          const isLastStep = sIdx === steps.length - 1;
          const isLatestSub = s === latestStep;
          SPECS.forEach((sp, spIdx) => {
            let cellHtml = buildCellHtml(t, item, sp, s, crossRefMap[item.id][sp], isLatestSub);
            if (spIdx === 2) {
              cellHtml = cellHtml.replace(
                'border-r border-slate-200/85',
                isLastStep ? 'border-r-2 border-slate-300/90' : 'border-r border-slate-200/90'
              );
            }
            html += cellHtml;
          });
        });
      });

      SPECS.forEach((sp, spIdx) => {
        const statVal = crossRefMap[item.id][sp].val;
        const fmtStat = Math.abs(statVal - Math.round(statVal)) < 0.05
          ? String(Math.round(statVal))
          : statVal.toFixed(1);
        html += `
          <td
            class="py-3 px-2 min-w-[78px] bg-slate-50/75 tabular-nums text-center align-middle ${spIdx === 0 ? 'border-l-2 border-slate-300' : ''} ${spIdx < 2 ? 'border-r border-slate-200/85' : ''}"
            title="${crossBasisTitle} (${item.capacity} ${sp}): $${fmtStat}"
          >
            <div class="text-[15px] font-bold text-slate-900 tracking-tight leading-none">${fmtStat}</div>
          </td>
        `;
      });

      html += `</tr>`;
    });

    html += `</tbody>`;

    // Sticky Footer: 3-Spec Totals + Price Statistics Total
    html += `
      <tfoot class="sticky-footer border-t-2 border-slate-300/90">
        <tr>
          <td colspan="2" class="sticky-col-sn bg-slate-50 py-2.5 px-3 border-r border-slate-200 text-left align-middle shadow-[4px_0_10px_-4px_rgba(15,23,42,0.08)]">
            <div class="text-xs font-bold text-slate-900">3-Spec Totals</div>
            <div class="text-[10px] text-slate-500 mt-0.5">${BOQ_ITEMS.length} Ampere Tiers</div>
          </td>
          ${companyMeta.map(({ tenderer: t, availSteps, stepInfo, steps }) => {
            const latestStep = availSteps[availSteps.length - 1];
            return steps.map((s, sIdx) => {
              const isLastStep = sIdx === steps.length - 1;
              const isLatestSub = s === latestStep;
              const totalCurr = stepInfo.totalsByStep[s];
              const dPct = stepInfo.deltasByStep[s];
              const deltaColor = dPct < -0.05 ? 'text-emerald-700' : (dPct > 0.05 ? 'text-rose-700' : 'text-slate-500');
              const totalBasisDiff = totalCurr - statGrandTotal;
              const totalBasisPct = statGrandTotal > 0 ? (totalBasisDiff / statGrandTotal) * 100 : 0;
              const totalBasisDiffStr = formatBasisDiff(totalBasisDiff);
              const totalBasisPctStr = formatBasisPct(totalBasisPct);
              const totalBasisPillCls = totalBasisPct < -thr - 1e-6
                ? 'border-green-300 divide-green-300 bg-green-100/85 text-green-900'
                : (totalBasisPct > thr + 1e-6
                    ? 'border-red-300 divide-red-300 bg-red-100/85 text-red-900'
                    : 'border-slate-200/90 divide-slate-200/90 bg-slate-50/80 text-slate-600');
              return `
                <td data-col-tenderer="${t.id}" data-col-step="${s}" colspan="3" class="py-2 px-2.5 ${isLastStep ? 'border-r-2 border-slate-300/90' : 'border-r border-slate-200/90'} tabular-nums align-middle ${isLatestSub ? 'bg-white' : 'bg-slate-100/80 opacity-70'}">
                  <div class="flex items-center justify-center gap-1 whitespace-nowrap">
                    <span class="${isLatestSub ? 'text-xs font-bold text-slate-900' : 'text-[11px] font-medium text-slate-500'}">${formatCurrency(totalCurr)}/d</span>
                    <span class="text-[10px] ${isLatestSub ? `font-semibold ${deltaColor}` : 'font-medium text-slate-400'}">
                      ${s === 'Orig' ? '(Base)' : `(${dPct > 0 ? '+' : ''}${dPct.toFixed(1)}%)`}
                    </span>
                  </div>
                  <div class="mt-1 inline-flex items-center rounded border divide-x text-[9.5px] ${isLatestSub ? `font-semibold ${totalBasisPillCls}` : 'font-medium border-slate-200/80 divide-slate-200/80 bg-slate-50/60 text-slate-400'} whitespace-nowrap" title="vs ${crossBasisTitle} (${formatCurrency(Math.round(statGrandTotal))}/d): ${totalBasisDiffStr} (${totalBasisPctStr})">
                    <span class="px-1.5 py-0.5">${totalBasisDiffStr}</span>
                    <span class="px-1.5 py-0.5">${totalBasisPctStr}</span>
                  </div>
                </td>
              `;
            }).join('');
          }).join('')}
          <td colspan="3" class="py-2.5 px-2.5 bg-slate-100/90 border-l-2 border-slate-300 tabular-nums align-middle text-center">
            <div class="flex items-center justify-center gap-1 whitespace-nowrap">
              <span class="text-xs font-bold text-slate-900">${formatCurrency(Math.round(statGrandTotal))}/d</span>
              <span class="text-[10px] font-semibold text-slate-500">(${crossBasisTitle})</span>
            </div>
          </td>
        </tr>
      </tfoot>
    `;

    table.innerHTML = html;
    bindTableEvents(table);
  }

  /* =========================================================================
   * 3. Animated Breakdown & Row Interactions
   * ========================================================================= */
  function runAnimatedUpdate(mutateState, opts = {}) {
    const table = document.getElementById('evaluation-table');
    const {
      closingTendererId = null,
      closingSteps = [],
      closePillBar = false,
      openingTendererId = null,
      openingSteps = [],
      settleTendererId = null
    } = opts;

    const beforeLeft = {};
    table.querySelectorAll('[data-group-header]').forEach((el) => {
      beforeLeft[el.getAttribute('data-group-header')] = el.getBoundingClientRect().left;
    });

    const performFlip = () => {
      mutateState();
      renderAll();

      const nextTable = document.getElementById('evaluation-table');
      if (!nextTable) return;
      const animatedEls = [];
      nextTable.querySelectorAll('[data-group-header]').forEach((hdr) => {
        const id = hdr.getAttribute('data-group-header');
        if (beforeLeft[id] === undefined) return;
        const dx = beforeLeft[id] - hdr.getBoundingClientRect().left;
        if (Math.abs(dx) < 2) return;
        const targets = [hdr, ...nextTable.querySelectorAll(`[data-col-tenderer="${id}"]`)];
        targets.forEach((el) => {
          el.style.transition = 'none';
          el.style.transform = `translateX(${dx}px)`;
          animatedEls.push(el);
        });
      });

      if (animatedEls.length > 0) {
        void nextTable.offsetWidth;
        animatedEls.forEach((el) => {
          el.style.transition = 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1)';
          el.style.transform = 'translateX(0)';
        });
        setTimeout(() => {
          animatedEls.forEach((el) => {
            el.style.transition = '';
            el.style.transform = '';
          });
        }, 280);
      }

      if (settleTendererId) {
        const settledHdr = nextTable.querySelector(`[data-group-header="${settleTendererId}"]`);
        if (settledHdr) settledHdr.classList.add('c5-col-settle');
      }

      if (openingTendererId && openingSteps.length > 0) {
        openingSteps.forEach((st) => {
          nextTable.querySelectorAll(`[data-col-tenderer="${openingTendererId}"][data-col-step="${st}"]`).forEach((el) => {
            el.classList.add('c5-col-opening');
          });
        });
      }
    };

    if (closingTendererId && closingSteps.length > 0) {
      hideTooltip();
      if (closePillBar) {
        const bar = table.querySelector(`[data-pill-bar="${closingTendererId}"]`);
        if (bar) bar.classList.add('c5-bar-closing');
      }
      closingSteps.forEach((st) => {
        table.querySelectorAll(`[data-col-tenderer="${closingTendererId}"][data-col-step="${st}"]`).forEach((el) => {
          el.classList.add('c5-col-closing');
        });
      });
      setTimeout(performFlip, 185);
    } else {
      performFlip();
    }
  }

  function bindTableEvents(table) {
    // Breakdown toggle & close buttons
    table.querySelectorAll('[data-split-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const tId = btn.getAttribute('data-split-toggle');
        const availSteps = getAvailableSteps(tId);
        if (availSteps.length <= 1) return;
        btn.disabled = true;

        if (isTendererSplit(tId)) {
          const currSteps = getDisplayedSteps(tId);
          const keepStep = availSteps[availSteps.length - 1];
          const closingSteps = currSteps.filter((s) => s !== keepStep);
          runAnimatedUpdate(
            () => { delete state.splitTenderers[tId]; },
            {
              closingTendererId: tId,
              closingSteps: closingSteps.length > 0 ? closingSteps : currSteps,
              closePillBar: true,
              settleTendererId: tId
            }
          );
        } else {
          const keepStep = availSteps[availSteps.length - 1];
          const openingSteps = availSteps.filter((s) => s !== keepStep);
          runAnimatedUpdate(
            () => { state.splitTenderers[tId] = [...availSteps]; },
            { openingTendererId: tId, openingSteps }
          );
        }
      });
    });

    // Breakdown round pills
    table.querySelectorAll('[data-step-toggle]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (btn.disabled) return;
        const tId = btn.getAttribute('data-company-id');
        const chosenStep = btn.getAttribute('data-step-toggle');
        const availSteps = getAvailableSteps(tId);
        const curr = getDisplayedSteps(tId);
        if (curr.includes(chosenStep)) {
          if (curr.length <= 1) return;
          btn.disabled = true;
          runAnimatedUpdate(
            () => { state.splitTenderers[tId] = curr.filter((s) => s !== chosenStep); },
            { closingTendererId: tId, closingSteps: [chosenStep] }
          );
        } else {
          btn.disabled = true;
          runAnimatedUpdate(
            () => { state.splitTenderers[tId] = availSteps.filter((s) => s === chosenStep || curr.includes(s)); },
            { openingTendererId: tId, openingSteps: [chosenStep] }
          );
        }
      });
    });

    // Per-row Need Rework buttons
    table.querySelectorAll('[data-rework-item]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = btn.getAttribute('data-rework-item');
        if (state.reworkMap[itemId]) {
          delete state.reworkMap[itemId];
          if (state.activeCommentItem === itemId) state.activeCommentItem = null;
          renderAll();
        } else {
          state.reworkMap[itemId] = true;
          state.activeCommentItem = itemId;
          renderAll();
          requestAnimationFrame(() => {
            const inp = document.getElementById('popover-comment-input');
            if (inp) inp.focus();
          });
        }
      });
    });

    // Per-row chat comment icon buttons (works on any row, even without Need Rework)
    table.querySelectorAll('[data-comment-btn]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const itemId = btn.getAttribute('data-comment-btn');
        const opening = state.activeCommentItem !== itemId;
        state.activeCommentItem = opening ? itemId : null;
        renderAll();
        if (opening) {
          requestAnimationFrame(() => {
            const inp = document.getElementById('popover-comment-input');
            if (inp) inp.focus();
          });
        }
      });
    });

    // Hover progression tooltips
    table.querySelectorAll('[data-tooltip-trigger="true"]').forEach((el) => {
      el.addEventListener('mouseenter', (e) => {
        showTooltip(
          e,
          el.getAttribute('data-tenderer-id'),
          el.getAttribute('data-item-id'),
          el.getAttribute('data-spec-key'),
          el.getAttribute('data-hover-step')
        );
      });
      el.addEventListener('mousemove', (e) => positionTooltip(e));
      el.addEventListener('mouseleave', () => hideTooltip());
    });
  }

  /* =========================================================================
   * 4. Anchored Row Chat Comment Popover
   * ========================================================================= */
  const popoverEl = document.getElementById('row-comment-popover');

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.activeCommentItem) {
      state.activeCommentItem = null;
      renderAll();
    }
  });

  document.addEventListener('click', (e) => {
    if (!state.activeCommentItem || !popoverEl) return;
    if (popoverEl.contains(e.target)) return;
    if (e.target.closest('[data-comment-btn], [data-rework-item]')) return;
    state.activeCommentItem = null;
    renderAll();
  });

  function positionCommentPopover() {
    if (!popoverEl || !state.activeCommentItem || popoverEl.classList.contains('hidden')) return;
    const anchor = document.querySelector(`[data-comment-btn="${state.activeCommentItem}"]`);
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const popW = popoverEl.offsetWidth || 288;
    const popH = popoverEl.offsetHeight || 200;
    const pad = 12;
    let left = rect.right + 10;
    if (left + popW > window.innerWidth - pad) {
      left = Math.max(pad, window.innerWidth - popW - pad);
    }
    let top = rect.top - 20;
    if (top + popH > window.innerHeight - pad) {
      top = window.innerHeight - popH - pad;
    }
    popoverEl.style.left = `${left}px`;
    popoverEl.style.top = `${Math.max(pad, top)}px`;
  }

  window.addEventListener('resize', positionCommentPopover);
  window.addEventListener('scroll', positionCommentPopover, true);

  function renderRowCommentPopover() {
    if (!popoverEl) return;
    const item = state.activeCommentItem ? BOQ_ITEMS.find((i) => i.id === state.activeCommentItem) : null;
    if (!item) {
      popoverEl.classList.add('hidden');
      return;
    }

    const isRework = Boolean(state.reworkMap[item.id]);
    const comments = state.comments[item.id] || [];

    const commentsHtml = comments.length > 0
      ? comments.map((c) => `
          <div class="flex items-start justify-between gap-1.5 bg-slate-50 border border-slate-200/80 rounded-xl px-2.5 py-1.5 text-xs text-slate-700 leading-snug">
            <span class="break-words min-w-0 flex-1">${escapeHtml(c.text)}</span>
            <button
              type="button"
              data-pop-delete="${c.id}"
              title="Remove comment"
              class="text-slate-400 hover:text-rose-600 text-xs leading-none px-0.5 shrink-0 cursor-pointer"
            >&times;</button>
          </div>
        `).join('')
      : `<div class="py-3 text-center text-[11px] text-slate-400">No comments yet. Write a comment below.</div>`;

    popoverEl.innerHTML = `
      <div class="c5-modal-panel">
        <div class="px-3.5 py-2.5 border-b border-slate-200 ${isRework ? 'bg-rose-50/80' : 'bg-slate-50/90'} flex items-center justify-between gap-2">
          <div class="flex items-center gap-1.5 min-w-0">
            <svg class="w-3.5 h-3.5 shrink-0 ${isRework ? 'text-rose-600' : 'text-blue-600'}" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3.5 5.5A2.5 2.5 0 0 1 6 3h8a2.5 2.5 0 0 1 2.5 2.5v6A2.5 2.5 0 0 1 14 14H8.5L5 17v-3H6a2.5 2.5 0 0 1-2.5-2.5v-6Z"/>
            </svg>
            <span class="text-xs font-bold text-slate-900 truncate">S/N ${item.sn} · ${item.capacity}</span>
            ${isRework
              ? `<span class="inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-bold bg-rose-600 text-white shrink-0">Rework</span>`
              : `<span class="inline-flex items-center px-1.5 py-0 rounded-full text-[9px] font-semibold bg-slate-200/80 text-slate-600 shrink-0">Comment</span>`}
          </div>
          <button
            type="button"
            id="btn-close-comment-popover"
            aria-label="Close comments"
            title="Close"
            class="text-slate-400 hover:text-slate-700 hover:bg-black/5 rounded-md px-1 py-0.5 text-xs font-semibold leading-none cursor-pointer transition-colors shrink-0"
          >✕</button>
        </div>

        <div class="p-3 max-h-48 overflow-y-auto table-scroll space-y-1.5">
          ${commentsHtml}
        </div>

        <div class="px-3 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center gap-1.5">
          <input
            id="popover-comment-input"
            type="text"
            placeholder="Write a comment..."
            class="flex-1 min-w-0 px-2.5 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-200"
          />
          <button
            type="button"
            id="btn-popover-send"
            class="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors shrink-0 cursor-pointer"
          >Send</button>
        </div>
      </div>
    `;

    popoverEl.classList.remove('hidden');
    positionCommentPopover();

    document.getElementById('btn-close-comment-popover').addEventListener('click', (e) => {
      e.stopPropagation();
      state.activeCommentItem = null;
      renderAll();
    });

    const submitComment = () => {
      const inp = document.getElementById('popover-comment-input');
      if (!inp) return;
      const text = inp.value.trim();
      if (!text) return;
      if (!state.comments[item.id]) state.comments[item.id] = [];
      state.comments[item.id].push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        text
      });
      saveComments();
      renderAll();
      requestAnimationFrame(() => {
        const nextInp = document.getElementById('popover-comment-input');
        if (nextInp) nextInp.focus();
      });
    };

    document.getElementById('btn-popover-send').addEventListener('click', (e) => {
      e.stopPropagation();
      submitComment();
    });

    document.getElementById('popover-comment-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        submitComment();
      }
    });

    popoverEl.querySelectorAll('[data-pop-delete]').forEach((delBtn) => {
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const cId = delBtn.getAttribute('data-pop-delete');
        if (state.comments[item.id]) {
          state.comments[item.id] = state.comments[item.id].filter((c) => c.id !== cId);
          saveComments();
          renderAll();
          requestAnimationFrame(() => {
            const nextInp = document.getElementById('popover-comment-input');
            if (nextInp) nextInp.focus();
          });
        }
      });
    });
  }

  /* =========================================================================
   * 5. Hover Progression Tooltip
   * ========================================================================= */
  const tooltipEl = document.getElementById('heatmap-tooltip');

  function showTooltip(event, tendererId, itemId, specKey, highlightStep) {
    const tenderer = TENDERERS.find((t) => t.id === tendererId);
    const item = BOQ_ITEMS.find((i) => i.id === itemId);
    if (!tenderer || !item) return;

    const crossRef = getCrossRef(item.id, specKey, getVisibleTenderers());
    const origVal = getRate(tenderer, item.id, 'Orig', specKey);
    const thr = Math.max(1, Number(state.threshold) || 10);

    const rowsHtml = getAvailableSteps(tenderer.id).map((s) => {
      const isOrig = s === 'Orig';
      const val = getRate(tenderer, item.id, s, specKey);
      const pctOrig = getDeltaPercent(tenderer, item.id, s, specKey);
      const basisDiff = val - crossRef.val;
      const basisPct = crossRef.val > 0 ? (basisDiff / crossRef.val) * 100 : 0;
      const isHi = s === highlightStep;
      const spec = getCellSpec(val, origVal, crossRef.val, isOrig);
      const arrowStr = isOrig || spec.arrowDir === 'na'
        ? '—'
        : `${spec.arrowChar} ${pctOrig > 0 ? '+' : ''}${pctOrig.toFixed(1)}%`;
      const basisColor = spec.zone === 'grey' ? '#475569' : spec.valueColor;

      return `
        <div class="grid grid-cols-[1fr_auto_auto_auto] items-center gap-2 py-1 px-2 rounded-lg text-xs ${isHi ? 'bg-slate-100 font-semibold' : ''}">
          <div class="flex items-center gap-1.5">
            <span class="w-2.5 h-2.5 rounded-[3px] border border-black/15 shrink-0" style="background-color: ${spec.cellBg};"></span>
            <span class="text-slate-700">${s}</span>
            ${spec.showAlert ? '<span class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-amber-100 border border-amber-400 text-amber-700 text-[9px] font-bold leading-none" title="Unexpected price increase">⚠</span>' : ''}
          </div>
          <span class="tabular-nums text-slate-900 font-medium text-right">S$${formatRate(val)}</span>
          <span class="tabular-nums w-14 text-right font-semibold text-[11px]" style="color: ${spec.arrowColor};">
            ${arrowStr}
          </span>
          <span class="tabular-nums w-24 text-right font-semibold text-[10.5px] whitespace-nowrap" style="color: ${basisColor};">
            ${formatBasisDiff(basisDiff)} (${formatBasisPct(basisPct)})
          </span>
        </div>
      `;
    }).join('');

    tooltipEl.innerHTML = `
      <div class="flex items-center justify-between pb-2 mb-1.5 border-b border-slate-100">
        <div class="min-w-0 pr-2">
          <div class="text-xs font-bold text-slate-900 truncate">${tenderer.name}</div>
          <div class="text-[11px] text-slate-500">S/N ${item.sn} · <strong>${item.capacity}</strong> · ${specKey}</div>
        </div>
        <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0">S$/Day</span>
      </div>
      <div class="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        <span>Step</span>
        <span class="text-right">Rate</span>
        <span class="w-14 text-right">vs Orig</span>
        <span class="w-24 text-right">vs ${crossRef.label}</span>
      </div>
      <div class="space-y-0.5">${rowsHtml}</div>
      <div class="mt-2 pt-1.5 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-500 tabular-nums">
        <span>${crossRef.label}: <strong class="text-slate-700">S$${crossRef.val.toFixed(1)}</strong></span>
        <span>±${thr}%: <strong class="text-slate-700">${(crossRef.val * (1 - thr / 100)).toFixed(1)}–${(crossRef.val * (1 + thr / 100)).toFixed(1)}</strong></span>
      </div>
    `;

    positionTooltip(event);
    tooltipEl.classList.remove('opacity-0');
    tooltipEl.classList.add('opacity-100');
  }

  function positionTooltip(event) {
    const pad = 14;
    const rect = tooltipEl.getBoundingClientRect();
    let left = event.clientX + pad;
    let top = event.clientY + pad;
    if (left + rect.width > window.innerWidth - 10) {
      left = event.clientX - rect.width - pad;
    }
    if (top + rect.height > window.innerHeight - 10) {
      top = event.clientY - rect.height - pad;
    }
    tooltipEl.style.left = `${Math.max(10, left)}px`;
    tooltipEl.style.top = `${Math.max(10, top)}px`;
  }

  function hideTooltip() {
    tooltipEl.classList.remove('opacity-100');
    tooltipEl.classList.add('opacity-0');
  }

  /* =========================================================================
   * 6. Master Render
   * ========================================================================= */
  function renderAll() {
    hideTooltip();
    renderControls();
    renderTable();
    renderRowCommentPopover();
  }

  renderAll();
})();
