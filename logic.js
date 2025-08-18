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
            const genderKey = state.persons['main-person-container'].gender === 'Nữ' ? 'nu' : 'nam';
            return product_data.pul_rates[state.mainProduct.key]?.find(r => r.age === age)?.[genderKey] || 0;
        },
        getPaymentTermBounds: (age) => ({ min: 4, max: Math.max(0, 100 - age - 1) }),
        isEligible: (person) => person.daysFromBirth >= 30 && person.age <= 70,
    },
    get PUL_TRON_DOI() { return this._basePUL; },
    get PUL_15_NAM() { return this._basePUL; },
    get PUL_5_NAM() { return this._basePUL; },
    _baseMUL: {
        isRateBased: false,
        getPaymentTermBounds: (age) => ({ min: 4, max: Math.max(0, 100 - age - 1) }),
        isEligible: (person) => person.daysFromBirth >= 30 && person.age <= 70,
    },
    get KHOE_BINH_AN() { return this._baseMUL; },
    get VUNG_TUONG_LAI() { return this._baseMUL; },
    TRON_TAM_AN: {
        isRateBased: true, stbh: 100000000,
        getRate: (state, age) => {
            const genderKey = state.persons['main-person-container'].gender === 'Nữ' ? 'nu' : 'nam';
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
            const genderKey = state.persons['main-person-container'].gender === 'Nữ' ? 'nu' : 'nam';
            return product_data.an_binh_uu_viet_rates[abuvTerm]?.find(r => r.age === age)?.[genderKey] || 0;
        },
        getPaymentTermOptions: (age) => {
            const options = [];
            if (age <= 65) options.push({ value: '5', text: '5 năm' });
            if (age <= 60) options.push({ value: '10', text: '10 năm' });
            if (age <= 55) options.push({ value: '15', text: '15 năm' });
            return options;
        },
        isEligible: (person) => ((person.gender === 'Nam' ? person.age >= 12 : person.age >= 28) && person.age <= 65),
    }
};

// ===================================================================================
// ===== STATE MANAGEMENT & UPDATERS
// ===================================================================================
let appState = {};

