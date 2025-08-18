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
    return num.toLocaleString('vi-VN') + suffix;
}

function formatDisplayCurrency(value) {
    return formatCurrency(value);
}

function sanitizeHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function getPaymentTermBounds(age) {
    return { min: 4, max: Math.max(0, 100 - age - 1) };
}

function getHealthSclStbhByProgram(program) {
    return CONFIG.supplementaryProducts.find(p => p.id === 'health_scl')?.stbhByProgram[program] || 0;
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

    appState.mainPerson = collectPersonData(appState.mainPerson.container, true);

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
        container,
        isMain,
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
    
    const allPersons = [state.mainPerson, ...state.supplementaryPersons].filter(Boolean);
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
    try {
        const mdpEnabled = window.MDP3 && MDP3.isEnabled();
        const mdpTargetId = mdpEnabled ? MDP3.getSelectedId() : null;
        if (mdpEnabled && mdp3Fee > 0) {
            if (mdpTargetId && fees.byPerson[mdpTargetId]) {
                fees.byPerson[mdpTargetId].supp = (fees.byPerson[mdpTargetId].supp || 0) + mdp3Fee;
                fees.byPerson[mdpTargetId].suppDetails.mdp3 = mdp3Fee;
            } else if (mdpTargetId === 'other') {
                if (!fees.byPerson['mdp3_other']) fees.byPerson['mdp3_other'] = { main: 0, supp: 0, total: 0, suppDetails: {} };
                fees.byPerson['mdp3_other'].supp += mdp3Fee;
                fees.byPerson['mdp3_other'].suppDetails.mdp3 = mdp3Fee;
            }
        }
    } catch(e) {
        console.error('Error handling MDP3 fee:', e);
    }
    
    
    const totalMain = fees.baseMain + fees.extra;
    const total = totalMain + fees.totalSupp;
    
    return { ...fees, totalMain, total };
}

function calculateMainPremium(customer, productInfo, ageOverride = null) {
    const ageToUse = ageOverride ?? customer?.age ?? 0;
    const gender = customer?.gender ?? 'Nam';
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
    const ageToUse = ageOverride ?? customer?.age ?? 0;
    const config = CONFIG.supplementaryProducts.find(p => p.id === 'health_scl');
    if (ageToUse > config.maxRenewalAge) return 0;

    const { program, scope, outpatient, dental } = customer?.supplements?.health_scl ?? {};
    if (!program || !scope) return 0;

    const ageBandIndex = product_data.health_scl_rates.age_bands.findIndex(b => ageToUse >= b.min && ageToUse <= b.max);
    if (ageBandIndex === -1) return 0;

    let totalPremium = product_data.health_scl_rates[scope]?.[ageBandIndex]?.[program] || 0;
    if (outpatient) totalPremium += product_data.health_scl_rates.outpatient?.[ageBandIndex]?.[program] || 0;
    if (dental) totalPremium += product_data.health_scl_rates.dental?.[ageBandIndex]?.[program] || 0;

    return roundDownTo1000(totalPremium);
}

function calculateBhnPremium(customer, mainPremium, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer?.age ?? 0;
    const config = CONFIG.supplementaryProducts.find(p => p.id === 'bhn');
    if (ageToUse > config.maxRenewalAge) return 0;
    
    const gender = customer?.gender ?? 'Nam';
    const { stbh } = customer?.supplements?.bhn ?? {};
    if (!stbh) return 0;

    const rate = product_data.bhn_rates.find(r => ageToUse >= r.ageMin && ageToUse <= r.ageMax)?.[gender === 'Nữ' ? 'nu' : 'nam'] || 0;
    const premiumRaw = (stbh / 1000) * rate;
    return roundDownTo1000(premiumRaw);
}

function calculateAccidentPremium(customer, mainPremium, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer?.age ?? 0;
    const config = CONFIG.supplementaryProducts.find(p => p.id === 'accident');
    if (ageToUse > config.maxRenewalAge) return 0;

    const riskGroup = customer?.riskGroup ?? 0;
    if (riskGroup === 0 || riskGroup > 4) return 0;
    
    const { stbh } = customer?.supplements?.accident ?? {};
    if (!stbh) return 0;

    const rate = product_data.accident_rates[riskGroup] || 0;
    const premiumRaw = (stbh / 1000) * rate;
    return roundDownTo1000(premiumRaw);
}

