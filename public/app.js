// Antigravity Mailer - Core Client-Side Logic

let recipientsList = [];
let availableVariables = ['name', 'email'];
let sseSource = null;
let activePreviewIndex = 0;
let selectedAttachments = []; // List of selected files to attach

let accountsList = [];
let selectedAccountIndex = -1;

// On Page Load
document.addEventListener('DOMContentLoaded', () => {
  // Fetch Saved SMTP Config
  fetchSmtpConfig();
  
  // Connect to SSE for background campaigns status
  connectStatusSSE();

  // Initialize Event Listeners
  initEventListeners();
});

// Switch Dashboard Tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  document.getElementById(tabId).classList.add('active');
  
  // Find button corresponding to tab and activate it
  const btnMap = {
    'smtp-tab': 0,
    'recipients-tab': 1,
    'composer-tab': 2
  };
  const activeBtn = document.querySelectorAll('.tab-btn')[btnMap[tabId]];
  if (activeBtn) activeBtn.classList.add('active');
}

// Toast Alert System
function showToast(title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  const icons = {
    success: 'fa-circle-check',
    error: 'fa-triangle-exclamation',
    warning: 'fa-circle-exclamation',
    info: 'fa-circle-info'
  };

  toast.innerHTML = `
    <i class="fa-solid ${icons[type]} toast-icon"></i>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()"><i class="fa-solid fa-xmark"></i></button>
  `;
  
  container.appendChild(toast);
  
  // Auto remove after 5 seconds
  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.5s forwards';
    setTimeout(() => toast.remove(), 500);
  }, 5000);
}

// 1. SMTP API Communications & Accounts Manager
async function fetchSmtpConfig() {
  try {
    const res = await fetch('/api/config');
    const result = await res.json();
    if (result.success && result.data && result.data.accounts) {
      accountsList = result.data.accounts;
      renderAccountsList();
      updateEditorState();
    }
  } catch (err) {
    showToast('خطأ بالنظام', 'تعذر جلب الحسابات من الخادم.', 'error');
  }
}

function renderAccountsList() {
  const container = document.getElementById('accountsListContainer');
  container.innerHTML = '';
  
  if (accountsList.length === 0) {
    container.innerHTML = `<div style="text-align: center; color: var(--text-muted); font-size: 0.8rem; padding: 2rem 0;">لا توجد حسابات مضافة حالياً.</div>`;
    return;
  }

  accountsList.forEach((acc, idx) => {
    const isActiveAcc = acc.isActive ? 'is-active-acc' : '';
    const isSelected = selectedAccountIndex === idx ? 'active' : '';
    
    const card = document.createElement('div');
    card.className = `account-item-card ${isActiveAcc} ${isSelected}`;
    card.dataset.index = idx;
    
    const recipientsCount = acc.recipients ? acc.recipients.length : 0;
    const attachmentStatus = acc.attachment ? `<i class="fa-solid fa-paperclip" title="${acc.attachment.filename}"></i>` : '';

    card.innerHTML = `
      <div class="account-card-top">
        <span class="account-card-email" title="${acc.user}">${acc.user || 'حساب جديد'}</span>
        <div class="account-card-status-toggle">
          <span class="status-indicator-dot"></span>
          <label class="switch switch-xs" onclick="event.stopPropagation();">
            <input type="checkbox" class="acc-toggle-checkbox" data-index="${idx}" ${acc.isActive ? 'checked' : ''}>
            <span class="slider round"></span>
          </label>
        </div>
      </div>
      <div class="account-card-sender">${acc.fromName || 'لم يتم تعيين اسم المرسل'}</div>
      <div class="account-card-meta">
        <span class="account-card-badge">${recipientsCount} مستلم</span>
        <div class="account-card-actions">
          ${attachmentStatus}
          <button class="btn-card-action delete" data-index="${idx}" onclick="event.stopPropagation(); deleteAccount(${idx})" title="حذف الحساب">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    `;

    card.addEventListener('click', () => {
      selectedAccountIndex = idx;
      renderAccountsList();
      loadAccountIntoEditor(idx);
    });

    container.appendChild(card);
  });

  // Toggle activation checkbox
  container.querySelectorAll('.acc-toggle-checkbox').forEach(checkbox => {
    checkbox.addEventListener('change', async (e) => {
      const idx = parseInt(e.target.dataset.index);
      const active = e.target.checked;
      accountsList[idx].isActive = active;
      
      try {
        const acc = accountsList[idx];
        const payload = {
          index: idx,
          ...acc,
          recipients: JSON.stringify(acc.recipients || [])
        };
        const res = await fetch('/api/config/save-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success) {
          showToast('تم التحديث', `تم ${active ? 'تفعيل' : 'تعطيل'} الحساب بنجاح!`, 'success');
          renderAccountsList();
        } else {
          showToast('خطأ', result.message, 'error');
        }
      } catch(err) {
        showToast('خطأ في الاتصال', 'تعذر تعديل حالة تنشيط الحساب.', 'error');
      }
    });
  });
}

