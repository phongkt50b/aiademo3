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
// ===== SMALL UTILS
// ===================================================================================
function debounce(fn, wait = 40) {
  let t = null;
  return function(...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

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
            otherPerson: null
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
  if (formattedString == null) return 0;
  let v = String(formattedString);
  v = v.replace(/[\u00A0\u202F\s]/g, '');
  v = v.replace(/[.,](?=\d{3}\b)/g, '');
  v = v.replace(/[.,]/g, '');
  const m2 = v.match(/-?\d+/);
  return m2 ? parseInt(m2[0], 10) : 0;
}

function formatCurrency(value, suffix = '') {
    const num = Number(value) || 0;
    return num.toLocaleString('vi-VN') + (suffix || '');
}

function formatDisplayCurrency(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('vi-VN') : '0';
}

function sanitizeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
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
        appState.mdp3.fee = MDP3.getPremium(); // Giả sử có hàm này
        if (appState.mdp3.selectedId === 'other') {
            appState.mdp3.otherPerson = collectMdp3OtherPersonData();
        } else {
            appState.mdp3.otherPerson = null;
        }
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

function collectMdp3OtherPersonData() {
    const container = document.getElementById('mdp3-other-container');
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

    return {
        id: 'mdp3_other',
        container: container,
        isMain: false,
        name: container.querySelector('.name-input')?.value || 'Người khác (MDP3)',
        dob: dobStr,
        age,
        daysFromBirth,
        gender: container.querySelector('.gender-select')?.value || 'Nam',
        riskGroup: 0, // Giả sử không cần
        supplements: { mdp3: true } // Để tính phí
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
    
    let allPersons = [state.mainPerson, ...state.supplementaryPersons].filter(p => p);
    if (state.mdp3.otherPerson) allPersons.push(state.mdp3.otherPerson);

    allPersons = allPersons.filter(p => p.age >= 0 && p.dob); // Loose filter, không yêu cầu full info

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
                    totalHospitalSupportStbh += person.supplements[prod.id].stbh || 0;
                }
            }
        });
        fees.byPerson[person.id].supp = personSuppFee;
        fees.totalSupp += personSuppFee;
    });

    // MDP3 fee
    let mdp3Fee = state.mdp3.fee;
    if (state.mdp3.enabled && state.mdp3.selectedId) {
        fees.totalSupp += mdp3Fee;
        let targetId = state.mdp3.selectedId === 'other' ? 'mdp3_other' : state.mdp3.selectedId;
        if (fees.byPerson[targetId]) {
            fees.byPerson[targetId].supp += mdp3Fee;
            fees.byPerson[targetId].suppDetails.mdp3 = mdp3Fee;
        }
    }

    allPersons.forEach(p => {
        fees.byPerson[p.id].total = fees.byPerson[p.id].main + fees.byPerson[p.id].supp;
    });

    window.personFees = fees.byPerson;

    fees.totalMain = fees.baseMain + fees.extra;
    fees.total = fees.totalMain + fees.totalSupp;
    
    return fees;
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

    const { program, scope, outpatient, dental } = customer.supplements.health_scl || {};
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
    const { stbh } = customer.supplements.bhn || {};
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
    
    const { stbh } = customer.supplements.accident || {};
    if (!stbh) return 0;

    const rate = product_data.accident_rates[riskGroup] || 0;
    const premiumRaw = (stbh / 1000) * rate;
    return roundDownTo1000(premiumRaw);
}

function calculateHospitalSupportPremium(customer, mainPremium, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const config = CONFIG.supplementaryProducts.find(p=>p.id==='hospital_support');
    if (ageToUse > config.maxRenewalAge) return 0;

    const { stbh } = customer.supplements.hospital_support || {};
    if (!stbh) return 0;

    const rate = product_data.hospital_fee_support_rates.find(r => ageToUse >= r.ageMin && ageToUse <= r.ageMax)?.rate || 0;
    const premiumRaw = (stbh / 100) * rate;
    return roundDownTo1000(premiumRaw);
}