function calculateHospitalSupportPremium(customer, mainPremium, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer?.age ?? 0;
    const config = CONFIG.supplementaryProducts.find(p => p.id === 'hospital_support');
    if (ageToUse > config.maxRenewalAge) return 0;

    const { stbh } = customer?.supplements?.hospital_support ?? {};
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
        const btn = document.getElementById('add-supp-insured-btn');
        if (isTTA) {
            if (cont) cont.innerHTML = '';
            appState.supplementaryPersons = [];
            if (cont) cont.classList.add('hidden');
            if (btn) btn.classList.add('hidden');
        } else {
            if (cont) cont.classList.remove('hidden');
            if (btn) btn.classList.remove('hidden');
        }
        if (typeof updateSupplementaryAddButtonState === 'function') updateSupplementaryAddButtonState();
    } catch (e) {}

    clearAllErrors();
    const allPersons = [appState.mainPerson, ...appState.supplementaryPersons].filter(Boolean);

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
        [summaryTotalEl, mainFeeEl, extraFeeEl, suppFeeEl].forEach(el => {
            if (el) el.textContent = "0";
        });
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
        if (feeDisplay) feeDisplay.textContent = fee > 0 ? `Phí: ${formatCurrency(fee)}` : '';
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
    const fmt = (n) => formatDisplayCurrency(n);
    // Primary figures
    ['summary-total', 'main-insured-main-fee', 'main-insured-extra-fee', 'summary-supp-fee'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = fmt(f[id.split('-').pop()]); // map id to key
    });

    // Frequency breakdown
    const freqSel = document.getElementById('payment-frequency');
    const freqBox = document.getElementById('frequency-breakdown');
    const v = freqSel ? freqSel.value : 'year';
    const periods = v === 'half' ? 2 : (v === 'quarter' ? 4 : 1);
    const factor = periods === 2 ? 1.02 : (periods === 4 ? 1.04 : 1); // only riders

    if (freqBox) freqBox.classList.toggle('hidden', periods === 1);

    const perMain = periods === 1 ? 0 : roundDownTo1000((f.baseMain || 0) / periods);
    const perExtra = periods === 1 ? 0 : roundDownTo1000((f.extra || 0) / periods);
    const perSupp = periods === 1 ? 0 : roundDownTo1000(((f.totalSupp || 0) * factor) / periods);

    const perTotal = periods === 1 ? 0 : (perMain + perExtra + perSupp);
    const annualEq = periods === 1 ? f.total : (perTotal * periods);
    const diff = annualEq - f.total;

    ['freq-main', 'freq-extra', 'freq-supp-total', 'freq-total-period', 'freq-total-year', 'freq-diff'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = fmt({ 'freq-main': perMain, 'freq-extra': perExtra, 'freq-supp-total': perSupp, 'freq-total-period': perTotal, 'freq-total-year': f.total, 'freq-diff': diff }[id]);
    });
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
    
    const allPersons = [state.mainPerson, ...state.supplementaryPersons].filter(Boolean);
    let totalHospitalSupportStbh = 0;
    
    allPersons.forEach(p => {
        if (!p.isMain && !validateDobField(p.container.querySelector('.dob-input'))) isValid = false;
        
        for (const prodId in p.supplements) {
            if (!validateSupplementaryProduct(p, prodId, state.fees.baseMain, totalHospitalSupportStbh)) {
                isValid = false;
            }
            if (prodId === 'hospital_support') {
                totalHospitalSupportStbh += p.supplements[prodId].stbh || 0;
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
    const { key: mainProduct, stbh, premium, paymentTerm, abuvTerm } = productInfo;
    const stbhEl = document.getElementById('main-stbh');
    const termEl = document.getElementById('payment-term');
    const abuvTermEl = document.getElementById('abuv-term');

    // STBH & phí chính ngưỡng tối thiểu
    if (mainProduct && mainProduct !== 'TRON_TAM_AN') {
        if (stbh > 0 && stbh < CONFIG.MAIN_PRODUCT_MIN_STBH) {
            setFieldError(stbhEl, `STBH tối thiểu ${formatCurrency(CONFIG.MAIN_PRODUCT_MIN_STBH)}`);
            ok = false;
        } else { clearFieldError(stbhEl); }

        if (basePremium > 0 && basePremium < CONFIG.MAIN_PRODUCT_MIN_PREMIUM) {
            setFieldError(document.getElementById('main-stbh') || document.getElementById('main-premium-input'), `Phí chính tối thiểu ${formatCurrency(CONFIG.MAIN_PRODUCT_MIN_PREMIUM)}`);
            ok = false;
        }
    }

    // Kiểm tra thời hạn đóng phí theo từng sản phẩm
    const age = customer?.age || 0;
    const bounds = getPaymentTermBounds(age);
    let minTerm = 4;
    if (mainProduct === 'PUL_5_NAM') minTerm = 5;
    if (mainProduct === 'PUL_15_NAM') minTerm = 15;
    if (mainProduct === 'TRON_TAM_AN') minTerm = 10; // cố định (auto), không có input
    if (mainProduct === 'AN_BINH_UU_VIET') {
        // ABƯV: bắt buộc chọn 5/10/15 theo tuổi
        const allowed = [];
        if (age <= 65) allowed.push(5);
        if (age <= 60) allowed.push(10);
        if (age <= 55) allowed.push(15);
        const v = parseInt(abuvTermEl?.value || "0", 10);
        if (!allowed.includes(v)) {
            setFieldError(abuvTermEl, 'Chọn 5 / 10 / 15 năm phù hợp với độ tuổi');
            ok = false;
        } else {
            clearFieldError(abuvTermEl);
        }
    } else if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI', 'PUL_TRON_DOI', 'PUL_15_NAM', 'PUL_5_NAM'].includes(mainProduct)) {
        const v = parseInt(termEl?.value || "0", 10);
        const maxTerm = bounds.max;
        if (!(v >= minTerm && v <= maxTerm)) {
            setFieldError(termEl, `Nhập từ ${minTerm} đến ${maxTerm} năm`);
            ok = false;
        } else {
            clearFieldError(termEl);
        }
    }

    // MUL range khi có STBH + độ tuổi
    if (['KHOE_BINH_AN', 'VUNG_TUONG_LAI'].includes(mainProduct)) {
        const feeInput = document.getElementById('main-premium-input');
        const factorRow = product_data.mul_factors.find(f => customer.age >= f.ageMin && customer.age <= f.ageMax);
        const rangeEl = document.getElementById('mul-fee-range');
        if (factorRow && stbh > 0) {
            const minFee = stbh / factorRow.maxFactor;
            const maxFee = stbh / factorRow.minFactor;
            if (rangeEl) rangeEl.textContent = `Phí hợp lệ từ ${formatCurrency(minFee)} đến ${formatCurrency(maxFee)}.`;
            if (premium > 0 && (premium < minFee || premium > maxFee)) {
                setFieldError(feeInput, 'Phí không hợp lệ');
                ok = false;
            } else { clearFieldError(feeInput); }
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
    if (!input) return true;
    
    let ok = true;
    if (config.minStbh && stbh > 0 && stbh < config.minStbh) {
        setFieldError(input, `Tối thiểu ${formatCurrency(config.minStbh)}`); ok = false;
    } else if (config.maxStbh && stbh > config.maxStbh) {
        setFieldError(input, `Tối đa ${formatCurrency(config.maxStbh)}`); ok = false;
    } else if (prodId === 'hospital_support' && stbh > 0) {
        const validationEl = section.querySelector('.hospital-support-validation');
        const maxSupportTotal = Math.floor(mainPremium / 4000000) * 100000;
        const maxByAge = person.age >= 18 ? config.maxStbhByAge.from18 : config.maxStbhByAge.under18;
        const remaining = maxSupportTotal - totalHospitalSupportStbh;
        if (validationEl) validationEl.textContent = `Tối đa: ${formatCurrency(Math.min(maxByAge, remaining), 'đ/ngày')}. Phải là bội số của 100.000.`;

        if (stbh % CONFIG.HOSPITAL_SUPPORT_STBH_MULTIPLE !== 0) {
            setFieldError(input, `Là bội số của ${formatCurrency(CONFIG.HOSPITAL_SUPPORT_STBH_MULTIPLE)}`); ok = false;
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
    if (errorMsgEl) errorMsgEl.textContent = '';
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
}


// ===================================================================================
// ===== MODULE: UI HELPERS (Formatting, Autocomplete, and Additional UI Logic)
// ===================================================================================

function initDateFormatter(input) {
    if (!input) return;
    input.addEventListener('input', (e) => {
        let v = e.target.value.replace(/[^0-9]/g, '');
        if (v.length > 8) v = v.slice(0, 8);
        if (v.length >= 5) {
            v = v.slice(0, 2) + '/' + v.slice(2, 4) + '/' + v.slice(4);
        } else if (v.length >= 3) {
            v = v.slice(0, 2) + '/' + v.slice(2);
        }
        e.target.value = v;
    });
}

function initOccupationAutocomplete(input, container) {
    if (!input || !container) return;
    const autocompleteContainer = container.querySelector('.occupation-autocomplete');
    if (!autocompleteContainer) return;

    input.addEventListener('input', () => {
        const query = input.value.trim().toLowerCase();
        if (!query) {
            autocompleteContainer.classList.add('hidden');
            return;
        }

        const matches = product_data.occupations.filter(o => 
            o.name.toLowerCase().includes(query) && o.group >= 1 && o.group <= 4
        ).slice(0, 10);

        if (matches.length === 0) {
            autocompleteContainer.classList.add('hidden');
            return;
        }

        autocompleteContainer.innerHTML = matches.map(o => `
            <div class="p-2 hover:bg-gray-100 cursor-pointer" data-group="${o.group}" data-value="${sanitizeHtml(o.name)}">
                ${sanitizeHtml(o.name)} (Nhóm ${o.group})
            </div>
        `).join('');

        autocompleteContainer.classList.remove('hidden');

        autocompleteContainer.querySelectorAll('div').forEach(div => {
            div.addEventListener('click', () => {
                input.value = div.dataset.value;
                input.dataset.group = div.dataset.group;
                container.querySelector('.risk-group-span').textContent = div.dataset.group;
                autocompleteContainer.classList.add('hidden');
                runWorkflow();
            });
        });
    });

    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) {
            autocompleteContainer.classList.add('hidden');
        }
    });
}

function generateSupplementaryProductsHtml() {
    return CONFIG.supplementaryProducts.map(prod => `
        <div class="${prod.id}-section space-y-2 ${prod.id === 'health_scl' ? '' : 'hidden'}">
            <label class="flex items-center space-x-2">
                <input type="checkbox" class="${prod.id}-checkbox" ${prod.id === 'health_scl' ? 'checked' : ''}>
                <span class="font-medium">${sanitizeHtml(prod.name)}</span>
            </label>
            <div class="product-options space-y-2 pl-6 ${prod.id === 'health_scl' ? '' : 'hidden'}">
                ${prod.id === 'health_scl' ? `
                    <div>
                        <label class="font-medium text-gray-700 block mb-1">Chương trình</label>
                        <select class="form-select health-scl-program">
                            <option value="">-- Chọn --</option>
                            <option value="co_ban">Cơ bản</option>
                            <option value="nang_cao">Nâng cao</option>
                            <option value="toan_dien">Toàn diện</option>
                            <option value="hoan_hao">Hoàn hảo</option>
                        </select>
                    </div>
                    <div>
                        <label class="font-medium text-gray-700 block mb-1">Phạm vi bảo hiểm</label>
                        <select class="form-select health-scl-scope">
                            <option value="">-- Chọn --</option>
                            <option value="inpatient">Nội trú</option>
                            <option value="inpatient_plus">Nội trú + Sinh mạng</option>
                        </select>
                    </div>
                    <div class="flex space-x-4">
                        <label class="flex items-center space-x-2">
                            <input type="checkbox" class="health-scl-outpatient">
                            <span>Ngoại trú</span>
                        </label>
                        <label class="flex items-center space-x-2">
                            <input type="checkbox" class="health-scl-dental">
                            <span>Nha khoa</span>
                        </label>
                    </div>
                    <p class="text-sm text-gray-500">STBH: ${formatCurrency(getHealthSclStbhByProgram('co_ban'))} - ${formatCurrency(getHealthSclStbhByProgram('hoan_hao'))}</p>
                ` : `
                    <div>
                        <label class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH)</label>
                        <input type="text" class="${prod.id}-stbh form-input" placeholder="VD: ${formatCurrency(prod.minStbh || 100000000)}">
                    </div>
                    ${prod.id === 'hospital_support' ? `<p class="hospital-support-validation text-sm text-gray-500"></p>` : ''}
                `}
                <p class="fee-display text-sm font-semibold text-gray-700"></p>
            </div>
        </div>
    `).join('');
}

function initSummaryModal() {
    const modal = document.getElementById('summary-modal');
    const openBtn = document.getElementById('open-summary-btn');
    const closeBtn = document.getElementById('close-summary-btn');

    if (openBtn) {
        openBtn.addEventListener('click', () => {
            if (modal) modal.classList.remove('hidden');
            runWorkflow();
        });
    }

    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            if (modal) modal.classList.add('hidden');
        });
    }
}

