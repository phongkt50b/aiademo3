// SCRIPT.JS - PHẦN 1/2

import { product_data } from './data.js';

// ===================================================================================
// ===== MODULE: CONFIG & BUSINESS RULES
// ===================================================================================
const CONFIG = {
    getReferenceDate: () => new Date(),
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
        KHOE_BINH_AN: { name: 'MUL - Khoẻ Bình An' },
        TRON_TAM_AN: { name: 'Trọn tâm an' },
        AN_BINH_UU_VIET: { name: 'An Bình Ưu Việt' },
    },
    supplementaryProducts: [
        {
            id: 'health_scl', name: 'Sức khỏe Bùng Gia Lực', maxEntryAge: 65, maxRenewalAge: 74,
            calculationFunc: calculateHealthSclPremium,
            stbhByProgram: { co_ban: 100000000, nang_cao: 250000000, toan_dien: 500000000, hoan_hao: 1000000000 }
        },
        {
            id: 'bhn', name: 'Bệnh Hiểm Nghèo 2.0', maxEntryAge: 70, maxRenewalAge: 85,
            calculationFunc: calculateBhnPremium, minStbh: 200000000, maxStbh: 5000000000
        },
        {
            id: 'accident', name: 'Bảo hiểm Tai nạn', maxEntryAge: 64, maxRenewalAge: 65,
            calculationFunc: calculateAccidentPremium, minStbh: 10000000, maxStbh: 8000000000
        },
        {
            id: 'hospital_support', name: 'Hỗ trợ chi phí nằm viện', maxEntryAge: 55, maxRenewalAge: 59,
            calculationFunc: calculateHospitalSupportPremium,
            maxStbhByAge: { under18: 300000, from18: 1000000 }
        }
    ]
};

const PRODUCT_STRATEGIES = {
    _basePUL: {
        isRateBased: true,
        getRate: (state, age) => {
            const genderKey = state.persons['main-person'].gender === 'Nữ' ? 'nu' : 'nam';
            return product_data.pul_rates[state.mainProduct.key]?.find(r => r.age === age)?.[genderKey] || 0;
        },
        getPaymentTermBounds: (age) => ({ min: 4, max: Math.max(0, 100 - age - 1) }),
        isEligible: (person) => person.daysFromBirth >= 30 && person.age <= 70,
    },
    get PUL_TRON_DOI() { return this._basePUL; },
    _baseMUL: {
        isRateBased: false,
        getPaymentTermBounds: (age) => ({ min: 4, max: Math.max(0, 100 - age - 1) }),
        isEligible: (person) => person.daysFromBirth >= 30 && person.age <= 70,
        validatePremium: (state) => {
            const { age } = state.persons['main-person'];
            const { stbh, premium } = state.mainProduct;
            const factorRow = product_data.mul_factors.find(f => age >= f.ageMin && age <= f.ageMax);
            if (!factorRow || stbh <= 0) return { isValid: true, message: '' };
            const minFee = stbh / factorRow.maxFactor;
            const maxFee = stbh / factorRow.minFactor;
            const isValid = premium >= minFee && premium <= maxFee;
            return { isValid, message: `Phí hợp lệ từ ${formatCurrency(minFee)} đến ${formatCurrency(maxFee)}.` };
        }
    },
    get KHOE_BINH_AN() { return this._baseMUL; },
    TRON_TAM_AN: {
        isRateBased: true,
        stbh: 100000000,
        getRate: (state, age) => {
            const genderKey = state.persons['main-person'].gender === 'Nữ' ? 'nu' : 'nam';
            return product_data.an_binh_uu_viet_rates['10']?.find(r => r.age === age)?.[genderKey] || 0;
        },
        getPaymentTermBounds: () => ({ min: 10, max: 10 }),
        isEligible: (person) => {
            const { age, gender, riskGroup } = person;
            const withinAge = (gender === 'Nam') ? (age >= 12 && age <= 60) : (age >= 28 && age <= 60);
            return withinAge && riskGroup > 0 && riskGroup < 4;
        },
    },
    AN_BINH_UU_VIET: {
        isRateBased: true,
        getRate: (state, age) => {
            const { abuvTerm } = state.mainProduct;
            if (!abuvTerm) return 0;
            const genderKey = state.persons['main-person'].gender === 'Nữ' ? 'nu' : 'nam';
            return product_data.an_binh_uu_viet_rates[abuvTerm]?.find(r => r.age === age)?.[genderKey] || 0;
        },
        getPaymentTermOptions: (age) => {
            const options = [];
            if (age <= 65) options.push({ value: '5', text: '5 năm' });
            if (age <= 60) options.push({ value: '10', text: '10 năm' });
            if (age <= 55) options.push({ value: '15', text: '15 năm' });
            return options;
        },
        isEligible: (person) => {
            const { age, gender } = person;
            return (gender === 'Nam' ? age >= 12 : age >= 28) && (age <= 65);
        },
    }
};

