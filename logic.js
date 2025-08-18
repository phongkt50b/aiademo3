/* logic.js — Consolidated single-version (no V2/V3). Keep only one generateSummaryTable. */
/* ====================== UTILITIES ====================== */
const $get = (id) => document.getElementById(id);
const $qs = (sel, root=document) => root.querySelector(sel);
const $qsa = (sel, root=document) => Array.from(root.querySelectorAll(sel));

const _fmtVN = (n) => {
  n = Number(n || 0);
  if (!Number.isFinite(n)) n = 0;
  try { return n.toLocaleString('vi-VN'); }
  catch { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.'); }
};
const formatDisplayCurrency = (n) => _fmtVN(Math.round(Number(n || 0) / 1000) * 1000);
const parseFormattedNumber = (s) => {
  if (s == null) return 0;
  const m = String(s).replace(/[^\d]/g, '');
  return m ? parseInt(m, 10) : 0;
};
const sanitizeHtml = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/* ====================== STATE FALLBACKS ====================== */
window.appState = window.appState || {
  mainProduct: { key: '', stbh: 0, paymentTerm: 0, extraPremium: 0 },
  fees: { baseMain: 0, total: 0, totalSupp: 0, byPerson: {} }
};

/* ====================== EXTERNAL HOOKS (use originals if exist) ====================== */
const _fn = (name, fb=null) => (typeof window[name] === 'function' ? window[name] : fb);

const collectPersonData = _fn('collectPersonData', (container, isMain=false) => {
  const name = $qs('.name-input', container)?.value?.trim() || (isMain ? 'NĐBH Chính' : 'NĐBH');
  const dob = $qs('.dob-input', container)?.value?.trim() || '01/01/2000';
  const gender = $qs('.gender-select', container)?.value || 'Nam';
  const ageEl = $qs('.age-span', container)?.textContent?.trim();
  const age = parseInt(ageEl || '0', 10) || 0;
  const id = container?.dataset?.pid || (isMain ? 'main' : (`supp_${name}_${age}`));
  return { id, isMain, name, dob, gender, age, supplements: {} };
});
const calculateMainPremium = _fn('calculateMainPremium', (p, prod) => Number(window?.appState?.fees?.baseMain || 0));
const calculateHealthSclPremium = _fn('calculateHealthSclPremium', () => 0);
const calculateBhnPremium = _fn('calculateBhnPremium', () => 0);
const calculateAccidentPremium = _fn('calculateAccidentPremium', () => 0);
const calculateHospitalSupportPremium = _fn('calculateHospitalSupportPremium', () => 0);
const getHealthSclStbhByProgram = _fn('getHealthSclStbhByProgram', () => 0);

/* ====================== MĐP3 (fallback if missing) ====================== */
window.MDP3 = window.MDP3 || (() => {
  const isEnabled = () => !!$get('mdp3-enable')?.checked;
  const getSelectedId = () => {
    const r = $qs('#mdp3-section input[type="radio"]:checked');
    if (r) return r.value || r.id || null;
    const sel = $qs('#mdp3-section select');
    if (sel) return sel.value || null;
    return null;
  };
  const getPremium = () => {
    const text = $get('mdp3-fee-display')?.textContent || '0';
    return parseFormattedNumber(text);
  };
  const getSelectedAge = () => null;
  return { isEnabled, getSelectedId, getPremium, getSelectedAge };
})();

/* ====================== VALIDATIONS ====================== */
function _validatePaymentTermAndShowError() {
  try {
    const errBox = $get('error-message');
    if (errBox) errBox.textContent = '';
    const prodKey = ($get('main-product')?.value || window.appState.mainProduct?.key || '').trim();
    let term = window.appState.mainProduct?.paymentTerm;

    const termInput = document.querySelector('#main-product-options input[name="paymentTerm"], #main-product-options select[name="paymentTerm"], #abuv-term');
    if (termInput) {
      const v = parseInt(termInput.value || termInput.getAttribute('value') || '0', 10);
      if (!isNaN(v) && v>0) term = v;
    }

    const minByKey = (k)=>{
      if (k === 'TRON_TAM_AN') return 10;
      if (k === 'AN_BINH_UU_VIET') return 5;
      if (k === 'PUL_5_NAM') return 5;
      if (k === 'PUL_15_NAM') return 15;
      if (/^(PUL|MUL)/.test(k)) return 4;
      return 4;
    };
    const minTerm = minByKey(prodKey);
    if (!term || term < minTerm) {
      throw new Error(`Thời hạn đóng phí không hợp lệ (tối thiểu ${minTerm} năm cho sản phẩm này).`);
    }
    if (prodKey === 'AN_BINH_UU_VIET' && ![5,10,15].includes(term)) {
      throw new Error('An Bình Ưu Việt chỉ cho phép thời hạn 5 / 10 / 15 năm.');
    }
    return true;
  } catch (e) {
    const errBox = $get('error-message');
    if (errBox) errBox.textContent = e.message || String(e);
    return false;
  }
}

function _getMdp3OtherAgeBase() {
  try {
    if (window.MDP3 && typeof MDP3.getSelectedAge === 'function') {
      const a = MDP3.getSelectedAge();
      if (typeof a === 'number' && a >= 0) return a;
    }
  } catch {}
  try {
    const sec = $get('mdp3-section');
    if (!sec) return null;
    const inp = sec.querySelector('input.dob-input, input[name="mdp3-dob"], input[data-role="mdp3-dob"]');
    if (!inp) return null;
    const v = (inp.value || '').trim();
    const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) return null;
    const d = new Date(parseInt(m[3],10), parseInt(m[2],10)-1, parseInt(m[1],10));
    if (isNaN(d.getTime())) return null;
    const today = new Date();
    let age = today.getFullYear() - d.getFullYear();
    const md = today.getMonth() - d.getMonth();
    if (md < 0 || (md === 0 && today.getDate() < d.getDate())) age--;
    return age;
  } catch {}
  return null;
}

