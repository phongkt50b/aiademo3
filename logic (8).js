import { product_data } from './data.js';

// ===================================================================================
// ===== MODULE: CONFIG & BUSINESS RULES
// ===================================================================================
const CONFIG = {
    REFERENCE_DATE: new Date(),
    MAX_SUPPLEMENTARY_INSURED: 10,
    MAIN_PRODUCT_MIN_PREMIUM: 5000000,
    MAIN_PRODUCT_MIN_STBH: 100000000,
    EXTRA_PREMIUM_MAX_FACTOR: 5,
    PAYMENT_FREQUENCY_THRESHOLDS: {
        half: 7000000,
        quarter: 8000000,
    },
    HOSPITAL_SUPPORT_STBH_MULTIPLE: 100000,
    MAIN_PRODUCTS: {
        PUL_TRON_DOI: { name: 'PUL Trọn đời' },
        PUL_15NAM: { name: 'PUL 15 năm' },
        PUL_5NAM: { name: 'PUL 5 năm' },
        KHOE_BINH_AN: { name: 'MUL - Khoẻ Bình An' },
        VUNG_TUONG_LAI: { name: 'MUL - Vững Tương Lai' },
        TRON_TAM_AN: { name: 'Trọn tâm an' },
        AN_BINH_UU_VIET: { name: 'An Bình Ưu Việt' },
    },
    supplementaryProducts: [
        {
            id: 'health_scl',
            name: 'Sức khỏe Bùng Gia Lực',
            maxEntryAge: 65,
            maxRenewalAge: 74,
            calculationFunc: calculateHealthSclPremium,
            stbhByProgram: {
                co_ban: 100000000,
                nang_cao: 250000000,
                toan_dien: 500000000,
                hoan_hao: 1000000000,
            }
        },
        {
            id: 'bhn',
            name: 'Bệnh Hiểm Nghèo 2.0',
            maxEntryAge: 70,
            maxRenewalAge: 85,
            calculationFunc: calculateBhnPremium,
            minStbh: 200000000,
            maxStbh: 5000000000,
        },
        {
            id: 'accident',
            name: 'Bảo hiểm Tai nạn',
            maxEntryAge: 64,
            maxRenewalAge: 65,
            calculationFunc: calculateAccidentPremium,
            minStbh: 10000000,
            maxStbh: 8000000000,
        },
        {
            id: 'hospital_support',
            name: 'Hỗ trợ chi phí nằm viện',
            maxEntryAge: 55,
            maxRenewalAge: 59,
            calculationFunc: calculateHospitalSupportPremium,
            maxStbhByAge: {
                under18: 300000,
                from18: 1000000,
            }
        }
    ]
};


// ===================================================================================
// ===== MODULE: STATE MANAGEMENT
// ===================================================================================
let appState = {};

function initState() {
    appState = {
        mainProduct: {
            key: '',
            stbh: 0,
            premium: 0,
            paymentTerm: 0,
            extraPremium: 0,
            abuvTerm: '',
        },
        paymentFrequency: 'year',
        mainPerson: {
            id: 'main-person-container',
            container: document.getElementById('main-person-container'),
            isMain: true,
            name: '',
            dob: '',
            age: 0,
            daysFromBirth: 0,
            gender: 'Nam',
            riskGroup: 0,
            supplements: {}
        },
        supplementaryPersons: [],
        fees: {
            baseMain: 0,
            extra: 0,
            totalMain: 0,
            totalSupp: 0,
            total: 0,
            byPerson: {},
        },
        mdp3: {
            enabled: false,
            selectedId: null,
            fee: 0,
        }
    };
}


// ===================================================================================
// ===== MODULE: HELPERS (Pure utility functions)
// ===================================================================================

function roundDownTo1000(n) {
    return Math.floor(Number(n || 0) / 1000) * 1000;
}

function parseFormattedNumber(formattedString) {
    return parseInt(String(formattedString || '0').replace(/[.,]/g, ''), 10) || 0;
}

function formatCurrency(value, suffix = '') {
    const num = Number(value) || 0;
    return num.toLocaleString('vi-VN') + (suffix || '');
}

function formatDisplayCurrency(value) {
    const num = Number(value) || 0;
    return num.toLocaleString('vi-VN');
}

function sanitizeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getPaymentTermBounds(age) {
    return { min: 4, max: Math.max(0, 100 - age - 1) };
}


// ===================================================================================
// ===== MODULE: DATA COLLECTION (Reading from DOM into State)
// ===================================================================================

function updateStateFromUI() {
    const mainProductKey = document.getElementById('main-product')?.value || '';
    appState.mainProduct.key = mainProductKey;
    appState.mainProduct.stbh = parseFormattedNumber(document.getElementById('main-stbh')?.value);
    appState.mainProduct.premium = parseFormattedNumber(document.getElementById('main-premium-input')?.value);
    appState.mainProduct.paymentTerm = parseInt(document.getElementById('payment-term')?.value, 10) || 0;
    appState.mainProduct.extraPremium = parseFormattedNumber(document.getElementById('extra-premium-input')?.value);
    appState.mainProduct.abuvTerm = document.getElementById('abuv-term')?.value || '';
    appState.paymentFrequency = document.getElementById('payment-frequency')?.value || 'year';

    appState.mainPerson = collectPersonData(document.getElementById('main-person-container'), true);

    appState.supplementaryPersons = Array.from(
        document.querySelectorAll('#supplementary-insured-container .person-container')
    ).map(container => collectPersonData(container, false));
    
    if (window.MDP3) {
        appState.mdp3.enabled = MDP3.isEnabled();
        appState.mdp3.selectedId = MDP3.getSelectedId();
    }
}

function collectPersonData(container, isMain) {
    if (!container) return null;

    const dobInput = container.querySelector('.dob-input');
    const dobStr = dobInput ? dobInput.value : '';
    let age = 0;
    let daysFromBirth = 0;

    if (dobStr && /^\d{2}\/\d{2}\/\d{4}$/.test(dobStr)) {
        const [dd, mm, yyyy] = dobStr.split('/').map(n => parseInt(n, 10));
        const birthDate = new Date(yyyy, mm - 1, dd);
        if (birthDate.getFullYear() === yyyy && birthDate.getMonth() === mm - 1 && birthDate.getDate() === dd && birthDate <= CONFIG.REFERENCE_DATE) {
            daysFromBirth = Math.floor((CONFIG.REFERENCE_DATE - birthDate) / (1000 * 60 * 60 * 24));
            age = CONFIG.REFERENCE_DATE.getFullYear() - birthDate.getFullYear();
            const m = CONFIG.REFERENCE_DATE.getMonth() - birthDate.getMonth();
            if (m < 0 || (m === 0 && CONFIG.REFERENCE_DATE.getDate() < birthDate.getDate())) {
                age--;
            }
        }
    }

    const supplementsContainer = isMain 
        ? document.querySelector('#main-supp-container .supplementary-products-container')
        : container.querySelector('.supplementary-products-container');
    
    const supplements = {};
    if (supplementsContainer) {
        CONFIG.supplementaryProducts.forEach(prod => {
            const section = supplementsContainer.querySelector(`.${prod.id}-section`);
            if (section && section.querySelector(`.${prod.id}-checkbox`)?.checked) {
                supplements[prod.id] = {
                    stbh: parseFormattedNumber(section.querySelector(`.${prod.id}-stbh`)?.value),
                    program: section.querySelector(`.health-scl-program`)?.value,
                    scope: section.querySelector(`.health-scl-scope`)?.value,
                    outpatient: section.querySelector(`.health-scl-outpatient`)?.checked,
                    dental: section.querySelector(`.health-scl-dental`)?.checked,
                };
            }
        });
    }

    return {
        id: container.id,
        container: container,
        isMain: isMain,
        name: container.querySelector('.name-input')?.value || (isMain ? 'NĐBH Chính' : 'NĐBH Bổ sung'),
        dob: dobStr,
        age,
        daysFromBirth,
        gender: container.querySelector('.gender-select')?.value || 'Nam',
        riskGroup: parseInt(container.querySelector('.occupation-input')?.dataset.group, 10) || 0,
        supplements
    };
}


// ===================================================================================
// ===== MODULE: LOGIC & CALCULATIONS (Pure functions)
// ===================================================================================
function performCalculations(state) {
    const fees = {
        baseMain: 0,
        extra: 0,
        totalSupp: 0,
        byPerson: {},
    };

    fees.baseMain = calculateMainPremium(state.mainPerson, state.mainProduct);
    fees.extra = state.mainProduct.extraPremium;
    
    const allPersons = [state.mainPerson, ...state.supplementaryPersons].filter(p => p);
    allPersons.forEach(p => {
        fees.byPerson[p.id] = { main: 0, supp: 0, total: 0, suppDetails: {} };
    });

    if (fees.byPerson[state.mainPerson.id]) {
        fees.byPerson[state.mainPerson.id].main = fees.baseMain + fees.extra;
    }
    
    let totalHospitalSupportStbh = 0;
    allPersons.forEach(person => {
        let personSuppFee = 0;
        CONFIG.supplementaryProducts.forEach(prod => {
             if (person.supplements[prod.id]) {
                const fee = prod.calculationFunc(person, fees.baseMain, totalHospitalSupportStbh);
                personSuppFee += fee;
                fees.byPerson[person.id].suppDetails[prod.id] = fee;

                if (prod.id === 'hospital_support') {
                    totalHospitalSupportStbh += person.supplements[prod.id].stbh;
                }
            }
        });
        fees.byPerson[person.id].supp = personSuppFee;
        fees.totalSupp += personSuppFee;
    });

    window.personFees = {};
    allPersons.forEach(p => {
        const totalMainForPerson = p.isMain ? (fees.baseMain + fees.extra) : 0;
        window.personFees[p.id] = {
            main: totalMainForPerson,
            mainBase: p.isMain ? fees.baseMain : 0,
            supp: fees.byPerson[p.id]?.supp || 0,
            total: totalMainForPerson + (fees.byPerson[p.id]?.supp || 0)
        };
    });

    const mdp3Fee = window.MDP3 ? MDP3.getPremium() : 0;
    fees.totalSupp += mdp3Fee;
    // assign mdp3 fee to byPerson map (or synthetic 'mdp3_other')
    try {
      const mdpEnabled = !!(window.MDP3 && MDP3.isEnabled && MDP3.isEnabled());
      const mdpTargetId = mdpEnabled ? (MDP3.getSelectedId && MDP3.getSelectedId()) : null;
      if (mdpEnabled && mdp3Fee > 0) {
        if (mdpTargetId && fees.byPerson[mdpTargetId]) {
          fees.byPerson[mdpTargetId].supp = (fees.byPerson[mdpTargetId].supp||0) + mdp3Fee;
          fees.byPerson[mdpTargetId].suppDetails = fees.byPerson[mdpTargetId].suppDetails || {};
          fees.byPerson[mdpTargetId].suppDetails.mdp3 = mdp3Fee;
        } else if (mdpTargetId === 'other') {
          if (!fees.byPerson['mdp3_other']) fees.byPerson['mdp3_other'] = { main: 0, supp: 0, total: 0, suppDetails: {} };
          fees.byPerson['mdp3_other'].supp += mdp3Fee;
          fees.byPerson['mdp3_other'].suppDetails.mdp3 = mdp3Fee;
        }
      }
    } catch(e) {}
    
    
    const totalMain = fees.baseMain + fees.extra;
    const total = totalMain + fees.totalSupp;
    
    return { ...fees, totalMain, total };
}