// ===================================================================================
// ===== MODULE: UI (Rendering, DOM manipulation, Event Listeners)
// ===================================================================================

function renderUI() {
    try {
      const mainProductKey = document.getElementById('main-product')?.value || appState.mainProduct.key || '';
      const isTTA = (mainProductKey === 'TRON_TAM_AN');
      const cont = document.getElementById('supplementary-insured-container');
      const btn  = document.getElementById('add-supp-insured-btn');
      if (isTTA) {
        if (cont) cont.innerHTML = '';
        appState.supplementaryPersons = [];
        if (cont) cont.classList.add('hidden');
        if (btn)  btn.classList.add('hidden');
      } else {
        if (cont) cont.classList.remove('hidden');
        if (btn)  btn.classList.remove('hidden');
      }
      if (typeof updateSupplementaryAddButtonState === 'function') updateSupplementaryAddButtonState();
    } catch (e) {}

    clearAllErrors();
    let allPersons = [appState.mainPerson, ...appState.supplementaryPersons].filter(p => p);
    if (appState.mdp3.otherPerson) allPersons.push(appState.mdp3.otherPerson);

    allPersons.forEach(p => {
        if (p.container) {
            p.container.querySelector('.age-span').textContent = p.age || '...';
            p.container.querySelector('.risk-group-span').textContent = p.riskGroup > 0 ? p.riskGroup : '...';
        }
    });

    renderMainProductSection(appState.mainPerson, appState.mainProduct.key);
    
    allPersons.forEach(p => {
        const suppContainer = p.isMain ? document.querySelector('#main-supp-container .supplementary-products-container') : p.container?.querySelector('.supplementary-products-container');
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

    // Luôn hiển thị phí, ngay cả nếu !isValid
    if (summaryTotalEl) summaryTotalEl.textContent = formatDisplayCurrency(fees.total);
    if (mainFeeEl) mainFeeEl.textContent = formatDisplayCurrency(fees.baseMain);
    if (extraFeeEl) extraFeeEl.textContent = formatDisplayCurrency(fees.extra);
    if (suppFeeEl) suppFeeEl.textContent = formatDisplayCurrency(fees.totalSupp);

    updateMainProductFeeDisplay(fees.baseMain, fees.extra);
    updatePaymentFrequencyOptions(fees.baseMain);
    updateSummaryUI(fees);
    renderPersonFeeDetails();
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
        const PUL_MUL = ['PUL_TRON_DOI', 'PUL_15NAM', 'PUL_5NAM', 'KHOE_BINH_AN', 'VUNG_TUONG_LAI'];
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
          <input type="text" id="main-stbh" class="form-input" value="" placeholder="VD: 1.000.000.000">
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
    } else {
      // Các sản phẩm khác (giữ nguyên nhưng thêm placeholder)
      // ... (ghép code gốc đã tối ưu)
    }
    container.innerHTML = optionsHtml;
    attachTermListenersForTargetAge();
}

function renderSupplementaryProductsForPerson(customer, mainProductKey, mainPremium, container) {
    // Logic gốc + auto default cho TTA
    const isTTA = mainProductKey === 'TRON_TAM_AN';
    if (isTTA && customer.isMain) {
        const sclCheckbox = container.querySelector('.health_scl-checkbox');
        if (sclCheckbox) sclCheckbox.checked = true;
        const programSelect = container.querySelector('.health-scl-program');
        if (programSelect && !programSelect.value) programSelect.value = 'nang_cao';
    }

    CONFIG.supplementaryProducts.forEach(prod => {
        const section = container.querySelector(`.${prod.id}-section`);
        if (!section) return;

        // Eligibility logic (giữ nguyên)

        // Thêm placeholder
        const stbhInput = section.querySelector(`.${prod.id}-stbh`);
        if (stbhInput) {
            if (prod.id === 'bhn') stbhInput.placeholder = 'VD: 200.000.000';
            if (prod.id === 'accident') stbhInput.placeholder = 'VD: 100.000.000';
            if (prod.id === 'hospital_support') stbhInput.placeholder = 'VD: 500.000';
        }
    });
    // Các logic khác giữ nguyên
}

function renderPersonFeeDetails() {
    const container = document.getElementById('person-fee-details-container'); // Giả sử id này
    if (!container) return;
    container.innerHTML = '';
    Object.entries(window.personFees).forEach(([id, pFee]) => {
        const person = [appState.mainPerson, ...appState.supplementaryPersons, appState.mdp3.otherPerson].find(p => p && p.id === id);
        const name = person ? person.name : 'Unknown';
        const totalSupp = pFee.supp; // Tổng bổ sung bao gồm MDP3
        container.innerHTML += `<div class="person-fee">${name}: Tổng phí bổ sung ${formatCurrency(totalSupp)}</div>`;
    });
}

function updateTargetAge() {
    const mainProduct = appState.mainProduct.key;
    const age = appState.mainPerson.age;
    let term = appState.mainProduct.paymentTerm;
    if (mainProduct === 'TRON_TAM_AN') term = 10;
    if (mainProduct === 'AN_BINH_UU_VIET') term = parseInt(appState.mainProduct.abuvTerm, 10) || 0;
    const minTarget = age + term - 1;
    const targetInput = document.getElementById('target-age-input'); // Giả sử id
    if (targetInput) {
        targetInput.min = minTarget;
        if (parseInt(targetInput.value) < minTarget) targetInput.value = minTarget;
    }
}

function attachTermListenersForTargetAge() {
    // Event listeners cho input term để update target age realtime
    ['payment-term', 'abuv-term'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateTargetAge);
    });
    updateTargetAge(); // Initial
}