/* ====================== “Xem từng người” (only Riders + MĐP3) ====================== */
function renderSuppList(){
  const box = $get('supp-insured-summaries');
  if (!box) return;

  const persons = [];
  const main = collectPersonData($get('main-person-container'), true);
  if (main) persons.push(main);
  $qsa('#supplementary-insured-container .person-container').forEach(c => {
    const p = collectPersonData(c,false); if (p) persons.push(p);
  });

  const getSuppAnnual = (pid) => {
    try {
      const d = window?.appState?.fees?.byPerson?.[pid]?.suppDetails || {};
      let sum = 0;
      for (const k in d) {
        const v = d[k];
        sum += (typeof v === 'number') ? v : (v && typeof v.annual === 'number' ? v.annual : 0);
      }
      return sum;
    } catch { return 0; }
  };

  const mdpOn = !!(window.MDP3 && MDP3.isEnabled && MDP3.isEnabled());
  const mdpId = mdpOn ? (MDP3.getSelectedId && MDP3.getSelectedId()) : null;
  const mdpFee = mdpOn ? (MDP3.getPremium && MDP3.getPremium()) : 0;

  const rows = persons.map(p => {
    const sum = getSuppAnnual(p.id) + ((mdpOn && mdpId === p.id) ? (mdpFee||0) : 0);
    return `<div class="flex justify-between"><span>${sanitizeHtml(p.name||'Người')}</span><span>${formatDisplayCurrency(sum)}</span></div>`;
  });
  if (mdpOn && mdpId === 'other' && (mdpFee||0) > 0) {
    rows.push(`<div class="flex justify-between"><span>Miễn đóng phí 3.0 (Người khác)</span><span>${formatDisplayCurrency(mdpFee)}</span></div>`);
  }
  box.innerHTML = rows.join('');
}

function _bindSuppListLive(){
  try {
    const tgt = $get('supplementary-insured-container');
    if (tgt && !tgt._observerAttached) {
      const mo = new MutationObserver(()=>{
        const box = $get('supp-insured-summaries');
        if (box && !box.classList.contains('hidden')) renderSuppList();
      });
      mo.observe(tgt, {childList: true, subtree: true});
      tgt._observerAttached = true;
    }
    $get('add-supp-insured-btn')?.addEventListener('click', ()=> setTimeout(()=>renderSuppList(), 0));
    $get('mdp3-section')?.addEventListener('change', (e)=>{
      if (e.target && (e.target.name === 'mdp3-target' || e.target.matches('select'))) {
        renderSuppList();
      }
    });
    $get('toggle-supp-list-btn')?.addEventListener('click', ()=> setTimeout(()=>renderSuppList(), 0));
  } catch {}
}
document.addEventListener('DOMContentLoaded', _bindSuppListLive, {once:true});