function calculateMainPremium(customer, productInfo, ageOverride = null) {
  const ageToUse = ageOverride ?? customer.age;
  const { gender } = customer;
  const { key: mainProduct, stbh, premium: enteredPremium, abuvTerm } = productInfo;
  let premium = 0;

  if (!mainProduct) return 0;

  if (mainProduct.startsWith('PUL') || mainProduct === 'AN_BINH_UU_VIET' || mainProduct === 'TRON_TAM_AN') {
    let rate = 0;
    const effectiveStbh = (mainProduct === 'TRON_TAM_AN') ? 100000000 : stbh;
    if (effectiveStbh === 0) return 0;
    
    const genderKey = gender === 'Nữ' ? 'nu' : 'nam';

    if (mainProduct.startsWith('PUL')) {
        rate = product_data.pul_rates[mainProduct]?.find(r => r.age === ageToUse)?.[genderKey] || 0;
    } else if (mainProduct === 'AN_BINH_UU_VIET') {
        if (!abuvTerm) return 0;
        rate = product_data.an_binh_uu_viet_rates[abuvTerm]?.find(r => r.age === ageToUse)?.[genderKey] || 0;
    } else if (mainProduct === 'TRON_TAM_AN') {
        rate = product_data.an_binh_uu_viet_rates['10']?.find(r => r.age === ageToUse)?.[genderKey] || 0;
    }
    premium = (effectiveStbh / 1000) * rate;

  } else if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI'].includes(mainProduct)) {
      premium = enteredPremium;
  }

  return roundDownTo1000(premium);
}

function calculateHealthSclPremium(customer, mainPremium, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const config = CONFIG.supplementaryProducts.find(p => p.id === 'health_scl');
    if (ageToUse > config.maxRenewalAge) return 0;

    const { program, scope, outpatient, dental } = (customer && customer.supplements && customer.supplements.health_scl) ? customer.supplements.health_scl : {};
    if (!program || !scope) return 0;

    const ageBandIndex = product_data.health_scl_rates.age_bands.findIndex(b => ageToUse >= b.min && ageToUse <= b.max);
    if (ageBandIndex === -1) return 0;

    let totalPremium = product_data.health_scl_rates[scope]?.[ageBandIndex]?.[program] || 0;
    if (outpatient) totalPremium += product_data.health_scl_rates.outpatient?.[ageBandIndex]?.[program] || 0;
    if (dental) totalPremium += product_data.health_scl_rates.dental?.[ageBandIndex]?.[program] || 0;

    return roundDownTo1000(totalPremium);
}

function calculateBhnPremium(customer, mainPremium, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const config = CONFIG.supplementaryProducts.find(p=>p.id==='bhn');
    if (ageToUse > config.maxRenewalAge) return 0;
    
    const { gender } = customer;
    const { stbh } = customer.supplements.bhn;
    if (!stbh) return 0;

    const rate = product_data.bhn_rates.find(r => ageToUse >= r.ageMin && ageToUse <= r.ageMax)?.[gender === 'Nữ' ? 'nu' : 'nam'] || 0;
    const premiumRaw = (stbh / 1000) * rate;
    return roundDownTo1000(premiumRaw);
}

function calculateAccidentPremium(customer, mainPremium, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const config = CONFIG.supplementaryProducts.find(p=>p.id==='accident');
    if (ageToUse > config.maxRenewalAge) return 0;

    const { riskGroup } = customer;
    if (riskGroup === 0 || riskGroup > 4) return 0;
    
    const { stbh } = customer.supplements.accident;
    if (!stbh) return 0;

    const rate = product_data.accident_rates[riskGroup] || 0;
    const premiumRaw = (stbh / 1000) * rate;
    return roundDownTo1000(premiumRaw);
}

function calculateHospitalSupportPremium(customer, mainPremium, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const config = CONFIG.supplementaryProducts.find(p=>p.id==='hospital_support');
    if (ageToUse > config.maxRenewalAge) return 0;

    const { stbh } = (customer && customer.supplements && customer.supplements.hospital_support) ? customer.supplements.hospital_support : {};
    if (!stbh) return 0;

    const rate = product_data.hospital_fee_support_rates.find(r => ageToUse >= r.ageMin && ageToUse <= r.ageMax)?.rate || 0;
    const premiumRaw = (stbh / 100) * rate;
    return roundDownTo1000(premiumRaw);
}
// ===================================================================================
// ===== MODULE: UI (Rendering, DOM manipulation, Event Listeners)
// ===================================================================================

function renderUI() {
    // Enforce Trọn Tâm An: remove & hide supplementary-insured section
    try {
      const mainProductKey = document.getElementById('main-product')?.value || appState.mainProduct.key || '';
      const isTTA = (mainProductKey === 'TRON_TAM_AN');
      const cont = document.getElementById('supplementary-insured-container');
      const btn  = document.getElementById('add-supp-insured-btn');
      if (isTTA) {
        if (cont) cont.innerHTML = '';
        if (Array.isArray(appState.supplementaryPersons)) appState.supplementaryPersons = [];
        if (cont) cont.classList.add('hidden');
        if (btn)  btn.classList.add('hidden');
      } else {
        if (cont) cont.classList.remove('hidden');
        if (btn)  btn.classList.remove('hidden');
      }
      if (typeof updateSupplementaryAddButtonState === 'function') updateSupplementaryAddButtonState();
    } catch (e) {}

    clearAllErrors();
    const allPersons = [appState.mainPerson, ...appState.supplementaryPersons].filter(p => p);

    allPersons.forEach(p => {
        if (p.container) {
            p.container.querySelector('.age-span').textContent = p.age;
            p.container.querySelector('.risk-group-span').textContent = p.riskGroup > 0 ? p.riskGroup : '...';
        }
    });

    renderMainProductSection(appState.mainPerson, appState.mainProduct.key);
    
    allPersons.forEach(p => {
        const suppContainer = p.isMain
            ? document.querySelector('#main-supp-container .supplementary-products-container')
            : p.container.querySelector('.supplementary-products-container');
        if (suppContainer) {
            renderSupplementaryProductsForPerson(p, appState.mainProduct.key, appState.fees.baseMain, suppContainer);
        }
    });
    
    const isValid = runAllValidations(appState);

    const fees = appState.fees;
    const summaryTotalEl = document.getElementById('summary-total');
    const mainFeeEl = document.getElementById('main-insured-main-fee');
    const extraFeeEl = document.getElementById('main-insured-extra-fee');
    const suppFeeEl = document.getElementById('summary-supp-fee');

    if (!isValid) {
        if (summaryTotalEl) summaryTotalEl.textContent = "0";
        if (mainFeeEl) mainFeeEl.textContent = "0";
        if (extraFeeEl) extraFeeEl.textContent = "0";
        if (suppFeeEl) suppFeeEl.textContent = "0";
        updateMainProductFeeDisplay(0, 0);
        if (window.renderSection6V2) window.renderSection6V2();
        return;
    }
    
    if (summaryTotalEl) summaryTotalEl.textContent = formatDisplayCurrency(fees.total);
    if (mainFeeEl) mainFeeEl.textContent = formatDisplayCurrency(fees.baseMain);
    if (extraFeeEl) extraFeeEl.textContent = formatDisplayCurrency(fees.extra);
    if (suppFeeEl) suppFeeEl.textContent = formatDisplayCurrency(fees.totalSupp);

    updateMainProductFeeDisplay(fees.baseMain, fees.extra);
    updatePaymentFrequencyOptions(fees.baseMain);
    updateSummaryUI(fees);
    if (window.renderSection6V2) window.renderSection6V2();
}