function updateEditorState() {
  const editorCard = document.getElementById('accountEditorCard');
  const placeholder = document.getElementById('editorPlaceholder');
  const content = document.getElementById('editorContent');

  if (selectedAccountIndex === -1) {
    editorCard.classList.add('empty-state');
    placeholder.classList.remove('hide');
    content.classList.add('hide');
  } else {
    editorCard.classList.remove('empty-state');
    placeholder.classList.add('hide');
    content.classList.remove('hide');
  }
}

function loadAccountIntoEditor(idx) {
  const acc = accountsList[idx];
  if (!acc) return;

  document.getElementById('accountIndex').value = idx;
  document.getElementById('smtpHost').value = acc.host || '';
  document.getElementById('smtpPort').value = acc.port || 587;
  document.getElementById('smtpSecure').checked = acc.secure || false;
  document.getElementById('smtpUser').value = acc.user || '';
  document.getElementById('smtpPass').value = acc.hasPassword ? '••••••••••••••••' : '';
  document.getElementById('fromName').value = acc.fromName || '';
  document.getElementById('fromEmail').value = acc.fromEmail || '';
  
  document.getElementById('customSubject').value = acc.customSubject || '';
  document.getElementById('customHtml').value = acc.customHtml || '';
  
  // Recipients textarea
  const reps = acc.recipients || [];
  const repsText = reps.map(r => `${r.email}, ${r.name}`).join('\n');
  document.getElementById('accountRecipients').value = repsText;
  document.getElementById('accountRecipientsCountBadge').innerHTML = `<i class="fa-solid fa-check-circle"></i> ${reps.length} مستلم معرّف`;

  // Render Attachment Preview
  renderAccountAttachmentPreview(acc.attachment);
  
  updateEditorState();
}

function addNewAccount() {
  const newAcc = {
    host: '',
    port: 587,
    secure: false,
    user: '',
    pass: '',
    fromName: '',
    fromEmail: '',
    customSubject: '',
    customHtml: '',
    recipients: [],
    isActive: true,
    attachment: null
  };
  
  accountsList.push(newAcc);
  selectedAccountIndex = accountsList.length - 1;
  renderAccountsList();
  loadAccountIntoEditor(selectedAccountIndex);
  
  document.getElementById('smtpHost').focus();
  showToast('حساب جديد', 'تم إنشاء حساب جديد. يرجى تهيئة خادم الإرسال وحفظه.', 'info');
}