// ===================================================================================
// ===== MODULE: STATE MANAGEMENT & UPDATERS
// ===================================================================================
let appState = {};

function createInitialState() {
    const mainPersonId = 'main-person';
    return {
        mainProduct: { key: '', stbh: 0, premium: 0, paymentTerm: 0, extraPremium: 0, abuvTerm: '' },
        paymentFrequency: 'year',
        persons: {
            [mainPersonId]: {
                id: mainPersonId, isMain: true, name: '', dob: '', age: 0,
                daysFromBirth: 0, gender: 'Nam', riskGroup: 0, occupationName: '', supplements: {}
            }
        },
        supplementaryPersonIds: [],
        fees: { baseMain: 0, extra: 0, totalMain: 0, totalSupp: 0, total: 0, byPerson: {} },
        mdp3: { enabled: false, selectedId: null, fee: 0, otherPerson: null },
        ui: { errors: {}, validationMessages: {} }
    };
}

function updateMainProduct(props) {
    const oldKey = appState.mainProduct.key;
    Object.assign(appState.mainProduct, props);
    if (props.key !== undefined && props.key !== oldKey) {
        Object.assign(appState.mainProduct, { stbh: 0, premium: 0, paymentTerm: 0, extraPremium: 0, abuvTerm: '' });
        if (window.MDP3) MDP3.reset();
    }
    runWorkflow();
}

function updatePaymentFrequency(value) {
    appState.paymentFrequency = value;
    runWorkflow();
}

function updatePerson(personId, props) {
    const person = appState.persons[personId];
    if (!person) return;

    Object.assign(person, props);

    if (props.dob !== undefined) {
        const { age, daysFromBirth } = calculateAge(props.dob);
        person.age = age;
        person.daysFromBirth = daysFromBirth;
        if (person.isMain) {
            const strategy = PRODUCT_STRATEGIES[appState.mainProduct.key];
            if (strategy && !strategy.isEligible(person)) {
                updateMainProduct({ key: '' });
            }
        }
    }
    runWorkflow();
}

function addSupplementaryPerson() {
    if (appState.supplementaryPersonIds.length >= CONFIG.MAX_SUPPLEMENTARY_INSURED) return;
    const personId = `supp-${Date.now()}`;
    appState.persons[personId] = {
        id: personId, isMain: false, name: '', dob: '', age: 0,
        daysFromBirth: 0, gender: 'Nam', riskGroup: 0, occupationName: '', supplements: {}
    };
    appState.supplementaryPersonIds.push(personId);
    runWorkflow();
}

function removeSupplementaryPerson(personId) {
    delete appState.persons[personId];
    appState.supplementaryPersonIds = appState.supplementaryPersonIds.filter(id => id !== personId);
    if (window.MDP3) MDP3.reset();
    runWorkflow();
}

function toggleSupplement(personId, suppId, isEnabled) {
    const person = appState.persons[personId];
    if (!person) return;
    if (isEnabled) {
        person.supplements[suppId] = { stbh: 0, program: '', scope: 'main_vn', outpatient: false, dental: false };
    } else {
        delete person.supplements[suppId];
    }
    runWorkflow();
}

function updateSupplementDetails(personId, suppId, props) {
    const supplement = appState.persons[personId]?.supplements[suppId];
    if (supplement) {
        Object.assign(supplement, props);
        runWorkflow();
    }
}
// SCRIPT.JS - PHẦN 2/2

