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
    const rounded = roundDownTo1000(num);
    return rounded.toLocaleString('vi-VN') + (suffix || '');
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

    const { program, scope, outpatient, dental } = customer.supplements.health_scl;
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

    const { stbh } = customer.supplements.hospital_support;
    if (!stbh) return 0;

    const rate = product_data.hospital_fee_support_rates.find(r => ageToUse >= r.ageMin && ageToUse <= r.ageMax)?.rate || 0;
    const premiumRaw = (stbh / 100) * rate;
    return roundDownTo1000(premiumRaw);
}
// ===================================================================================
// ===== MODULE: UI (Rendering, DOM manipulation, Event Listeners)
// ===================================================================================

function renderUI() {
    clearAllErrors();
    const allPersons = [appState.mainPerson, ...appState.supplementaryPersons].filter(p => p);

    allPersons.forEach(p => {
        if (p.container) {
            p.container.querySelector('.age-span').textContent = p.age;
            p.container.querySelector('.risk-group-span').textContent = p.riskGroup > 0 ? p.riskGroup : '...';
        }
    });

    renderMainProductSection(appState.mainPerson, appState.mainProduct.key);

    const isValid = runAllValidations(appState);
    
    allPersons.forEach(p => {
        const suppContainer = p.isMain
            ? document.querySelector('#main-supp-container .supplementary-products-container')
            : p.container.querySelector('.supplementary-products-container');
        if (suppContainer) {
            renderSupplementaryProductsForPerson(p, appState.mainProduct.key, appState.fees.baseMain, suppContainer);
        }
    });
    
    if (!isValid) {
        updateSummaryUI({ totalMain: 0, totalSupp: 0, total: 0 });
        if (window.renderSection6V2) window.renderSection6V2();
        return;
    }
    
    updateMainProductFeeDisplay(appState.fees.baseMain, appState.fees.extra);
    updatePaymentFrequencyOptions(appState.fees.baseMain);
    updateSummaryUI(appState.fees);

    if (window.renderSection6V2) {
        window.renderSection6V2();
    }
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
        
        checkbox.disabled = !isEligible || (isTTA && prod.id === 'health_scl');
        if (isTTA && prod.id === 'health_scl') checkbox.checked = true;
        
        const options = section.querySelector('.product-options');
        options.classList.toggle('hidden', !checkbox.checked || checkbox.disabled);
        
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
    document.getElementById('main-premium-result').textContent = formatCurrency(fees.totalMain);
    const suppContainer = document.getElementById('supplementary-premiums-results');
    suppContainer.innerHTML = fees.totalSupp > 0 
        ? `<div class="flex justify-between items-center py-2 border-b"><span class="text-gray-600">Tổng phí SP bổ sung:</span><span class="font-bold text-gray-900">${formatCurrency(fees.totalSupp)}</span></div>`
        : '';
    document.getElementById('total-premium-result').textContent = formatCurrency(fees.total);
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
    if (mainProduct && mainProduct !== 'TRON_TAM_AN' && stbh > 0 && stbh < CONFIG.MAIN_PRODUCT_MIN_STBH) {
        setFieldError(stbhEl, `STBH tối thiểu ${formatCurrency(CONFIG.MAIN_PRODUCT_MIN_STBH)}`);
        ok = false;
    } else { clearFieldError(stbhEl); }

    if (basePremium > 0 && basePremium < CONFIG.MAIN_PRODUCT_MIN_PREMIUM) {
        setFieldError(document.getElementById('main-stbh') || document.getElementById('main-premium-input'), `Phí chính tối thiểu ${formatCurrency(CONFIG.MAIN_PRODUCT_MIN_PREMIUM)}`);
        ok = false;
    }

    if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI'].includes(mainProduct)) {
        const feeInput = document.getElementById('main-premium-input');
        const factorRow = product_data.mul_factors.find(f => customer.age >= f.ageMin && customer.age <= f.ageMax);
        if (factorRow && stbh > 0) {
            const minFee = stbh / factorRow.maxFactor;
            const maxFee = stbh / factorRow.minFactor;
            if (premium > 0 && (premium < minFee || premium > maxFee)) {
                setFieldError(feeInput, 'Phí không hợp lệ');
                ok = false;
            } else { clearFieldError(feeInput);}
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
        setFieldError(input, `Tối thiểu ${formatCurrency(config.minStbh)}`); ok = false;
    } else if (config.maxStbh && stbh > config.maxStbh) {
        setFieldError(input, `Tối đa ${formatCurrency(config.maxStbh)}`); ok = false;
    } else if (prodId === 'hospital_support' && stbh > 0) {
        if (stbh % CONFIG.HOSPITAL_SUPPORT_STBH_MULTIPLE !== 0) {
             setFieldError(input, `Là bội số của ${formatCurrency(CONFIG.HOSPITAL_SUPPORT_STBH_MULTIPLE)}`); ok = false;
        } else {
            const maxSupportTotal = Math.floor(mainPremium / 4000000) * 100000;
            const maxByAge = person.age >= 18 ? config.maxStbhByAge.from18 : config.maxStbhByAge.under18;
            const remaining = maxSupportTotal - totalHospitalSupportStbh;
            if (stbh > maxByAge || stbh > remaining) {
                 setFieldError(input, 'Vượt quá giới hạn cho phép'); ok = false;
            } else { clearFieldError(input); }
        }
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
        
        const template = document.getElementById('supplementary-person-template');
        const clone = template.content.cloneNode(true);
        const newPersonDiv = clone.querySelector('.person-container');
        
        newPersonDiv.id = `person-container-${personId}`;
        
        clone.querySelector('h3').textContent = `NĐBH Bổ Sung ${count}`;
        clone.querySelector('[data-template-id="name"]').id = `name-${personId}`;
        clone.querySelector('[data-template-id="dob"]').id = `dob-${personId}`;
        clone.querySelector('[data-template-id="gender"]').id = `gender-${personId}`;
        clone.querySelector('[data-template-id="occupation-input"]').id = `occupation-input-${personId}`;
        clone.querySelector('[data-template-id="age-span"]').id = `age-${personId}`;
        clone.querySelector('[data-template-id="risk-group-span"]').id = `risk-group-${personId}`;
        
        const removeBtn = clone.querySelector('button.text-red-600');
        removeBtn.addEventListener('click', () => {
            newPersonDiv.remove();
            if (window.MDP3) MDP3.reset();
            updateSupplementaryAddButtonState();
            runWorkflow();
        });

        document.getElementById('supplementary-insured-container').appendChild(clone);
        initPerson(newPersonDiv, false);
        updateSupplementaryAddButtonState();
        if (window.MDP3) MDP3.reset();
        runWorkflow();
    });
}

