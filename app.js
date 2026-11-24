(function () {
  'use strict';

  const state = { records: [], months: [], area: '전체', region: '전국' };
  const numberFormat = new Intl.NumberFormat('ko-KR');
  const $ = (id) => document.getElementById(id);
  let listenersAttached = false;

  function parseCSV(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = !quoted;
        }
      } else if (char === ',' && !quoted) {
        row.push(cell.trim());
        cell = '';
      } else if ((char === '\n' || char === '\r') && !quoted) {
        if (char === '\r' && text[i + 1] === '\n') i += 1;
        row.push(cell.trim());
        if (row.some((value) => value !== '')) rows.push(row);
        row = [];
        cell = '';
      } else {
        cell += char;
      }
    }
    row.push(cell.trim());
    if (row.some((value) => value !== '')) rows.push(row);
    return rows;
  }

  function parseValue(value) {
    if (!value || value === '-' || value === '..') return null;
    const parsed = Number(value.replace(/,/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function parseData(text) {
    const rows = parseCSV(text.replace(/^\uFEFF/, ''));
    if (rows.length < 3 || rows[0].length < 8) {
      throw new Error('CSV 형식이 올바르지 않습니다. 제공된 월세 통계 CSV를 선택해 주세요.');
    }
    const periodHeaders = rows[0];
    const metricHeaders = rows[1];
    const monthColumns = [];
    for (let col = 4; col < periodHeaders.length; col += 4) {
      const period = periodHeaders[col];
      if (!period) continue;
      monthColumns.push({
        label: period,
        metrics: metricHeaders.slice(col, col + 4)
      });
    }
    if (!monthColumns.length) {
      throw new Error('월별 가격 열을 찾을 수 없습니다. CSV의 첫 두 행을 확인해 주세요.');
    }

    let region1 = '';
    let region2 = '';
    let region3 = '';
    const records = [];
    rows.slice(2).forEach((cells) => {
      if (cells.length < 4) return;
      if (cells[0]) region1 = cells[0];
      if (cells[1]) region2 = cells[1];
      if (cells[2]) region3 = cells[2];
      const area = (cells[3] || '').trim();
      if (!area) return;
      const values = {};
      monthColumns.forEach((month, index) => {
        const offset = 4 + index * 4;
        values[month.label] = {
          avgDeposit: parseValue(cells[offset]),
          avgRent: parseValue(cells[offset + 1]),
          medianDeposit: parseValue(cells[offset + 2]),
          medianRent: parseValue(cells[offset + 3])
        };
      });
      records.push({ region1, region2, region3, area, values });
    });
    if (!records.length) throw new Error('분석할 수 있는 월세 데이터가 없습니다.');
    return { records, months: monthColumns.map((month) => month.label) };
  }

  function regionName(record) {
    if (record.region1 === '전국' || record.region2 === '소계') return record.region1;
    return record.region2;
  }

  function isSummary(record) {
    return record.area === '전체' && record.region3 === '소계';
  }

  function findRecord(region, area) {
    const matches = state.records.filter((record) => record.area === area);
    if (region === '전국' || region === '수도권' || region === '지방') {
      return matches.find((record) => record.region1 === region && record.region2 === '소계' && record.region3 === '소계');
    }
    return matches.find((record) => record.region2 === region && record.region3 === '소계');
  }

  function percentChange(current, previous) {
    if (current == null || previous == null || previous === 0) return null;
    return ((current - previous) / previous) * 100;
  }

  function changeLabel(change) {
    if (change == null) return '비교 데이터 없음';
    const sign = change > 0 ? '+' : '';
    return `${sign}${change.toFixed(1)}%`;
  }

  function renderTrend(monthlyValues, months) {
    const width = 760;
    const height = 158;
    const pad = { top: 13, right: 24, bottom: 25, left: 34 };
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    const values = monthlyValues.flatMap((item) => [item.avgRent, item.medianRent]).filter(Number.isFinite);
    const minValue = Math.floor((Math.min(...values) * 0.96) / 10) * 10;
    const maxValue = Math.ceil((Math.max(...values) * 1.04) / 10) * 10;
    const spread = Math.max(1, maxValue - minValue);
    const x = (index) => pad.left + (months.length < 2 ? chartWidth / 2 : (index / (months.length - 1)) * chartWidth);
    const y = (value) => pad.top + chartHeight - ((value - minValue) / spread) * chartHeight;
    const grid = [0, 0.5, 1].map((fraction) => {
      const gridY = pad.top + chartHeight * fraction;
      const label = numberFormat.format(Math.round(maxValue - spread * fraction));
      return `<line x1="${pad.left}" y1="${gridY}" x2="${width - pad.right}" y2="${gridY}" stroke="#eff0f4" stroke-dasharray="3 4"/><text x="${pad.left - 8}" y="${gridY + 3}" fill="#a2a6b2" font-size="9" text-anchor="end">${label}</text>`;
    }).join('');
    const series = [
      { key: 'avgRent', color: '#8171f2', fill: 'url(#avgFill)' },
      { key: 'medianRent', color: '#3bc7a2', fill: 'none' }
    ];
    const lines = series.map((item) => {
      const points = monthlyValues.map((value, index) => `${x(index)},${y(value[item.key])}`);
      const path = points.map((point, index) => `${index ? 'L' : 'M'} ${point}`).join(' ');
      const dots = monthlyValues.map((value, index) => `<circle cx="${x(index)}" cy="${y(value[item.key])}" r="3.5" fill="#fff" stroke="${item.color}" stroke-width="2"><title>${months[index]}: ${numberFormat.format(value[item.key])}천원</title></circle>`).join('');
      const area = item.key === 'avgRent'
        ? `<path d="${path} L ${x(months.length - 1)},${height - pad.bottom} L ${x(0)},${height - pad.bottom} Z" fill="${item.fill}"/>`
        : '';
      return `${area}<path d="${path}" fill="none" stroke="${item.color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
    }).join('');
    const monthLabels = months.map((month, index) => `<text x="${x(index)}" y="${height - 5}" fill="#969baa" font-size="9" text-anchor="middle">${month.slice(5)}월</text>`).join('');
    $('trend-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="avgFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="#8171f2" stop-opacity=".16"/><stop offset="100%" stop-color="#8171f2" stop-opacity="0"/></linearGradient></defs>${grid}${lines}${monthLabels}</svg>`;
  }

  function renderRegionChart(month) {
    const regions = state.records.filter((record) =>
      record.area === state.area && record.region2 !== '소계' && record.region3 === '소계' && record.region1 !== '전국'
    );
    const current = regions.map((record) => ({ name: record.region2, value: record.values[month]?.avgRent }))
      .filter((record) => Number.isFinite(record.value))
      .sort((a, b) => b.value - a.value);
    const visible = current.slice(0, 9);
    const max = Math.max(...visible.map((record) => record.value), 1);
    $('region-chart').innerHTML = visible.map((record) => {
      const selected = state.region === record.name ? ' selected' : '';
      return `<div class="region-row${selected}"><span class="region-name">${record.name}</span><div class="region-track"><div class="region-fill" style="width:${Math.max(3, record.value / max * 100)}%"></div></div><span class="region-value">${numberFormat.format(record.value)}</span></div>`;
    }).join('') || '<div class="empty-state">지역별 비교 데이터가 없습니다.</div>';
  }

  function renderAreaChart(month) {
    const selected = state.records.filter((record) => regionName(record) === state.region && record.region3 === '소계' && record.area !== '전체');
    const rows = selected.map((record) => ({ name: record.area, value: record.values[month]?.avgRent }))
      .filter((record) => Number.isFinite(record.value));
    const max = Math.max(...rows.map((record) => record.value), 1);
    $('area-chart').innerHTML = rows.map((record) => `<div class="area-row"><div class="area-row-head"><span>${record.name}</span><strong>${numberFormat.format(record.value)} 천원</strong></div><div class="area-track"><div class="area-fill" style="width:${Math.max(3, record.value / max * 100)}%"></div></div></div>`).join('')
      || '<div class="empty-state">선택한 지역의 면적별 데이터가 없습니다.</div>';
  }

  function renderTable(monthIndex) {
    const currentMonth = state.months[monthIndex];
    const previousMonth = state.months[monthIndex - 1];
    const regions = state.records.filter((record) =>
      record.area === state.area && record.region2 !== '소계' && record.region3 === '소계' && record.region1 !== '전국'
    );
    const rows = regions.map((record) => {
      const current = record.values[currentMonth];
      const previous = previousMonth ? record.values[previousMonth] : null;
      return {
        name: record.region2,
        avgRent: current?.avgRent,
        medianRent: current?.medianRent,
        avgDeposit: current?.avgDeposit,
        medianDeposit: current?.medianDeposit,
        change: percentChange(current?.avgRent, previous?.avgRent)
      };
    }).filter((record) => Number.isFinite(record.avgRent)).sort((a, b) => b.avgRent - a.avgRent);
    $('region-table-body').innerHTML = rows.map((record) => {
      const negative = record.change != null && record.change < 0 ? ' negative' : '';
      return `<tr><td>${record.name}</td><td>${numberFormat.format(record.avgRent)} 천원</td><td><span class="table-change${negative}">${changeLabel(record.change)}</span></td><td>${numberFormat.format(record.medianRent)} 천원</td><td>${numberFormat.format(record.avgDeposit)} 만원</td><td>${numberFormat.format(record.medianDeposit)} 만원</td></tr>`;
    }).join('');
    $('record-count').textContent = `${rows.length}개 지역`;
    $('table-period').textContent = currentMonth;
    $('table-description').textContent = `${currentMonth} 기준 지역별 평균 및 중위 가격을 확인하세요.`;
  }

  function render() {
    const monthIndex = state.months.indexOf($('month-filter').value);
    const month = state.months[monthIndex];
    const previousMonth = monthIndex > 0 ? state.months[monthIndex - 1] : null;
    const record = findRecord(state.region, state.area);
    const data = record?.values[month];
    const previous = previousMonth ? record?.values[previousMonth] : null;
    if (!data || !Number.isFinite(data.avgRent)) {
      $('error-banner').hidden = false;
      $('error-banner').textContent = '선택한 조건에 해당하는 가격 데이터가 없습니다. 다른 지역이나 면적을 선택해 주세요.';
      return;
    }
    $('error-banner').hidden = true;
    const change = percentChange(data.avgRent, previous?.avgRent);
    $('heading-period').textContent = `${month} 기준`;
    $('kpi-rent').textContent = numberFormat.format(data.avgRent);
    $('kpi-median-rent').textContent = numberFormat.format(data.medianRent);
    $('kpi-deposit').textContent = numberFormat.format(data.avgDeposit);
    $('kpi-median-deposit').textContent = numberFormat.format(data.medianDeposit);
    $('trend-current').textContent = numberFormat.format(data.avgRent);
    $('trend-period-label').textContent = `${state.months[0]} — ${state.months[state.months.length - 1]}`;
    $('data-coverage').textContent = `${state.months[0]} — ${state.months[state.months.length - 1]}`;
    $('rent-change').textContent = changeLabel(change);
    $('rent-change').classList.toggle('negative', change != null && change < 0);
    $('insight-change').textContent = changeLabel(change);
    $('insight-copy').textContent = change == null
      ? '이전 월과 비교할 데이터가 없어 현재 가격을 표시합니다.'
      : change > 0 ? `선택한 조건의 평균 월세가 ${Math.abs(change).toFixed(1)}% 올랐습니다.` : change < 0 ? `선택한 조건의 평균 월세가 ${Math.abs(change).toFixed(1)}% 내렸습니다.` : '선택한 조건의 평균 월세가 전월과 같습니다.';
    const ratio = data.avgDeposit > 0 ? data.avgRent * 10 / data.avgDeposit * 100 : null;
    $('rent-ratio').textContent = ratio == null ? '—' : `${ratio.toFixed(2)}%`;
    $('insight-note').textContent = state.area === '전체'
      ? `${state.region} 전체 주거 유형의 평균 가격을 기준으로 계산했습니다.`
      : `${state.region} ${state.area} 기준으로 계산했습니다.`;
    const changeClass = change != null && change < 0 ? 'negative' : '';
    $('rent-change').classList.toggle('negative', Boolean(changeClass));

    const trend = state.months.map((label) => record.values[label]);
    renderTrend(trend, state.months);
    renderRegionChart(month);
    renderAreaChart(month);
    renderTable(monthIndex);
  }

  function initialize(data) {
    state.records = data.records;
    state.months = data.months;
    state.region = '전국';
    state.area = '전체';
    const regions = ['전국', '수도권', '지방'];
    state.records.forEach((record) => {
      if (record.region2 !== '소계' && record.region3 === '소계' && !regions.includes(record.region2)) {
        regions.push(record.region2);
      }
    });
    const areaLabels = [];
    state.records.forEach((record) => {
      if (record.region1 === '전국' && record.area && !areaLabels.includes(record.area)) areaLabels.push(record.area);
    });
    $('region-filter').innerHTML = regions.map((region) => `<option value="${region}">${region}</option>`).join('');
    $('area-filter').innerHTML = areaLabels.map((area) => `<option value="${area}">${area}</option>`).join('');
    $('month-filter').innerHTML = state.months.map((month) => `<option value="${month}">${month}</option>`).join('');
    $('month-filter').value = state.months[state.months.length - 1];
    if (!listenersAttached) {
      $('region-filter').addEventListener('change', (event) => {
        state.region = event.target.value;
        render();
      });
      $('area-filter').addEventListener('change', (event) => {
        state.area = event.target.value;
        render();
      });
      $('month-filter').addEventListener('change', render);
      $('reset-filters').addEventListener('click', () => {
        state.region = '전국';
        state.area = '전체';
        $('region-filter').value = state.region;
        $('area-filter').value = state.area;
        $('month-filter').value = state.months[state.months.length - 1];
        render();
      });
      $('upload-trigger').addEventListener('click', () => $('csv-upload').click());
      $('csv-upload').addEventListener('change', (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            initialize(parseData(String(reader.result || '')));
          } catch (error) {
            showError(error);
          }
        };
        reader.onerror = () => showError(new Error('CSV 파일을 읽지 못했습니다. 다시 선택해 주세요.'));
        reader.readAsText(file, 'EUC-KR');
      });
      $('export-button').addEventListener('click', exportCSV);
      listenersAttached = true;
    }
    $('csv-upload').value = '';
    $('region-filter').value = state.region;
    $('area-filter').value = state.area;
    render();
  }

  function exportCSV() {
    const monthIndex = state.months.indexOf($('month-filter').value);
    const currentMonth = state.months[monthIndex];
    const previousMonth = state.months[monthIndex - 1];
    const headers = ['지역', '주거 면적', '기준 월', '평균 월세(천원)', '전월 대비(%)', '중위 월세(천원)', '평균 보증금(만원)', '중위 보증금(만원)'];
    const lines = [headers.join(',')];
    state.records.filter((record) => record.area === state.area && record.region3 === '소계').forEach((record) => {
      const value = record.values[currentMonth];
      if (!value || value.avgRent == null) return;
      const previous = previousMonth ? record.values[previousMonth] : null;
      const place = regionName(record);
      if (state.region !== '전국' && state.region !== place && state.region !== record.region1) return;
      const change = percentChange(value.avgRent, previous?.avgRent);
      lines.push([place, state.area, currentMonth, value.avgRent, change == null ? '' : change.toFixed(2), value.medianRent, value.avgDeposit, value.medianDeposit]
        .map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','));
    });
    const blob = new Blob(['\uFEFF', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `월세가격_${currentMonth}_${state.region}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function showError(error) {
    const banner = $('error-banner');
    banner.hidden = false;
    banner.textContent = error instanceof Error ? error.message : '데이터 처리 중 오류가 발생했습니다.';
  }

  try {
    if (!window.RENT_CSV_DATA) throw new Error('내장 데이터 파일(rent-data.js)을 찾을 수 없습니다.');
    const csvText = typeof window.RENT_CSV_DATA === 'string' ? window.RENT_CSV_DATA : window.RENT_CSV_DATA.value;
    if (typeof csvText !== 'string') throw new Error('내장 월세 데이터를 읽을 수 없습니다.');
    initialize(parseData(csvText));
  } catch (error) {
    showError(error);
  }
}());