let lastRenderedProductKey = null;
let lastRenderedAge = null;
function renderMainProductSection(customer, mainProductKey) {
    const mainProductSelect = document.getElementById('main-product');

    document.querySelectorAll('#main-product option').forEach(option => {
        const productKey = option.value;
        if (!productKey) return;
        let isEligible = true;
        const { age, daysFromBirth, gender, riskGroup } = customer;
        const PUL_MUL = ['PUL_TRON_DOI', 'PUL_15_NAM', 'PUL_5_NAM', 'KHOE_BINH_AN', 'VUNG_TUONG_LAI'];
        if (PUL_MUL.includes(productKey)) {
            isEligible = (daysFromBirth >= 30) && (age <= 70);
        } else if (productKey === 'TRON_TAM_AN') {
            const withinAge = (gender === 'Nam') ? (age >= 12 && age <= 60) : (age >= 28 && age <= 60);
            isEligible = withinAge && (riskGroup !== 4) && (riskGroup !== 0);
        } else if (productKey === 'AN_BINH_UU_VIET') {
            isEligible = (gender === 'Nam' ? age >= 12 : age >= 28) && (age <= 65);
        }
        option.disabled = !isEligible;
        option.classList.toggle('hidden', !isEligible);
    });
    
    if (mainProductSelect.options[mainProductSelect.selectedIndex]?.disabled) {
        mainProductSelect.value = "";
        mainProductKey = "";
    }
    
    if (lastRenderedProductKey === mainProductKey && lastRenderedAge === customer.age) return;
    lastRenderedProductKey = mainProductKey;
    lastRenderedAge = customer.age;

    const container = document.getElementById('main-product-options');
    let currentStbh = document.getElementById('main-stbh')?.value || '';
    let currentPremium = document.getElementById('main-premium-input')?.value || '';
    let currentPaymentTerm = document.getElementById('payment-term')?.value || '';
    let currentExtra = document.getElementById('extra-premium-input')?.value || '';
    
    container.innerHTML = '';
    if (!mainProductKey) return;
    
    let optionsHtml = '';
    if (mainProductKey === 'TRON_TAM_AN') {
      optionsHtml = `
        <div>
          <label for="main-stbh" class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH)</label>
          <input type="text" id="main-stbh" class="form-input bg-gray-100" value="100.000.000" disabled>
        </div>
        <div>
          <p class="text-sm text-gray-600 mt-1">Thời hạn đóng phí: 10 năm (bằng thời hạn hợp đồng). Thời gian bảo vệ: 10 năm.</p>
        </div>`;
    } else if (mainProductKey === 'AN_BINH_UU_VIET') {
      optionsHtml = `
        <div>
          <label for="main-stbh" class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH) <span class="text-red-600">*</span></label>
          <input type="text" id="main-stbh" class="form-input" value="${currentStbh}" placeholder="VD: 1.000.000.000">
        </div>`;
      let termOptions = '';
      if (customer.age <= 55) termOptions += '<option value="15">15 năm</option>';
      if (customer.age <= 60) termOptions += '<option value="10">10 năm</option>';
      if (customer.age <= 65) termOptions += '<option value="5">5 năm</option>';
      if (!termOptions) termOptions = '<option value="" disabled>Không có kỳ hạn phù hợp</option>';
      optionsHtml += `
        <div>
          <label for="abuv-term" class="font-medium text-gray-700 block mb-1">Thời hạn đóng phí <span class="text-red-600">*</span></label>
          <select id="abuv-term" class="form-select"><option value="" selected>-- Chọn --</option>${termOptions}</select>
          <p class="text-sm text-gray-500 mt-1">Thời hạn đóng phí bằng thời hạn hợp đồng.</p>
        </div>`;
    } else if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI', 'PUL_TRON_DOI', 'PUL_15_NAM', 'PUL_5_NAM'].includes(mainProductKey)) {
      optionsHtml = `
        <div>
          <label for="main-stbh" class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH) <span class="text-red-600">*</span></label>
          <input type="text" id="main-stbh" class="form-input" value="${currentStbh}" placeholder="VD: 1.000.000.000">
        </div>`;
      if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI'].includes(mainProductKey)) {
        optionsHtml += `
          <div>
            <label for="main-premium-input" class="font-medium text-gray-700 block mb-1">Phí sản phẩm chính</label>
            <input type="text" id="main-premium-input" class="form-input" value="${currentPremium}" placeholder="Nhập phí">
            <div id="mul-fee-range" class="text-sm text-gray-500 mt-1"></div>
          </div>`;
      }
      optionsHtml += `
        <div>
          <label for="payment-term" class="font-medium text-gray-700 block mb-1">Thời gian đóng phí (năm) <span class="text-red-600">*</span></label>
          <input type="number" id="payment-term" class="form-input" value="${currentPaymentTerm}" placeholder="VD: 20" min="${mainProductKey === 'PUL_5_NAM' ? 5 : mainProductKey === 'PUL_15_NAM' ? 15 : 4}" max="${100 - customer.age - 1}">
          <div id="payment-term-hint" class="text-sm text-gray-500 mt-1"></div>
        </div>`;
      optionsHtml += `
        <div>
          <label for="extra-premium-input" class="font-medium text-gray-700 block mb-1">Phí đóng thêm</label>
          <input type="text" id="extra-premium-input" class="form-input" value="${currentExtra || ''}" placeholder="VD: 10.000.000">
          <div class="text-sm text-gray-500 mt-1">Tối đa ${CONFIG.EXTRA_PREMIUM_MAX_FACTOR} lần phí chính.</div>
        </div>`;
    }
    
    container.innerHTML = optionsHtml;
    
    if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI', 'PUL_TRON_DOI', 'PUL_15_NAM', 'PUL_5_NAM'].includes(mainProductKey)) {
      setPaymentTermHint(mainProductKey, customer.age);
    }
    attachTermListenersForTargetAge();
}


function renderSupplementaryProductsForPerson(customer, mainProductKey, mainPremium, container) {
    const { age, riskGroup, daysFromBirth } = customer;
    
    const isBaseProduct = ['PUL_TRON_DOI', 'PUL_15_NAM', 'PUL_5_NAM', 'KHOE_BINH_AN', 'VUNG_TUONG_LAI', 'AN_BINH_UU_VIET', 'TRON_TAM_AN'].includes(mainProductKey);
    const isTTA = mainProductKey === 'TRON_TAM_AN';

    CONFIG.supplementaryProducts.forEach(prod => {
        const section = container.querySelector(`.${prod.id}-section`);
        if (!section) return;

        const isEligible = isBaseProduct
            && daysFromBirth >= 30
            && age >= 0 && age <= prod.maxEntryAge
            && (prod.id !== 'health_scl' || (riskGroup !== 4 && riskGroup !== 0))
            && (!isTTA || prod.id === 'health_scl');

        section.classList.toggle('hidden', !isEligible);
        const checkbox = section.querySelector(`.${prod.id}-checkbox`);
        
        if (!isEligible) checkbox.checked = false;
        
        checkbox.disabled = !isEligible;
        
        const options = section.querySelector('.product-options');
        options.classList.toggle('hidden', !checkbox.checked);
        
        const fee = appState.fees.byPerson[customer.id]?.suppDetails?.[prod.id] || 0;
        const feeDisplay = section.querySelector('.fee-display');
        if(feeDisplay) feeDisplay.textContent = fee > 0 ? `Phí: ${formatCurrency(fee)}` : '';
    });
    
    const sclSection = container.querySelector('.health_scl-section');
    if (sclSection && !sclSection.classList.contains('hidden')) {
        const programSelect = sclSection.querySelector('.health-scl-program');
        if (isTTA) {
            Array.from(programSelect.options).forEach(opt => opt.disabled = false);
        } else {
            programSelect.querySelectorAll('option').forEach(opt => {
                if (opt.value === '') return;
                if (mainPremium >= 15000000) opt.disabled = false;
                else if (mainPremium >= 10000000) opt.disabled = !['co_ban', 'nang_cao', 'toan_dien'].includes(opt.value);
                else if (mainPremium >= 5000000) opt.disabled = !['co_ban', 'nang_cao'].includes(opt.value);
                else opt.disabled = true;
            });
            if (programSelect.options[programSelect.selectedIndex]?.disabled) {
                programSelect.value = '';
            }
        }
    }
}



function updateSummaryUI(fees) {
  const f = fees || { baseMain:0, extra:0, totalSupp:0, total:0 };
  const fmt = (n)=> formatDisplayCurrency(Math.round((Number(n)||0)/1000)*1000);
  // Primary figures
  const totalEl = document.getElementById('summary-total');
  const mainEl  = document.getElementById('main-insured-main-fee');
  const extraEl = document.getElementById('main-insured-extra-fee');
  const suppEl  = document.getElementById('summary-supp-fee');
  if (totalEl) totalEl.textContent = fmt(f.total);
  if (mainEl)  mainEl.textContent  = fmt(f.baseMain);
  if (extraEl) extraEl.textContent = fmt(f.extra);
  if (suppEl)  suppEl.textContent  = fmt(f.totalSupp);

  // Frequency breakdown
  const freqSel = document.getElementById('payment-frequency');
  const freqBox = document.getElementById('frequency-breakdown');
  const v = freqSel ? freqSel.value : 'year';
  const periods = v==='half' ? 2 : (v==='quarter' ? 4 : 1);
  const factor  = periods===2 ? 1.02 : (periods===4 ? 1.04 : 1); // only riders

  if (freqBox) freqBox.classList.toggle('hidden', periods===1);

  // Main & extra are baseline — no factor
  const perMain  = periods===1 ? 0 : Math.round((f.baseMain||0)/periods/1000)*1000;
  const perExtra = periods===1 ? 0 : Math.round((f.extra||0)/periods/1000)*1000;
  // Riders factor
  const perSupp  = periods===1 ? 0 : Math.round(((f.totalSupp||0)*factor)/periods/1000)*1000;

  const perTotal = periods===1 ? 0 : (perMain + perExtra + perSupp);
  const annualEq = periods===1 ? f.total : (perTotal * periods);
  const diff     = annualEq - f.total;

  const set = (id, val)=>{ const el=document.getElementById(id); if(el) el.textContent=fmt(val); };
  set('freq-main', perMain);
  set('freq-extra', perExtra);
  set('freq-supp-total', perSupp);
  set('freq-total-period', perTotal);
  set('freq-total-year', f.total);
  set('freq-diff', diff);
}


function updateMainProductFeeDisplay(basePremium, extraPremium) {
    const el = document.getElementById('main-product-fee-display');
    if (!el) return;
    if (basePremium <= 0 && extraPremium <= 0) {
      el.textContent = '';
      return;
    }
    if (extraPremium > 0) {
      el.innerHTML = `Phí SP chính: ${formatCurrency(basePremium)} | Phí đóng thêm: ${formatCurrency(extraPremium)} | Tổng: ${formatCurrency(basePremium + extraPremium)}`;
    } else {
      el.textContent = `Phí SP chính: ${formatCurrency(basePremium)}`;
    }
}

function updatePaymentFrequencyOptions(baseMainAnnual) {
    const sel = document.getElementById('payment-frequency');
    if (!sel) return;
    const optHalf = sel.querySelector('option[value="half"]');
    const optQuarter = sel.querySelector('option[value="quarter"]');
    
    const allowHalf = baseMainAnnual >= CONFIG.PAYMENT_FREQUENCY_THRESHOLDS.half;
    const allowQuarter = baseMainAnnual >= CONFIG.PAYMENT_FREQUENCY_THRESHOLDS.quarter;

    if (optHalf) {
      optHalf.disabled = !allowHalf;
      optHalf.classList.toggle('hidden', !allowHalf);
    }
    if (optQuarter) {
      optQuarter.disabled = !allowQuarter;
      optQuarter.classList.toggle('hidden', !allowQuarter);
    }
  
    if (sel.value === 'quarter' && !allowQuarter) {
      sel.value = allowHalf ? 'half' : 'year';
    } else if (sel.value === 'half' && !allowHalf) {
      sel.value = 'year';
    }
}


// ===================================================================================
// ===== MODULE: VALIDATION
// ===================================================================================
function runAllValidations(state) {
    let isValid = true;
    if (!validateMainPersonInputs(state.mainPerson)) isValid = false;
    if (!validateMainProductInputs(state.mainPerson, state.mainProduct, state.fees.baseMain)) isValid = false;
    if (!validateExtraPremium(state.fees.baseMain, state.mainProduct.extraPremium)) isValid = false;
    
    const allPersons = [state.mainPerson, ...state.supplementaryPersons].filter(p=>p);
    let totalHospitalSupportStbh = 0;
    
    allPersons.forEach(p => {
        if (!p.isMain && !validateDobField(p.container.querySelector('.dob-input'))) isValid = false;
        
        for (const prodId in p.supplements) {
            if (!validateSupplementaryProduct(p, prodId, state.fees.baseMain, totalHospitalSupportStbh)) {
                isValid = false;
            }
            if (prodId === 'hospital_support') {
                 totalHospitalSupportStbh += p.supplements[prodId].stbh;
            }
        }
    });

    return isValid;
}