function updateSupplementaryAddButtonState() {
    const btn = document.getElementById('add-supp-insured-btn');
    if (!btn) return;
    const mainProductKey = document.getElementById('main-product')?.value || '';
    const count = document.querySelectorAll('#supplementary-insured-container .person-container').length;
    const disabled = (mainProductKey === 'TRON_TAM_AN') || (count >= CONFIG.MAX_SUPPLEMENTARY_INSURED);
    btn.disabled = disabled;
    btn.classList.toggle('opacity-50', disabled);
    btn.classList.toggle('cursor-not-allowed', disabled);
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
            optionsHtml = `<div><label class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH)</label><input type="text" class="form-input ${prod.id}-stbh" placeholder="Nhập STBH"></div>`;
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

function generateSummaryTable() {
    const modal = document.getElementById('summary-modal');
    const container = document.getElementById('summary-content-container');
    container.innerHTML = '';

    try {
        const targetAgeInput = document.getElementById('target-age-input');
        const targetAge = parseInt(targetAgeInput.value, 10);
        const mainPersonContainer = document.getElementById('main-person-container');
        const mainPersonInfo = getCustomerInfo(mainPersonContainer, true);
        const mainProduct = mainPersonInfo.mainProduct;

        if (isNaN(targetAge) || targetAge <= mainPersonInfo.age) {
            throw new Error("Vui lòng nhập một độ tuổi mục tiêu hợp lệ, lớn hơn tuổi hiện tại của NĐBH chính.");
        }

        if (mainProduct === 'TRON_TAM_AN') {
            const mainSuppContainer = document.querySelector('#main-supp-container .supplementary-products-container');
            const healthSclCheckbox = mainSuppContainer?.querySelector('.health-scl-checkbox');
            const healthSclPremium = calculateHealthSclPremium(mainPersonInfo, mainSuppContainer);
            if (!healthSclCheckbox?.checked || healthSclPremium === 0) {
                throw new Error('Sản phẩm Trọn Tâm An bắt buộc phải tham gia kèm Sức Khỏe Bùng Gia Lực với phí hợp lệ.');
            }
        }

        let paymentTerm = 999;
        const paymentTermInput = document.getElementById('payment-term');
        if (paymentTermInput) {
            paymentTerm = parseInt(paymentTermInput.value, 10) || 999;
        } else if (mainPersonInfo.mainProduct === 'AN_BINH_UU_VIET') {
            paymentTerm = parseInt(document.getElementById('abuv-term')?.value, 10);
        } else if (mainPersonInfo.mainProduct === 'TRON_TAM_AN') {
            paymentTerm = 10;
        }

        if (['PUL_TRON_DOI', 'PUL_5_NAM', 'PUL_15_NAM', 'KHOE_BINH_AN', 'VUNG_TUONG_LAI'].includes(mainPersonInfo.mainProduct) && targetAge < mainPersonInfo.age + paymentTerm - 1) {
            throw new Error(`Độ tuổi mục tiêu phải lớn hơn hoặc bằng ${mainPersonInfo.age + paymentTerm - 1} đối với ${mainPersonInfo.mainProduct}.`);
        }

        const suppPersons = [];
        document.querySelectorAll('#supplementary-insured-container .person-container').forEach(pContainer => {
            if (pContainer.id !== 'main-person-container') {
                const personInfo = getCustomerInfo(pContainer, false);
                suppPersons.push(personInfo);
            }
        });

        const initialBaseMainPremium = calculateMainPremium(mainPersonInfo);
        const extraPremium = getExtraPremiumValue();

        let tableHtml = `<div class="mb-4">
      <div class="text-lg font-semibold mb-2">Tóm tắt sản phẩm</div>
      <table class="w-full text-left border-collapse">
        <thead class="bg-gray-100">
          <tr>
            <th class="p-2 border">Người được bảo hiểm</th>
            <th class="p-2 border">Sản phẩm</th>
            <th class="p-2 border">STBH</th>
            <th class="p-2 border">Số năm đóng phí</th>
            <th class="p-2 border">Phí năm đầu</th>
          </tr>
        </thead>
        <tbody>`;

        const mainStbh = (mainProduct === 'TRON_TAM_AN') ? 100000000 : parseFormattedNumber(document.getElementById('main-stbh')?.value || '0');
        const mainTerm = (mainProduct === 'TRON_TAM_AN') ? 10 :
                        (mainProduct === 'AN_BINH_UU_VIET') ? parseInt(document.getElementById('abuv-term')?.value || '0',10) :
                        parseInt(document.getElementById('payment-term')?.value || '0',10);

        tableHtml += `
            <tr>
                <td class="p-2 border font-semibold">${sanitizeHtml(mainPersonInfo.name)}</td>
                <td class="p-2 border">${getProductLabel(mainProduct)}</td>
                <td class="p-2 border text-right">${formatCurrency(mainStbh)}</td>
                <td class="p-2 border text-center">${mainTerm || '—'}</td>
                <td class="p-2 border text-right">${formatCurrency(initialBaseMainPremium)}</td>
            </tr>`;

        if (extraPremium > 0) {
            tableHtml += `
            <tr>
                <td class="p-2 border"></td>
                <td class="p-2 border">Phí đóng thêm</td>
                <td class="p-2 border text-right">—</td>
                <td class="p-2 border text-center">${mainTerm || '—'}</td>
                <td class="p-2 border text-right">${formatCurrency(extraPremium)}</td>
            </tr>`;
        }

        tableHtml += buildSupplementSummaryRows(mainPersonInfo, document.querySelector('#main-supp-container .supplementary-products-container'), targetAge);

        suppPersons.forEach(p => {
            tableHtml += buildSupplementSummaryRows(p, p.container, targetAge);
        });

        tableHtml += '</tbody></table></div>';

        container.innerHTML = tableHtml;

    } catch (e) {
        container.innerHTML = `<p class="text-red-600 font-semibold text-center">${e.message}</p>`;
    } finally {
        modal.classList.remove('hidden');
    }
}


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
    
    // HÀM BỊ THIẾU ĐÃ ĐƯỢC THÊM VÀO ĐÂY
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