async function deleteAccount(idx) {
  if (!confirm('هل أنت متأكد من رغبتك في حذف هذا الحساب تماماً؟')) return;
  
  try {
    const res = await fetch('/api/config/delete-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index: idx })
    });
    const result = await res.json();
    if (result.success) {
      showToast('تم الحذف', result.message, 'warning');
      if (selectedAccountIndex === idx) {
        selectedAccountIndex = -1;
      } else if (selectedAccountIndex > idx) {
        selectedAccountIndex--;
      }
      fetchSmtpConfig();
    } else {
      showToast('خطأ في الحذف', result.message, 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال', 'فشل الاتصال بالخادم لحذف الحساب.', 'error');
  }
}

async function testAccountSmtp() {
  const idx = parseInt(document.getElementById('accountIndex').value);
  const host = document.getElementById('smtpHost').value;
  const port = document.getElementById('smtpPort').value;
  const secure = document.getElementById('smtpSecure').checked;
  const user = document.getElementById('smtpUser').value;
  const pass = document.getElementById('smtpPass').value;

  if (!host || !user || !pass) {
    showToast('حقول مطلوبة', 'يرجى ملء المضيف، اسم المستخدم وكلمة المرور لتجربة الاتصال.', 'warning');
    return;
  }

  const btn = document.getElementById('btnTestAccountSmtp');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري فحص الاتصال...';

  try {
    const res = await fetch('/api/config/test-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host, port, secure, user, pass, index: idx })
    });
    const result = await res.json();
    if (result.success) {
      showToast('نجاح الاتصال', result.message, 'success');
    } else {
      showToast('فشل الاتصال', result.message, 'error');
    }
  } catch (err) {
    showToast('خطأ بالخادم', 'تعذر فحص الاتصال بالخادم.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function saveAccountDetails(e) {
  e.preventDefault();
  const idx = parseInt(document.getElementById('accountIndex').value);
  if (idx === -1) return;

  const host = document.getElementById('smtpHost').value;
  const port = document.getElementById('smtpPort').value;
  const secure = document.getElementById('smtpSecure').checked;
  const user = document.getElementById('smtpUser').value;
  const pass = document.getElementById('smtpPass').value;
  const fromName = document.getElementById('fromName').value;
  const fromEmail = document.getElementById('fromEmail').value;
  
  const customSubject = document.getElementById('customSubject').value;
  const customHtml = document.getElementById('customHtml').value;
  
  // Parse Recipients List
  const rawReps = document.getElementById('accountRecipients').value;
  const parsedReps = [];
  rawReps.split('\n').forEach(line => {
    const parts = line.split(/[;,\t]/).map(p => p.trim());
    if (parts.length >= 1 && parts[0] !== '') {
      const email = parts[0];
      const name = parts[1] || email.split('@')[0];
      if (email.includes('@')) {
        parsedReps.push({ email, name });
      }
    }
  });

  const btn = document.getElementById('btnSaveAccount');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري حفظ الحساب...';

  try {
    const payload = {
      index: idx,
      host,
      port,
      secure,
      user,
      pass,
      fromName,
      fromEmail,
      customSubject,
      customHtml,
      recipients: JSON.stringify(parsedReps),
      isActive: accountsList[idx].isActive
    };

    const res = await fetch('/api/config/save-account', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await res.json();
    if (result.success) {
      showToast('تم الحفظ', 'تم حفظ إعدادات وتفاصيل الحساب بنجاح!', 'success');
      fetchSmtpConfig();
    } else {
      showToast('خطأ في الحفظ', result.message, 'error');
    }
  } catch (err) {
    showToast('خطأ في الاتصال', 'فشل الاتصال بالخادم لحفظ الحساب.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

function handleAccountCsvFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
    if (lines.length === 0) return;

    const firstLine = lines[0];
    let sep = ',';
    if (firstLine.includes(';')) sep = ';';
    else if (firstLine.includes('\t')) sep = '\t';

    const clean = (val) => val ? val.replace(/^["']|["']$/g, '').trim() : '';

    const parsed = [];
    const headers = lines[0].split(sep).map(h => h.toLowerCase().trim());
    const emailIdx = headers.indexOf('email');
    const nameIdx = headers.indexOf('name');

    for (let i = 1; i < lines.length; i++) {
      const vals = lines[i].split(sep).map(clean);
      if (vals.length === 0 || (vals.length === 1 && vals[0] === '')) continue;
      
      let email = vals[emailIdx >= 0 ? emailIdx : 0] || '';
      let name = vals[nameIdx >= 0 ? nameIdx : 1] || email.split('@')[0];
      
      if (email.includes('@')) {
        parsed.push({ email, name });
      }
    }

    if (parsed.length > 0) {
      const textarea = document.getElementById('accountRecipients');
      const currentText = textarea.value.trim();
      const newText = parsed.map(r => `${r.email}, ${r.name}`).join('\n');
      textarea.value = currentText ? `${currentText}\n${newText}` : newText;
      
      const count = textarea.value.split('\n').filter(l => l.trim() !== '').length;
      document.getElementById('accountRecipientsCountBadge').innerHTML = `<i class="fa-solid fa-check-circle"></i> ${count} مستلم معرّف`;
      
      showToast('تم الاستيراد', `تم دمج ${parsed.length} مستلم بنجاح! اضغط حفظ الحساب لتثبيت التغييرات.`, 'success');
    }
  };
  reader.readAsText(file, 'utf-8');
}

async function uploadAccountAttachment(file) {
  const idx = parseInt(document.getElementById('accountIndex').value);
  if (idx === -1) return;

  const formData = new FormData();
  formData.append('index', idx);
  formData.append('attachment', file);

  const statusText = document.getElementById('accountAttachmentStatusText');
  statusText.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> جاري رفع الملف...';

  try {
    const res = await fetch('/api/config/upload-attachment', {
      method: 'POST',
      body: formData
    });
    const result = await res.json();
    if (result.success) {
      showToast('تم رفع الصورة', result.message, 'success');
      accountsList[idx].attachment = result.attachment;
      renderAccountAttachmentPreview(result.attachment);
      renderAccountsList();
    } else {
      showToast('فشل الرفع', result.message, 'error');
      statusText.innerText = 'فشل الرفع. يرجى المحاولة مرة أخرى.';
    }
  } catch (err) {
    showToast('خطأ بالخادم', 'تعذر إرسال الملف المرفق.', 'error');
    statusText.innerText = 'حدث خطأ بالشبكة.';
  }
}

function renderAccountAttachmentPreview(attachment) {
  const preview = document.getElementById('accountAttachmentPreview');
  const dropZone = document.getElementById('accountAttachmentDropZone');

  if (attachment && attachment.filename) {
    preview.innerHTML = `
      <div class="uploaded-file-item" style="margin-top:0.75rem;">
        <div class="file-info">
          <i class="fa-solid fa-image text-cyan"></i>
          <span class="file-name" title="${attachment.filename}">${attachment.filename}</span>
        </div>
        <button type="button" class="btn-xs-remove" id="btnRemoveAccountAttachment" title="إزالة الملف">
          إزالة الصورة
        </button>
      </div>
    `;
    preview.classList.remove('hide');
    dropZone.classList.add('hide');

    document.getElementById('btnRemoveAccountAttachment').addEventListener('click', async () => {
      if (!confirm('هل أنت متأكد من رغبتك في حذف صورة هذا الحساب؟')) return;
      const idx = parseInt(document.getElementById('accountIndex').value);
      if (idx === -1) return;

      accountsList[idx].attachment = null;
      try {
        const acc = accountsList[idx];
        const payload = {
          index: idx,
          ...acc,
          recipients: JSON.stringify(acc.recipients || [])
        };
        const res = await fetch('/api/config/save-account', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const result = await res.json();
        if (result.success) {
          showToast('تمت الإزالة', 'تمت إزالة الصورة المرفقة من هذا الحساب بنجاح.', 'success');
          renderAccountAttachmentPreview(null);
          renderAccountsList();
        }
      } catch (err) {
        showToast('خطأ', 'فشل معالجة الطلب على الخادم.', 'error');
      }
    });
  } else {
    preview.innerHTML = '';
    preview.classList.add('hide');
    dropZone.classList.remove('hide');
    document.getElementById('accountAttachmentStatusText').innerText = 'اسحب وأسقط صورة الإثبات هنا، أو انقر للتصفح';
  }
}

// Initialize Event Listeners
function initEventListeners() {
  // Accounts Actions
  document.getElementById('btnAddAccount').addEventListener('click', addNewAccount);
  document.getElementById('btnTestAccountSmtp').addEventListener('click', testAccountSmtp);
  document.getElementById('smtpAccountForm').addEventListener('submit', saveAccountDetails);

  // Real-time parsed recipients count in editor
  document.getElementById('accountRecipients').addEventListener('input', (e) => {
    const lines = e.target.value.split('\n').filter(l => l.trim() !== '');
    document.getElementById('accountRecipientsCountBadge').innerHTML = `<i class="fa-solid fa-check-circle"></i> ${lines.length} مستلم معرّف`;
  });

  // Account CSV Import
  const accountCsvInput = document.getElementById('accountCsvInput');
  accountCsvInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleAccountCsvFile(e.target.files[0]);
    }
  });

  // Account specific attachment dropzone
  const accDropZone = document.getElementById('accountAttachmentDropZone');
  const accAttachmentInput = document.getElementById('accountAttachmentInput');

  accDropZone.addEventListener('click', () => accAttachmentInput.click());
  accDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    accDropZone.style.borderColor = 'var(--accent-cyan)';
    accDropZone.style.background = 'rgba(6, 182, 212, 0.05)';
  });

  ['dragleave', 'drop'].forEach(eventName => {
    accDropZone.addEventListener(eventName, () => {
      accDropZone.style.borderColor = '';
      accDropZone.style.background = '';
    });
  });

  accDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      uploadAccountAttachment(files[0]);
    }
  });

  accAttachmentInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      uploadAccountAttachment(e.target.files[0]);
    }
  });

  // Global CSV Drag and Drop Actions
  const dragZone = document.getElementById('csvDragZone');
  const fileInput = document.getElementById('csvFileInput');

  dragZone.addEventListener('click', () => fileInput.click());

  dragZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dragZone.classList.add('dragover');
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dragZone.addEventListener(eventName, () => dragZone.classList.remove('dragover'));
  });

  dragZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleCsvFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      handleCsvFile(e.target.files[0]);
    }
  });

  // Manual Parsing Action
  const btnParseManual = document.getElementById('btnParseManual');
  btnParseManual.addEventListener('click', () => {
    const rawText = document.getElementById('manualRecipients').value.trim();
    if (!rawText) {
      showToast('مدخلات فارغة', 'برجاء لصق بعض العناوين أولاً للمعالجة.', 'warning');
      return;
    }
    parseManualInputs(rawText);
  });

  // Clear Recipients list
  const btnClearRecipients = document.getElementById('btnClearRecipients');
  btnClearRecipients.addEventListener('click', () => {
    recipientsList = [];
    document.getElementById('previewContainer').classList.add('hide');
    document.getElementById('recipientsCountBadge').innerText = '0';
    showToast('تم تفريغ القائمة', 'تم مسح جميع جهات الاتصال من المسودة.', 'info');
    updateLivePreview();
  });

  // Textarea input triggers preview compiler
  document.getElementById('mailSubject').addEventListener('input', updateLivePreview);
  document.getElementById('mailBody').addEventListener('input', updateLivePreview);

  // Sending Delay Slider Display
  const sendingDelay = document.getElementById('sendingDelay');
  sendingDelay.addEventListener('input', (e) => {
    document.getElementById('delayDisplay').innerText = e.target.value;
  });

  // Launch Campaign
  const btnLaunchCampaign = document.getElementById('btnLaunchCampaign');
  btnLaunchCampaign.addEventListener('click', launchCampaign);

  // Campaign Control actions
  document.getElementById('btnPauseCampaign').addEventListener('click', pauseCampaign);
  document.getElementById('btnResumeCampaign').addEventListener('click', resumeCampaign);
  document.getElementById('btnStopCampaign').addEventListener('click', stopCampaign);

  // Clear Logs
  document.getElementById('btnClearLogs').addEventListener('click', () => {
    document.getElementById('terminalLogsBody').innerHTML = '';
  });

  // Attachments Drag & Drop and Upload Event Listeners
  const attachmentsDropZone = document.getElementById('attachmentsDropZone');
  const emailAttachmentsInput = document.getElementById('emailAttachments');

  attachmentsDropZone.addEventListener('click', () => emailAttachmentsInput.click());

  attachmentsDropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    attachmentsDropZone.style.borderColor = 'var(--accent-cyan)';
    attachmentsDropZone.style.background = 'rgba(6, 182, 212, 0.05)';
  });

  ['dragleave', 'drop'].forEach(eventName => {
    attachmentsDropZone.addEventListener(eventName, () => {
      attachmentsDropZone.style.borderColor = '';
      attachmentsDropZone.style.background = '';
    });
  });

  attachmentsDropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      addAttachments(files);
    }
  });

  emailAttachmentsInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      addAttachments(e.target.files);
    }
  });
}