// ===================================================================================
// ===== MODULE: HELPERS
// ===================================================================================
function roundDownTo1000(n) { return Math.floor(Number(n || 0) / 1000) * 1000; }
function parseFormattedNumber(s) { return parseInt(String(s || '0').replace(/[.,]/g, ''), 10) || 0; }
function formatCurrency(v, s = '') { return (Number(v) || 0).toLocaleString('vi-VN') + (s || ''); }
function sanitizeHtml(str) { return String(str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function calculateAge(dobStr) {
    if (!dobStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(dobStr)) return { age: 0, daysFromBirth: 0 };
    const [dd, mm, yyyy] = dobStr.split('/').map(n => parseInt(n, 10));
    const birthDate = new Date(yyyy, mm - 1, dd);
    const refDate = CONFIG.getReferenceDate();
    if (isNaN(birthDate.getTime()) || birthDate > refDate) return { age: 0, daysFromBirth: 0 };

    const daysFromBirth = Math.floor((refDate - birthDate) / (1000 * 60 * 60 * 24));
    let age = refDate.getFullYear() - birthDate.getFullYear();
    const m = refDate.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && refDate.getDate() < birthDate.getDate())) age--;
    return { age, daysFromBirth };
}

// ===================================================================================
// ===== MODULE: LOGIC & CALCULATIONS
// ===================================================================================
function performCalculations(state) {
    const fees = { baseMain: 0, extra: 0, totalSupp: 0, byPerson: {} };
    fees.baseMain = calculateMainPremiumFee(state);
    fees.extra = state.mainProduct.extraPremium;

    const allPersons = [state.persons['main-person'], ...state.supplementaryPersonIds.map(id => state.persons[id])];
    allPersons.forEach(p => {
        fees.byPerson[p.id] = { main: 0, supp: 0, total: 0, suppDetails: {} };
    });

    if (fees.byPerson['main-person']) fees.byPerson['main-person'].main = fees.baseMain + fees.extra;
    
    let totalHospitalSupportStbh = 0;
    allPersons.forEach(person => {
        let personSuppFee = 0;
        for (const prodId in person.supplements) {
            const prodConfig = CONFIG.supplementaryProducts.find(p => p.id === prodId);
            if (prodConfig) {
                const fee = prodConfig.calculationFunc(person, state, totalHospitalSupportStbh);
                personSuppFee += fee;
                fees.byPerson[person.id].suppDetails[prodId] = fee;
                if (prodId === 'hospital_support') totalHospitalSupportStbh += person.supplements[prodId].stbh;
            }
        }
        fees.byPerson[person.id].supp = personSuppFee;
        fees.totalSupp += personSuppFee;
    });

    if (window.MDP3) MDP3.calculateFee(state, fees);

    fees.totalMain = fees.baseMain + fees.extra;
    fees.total = fees.totalMain + fees.totalSupp;
    return fees;
}

function calculateMainPremiumFee(state, ageOverride = null) {
    const { mainProduct, persons } = state;
    const mainPerson = persons['main-person'];
    const strategy = PRODUCT_STRATEGIES[mainProduct.key];
    if (!strategy) return 0;
    const ageToUse = ageOverride ?? mainPerson.age;
    let premium = 0;
    if (strategy.isRateBased) {
        const rate = strategy.getRate(state, ageToUse);
        const stbh = strategy.stbh || mainProduct.stbh;
        premium = (stbh / 1000) * rate;
    } else {
        premium = mainProduct.premium;
    }
    return roundDownTo1000(premium);
}

function calculateHealthSclPremium(customer, state, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const config = CONFIG.supplementaryProducts.find(p => p.id === 'health_scl');
    if (ageToUse > config.maxRenewalAge) return 0;
    const { program, scope, outpatient, dental } = customer.supplements.health_scl || {};
    if (!program || !scope) return 0;
    const ageBandIndex = product_data.health_scl_rates.age_bands.findIndex(b => ageToUse >= b.min && ageToUse <= b.max);
    if (ageBandIndex === -1) return 0;
    let totalPremium = product_data.health_scl_rates['main_vn']?.[ageBandIndex]?.[program] || 0;
    if (outpatient) totalPremium += product_data.health_scl_rates.outpatient?.[ageBandIndex]?.[program] || 0;
    if (dental) totalPremium += product_data.health_scl_rates.dental?.[ageBandIndex]?.[program] || 0;
    return roundDownTo1000(totalPremium);
}