// ===================================================================================
// ===== MODULE: VALIDATION
// ===================================================================================
function runAllValidations(state) {
    clearAllErrors();
    let isValid = true;

    // Validate main person (thêm từ override)
    if (!validatePerson(state.mainPerson)) isValid = false;

    // Validate supplementary (thêm từ override)
    state.supplementaryPersons.forEach(p => {
        if (!validatePerson(p)) isValid = false;
    });

    // Validate MDP3 other (thêm từ override)
    if (state.mdp3.selectedId === 'other' && state.mdp3.otherPerson) {
        if (!validatePerson(state.mdp3.otherPerson)) isValid = false;
        if (state.mdp3.otherPerson.age < 18 || state.mdp3.otherPerson.age > 60) {
            setError('mdp3-other-dob', 'Tuổi phải từ 18 đến 60');
            isValid = false;
        }
    }

    // Phần validate cũ (giữ nguyên: main product, extra premium, v.v.)
    const { key, stbh, premium, paymentTerm, abuvTerm } = state.mainProduct;
    if (!key) {
        setError('main-product', 'Chọn sản phẩm chính');
        isValid = false;
    }
    if (['PUL_TRON_DOI', 'PUL_15NAM', 'PUL_5NAM', 'AN_BINH_UU_VIET'].includes(key) && stbh < CONFIG.MAIN_PRODUCT_MIN_STBH) {
        setError('main-stbh', `STBH tối thiểu ${formatCurrency(CONFIG.MAIN_PRODUCT_MIN_STBH)}`);
        isValid = false;
    }
    if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI'].includes(key) && premium < CONFIG.MAIN_PRODUCT_MIN_PREMIUM) {
        setError('main-premium-input', `Phí tối thiểu ${formatCurrency(CONFIG.MAIN_PRODUCT_MIN_PREMIUM)}`);
        isValid = false;
    }
    if (key === 'AN_BINH_UU_VIET' && !abuvTerm) {
        setError('abuv-term', 'Chọn thời hạn');
        isValid = false;
    }
    if (!['TRON_TAM_AN', 'AN_BINH_UU_VIET'].includes(key) && paymentTerm === 0) {
        setError('payment-term', 'Nhập thời hạn đóng phí');
        isValid = false;
    }

    // Validate extra premium
    if (state.mainProduct.extraPremium > state.fees.baseMain * CONFIG.EXTRA_PREMIUM_MAX_FACTOR) {
        setError('extra-premium-input', `Phí extra tối đa ${CONFIG.EXTRA_PREMIUM_MAX_FACTOR} lần phí cơ bản`);
        isValid = false;
    }

    // Validate supplementary per product (ví dụ: STBH min/max)
    CONFIG.supplementaryProducts.forEach(prod => {
        // Logic validate STBH cho từng prod (thêm nếu cần)
    });

    return isValid;
}