// 2. Parsers (CSV & Manual text)
function handleCsvFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    parseCSVData(text);
  };
  reader.readAsText(file, 'utf-8');
}

function parseCSVData(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== '');
  if (lines.length === 0) {
    showToast('ملف فارغ', 'لا يحتوي ملف CSV المرفوع على أي بيانات.', 'warning');
    return;
  }

  const firstLine = lines[0];
  let sep = ',';
  if (firstLine.includes(';')) sep = ';';
  else if (firstLine.includes('\t')) sep = '\t';

  const clean = (val) => val ? val.replace(/^["']|["']$/g, '').trim() : '';

  const parseLine = (line) => {
    let result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      let char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === sep && !inQuotes) {
        result.push(clean(current));
        current = '';
      } else {
        current += char;
      }
    }
    result.push(clean(current));
    return result;
  };

  const headers = parseLine(lines[0]);
  const records = [];

  for (let i = 1; i < lines.length; i++) {
    const vals = parseLine(lines[i]);
    if (vals.length === 0 || (vals.length === 1 && vals[0] === '')) continue;
    
    const obj = {};
    headers.forEach((header, index) => {
      const standardKey = header.toLowerCase().trim();
      obj[standardKey] = vals[index] || '';
    });
    records.push(obj);
  }

  if (records.length === 0) {
    showToast('بيانات غير مقروءة', 'تعذر استخراج جهات اتصال صالحة من الملف.', 'error');
    return;
  }

  recipientsList = records;
  availableVariables = headers.map(h => h.toLowerCase().trim());
  
  showToast('نجاح الاستيراد', `تم استيراد ${records.length} جهة اتصال بنجاح من الملف!`, 'success');
  buildPreviewTable(headers);
  buildVariableBadges();
  
  switchTab('recipients-tab');
}