function calculateBhnPremium(customer, state, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const config = CONFIG.supplementaryProducts.find(p => p.id === 'bhn');
    if (ageToUse > config.maxRenewalAge) return 0;
    const { gender } = customer;
    const { stbh } = customer.supplements.bhn;
    if (!stbh) return 0;
    const rate = product_data.bhn_rates.find(r => ageToUse >= r.ageMin && ageToUse <= r.ageMax)?.[gender === 'Nữ' ? 'nu' : 'nam'] || 0;
    return roundDownTo1000((stbh / 1000) * rate);
}

function calculateAccidentPremium(customer, state, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const { riskGroup } = customer;
    if (riskGroup === 0 || riskGroup > 4) return 0;
    const { stbh } = customer.supplements.accident;
    if (!stbh) return 0;
    const rate = product_data.accident_rates[riskGroup] || 0;
    return roundDownTo1000((stbh / 1000) * rate);
}

function calculateHospitalSupportPremium(customer, state, totalHospitalSupportStbh, ageOverride = null) {
    const ageToUse = ageOverride ?? customer.age;
    const { stbh } = customer.supplements.hospital_support || {};
    if (!stbh) return 0;
    const rate = product_data.hospital_fee_support_rates.find(r => ageToUse >= r.ageMin && ageToUse <= r.ageMax)?.rate || 0;
    return roundDownTo1000((stbh / 100) * rate);
}

// ===================================================================================
// ===== MODULE: UI RENDERING
// ===================================================================================
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function render(state) {
    renderPerson(state.persons['main-person']);
    renderSupplementaryPersons(state);
    renderMainProductSection(state);
    Object.values(state.persons).forEach(person => renderSupplementaryProductsForPerson(person, state));
    if (window.MDP3) MDP3.render(state);
    renderSummary(state);
    updateSupplementaryAddButtonState(state);
    updatePaymentFrequencyOptions(state);
}

function renderPerson(personState) {
    const container = $(personState.isMain ? '#main-person-container' : `#person-container-${personState.id}`);
    if (!container) return;
    const setValue = (sel, val) => { const el = container.querySelector(sel); if (el) el.value = val; };
    const setText = (sel, val) => { const el = container.querySelector(sel); if (el) el.textContent = val; };

    setValue('.name-input', personState.name);
    setValue('.dob-input', personState.dob);
    setValue('.gender-select', personState.gender);
    setValue('.occupation-input', personState.occupationName);
    setText('.age-span', personState.age);
    setText('.risk-group-span', personState.riskGroup > 0 ? personState.riskGroup : '...');
}

function renderSupplementaryPersons(state) {
    const container = $('#supplementary-insured-container');
    container.innerHTML = state.supplementaryPersonIds.map(id => generateSupplementaryPersonHtml(state.persons[id], state)).join('');
}