function setPaymentTermHint(mainProductKey, age) {
    const el = document.getElementById('payment-term-hint');
    if (!el) return;
    const bounds = getPaymentTermBounds(age);
    let minTerm = 4;
    if (mainProductKey === 'PUL_5_NAM') minTerm = 5;
    if (mainProductKey === 'PUL_15_NAM') minTerm = 15;
    el.textContent = `Nhập từ ${minTerm} đến ${bounds.max} năm`;
}

function attachTermListenersForTargetAge() {
    const ageInput = document.querySelector('#main-person-container .dob-input');
    if (!ageInput) return;

    ageInput.addEventListener('change', () => {
        const dobStr = ageInput.value;
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(dobStr)) return;
        const [dd, mm, yyyy] = dobStr.split('/').map(n => parseInt(n, 10));
        const birthDate = new Date(yyyy, mm - 1, dd);
        if (birthDate > CONFIG.REFERENCE_DATE) return;

        const age = CONFIG.REFERENCE_DATE.getFullYear() - birthDate.getFullYear();
        const m = CONFIG.REFERENCE_DATE.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && CONFIG.REFERENCE_DATE.getDate() < birthDate.getDate())) {
            age--;
        }

        const termInput = document.getElementById('payment-term');
        if (termInput) {
            const bounds = getPaymentTermBounds(age);
            termInput.min = Math.max(bounds.min, mainProductKey === 'PUL_5_NAM' ? 5 : mainProductKey === 'PUL_15_NAM' ? 15 : 4);
            termInput.max = bounds.max;
            setPaymentTermHint(appState.mainProduct.key, age);
        }

        const abuvTermSelect = document.getElementById('abuv-term');
        if (abuvTermSelect && appState.mainProduct.key === 'AN_BINH_UU_VIET') {
            let termOptions = '';
            if (age <= 55) termOptions += '<option value="15">15 năm</option>';
            if (age <= 60) termOptions += '<option value="10">10 năm</option>';
            if (age <= 65) termOptions += '<option value="5">5 năm</option>';
            if (!termOptions) termOptions = '<option value="" disabled>Không có kỳ hạn phù hợp</option>';
            abuvTermSelect.innerHTML = `<option value="" selected>-- Chọn --</option>${termOptions}`;
        }
    });
}