function parseManualInputs(text) {
  const lines = text.split('\n');
  const tempRecords = [];
  
  lines.forEach(line => {
    const parts = line.split(/[;,\t]/).map(p => p.trim());
    if (parts.length >= 1 && parts[0] !== '') {
      const email = parts[0];
      const name = parts[1] || email.split('@')[0];
      const company = parts[2] || '';
      
      if (email.includes('@')) {
        tempRecords.push({ email, name, company });
      }
    }
  });

  if (tempRecords.length === 0) {
    showToast('معالجة غير صالحة', 'لم نتمكن من العثور على أي بريد إلكتروني صالح باللصق اليدوي.', 'warning');
    return;
  }

  recipientsList = recipientsList.concat(tempRecords);
  availableVariables = ['email', 'name', 'company'];
  
  showToast('إضافة ناجحة', `تمت إضافة ${tempRecords.length} جهة اتصال يدوياً للمسودة!`, 'success');
  buildPreviewTable(['email', 'name', 'company']);
  buildVariableBadges();
  
  document.getElementById('manualRecipients').value = '';
}

// 3. Render and Build HTML Grid Table Preview
function buildPreviewTable(headers) {
  const container = document.getElementById('previewContainer');
  const table = document.getElementById('recipientsTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');

  thead.innerHTML = '';
  tbody.innerHTML = '';
  
  if (recipientsList.length === 0) {
    container.classList.add('hide');
    return;
  }

  const trHead = document.createElement('tr');
  const thIdx = document.createElement('th');
  thIdx.innerText = '#';
  trHead.appendChild(thIdx);

  headers.forEach(h => {
    const th = document.createElement('th');
    th.innerText = h.toUpperCase();
    trHead.appendChild(th);
  });
  thead.appendChild(trHead);

  let validCount = 0;
  let invalidCount = 0;

  recipientsList.forEach((recipient, idx) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = idx;

    const emailStr = recipient.email || '';
    const isValid = emailStr.includes('@') && emailStr.length > 5;
    
    if (isValid) validCount++;
    else {
      invalidCount++;
      tr.classList.add('invalid-row');
    }

    const tdIdx = document.createElement('td');
    tdIdx.innerText = idx + 1;
    tr.appendChild(tdIdx);

    headers.forEach(header => {
      const td = document.createElement('td');
      const key = header.toLowerCase().trim();
      td.innerText = recipient[key] || '';
      tr.appendChild(td);
    });

    tr.addEventListener('click', () => {
      activePreviewIndex = idx;
      updateLivePreview();
      
      tbody.querySelectorAll('tr').forEach(r => r.style.background = '');
      tr.style.background = 'rgba(139, 92, 246, 0.15)';
    });

    tbody.appendChild(tr);
  });

  document.getElementById('recipientsCountBadge').innerText = recipientsList.length;
  document.getElementById('parsedTotalCount').innerText = recipientsList.length;
  document.getElementById('validEmailsCount').innerText = validCount;
  document.getElementById('invalidEmailsCount').innerText = invalidCount;

  container.classList.remove('hide');
  
  activePreviewIndex = 0;
  updateLivePreview();
}