/* ====================== Single generateSummaryTable ====================== */
function generateSummaryTable() {
  const modal = $get('summary-modal');
  const container = $get('summary-content-container');
  if (!container) return;
  container.innerHTML = '';

  const getPeriods = () => {
    const v = $get('payment-frequency')?.value || 'year';
    return v === 'half' ? 2 : (v === 'quarter' ? 4 : 1);
  };
  const periods = getPeriods();
  const isAnnual = periods===1;
  const suppFactor = periods===2 ? 1.02 : (periods===4 ? 1.04 : 1);
  const riderMaxAge = (key) => ({ health_scl: 74, bhn: 85, accident: 64, hospital_support: 64, mdp3: 64 }[key] ?? 64);

  try {
    const mainCont = $get('main-person-container');
    const mainInfo = collectPersonData(mainCont, true);
    const targetAgeEl = $get('target-age-input');
    let targetAge = parseInt(targetAgeEl?.value, 10);

    const productKey = $get('main-product')?.value || window.appState.mainProduct.key || '';
    let paymentTerm = window.appState.mainProduct.paymentTerm || 0;
    if (productKey === 'TRON_TAM_AN') paymentTerm = 10;
    if (productKey === 'AN_BINH_UU_VIET') {
      const val = parseInt($get('abuv-term')?.value || '10', 10);
      paymentTerm = val;
    }
    const minByKey = (k)=>{
      if (k === 'TRON_TAM_AN') return 10;
      if (k === 'AN_BINH_UU_VIET') return 5;
      if (k === 'PUL_5_NAM') return 5;
      if (k === 'PUL_15_NAM') return 15;
      if (/^(PUL|MUL)/.test(k)) return 4;
      return 4;
    };
    if (!paymentTerm || paymentTerm < minByKey(productKey)) paymentTerm = minByKey(productKey);

    const minTargetAge = mainInfo.age + paymentTerm - 1;
    const hint = $get('target-age-hint');
    if (hint) hint.textContent = `Phải ≥ ${minTargetAge} (tuổi hiện tại ${mainInfo.age} + thời hạn đóng phí ${paymentTerm} − 1)`;
    if (!_validatePaymentTermAndShowError()) throw new Error(`Tuổi mục tiêu phải ≥ ${minTargetAge}.`);
    if (!targetAge || targetAge < minTargetAge) throw new Error(`Tuổi mục tiêu phải ≥ ${minTargetAge}.`);

    const others = $qsa('#supplementary-insured-container .person-container').map(c => collectPersonData(c,false));
    const persons = [mainInfo, ...others];

    const mdpEnabled = !!(window.MDP3 && MDP3.isEnabled && MDP3.isEnabled());
    const mdpTargetId = mdpEnabled ? (MDP3.getSelectedId && MDP3.getSelectedId()) : null;
    const mdpFeeYear = mdpEnabled ? (MDP3.getPremium && MDP3.getPremium()) : 0;
    if (mdpEnabled && mdpTargetId === 'other') {
      const ageOther = _getMdp3OtherAgeBase();
      persons.push({
        id: 'mdp3_other',
        isMain: false,
        name: 'Người khác (MĐP3)',
        gender: 'Nam',
        age: (typeof ageOther === 'number' ? ageOther : mainInfo.age),
        supplements: {}
      });
    }

    /* ===== Phần 1 ===== */
    let html = '';
    html += `<h3 class="text-lg font-bold mb-2">Phần 1 · Tóm tắt sản phẩm</h3>`;
    html += `<table class="w-full border-collapse text-sm"><thead><tr>
      <th class="p-2 border">Tên NĐBH</th>
      <th class="p-2 border">Sản phẩm</th>
      <th class="p-2 border">STBH</th>
      <th class="p-2 border">Số năm đóng phí</th>`;
    if (!isAnnual) html += `<th class="p-2 border">Phí đóng (${periods===2?'nửa năm':'theo quý'})</th><th class="p-2 border">Phí đóng (quy năm)</th>`;
    html += `<th class="p-2 border">Phí đóng theo năm</th>`;
    if (!isAnnual) html += `<th class="p-2 border">Chênh lệch</th>`;
    html += `</tr></thead><tbody>`;

    const pushRow = (acc, personName, prodName, stbhDisplay, years, baseAnnual, isRider)=>{
      const perPeriod = isAnnual ? 0 : Math.round((isRider ? (baseAnnual*suppFactor) : baseAnnual)/periods/1000)*1000;
      const annualEq = isAnnual ? 0 : perPeriod*periods;
      const diff = isAnnual ? 0 : (annualEq - baseAnnual);

      acc.per += perPeriod; acc.eq += annualEq; acc.base += baseAnnual; acc.diff += diff;

      let row = `<tr>
        <td class="p-2 border">${sanitizeHtml(personName)}</td>
        <td class="p-2 border">${sanitizeHtml(prodName)}</td>
        <td class="p-2 border text-right">${stbhDisplay||'—'}</td>
        <td class="p-2 border text-center">${years||'—'}</td>`;
      if (!isAnnual) row += `<td class="p-2 border text-right">${formatDisplayCurrency(perPeriod)}</td><td class="p-2 border text-right">${formatDisplayCurrency(annualEq)}</td>`;
      row += `<td class="p-2 border text-right">${formatDisplayCurrency(baseAnnual)}</td>`;
      if (!isAnnual) row += `<td class="p-2 border text-right">${diff? `<span class="text-red-600 font-bold">${formatDisplayCurrency(diff)}</span>` : '0'}</td>`;
      row += `</tr>`;
      return row;
    };

    for (const p of persons){
      const acc = {per:0,eq:0,base:0,diff:0};
      let rows = [];

      if (p.isMain && window.appState.mainProduct.key){
        const baseAnnual = calculateMainPremium(p, window.appState.mainProduct);
        const stbh = formatDisplayCurrency(window.appState.mainProduct.stbh||0);
        rows.push( pushRow(acc, p.name, 'Sản phẩm chính', stbh, paymentTerm||'—', baseAnnual, false) );
      }
      if (p.isMain && (window.appState.mainProduct.extraPremium||0)>0){
        rows.push( pushRow(acc, p.name, 'Phí đóng thêm', '—', paymentTerm||'—', window.appState.mainProduct.extraPremium||0, false) );
      }
      if (p.supplements && p.supplements.health_scl){
        const scl = p.supplements.health_scl;
        const program = scl.program || '';
        const scope = scl.scope || 'main_vn';
        const outpatient = !!scl.outpatient;
        const dental = !!scl.dental;
        const programName = ({co_ban:'Cơ bản',nang_cao:'Nâng cao',toan_dien:'Toàn diện',hoan_hao:'Hoàn hảo'})[program] || '';
        const prodName = `Sức khoẻ Bùng Gia Lực – ${programName} (${scope==='main_global'?'Nước ngoài':'Trong nước'}${outpatient?', Ngoại trú':''}${dental?', Nha khoa':''})`;
        const baseAnnual = calculateHealthSclPremium(p, window.appState.fees.baseMain, 0);
        const stbh = (typeof window.getHealthSclStbhByProgram === 'function' ? window.getHealthSclStbhByProgram(program) : 0) || 0;
        const years = Math.max(0, Math.min(targetAge, riderMaxAge('health_scl')) - p.age + 1);
        rows.push( pushRow(acc, p.name, prodName, formatDisplayCurrency(stbh), years, baseAnnual, true) );
      }
      if (p.supplements && p.supplements.bhn){
        const stbh = parseFormattedNumber(p.supplements.bhn.stbh);
        const baseAnnual = calculateBhnPremium(p, window.appState.fees.baseMain, 0);
        const years = Math.max(0, Math.min(targetAge, riderMaxAge('bhn')) - p.age + 1);
        rows.push( pushRow(acc, p.name, 'Bệnh Hiểm Nghèo 2.0', formatDisplayCurrency(stbh), years, baseAnnual, true) );
      }
      if (p.supplements && p.supplements.accident){
        const stbh = parseFormattedNumber(p.supplements.accident.stbh);
        const baseAnnual = calculateAccidentPremium(p, window.appState.fees.baseMain, 0);
        const years = Math.max(0, Math.min(targetAge, riderMaxAge('accident')) - p.age + 1);
        rows.push( pushRow(acc, p.name, 'Bảo hiểm Tai nạn', formatDisplayCurrency(stbh), years, baseAnnual, true) );
      }
      if (p.supplements && p.supplements.hospital_support){
        const stbh = parseFormattedNumber(p.supplements.hospital_support.stbh);
        const baseAnnual = calculateHospitalSupportPremium(p, window.appState.fees.baseMain, 0);
        const years = Math.max(0, Math.min(targetAge, riderMaxAge('hospital_support')) - p.age + 1);
        rows.push( pushRow(acc, p.name, 'Hỗ trợ chi phí nằm viện', formatDisplayCurrency(stbh), years, baseAnnual, true) );
      }
      if (mdpEnabled && mdpFeeYear > 0){
        const selId = mdpTargetId;
        if (selId === p.id || (selId==='other' && p.id==='mdp3_other')){
          const years = Math.max(0, Math.min(targetAge, riderMaxAge('mdp3')) - p.age + 1);
          rows.push( pushRow(acc, p.name, 'Miễn đóng phí 3.0', '—', years, mdpFeeYear, true) );
        }
      }

      let totalRow = `<tr class="bg-gray-50 font-semibold">
        <td class="p-2 border">${sanitizeHtml(p.name|| (p.isMain?'NĐBH Chính':'NĐBH Bổ sung'))}</td>
        <td class="p-2 border">Tổng</td>
        <td class="p-2 border">—</td>
        <td class="p-2 border">—</td>`;
      if (!isAnnual) totalRow += `<td class="p-2 border text-right">${formatDisplayCurrency(acc.per)}</td><td class="p-2 border text-right">${formatDisplayCurrency(acc.eq)}</td>`;
      totalRow += `<td class="p-2 border text-right">${formatDisplayCurrency(acc.base)}</td>`;
      if (!isAnnual) totalRow += `<td class="p-2 border text-right">${acc.diff ? `<span class="text-red-600 font-bold">${formatDisplayCurrency(acc.diff)}</span>` : '0'}</td>`;
      totalRow += `</tr>`;

      html += totalRow + rows.join('');
    }
    html += `</tbody></table>`;

    /* ===== Phần 2 ===== */
    html += `<h3 class="text-lg font-bold mt-6 mb-2">Phần 2 · Bảng phí</h3>`;

    let rowsData = [];
    for (let year=1; mainInfo.age + year -1 <= targetAge; year++){
      const ageNow = mainInfo.age + year -1;
      const inPayTerm = (year <= paymentTerm);
      const baseAnnualMain = inPayTerm ? (window.appState.fees?.baseMain||0) : 0;
      const extra = inPayTerm ? (window.appState.mainProduct.extraPremium||0) : 0;

      const perPersonSuppPeriod = [];
      const perPersonSuppYear = [];

      for (let pi=0; pi<persons.length; pi++){
        const p = persons[pi];
        let y = ageNow + (p.isMain ? 0 : (p.age - mainInfo.age));
        let sPeriod=0, sYear=0;

        if (p.supplements && p.supplements.health_scl){
          const base = calculateHealthSclPremium(p, baseAnnualMain, 0, y);
          sYear += base;
          sPeriod += isAnnual ? 0 : Math.round(base * (suppFactor) / periods /1000)*1000;
        }
        if (p.supplements && p.supplements.bhn){
          const base = calculateBhnPremium(p, baseAnnualMain, 0, y);
          sYear += base;
          sPeriod += isAnnual ? 0 : Math.round(base * (suppFactor) / periods /1000)*1000;
        }
        if (p.supplements && p.supplements.accident){
          const base = calculateAccidentPremium(p, baseAnnualMain, 0, y);
          sYear += base;
          sPeriod += isAnnual ? 0 : Math.round(base * (suppFactor) / periods /1000)*1000;
        }
        if (p.supplements && p.supplements.hospital_support){
          const base = calculateHospitalSupportPremium(p, baseAnnualMain, 0, y);
          sYear += base;
          sPeriod += isAnnual ? 0 : Math.round(base * (suppFactor) / periods /1000)*1000;
        }
        if (mdpEnabled && mdpTargetId && (mdpTargetId === p.id || (mdpTargetId==='other' && p.id==='mdp3_other'))){
          const fee = (y <= 64) ? mdpFeeYear : 0;
          sYear += fee;
          sPeriod += isAnnual ? 0 : Math.round(fee*(suppFactor)/periods/1000)*1000;
        }

        perPersonSuppPeriod.push(isAnnual?0:sPeriod);
        perPersonSuppYear.push(sYear);
      }

      const totalSuppPeriod = perPersonSuppPeriod.reduce((a,b)=>a+b,0);
      const totalSuppYear = perPersonSuppYear.reduce((a,b)=>a+b,0);
      const totalPeriod = isAnnual ? 0 : (Math.round(baseAnnualMain/periods/1000)*1000 + Math.round(extra/periods/1000)*1000 + totalSuppPeriod);
      const totalYear = baseAnnualMain + extra + totalSuppYear;
      const diff = isAnnual ? 0 : ((totalPeriod*periods) - totalYear);

      rowsData.push({year, ageNow, baseAnnualMain, extra, perPersonSuppPeriod, perPersonSuppYear, totalPeriod, totalYear, diff});
    }

    const extraAllZero = rowsData.every(r=> r.extra === 0);

    html += `<table class="w-full border-collapse text-sm"><thead><tr>
      <th class="p-2 border">Năm HĐ</th>
      <th class="p-2 border">Tuổi NĐBH chính</th>
      <th class="p-2 border">Phí chính</th>`;
    if (!extraAllZero) html += `<th class="p-2 border">Phí đóng thêm</th>`;
    persons.forEach(p => { html += `<th class="p-2 border">Phí bổ sung (${sanitizeHtml(p.name)})</th>`; });
    if (!isAnnual) html += `<th class="p-2 border">Tổng (theo kỳ)</th>`;
    html += `<th class="p-2 border">${isAnnual?'Tổng (năm)':'Nếu đóng theo năm'}</th>`;
    if (!isAnnual) html += `<th class="p-2 border">Chênh lệch</th>`;
    html += `</tr></thead><tbody>`;

    let sumMain=0,sumExtra=0,sumSuppCols=new Array(persons.length).fill(0);
    let sumTotalPeriod=0,sumTotalYear=0,sumDiff=0;

    for (const r of rowsData){
      sumMain += r.baseAnnualMain;
      sumExtra += r.extra;
      for (let i=0;i<persons.length;i++){
        sumSuppCols[i] += r.perPersonSuppYear[i];
      }
      if (!isAnnual){ sumTotalPeriod += r.totalPeriod; sumDiff += r.diff; }
      sumTotalYear += r.totalYear;

      html += `<tr>
        <td class="p-2 border text-center">${r.year}</td>
        <td class="p-2 border text-center">${r.ageNow}</td>
        <td class="p-2 border text-right">${formatDisplayCurrency(r.baseAnnualMain)}</td>`;
      if (!extraAllZero) html += `<td class="p-2 border text-right">${formatDisplayCurrency(r.extra)}</td>`;
      for (let i=0;i<persons.length;i++){
        html += `<td class="p-2 border text-right">${formatDisplayCurrency(r.perPersonSuppYear[i])}</td>`;
      }
      if (!isAnnual) html += `<td class="p-2 border text-right">${formatDisplayCurrency(r.totalPeriod)}</td>`;
      html += `<td class="p-2 border text-right">${formatDisplayCurrency(r.totalYear)}</td>`;
      if (!isAnnual){ const diffHtml2 = r.diff ? `<span class="text-red-600 font-bold">${formatDisplayCurrency(r.diff)}</span>` : '0'; html += `<td class="p-2 border text-right">${diffHtml2}</td>`; }
      html += `</tr>`;
    }

    html += `<tr class="font-semibold bg-gray-50">
      <td class="p-2 border">Tổng cộng</td>
      <td class="p-2 border"></td>
      <td class="p-2 border text-right">${formatDisplayCurrency(sumMain)}</td>`;
    if (!extraAllZero) html += `<td class="p-2 border text-right">${formatDisplayCurrency(sumExtra)}</td>`;
    for (let i=0;i<persons.length;i++){ html += `<td class="p-2 border text-right">${formatDisplayCurrency(sumSuppCols[i])}</td>`; }
    if (!isAnnual) html += `<td class="p-2 border text-right">${formatDisplayCurrency(sumTotalPeriod)}</td>`;
    html += `<td class="p-2 border text-right">${formatDisplayCurrency(sumTotalYear)}</td>`;
    if (!isAnnual) html += `<td class="p-2 border text-right">${formatDisplayCurrency(sumDiff)}</td>`;
    html += `</tr></tbody></table>`;

    // Export
    html += `<div class="mt-4 text-center">
      <button id="export-html-btn" class="bg-blue-600 text-white px-4 py-2 rounded mr-2">Xuất HTML</button>
      <button id="export-pdf-btn" class="bg-gray-700 text-white px-4 py-2 rounded">Xuất PDF</button>
    </div>`;

    container.innerHTML = html;
    modal.classList.remove('hidden');

    const buildDoc = ()=>{
      const clone = container.cloneNode(true);
      clone.querySelectorAll('#export-html-btn,#export-pdf-btn').forEach(el=>el.remove());
      const baseCss = "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:24px;}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}th,td{border:1px solid #ddd;padding:8px;text-align:right}th{text-align:left;background:#f3f4f6}td:first-child,th:first-child{text-align:left}.text-red-600{color:#d00;font-weight:700}";
      const printCss = "@page{size:A4;margin:12mm}@media print{thead{display:table-header-group}tfoot{display:table-footer-group}tr,td,th{page-break-inside:avoid}}";
      const today = new Date(); const y=today.getFullYear(), m=String(today.getMonth()+1).padStart(2,'0'), d=String(today.getDate()).padStart(2,'0');
      const html = `<!doctype html><html lang='vi'><head><meta charset='utf-8'><title>Bảng tóm tắt quyền lợi & phí - ${y}-${m}-${d}</title><style>${baseCss}${printCss}</style></head><body>${clone.innerHTML}</body></html>`;
      return {html, ymd:`${y}-${m}-${d}`};
    };
    $get('export-html-btn')?.addEventListener('click', ()=>{
      const {html, ymd} = buildDoc();
      const blob = new Blob([html], {type:'text/html;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `bang-tom-tat_${ymd}.html`;
      document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(url); a.remove();}, 0);
    });
    $get('export-pdf-btn')?.addEventListener('click', ()=>{
      const {html} = buildDoc();
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style,{position:'fixed', right:0, bottom:0, width:0, height:0, border:0});
      document.body.appendChild(iframe);
      iframe.onload = ()=> setTimeout(()=>{ try{ iframe.contentWindow.focus(); iframe.contentWindow.print(); } finally { setTimeout(()=>iframe.remove(), 3000); } }, 200);
      iframe.srcdoc = html;
    });

  } catch (e) {
    container.innerHTML = `<div class="text-red-600">${sanitizeHtml(e.message||String(e))}</div>`;
    $get('summary-modal')?.classList.remove('hidden');
  }
}
window.generateSummaryTable = generateSummaryTable;

/* ====================== Bind “Xem Bảng Minh Họa Chi Tiết” ====================== */
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = $get('view-summary-btn');
  if (btn && !btn.dataset._boundSingle){
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      if(!_validatePaymentTermAndShowError()) return;
      try { generateSummaryTable(); }
      catch(err){
        const c = $get('summary-content-container');
        if (c) c.innerHTML = `<div class="text-red-600">${sanitizeHtml(err && err.message ? err.message : String(err))}</div>`;
        $get('summary-modal')?.classList.remove('hidden');
      }
    });
    btn.dataset._boundSingle = '1';
  }

  // Panel UI polish: make diff red & bold
  const diffEl = document.getElementById('freq-diff');
  if (diffEl) { diffEl.classList.add('text-red-600','font-bold'); }
});