function validateMainPersonInputs(person) {
    const container = person.container;
    if (!container) return true;
    let ok = true;
    const nameInput = container.querySelector('.name-input');
    const dobInput = container.querySelector('.dob-input');
    const occupationInput = container.querySelector('.occupation-input');
    if (nameInput && !(nameInput.value || '').trim()) {
        setFieldError(nameInput, 'Vui lòng nhập họ và tên'); ok = false;
    } else { clearFieldError(nameInput); }
    if (!validateDobField(dobInput)) ok = false;
    const group = parseInt(occupationInput?.dataset.group, 10);
    if (occupationInput && (!group || group < 1 || group > 4)) {
        setFieldError(occupationInput, 'Chọn nghề nghiệp từ danh sách'); ok = false;
    } else { clearFieldError(occupationInput); }

    return ok;
}

function validateMainProductInputs(customer, productInfo, basePremium) {
    let ok = true;
    const { key: mainProduct, stbh, premium } = productInfo;
    const stbhEl = document.getElementById('main-stbh');
    
    if (mainProduct && mainProduct !== 'TRON_TAM_AN') {
        if (stbh > 0 && stbh < CONFIG.MAIN_PRODUCT_MIN_STBH) {
            setFieldError(stbhEl, `STBH tối thiểu ${formatCurrency(CONFIG.MAIN_PRODUCT_MIN_STBH, '')}`);
            ok = false;
        } else { clearFieldError(stbhEl); }

        if (basePremium > 0 && basePremium < CONFIG.MAIN_PRODUCT_MIN_PREMIUM) {
            setFieldError(document.getElementById('main-stbh') || document.getElementById('main-premium-input'), `Phí chính tối thiểu ${formatCurrency(CONFIG.MAIN_PRODUCT_MIN_PREMIUM, '')}`);
            ok = false;
        }
    }

    if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI'].includes(mainProduct)) {
        const feeInput = document.getElementById('main-premium-input');
        const factorRow = product_data.mul_factors.find(f => customer.age >= f.ageMin && customer.age <= f.ageMax);
        const rangeEl = document.getElementById('mul-fee-range');
        if (factorRow && stbh > 0) {
            const minFee = stbh / factorRow.maxFactor;
            const maxFee = stbh / factorRow.minFactor;
            if(rangeEl) rangeEl.textContent = `Phí hợp lệ từ ${formatCurrency(minFee, '')} đến ${formatCurrency(maxFee, '')}.`;
            if (premium > 0 && (premium < minFee || premium > maxFee)) {
                setFieldError(feeInput, 'Phí không hợp lệ');
                ok = false;
            } else { clearFieldError(feeInput);}
        } else if (rangeEl) {
            rangeEl.textContent = '';
        }
    }

    return ok;
}

function validateExtraPremium(basePremium, extraPremium) {
    const el = document.getElementById('extra-premium-input');
    if (!el) return true;
    if (extraPremium > 0 && basePremium > 0 && extraPremium > CONFIG.EXTRA_PREMIUM_MAX_FACTOR * basePremium) {
        setFieldError(el, `Tối đa ${CONFIG.EXTRA_PREMIUM_MAX_FACTOR} lần phí chính`);
        return false;
    }
    clearFieldError(el);
    return true;
}

function validateSupplementaryProduct(person, prodId, mainPremium, totalHospitalSupportStbh) {
    const config = CONFIG.supplementaryProducts.find(p => p.id === prodId);
    if (!config) return true;
    const supplementData = person.supplements[prodId];
    if (!supplementData) return true;
    const stbh = supplementData.stbh;
    const suppContainer = person.isMain ? document.getElementById('main-supp-container') : person.container;
    const section = suppContainer.querySelector(`.${prodId}-section`);
    const input = section.querySelector(`.${prodId}-stbh`);
    if(!input) return true;
    
    let ok = true;
    if (config.minStbh && stbh > 0 && stbh < config.minStbh) {
        setFieldError(input, `Tối thiểu ${formatCurrency(config.minStbh, '')}`); ok = false;
    } else if (config.maxStbh && stbh > config.maxStbh) {
        setFieldError(input, `Tối đa ${formatCurrency(config.maxStbh, '')}`); ok = false;
    } else if (prodId === 'hospital_support' && stbh > 0) {
        const validationEl = section.querySelector('.hospital-support-validation');
        const maxSupportTotal = Math.floor(mainPremium / 4000000) * 100000;
        const maxByAge = person.age >= 18 ? config.maxStbhByAge.from18 : config.maxStbhByAge.under18;
        const remaining = maxSupportTotal - totalHospitalSupportStbh;
        if(validationEl) validationEl.textContent = `Tối đa: ${formatCurrency(Math.min(maxByAge, remaining), 'đ/ngày')}. Phải là bội số của 100.000.`;

        if (stbh % CONFIG.HOSPITAL_SUPPORT_STBH_MULTIPLE !== 0) {
             setFieldError(input, `Là bội số của ${formatCurrency(CONFIG.HOSPITAL_SUPPORT_STBH_MULTIPLE, '')}`); ok = false;
        } else if (stbh > maxByAge || stbh > remaining) {
             setFieldError(input, 'Vượt quá giới hạn cho phép'); ok = false;
        } else { clearFieldError(input); }
    } else {
        clearFieldError(input);
    }

    return ok;
}

function validateDobField(input) {
    if (!input) return false;
    const v = (input.value || '').trim();
    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(v)) {
        setFieldError(input, 'Nhập DD/MM/YYYY'); return false;
    }
    const [dd, mm, yyyy] = v.split('/').map(n => parseInt(n, 10));
    const d = new Date(yyyy, mm - 1, dd);
    const valid = d.getFullYear() === yyyy && d.getMonth() === (mm - 1) && d.getDate() === dd && d <= CONFIG.REFERENCE_DATE;
    if (!valid) {
        setFieldError(input, 'Ngày sinh không hợp lệ'); return false;
    }
    clearFieldError(input);
    return true;
}

function setFieldError(input, message) { 
    if (!input) return;
    let err = input.parentElement.querySelector('.field-error');
    if (!err) {
      err = document.createElement('p');
      err.className = 'field-error text-sm text-red-600 mt-1';
      input.parentElement.appendChild(err);
    }
    err.textContent = message || '';
    input.classList.toggle('border-red-500', !!message);
}

function clearFieldError(input) { setFieldError(input, ''); }

function clearAllErrors() { 
    document.querySelectorAll('.field-error').forEach(el => el.textContent = '');
    document.querySelectorAll('.border-red-500').forEach(el => el.classList.remove('border-red-500'));
    const errorMsgEl = document.getElementById('error-message');
    if(errorMsgEl) errorMsgEl.textContent = '';
}
// ===================================================================================
// ===== MODULE: INITIALIZATION & EVENT BINDING
// ===================================================================================

document.addEventListener('DOMContentLoaded', () => {
    initState();
    initPerson(appState.mainPerson.container, true);
    initSupplementaryButton();
    initSummaryModal();
    attachGlobalListeners();
    updateSupplementaryAddButtonState();
    runWorkflow();
    if (window.MDP3) MDP3.init();
});

function runWorkflow() {
    updateStateFromUI();
    const calculatedFees = performCalculations(appState);
    appState.fees = calculatedFees;
    renderUI();
}

function attachGlobalListeners() {
    document.body.addEventListener('change', (e) => {
        if (e.target.id === 'main-product') {
            lastRenderedProductKey = null; // Force re-render of options
            if (window.MDP3) MDP3.reset();
        }
        runWorkflow();
        if (window.MDP3 && !e.target.closest('#mdp3-section')) {
            const resetSelectors = ['.dob-input', '.health-scl-checkbox', '.bhn-checkbox'];
            if (resetSelectors.some(sel => e.target.matches(sel))) { MDP3.resetIfEnabled(); }
        }
    });

    document.body.addEventListener('input', (e) => {
        if (e.target.matches('input[type="text"]') && !e.target.classList.contains('dob-input') && !e.target.classList.contains('name-input') && !e.target.classList.contains('occupation-input')) {
            formatNumberInput(e.target);
        }
        runWorkflow();
    });

    document.body.addEventListener('focusout', (e) => {
        if (e.target.matches('input[type="text"]')) {
            roundInputToThousand(e.target);
            if (e.target.classList.contains('dob-input')) validateDobField(e.target);
            runWorkflow();
        }
    }, true);
}

function initPerson(container, isMain = false) {
    if (!container) return;
    initDateFormatter(container.querySelector('.dob-input'));
    initOccupationAutocomplete(container.querySelector('.occupation-input'), container);
    
    const suppProductsContainer = isMain 
        ? document.querySelector('#main-supp-container .supplementary-products-container') 
        : container.querySelector('.supplementary-products-container');
    
    if (suppProductsContainer) {
        suppProductsContainer.innerHTML = generateSupplementaryProductsHtml();
    }
}

function initSupplementaryButton() {
    document.getElementById('add-supp-insured-btn').addEventListener('click', () => {
        if (appState.supplementaryPersons.length >= CONFIG.MAX_SUPPLEMENTARY_INSURED) return;
        
        const count = document.querySelectorAll('#supplementary-insured-container .person-container').length + 1;
        const personId = `supp${Date.now()}`;
        
        const newPersonDiv = document.createElement('div');
        newPersonDiv.id = `person-container-${personId}`;
        newPersonDiv.className = 'person-container space-y-6 bg-gray-100 p-4 rounded-lg mt-4';
        newPersonDiv.innerHTML = generateSupplementaryPersonHtml(personId, count);

        document.getElementById('supplementary-insured-container').appendChild(newPersonDiv);

        newPersonDiv.querySelector('.remove-supp-btn').addEventListener('click', () => {
            newPersonDiv.remove();
            if (window.MDP3) MDP3.reset();
            updateSupplementaryAddButtonState();
            runWorkflow();
        });
        
        initPerson(newPersonDiv, false);
        updateSupplementaryAddButtonState();
        if (window.MDP3) MDP3.reset();
        runWorkflow();
    });
}