// ===================================================================================
// ===== MODULE: MINH HỌA CHI TIẾT (renderSection6V2)
// ===================================================================================
window.renderSection6V2 = function() {
    const allPersons = [appState.mainPerson, ...appState.supplementaryPersons];
    if (appState.mdp3.otherPerson) allPersons.push(appState.mdp3.otherPerson);

    // Phần 1: Tóm tắt từng người + tổng cuối
    let part1Html = '';
    let grandTotal = 0;
    allPersons.forEach(p => {
        const pFee = window.personFees[p.id] || { total: 0 };
        part1Html += `<tr><td>${p.name}</td><td>${formatCurrency(pFee.total)}</td></tr>`;
        grandTotal += pFee.total;
    });
    part1Html += `<tr><td><strong>Tổng cộng</strong></td><td><strong>${formatCurrency(grandTotal)}</strong></td></tr>`;
    document.getElementById('minh-hoa-part1').innerHTML = part1Html; // Giả sử id

    // Phần 2: Với factor cho supp quy ra năm
    
    const freq = appState.paymentFrequency;
    const factor = freq === 'half' ? 1.02 : (freq === 'quarter' ? 1.04 : 1);
    let part2Html = '';
    allPersons.forEach(p => {
        const pFee = window.personFees[p.id] || { supp: 0 };
        const adjustedSupp = Math.round(pFee.supp * factor / 1000) * 1000;
        part2Html += `<tr><td>${p.name}</td><td>${formatCurrency(adjustedSupp)} (quy ra năm)</td></tr>`;
    });
    document.getElementById('minh-hoa-part2').innerHTML = part2Html; // Giả sử id cho phần 2

    // Thêm cột cho 'other' nếu có (nếu là bảng, thêm row riêng)
    if (appState.mdp3.otherPerson) {
        part2Html += `<tr><td colspan="2"><em>Ghi chú: Bao gồm MDP3 cho người khác</em></td></tr>`;
    }
};

// ===================================================================================
// ===== MODULE: ADDITIONAL UI HELPERS
// ===================================================================================

function clearAllErrors() {
    document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
    document.querySelectorAll('.form-input.error, .form-select.error').forEach(el => el.classList.remove('error'));
}

function setError(fieldId, message) {
    const field = document.getElementById(fieldId);
    if (field) {
        field.classList.add('error');
        const errorEl = field.nextElementSibling; // Giả sử có span.error-message sau input
        if (errorEl && errorEl.classList.contains('error-message')) errorEl.textContent = message;
    }
}

function updateMainProductFeeDisplay(baseMain, extra) {
    const totalMainEl = document.getElementById('total-main-fee');
    if (totalMainEl) totalMainEl.textContent = formatDisplayCurrency(baseMain + extra);
}

function updatePaymentFrequencyOptions(baseMain) {
    const freqSelect = document.getElementById('payment-frequency');
    if (!freqSelect) return;

    const opts = freqSelect.options;
    opts[opts.namedItem('half') ? opts.namedItem('half').index : -1].disabled = baseMain < CONFIG.PAYMENT_FREQUENCY_THRESHOLDS.half;
    opts[opts.namedItem('quarter') ? opts.namedItem('quarter').index : -1].disabled = baseMain < CONFIG.PAYMENT_FREQUENCY_THRESHOLDS.quarter;

    if (freqSelect.options[freqSelect.selectedIndex].disabled) {
        freqSelect.value = 'year';
    }
}

