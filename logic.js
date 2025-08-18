/* logic.fixed.js — consolidated, defensive, single-version */
(() => {
  const $ = (id) => document.getElementById(id);
  const qs = (s, r=document) => r.querySelector(s);
  const qsa = (s, r=document) => Array.from(r.querySelectorAll(s));
  const fmt = (n)=> (Number(n||0)).toLocaleString('vi-VN');
  const num = (s)=> parseInt(String(s||'').replace(/[^\d]/g,''),10)||0;
  const safe = (s)=> String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');
  const showErr = (msg) => { try { const e = $('error-message'); if (e) e.textContent = msg; } catch {} console.error(msg); };

  window.appState = window.appState || { mainProduct:{key:'', stbh:0, paymentTerm:0, extraPremium:0}, fees:{baseMain:0, total:0, totalSupp:0, byPerson:{}} };

  // Fallbacks for functions if not present in current codebase
  const collectPersonData = (window.collectPersonData) || ((container, isMain=false) => {
    const name = qs('.name-input', container)?.value?.trim() || (isMain?'NĐBH Chính':'NĐBH');
    const age = parseInt(qs('.age-span', container)?.textContent||'0',10)||0;
    const gender = qs('.gender-select', container)?.value || 'Nam';
    const id = container?.dataset?.pid || (isMain ? 'main' : (`supp_${name}_${age}`));
    return { id, isMain, name, gender, age, supplements:{} };
  });
  const calculateMainPremium          = window.calculateMainPremium          || (()=> Number(window?.appState?.fees?.baseMain || 0));
  const calculateHealthSclPremium     = window.calculateHealthSclPremium     || (()=> 0);
  const calculateBhnPremium           = window.calculateBhnPremium           || (()=> 0);
  const calculateAccidentPremium      = window.calculateAccidentPremium      || (()=> 0);
  const calculateHospitalSupportPremium = window.calculateHospitalSupportPremium || (()=> 0);
  const getHealthSclStbhByProgram     = window.getHealthSclStbhByProgram     || (()=> 0);

  window.MDP3 = window.MDP3 || (()=>{
    const isEnabled = () => !!$('mdp3-enable')?.checked;
    const getSelectedId = () => qs('#mdp3-section input[type="radio"]:checked')?.value || qs('#mdp3-section select')?.value || null;
    const getPremium = () => num($('mdp3-fee-display')?.textContent||'0');
    return { isEnabled, getSelectedId, getPremium };
  })();

  function validatePaymentTermOrDie() {
    const prodKey = ($('main-product')?.value || window.appState.mainProduct?.key || '').trim();
    let term = window.appState.mainProduct?.paymentTerm || 0;
    const termInput = document.querySelector('#main-product-options [name="paymentTerm"], #abuv-term');
    if (termInput) {
      const v = parseInt(termInput.value || termInput.getAttribute('value') || '0', 10);
      if (!isNaN(v) && v>0) term = v;
    }
    const minByKey = (k)=> k==='TRON_TAM_AN'?10 : k==='AN_BINH_UU_VIET'?5 : k==='PUL_5_NAM'?5 : k==='PUL_15_NAM'?15 : 4;
    const minTerm  = minByKey(prodKey);
    if (!term || term < minTerm) throw new Error(`Thời hạn đóng phí không hợp lệ (tối thiểu ${minTerm} năm).`);
    if (prodKey==='AN_BINH_UU_VIET' && ![5,10,15].includes(term)) throw new Error('ABƯV chỉ 5 / 10 / 15 năm.');
    return { prodKey, term };
  }

  function renderSuppList(){
    const box = $('supp-insured-summaries');
    if (!box) return;
    const persons = [];
    const mainInfo = collectPersonData($('main-person-container'), true);
    if (mainInfo) persons.push(mainInfo);
    qsa('#supplementary-insured-container .person-container').forEach(c => {
      const p = collectPersonData(c,false); if (p) persons.push(p);
    });
    const byPerson = window?.appState?.fees?.byPerson || {};
    const mdpOn = window.MDP3 && MDP3.isEnabled && MDP3.isEnabled();
    const mdpId = mdpOn ? (MDP3.getSelectedId && MDP3.getSelectedId()) : null;
    const mdpFee = mdpOn ? (MDP3.getPremium && MDP3.getPremium()) : 0;

    const rows = persons.map(p=>{
      const details = byPerson[p.id]?.suppDetails || {};
      let sum = 0;
      for (const k in details){
        const v = details[k];
        sum += (typeof v === 'number') ? v : (v && typeof v.annual === 'number' ? v.annual : 0);
      }
      if (mdpOn && mdpId === p.id) sum += (mdpFee||0);
      return `<div class="flex justify-between"><span>${safe(p.name||'Người')}</span><span>${fmt(sum)}</span></div>`;
    });
    if (mdpOn && mdpId === 'other' && (mdpFee||0)>0){
      rows.push(`<div class="flex justify-between"><span>Miễn đóng phí 3.0 (Người khác)</span><span>${fmt(mdpFee)}</span></div>`);
    }
    box.innerHTML = rows.join('');
  }
  window.renderSuppList = renderSuppList;

  function generateSummaryTable(){
    const container = $('summary-content-container');
    const modal = $('summary-modal');
    if (!container) return;
    container.innerHTML = '';

    const getPeriods = () => {
      const v = $('payment-frequency')?.value || 'year';
      return v==='half' ? 2 : (v==='quarter'?4:1);
    };
    const periods = getPeriods();
    const isAnnual = periods===1;
    const riderFactor = periods===2 ? 1.02 : (periods===4 ? 1.04 : 1);
    const riderMaxAge = (key)=>({ health_scl:74, bhn:85, accident:64, hospital_support:64, mdp3:64 }[key] ?? 64);

    try{
      const mainInfo = collectPersonData($('main-person-container'), true);
      const targetAge = parseInt($('target-age-input')?.value||'0',10)||0;
      const { prodKey, term: paymentTermInput } = validatePaymentTermOrDie();
      let paymentTerm = paymentTermInput;
      if (prodKey==='TRON_TAM_AN') paymentTerm = 10;

      const minTargetAge = mainInfo.age + paymentTerm - 1;
      if (!targetAge || targetAge < minTargetAge) throw new Error(`Tuổi mục tiêu phải ≥ ${minTargetAge}.`);

      const others = qsa('#supplementary-insured-container .person-container').map(c=>collectPersonData(c,false));
      const persons = [mainInfo, ...others];

      const mdpOn = window.MDP3 && MDP3.isEnabled && MDP3.isEnabled();
      const mdpId = mdpOn ? (MDP3.getSelectedId && MDP3.getSelectedId()) : null;
      const mdpFeeYear = mdpOn ? (MDP3.getPremium && MDP3.getPremium()) : 0;
      if (mdpOn && mdpId === 'other'){
        persons.push({ id:'mdp3_other', isMain:false, name:'Người khác (MĐP3)', gender:'Nam', age: mainInfo.age, supplements:{} });
      }

      let html = '';
      html += `<h3 class="text-lg font-bold mb-2">Phần 1 · Tóm tắt sản phẩm</h3>`;
      html += `<table class="w-full border-collapse text-sm"><thead><tr>
        <th class="p-2 border">Tên NĐBH</th><th class="p-2 border">Sản phẩm</th><th class="p-2 border">STBH</th><th class="p-2 border">Số năm đóng phí</th>`;
      if (!isAnnual) html += `<th class="p-2 border">Phí đóng (${periods===2?'nửa năm':'theo quý'})</th><th class="p-2 border">Phí đóng (quy năm)</th>`;
      html += `<th class="p-2 border">Phí đóng theo năm</th>`;
      if (!isAnnual) html += `<th class="p-2 border">Chênh lệch</th>`;
      html += `</tr></thead><tbody>`;

      const pushRow = (acc, personName, prodName, stbhDisplay, years, baseAnnual, isRider)=>{
        const perPeriod = isAnnual ? 0 : Math.round((isRider ? (baseAnnual*riderFactor) : baseAnnual)/periods/1000)*1000;
        const annualEq = isAnnual ? 0 : perPeriod*periods;
        const diff = isAnnual ? 0 : (annualEq - baseAnnual);
        acc.per += perPeriod; acc.eq += annualEq; acc.base += baseAnnual; acc.diff += diff;
        let row = `<tr><td class="p-2 border">${safe(personName)}</td><td class="p-2 border">${safe(prodName)}</td>
          <td class="p-2 border text-right">${stbhDisplay||'—'}</td><td class="p-2 border text-center">${years||'—'}</td>`;
        if (!isAnnual) row += `<td class="p-2 border text-right">${fmt(perPeriod)}</td><td class="p-2 border text-right">${fmt(annualEq)}</td>`;
        row += `<td class="p-2 border text-right">${fmt(baseAnnual)}</td>`;
        if (!isAnnual) row += `<td class="p-2 border text-right">${diff? `<span class="text-red-600 font-bold">${fmt(diff)}</span>` : '0'}</td>`;
        row += `</tr>`;
        return row;
      };

      for (const p of persons){
        const acc = {per:0,eq:0,base:0,diff:0};
        let rows = [];
        if (p.isMain && window.appState.mainProduct.key){
          const baseAnnual = calculateMainPremium(p, window.appState.mainProduct);
          const stbh = fmt(window.appState.mainProduct.stbh||0);
          rows.push( pushRow(acc, p.name, 'Sản phẩm chính', stbh, paymentTerm, baseAnnual, false) );
        }
        if (p.isMain && (window.appState.mainProduct.extraPremium||0)>0){
          rows.push( pushRow(acc, p.name, 'Phí đóng thêm', '—', paymentTerm, window.appState.mainProduct.extraPremium||0, false) );
        }
        if (p.supplements && p.supplements.health_scl){
          const scl = p.supplements.health_scl;
          const programName = ({co_ban:'Cơ bản',nang_cao:'Nâng cao',toan_dien:'Toàn diện',hoan_hao:'Hoàn hảo'})[scl.program] || '';
          const scopeStr = (scl.scope==='main_global'?'Nước ngoài':'Trong nước') + (scl.outpatient?', Ngoại trú':'') + (scl.dental?', Nha khoa':'');
          const baseAnnual = calculateHealthSclPremium(p, window.appState.fees.baseMain, 0);
          const stbh = (typeof getHealthSclStbhByProgram==='function'? getHealthSclStbhByProgram(scl.program) : 0);
          const years = Math.max(0, Math.min(targetAge, 74) - p.age + 1);
          rows.push( pushRow(acc, p.name, `Sức khoẻ Bùng Gia Lực – ${programName} (${scopeStr})`, fmt(stbh), years, baseAnnual, true) );
        }
        if (p.supplements && p.supplements.bhn){
          const stbh = num(p.supplements.bhn.stbh);
          const baseAnnual = calculateBhnPremium(p, window.appState.fees.baseMain, 0);
          const years = Math.max(0, Math.min(targetAge, 85) - p.age + 1);
          rows.push( pushRow(acc, p.name, 'Bệnh Hiểm Nghèo 2.0', fmt(stbh), years, baseAnnual, true) );
        }
        if (p.supplements && p.supplements.accident){
          const stbh = num(p.supplements.accident.stbh);
          const baseAnnual = calculateAccidentPremium(p, window.appState.fees.baseMain, 0);
          const years = Math.max(0, Math.min(targetAge, 64) - p.age + 1);
          rows.push( pushRow(acc, p.name, 'Bảo hiểm Tai nạn', fmt(stbh), years, baseAnnual, true) );
        }
        if (p.supplements && p.supplements.hospital_support){
          const stbh = num(p.supplements.hospital_support.stbh);
          const baseAnnual = calculateHospitalSupportPremium(p, window.appState.fees.baseMain, 0);
          const years = Math.max(0, Math.min(targetAge, 64) - p.age + 1);
          rows.push( pushRow(acc, p.name, 'Hỗ trợ chi phí nằm viện', fmt(stbh), years, baseAnnual, true) );
        }
        if (mdpOn && mdpFeeYear>0){
          if (mdpId === p.id || (mdpId==='other' && p.id==='mdp3_other')){
            const years = Math.max(0, Math.min(targetAge, 64) - p.age + 1);
            rows.push( pushRow(acc, p.name, 'Miễn đóng phí 3.0', '—', years, mdpFeeYear, true) );
          }
        }
        let totalRow = `<tr class="bg-gray-50 font-semibold">
          <td class="p-2 border">${safe(p.name|| (p.isMain?'NĐBH Chính':'NĐBH Bổ sung'))}</td>
          <td class="p-2 border">Tổng</td><td class="p-2 border">—</td><td class="p-2 border">—</td>`;
        if (!isAnnual) totalRow += `<td class="p-2 border text-right">${fmt(acc.per)}</td><td class="p-2 border text-right">${fmt(acc.eq)}</td>`;
        totalRow += `<td class="p-2 border text-right">${fmt(acc.base)}</td>`;
        if (!isAnnual) totalRow += `<td class="p-2 border text-right">${acc.diff?`<span class="text-red-600 font-bold">${fmt(acc.diff)}</span>`:'0'}</td>`;
        totalRow += `</tr>`;
        html += totalRow + rows.join('');
      }
      html += `</tbody></table>`;

      // PART 2
      html += `<h3 class="text-lg font-bold mt-6 mb-2">Phần 2 · Bảng phí</h3>`;
      const rowsData = [];
      for (let year=1; mainInfo.age + year -1 <= targetAge; year++){
        const ageNow = mainInfo.age + year -1;
        const inPayTerm = (year <= paymentTerm);
        const baseAnnualMain = inPayTerm ? (window.appState.fees?.baseMain||0) : 0;
        const extra = inPayTerm ? (window.appState.mainProduct?.extraPremium||0) : 0;
        const perPersonSuppPeriod = [], perPersonSuppYear = [];

        for (const p of persons){
          let y = ageNow + (p.isMain ? 0 : (p.age - mainInfo.age));
          let sPeriod=0, sYear=0;
          if (p.supplements && p.supplements.health_scl){
            const base = calculateHealthSclPremium(p, baseAnnualMain, 0, y); sYear += base; sPeriod += isAnnual ? 0 : Math.round(base*riderFactor/periods/1000)*1000;
          }
          if (p.supplements && p.supplements.bhn){
            const base = calculateBhnPremium(p, baseAnnualMain, 0, y); sYear += base; sPeriod += isAnnual ? 0 : Math.round(base*riderFactor/periods/1000)*1000;
          }
          if (p.supplements && p.supplements.accident){
            const base = calculateAccidentPremium(p, baseAnnualMain, 0, y); sYear += base; sPeriod += isAnnual ? 0 : Math.round(base*riderFactor/periods/1000)*1000;
          }
          if (p.supplements && p.supplements.hospital_support){
            const base = calculateHospitalSupportPremium(p, baseAnnualMain, 0, y); sYear += base; sPeriod += isAnnual ? 0 : Math.round(base*riderFactor/periods/1000)*1000;
          }
          if (mdpOn && mdpId && (mdpId===p.id || (mdpId==='other' && p.id==='mdp3_other'))){
            const fee = (y <= 64) ? mdpFeeYear : 0; sYear += fee; sPeriod += isAnnual ? 0 : Math.round(fee*riderFactor/periods/1000)*1000;
          }
          perPersonSuppPeriod.push(isAnnual?0:sPeriod);
          perPersonSuppYear.push(sYear);
        }
        const totalSuppPeriod = perPersonSuppPeriod.reduce((a,b)=>a+b,0);
        const totalSuppYear = perPersonSuppYear.reduce((a,b)=>a+b,0);
        const totalPeriod = isAnnual ? 0 : (Math.round(baseAnnualMain/periods/1000)*1000 + Math.round(extra/periods/1000)*1000 + totalSuppPeriod);
        const totalYear = baseAnnualMain + extra + totalSuppYear;
        const diff = isAnnual ? 0 : ((totalPeriod*periods) - totalYear);
        rowsData.push({year, ageNow, baseAnnualMain, extra, perPersonSuppYear, totalPeriod, totalYear, diff});
      }

      const extraAllZero = rowsData.every(r=> r.extra === 0);
      html += `<table class="w-full border-collapse text-sm"><thead><tr>
        <th class="p-2 border">Năm HĐ</th><th class="p-2 border">Tuổi NĐBH chính</th><th class="p-2 border">Phí chính</th>`;
      if (!extraAllZero) html += `<th class="p-2 border">Phí đóng thêm</th>`;
      persons.forEach(p => { html += `<th class="p-2 border">Phí bổ sung (${safe(p.name)})</th>`; });
      if (!isAnnual) html += `<th class="p-2 border">Tổng (theo kỳ)</th>`;
      html += `<th class="p-2 border">${isAnnual?'Tổng (năm)':'Nếu đóng theo năm'}</th>`;
      if (!isAnnual) html += `<th class="p-2 border">Chênh lệch</th>`;
      html += `</tr></thead><tbody>`;

      let sumMain=0,sumExtra=0,sumSuppCols=new Array(persons.length).fill(0);
      let sumTotalPeriod=0,sumTotalYear=0,sumDiff=0;

      for (const r of rowsData){
        sumMain += r.baseAnnualMain;
        sumExtra += r.extra;
        for (let i=0;i<persons.length;i++){ sumSuppCols[i] += r.perPersonSuppYear[i]; }
        if (!isAnnual){ sumTotalPeriod += r.totalPeriod; sumDiff += r.diff; }
        sumTotalYear += r.totalYear;

        html += `<tr>
          <td class="p-2 border text-center">${r.year}</td>
          <td class="p-2 border text-center">${r.ageNow}</td>
          <td class="p-2 border text-right">${fmt(r.baseAnnualMain)}</td>`;
        if (!extraAllZero) html += `<td class="p-2 border text-right">${fmt(r.extra)}</td>`;
        for (let i=0;i<persons.length;i++){ html += `<td class="p-2 border text-right">${fmt(r.perPersonSuppYear[i])}</td>`; }
        if (!isAnnual) html += `<td class="p-2 border text-right">${fmt(r.totalPeriod)}</td>`;
        html += `<td class="p-2 border text-right">${fmt(r.totalYear)}</td>`;
        if (!isAnnual) html += `<td class="p-2 border text-right">${r.diff?`<span class="text-red-600 font-bold">${fmt(r.diff)}</span>`:'0'}</td>`;
        html += `</tr>`;
      }
      html += `<tr class="font-semibold bg-gray-50"><td class="p-2 border">Tổng cộng</td><td class="p-2 border"></td>
        <td class="p-2 border text-right">${fmt(sumMain)}</td>`;
      if (!extraAllZero) html += `<td class="p-2 border text-right">${fmt(sumExtra)}</td>`;
      for (let i=0;i<persons.length;i++){ html += `<td class="p-2 border text-right">${fmt(sumSuppCols[i])}</td>`; }
      if (!isAnnual) html += `<td class="p-2 border text-right">${fmt(sumTotalPeriod)}</td>`;
      html += `<td class="p-2 border text-right">${fmt(sumTotalYear)}</td>`;
      if (!isAnnual) html += `<td class="p-2 border text-right">${fmt(sumDiff)}</td>`;
      html += `</tr></tbody></table>`;

      // Export
      html += `<div class="mt-4 text-center">
        <button id="export-html-btn" class="bg-blue-600 text-white px-4 py-2 rounded mr-2">Xuất HTML</button>
        <button id="export-pdf-btn" class="bg-gray-700 text-white px-4 py-2 rounded">Xuất PDF</button>
      </div>`;

      container.innerHTML = html;
      modal?.classList.remove('hidden');

      const buildDoc = ()=>{
        const clone = container.cloneNode(true);
        clone.querySelectorAll('#export-html-btn,#export-pdf-btn').forEach(el=>el.remove());
        const baseCss = "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:24px;}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{text-align:left;background:#f3f4f6}td:first-child,th:first-child{text-align:left}.text-red-600{color:#d00;font-weight:700}";
        const printCss = "@page{size:A4;margin:12mm}@media print{thead{display:table-header-group}tfoot{display:table-footer-group}tr,td,th{page-break-inside:avoid}}";
        const today = new Date(); const y=today.getFullYear(), m=String(today.getMonth()+1).padStart(2,'0'), d=String(today.getDate()).padStart(2,'0');
        const html = `<!doctype html><html lang='vi'><head><meta charset='utf-8'><title>Bảng tóm tắt quyền lợi & phí - ${y}-${m}-${d}</title><style>${baseCss}${printCss}</style></head><body>${clone.innerHTML}</body></html>`;
        return {html, ymd:`${y}-${m}-${d}`};
      };
      $('export-html-btn')?.addEventListener('click', ()=>{
        const {html, ymd} = buildDoc();
        const blob = new Blob([html], {type:'text/html;charset=utf-8'});
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `bang-tom-tat_${ymd}.html`;
        document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(url); a.remove();}, 0);
      });
      $('export-pdf-btn')?.addEventListener('click', ()=>{
        const {html} = buildDoc();
        const iframe = document.createElement('iframe');
        Object.assign(iframe.style,{position:'fixed', right:0, bottom:0, width:0, height:0, border:0});
        document.body.appendChild(iframe);
        iframe.onload = ()=> setTimeout(()=>{ try{ iframe.contentWindow.focus(); iframe.contentWindow.print(); } finally { setTimeout(()=>iframe.remove(), 3000); } }, 200);
        iframe.srcdoc = html;
      });
    } catch(e){
      showErr(e.message || String(e));
      $('summary-modal')?.classList.remove('hidden');
      $('summary-content-container').innerHTML = `<div class="text-red-600">${safe(e.message||String(e))}</div>`;
    }
  }
  window.generateSummaryTable = generateSummaryTable;

  document.addEventListener('DOMContentLoaded', ()=>{
    const btn = $('view-summary-btn');
    if (btn && !btn.dataset._bound){
      btn.addEventListener('click', (ev)=>{
        ev.preventDefault();
        try{ generateSummaryTable(); }catch(e){ showErr(e.message||String(e)); }
      });
      btn.dataset._bound = '1';
    }
    // Keep “Xem từng người” live
    const tgt = $('supplementary-insured-container');
    if (tgt && !tgt._observerAttached) {
      const mo = new MutationObserver(()=>{
        const box = $('supp-insured-summaries');
        if (box && !box.classList.contains('hidden')) renderSuppList();
      });
      mo.observe(tgt, {childList:true, subtree:true});
      tgt._observerAttached = true;
    }
    $('toggle-supp-list-btn')?.addEventListener('click', ()=>{
      const list = $('supp-insured-summaries');
      if (!list) return;
      list.classList.toggle('hidden');
      if (!list.classList.contains('hidden')) renderSuppList();
    });
    $('mdp3-section')?.addEventListener('change', ()=> renderSuppList());
    $('add-supp-insured-btn')?.addEventListener('click', ()=> setTimeout(renderSuppList, 0));

    const diffEl = document.getElementById('freq-diff');
    if (diffEl) { diffEl.classList.add('text-red-600','font-bold'); }
  }, {once:true});
})();