// 4. Variables Manager & Placeholders
function buildVariableBadges() {
  const container = document.getElementById('dynamicVariablesBadges');
  container.innerHTML = '';

  availableVariables.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'var-badge';
    btn.innerHTML = `<i class="fa-solid fa-code"></i> {{${v}}}`;
    btn.addEventListener('click', () => insertVariable(v));
    container.appendChild(btn);
  });
}

function insertVariable(variableName) {
  const mailBody = document.getElementById('mailBody');
  const start = mailBody.selectionStart;
  const end = mailBody.selectionEnd;
  const text = mailBody.value;
  const before = text.substring(0, start);
  const after = text.substring(end, text.length);
  
  mailBody.value = before + `{{${variableName}}}` + after;
  mailBody.focus();
  mailBody.selectionStart = mailBody.selectionEnd = start + variableName.length + 4;
  
  updateLivePreview();
}

// 5. Dynamic HTML email compiler & Preview Engine
function updateLivePreview() {
  const previewToEmail = document.getElementById('previewToEmail');
  const previewSubject = document.getElementById('previewSubject');
  const iframe = document.getElementById('emailPreviewIframe');

  if (recipientsList.length === 0) {
    previewToEmail.innerText = 'لم يتم تحديد مستلم';
    previewSubject.innerText = 'لا يوجد موضوع';
    iframe.srcdoc = "<p style='color:#9ca3af; font-family:sans-serif; text-align:center; padding-top:40px;'>اكتب محتوى بريد أو قم بتحديد مستلم من القائمة لمشاهدة معاينة حية بالبيانات الحقيقية هنا.</p>";
    return;
  }

  const recipient = recipientsList[activePreviewIndex] || recipientsList[0];
  const rawSubject = document.getElementById('mailSubject').value || 'لا يوجد موضوع';
  const rawBody = document.getElementById('mailBody').value || '';

  const parseStr = (str, data) => {
    let result = str;
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{{\\s*${key}\\s*}}`, 'gi');
      result = result.replace(regex, value || '');
    }
    return result;
  };

  const compiledSubject = parseStr(rawSubject, recipient);
  const compiledBody = parseStr(rawBody, recipient);

  previewToEmail.innerText = `"${recipient.name || 'بدون اسم'}" <${recipient.email}>`;
  previewSubject.innerText = compiledSubject;
  
  if (compiledBody.trim() === '') {
    iframe.srcdoc = "<p style='color:#9ca3af; font-family:sans-serif; text-align:center; padding-top:40px;'>المحتوى فارغ حالياً.</p>";
  } else {
    const isHtml = /<[a-z][\s\S]*>/i.test(compiledBody);
    iframe.srcdoc = isHtml ? compiledBody : `<pre style='font-family: sans-serif; font-size: 14px; white-space: pre-wrap; padding: 15px;'>${compiledBody}</pre>`;
  }
}

// 5.5. Attachment File Helpers (Global Campaign)
function addAttachments(files) {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    if (!selectedAttachments.some(f => f.name === file.name)) {
      selectedAttachments.push(file);
    }
  }
  renderAttachmentsPreview();
}

function removeAttachment(index) {
  selectedAttachments.splice(index, 1);
  renderAttachmentsPreview();
}

function renderAttachmentsPreview() {
  const container = document.getElementById('attachmentListPreview');
  container.innerHTML = '';
  
  if (selectedAttachments.length === 0) {
    container.classList.add('hide');
    return;
  }

  selectedAttachments.forEach((file, index) => {
    const item = document.createElement('div');
    item.className = 'uploaded-file-item';
    
    const kb = (file.size / 1024).toFixed(1);
    const sizeStr = kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

    item.innerHTML = `
      <div class="file-info">
        <i class="fa-solid fa-paperclip"></i>
        <span class="file-name" title="${file.name}">${file.name}</span>
        <span class="file-size">(${sizeStr})</span>
      </div>
      <button type="button" class="btn-remove-file" onclick="removeAttachment(${index})" title="إزالة الملف">
        <i class="fa-solid fa-circle-xmark"></i>
      </button>
    `;
    container.appendChild(item);
  });

  container.classList.remove('hide');
}

// 6. Campaign Processors API Call
async function launchCampaign() {
  const activeAccountsWithReps = accountsList.filter(acc => acc.isActive && acc.recipients && acc.recipients.length > 0);

  if (recipientsList.length === 0 && activeAccountsWithReps.length === 0) {
    showToast('عفواً', 'قوائم المستلمين فارغة! يرجى إدخال مستلم للمسودة العامة أو ضبط مستلمين في الحسابات النشطة.', 'warning');
    return;
  }

  const isGlobal = recipientsList.length > 0;
  const subject = document.getElementById('mailSubject').value;
  const htmlTemplate = document.getElementById('mailBody').value;
  const delay = document.getElementById('sendingDelay').value * 1000;

  if (isGlobal) {
    if (!subject) {
      showToast('عنوان مطلوب', 'يرجى وضع عنوان للحملة البريدية العامة.', 'warning');
      document.getElementById('mailSubject').focus();
      return;
    }
    if (!htmlTemplate) {
      showToast('محتوى مطلوب', 'محتوى الرسالة العامة فارغ!', 'warning');
      document.getElementById('mailBody').focus();
      return;
    }
  }

  const btn = document.getElementById('btnLaunchCampaign');
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> جاري استنفار خوادم الإرسال وإطلاق الحملة...';

  const formData = new FormData();
  if (isGlobal) {
    formData.append('recipients', JSON.stringify(recipientsList));
    formData.append('subject', subject);
    formData.append('htmlTemplate', htmlTemplate);
    selectedAttachments.forEach(file => {
      formData.append('attachments', file);
    });
  }
  formData.append('delay', delay);

  try {
    const res = await fetch('/api/campaign/start', {
      method: 'POST',
      body: formData
    });

    const result = await res.json();
    if (result.success) {
      showToast('انطلقت الحملة', result.message, 'success');
      connectStatusSSE();
    } else {
      showToast('تعذر البدء', result.message || 'فشل إطلاق الحملة.', 'error');
    }
  } catch (err) {
    showToast('خطأ بالخادم', 'تعذر إطلاق الحملة البريدية من خادم الويب.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

async function pauseCampaign() {
  try {
    const res = await fetch('/api/campaign/pause', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showToast('تم التعليق', result.message, 'info');
    }
  } catch (err) {
    showToast('عطل بالنظام', 'تعذر إرسال أمر التعليق للخادم.', 'error');
  }
}

async function resumeCampaign() {
  try {
    const res = await fetch('/api/campaign/resume', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showToast('استئناف ناجح', result.message, 'success');
    }
  } catch (err) {
    showToast('عطل بالنظام', 'تعذر إرسال أمر الاستئناف للخادم.', 'error');
  }
}

async function stopCampaign() {
  if (!confirm('هل أنت متأكد من رغبتك في إلغاء وإيقاف جميع حملات الإرسال النشطة تماماً؟ لا يمكنك التراجع.')) return;
  try {
    const res = await fetch('/api/campaign/stop', { method: 'POST' });
    const result = await res.json();
    if (result.success) {
      showToast('تم الإلغاء', result.message, 'warning');
    }
  } catch (err) {
    showToast('عطل بالنظام', 'تعذر إيقاف الحملة من الخادم.', 'error');
  }
}

// 7. Server-Sent Events (SSE) Real-time listener
function connectStatusSSE() {
  if (sseSource) {
    sseSource.close();
  }

  const pill = document.getElementById('connectionPill');
  const statusText = pill.querySelector('.status-text');

  sseSource = new EventSource('/api/campaign/status');

  sseSource.onopen = () => {
    pill.className = 'status-pill connected';
    statusText.innerText = 'متصل بالخادم فوريّاً';
  };

  sseSource.onerror = () => {
    pill.className = 'status-pill disconnected';
    statusText.innerText = 'غير متصل بالخادم';
  };

  sseSource.onmessage = (event) => {
    const data = JSON.parse(event.data);
    updateCampaignUI(data);
  };
}

// 8. Update Campaign Progress UI Real-time
function updateCampaignUI(data) {
  const statusLabel = document.getElementById('campaignStatusLabel');
  const controls = document.getElementById('campaignControls');
  const btnPause = document.getElementById('btnPauseCampaign');
  const btnResume = document.getElementById('btnResumeCampaign');

  // Stats
  document.getElementById('statTotal').innerText = data.total;
  document.getElementById('statSuccess').innerText = data.successCount;
  document.getElementById('statFail').innerText = data.failureCount;

  // Percentage
  const percentage = data.total > 0 ? Math.round((data.current / data.total) * 100) : 0;
  document.getElementById('statPercentage').innerText = `${percentage}%`;

  document.getElementById('campaignProgressBar').style.width = `${percentage}%`;
  document.getElementById('campaignProgressBarGlow').style.width = `${percentage}%`;

  if (data.active) {
    controls.classList.remove('hide');
    
    if (data.paused) {
      statusLabel.className = 'campaign-status-label paused';
      statusLabel.innerText = 'الحالة: معلق مؤقتاً';
      btnPause.classList.add('hide');
      btnResume.classList.remove('hide');
    } else {
      statusLabel.className = 'campaign-status-label running';
      statusLabel.innerText = 'الحالة: جاري الإرسال المباشر';
      btnPause.classList.remove('hide');
      btnResume.classList.add('hide');
    }
  } else {
    controls.classList.add('hide');
    statusLabel.className = 'campaign-status-label';
    statusLabel.innerText = 'الحالة: خامل';
  }

  // Update Logs
  if (data.logs && data.logs.length > 0) {
    const terminal = document.getElementById('terminalLogsBody');
    terminal.innerHTML = '';

    data.logs.forEach(log => {
      const line = document.createElement('div');
      line.className = `log-line ${log.status}`;
      
      let msg = '';
      const accPrefix = log.accountUser ? `[${log.accountUser}] ` : '';

      if (log.status === 'success') {
        msg = `✅ [SUCCESS] ${accPrefix}Email sent successfully to ${log.recipientName} <${log.email}>`;
      } else if (log.status === 'failed') {
        msg = `❌ [FAILED] ${accPrefix}Error sending to ${log.recipientName} <${log.email}> - Error: ${log.error}`;
      } else if (log.status === 'info') {
        msg = `ℹ️ [SYSTEM] ${log.error}`;
      } else if (log.status === 'completed') {
        msg = `🎉 [COMPLETED] ${log.error}`;
      }

      line.innerHTML = `
        <span class="log-time">[${log.time}]</span>
        <span class="log-msg">${msg}</span>
      `;
      terminal.appendChild(line);
    });

    terminal.scrollTop = terminal.scrollHeight;
  }
}