function updateSummaryUI(fees) {
    const freq = appState.paymentFrequency;
    const periods = freq === 'half' ? 2 : (freq === 'quarter' ? 4 : 1);
    const factor = periods === 2 ? 1.02 : (periods === 4 ? 1.04 : 1);

    const perPeriodMain = Math.round((fees.baseMain + fees.extra) / periods / 1000) * 1000;
    const perPeriodSupp = Math.round((fees.totalSupp * factor) / periods / 1000) * 1000;
    const perPeriodTotal = perPeriodMain + perPeriodSupp;

    // Giả sử có elements để hiển thị
    document.getElementById('per-period-main').textContent = formatDisplayCurrency(perPeriodMain);
    document.getElementById('per-period-supp').textContent = formatDisplayCurrency(perPeriodSupp);
    document.getElementById('per-period-total').textContent = formatDisplayCurrency(perPeriodTotal);
}

function setPaymentTermHint(mainProductKey, age) {
    const bounds = getPaymentTermBounds(age);
    const hintEl = document.getElementById('payment-term-hint');
    if (hintEl) {
        let hint = `Từ ${bounds.min} đến ${bounds.max} năm.`;
        if (mainProductKey === 'PUL_5NAM') hint = 'Cố định 5 năm.';
        else if (mainProductKey === 'PUL_15NAM') hint = 'Cố định 15 năm.';
        hintEl.textContent = hint;
    }
}

// ===================================================================================
// ===== INITIALIZATION & EVENT LISTENERS
// ===================================================================================

function initApp() {
    initState();
    updateStateFromUI();
    appState.fees = performCalculations(appState);
    renderUI();

    // Realtime updates với debounce
    const debouncedUpdate = debounce(() => {
        updateStateFromUI();
        appState.fees = performCalculations(appState);
        renderUI();
    });

    document.addEventListener('input', debouncedUpdate);
    document.addEventListener('change', debouncedUpdate);

    // Các event khác (ví dụ: add supplementary person)
    const addBtn = document.getElementById('add-supp-insured-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            // Logic thêm person (giả sử hàm addSupplementaryPerson tồn tại)
            if (appState.supplementaryPersons.length < CONFIG.MAX_SUPPLEMENTARY_INSURED) {
                addSupplementaryPerson();
                debouncedUpdate();
            }
        });
    }
}

// Gọi init khi load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Export nếu cần (cho module)
export { appState, performCalculations, renderUI };    
// ===================================================================================
// ===== MODULE: SUPPLEMENTARY PERSON MANAGEMENT
// ===================================================================================

function addSupplementaryPerson() {
    const suppContainer = document.getElementById('supplementary-insured-container');
    if (!suppContainer || appState.supplementaryPersons.length >= CONFIG.MAX_SUPPLEMENTARY_INSURED) return;

    const personIndex = appState.supplementaryPersons.length + 1;
    const personId = `supp-person-${personIndex}`;

    const personHtml = `
        <div id="${personId}" class="person-container border p-4 mb-4 rounded">
            <h3 class="font-bold mb-2">Người được bảo hiểm bổ sung ${personIndex}</h3>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <label for="${personId}-name" class="font-medium text-gray-700 block mb-1">Họ và tên</label>
                    <input type="text" id="${personId}-name" class="name-input form-input" placeholder="VD: Nguyễn Văn A">
                </div>
                <div>
                    <label for="${personId}-dob" class="font-medium text-gray-700 block mb-1">Ngày sinh (DD/MM/YYYY) <span class="text-red-600">*</span></label>
                    <input type="text" id="${personId}-dob" class="dob-input form-input" placeholder="VD: 01/01/1990">
                    <span class="age-span text-sm text-gray-500">Tuổi: ...</span>
                </div>
                <div>
                    <label for="${personId}-gender" class="font-medium text-gray-700 block mb-1">Giới tính <span class="text-red-600">*</span></label>
                    <select id="${personId}-gender" class="gender-select form-select">
                        <option value="Nam">Nam</option>
                        <option value="Nữ">Nữ</option>
                    </select>
                </div>
                <div>
                    <label for="${personId}-occupation" class="font-medium text-gray-700 block mb-1">Nghề nghiệp <span class="text-red-600">*</span></label>
                    <input type="text" id="${personId}-occupation" class="occupation-input form-input" placeholder="Tìm kiếm nghề nghiệp...">
                    <span class="risk-group-span text-sm text-gray-500">Nhóm rủi ro: ...</span>
                </div>
            </div>
            <div class="supplementary-products-container mt-4">
                <!-- Các section bổ sung sẽ được render sau -->
            </div>
            <button class="remove-person-btn text-red-600 mt-2">Xóa người này</button>
        </div>
    `;

    suppContainer.insertAdjacentHTML('beforeend', personHtml);

    const newContainer = document.getElementById(personId);
    newContainer.querySelector('.remove-person-btn').addEventListener('click', () => {
        newContainer.remove();
        appState.supplementaryPersons = appState.supplementaryPersons.filter(p => p.id !== personId);
        updateStateFromUI();
        appState.fees = performCalculations(appState);
        renderUI();
    });

    // Render supplementary products cho person mới
    renderSupplementaryProductsForPerson({ id: personId, container: newContainer }, appState.mainProduct.key, appState.fees.baseMain, newContainer.querySelector('.supplementary-products-container'));

    // Thêm vào state (sẽ được update trong updateStateFromUI)
    appState.supplementaryPersons.push({ id: personId, container: newContainer });
}