function renderMainProductSection(state) {
    const { mainProduct, persons } = state;
    const mainPerson = persons['main-person'];
    const select = $('#main-product');
    
    // Update eligibility
    $$('#main-product option').forEach(opt => {
        if (!opt.value) return;
        const strategy = PRODUCT_STRATEGIES[opt.value];
        const isEligible = strategy ? strategy.isEligible(mainPerson) : false;
        opt.disabled = !isEligible;
        opt.classList.toggle('hidden', !isEligible);
    });
    select.value = mainProduct.key;

    const container = $('#main-product-options-container');
    const strategy = PRODUCT_STRATEGIES[mainProduct.key];
    if (!strategy) {
        container.innerHTML = '';
        return;
    }

    let html = '';
    // STBH field
    if (strategy.stbh) { // Trọn Tâm An
        html += `<div><label class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH)</label><input type="text" class="form-input bg-gray-100" value="${formatCurrency(strategy.stbh)}" disabled></div>`;
    } else if (strategy.isRateBased || !strategy.isRateBased) {
        html += `<div><label class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH) <span class="text-red-600">*</span></label><input type="text" class="form-input" id="main-stbh" value="${formatCurrency(mainProduct.stbh)}" placeholder="VD: 1.000.000.000"></div>`;
    }
    // Premium field (for MUL)
    if (!strategy.isRateBased) {
        const validation = strategy.validatePremium(state);
        html += `<div><label class="font-medium text-gray-700 block mb-1">Phí sản phẩm chính</label><input type="text" id="main-premium-input" class="form-input" value="${formatCurrency(mainProduct.premium)}" placeholder="Nhập phí"><div class="text-sm text-gray-500 mt-1">${validation.message}</div></div>`;
    }
    // ABUV Term field
    if (strategy.getPaymentTermOptions) {
        const options = strategy.getPaymentTermOptions(mainPerson.age);
        const optionsHtml = options.map(opt => `<option value="${opt.value}" ${mainProduct.abuvTerm === opt.value ? 'selected' : ''}>${opt.text}</option>`).join('');
        html += `<div><label class="font-medium text-gray-700 block mb-1">Thời hạn đóng phí <span class="text-red-600">*</span></label><select id="abuv-term" class="form-select"><option value="">-- Chọn --</option>${optionsHtml}</select></div>`;
    }
    // General Payment Term field
    if (strategy.getPaymentTermBounds && !strategy.getPaymentTermOptions) {
        const bounds = strategy.getPaymentTermBounds(mainPerson.age);
        if(bounds.min !== bounds.max) {
             html += `<div><label class="font-medium text-gray-700 block mb-1">Thời gian đóng phí (năm) <span class="text-red-600">*</span></label><input type="number" id="payment-term" class="form-input" value="${mainProduct.paymentTerm}" min="${bounds.min}" max="${bounds.max}" placeholder="VD: 20"><div class="text-sm text-gray-500 mt-1">Nhập từ ${bounds.min} đến ${bounds.max} năm.</div></div>`;
        }
    }
     // Extra Premium
    if (mainProduct.key && mainProduct.key !== 'TRON_TAM_AN') {
        html += `<div><label class="font-medium text-gray-700 block mb-1">Phí đóng thêm</label><input type="text" id="extra-premium-input" class="form-input" value="${formatCurrency(mainProduct.extraPremium)}" placeholder="VD: 10.000.000"><div class="text-sm text-gray-500 mt-1">Tối đa ${CONFIG.EXTRA_PREMIUM_MAX_FACTOR} lần phí chính.</div></div>`;
    }

    container.innerHTML = html;
    const feeDisplay = $('#main-product-fee-display');
    if (state.fees.baseMain > 0) {
        let text = `Phí SP chính: ${formatCurrency(state.fees.baseMain)}`;
        if(state.fees.extra > 0) text += ` | Phí đóng thêm: ${formatCurrency(state.fees.extra)}`;
        feeDisplay.textContent = text;
    } else {
        feeDisplay.textContent = '';
    }
}

function renderSupplementaryProductsForPerson(person, state) {
    const container = $(person.isMain ? '#main-supp-container' : `#person-container-${person.id}`);
    if (!container) return;
    const suppContainer = container.querySelector('.supplementary-products-container');
    if (!suppContainer.innerHTML) suppContainer.innerHTML = generateBaseSupplementaryHtml();

    const isTTA = state.mainProduct.key === 'TRON_TAM_AN';

    CONFIG.supplementaryProducts.forEach(prod => {
        const section = suppContainer.querySelector(`.${prod.id}-section`);
        if (!section) return;

        const isEligible = person.daysFromBirth >= 30 && person.age <= prod.maxEntryAge &&
            (prod.id !== 'health_scl' || (person.riskGroup > 0 && person.riskGroup < 4)) &&
            (!isTTA || prod.id === 'health_scl');

        section.classList.toggle('hidden', !isEligible);
        
        const checkbox = section.querySelector(`.${prod.id}-checkbox`);
        const optionsDiv = section.querySelector('.product-options');
        const feeDisplay = section.querySelector('.fee-display');

        checkbox.disabled = !isEligible;
        checkbox.checked = !!person.supplements[prod.id];
        optionsDiv.classList.toggle('hidden', !checkbox.checked);

        if (checkbox.checked) {
            const fee = state.fees.byPerson[person.id]?.suppDetails?.[prod.id] || 0;
            feeDisplay.textContent = fee > 0 ? `Phí: ${formatCurrency(fee)}` : '';
        } else {
             feeDisplay.textContent = '';
        }
    });
}