function generateSupplementaryPersonHtml(personId, count) {
  return `
    <button class="w-full text-right text-sm text-red-600 font-semibold remove-supp-btn">Xóa NĐBH này</button>
    <h3 class="text-lg font-bold text-gray-700 mb-2 border-t pt-4">NĐBH Bổ Sung ${count}</h3>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <label for="name-${personId}" class="font-medium text-gray-700 block mb-1">Họ và Tên</label>
        <input type="text" id="name-${personId}" class="form-input name-input" placeholder="Trần Thị B">
      </div>
      <div>
        <label for="dob-${personId}" class="font-medium text-gray-700 block mb-1">Ngày sinh</label>
        <input type="text" id="dob-${personId}" class="form-input dob-input" placeholder="DD/MM/YYYY">
      </div>
      <div>
        <label for="gender-${personId}" class="font-medium text-gray-700 block mb-1">Giới tính</label>
        <select id="gender-${personId}" class="form-select gender-select">
          <option value="Nam">Nam</option>
          <option value="Nữ">Nữ</option>
        </select>
      </div>
      <div class="flex items-end space-x-4">
        <p class="text-lg">Tuổi: <span id="age-${personId}" class="font-bold text-aia-red age-span">0</span></p>
      </div>
      <div class="relative">
        <label for="occupation-input-${personId}" class="font-medium text-gray-700 block mb-1">Nghề nghiệp</label>
        <input type="text" id="occupation-input-${personId}" class="form-input occupation-input" placeholder="Gõ để tìm nghề nghiệp...">
        <div class="occupation-autocomplete absolute z-10 w-full bg-white border border-gray-300 rounded-md mt-1 hidden max-h-60 overflow-y-auto"></div>
      </div>
      <div class="flex items-end space-x-4">
        <p class="text-lg">Nhóm nghề: <span id="risk-group-${personId}" class="font-bold text-aia-red risk-group-span">...</span></p>
      </div>
    </div>
    <div class="mt-4">
      <h4 class="text-md font-semibold text-gray-800 mb-2">Sản phẩm bổ sung cho người này</h4>
      <div class="supplementary-products-container space-y-6"></div>
    </div>
  `;
}

function updateSupplementaryAddButtonState() {
    const btn = document.getElementById('add-supp-insured-btn');
    if (!btn) return;
    const mainProductKey = document.getElementById('main-product')?.value || '';
    const count = document.querySelectorAll('#supplementary-insured-container .person-container').length;
    const isTTA = (mainProductKey === 'TRON_TAM_AN');
    const disabled = isTTA || (count >= CONFIG.MAX_SUPPLEMENTARY_INSURED);
    btn.disabled = disabled;
    btn.classList.toggle('opacity-50', disabled);
    btn.classList.toggle('cursor-not-allowed', disabled);
    btn.classList.toggle('hidden', isTTA);
}

