/****************************************************************************************
 * File: logic.consolidated.fix.js
 * Mục tiêu: Bản đầy đủ đã tích hợp tất cả chỉnh sửa theo yêu cầu người dùng (2025-08).
 * Bạn chỉ cần copy & paste thay thế file cũ.
 *
 * TÓM TẮT NHỮNG SỬA ĐỔI QUAN TRỌNG:
 * 1. Phí sản phẩm chính vẫn hiển thị dù chưa nhập thời hạn đóng phí (paymentTerm).
 * 2. Không còn tình trạng tổng phí về 0 khi thêm người bổ sung thiếu dữ liệu (skip người đó).
 * 3. Auto-chọn sản phẩm bổ sung "Sức khỏe Bùng Gia Lực" (health_scl) với program 'nang_cao'
 *    khi chọn sản phẩm chính "Trọn Tâm An" (TRON_TAM_AN). Người dùng vẫn có thể bỏ chọn.
 * 4. Thêm placeholder dạng số cho các ô STBH sản phẩm bổ sung:
 *      - Bệnh hiểm nghèo 2.0 (bhn): 200000000-5000000000
 *      - Tai nạn (accident): 10000000-8000000000
 *      - Hỗ trợ viện phí (hospital_support): 300000-1000000 (giới hạn tùy tuổi, placeholder chung)
 * 5. Miễn đóng phí 3.0 (MDP3):
 *      - Hỗ trợ chọn 'other' (người khác): nhập DOB => tính tuổi, validate 18–60.
 *      - Nếu người khác hợp lệ, tạo pseudo-person "mdp3-other" trong tính phí & minh hoạ.
 *      - Phí MDP3 gộp vào phí bổ sung của người được áp dụng (hoặc pseudo-person).
 * 6. Minh hoạ "Phí đến năm tuổi": giá trị = (tuổi NĐBH chính + thời hạn đóng phí - 1).
 *      - Với TRON_TAM_AN & AN_BINH_UU_VIET: luôn khóa (readonly) và tự cập nhật, trừ 1 chuẩn.
 * 7. Bảng minh hoạ chi tiết (Phần 1) thêm dòng "Tổng cuối" (gồm cả pseudo-person MDP3).
 * 8. Bảng minh hoạ chi tiết (Phần 2) dùng hệ số quy đổi hiển thị:
 *      - year: 1.00, half: 1.02, quarter: 1.04 (không dùng 0.51 / 0.26 ở phần này).
 * 9. Tabs / nút xem từng người: hiển thị tổng phí bổ sung (gồm MDP3), realtime.
 * 10. Tên người “other” trong MDP3 lấy đúng tên người dùng nhập.
 * 11. Không auto-fill STBH nếu người dùng để trống, chỉ hiển thị placeholder gợi ý.
 *
 * LƯU Ý:
 * - Các hàm tính phí chi tiết (calculateHealthSclPremium, v.v.) nếu đã có ở file cũ bạn có
 *   thể giữ, ở đây có kèm stub/fallback an toàn. Nếu bạn có bảng phí chính xác hãy thay vào.
 * - Bạn cần đảm bảo HTML có các id được tham chiếu (đã ghi chú bên dưới).
 ***************************************************************************************/

import { product_data } from './data.js';

// ===================================================================================
// CONFIG & BUSINESS RULES
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
  // Hệ số để chuyển annual -> per-period (phần tóm tắt phía phải)
  PAYMENT_FREQUENCY_FACTORS: {
    year: { factor: 1 },
    half: { factor: 0.51 },    // Giữ logic cũ (nếu trước đây dùng)
    quarter: { factor: 0.26 },
    month: { factor: 0.09 }
  },
  // Hệ số hiển thị PHẦN 2 minh hoạ (không dùng 0.51/0.26)
  DISPLAY_FREQ_FACTORS: {
    year: 1.00,
    half: 1.02,
    quarter: 1.04,
    month: 1.00 // nếu có thêm tháng thì có thể chỉnh sau
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
// STATE
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
      other: null
    }
  };
}

// ===================================================================================
// SMALL UTILS
// ===================================================================================
function debounce(fn, wait = 120) {
  let t = null;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
}

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

function formatDisplayCurrency(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString('vi-VN') : '0';
}

function sanitizeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;').replace(/'/g, '&#39;');
}

function getPaymentTermBounds(age) {
  return { min: 4, max: Math.max(0, 100 - age - 1) };
}

// ===================================================================================
// DATA COLLECTION
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

  // MDP3 state gather (enable, selectedId handled later in gatherMdp3Data)
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
    if (
      birthDate.getFullYear() === yyyy &&
      birthDate.getMonth() === mm - 1 &&
      birthDate.getDate() === dd &&
      birthDate <= CONFIG.REFERENCE_DATE
    ) {
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
// AUTO CHỌN HEALTH_SCL KHI MAIN = TRON_TAM_AN
// ===================================================================================
let __autoSelectedHealthScl = false;

function ensureAutoSelectHealthScl(state) {
  try {
    if (!state?.mainProduct?.key) return;
    if (state.mainProduct.key === 'TRON_TAM_AN') {
      const mainSuppContainer = document.querySelector('#main-supp-container .supplementary-products-container');
      if (!mainSuppContainer) return;
      const section = mainSuppContainer.querySelector('.health_scl-section');
      const checkbox = section?.querySelector('.health_scl-checkbox');
      if (checkbox && !checkbox.checked && !__autoSelectedHealthScl) {
        checkbox.checked = true;
        const progSelect = section.querySelector('.health-scl-program');
        if (progSelect && !progSelect.value) {
          progSelect.value = 'nang_cao';
        }
        __autoSelectedHealthScl = true;
      }
    } else {
      __autoSelectedHealthScl = false;
    }
  } catch (e) {
    console.warn('ensureAutoSelectHealthScl error', e);
  }
}

// ===================================================================================
// MDP3 (Miễn đóng phí 3.0)
// ===================================================================================
function gatherMdp3Data(state) {
  if (!window.MDP3) {
    state.mdp3.enabled = !!document.getElementById('mdp3-enable-checkbox')?.checked;
  } else {
    // Nếu module MDP3 có method isEnabled
    state.mdp3.enabled = typeof window.MDP3.isEnabled === 'function'
      ? window.MDP3.isEnabled()
      : !!document.getElementById('mdp3-enable-checkbox')?.checked;
  }

  const sel = document.getElementById('mdp3-select');
  state.mdp3.selectedId = sel ? sel.value : null;

  if (state.mdp3.selectedId === 'other') {
    const nameInput = document.getElementById('mdp3-other-name');
    const dobInput = document.getElementById('mdp3-other-dob');
    const ageSpan = document.getElementById('mdp3-other-age');
    const errSpan = document.getElementById('mdp3-other-error');

    const nameVal = (nameInput?.value || '').trim() || 'Người khác';
    const dobStr = (dobInput?.value || '').trim();
    let age = 0;
    let valid = false;
    let errorMsg = '';

    if (/^\d{2}\/\d{2}\/\d{4}$/.test(dobStr)) {
      const [dd, mm, yyyy] = dobStr.split('/').map(n => parseInt(n, 10));
      const bd = new Date(yyyy, mm - 1, dd);
      if (
        bd.getFullYear() === yyyy &&
        bd.getMonth() === mm - 1 &&
        bd.getDate() === dd &&
        bd <= CONFIG.REFERENCE_DATE
      ) {
        age = CONFIG.REFERENCE_DATE.getFullYear() - bd.getFullYear();
        const m = CONFIG.REFERENCE_DATE.getMonth() - bd.getMonth();
        if (m < 0 || (m === 0 && CONFIG.REFERENCE_DATE.getDate() < bd.getDate())) {
          age--;
        }
        if (age >= 18 && age <= 60) {
          valid = true;
        } else {
          errorMsg = 'Tuổi phải từ 18 đến 60';
        }
      } else {
        errorMsg = 'Ngày sinh không hợp lệ';
      }
    } else if (dobStr) {
      errorMsg = 'Định dạng dd/mm/yyyy';
    }

    if (ageSpan) ageSpan.textContent = valid ? String(age) : '';
    if (errSpan) errSpan.textContent = errorMsg;

    state.mdp3.other = {
      name: nameVal,
      dob: dobStr,
      age,
      valid
    };
  } else {
    state.mdp3.other = null;
  }
}

function calculateMdp3Premium(age) {
  if (!age || age < 18 || age > 60) return 0;
  if (window.MDP3) {
    if (typeof window.MDP3.getPremium === 'function') {
      try { return Number(window.MDP3.getPremium(age)) || 0; } catch {}
    }
    if (typeof window.MDP3.calculatePremium === 'function') {
      try { return Number(window.MDP3.calculatePremium(age)) || 0; } catch {}
    }
  }
  // Fallback minh hoạ
  return 100000 + (age - 18) * 5000;
}

// ===================================================================================
// MINH HOẠ PHÍ ĐẾN NĂM (validate)
// ===================================================================================
function validateIllustrationAge(state) {
  const input = document.getElementById('illustration-age-input');
  if (!input) return;
  const mainAge = state.mainPerson?.age || 0;
  const paymentTerm = state.mainProduct?.paymentTerm || 0;
  const minAllowed = (mainAge && paymentTerm) ? (mainAge + paymentTerm - 1) : 0;

  const lockedProducts = ['TRON_TAM_AN', 'AN_BINH_UU_VIET'];
  const isLocked = lockedProducts.includes(state.mainProduct?.key);

  if (isLocked) {
    if (minAllowed > 0) input.value = String(minAllowed);
    input.readOnly = true;
    input.classList.remove('invalid');
    return;
  } else {
    input.readOnly = false;
  }

  const val = parseInt(input.value, 10);
  if (!isNaN(val) && val >= minAllowed) {
    input.classList.remove('invalid');
  } else {
    if (minAllowed > 0) {
      input.classList.add('invalid');
    } else {
      input.classList.remove('invalid');
    }
  }
}

// ===================================================================================
// HÀM TÍNH PHÍ CHÍNH & PHỤ (Stubs / Placeholder - thay bằng logic thực tế nếu có)
// ===================================================================================
function calculateMainPremium(mainPerson, mainProduct) {
  // Giả sử nếu người dùng nhập premium thủ công thì dùng luôn:
  if (mainProduct?.premium) return mainProduct.premium;

  // Ví dụ minh hoạ: premium = STBH * 0.01 (cần thay bằng công thức thực)
  if (mainProduct?.stbh) {
    return Math.round(mainProduct.stbh * 0.01);
  }
  return 0;
}

function calculateHealthSclPremium(person, supplementData, state) {
  if (!person?.age || person.age < 0) return 0;
  const program = supplementData?.program || 'co_ban';
  const baseStbh = CONFIG.supplementaryProducts.find(p => p.id === 'health_scl')?.stbhByProgram?.[program] || 0;
  // Ví dụ: phí = baseStbh * 0.005
  return Math.round(baseStbh * 0.005);
}

function calculateBhnPremium(person, supplementData, state) {
  const stbh = supplementData?.stbh || 0;
  if (!stbh) return 0;
  // Ví dụ: phí = stbh * 0.008
  return Math.round(stbh * 0.008);
}

function calculateAccidentPremium(person, supplementData, state) {
  const stbh = supplementData?.stbh || 0;
  if (!stbh) return 0;
  return Math.round(stbh * 0.002);
}

function calculateHospitalSupportPremium(person, supplementData, state) {
  const stbh = supplementData?.stbh || 0;
  if (!stbh) return 0;
  // Ví dụ: phí = stbh * 3 (ngày) => minh hoạ
  return Math.round(stbh * 3);
}

// ===================================================================================
// TÍNH TOÁN PHÍ (ĐÃ SỬA)
// ===================================================================================
function performCalculations(state) {
  const fees = {
    baseMain: 0,
    extra: Number(state.mainProduct?.extraPremium) || 0,
    totalMain: 0,
    totalSupp: 0,
    total: 0,
    byPerson: {}
  };

  // 1. PHÍ SẢN PHẨM CHÍNH (vẫn hiển thị dù paymentTerm=0)
  fees.baseMain = calculateMainPremium(state.mainPerson, state.mainProduct) || 0;
  fees.totalMain = fees.baseMain + fees.extra;

  // 2. Chuẩn bị danh sách người
  const persons = [state.mainPerson, ...(state.supplementaryPersons || [])].filter(p => !!p);

  persons.forEach(p => {
    fees.byPerson[p.id] = {
      name: p.name,
      main: p.isMain ? fees.baseMain + fees.extra : 0,
      supp: 0,
      suppDetails: {},
      total: 0
    };
  });

  // 3. TÍNH PHÍ SẢN PHẨM BỔ SUNG (skip nếu dữ liệu chưa hợp lệ)
  persons.forEach(p => {
    if (typeof p.age !== 'number' || p.age < 0) return;
    const supplements = p.supplements || {};
    Object.keys(supplements).forEach(sid => {
      const def = CONFIG.supplementaryProducts.find(sp => sp.id === sid);
      if (!def) return;

      let premium = 0;
      try {
        if (typeof def.calculationFunc === 'function') {
          premium = def.calculationFunc(p, supplements[sid], state);
        }
      } catch (e) {
        console.warn('Supplement calc error', sid, e);
      }
      premium = Number(premium) || 0;
      fees.byPerson[p.id].supp += premium;
      fees.byPerson[p.id].suppDetails[sid] = premium;
    });
  });

  // 4. MDP3
  if (state.mdp3?.enabled) {
    let mdp3Age = 0;
    let mdp3TargetId = null;
    let mdp3Name = '';
    if (state.mdp3.selectedId === 'other' && state.mdp3.other?.valid) {
      mdp3Age = state.mdp3.other.age;
      mdp3TargetId = 'mdp3-other';
      mdp3Name = state.mdp3.other.name;
    } else {
      const tgt = persons.find(p => p.id === state.mdp3.selectedId);
      if (tgt) {
        mdp3Age = tgt.age;
        mdp3TargetId = tgt.id;
        mdp3Name = tgt.name;
      }
    }
    if (mdp3TargetId && mdp3Age >= 18 && mdp3Age <= 60) {
      const mdp3Fee = calculateMdp3Premium(mdp3Age);
      if (mdp3TargetId === 'mdp3-other') {
        fees.byPerson[mdp3TargetId] = {
          name: mdp3Name,
          main: 0,
          supp: mdp3Fee,
          suppDetails: { mdp3: mdp3Fee },
          total: mdp3Fee
        };
      } else {
        if (!fees.byPerson[mdp3TargetId].suppDetails) {
          fees.byPerson[mdp3TargetId].suppDetails = {};
        }
        fees.byPerson[mdp3TargetId].supp += mdp3Fee;
        fees.byPerson[mdp3TargetId].suppDetails.mdp3 = (fees.byPerson[mdp3TargetId].suppDetails.mdp3 || 0) + mdp3Fee;
      }
    }
  }

  // 5. Tổng từng người & tổng supplement
  Object.keys(fees.byPerson).forEach(pid => {
    const rec = fees.byPerson[pid];
    rec.total = rec.main + rec.supp;
    if (rec.supp) fees.totalSupp += rec.supp;
  });

  // 6. Tổng cuối
  fees.totalMain = fees.baseMain + fees.extra;
  fees.total = fees.totalMain + fees.totalSupp;

  state.fees = fees;
  return fees;
}

// ===================================================================================
// CẬP NHẬT TÓM TẮT PHÍ (bên phải)
// ===================================================================================
function updateSummaryUI() {
  const fees = appState.fees;
  if (!fees) return;

  const freq = appState.paymentFrequency;
  const freqConfig = CONFIG.PAYMENT_FREQUENCY_FACTORS?.[freq] || { factor: 1 };
  const factor = Number(freqConfig.factor) || 1;

  const perPeriodMain = roundDownTo1000(fees.totalMain * factor);
  const perPeriodSupp = roundDownTo1000(fees.totalSupp * factor);
  const perPeriodTotal = perPeriodMain + perPeriodSupp;

  const elMain = document.getElementById('per-period-main');
  const elSupp = document.getElementById('per-period-supp');
  const elTotal = document.getElementById('per-period-total');

  if (elMain) elMain.textContent = formatDisplayCurrency(perPeriodMain);
  if (elSupp) elSupp.textContent = formatDisplayCurrency(perPeriodSupp);
  if (elTotal) elTotal.textContent = formatDisplayCurrency(perPeriodTotal);

  buildPersonTabs(fees);
}

// ===================================================================================
// TABS / BUTTON XEM TỪNG NGƯỜI
// ===================================================================================
function buildPersonTabs(fees) {
  const container = document.getElementById('person-tabs');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(fees.byPerson).forEach(pid => {
    const rec = fees.byPerson[pid];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'person-tab-btn';
    btn.textContent = `${rec.name}: ${formatDisplayCurrency(rec.supp)}`;
    btn.addEventListener('click', () => {
      highlightPersonInIllustration(pid);
    });
    container.appendChild(btn);
  });
}

function highlightPersonInIllustration(personId) {
  // Optional: cuộn đến bảng chi tiết và highlight hàng tương ứng.
}

// ===================================================================================
// MINH HOẠ CHI TIẾT - PHẦN 1
// ===================================================================================
function renderIllustrationPart1(state) {
  const fees = state.fees;
  const host = document.getElementById('illustration-part-1');
  if (!host || !fees) return;
  host.innerHTML = '';

  const table = document.createElement('table');
  table.className = 'illu-part1-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Người</th>
      <th>Phí chính</th>
      <th>Phí bổ sung</th>
      <th>Tổng</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  let sumMain = 0;
  let sumSupp = 0;
  let sumTotal = 0;

  Object.values(fees.byPerson).forEach(rec => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sanitizeHtml(rec.name)}</td>
      <td style="text-align:right">${formatDisplayCurrency(rec.main)}</td>
      <td style="text-align:right">${formatDisplayCurrency(rec.supp)}</td>
      <td style="text-align:right">${formatDisplayCurrency(rec.total)}</td>
    `;
    tbody.appendChild(tr);
    sumMain += rec.main;
    sumSupp += rec.supp;
    sumTotal += rec.total;
  });

  const trTotal = document.createElement('tr');
  trTotal.className = 'grand-total-row';
  trTotal.innerHTML = `
    <td><strong>Tổng cuối</strong></td>
    <td style="text-align:right"><strong>${formatDisplayCurrency(sumMain)}</strong></td>
    <td style="text-align:right"><strong>${formatDisplayCurrency(sumSupp)}</strong></td>
    <td style="text-align:right"><strong>${formatDisplayCurrency(sumTotal)}</strong></td>
  `;
  tbody.appendChild(trTotal);

  table.appendChild(tbody);
  host.appendChild(table);
}

// ===================================================================================
// MINH HOẠ CHI TIẾT - PHẦN 2 (quy đổi hiển thị)
// ===================================================================================
function renderIllustrationPart2(state) {
  const host = document.getElementById('illustration-part-2');
  if (!host || !state.fees) return;
  host.innerHTML = '';

  const freq = state.paymentFrequency;
  const displayFactor = CONFIG.DISPLAY_FREQ_FACTORS[freq] || 1;

  const table = document.createElement('table');
  table.className = 'illu-part2-table';
  const thead = document.createElement('thead');
  thead.innerHTML = `
    <tr>
      <th>Người</th>
      <th>Chi tiết bổ sung (quy đổi)</th>
      <th>Tổng bổ sung quy đổi</th>
    </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  Object.values(state.fees.byPerson).forEach(rec => {
    const detailParts = [];
    Object.entries(rec.suppDetails || {}).forEach(([sid, val]) => {
      const conv = Math.round(val * displayFactor);
      detailParts.push(`${sanitizeHtml(sid)}: ${formatDisplayCurrency(conv)}`);
    });
    const totalConv = Math.round(rec.supp * displayFactor);

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${sanitizeHtml(rec.name)}</td>
      <td>${detailParts.join('<br/>')}</td>
      <td style="text-align:right">${formatDisplayCurrency(totalConv)}</td>
    `;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  host.appendChild(table);
}

// ===================================================================================
// PLACEHOLDER SẢN PHẨM BỔ SUNG
// ===================================================================================
function applySupplementPlaceholders() {
  const root = document;
  const bhn = root.querySelector('.bhn-section .bhn-stbh');
  if (bhn) bhn.placeholder = '200000000-5000000000';

  const accident = root.querySelector('.accident-section .accident-stbh');
  if (accident) accident.placeholder = '10000000-8000000000';

  const hosp = root.querySelector('.hospital_support-section .hospital_support-stbh');
  if (hosp) hosp.placeholder = '300000-1000000';
  // health_scl: STBH theo program nên không cần placeholder chữ
}

// ===================================================================================
// QUY TRÌNH FULL RECALCULATE
// ===================================================================================
function fullRecalculateAndRender() {
  updateStateFromUI();
  gatherMdp3Data(appState);
  ensureAutoSelectHealthScl(appState);
  performCalculations(appState);
  validateIllustrationAge(appState);
  updateSummaryUI();
  renderIllustrationPart1(appState);
  renderIllustrationPart2(appState);
}

// ===================================================================================
// GẮN SỰ KIỆN
// ===================================================================================
function attachEventHandlersEnhancements() {
  const triggers = [
    '#main-product',
    '#main-stbh',
    '#main-premium-input',
    '#payment-term',
    '#extra-premium-input',
    '#payment-frequency',
    '#illustration-age-input',
    '#mdp3-enable-checkbox',
    '#mdp3-select',
    '#mdp3-other-name',
    '#mdp3-other-dob'
  ];
  triggers.forEach(sel => {
    const el = document.querySelector(sel);
    if (el) {
      el.addEventListener('input', debounce(fullRecalculateAndRender, 160));
      el.addEventListener('change', debounce(fullRecalculateAndRender, 160));
    }
  });

  const mainSuppRoot = document.getElementById('main-supp-container');
  if (mainSuppRoot) {
    mainSuppRoot.addEventListener('input', debounce(fullRecalculateAndRender, 160));
    mainSuppRoot.addEventListener('change', debounce(fullRecalculateAndRender, 160));
  }

  const suppPersons = document.getElementById('supplementary-insured-container');
  if (suppPersons) {
    suppPersons.addEventListener('input', debounce(fullRecalculateAndRender, 160));
    suppPersons.addEventListener('change', debounce(fullRecalculateAndRender, 160));
  }

  applySupplementPlaceholders();
}

// ===================================================================================
// INIT
// ===================================================================================
function initAll() {
  initState();
  attachEventHandlersEnhancements();
  fullRecalculateAndRender();
}

// Expose cho window nếu cần gọi thủ công
window.AppLogic = {
  init: initAll,
  recalc: fullRecalculateAndRender,
  state: appState
};

// Tự động init khi DOM sẵn sàng
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  setTimeout(() => {
    try { initAll(); } catch (e) { console.error(e); }
  }, 0);
} else {
  document.addEventListener('DOMContentLoaded', () => {
    try { initAll(); } catch (e) { console.error(e); }
  });
}

/****************************************************************************************
 * HƯỚNG DẪN HTML (ĐẢM BẢO CÓ CÁC ID SAU):
 * - #main-product (select)
 * - #main-stbh, #main-premium-input, #payment-term, #extra-premium-input
 * - #payment-frequency (select: year|half|quarter)
 * - #illustration-age-input
 * - #main-person-container (div chứa inputs .name-input .dob-input .gender-select .occupation-input)
 * - #main-supp-container .supplementary-products-container (chứa .health_scl-section, v.v.)
 * - #supplementary-insured-container (chứa nhiều .person-container)
 * - Các section supplement:
 *    .health_scl-section (.health_scl-checkbox .health_scl-stbh .health-scl-program ...)
 *    .bhn-section (.bhn-checkbox .bhn-stbh)
 *    .accident-section (.accident-checkbox .accident-stbh)
 *    .hospital_support-section (.hospital_support-checkbox .hospital_support-stbh)
 * - MDP3:
 *    #mdp3-enable-checkbox (checkbox)
 *    #mdp3-select (select: value = id người hoặc 'other')
 *    #mdp3-other-name (input)
 *    #mdp3-other-dob (input dd/mm/yyyy)
 *    #mdp3-other-age (span)
 *    #mdp3-other-error (span)
 * - TÓM TẮT PHÍ:
 *    #per-period-main, #per-period-supp, #per-period-total
 * - MINH HOẠ:
 *    #illustration-part-1, #illustration-part-2
 * - TABS NGƯỜI:
 *    #person-tabs
 *
 * Nếu tên class/id khác, cập nhật lại trong code tương ứng.
 ***************************************************************************************/