function renderSummary(state) {
    const { fees, paymentFrequency } = state;
    $('#summary-main-fee').textContent = formatCurrency(fees.baseMain);
    $('#summary-extra-fee').textContent = formatCurrency(fees.extra);
    $('#summary-supp-fee').textContent = formatCurrency(fees.totalSupp);
    $('#summary-total').textContent = formatCurrency(fees.total);

    const breakdownBox = $('#frequency-breakdown');
    if (paymentFrequency === 'year') {
        breakdownBox.classList.add('hidden');
    } else {
        const periods = paymentFrequency === 'half' ? 2 : 4;
        const factor = periods === 2 ? 1.02 : 1.04;
        const perMain = Math.round(fees.baseMain / periods / 1000) * 1000;
        const perExtra = Math.round(fees.extra / periods / 1000) * 1000;
        const perSupp = Math.round((fees.totalSupp * factor) / periods / 1000) * 1000;
        const perTotal = perMain + perExtra + perSupp;
        const annualEq = perTotal * periods;
        const diff = annualEq - fees.total;

        breakdownBox.innerHTML = `
            <p>Phí đóng theo kỳ (${paymentFrequency === 'half' ? 'nửa năm' : 'quý'}): <span class="font-bold">${formatCurrency(perTotal)}</span></p>
            <p>Tổng phí quy năm: <span class="font-bold">${formatCurrency(annualEq)}</span></p>
            <p>Chênh lệch so với đóng năm: <span class="font-bold text-yellow-300">${formatCurrency(diff)}</span></p>
        `;
        breakdownBox.classList.remove('hidden');
    }
}

function updateSupplementaryAddButtonState(state) {
    const btn = $('#add-supp-insured-btn');
    const isTTA = state.mainProduct.key === 'TRON_TAM_AN';
    const isMax = state.supplementaryPersonIds.length >= CONFIG.MAX_SUPPLEMENTARY_INSURED;
    btn.disabled = isTTA || isMax;
    btn.classList.toggle('opacity-50', isTTA || isMax);
    btn.classList.toggle('cursor-not-allowed', isTTA || isMax);
    btn.classList.toggle('hidden', isTTA);
}

function updatePaymentFrequencyOptions(state) {
    const sel = $('#payment-frequency');
    if (!sel) return;
    const allowHalf = state.fees.baseMain >= CONFIG.PAYMENT_FREQUENCY_THRESHOLDS.half;
    const allowQuarter = state.fees.baseMain >= CONFIG.PAYMENT_FREQUENCY_THRESHOLDS.quarter;

    sel.querySelector('option[value="half"]').disabled = !allowHalf;
    sel.querySelector('option[value="quarter"]').disabled = !allowQuarter;

    if (sel.value === 'quarter' && !allowQuarter) sel.value = 'year';
    if (sel.value === 'half' && !allowHalf) sel.value = 'year';
}