function generateSupplementaryProductsHtml() {
    return CONFIG.supplementaryProducts.map(prod => {
        let optionsHtml = '';
        if (prod.id === 'health_scl') {
            optionsHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label class="font-medium text-gray-700 block mb-1">Quyền lợi chính</label>
                <select class="form-select health-scl-program">
                  <option value="">-- Chọn --</option>
                  <option value="co_ban">Cơ bản</option>
                  <option value="nang_cao">Nâng cao</option>
                  <option value="toan_dien">Toàn diện</option>
                  <option value="hoan_hao">Hoàn hảo</option>
                </select>
              </div>
              <div>
                <label class="font-medium text-gray-700 block mb-1">Phạm vi địa lý</label>
                <select class="form-select health-scl-scope"><option value="main_vn">Việt Nam</option><option value="main_global">Nước ngoài</option></select>
              </div>
            </div>
            <div>
              <span class="font-medium text-gray-700 block mb-2">Quyền lợi tùy chọn:</span>
              <div class="space-y-2">
                <label class="flex items-center space-x-3 cursor-pointer"><input type="checkbox" class="form-checkbox health-scl-outpatient"> <span>Điều trị ngoại trú</span></label>
                <label class="flex items-center space-x-3 cursor-pointer"><input type="checkbox" class="form-checkbox health-scl-dental"> <span>Chăm sóc nha khoa</span></label>
              </div>
            </div>`;
        } else {
            optionsHtml = `<div><label class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH)</label><input type="text" class="form-input ${prod.id}-stbh" placeholder="Nhập STBH"></div><p class="hospital-support-validation text-sm text-gray-500 mt-1"></p>`;
        }
        return `
        <div class="product-section ${prod.id}-section hidden">
          <label class="flex items-center space-x-3 cursor-pointer">
            <input type="checkbox" class="form-checkbox ${prod.id}-checkbox"> <span class="text-lg font-medium text-gray-800">${prod.name}</span>
          </label>
          <div class="product-options hidden mt-3 pl-8 space-y-3 border-l-2 border-gray-200">
            ${optionsHtml}
            <div class="text-right font-semibold text-aia-red fee-display min-h-[1.5rem]"></div>
          </div>
        </div>`;
    }).join('');
}

function initOccupationAutocomplete(input, container) {
  if (!input) return;
  const autocompleteContainer = container.querySelector('.occupation-autocomplete');
  const riskGroupSpan = container.querySelector('.risk-group-span');

  const applyOccupation = (occ) => {
    input.value = occ.name;
    input.dataset.group = occ.group;
    if (riskGroupSpan) riskGroupSpan.textContent = occ.group;
    clearFieldError(input);
    autocompleteContainer.classList.add('hidden');
    runWorkflow();
  };

  const renderList = (filtered) => {
    autocompleteContainer.innerHTML = '';
    if (filtered.length === 0) {
      autocompleteContainer.classList.add('hidden');
      return;
    }
    filtered.forEach(occ => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.textContent = occ.name;
      item.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        applyOccupation(occ);
      });
      autocompleteContainer.appendChild(item);
    });
    autocompleteContainer.classList.remove('hidden');
  };

  input.addEventListener('input', () => {
    const value = input.value.trim().toLowerCase();
    if (value.length < 2) {
      autocompleteContainer.classList.add('hidden');
      return;
    }
    const filtered = product_data.occupations
      .filter(o => o.group > 0 && o.name.toLowerCase().includes(value));
    renderList(filtered);
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      autocompleteContainer.classList.add('hidden');
      const typed = (input.value || '').trim().toLowerCase();
      const match = product_data.occupations.find(o => o.group > 0 && o.name.toLowerCase() === typed);
      if (!match) {
        input.dataset.group = '';
        if(riskGroupSpan) riskGroupSpan.textContent = '...';
      }
      runWorkflow();
    }, 200);
  });

  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      autocompleteContainer.classList.add('hidden');
    }
  });
}

function initDateFormatter(input) {
  if (!input) return;
  input.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    if (value.length > 2) value = value.slice(0, 2) + '/' + value.slice(2);
    if (value.length > 5) value = value.slice(0, 5) + '/' + value.slice(5, 9);
    e.target.value = value.slice(0, 10);
  });
}

function roundInputToThousand(input) {
  if (!input || input.classList.contains('dob-input') || input.classList.contains('occupation-input') || input.classList.contains('name-input')) return;
  const raw = parseFormattedNumber(input.value || '');
  if (!raw) { input.value = ''; return; }

  if (input.classList.contains('hospital-support-stbh')) {
      const rounded = Math.round(raw / CONFIG.HOSPITAL_SUPPORT_STBH_MULTIPLE) * CONFIG.HOSPITAL_SUPPORT_STBH_MULTIPLE;
      input.value = rounded.toLocaleString('vi-VN');
  } else {
      const rounded = roundDownTo1000(raw);
      input.value = rounded.toLocaleString('vi-VN');
  }
}

function formatNumberInput(input) {
  if (!input || !input.value) return;
  let value = input.value.replace(/[.,]/g, '');
  if (!isNaN(value) && value.length > 0) {
    input.value = parseInt(value, 10).toLocaleString('vi-VN');
  } else if (input.value !== '') {
    input.value = '';
  }
}

function initSummaryModal() {
  const modal = document.getElementById('summary-modal');
  document.getElementById('view-summary-btn').addEventListener('click', generateSummaryTable);
  document.getElementById('close-summary-modal-btn').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  updateTargetAge();

  document.getElementById('main-product').addEventListener('change', updateTargetAge);
  const mainDobInput = document.querySelector('#main-person-container .dob-input');
  if (mainDobInput) {
    mainDobInput.addEventListener('input', updateTargetAge);
  }
}

function updateTargetAge() {
    const mainPersonInfo = collectPersonData(document.getElementById('main-person-container'), true);
    const mainProduct = document.getElementById('main-product').value;
    const targetAgeInput = document.getElementById('target-age-input');

    if (!targetAgeInput || !mainPersonInfo || !mainPersonInfo.age) return;

    if (mainProduct === 'TRON_TAM_AN') {
        targetAgeInput.value = mainPersonInfo.age + 10;
        targetAgeInput.disabled = true;
    } else if (mainProduct === 'AN_BINH_UU_VIET') {
        const term = parseInt(document.getElementById('abuv-term')?.value || '15', 10);
        targetAgeInput.value = mainPersonInfo.age + term;
        targetAgeInput.disabled = true;
    } else {
        const paymentTerm = parseInt(document.getElementById('payment-term')?.value, 10) || 0;
        targetAgeInput.disabled = false;
        const minAge = mainPersonInfo.age + paymentTerm;
        targetAgeInput.min = minAge;
        if (!targetAgeInput.value || parseInt(targetAgeInput.value, 10) < minAge) {
            targetAgeInput.value = minAge;
        }
    }
}

function attachTermListenersForTargetAge() {
  const abuvTermSelect = document.getElementById('abuv-term');
  if (abuvTermSelect && !abuvTermSelect._boundTargetAge) {
    abuvTermSelect.addEventListener('change', updateTargetAge);
    abuvTermSelect._boundTargetAge = true;
  }
  const paymentTermInput = document.getElementById('payment-term');
  if (paymentTermInput && !paymentTermInput._boundTargetAge) {
    paymentTermInput.addEventListener('change', updateTargetAge);
    paymentTermInput._boundTargetAge = true;
  }
}

function setPaymentTermHint(mainProduct, age) {
  const hintEl = document.getElementById('payment-term-hint');
  if (!hintEl) return;
  const { max } = getPaymentTermBounds(age);
  let min = 4;
  if (mainProduct === 'PUL_5_NAM') min = 5;
  if (mainProduct === 'PUL_15_NAM') min = 15;
  hintEl.textContent = `Nhập từ ${min} đến ${max} năm`;
}

function getProductLabel(key) {
  return CONFIG.MAIN_PRODUCTS[key]?.name || key || '';
}

function getHealthSclStbhByProgram(program) {
    return CONFIG.supplementaryProducts.find(p=>p.id==='health_scl').stbhByProgram[program] || 0;
}

// ===================================================================================
// ===== ORIGINAL COMPLEX FUNCTIONS & EXTERNAL MODULES (FULLY INTEGRATED)
// ===================================================================================
// NOTE: These functions are preserved from your original file to ensure functionality.

function getCustomerInfo(container, isMain = false) {
  const dobInput = container.querySelector('.dob-input');
  const genderSelect = container.querySelector('.gender-select');
  const occupationInput = container.querySelector('.occupation-input');
  const nameInput = container.querySelector('.name-input');
  let age = 0;
  let daysFromBirth = 0;
  const dobStr = dobInput ? dobInput.value : '';
  if (dobStr && /^\d{2}\/\d{2}\/\d{4}$/.test(dobStr)) {
    const [dd, mm, yyyy] = dobStr.split('/').map(n => parseInt(n, 10));
    const birthDate = new Date(yyyy, mm - 1, dd);
    const isValidDate = birthDate.getFullYear() === yyyy && (birthDate.getMonth() === (mm - 1)) && birthDate.getDate() === dd;
    if (isValidDate && birthDate <= CONFIG.REFERENCE_DATE) {
      const diffMs = CONFIG.REFERENCE_DATE - birthDate;
      daysFromBirth = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      age = CONFIG.REFERENCE_DATE.getFullYear() - birthDate.getFullYear();
      const m = CONFIG.REFERENCE_DATE.getMonth() - birthDate.getMonth();
      if (m < 0 || (m === 0 && CONFIG.REFERENCE_DATE.getDate() < birthDate.getDate())) {
        age--;
      }
    }
  }
  const info = {
    age,
    daysFromBirth,
    gender: genderSelect ? genderSelect.value : 'Nam',
    riskGroup: occupationInput ? parseInt(occupationInput.dataset.group, 10) || 0 : 0,
    container,
    name: nameInput ? nameInput.value : (isMain ? 'NĐBH Chính' : 'NĐBH Bổ sung')
  };
  if (isMain) {
    info.mainProduct = document.getElementById('main-product').value;
  }
  return info;
}

// This is the full, original generateSummaryTable function from your file
// replaced generateSummaryTable


function buildSupplementSummaryRows(personInfo, container, targetAge) {
  if (!container) return '';
  const rows = [];
  const name = sanitizeHtml(personInfo.name || '—');

  const sclSec = container.querySelector('.health-scl-section');
  if (sclSec && sclSec.querySelector('.health-scl-checkbox')?.checked) {
    const program = sclSec.querySelector('.health-scl-program')?.value || '';
    const programLabel = {co_ban:'Cơ bản', nang_cao:'Nâng cao', toan_dien:'Toàn diện', hoan_hao:'Hoàn hảo'}[program] || '';
    const stbh = getHealthSclStbhByProgram(program);
    const fee = calculateHealthSclPremium(personInfo, container);
    const years = Math.max(0, Math.min(targetAge, 75) - personInfo.age);
    if (fee > 0) {
      rows.push(`<tr><td class="p-2 border">${name}</td><td class="p-2 border">Sức khoẻ Bùng Gia Lực ${programLabel ? `- ${programLabel}`:''}</td><td class="p-2 border text-right">${formatCurrency(stbh)}</td><td class="p-2 border text-center">${years}</td><td class="p-2 border text-right">${formatCurrency(fee)}</td></tr>`);
    }
  }

  const bhnSec = container.querySelector('.bhn-section');
  if (bhnSec && bhnSec.querySelector('.bhn-checkbox')?.checked) {
    const stbh = parseFormattedNumber(bhnSec.querySelector('.bhn-stbh')?.value || '0');
    const fee = calculateBhnPremium(personInfo, container);
    const years = Math.max(0, Math.min(targetAge, 85) - personInfo.age);
    if (fee > 0) {
      rows.push(`<tr><td class="p-2 border">${name}</td><td class="p-2 border">Bệnh hiểm nghèo 2.0</td><td class="p-2 border text-right">${formatCurrency(stbh)}</td><td class="p-2 border text-center">${years}</td><td class="p-2 border text-right">${formatCurrency(fee)}</td></tr>`);
    }
  }

  const accSec = container.querySelector('.accident-section');
  if (accSec && accSec.querySelector('.accident-checkbox')?.checked) {
    const stbh = parseFormattedNumber(accSec.querySelector('.accident-stbh')?.value || '0');
    const fee = calculateAccidentPremium(personInfo, container);
    const years = Math.max(0, Math.min(targetAge, 65) - personInfo.age);
    if (fee > 0) {
      rows.push(`<tr><td class="p-2 border">${name}</td><td class="p-2 border">Bảo hiểm Tai nạn</td><td class="p-2 border text-right">${formatCurrency(stbh)}</td><td class="p-2 border text-center">${years}</td><td class="p-2 border text-right">${formatCurrency(fee)}</td></tr>`);
    }
  }

  const hsSec = container.querySelector('.hospital-support-section');
  if (hsSec && hsSec.querySelector('.hospital-support-checkbox')?.checked) {
    const stbh = parseFormattedNumber(hsSec.querySelector('.hospital-support-stbh')?.value || '0');
    const fee = calculateHospitalSupportPremium(personInfo, (window.lastSummaryPrem?.baseMainPremium)||0, container, 0);
    const years = Math.max(0, Math.min(targetAge, 65) - personInfo.age);
    if (fee > 0) {
      rows.push(`<tr><td class="p-2 border">${name}</td><td class="p-2 border">Hỗ trợ chi phí nằm viện (đ/ngày)</td><td class="p-2 border text-right">${formatCurrency(stbh)}</td><td class="p-2 border text-center">${years}</td><td class="p-2 border text-right">${formatCurrency(fee)}</td></tr>`);
    }
  }

  return rows.join('');
}
window.MDP3 = (function () {
    let selectedId = null;
    let lastSelectedId = null;

    function init() {
        renderSection();
        attachListeners();
    }

    function reset() {
        selectedId = null;
        const enableCb = document.getElementById('mdp3-enable');
        if (enableCb) enableCb.checked = false;
        const selContainer = document.getElementById('mdp3-select-container');
        if (selContainer) selContainer.innerHTML = '';
        const feeEl = document.getElementById('mdp3-fee-display');
        if (feeEl) feeEl.textContent = '';
    }
    
    function isEnabled() {
        const cb = document.getElementById('mdp3-enable');
        return !!(cb && cb.checked);
    }

    function resetIfEnabled() {
        if (isEnabled()) reset();
    }
    
    function renderSection() {
        const sec = document.getElementById('mdp3-section');
        if (!sec) return;
        const mainProduct = document.getElementById('main-product').value;

        if (mainProduct === 'TRON_TAM_AN') {
            reset();
            sec.classList.add('hidden');
            return;
        }
        sec.classList.remove('hidden');

        const container = document.getElementById('mdp3-radio-list');
        if (container && !document.getElementById('mdp3-enable')) {
            container.innerHTML = `
                <div class="flex items-center space-x-2 mb-3">
                    <input type="checkbox" id="mdp3-enable" class="form-checkbox">
                    <label for="mdp3-enable" class="text-gray-700 font-medium">Bật Miễn đóng phí 3.0</label>
                </div>
                <div id="mdp3-select-container"></div>
                <div id="mdp3-fee-display" class="text-right font-semibold text-aia-red min-h-[1.5rem] mt-2"></div>
            `;
        }
    }

    function renderSelect() {
        const selectContainer = document.getElementById('mdp3-select-container');
        if (!selectContainer) return;
        let html = `<select id="mdp3-person-select" class="form-select w-full mb-3"><option value="">-- Chọn người --</option>`;
        document.querySelectorAll('#supplementary-insured-container .person-container').forEach(cont => {
            const info = getCustomerInfo(cont, false);
            let label = info.name || 'NĐBH bổ sung';
            label += ` (tuổi ${info.age || "?"})`;
            let disabled = '';
            if (!info.age || info.age <= 0) {
                label += ' - Chưa đủ thông tin';
                disabled = 'disabled';
            } else if (info.age < 18 || info.age > 60) {
                label += ' - Không đủ điều kiện';
                disabled = 'disabled';
            }
            html += `<option value="${cont.id}" ${disabled}>${label}</option>`;
        });
        html += `<option value="other">Người khác</option></select><div id="mdp3-other-form" class="hidden mt-4 p-3 border rounded bg-gray-50"></div>`;
        selectContainer.innerHTML = html;
    }

    function attachListeners() {
        document.getElementById('main-product').addEventListener('change', () => {
            renderSection();
            reset();
        });
        document.body.addEventListener('change', function (e) {
            if (e.target.id === 'mdp3-enable') {
                if (e.target.checked) {
                    renderSelect();
                    if (lastSelectedId) {
                        const selEl = document.getElementById('mdp3-person-select');
                        if (selEl) {
                            const opt = selEl.querySelector(`option[value="${lastSelectedId}"]`);
                            if (opt && !opt.disabled) {
                                selEl.value = lastSelectedId;
                                selectedId = lastSelectedId;
                            }
                        }
                        if (lastSelectedId === 'other') {
                            const otherForm = document.getElementById('mdp3-other-form');
                            if(otherForm) {
                                otherForm.classList.remove('hidden');
                                if (!otherForm.innerHTML.trim()) {
                                    otherForm.innerHTML = `<div id="person-container-mdp3-other" class="person-container">${generateSupplementaryPersonHtmlForMdp3('mdp3-other', '—')}</div>`;
                                    initPerson(document.getElementById('person-container-mdp3-other'), false);
                                    const suppBlock = otherForm.querySelector('.supplementary-products-container')?.parentElement;
                                    if (suppBlock) suppBlock.style.display = 'none';
                                }
                            }
                        }
                    }
                    runWorkflow();
                } else {
                    const sel = document.getElementById('mdp3-select-container');
                    if (sel) sel.innerHTML = '';
                    selectedId = null;
                    runWorkflow();
                }
            }
            if (e.target.id === 'mdp3-person-select') {
                selectedId = e.target.value;
                lastSelectedId = selectedId || null;
                const otherForm = document.getElementById('mdp3-other-form');
                if (selectedId === 'other') {
                    otherForm.classList.remove('hidden');
                    if(!otherForm.innerHTML.trim()) {
                         otherForm.innerHTML = `<div id="person-container-mdp3-other" class="person-container">${generateSupplementaryPersonHtmlForMdp3('mdp3-other', '—')}</div>`;
                         initPerson(document.getElementById('person-container-mdp3-other'), false);
                         const suppBlock = otherForm.querySelector('.supplementary-products-container')?.parentElement;
                         if (suppBlock) suppBlock.style.display = 'none';
                    }
                } else {
                    otherForm.classList.add('hidden');
                }
                runWorkflow();
            }
        });
    }

    function getPremium() {
        const feeEl = document.getElementById('mdp3-fee-display');
        const enableCb = document.getElementById('mdp3-enable');
        if (!enableCb || !enableCb.checked || !selectedId || !window.personFees) {
            if(feeEl) feeEl.textContent = '';
            return 0;
        }
        let stbhBase = 0;
        for (let pid in window.personFees) {
            stbhBase += (window.personFees[pid].mainBase || 0) + (window.personFees[pid].supp || 0);
        }
        if (selectedId !== 'other' && window.personFees[selectedId]) {
            stbhBase -= window.personFees[selectedId].supp || 0;
        }
        let age, gender;
        if (selectedId === 'other') {
            const form = document.getElementById('person-container-mdp3-other');
            if (!form) return 0;
            const info = getCustomerInfo(form, false);
            age = info.age; gender = info.gender;
        } else {
            const container = document.getElementById(selectedId);
            if (!container) { reset(); return 0; }
            const info = getCustomerInfo(container, false);
            age = info.age; gender = info.gender;
        }
        if(!age || age <= 0) {
            if (feeEl) feeEl.textContent = `STBH: ${formatCurrency(stbhBase)} | Phí: —`;
            return 0;
        }
        const rate = product_data.mdp3_rates.find(r => age >= r.ageMin && age <= r.ageMax)?.[gender === 'Nữ' ? 'nu' : 'nam'] || 0;
        const premium = roundDownTo1000((stbhBase / 1000) * rate);
        if (feeEl) {
            feeEl.textContent = premium > 0
                ? `STBH: ${formatCurrency(stbhBase)} | Phí: ${formatCurrency(premium)}`
                : `STBH: ${formatCurrency(stbhBase)} | Phí: —`;
        }
        return premium;
    }
    
    function generateSupplementaryPersonHtmlForMdp3() {
      return `
        <h3 class="text-lg font-bold text-gray-700 mb-2 border-t pt-4">Người được miễn đóng phí</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div><label class="font-medium text-gray-700 block mb-1">Họ và Tên</label><input type="text" class="form-input name-input"></div>
          <div><label class="font-medium text-gray-700 block mb-1">Ngày sinh</label><input type="text" class="form-input dob-input" placeholder="DD/MM/YYYY"></div>
          <div><label class="font-medium text-gray-700 block mb-1">Giới tính</label><select class="form-select gender-select"><option value="Nam">Nam</option><option value="Nữ">Nữ</option></select></div>
          <div class="flex items-end space-x-4"><p class="text-lg">Tuổi: <span class="font-bold text-aia-red age-span">0</span></p></div>
        </div>`;
    }

    return { init, isEnabled, resetIfEnabled, getSelectedId: () => selectedId, getPremium, reset };
})();


(function(){
  try{window.renderSection6V2 && window.renderSection6V2();}catch(e){}
})();

(function() {
  const $$ = (sel, root=document) => root.querySelector(sel);
  const toInt = (s) => {
    if (s == null) return 0;
    const n = String(s).replace(/[^\d]/g, "");
    return n ? parseInt(n, 10) : 0;
  };
  const fmt = (n) => {
    try {
      return Number(n).toLocaleString("vi-VN");
    } catch (e) {
      const s = String(n);
      return s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    }
  };
  const setText = (id, val) => {
    const el = typeof id === "string" ? $$(id) : id;
    if (!el) return;
    const target = fmt(Math.max(0, Math.round(val)));
    if (el.textContent !== target) el.textContent = target;
  };
})();






function generateSummaryTable() {
  const modal = document.getElementById('summary-modal');
  const container = document.getElementById('summary-content-container');
  if (!container) return;
  container.innerHTML = '';

  const fmt = (n)=> formatDisplayCurrency(Math.round((Number(n)||0)/1000)*1000);
  const num = (s)=> parseFormattedNumber(s||0);

  // periods & factor
  const getPeriods = () => {
    const v = document.getElementById('payment-frequency')?.value || 'year';
    return v === 'half' ? 2 : (v === 'quarter' ? 4 : 1);
  };
  const periods = getPeriods();
  const isAnnual = periods===1;
  const suppFactor = periods===2 ? 1.02 : (periods===4 ? 1.04 : 1);

  const riderMaxAge = (key) => ({
    health_scl: 74,
    bhn: 85,
    accident: 64,
    hospital_support: 64,
    mdp3: 64
  }[key] ?? 64);

  try {
    const mainCont = document.getElementById('main-person-container');
    const mainInfo = collectPersonData(mainCont, true);
    const targetAgeEl = document.getElementById('target-age-input');
    let targetAge = parseInt(targetAgeEl?.value, 10);

    // Resolve payment term by product
    const productKey = document.getElementById('main-product')?.value || appState.mainProduct.key || '';
    let paymentTerm = appState.mainProduct.paymentTerm || 0;
    if (productKey === 'TRON_TAM_AN') paymentTerm = 10;
    if (productKey === 'AN_BINH_UU_VIET') {
      // expect UI select has value 5/10/15
      const val = parseInt(document.getElementById('abuv-term')?.value || '10', 10);
      paymentTerm = val;
    }
    // Fallback minimal rules for other products
    const minTermByProduct = (key)=>{
      if (key==='PUL_5_NAM') return 5;
      if (key==='PUL_15_NAM') return 15;
      if (key.startsWith('PUL') || key.startsWith('MUL')) return 4;
      return 4;
    };
    if (!paymentTerm || paymentTerm < minTermByProduct(productKey)) paymentTerm = minTermByProduct(productKey);

    // Validate & auto-hint target age
    const minTargetAge = mainInfo.age + paymentTerm - 1;
    const hint = document.getElementById('target-age-hint');
    if (hint) hint.textContent = `Phải ≥ ${minTargetAge} (tuổi hiện tại ${mainInfo.age} + thời hạn đóng phí ${paymentTerm} − 1)`;
    if (!targetAge || targetAge < minTargetAge) {
      throw new Error(`Tuổi mục tiêu phải ≥ ${minTargetAge}.`);
    }

    // Build persons
    const others = Array.from(document.querySelectorAll('#supplementary-insured-container .person-container')).map(c => collectPersonData(c,false));
    const persons = [mainInfo, ...others];

    // ===== Part 1 =====
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

    for (const p of persons){
      let rows = [];
      let personPer=0, personEq=0, personBase=0, personDiff=0;

      const pushRow = (personName, prodName, stbhDisplay, years, baseAnnual, isRider)=>{
        const perPeriod = isAnnual ? 0 : Math.round((isRider ? (baseAnnual*suppFactor) : baseAnnual)/periods/1000)*1000;
        const annualEq = isAnnual ? 0 : perPeriod*periods;
        const diff = isAnnual ? 0 : (annualEq - baseAnnual);

        personPer += perPeriod; personEq += annualEq; personBase += baseAnnual; personDiff += diff;

        let row = `<tr>
          <td class="p-2 border">${sanitizeHtml(personName)}</td>
          <td class="p-2 border">${sanitizeHtml(prodName)}</td>
          <td class="p-2 border text-right">${stbhDisplay||'—'}</td>
          <td class="p-2 border text-center">${years||'—'}</td>`;
        if (!isAnnual) row += `<td class="p-2 border text-right">${fmt(perPeriod)}</td><td class="p-2 border text-right">${fmt(annualEq)}</td>`;
        row += `<td class="p-2 border text-right">${fmt(baseAnnual)}</td>`;
        if (!isAnnual) row += `<td class="p-2 border text-right">${diff? `<span class="text-red-600 font-bold">${fmt(diff)}</span>` : '0'}</td>`;
        row += `</tr>`;
        rows.push(row);
      };

      // Main product (no factor)
      if (p.isMain && appState.mainProduct.key){
        const baseAnnual = calculateMainPremium(p, appState.mainProduct);
        const stbh = formatDisplayCurrency(appState.mainProduct.stbh||0);
        const name = 'Sản phẩm chính';
        pushRow(p.name, name, stbh, paymentTerm||'—', baseAnnual, false);
      }
      // Extra premium (no factor)
      if (p.isMain && (appState.mainProduct.extraPremium||0)>0){
        pushRow(p.name, 'Phí đóng thêm', '—', paymentTerm||'—', appState.mainProduct.extraPremium||0, false);
      }
      // Riders
      if (p.supplements && p.supplements.health_scl){
        const scl = p.supplements.health_scl;
        const program = scl.program || '';
        const scope = scl.scope || 'main_vn';
        const outpatient = !!scl.outpatient;
        const dental = !!scl.dental;
        const programName = ({co_ban:'Cơ bản',nang_cao:'Nâng cao',toan_dien:'Toàn diện',hoan_hao:'Hoàn hảo'})[program] || '';
        const prodName = `Sức khoẻ Bùng Gia Lực – ${programName} (${scope==='main_global'?'Nước ngoài':'Trong nước'}${outpatient?', Ngoại trú':''}${dental?', Nha khoa':''})`;
        const baseAnnual = calculateHealthSclPremium(p, appState.fees.baseMain, 0);
        const stbh = getHealthSclStbhByProgram(program) || 0;
        const years = Math.max(0, Math.min(targetAge, riderMaxAge('health_scl')) - p.age + 1);
        pushRow(p.name, prodName, formatDisplayCurrency(stbh), years, baseAnnual, true);
      }
      if (p.supplements && p.supplements.bhn){
        const stbh = num(p.supplements.bhn.stbh);
        const baseAnnual = calculateBhnPremium(p, appState.fees.baseMain, 0);
        const years = Math.max(0, Math.min(targetAge, riderMaxAge('bhn')) - p.age + 1);
        pushRow(p.name, 'Bệnh Hiểm Nghèo 2.0', formatDisplayCurrency(stbh), years, baseAnnual, true);
      }
      if (p.supplements && p.supplements.accident){
        const stbh = num(p.supplements.accident.stbh);
        const baseAnnual = calculateAccidentPremium(p, appState.fees.baseMain, 0);
        const years = Math.max(0, Math.min(targetAge, riderMaxAge('accident')) - p.age + 1);
        pushRow(p.name, 'Bảo hiểm Tai nạn', formatDisplayCurrency(stbh), years, baseAnnual, true);
      }
      if (p.supplements && p.supplements.hospital_support){
        const stbh = num(p.supplements.hospital_support.stbh);
        const baseAnnual = calculateHospitalSupportPremium(p, appState.fees.baseMain, 0);
        const years = Math.max(0, Math.min(targetAge, riderMaxAge('hospital_support')) - p.age + 1);
        pushRow(p.name, 'Hỗ trợ chi phí nằm viện', formatDisplayCurrency(stbh), years, baseAnnual, true);
      }
      // MDP3 as rider on selected person
      if (window.MDP3 && MDP3.isEnabled && MDP3.isEnabled()){
        const selId = (MDP3.getSelectedId && MDP3.getSelectedId());
        const fee = (MDP3.getPremium && MDP3.getPremium()) || 0;
        if (fee>0 && (String(selId) === String(p.id))){
          const years = Math.max(0, Math.min(targetAge, riderMaxAge('mdp3')) - p.age + 1);
          pushRow(p.name, 'Miễn đóng phí 3.0', '—', years, fee, true);
        }
      }

      // TOTAL row goes FIRST
      const totalRow = (()=>{
        let tr = `<tr class="bg-gray-50 font-semibold">
          <td class="p-2 border">${sanitizeHtml(p.name|| (p.isMain?'NĐBH Chính':'NĐBH Bổ sung'))}</td>
          <td class="p-2 border">Tổng</td>
          <td class="p-2 border">—</td>
          <td class="p-2 border">—</td>`;
        if (!isAnnual) tr += `<td class="p-2 border text-right">${fmt(personPer)}</td><td class="p-2 border text-right">${fmt(personEq)}</td>`;
        tr += `<td class="p-2 border text-right">${fmt(personBase)}</td>`;
        if (!isAnnual) tr += `<td class="p-2 border text-right">${personDiff ? `<span class="text-red-600 font-bold">${fmt(personDiff)}</span>` : '0'}</td>`;
        tr += `</tr>`;
        return tr;
      })();

      html += totalRow + rows.join('');
    }

    html += `</tbody></table>`;

    // ===== Part 2 =====
    html += `<h3 class="text-lg font-bold mt-6 mb-2">Phần 2 · Bảng phí</h3>`;

    const mdpEnabled = !!(window.MDP3 && MDP3.isEnabled && MDP3.isEnabled());
    const mdpTargetId = mdpEnabled ? (MDP3.getSelectedId && MDP3.getSelectedId()) : null;
    const mdpFeeYear = mdpEnabled ? (MDP3.getPremium && MDP3.getPremium()) : 0;

    // We'll precompute rows to decide hide extra column
    let rowsData = [];
    for (let year=1; mainInfo.age + year -1 <= targetAge; year++){
      const ageNow = mainInfo.age + year -1;
      const inPayTerm = (year <= paymentTerm);
      const baseAnnualMain = (inPayTerm && appState.mainProduct.key) ? calculateMainPremium(mainInfo, appState.mainProduct, ageNow) : 0;
      const extra = inPayTerm ? (appState.mainProduct.extraPremium||0) : 0;

      const perPersonSuppPeriod = [];
      const perPersonSuppYear = [];

      for (let pi=0; pi<persons.length; pi++){
        const p = persons[pi];
        let y = ageNow + (p.isMain ? 0 : (p.age - mainInfo.age));
        let sPeriod=0, sYear=0;

        if (p.supplements && p.supplements.health_scl){
          const base = calculateHealthSclPremium(p, baseAnnualMain, 0, y);
          sYear += base;
          sPeriod += isAnnual ? 0 : Math.round(base * suppFactor / periods /1000)*1000;
        }
        if (p.supplements && p.supplements.bhn){
          const base = calculateBhnPremium(p, baseAnnualMain, 0, y);
          sYear += base;
          sPeriod += isAnnual ? 0 : Math.round(base * suppFactor / periods /1000)*1000;
        }
        if (p.supplements && p.supplements.accident){
          const base = calculateAccidentPremium(p, baseAnnualMain, 0, y);
          sYear += base;
          sPeriod += isAnnual ? 0 : Math.round(base * suppFactor / periods /1000)*1000;
        }
        if (p.supplements && p.supplements.hospital_support){
          const base = calculateHospitalSupportPremium(p, baseAnnualMain, 0, y);
          sYear += base;
          sPeriod += isAnnual ? 0 : Math.round(base * suppFactor / periods /1000)*1000;
        }
        if (mdpEnabled && mdpTargetId === p.id){
          const fee = (y <= 64) ? mdpFeeYear : 0;
          sYear += fee;
          sPeriod += isAnnual ? 0 : Math.round(fee*suppFactor/periods/1000)*1000;
        }
        perPersonSuppPeriod.push(isAnnual?0:sPeriod);
        perPersonSuppYear.push(sYear);
      }

      const totalSuppPeriod = perPersonSuppPeriod.reduce((a,b)=>a+b,0);
      const totalSuppYear = perPersonSuppYear.reduce((a,b)=>a+b,0);
      const totalPeriod = isAnnual ? 0 : (Math.round(baseAnnualMain/periods/1000)*1000 + Math.round(extra/periods/1000)*1000 + totalSuppPeriod);
      const totalYear = baseAnnualMain + extra + totalSuppYear;
      const diff = isAnnual ? 0 : ((totalPeriod*periods) - totalYear);

      rowsData.push({
        year, ageNow, baseAnnualMain, extra, perPersonSuppPeriod, perPersonSuppYear, totalPeriod, totalYear, diff
      });
    }

    const extraAllZero = rowsData.every(r=> r.extra === 0);

    // Render Part 2
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
        sumSuppCols[i] += (isAnnual ? r.perPersonSuppYear[i] : r.perPersonSuppPeriod[i]);
      }
      if (!isAnnual){ sumTotalPeriod += r.totalPeriod; sumDiff += r.diff; }
      sumTotalYear += r.totalYear;

      html += `<tr>
        <td class="p-2 border text-center">${r.year}</td>
        <td class="p-2 border text-center">${r.ageNow}</td>
        <td class="p-2 border text-right">${fmt(r.baseAnnualMain)}</td>`;
      if (!extraAllZero) html += `<td class="p-2 border text-right">${fmt(r.extra)}</td>`;
      for (let i=0;i<persons.length;i++){
        const val = (isAnnual ? r.perPersonSuppYear[i] : r.perPersonSuppPeriod[i]);
        html += `<td class="p-2 border text-right">${fmt(val)}</td>`;
      }
      if (!isAnnual) html += `<td class="p-2 border text-right">${fmt(r.totalPeriod)}</td>`;
      html += `<td class="p-2 border text-right">${fmt(r.totalYear)}</td>`;
      if (!isAnnual){ const diffHtml2 = r.diff ? `<span class="text-red-600 font-bold">${fmt(r.diff)}</span>` : '0'; html += `<td class="p-2 border text-right">${diffHtml2}</td>`; }
      html += `</tr>`;
    }

    html += `<tr class="font-semibold bg-gray-50">
      <td class="p-2 border">Tổng cộng</td>
      <td class="p-2 border"></td>
      <td class="p-2 border text-right">${fmt(sumMain)}</td>`;
    if (!extraAllZero) html += `<td class="p-2 border text-right">${fmt(sumExtra)}</td>`;
    for (let i=0;i<persons.length;i++){ html += `<td class="p-2 border text-right">${fmt(sumSuppCols[i])}</td>`; }
    if (!isAnnual) html += `<td class="p-2 border text-right">${fmt(sumTotalPeriod)}</td>`;
    html += `<td class="p-2 border text-right">${fmt(sumTotalYear)}</td>`;
    if (!isAnnual) html += `<td class="p-2 border text-right">${fmt(sumDiff)}</td>`;
    html += `</tr></tbody></table>`;

    // Export buttons
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
    const htmlBtn = document.getElementById('export-html-btn');
    const pdfBtn = document.getElementById('export-pdf-btn');
    if (htmlBtn) htmlBtn.addEventListener('click', ()=>{
      const {html, ymd} = buildDoc();
      const blob = new Blob([html], {type:'text/html;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `bang-tom-tat_${ymd}.html`;
      document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(url); a.remove();}, 0);
    });
    if (pdfBtn) pdfBtn.addEventListener('click', ()=>{
      const {html} = buildDoc();
      const iframe = document.createElement('iframe');
      Object.assign(iframe.style,{position:'fixed', right:0, bottom:0, width:0, height:0, border:0});
      document.body.appendChild(iframe);
      iframe.onload = ()=> setTimeout(()=>{ try{ iframe.contentWindow.focus(); iframe.contentWindow.print(); } finally { setTimeout(()=>iframe.remove(), 3000); } }, 200);
      iframe.srcdoc = html;
    });

  } catch (e) {
    container.innerHTML = `<div class="text-red-600">${sanitizeHtml(e.message||String(e))}</div>`;
    document.getElementById('summary-modal')?.classList.remove('hidden');
  }
}





function renderSuppList(){
  const box = document.getElementById('supp-insured-summaries');
  if (!box) return;
  const persons = [];
  const main = collectPersonData(document.getElementById('main-person-container'), true);
  if (main) persons.push(main);
  document.querySelectorAll('#supplementary-insured-container .person-container').forEach(c=>{
    const p = collectPersonData(c,false); if (p) persons.push(p);
  });
  const feesMap = (window.personFees)||{};
  box.innerHTML = persons.map(p=>{
    const f = feesMap[p.id] || { total: 0 };
    return `<div class="flex justify-between"><span>${sanitizeHtml(p.name||'Người')}</span><span>${formatDisplayCurrency(f.total||0)}</span></div>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('toggle-supp-list-btn');
  if (btn && !btn._bound) {
    btn.addEventListener('click', ()=>{
      const list = document.getElementById('supp-insured-summaries');
      if (!list) return;
      list.classList.toggle('hidden');
      if (!list.classList.contains('hidden')) renderSuppList();
    });
    btn._bound = true;
  }
});


// Fallback binding in case initSummaryModal wasn't called yet
document.addEventListener('DOMContentLoaded', ()=>{
  const btn = document.getElementById('view-summary-btn');
  if (btn && !btn.dataset._bound2){
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      try { generateSummaryTable(); }
      catch(err){
        const c = document.getElementById('summary-content-container');
        if (c) c.innerHTML = `<div class="text-red-600">${sanitizeHtml(err && err.message ? err.message : String(err))}</div>`;
        const m = document.getElementById('summary-modal'); if (m) m.classList.remove('hidden');
      }
    });
    btn.dataset._bound2 = '1';
  }
});