function formatNumberInput(input) {
    if (!input) return;
    let value = input.value.replace(/[^0-9]/g, '');
    if (value) {
        value = parseInt(value, 10).toLocaleString('vi-VN');
    }
    input.value = value;
}

function roundInputToThousand(input) {
    if (!input) return;
    const value = parseFormattedNumber(input.value);
    if (value > 0) {
        input.value = formatCurrency(roundDownTo1000(value));
    }
}

// ===================================================================================
// ===== MODULE: MDP3 INTEGRATION (Optional, with Error Handling)
// ===================================================================================

if (window.MDP3) {
    window.MDP3.init = () => {
        try {
            const mdp3Section = document.getElementById('mdp3-section');
            if (!mdp3Section) return;

            mdp3Section.innerHTML = `
                <label class="flex items-center space-x-2">
                    <input type="checkbox" id="mdp3-checkbox" class="form-checkbox">
                    <span class="font-medium">Bảo hiểm Miễn đóng phí 3.0</span>
                </label>
                <div id="mdp3-options" class="space-y-2 pl-6 hidden">
                    <label class="font-medium text-gray-700 block mb-1">Đối tượng áp dụng</label>
                    <select id="mdp3-target" class="form-select">
                        <option value="">-- Chọn --</option>
                        ${[appState.mainPerson, ...appState.supplementaryPersons].map(p => 
                            `<option value="${p.id}">${sanitizeHtml(p.name)}</option>`
                        ).join('')}
                        <option value="other">Người khác</option>
                    </select>
                    <p id="mdp3-fee" class="text-sm font-semibold text-gray-700"></p>
                </div>
            `;

            const checkbox = document.getElementById('mdp3-checkbox');
            const options = document.getElementById('mdp3-options');
            const targetSelect = document.getElementById('mdp3-target');
            const feeDisplay = document.getElementById('mdp3-fee');

            checkbox.addEventListener('change', () => {
                options.classList.toggle('hidden', !checkbox.checked);
                if (!checkbox.checked) {
                    appState.mdp3.enabled = false;
                    appState.mdp3.selectedId = null;
                    appState.mdp3.fee = 0;
                } else {
                    appState.mdp3.enabled = true;
                    appState.mdp3.selectedId = targetSelect.value || null;
                    appState.mdp3.fee = calculateMdp3Premium();
                }
                runWorkflow();
            });

            targetSelect.addEventListener('change', () => {
                appState.mdp3.selectedId = targetSelect.value || null;
                appState.mdp3.fee = calculateMdp3Premium();
                feeDisplay.textContent = appState.mdp3.fee > 0 ? `Phí: ${formatCurrency(appState.mdp3.fee)}` : '';
                runWorkflow();
            });
        } catch (e) {
            console.error('Error initializing MDP3:', e);
        }
    };

    window.MDP3.isEnabled = () => appState.mdp3.enabled;

    window.MDP3.getSelectedId = () => appState.mdp3.selectedId;

    window.MDP3.getPremium = () => appState.mdp3.fee;

    window.MDP3.reset = () => {
        const checkbox = document.getElementById('mdp3-checkbox');
        const options = document.getElementById('mdp3-options');
        if (checkbox && options) {
            checkbox.checked = false;
            options.classList.add('hidden');
            appState.mdp3.enabled = false;
            appState.mdp3.selectedId = null;
            appState.mdp3.fee = 0;
            runWorkflow();
        }
    };

    window.MDP3.resetIfEnabled = () => {
        if (appState.mdp3.enabled) window.MDP3.reset();
    };

    function calculateMdp3Premium() {
        try {
            const targetId = appState.mdp3.selectedId;
            if (!targetId) return 0;

            const person = [appState.mainPerson, ...appState.supplementaryPersons].find(p => p.id === targetId) || { age: 0, gender: 'Nam' };
            const age = person.age || 0;
            if (age > 65) return 0;

            const rate = product_data.mdp3_rates.find(r => age >= r.ageMin && age <= r.ageMax)?.[person.gender === 'Nữ' ? 'nu' : 'nam'] || 0;
            const basePremium = appState.fees.baseMain || 0;
            return roundDownTo1000((basePremium / 1000) * rate);
        } catch (e) {
            console.error('Error calculating MDP3 premium:', e);
            return 0;
        }
    }
}

// ===================================================================================
// ===== MODULE: EXPORTED FUNCTIONS (For external use if needed)
// ===================================================================================

window.calculateFees = () => {
    updateStateFromUI();
    appState.fees = performCalculations(appState);
    return appState.fees;
};

window.getPersonFees = () => window.personFees || {};

window.updateUI = () => {
    runWorkflow();
};