// ===================================================================================
// ===== MODULE: HTML GENERATORS
// ===================================================================================
function generateSupplementaryPersonHtml(personState, state) {
    const count = state.supplementaryPersonIds.indexOf(personState.id) + 1;
    return `
    <div id="person-container-${personState.id}" class="person-container p-6 bg-gray-100 rounded-lg mt-4" data-person-id="${personState.id}">
        <div class="text-right mb-2">
            <button class="text-sm text-red-600 font-semibold" data-action="remove-supp">Xóa NĐBH này</button>
        </div>
        <h3 class="text-xl font-bold text-gray-700 mb-4 border-t pt-4">NĐBH Bổ Sung ${count}</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div><label class="font-medium text-gray-700 block mb-1">Họ và Tên</label><input type="text" class="form-input name-input" value="${sanitizeHtml(personState.name)}" data-field="name"></div>
            <div><label class="font-medium text-gray-700 block mb-1">Ngày sinh</label><input type="text" class="form-input dob-input" value="${personState.dob}" placeholder="DD/MM/YYYY" data-field="dob"></div>
            <div><label class="font-medium text-gray-700 block mb-1">Giới tính</label>
                <select class="form-select gender-select" data-field="gender">
                    <option value="Nam" ${personState.gender === 'Nam' ? 'selected' : ''}>Nam</option>
                    <option value="Nữ" ${personState.gender === 'Nữ' ? 'selected' : ''}>Nữ</option>
                </select>
            </div>
            <div class="flex items-end"><p class="text-lg">Tuổi: <span class="font-bold text-blue-600 age-span">${personState.age}</span></p></div>
            <div class="relative"><label class="font-medium text-gray-700 block mb-1">Nghề nghiệp</label><input type="text" class="form-input occupation-input" value="${sanitizeHtml(personState.occupationName)}" placeholder="Gõ để tìm..." data-field="occupationName"><div class="occupation-autocomplete"></div></div>
            <div class="flex items-end"><p class="text-lg">Nhóm nghề: <span class="font-bold text-blue-600 risk-group-span">${personState.riskGroup || '...'}</span></p></div>
        </div>
        <div class="mt-6"><h4 class="text-lg font-semibold text-gray-800">Sản phẩm bổ sung</h4><div class="supplementary-products-container space-y-6 mt-2"></div></div>
    </div>`;
}