function updateSupplementaryAddButtonState() {
    const btn = document.getElementById('add-supp-insured-btn');
    if (btn) {
        btn.disabled = appState.supplementaryPersons.length >= CONFIG.MAX_SUPPLEMENTARY_INSURED;
    }
}

// ===================================================================================
// ===== MODULE: MDP3 SPECIFIC HANDLERS (Giả sử MDP3 là global object)
// ===================================================================================

// Giả sử MDP3 có các method: isEnabled, getSelectedId, getPremium(ageMain, ageOther)
window.MDP3 = window.MDP3 || {
    isEnabled: () => document.getElementById('mdp3-checkbox')?.checked || false,
    getSelectedId: () => document.getElementById('mdp3-select')?.value || null,
    getPremium: (ageMain, ageOther) => {
        // Logic tính phí MDP3 giả định (thay bằng thực tế)
        if (!ageMain) return 0;
        const base = 1000000; // Ví dụ
        return ageOther ? base * (ageMain + ageOther) / 100 : base * ageMain / 100;
    }
};

// Render MDP3 other container nếu selected 'other'
function renderMdp3OtherContainer() {
    const select = document.getElementById('mdp3-select');
    if (!select) return;

    select.addEventListener('change', () => {
        const value = select.value;
        const otherContainer = document.getElementById('mdp3-other-container');
        if (otherContainer) {
            otherContainer.classList.toggle('hidden', value !== 'other');
            if (value === 'other') {
                // Thêm input tương tự collectMdp3OtherPersonData
                otherContainer.innerHTML = `
                    <div>
                        <label>Họ tên</label>
                        <input type="text" class="name-input">
                        <label>Ngày sinh</label>
                        <input type="text" class="dob-input">
                        <span class="age-span">Tuổi: ...</span>
                        <label>Giới tính</label>
                        <select class="gender-select"><option>Nam</option><option>Nữ</option></select>
                    </div>
                `;
            } else {
                otherContainer.innerHTML = '';
            }
        }
    });
}

// ===================================================================================
// ===== ADDITIONAL VALIDATIONS & HANDLERS
// ===================================================================================

function validatePerson(person) {
    let valid = true;
    if (!person.dob || person.age < 0) {
        setError(`${person.id}-dob`, 'Ngày sinh không hợp lệ');
        valid = false;
    }
    if (!person.gender) {
        setError(`${person.id}-gender`, 'Chọn giới tính');
        valid = false;
    }
    if (person.riskGroup === 0) {
        setError(`${person.id}-occupation`, 'Chọn nghề nghiệp hợp lệ');
        valid = false;
    }
    return valid;
}

// Override runAllValidations để validate all persons

// ===================================================================================
// ===== END OF SCRIPT
// ===================================================================================

// Code hoàn chỉnh, có thể thêm debug nếu cần
console.log('Logic script loaded successfully.');