function createInitialState() {
    return {
        mainProduct: { key: '', stbh: 0, premium: 0, paymentTerm: 0, extraPremium: 0, abuvTerm: '' },
        paymentFrequency: 'year',
        persons: {
            'main-person-container': { id: 'main-person-container', isMain: true, name: '', dob: '', age: 0, daysFromBirth: 0, gender: 'Nam', riskGroup: 0, occupationName: '', supplements: {} }
        },
        supplementaryPersonIds: [],
        fees: { baseMain: 0, extra: 0, totalMain: 0, totalSupp: 0, total: 0, byPerson: {} },
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

function updatePerson(personId, props) {
    const person = appState.persons[personId];
    if (!person) return;
    Object.assign(person, props);
    if (props.dob !== undefined) {
        const { age, daysFromBirth } = calculateAge(props.dob);
        person.age = age; person.daysFromBirth = daysFromBirth;
        if (person.isMain) {
            const strategy = PRODUCT_STRATEGIES[appState.mainProduct.key];
            if (strategy && !strategy.isEligible(person)) {
                updateMainProduct({ key: '' });
            }
            if (window.MDP3) MDP3.reset();
        }
    }
    runWorkflow();
}

function addSupplementaryPerson() {
    if (appState.supplementaryPersonIds.length >= CONFIG.MAX_SUPPLEMENTARY_INSURED) return;
    const personId = `supp-${Date.now()}`;
    appState.persons[personId] = { id: personId, isMain: false, name: '', dob: '', age: 0, daysFromBirth: 0, gender: 'Nam', riskGroup: 0, occupationName: '', supplements: {} };
    appState.supplementaryPersonIds.push(personId);
    if (window.MDP3) MDP3.reset(); // BỔ SUNG LOGIC RESET
    runWorkflow();
}

function removeSupplementaryPerson(personId) {
    delete appState.persons[personId];
    appState.supplementaryPersonIds = appState.supplementaryPersonIds.filter(id => id !== personId);
    if (window.MDP3) MDP3.reset(); // BỔ SUNG LOGIC RESET
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

// ===================================================================================
// ===== HELPERS
// ===================================================================================
function roundDownTo1000(n) { return Math.floor(Number(n || 0) / 1000) * 1000; }
function parseFormattedNumber(s) { return parseInt(String(s || '0').replace(/[.,]/g, ''), 10) || 0; }
function formatCurrency(v, s = '') { return (Number(v) || 0).toLocaleString('vi-VN') + (s || ''); }

function calculateAge(dobStr) {
    if (!dobStr || !/^\d{2}\/\d{2}\/\d{4}$/.test(dobStr)) return { age: 0, daysFromBirth: 0 };
    const [dd, mm, yyyy] = dobStr.split('/').map(n => parseInt(n, 10));
    const birthDate = new Date(yyyy, mm - 1, dd);
    const refDate = CONFIG.getReferenceDate();
    if (isNaN(birthDate.getTime()) || birthDate > refDate || birthDate.getFullYear() !== yyyy) return { age: 0, daysFromBirth: 0 };
    const daysFromBirth = Math.floor((refDate - birthDate) / (1000 * 60 * 60 * 24));
    let age = refDate.getFullYear() - birthDate.getFullYear();
    const m = refDate.getMonth() - birthDate.getMonth();
    if (m < 0 || (m === 0 && refDate.getDate() < birthDate.getDate())) age--;
    return { age, daysFromBirth };
}

// ===================================================================================
// ===== LOGIC & CALCULATIONS
// ===================================================================================
function performCalculations(state) {
    const fees = { baseMain: 0, extra: 0, totalSupp: 0, byPerson: {} };
    fees.baseMain = calculateMainPremiumFee(state);
    fees.extra = state.mainProduct.extraPremium;
    const allPersons = [state.persons['main-person-container'], ...state.supplementaryPersonIds.map(id => state.persons[id])];
    allPersons.forEach(p => { fees.byPerson[p.id] = { main: 0, supp: 0, total: 0, suppDetails: {} }; });
    if (fees.byPerson['main-person-container']) fees.byPerson['main-person-container'].main = fees.baseMain + fees.extra;
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
    fees.totalMain = fees.baseMain + fees.extra;
    fees.total = fees.totalMain + fees.totalSupp;
    return fees;
}

function calculateMainPremiumFee(state, ageOverride = null) {
    const { mainProduct, persons } = state;
    const strategy = PRODUCT_STRATEGIES[mainProduct.key];
    if (!strategy) return 0;
    const ageToUse = ageOverride ?? persons['main-person-container'].age;
    let premium = 0;
    if (strategy.isRateBased) {
        premium = (strategy.stbh || mainProduct.stbh) / 1000 * strategy.getRate(state, ageToUse);
    } else {
        premium = mainProduct.premium;
    }
    return roundDownTo1000(premium);
}

function calculateHealthSclPremium(customer, state) {
    const ageToUse = customer.age;
    const { program, scope, outpatient, dental } = customer.supplements.health_scl || {};
    if (!program || !scope) return 0;
    const ageBandIndex = product_data.health_scl_rates.age_bands.findIndex(b => ageToUse >= b.min && ageToUse <= b.max);
    if (ageBandIndex === -1) return 0;
    let totalPremium = (product_data.health_scl_rates.main_vn || [])[ageBandIndex]?.[program] || 0;
    if (outpatient) totalPremium += (product_data.health_scl_rates.outpatient || [])[ageBandIndex]?.[program] || 0;
    if (dental) totalPremium += (product_data.health_scl_rates.dental || [])[ageBandIndex]?.[program] || 0;
    return roundDownTo1000(totalPremium);
}

function calculateBhnPremium(customer) {
    const { stbh } = customer.supplements.bhn;
    if (!stbh) return 0;
    const rate = product_data.bhn_rates.find(r => customer.age >= r.ageMin && customer.age <= r.ageMax)?.[customer.gender === 'Nữ' ? 'nu' : 'nam'] || 0;
    return roundDownTo1000((stbh / 1000) * rate);
}

function calculateAccidentPremium(customer) {
    if (customer.riskGroup === 0 || customer.riskGroup > 4) return 0;
    const { stbh } = customer.supplements.accident;
    if (!stbh) return 0;
    const rate = product_data.accident_rates[customer.riskGroup] || 0;
    return roundDownTo1000((stbh / 1000) * rate);
}

function calculateHospitalSupportPremium(customer) {
    const { stbh } = customer.supplements.hospital_support || {};
    if (!stbh) return 0;
    const rate = product_data.hospital_fee_support_rates.find(r => customer.age >= r.ageMin && customer.age <= r.ageMax)?.rate || 0;
    return roundDownTo1000((stbh / 100) * rate);
}

// ===================================================================================
// ===== UI RENDERING
// ===================================================================================
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function render(state) {
    renderPerson(state.persons['main-person-container']);
    renderSupplementaryPersons(state);
    renderMainProductSection(state);
    Object.values(state.persons).forEach(person => renderSupplementaryProductsForPerson(person, state));
    renderSummary(state);
    updateSupplementaryAddButtonState(state);
}

function renderPerson(personState) {
    const container = $(`#${personState.id}`);
    if (!container) return;
    container.querySelector('.age-span').textContent = personState.age;
    container.querySelector('.risk-group-span').textContent = personState.riskGroup > 0 ? personState.riskGroup : '...';
}

function renderSupplementaryPersons(state) {
    const container = $('#supplementary-insured-container');
    const template = $('#supplementary-person-template');
    container.innerHTML = '';
    state.supplementaryPersonIds.forEach((id, index) => {
        const person = state.persons[id];
        const clone = template.content.cloneNode(true);
        const personDiv = clone.querySelector('.person-container');
        personDiv.id = id;
        clone.querySelector('[data-template-id="title"]').textContent = `NĐBH Bổ Sung ${index + 1}`;
        clone.querySelector('.name-input').value = person.name;
        clone.querySelector('.dob-input').value = person.dob;
        clone.querySelector('.gender-select').value = person.gender;
        clone.querySelector('.occupation-input').value = person.occupationName;
        container.appendChild(clone);
        renderPerson(person);
    });
}

function renderMainProductSection(state) {
    const { mainProduct, persons } = state;
    const mainPerson = persons['main-person-container'];
    const select = $('#main-product');
    $$('#main-product option').forEach(opt => {
        if (!opt.value) return;
        const strategy = PRODUCT_STRATEGIES[opt.value];
        const isEligible = strategy ? strategy.isEligible(mainPerson) : false;
        opt.disabled = !isEligible;
    });
    if (select.value !== mainProduct.key) select.value = mainProduct.key;
    const container = $('#main-product-options');
    const strategy = PRODUCT_STRATEGIES[mainProduct.key];
    if (!strategy) { container.innerHTML = ''; $('#main-product-fee-display').innerHTML = ''; return; }
    
    let html = '';
    if (strategy.stbh) {
        html += `<div><label class="font-medium">STBH</label><input type="text" class="form-input bg-gray-100" value="${formatCurrency(strategy.stbh)}" disabled> <p class="text-sm text-gray-500 mt-1">Thời hạn đóng phí và bảo vệ: 10 năm.</p></div>`;
    } else {
        html += `<div><label class="font-medium">STBH</label><input type="text" id="main-stbh" class="form-input" value="${formatCurrency(mainProduct.stbh)}" placeholder="VD: 1.000.000.000"></div>`;
    }
    if (!strategy.isRateBased) {
        html += `<div><label class="font-medium">Phí sản phẩm chính</label><input type="text" id="main-premium-input" class="form-input" value="${formatCurrency(mainProduct.premium)}" placeholder="Nhập phí"></div>`;
    }
    if (strategy.getPaymentTermOptions) {
        const optionsHtml = strategy.getPaymentTermOptions(mainPerson.age).map(opt => `<option value="${opt.value}" ${mainProduct.abuvTerm === opt.value ? 'selected' : ''}>${opt.text}</option>`).join('');
        html += `<div><label class="font-medium">Thời hạn đóng phí</label><select id="abuv-term" class="form-select"><option value="">-- Chọn --</option>${optionsHtml}</select><p class="text-sm text-gray-500 mt-1">Thời hạn đóng phí bằng thời hạn hợp đồng.</p></div>`;
    }
    if (strategy.getPaymentTermBounds) {
        const bounds = strategy.getPaymentTermBounds(mainPerson.age);
        html += `<div><label class="font-medium">Thời gian đóng phí (năm)</label><input type="number" id="payment-term" class="form-input" value="${mainProduct.paymentTerm}" min="${bounds.min}" max="${bounds.max}" placeholder="VD: 20"><div class="text-sm text-gray-500 mt-1">Nhập từ ${bounds.min} đến ${bounds.max} năm.</div></div>`;
    }
    if (mainProduct.key && mainProduct.key !== 'TRON_TAM_AN') {
        html += `<div><label class="font-medium">Phí đóng thêm</label><input type="text" id="extra-premium-input" class="form-input" value="${formatCurrency(mainProduct.extraPremium)}" placeholder="VD: 10.000.000"><div class="text-sm text-gray-500 mt-1">Tối đa ${CONFIG.EXTRA_PREMIUM_MAX_FACTOR} lần phí chính.</div></div>`;
    }
    
    container.innerHTML = html;
    const feeDisplay = $('#main-product-fee-display');
    if (state.fees.baseMain > 0) {
        feeDisplay.textContent = `Phí SP chính: ${formatCurrency(state.fees.baseMain)}`;
        if (state.fees.extra > 0) feeDisplay.textContent += ` | Phí đóng thêm: ${formatCurrency(state.fees.extra)}`;
    } else {
        feeDisplay.textContent = '';
    }
}

function renderSupplementaryProductsForPerson(person, state) {
    const container = $(`#${person.id} .supplementary-products-container`);
    if (!container) return;
    if (!container.innerHTML) container.innerHTML = generateBaseSupplementaryHtml();

    const isTTA = state.mainProduct.key === 'TRON_TAM_AN';
    const mainPremium = state.fees.baseMain;

    CONFIG.supplementaryProducts.forEach(prod => {
        const section = container.querySelector(`.${prod.id}-section`);
        if (!section) return;
        const isEligible = person.daysFromBirth >= 30 && person.age <= prod.maxEntryAge &&
            (prod.id !== 'health_scl' || (person.riskGroup > 0 && person.riskGroup < 4)) &&
            (!isTTA || prod.id === 'health_scl');
        section.classList.toggle('hidden', !isEligible);
        
        const checkbox = section.querySelector(`.${prod.id}-checkbox`);
        checkbox.disabled = !isEligible;
        checkbox.checked = !!person.supplements[prod.id];
        
        const optionsDiv = section.querySelector('.product-options');
        optionsDiv.classList.toggle('hidden', !checkbox.checked);

        if (isEligible && prod.id === 'health_scl') {
            const programSelect = section.querySelector('.health-scl-program');
            programSelect.querySelectorAll('option').forEach(opt => {
                if (opt.value === '') return;
                if (isTTA || mainPremium >= 15000000) opt.disabled = false;
                else if (mainPremium >= 10000000) opt.disabled = (opt.value === 'hoan_hao');
                else if (mainPremium >= 5000000) opt.disabled = !['co_ban', 'nang_cao'].includes(opt.value);
                else opt.disabled = true;
            });
        }
        
        // BỔ SUNG LOGIC: Hiển thị cảnh báo cho Hỗ trợ nằm viện
        if (isEligible && prod.id === 'hospital_support') {
            const maxByAge = person.age < 18 ? prod.maxStbhByAge.under18 : prod.maxStbhByAge.from18;
            const maxByPremium = Math.floor(mainPremium / 4000000) * 100000;
            const hint = `Tối đa: ${formatCurrency(Math.min(maxByAge, maxByPremium))}đ/ngày. Là bội số của 100.000.`;
            let hintEl = section.querySelector('.field-hint');
            if (!hintEl) {
                hintEl = document.createElement('p');
                hintEl.className = 'field-hint text-sm text-gray-500 mt-1';
                optionsDiv.appendChild(hintEl);
            }
            hintEl.textContent = hint;
        }

        if (checkbox.checked) {
            const fee = state.fees.byPerson[person.id]?.suppDetails?.[prod.id] || 0;
            section.querySelector('.fee-display').textContent = fee > 0 ? `Phí: ${formatCurrency(fee)}` : '';
        } else {
            section.querySelector('.fee-display').textContent = '';
        }
    });
}


function renderSummary(state) {
    const { fees, paymentFrequency } = state;
    const setText = (id, val) => { const el = $(id); if (el) el.textContent = formatCurrency(val); };
    setText('#summary-total', fees.total);
    setText('#main-insured-main-fee', fees.baseMain);
    setText('#main-insured-extra-fee', fees.extra);
    setText('#summary-supp-fee', fees.totalSupp);
    const freqSel = $('#payment-frequency');
    if (freqSel.value !== paymentFrequency) freqSel.value = paymentFrequency;
    const breakdownBox = $('#frequency-breakdown');
    if (paymentFrequency === 'year') {
        breakdownBox.classList.add('hidden');
    } else {
        const periods = paymentFrequency === 'half' ? 2 : 4;
        const factor = periods === 2 ? 1.02 : 1.04;
        const perMain = Math.round(fees.baseMain / periods / 1000) * 1000;
        const perExtra = Math.round(fees.extra / periods / 1000) * 1000;
        const perSupp = Math.round((fees.totalSupp * factor) / periods / 1000) * 1000;
        setText('#freq-main', perMain);
        setText('#freq-extra', perExtra);
        setText('#freq-supp-total', perSupp);
        setText('#freq-total-period', perMain + perExtra + perSupp);
        setText('#freq-total-year', fees.total);
        setText('#freq-diff', (perMain + perExtra + perSupp) * periods - fees.total);
        breakdownBox.classList.remove('hidden');
    }
}

function updateSupplementaryAddButtonState(state) {
    const btn = $('#add-supp-insured-btn');
    const isTTA = state.mainProduct.key === 'TRON_TAM_AN';
    const isMax = state.supplementaryPersonIds.length >= CONFIG.MAX_SUPPLEMENTARY_INSURED;
    btn.disabled = isTTA || isMax;
}

function generateBaseSupplementaryHtml() {
    return CONFIG.supplementaryProducts.map(prod => {
        let optionsHtml = '';
        if (prod.id === 'health_scl') {
            optionsHtml = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div><label class="font-medium text-sm">Quyền lợi</label><select class="form-select health-scl-program"><option value="">-- Chọn --</option><option value="co_ban">Cơ bản</option><option value="nang_cao">Nâng cao</option><option value="toan_dien">Toàn diện</option><option value="hoan_hao">Hoàn hảo</option></select></div>
                <div><label class="font-medium text-sm">Phạm vi</label><select class="form-select health-scl-scope"><option value="main_vn">Việt Nam</option></select></div>
            </div>
            <div class="mt-2"><div class="space-y-1">
                <label class="flex items-center"><input type="checkbox" class="form-checkbox health-scl-outpatient"> <span class="ml-2 text-sm">Ngoại trú</span></label>
                <label class="flex items-center"><input type="checkbox" class="form-checkbox health-scl-dental"> <span class="ml-2 text-sm">Nha khoa</span></label>
            </div></div>`;
        } else {
            optionsHtml = `<div><label class="font-medium text-sm">STBH</label><input type="text" class="form-input ${prod.id}-stbh" placeholder="Nhập STBH"></div>`;
        }
        return `<div class="product-section ${prod.id}-section hidden pt-4 border-t mt-4">
            <label class="flex items-center"><input type="checkbox" class="form-checkbox ${prod.id}-checkbox"><span class="ml-2 font-semibold text-gray-700">${prod.name}</span></label>
            <div class="product-options hidden mt-2 pl-6 space-y-2">${optionsHtml}<div class="text-right font-bold text-aia-red fee-display min-h-[1.5rem]"></div></div>
        </div>`;
    }).join('');
}
// ===================================================================================
// ===== INITIALIZATION & EVENT BINDING
// ===================================================================================
function runWorkflow() {
    const calculatedFees = performCalculations(appState);
    appState.fees = calculatedFees;
    render(appState);
}

function attachGlobalListeners() {
    const body = document.body;
    body.addEventListener('change', e => {
        const target = e.target;
        const personContainer = target.closest('.person-container');
        const personId = personContainer?.id;
        if (target.id === 'main-product') updateMainProduct({ key: target.value });
        else if (target.id === 'payment-frequency') { appState.paymentFrequency = target.value; runWorkflow(); }
        else if (target.id === 'abuv-term') updateMainProduct({ abuvTerm: target.value });
        else if (personId && target.classList.contains('name-input')) updatePerson(personId, { name: target.value });
        else if (personId && target.classList.contains('dob-input')) updatePerson(personId, { dob: target.value });
        else if (personId && target.classList.contains('gender-select')) updatePerson(personId, { gender: target.value });
        else if (personId && target.classList.contains('form-checkbox')) {
            const suppId = target.classList.item(1).replace('-checkbox', '');
            if (CONFIG.supplementaryProducts.some(p => p.id === suppId)) {
                toggleSupplement(personId, suppId, target.checked);
            }
        }
    });

    body.addEventListener('input', e => {
        const target = e.target;
        if (target.classList.contains('dob-input')) {
            let value = target.value.replace(/\D/g, '');
            if (value.length > 2) value = `${value.slice(0, 2)}/${value.slice(2)}`;
            if (value.length > 5) value = `${value.slice(0, 5)}/${value.slice(5, 9)}`;
            target.value = value.slice(0, 10);
            return;
        }
        if (target.classList.contains('occupation-input')) {
            const list = target.nextElementSibling;
            const value = target.value.toLowerCase();
            if (value.length < 2) { list.classList.add('hidden'); return; }
            const filtered = product_data.occupations.filter(o => o.name.toLowerCase().includes(value));
            list.innerHTML = filtered.map(o => `<div class="p-2 hover:bg-gray-100 cursor-pointer" data-action="select-occupation" data-name="${o.name}" data-group="${o.group}">${o.name} (Nhóm ${o.group})</div>`).join('');
            list.classList.remove('hidden');
            return;
        }
        clearTimeout(target.debounce);
        target.debounce = setTimeout(() => {
            const value = target.type === 'number' ? parseInt(target.value, 10) || 0 : target.value;
            if (target.id === 'payment-term') updateMainProduct({ paymentTerm: value });
            else if (['main-stbh', 'main-premium-input', 'extra-premium-input'].includes(target.id)) {
                const numValue = parseFormattedNumber(value);
                target.value = formatCurrency(numValue);
                if (target.id === 'main-stbh') updateMainProduct({ stbh: numValue });
                else if (target.id === 'main-premium-input') updateMainProduct({ premium: numValue });
                else if (target.id === 'extra-premium-input') updateMainProduct({ extraPremium: numValue });
            }
        }, 400);
    });
    
    body.addEventListener('click', e => {
        const target = e.target;
        if (target.id === 'add-supp-insured-btn') addSupplementaryPerson();
        if (target.classList.contains('remove-supp-btn')) removeSupplementaryPerson(target.closest('.person-container').id);
        if (target.dataset.action === 'select-occupation') {
            const personId = target.closest('.person-container').id;
            const occupationName = target.dataset.name;
            const riskGroup = parseInt(target.dataset.group, 10);
            updatePerson(personId, { occupationName, riskGroup });
            const input = target.closest('.relative').querySelector('.occupation-input');
            input.value = occupationName;
            target.parentElement.classList.add('hidden');
        }
        if (target.id === 'view-summary-btn') {
            const errorEl = $('#error-message');
            errorEl.textContent = '';
            try {
                alert("Chức năng 'Xem Bảng Minh Họa Chi Tiết' đang được phát triển.");
            } catch (err) {
                errorEl.textContent = `Lỗi: ${err.message}`;
            }
        }
        if (target.id === 'close-summary-modal-btn') { $('#summary-modal').classList.add('hidden'); }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    appState = createInitialState();
    attachGlobalListeners();
    runWorkflow();
});

// Mock MDP3 object để tương thích
window.MDP3 = {
    reset: () => { console.log("MDP3 Reset"); }
};