function generateBaseSupplementaryHtml() {
    return CONFIG.supplementaryProducts.map(prod => {
        let optionsHtml = '';
        if (prod.id === 'health_scl') {
            optionsHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label class="font-medium text-gray-700 block mb-1">Quyền lợi chính</label><select class="form-select health-scl-program" data-supp-field="program"><option value="">-- Chọn --</option><option value="co_ban">Cơ bản</option><option value="nang_cao">Nâng cao</option><option value="toan_dien">Toàn diện</option><option value="hoan_hao">Hoàn hảo</option></select></div>
                <div><label class="font-medium text-gray-700 block mb-1">Phạm vi</label><select class="form-select health-scl-scope" data-supp-field="scope"><option value="main_vn">Việt Nam</option></select></div>
            </div>
            <div class="mt-4"><span class="font-medium text-gray-700 block mb-2">Tùy chọn:</span><div class="space-y-2">
                <label class="flex items-center"><input type="checkbox" class="form-checkbox" data-supp-field="outpatient"> <span class="ml-2">Ngoại trú</span></label>
                <label class="flex items-center"><input type="checkbox" class="form-checkbox" data-supp-field="dental"> <span class="ml-2">Nha khoa</span></label>
            </div></div>`;
        } else {
            optionsHtml = `<div><label class="font-medium text-gray-700 block mb-1">Số tiền bảo hiểm (STBH)</label><input type="text" class="form-input ${prod.id}-stbh" placeholder="Nhập STBH" data-supp-field="stbh"></div>`;
        }
        return `
        <div class="product-section ${prod.id}-section hidden border-t pt-4">
            <label class="flex items-center space-x-3 cursor-pointer">
                <input type="checkbox" class="form-checkbox ${prod.id}-checkbox" data-supp-id="${prod.id}">
                <span class="text-lg font-medium text-gray-800">${prod.name}</span>
            </label>
            <div class="product-options hidden mt-3 pl-8 space-y-3">
                ${optionsHtml}
                <div class="text-right font-semibold text-blue-600 fee-display min-h-[1.5rem]"></div>
            </div>
        </div>`;
    }).join('');
}
// ===================================================================================
// ===== MODULE: INITIALIZATION & EVENT BINDING
// ===================================================================================
function runWorkflow() {
    const calculatedFees = performCalculations(appState);
    appState.fees = calculatedFees;
    render(appState);
}

function attachGlobalListeners() {
    const appContainer = $('#app-container');
    if (!appContainer) return;

    appContainer.addEventListener('change', e => {
        const target = e.target;
        const personId = target.closest('.person-container')?.dataset.personId;

        if (target.id === 'main-product') updateMainProduct({ key: target.value });
        else if (target.id === 'payment-frequency') updatePaymentFrequency(target.value);
        else if (target.id === 'abuv-term') updateMainProduct({ abuvTerm: target.value });
        else if (target.dataset.field && personId) updatePerson(personId, { [target.dataset.field]: target.value });
        else if (target.dataset.suppId && personId) toggleSupplement(personId, target.dataset.suppId, target.checked);
        else if (target.dataset.suppField && personId) {
            const suppId = target.closest('.product-section').className.match(/(\w+)-section/)[1];
            const value = target.type === 'checkbox' ? target.checked : target.value;
            updateSupplementDetails(personId, suppId, { [target.dataset.suppField]: value });
        }
    });

    appContainer.addEventListener('input', e => {
        const target = e.target;
        if (target.id === 'main-stbh' || target.id === 'main-premium-input' || target.id === 'extra-premium-input' || target.classList.contains('form-input') && target.type === 'text' && !target.classList.contains('dob-input')) {
             // Debounce input to avoid excessive re-renders
            clearTimeout(target.debounce);
            target.debounce = setTimeout(() => {
                const value = parseFormattedNumber(target.value);
                target.value = formatCurrency(value);
                if (target.id === 'main-stbh') updateMainProduct({ stbh: value });
                else if (target.id === 'main-premium-input') updateMainProduct({ premium: value });
                else if (target.id === 'extra-premium-input') updateMainProduct({ extraPremium: value });
                else if (target.dataset.field) {
                    const personId = target.closest('.person-container')?.dataset.personId;
                    if (personId) updatePerson(personId, { [target.dataset.field]: target.value });
                } else if (target.dataset.suppField) {
                     const personId = target.closest('.person-container')?.dataset.personId;
                     const suppId = target.closest('.product-section').className.match(/(\w+)-section/)[1];
                     if(personId && suppId) updateSupplementDetails(personId, suppId, { stbh: value });
                }
            }, 400);
        } else if (target.id === 'payment-term') {
             clearTimeout(target.debounce);
             target.debounce = setTimeout(() => {
                updateMainProduct({ paymentTerm: parseInt(target.value, 10) || 0 });
            }, 400);
        }
    });

    appContainer.addEventListener('click', e => {
        const target = e.target;
        if (target.dataset.action === 'add-supp') addSupplementaryPerson();
        if (target.dataset.action === 'remove-supp') {
            const personId = target.closest('.person-container')?.dataset.personId;
            if (personId) removeSupplementaryPerson(personId);
        }
        if (target.id === 'view-summary-btn') { alert("Chức năng 'Xem Bảng Minh Họa Chi Tiết' đang được phát triển."); }
        if (target.id === 'close-summary-modal-btn') { $('#summary-modal').classList.add('hidden'); }
    });
    
    // Autocomplete for occupation
    appContainer.addEventListener('input', e => {
        if (!e.target.classList.contains('occupation-input')) return;
        const input = e.target;
        const personId = input.closest('.person-container').dataset.personId;
        const list = input.nextElementSibling;
        const value = input.value.toLowerCase();
        if (value.length < 2) { list.innerHTML = ''; return; }
        const filtered = product_data.occupations.filter(o => o.name.toLowerCase().includes(value));
        list.innerHTML = filtered.map(o => `<div class="p-2 hover:bg-gray-100 cursor-pointer" data-name="${o.name}" data-group="${o.group}">${o.name} (Nhóm ${o.group})</div>`).join('');
    });
    
    appContainer.addEventListener('mousedown', e => {
        if (!e.target.parentElement.classList.contains('occupation-autocomplete')) return;
        const target = e.target;
        const personId = target.closest('.person-container').dataset.personId;
        const occupationName = target.dataset.name;
        const riskGroup = parseInt(target.dataset.group, 10);
        updatePerson(personId, { occupationName, riskGroup });
        target.parentElement.innerHTML = '';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    appState = createInitialState();
    if (window.MDP3) MDP3.init();
    attachGlobalListeners();
    runWorkflow();
});

// Mock MDP3 object to avoid errors if not present
window.MDP3 = window.MDP3 || {
    init: () => {},
    render: () => {},
    reset: () => {},
    calculateFee: () => {}
};
